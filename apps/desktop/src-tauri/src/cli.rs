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
    (&["vm", "ls"], Risk::Read),
    (&["provider", "ls"], Risk::Read),
    (&["provider", "describe"], Risk::Read),
    (&["system", "info"], Risk::Read),
    (&["system", "doctor"], Risk::Read),
    (&["system", "features"], Risk::Read),
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
    (&["container", "run"], Risk::SafeWrite),
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
}
