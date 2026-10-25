//! Ponte para o CLI `delonix`.
//!
//! O Delonix Engine é daemonless: o CLI é a fonte de verdade e a própria API de
//! gestão (`delonix serve api`) chama o CLI para as mutações. Por isso a app usa
//! o CLI diretamente, sempre com argv (nunca uma shell), e lê `-o json`
//! (contrato ADR-0005 do delonix-runtime).
//!
//! Cada comando permitido tem uma classe de risco com os MESMOS nomes do servidor
//! MCP do engine (`crates/interfaces/delonix-mcp/src/risk.rs`). Um comando que não
//! está na lista é recusado (falha fechada), tal como o MCP trata uma ferramenta
//! desconhecida como `PRIVILEGED`.

use serde::Serialize;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Risk {
    Read,
    SafeWrite,
    Disruptive,
    Destructive,
}

impl Risk {
    /// Igual ao MCP: acima de `SafeWrite` exige `confirm: true` vindo da UI.
    pub fn requires_confirm(self) -> bool {
        !matches!(self, Risk::Read | Risk::SafeWrite)
    }
}

/// Prefixos de argv permitidos e a sua classe. O primeiro que casa ganha, por
/// isso os mais específicos vêm primeiro.
const RULES: &[(&[&str], Risk)] = &[
    // Verbos AGRUPADOS (existem no release 5.1.1 E na develop). Não usar os
    // aliases de raiz estilo Docker (run/ps/images/logs/…): só existem na
    // develop, partem contra o engine 5.1.1.
    // Leitura (todas com JSON estável)
    (&["dashboard"], Risk::Read),
    (&["workload", "ls"], Risk::Read),
    (&["workload", "describe"], Risk::Read),
    (&["container", "ps"], Risk::Read),
    (&["image", "ls"], Risk::Read),
    (&["volume", "ls"], Risk::Read),
    (&["network", "ls"], Risk::Read),
    // Redes (§8.6): detalhe de uma rede, bloco legível (membros com IP) e
    // diagnóstico do estado vivo do nó. `net flow` são os contadores de tráfego
    // por container (eBPF; degrada a veth) — só-leitura. Todos confirmados por
    // `--help` no 5.1.1.
    (&["network", "inspect"], Risk::Read),
    (&["network", "describe"], Risk::Read),
    (&["network", "diagnose"], Risk::Read),
    (&["net", "flow"], Risk::Read),
    (&["vm", "ls"], Risk::Read),
    (&["provider", "ls"], Risk::Read),
    (&["provider", "describe"], Risk::Read),
    (&["system", "info"], Risk::Read),
    (&["system", "doctor"], Risk::Read),
    (&["system", "features"], Risk::Read),
    // Dashboard SRE (§B): contadores de frota estruturados e saúde do nó. Ambos
    // têm `-o json` (ADR-0005) e são só-leitura (`system resources` é Read-only
    // por construção; `system metrics` é um snapshot do coletor do dashboard).
    (&["system", "metrics"], Risk::Read),
    (&["system", "resources"], Risk::Read),
    (&["mcp", "capabilities"], Risk::Read),
    (&["mcp", "doctor"], Risk::Read),
    (&["version"], Risk::Read),
    // Segredos e backups — leitura (§E). `secret ls/inspect` têm JSON; `backup
    // ls/inspect` são TEXTO no 5.1.1 (corridos por dlx_run, classificados READ).
    (&["secret", "ls"], Risk::Read),
    (&["secret", "inspect"], Risk::Read),
    (&["backup", "ls"], Risk::Read),
    (&["backup", "inspect"], Risk::Read),
    // Camada declarativa — leitura (§E). TODOS verbos AGRUPADOS. `stack plan` e
    // `stack history` têm `-o json`; `stack ls/describe/validate`, `compose
    // ps/config`, `cluster ls/health/kubeconfig` e `cluster kube generate` são
    // TEXTO (corridos por dlx_run, classificados READ). NÃO existe `cluster
    // status` no 5.1.1 — a leitura de estado é `cluster health`.
    (&["stack", "ls"], Risk::Read),
    (&["stack", "describe"], Risk::Read),
    (&["stack", "plan"], Risk::Read),
    (&["stack", "validate"], Risk::Read),
    (&["stack", "history"], Risk::Read),
    (&["compose", "ps"], Risk::Read),
    (&["compose", "config"], Risk::Read),
    // Manifestos / portabilidade (explorador de ficheiros). Ambos são
    // HOST-FREE (não tocam na máquina) e só-leitura: `manifest render -f`
    // imprime o manifesto COMPLETO (defaults preenchidos) para levar a outro
    // PC; `manifest validate -f` verifica schema/referências/grafo. Confirmados
    // por `--help` no engine 5.1.1. `manifest schema` (JSON Schema) fica fora:
    // a UI não o emite.
    (&["manifest", "render"], Risk::Read),
    (&["manifest", "validate"], Risk::Read),
    (&["cluster", "ls"], Risk::Read),
    (&["cluster", "health"], Risk::Read),
    (&["cluster", "kubeconfig"], Risk::Read),
    (&["cluster", "kube"], Risk::Read),
    // Escrita segura
    (&["image", "pull"], Risk::SafeWrite),
    (&["container", "start"], Risk::SafeWrite),
    (&["vm", "start"], Risk::SafeWrite),
    (&["volume", "create"], Risk::SafeWrite),
    (&["network", "create"], Risk::SafeWrite),
    // `network connect` multi-homeia um container A QUENTE numa rede extra: é
    // reversível (basta `disconnect`) e não para nada → SafeWrite.
    (&["network", "connect"], Risk::SafeWrite),
    (&["container", "run"], Risk::SafeWrite),
    // Pods (§8): criar de um manifesto (`kind: Pod`). O pod aparece depois em
    // Workloads (type=pod); `workload stop/rm` já cobrem o ciclo de vida. NÃO há
    // flags soltas — é sempre por ficheiro (`pod create -f <manifesto>`). Criar
    // não destrói nada → SafeWrite (corre sem confirmação, como `container run`).
    (&["pod", "create"], Risk::SafeWrite),
    // Registries: `image logout` remove as credenciais guardadas de um registry.
    // É reversível (basta voltar a autenticar) e não apaga nenhum recurso vivo →
    // SafeWrite. O `image login` NÃO está aqui: a password entra por stdin e por
    // isso tem um comando dedicado (`dlx_login`), não passa por `dlx_run`.
    (&["image", "logout"], Risk::SafeWrite),
    // Segredos e backups — escrita segura (§E). `secret rotate` só gera um novo
    // valor aleatório para uma chave existente; não destrói nada.
    (&["secret", "create"], Risk::SafeWrite),
    (&["secret", "rotate"], Risk::SafeWrite),
    (&["backup", "create"], Risk::SafeWrite),
    // Camada declarativa — escrita segura (§E). `stack apply` converge a máquina
    // para o manifesto (cria/atualiza); `compose up` cria/arranca os serviços.
    (&["stack", "apply"], Risk::SafeWrite),
    (&["compose", "up"], Risk::SafeWrite),
    // Disruptivas
    (&["workload", "stop"], Risk::Disruptive),
    (&["container", "stop"], Risk::Disruptive),
    (&["vm", "stop"], Risk::Disruptive),
    (&["container", "restart"], Risk::Disruptive),
    (&["vm", "restart"], Risk::Disruptive),
    // `network disconnect` retira a conectividade do container NAQUELA rede
    // (recusa na primária) — interrompe tráfego vivo → disruptiva (§8.6).
    (&["network", "disconnect"], Risk::Disruptive),
    // `backup restore` sobrepõe o estado vivo do recurso → disruptiva (§E).
    (&["backup", "restore"], Risk::Disruptive),
    // Destrutivas
    (&["workload", "rm"], Risk::Destructive),
    (&["container", "rm"], Risk::Destructive),
    (&["image", "remove"], Risk::Destructive),
    (&["volume", "rm"], Risk::Destructive),
    (&["network", "rm"], Risk::Destructive),
    // `secret rm` apaga o segredo; `backup remove` apaga o arquivo (§E).
    (&["secret", "rm"], Risk::Destructive),
    (&["backup", "remove"], Risk::Destructive),
    // Camada declarativa — destrutivas (§E). Classificadas DESTRUCTIVE (e não
    // apenas Disruptive) porque APAGAM recursos vivos: `stack destroy` remove
    // tudo o que o stack possui; `compose down` remove os containers do projeto
    // e, com `-v`, os volumes nomeados (perda de dados). Pede confirmação.
    (&["stack", "destroy"], Risk::Destructive),
    (&["compose", "down"], Risk::Destructive),
];

pub fn classify(args: &[String]) -> Option<Risk> {
    RULES
        .iter()
        .find(|(prefix, _)| {
            args.len() >= prefix.len() && prefix.iter().zip(args).all(|(p, a)| p == a)
        })
        .map(|(_, r)| *r)
}

/// O binário `delonix`: `$DELONIX_BIN`, senão o que estiver no PATH.
pub fn bin() -> PathBuf {
    std::env::var_os("DELONIX_BIN")
        .map(PathBuf::from)
        .or_else(|| which::which("delonix").ok())
        .unwrap_or_else(|| PathBuf::from("delonix"))
}

#[derive(Debug, Clone, Serialize)]
pub struct CliResult {
    pub ok: bool,
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
    pub argv: Vec<String>,
}

pub async fn exec(args: &[String]) -> Result<CliResult, String> {
    let out = Command::new(bin())
        .args(args)
        .env("NO_COLOR", "1")
        .output()
        .await
        .map_err(|e| format!("não foi possível executar `delonix`: {e}. Define DELONIX_BIN ou instala o CLI."))?;
    let mut argv = vec!["delonix".to_string()];
    argv.extend(args.iter().cloned());
    Ok(CliResult {
        ok: out.status.success(),
        code: out.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        argv,
    })
}

/// Argv de `image login` para um registry/utilizador. A password NUNCA aparece
/// aqui: entra sempre por stdin (`--password-stdin`), nunca pelo argv (onde
/// ficaria no histórico da shell e em /proc). Isolado para ser testável.
pub fn login_argv(registry: &str, username: &str) -> Vec<String> {
    vec![
        "image".to_string(),
        "login".to_string(),
        registry.to_string(),
        "-u".to_string(),
        username.to_string(),
        "--password-stdin".to_string(),
    ]
}

/// Autentica num registry OCI. A password é ESCRITA no stdin do processo
/// `delonix image login … --password-stdin` e nunca toca no argv nem é
/// registada em lado nenhum (nem em erros). Devolve o resultado do CLI (cujos
/// stdout/stderr também não contêm a password).
pub async fn login(registry: &str, username: &str, password: &str) -> Result<CliResult, String> {
    let args = login_argv(registry, username);
    let mut child = Command::new(bin())
        .args(&args)
        .env("NO_COLOR", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("não foi possível executar `delonix`: {e}. Define DELONIX_BIN ou instala o CLI."))?;
    {
        // A password é escrita e o stdin fechado (drop) para o CLI ver o EOF. O
        // erro de escrita é genérico — nunca ecoa o segredo.
        let mut stdin = child.stdin.take().ok_or("o processo de login não expôs stdin")?;
        stdin
            .write_all(password.as_bytes())
            .await
            .map_err(|_| "falha ao escrever a password no stdin do login".to_string())?;
    }
    let out = child
        .wait_with_output()
        .await
        .map_err(|e| format!("falha ao concluir o login: {e}"))?;
    let mut argv = vec!["delonix".to_string()];
    argv.extend(args);
    Ok(CliResult {
        ok: out.status.success(),
        code: out.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        argv,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(s: &str) -> Vec<String> {
        s.split_whitespace().map(String::from).collect()
    }

    #[test]
    fn unknown_commands_are_refused() {
        assert_eq!(classify(&v("system setup --delegate")), None);
        assert_eq!(classify(&v("cluster apply")), None);
    }

    #[test]
    fn root_docker_aliases_are_refused() {
        // Só existem na develop; partem contra o release 5.1.1. O desktop emite
        // as formas agrupadas, por isso os aliases de raiz têm de ficar FORA.
        for a in ["run nginx", "ps", "images", "logs -f x", "pull x", "rmi x", "start x", "stop x", "restart x", "rm -f x"] {
            assert_eq!(classify(&v(a)), None, "alias de raiz não devia ser permitido: {a}");
        }
    }

    #[test]
    fn sre_dashboard_verbs_are_read() {
        // Dashboard SRE (§B): ambos só-leitura, correm sem confirmação.
        assert_eq!(classify(&v("system metrics -o json")), Some(Risk::Read));
        assert_eq!(classify(&v("system resources -o json")), Some(Risk::Read));
        assert!(!classify(&v("system metrics -o json")).unwrap().requires_confirm());
        assert!(!classify(&v("system resources -o json")).unwrap().requires_confirm());
        // `system setup` (delega controladores — privilegiado) continua FORA.
        assert_eq!(classify(&v("system setup --delegate")), None);
    }

    #[test]
    fn grouped_verbs_are_classified() {
        assert!(!classify(&v("image ls -o json")).unwrap().requires_confirm());
        assert!(classify(&v("workload rm -f odoo-16")).unwrap().requires_confirm());
        assert!(classify(&v("image remove nginx")).unwrap().requires_confirm());
        assert!(classify(&v("vm start fc-1")).is_some());
        assert!(!classify(&v("container run -d nginx")).unwrap().requires_confirm());
    }

    #[test]
    fn secrets_and_backups_are_classified() {
        // Leitura — correm sem confirmação.
        assert_eq!(classify(&v("secret ls -o json")), Some(Risk::Read));
        assert_eq!(classify(&v("secret inspect db-pass -o json")), Some(Risk::Read));
        assert_eq!(classify(&v("backup ls --from /srv/backups")), Some(Risk::Read));
        assert_eq!(classify(&v("backup inspect container-db.tar.gz")), Some(Risk::Read));
        // Escrita segura.
        assert_eq!(classify(&v("secret create db-pass --from-literal PASSWORD=x")), Some(Risk::SafeWrite));
        assert_eq!(classify(&v("secret rotate db-pass PASSWORD")), Some(Risk::SafeWrite));
        assert_eq!(classify(&v("backup create container db")), Some(Risk::SafeWrite));
        // Disruptiva — exige confirmação.
        assert!(classify(&v("backup restore container-db.tar.gz")).unwrap().requires_confirm());
        // Destrutivas — exigem confirmação.
        assert!(classify(&v("secret rm db-pass")).unwrap().requires_confirm());
        assert!(classify(&v("backup remove container-db.tar.gz")).unwrap().requires_confirm());
        // `secret rotate-key` (re-encripta TUDO com uma chave-mestra nova) e os
        // outros subcomandos fora da allowlist NÃO são permitidos — falha fechada.
        assert_eq!(classify(&v("secret rotate-key")), None);
        assert_eq!(classify(&v("secret set db-pass --from-literal K=v")), None);
        assert_eq!(classify(&v("secret unset db-pass K")), None);
        assert_eq!(classify(&v("secret apply -f secrets.yaml")), None);
        assert_eq!(classify(&v("backup schedule container db")), None);
    }

    #[test]
    fn pods_build_and_registry_verbs_are_classified() {
        // Pods: criar de manifesto é SafeWrite (corre sem confirmação).
        assert_eq!(classify(&v("pod create -f examples/pod-multi.yaml")), Some(Risk::SafeWrite));
        // `image logout` é SafeWrite (remove credenciais, reversível).
        assert_eq!(classify(&v("image logout ghcr.io")), Some(Risk::SafeWrite));
        // `image login` NÃO passa por dlx_run — tem comando dedicado (stdin).
        // Fica FORA da allowlist de argv (falha fechada se alguém o tentar correr).
        assert_eq!(classify(&v("image login ghcr.io -u user --password-stdin")), None);
        // `build` é um fluxo por STREAM, não por dlx_run → não está em RULES.
        assert_eq!(classify(&v("build -t app:v1 .")), None);
        // Subcomandos de pod que a UI não emite por argv ficam fora (o ciclo de
        // vida usa `workload stop/rm`; logs/exec/attach têm caminhos próprios).
        assert_eq!(classify(&v("pod exec web sh")), None);
        assert_eq!(classify(&v("pod rm web")), None);
    }

    #[test]
    fn login_argv_never_carries_the_password() {
        // A password entra por stdin — o argv tem só registry/utilizador/flag.
        let argv = login_argv("ghcr.io", "angolardevops");
        assert_eq!(argv, vec!["image", "login", "ghcr.io", "-u", "angolardevops", "--password-stdin"]);
        // Garantia explícita: nenhum elemento é (ou contém) um segredo passado.
        let secret = "s3cr3t-token";
        assert!(!login_argv("ghcr.io", "angolardevops").iter().any(|a| a.contains(secret)));
    }

    #[test]
    fn declarative_verbs_are_classified() {
        // Stacks — leitura (correm sem confirmação). plan/history com -o json;
        // ls/describe/validate texto.
        assert_eq!(classify(&v("stack plan -f prod.yaml -o json")), Some(Risk::Read));
        assert_eq!(classify(&v("stack history -f prod.yaml -o json")), Some(Risk::Read));
        assert_eq!(classify(&v("stack ls -f prod.yaml")), Some(Risk::Read));
        assert_eq!(classify(&v("stack describe -f prod.yaml")), Some(Risk::Read));
        assert_eq!(classify(&v("stack validate -f prod.yaml")), Some(Risk::Read));
        // Compose — leitura.
        assert_eq!(classify(&v("compose ps -f docker-compose.yml")), Some(Risk::Read));
        assert_eq!(classify(&v("compose config -f docker-compose.yml")), Some(Risk::Read));
        // Clusters/Kubernetes — leitura. `cluster kube generate` lê um container
        // e imprime um Pod (não muta) → READ.
        assert_eq!(classify(&v("cluster ls -A")), Some(Risk::Read));
        assert_eq!(classify(&v("cluster health lab")), Some(Risk::Read));
        assert_eq!(classify(&v("cluster kubeconfig dev")), Some(Risk::Read));
        assert_eq!(classify(&v("cluster kube generate web")), Some(Risk::Read));
        // Escrita segura — correm sem confirmação.
        assert_eq!(classify(&v("stack apply -f prod.yaml")), Some(Risk::SafeWrite));
        assert_eq!(classify(&v("compose up -f docker-compose.yml -d")), Some(Risk::SafeWrite));
        // Destrutivas — apagam recursos vivos, exigem confirmação.
        assert!(classify(&v("stack destroy -f prod.yaml")).unwrap().requires_confirm());
        assert!(classify(&v("compose down -f docker-compose.yml -v")).unwrap().requires_confirm());
        assert_eq!(classify(&v("stack destroy -f prod.yaml")), Some(Risk::Destructive));
        assert_eq!(classify(&v("compose down -v")), Some(Risk::Destructive));
        // Fora da allowlist — falha fechada. `cluster apply`/`cluster create`/
        // `cluster kubeadm` (provisionamento pesado) e `stack rollback`/`prune`
        // NÃO são emitidos pela UI e não são permitidos.
        assert_eq!(classify(&v("cluster apply -f prod.yaml")), None);
        assert_eq!(classify(&v("cluster create --name dev")), None);
        assert_eq!(classify(&v("cluster kubeadm --name lab")), None);
        assert_eq!(classify(&v("cluster destroy dev")), None);
        assert_eq!(classify(&v("stack rollback 3")), None);
        assert_eq!(classify(&v("stack prune -f prod.yaml")), None);
        assert_eq!(classify(&v("stack init -t fastapi")), None);
        // `cluster status` não existe no 5.1.1 e não está na allowlist.
        assert_eq!(classify(&v("cluster status")), None);
    }

    #[test]
    fn network_verbs_are_classified() {
        // Leitura (§8.6): detalhe, bloco legível, diagnóstico e banda por
        // container — correm sem confirmação.
        assert_eq!(classify(&v("network inspect app -o json")), Some(Risk::Read));
        assert_eq!(classify(&v("network describe app backend")), Some(Risk::Read));
        assert_eq!(classify(&v("network diagnose -o json")), Some(Risk::Read));
        assert_eq!(classify(&v("net flow")), Some(Risk::Read));
        assert_eq!(classify(&v("net flow --iface vh3f2a91c4")), Some(Risk::Read));
        assert!(!classify(&v("network diagnose -o json")).unwrap().requires_confirm());
        // Operações: criar/ligar são SafeWrite (sem confirmação); desligar é
        // disruptiva e remover é destrutiva (ambas pedem confirmação).
        assert_eq!(classify(&v("network create app --driver bridge")), Some(Risk::SafeWrite));
        assert_eq!(classify(&v("network connect backend web")), Some(Risk::SafeWrite));
        assert!(!classify(&v("network connect backend web")).unwrap().requires_confirm());
        assert_eq!(classify(&v("network disconnect backend web")), Some(Risk::Disruptive));
        assert!(classify(&v("network disconnect backend web")).unwrap().requires_confirm());
        assert_eq!(classify(&v("network rm app")), Some(Risk::Destructive));
        assert!(classify(&v("network rm app")).unwrap().requires_confirm());
        // Fora da allowlist — falha fechada. `network route`/`vlan`/`apply`/`ipam`
        // e `net capture` (precisa de tcpdump/privilégios) NÃO são emitidos pela UI.
        assert_eq!(classify(&v("network route a b")), None);
        assert_eq!(classify(&v("network vlan eth0 100")), None);
        assert_eq!(classify(&v("network apply -f net.yaml")), None);
        assert_eq!(classify(&v("network ipam")), None);
        assert_eq!(classify(&v("net capture web")), None);
        assert_eq!(classify(&v("net tunnel expose 8080")), None);
    }

    #[test]
    fn manifest_verbs_are_read_only() {
        // Portabilidade do explorador de ficheiros: render/validate são
        // HOST-FREE e só-leitura → correm sem confirmação.
        assert_eq!(classify(&v("manifest render -f delonix.yaml")), Some(Risk::Read));
        assert_eq!(classify(&v("manifest validate -f delonix.yaml")), Some(Risk::Read));
        assert_eq!(classify(&v("manifest validate -f delonix.yaml --strict")), Some(Risk::Read));
        assert!(!classify(&v("manifest render -f delonix.yaml")).unwrap().requires_confirm());
        // `manifest schema` e qualquer outro subcomando não emitido pela UI
        // ficam fora — falha fechada.
        assert_eq!(classify(&v("manifest schema")), None);
        assert_eq!(classify(&v("manifest apply -f delonix.yaml")), None);
    }
}
