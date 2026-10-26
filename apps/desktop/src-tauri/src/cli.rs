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
use std::process::{Output, Stdio};
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

/// Marcador antecedente da mensagem quando um processo é MORTO por exceder o
/// tempo-limite. O frontend (src/lib/errors.ts `TIMEOUT_MARKER`) deteta-o para
/// classificar o erro como TIMEOUT, distinto de um stderr vazio.
pub const TIMEOUT_PREFIX: &str = "DLX_TIMEOUT";

/// Tempo-limite de um comando `delonix` pelo argv. Operações inerentemente
/// LENTAS (puxar/publicar/gravar imagens, scan de CVEs, aplicar stacks, criar
/// backups) ganham uma folga longa; tudo o resto tem um default generoso. O
/// objetivo é NÃO pendurar a UI para sempre — não apertar leituras rápidas.
fn timeout_for(args: &[String]) -> Duration {
    const LONG: &[&[&str]] = &[
        &["image", "pull"],
        &["image", "push"],
        &["image", "save"],
        &["image", "export"],
        &["image", "scan"],
        &["image", "sbom"],
        &["backup", "create"],
        &["backup", "restore"],
        &["stack", "apply"],
        &["compose", "up"],
        &["cluster", "load"],
    ];
    let long = LONG
        .iter()
        .any(|p| args.len() >= p.len() && p.iter().zip(args).all(|(a, b)| a == b));
    Duration::from_secs(if long { 600 } else { 120 })
}

/// Corre um `Command` com tempo-limite: se não terminar dentro de `dur`, o
/// processo é MORTO (via `kill_on_drop`, ao largar o future) e devolve-se um
/// erro distinto prefixado com `TIMEOUT_PREFIX`. `label` é o que a UI mostra.
/// Isolado (não depende do binário) para ser testável com `sleep`/`echo`.
async fn output_with_timeout(
    mut command: Command,
    dur: Duration,
    label: &str,
) -> Result<Output, String> {
    command.kill_on_drop(true);
    let child = command
        .spawn()
        .map_err(|e| format!("não foi possível executar `{label}`: {e}."))?;
    match tokio::time::timeout(dur, child.wait_with_output()).await {
        Ok(res) => res.map_err(|e| format!("falha ao recolher a saída de `{label}`: {e}")),
        // Future largado aqui → `kill_on_drop` mata o processo pendurado.
        Err(_) => Err(format!(
            "{TIMEOUT_PREFIX}: `{label}` excedeu o tempo-limite de {}s e foi terminado.",
            dur.as_secs()
        )),
    }
}

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
    // Artefactos da imagem — LEITURA (§ image). Nenhum tem `-o json` no 5.1.1:
    // imprimem TEXTO e correm por `dlx_run`/readText (sem confirmação). `scan`
    // (SBOM + CVE) e `sbom` leem as camadas do CAS — podem demorar, mas nada
    // executam. `history` lista as camadas; `verify` confere a assinatura cosign
    // de uma imagem local contra uma chave pública. Confirmados por
    // `image <cmd> --help` no 5.1.1.
    (&["image", "scan"], Risk::Read),
    (&["image", "sbom"], Risk::Read),
    (&["image", "history"], Risk::Read),
    (&["image", "verify"], Risk::Read),
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
    // Clusters/Kubernetes — escrita segura (§E). `cluster create` arranca um
    // cluster kind-mode (nós no próprio engine + bootstrap kubeadm) SEM destruir
    // nada → SafeWrite; corre pela via de STREAM (stream.rs) para os logs ao
    // vivo. `cluster start` religa um cluster parado. `cluster load` importa
    // imagens locais para os nós (sem registry). Confirmados por `--help` no
    // 5.1.1.
    (&["cluster", "create"], Risk::SafeWrite),
    (&["cluster", "start"], Risk::SafeWrite),
    (&["cluster", "load"], Risk::SafeWrite),
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
    // Artefactos da imagem — ESCRITA SEGURA (§ image). Nenhum destrói recursos
    // vivos → SafeWrite (correm sem confirmação, como `image pull`). `sign`
    // assina com cosign (gera a chave privada no 1.º uso); `tag` dá outro nome
    // (não copia nada); `push` publica no registry; `save` escreve um arquivo
    // portátil num ficheiro (`-o`); `export` escreve um bundle OCI num diretório.
    // O caminho de `save`/`export` vem sempre do diálogo NATIVO (o CLI é que
    // escreve, não o webview). Confirmados por `image <cmd> --help` no 5.1.1.
    (&["image", "sign"], Risk::SafeWrite),
    (&["image", "tag"], Risk::SafeWrite),
    (&["image", "push"], Risk::SafeWrite),
    (&["image", "save"], Risk::SafeWrite),
    (&["image", "export"], Risk::SafeWrite),
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
    // Clusters/Kubernetes — disruptivas (§E). `cluster stop` pára todos os nós
    // (sem rebuild, sem perder estado); `cluster drain` cordona um nó e despeja
    // os seus pods; `cluster uncordon` mexe no agendamento do nó. Nenhuma apaga
    // o cluster, mas todas interrompem/alteram carga viva → pedem confirmação.
    (&["cluster", "stop"], Risk::Disruptive),
    (&["cluster", "drain"], Risk::Disruptive),
    (&["cluster", "uncordon"], Risk::Disruptive),
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
    // `cluster destroy` remove o cluster INTEIRO — nós, kubeconfig em cache,
    // entrada em ~/.kube/config e (kind-mode / VM sem --network) a rede que ele
    // próprio criou. É irreversível → Destructive, pede confirmação. A UI emite
    // sempre `-f` (salta o prompt do próprio CLI, que bloquearia sem TTY): a
    // confirmação é a da app (ConfirmDialog), não a do terminal.
    (&["cluster", "destroy"], Risk::Destructive),
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
    let mut command = Command::new(bin());
    command
        .args(args)
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let label = format!("delonix {}", args.join(" "));
    let out = output_with_timeout(command, timeout_for(args), &label)
        .await
        // Falha a ARRANCAR o processo troca-se por uma mensagem acionável (o
        // TIMEOUT mantém o seu prefixo para a UI o classificar).
        .map_err(|e| {
            if e.starts_with(TIMEOUT_PREFIX) {
                e
            } else {
                format!("{e} Define DELONIX_BIN ou instala o CLI.")
            }
        })?;
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
        .kill_on_drop(true)
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
    // Mesmo tempo-limite dos comandos normais: um login pendurado (registo
    // inacessível) é morto com erro distinto (prefixo TIMEOUT), não fica mudo.
    let out = match tokio::time::timeout(Duration::from_secs(120), child.wait_with_output()).await {
        Ok(res) => res.map_err(|e| format!("falha ao concluir o login: {e}"))?,
        Err(_) => {
            return Err(format!(
                "{TIMEOUT_PREFIX}: o login em '{registry}' excedeu o tempo-limite de 120s e foi terminado."
            ))
        }
    };
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

// --- kubectl READ passthrough (Kubernetes) ---------------------------------
//
// SEGURANÇA. O engine 5.1.1 NÃO tem um `cluster kubectl` passthrough (ver
// `cluster --help`), por isso ver os recursos DENTRO de um cluster (nós, pods,
// namespaces, logs) faz-se correndo o `kubectl` do SISTEMA contra o kubeconfig
// em CACHE do cluster — exatamente o padrão que o próprio engine já usa em
// `cluster drain`/`uncordon` ("nunca reinventar um cliente que já existe").
//
// O risco de um passthrough é deixar passar um verbo DESTRUTIVO (apply/delete/
// edit/scale/patch/exec…). Fecha-se em DOIS pontos: o construtor em `cli.ts` só
// monta verbos de leitura, E aqui o backend REVALIDA (defesa em profundidade) —
// o primeiro token posicional tem de estar na allowlist de leitura, e nenhum
// argumento pode redefinir a identidade/alvo (`--kubeconfig`, `--server`,
// `--token`, `--as`, certificados), que nós fixamos. Falha fechada.
const KUBECTL_READ_VERBS: &[&str] = &[
    "get",
    "describe",
    "logs",
    "top",
    "version",
    "api-resources",
    "cluster-info",
    "explain",
    "events",
];

// Prefixos de argumento que NÃO podem vir do renderer: redefiniriam o alvo ou a
// identidade que fixamos (o `--kubeconfig` da cache). Recusados por nome.
const KUBECTL_FORBIDDEN_FLAGS: &[&str] = &[
    "--kubeconfig",
    "--server",
    "--token",
    "--as",
    "--as-group",
    "--client-certificate",
    "--client-key",
    "--username",
    "--password",
    "--insecure-skip-tls-verify",
];

/// O primeiro token posicional (o subcomando) é um verbo de LEITURA e nenhum
/// argumento tenta redefinir identidade/alvo. Puro — isolado para ser testável.
pub fn kubectl_read_only(args: &[String]) -> bool {
    if args
        .iter()
        .any(|a| KUBECTL_FORBIDDEN_FLAGS.iter().any(|f| a == f || a.starts_with(&format!("{f}="))))
    {
        return false;
    }
    match args.iter().find(|a| !a.starts_with('-')) {
        Some(sub) => KUBECTL_READ_VERBS.contains(&sub.as_str()),
        None => false,
    }
}

/// O binário `kubectl`: `$KUBECTL_BIN`, senão o que estiver no PATH.
fn kubectl_bin() -> PathBuf {
    std::env::var_os("KUBECTL_BIN")
        .map(PathBuf::from)
        .or_else(|| which::which("kubectl").ok())
        .unwrap_or_else(|| PathBuf::from("kubectl"))
}

/// Corre um comando `kubectl` de LEITURA contra o kubeconfig EM CACHE do
/// cluster. O kubeconfig vem de `delonix cluster kubeconfig <cluster>` (cache
/// local, sem SSH), é escrito num ficheiro temporário 0600 e passado por
/// `--kubeconfig`; o ficheiro é removido no fim. Os `args` são revalidados
/// (`kubectl_read_only`) antes de correr — falha fechada.
pub async fn kubectl(cluster: &str, args: &[String]) -> Result<CliResult, String> {
    if !kubectl_read_only(args) {
        return Err(format!(
            "kubectl não permitido (só leitura): kubectl {}",
            args.join(" ")
        ));
    }
    // O kubeconfig vem do próprio engine (contrato estável), nunca de um caminho
    // adivinhado. O nome do cluster é validado pelo engine.
    let kc = exec(&[
        "cluster".to_string(),
        "kubeconfig".to_string(),
        cluster.to_string(),
    ])
    .await?;
    if !kc.ok {
        return Err(if kc.stderr.trim().is_empty() {
            format!("não foi possível obter o kubeconfig de '{cluster}' (código {})", kc.code)
        } else {
            kc.stderr
        });
    }

    // Ficheiro temporário exclusivo com permissões 0600 (contém credenciais).
    let mut path = std::env::temp_dir();
    let unique = format!(
        "delonix-kubeconfig-{}-{}.yaml",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );
    path.push(unique);
    tokio::fs::write(&path, kc.stdout.as_bytes())
        .await
        .map_err(|e| format!("não foi possível preparar o kubeconfig temporário: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = tokio::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).await;
    }

    let mut argv: Vec<String> = vec!["--kubeconfig".to_string(), path.display().to_string()];
    argv.extend(args.iter().cloned());
    let mut command = Command::new(kubectl_bin());
    command
        .args(&argv)
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let label = format!("kubectl {}", args.join(" "));
    let out = output_with_timeout(command, Duration::from_secs(120), &label).await;
    // Remove o kubeconfig temporário haja o que houver (sucesso, erro, timeout).
    let _ = tokio::fs::remove_file(&path).await;
    let out = out.map_err(|e| {
        if e.starts_with(TIMEOUT_PREFIX) {
            e
        } else {
            format!("{e} Instala o kubectl ou define KUBECTL_BIN.")
        }
    })?;

    let mut shown = vec!["kubectl".to_string()];
    shown.extend(args.iter().cloned());
    Ok(CliResult {
        ok: out.status.success(),
        code: out.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        argv: shown,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(s: &str) -> Vec<String> {
        s.split_whitespace().map(String::from).collect()
    }

    #[test]
    fn timeout_for_gives_long_leash_to_heavy_ops() {
        // Operações lentas ganham folga longa; o resto o default generoso.
        assert_eq!(timeout_for(&v("image pull alpine:3.20")).as_secs(), 600);
        assert_eq!(timeout_for(&v("image scan postgres:16")).as_secs(), 600);
        assert_eq!(timeout_for(&v("stack apply -f prod.yaml")).as_secs(), 600);
        assert_eq!(timeout_for(&v("backup create container db")).as_secs(), 600);
        // Leituras rápidas e mutações leves ficam no default.
        assert_eq!(timeout_for(&v("workload ls -o json")).as_secs(), 120);
        assert_eq!(timeout_for(&v("image ls -o json")).as_secs(), 120);
        assert_eq!(timeout_for(&v("container start web")).as_secs(), 120);
    }

    #[tokio::test]
    async fn output_with_timeout_kills_a_hung_process() {
        // `sleep 5` com 100ms de teto → é MORTO e devolve o erro com o prefixo
        // TIMEOUT (o contrato que o frontend deteta). Determinístico e rápido.
        let mut cmd = Command::new("sleep");
        cmd.arg("5");
        let err = output_with_timeout(cmd, Duration::from_millis(100), "sleep 5")
            .await
            .unwrap_err();
        assert!(err.starts_with(TIMEOUT_PREFIX), "esperava prefixo TIMEOUT, veio: {err}");
    }

    #[tokio::test]
    async fn output_with_timeout_returns_normal_output_in_time() {
        // Um comando rápido termina dentro do teto e devolve a saída normal.
        let mut cmd = Command::new("echo");
        cmd.arg("ola").stdout(Stdio::piped());
        let out = output_with_timeout(cmd, Duration::from_secs(5), "echo ola")
            .await
            .expect("echo devia terminar a tempo");
        assert!(out.status.success());
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "ola");
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
    fn image_artifact_verbs_are_classified() {
        // Artefactos da imagem (estúdio de build). Leitura — correm sem
        // confirmação: scan/sbom/history/verify imprimem TEXTO (sem -o json).
        assert_eq!(classify(&v("image scan postgres:16")), Some(Risk::Read));
        assert_eq!(classify(&v("image scan --sbom nginx")), Some(Risk::Read));
        assert_eq!(classify(&v("image sbom myapp:v1")), Some(Risk::Read));
        assert_eq!(classify(&v("image history alpine:3.19")), Some(Risk::Read));
        assert_eq!(classify(&v("image verify app:1.2.0 cosign.pub")), Some(Risk::Read));
        for a in ["image scan postgres:16", "image sbom myapp:v1", "image history alpine:3.19", "image verify app c.pub"] {
            assert!(!classify(&v(a)).unwrap().requires_confirm(), "leitura não devia pedir confirmação: {a}");
        }
        // Escrita segura — não destroem recursos vivos, correm sem confirmação.
        assert_eq!(classify(&v("image sign kaeso-odoo:18")), Some(Risk::SafeWrite));
        assert_eq!(classify(&v("image sign kaeso-odoo:18 --force")), Some(Risk::SafeWrite));
        assert_eq!(classify(&v("image tag postgres:16 db:stable")), Some(Risk::SafeWrite));
        assert_eq!(classify(&v("image push ghcr.io/angolardevops/app:1.2.0")), Some(Risk::SafeWrite));
        assert_eq!(classify(&v("image save postgres:16 -o postgres-16.tar")), Some(Risk::SafeWrite));
        assert_eq!(classify(&v("image export alpine:latest /tmp/bundle --rootless")), Some(Risk::SafeWrite));
        for a in ["image sign a:v1", "image tag a:v1 b:v1", "image push a:v1", "image save a:v1 -o a.tar", "image export a:v1 /tmp/b"] {
            assert!(!classify(&v(a)).unwrap().requires_confirm(), "SafeWrite não devia pedir confirmação: {a}");
        }
        // `image remove` continua DESTRUCTIVE (apaga a imagem) — pede confirmação.
        assert!(classify(&v("image remove nginx")).unwrap().requires_confirm());
        // Subcomandos de imagem que a UI NÃO emite ficam fora — falha fechada.
        // `apply`/`prune`/`load` mutam fora do fluxo do estúdio; `login` tem o seu
        // próprio comando (stdin), nunca por argv.
        assert_eq!(classify(&v("image apply -f img.yaml")), None);
        assert_eq!(classify(&v("image prune")), None);
        assert_eq!(classify(&v("image load -i app.tar")), None);
        assert_eq!(classify(&v("image login ghcr.io -u user --password-stdin")), None);
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
        // Fora da allowlist — falha fechada. `cluster apply`/`cluster kubeadm`
        // (provisionamento SSH/VM pesado) e `stack rollback`/`prune` NÃO são
        // emitidos pela UI e não são permitidos. (O ciclo de vida kind-mode —
        // create/destroy/start/stop/drain/uncordon/load — É permitido, ver
        // `cluster_lifecycle_verbs_are_classified`.)
        assert_eq!(classify(&v("cluster apply -f prod.yaml")), None);
        assert_eq!(classify(&v("cluster kubeadm --name lab")), None);
        assert_eq!(classify(&v("cluster upgrade --name lab")), None);
        assert_eq!(classify(&v("stack rollback 3")), None);
        assert_eq!(classify(&v("stack prune -f prod.yaml")), None);
        assert_eq!(classify(&v("stack init -t fastapi")), None);
        // `cluster status` não existe no 5.1.1 e não está na allowlist.
        assert_eq!(classify(&v("cluster status")), None);
    }

    #[test]
    fn cluster_lifecycle_verbs_are_classified() {
        // Operar o cluster no app como no Docker/Podman Desktop (kind-mode).
        // Escrita segura — correm sem confirmação.
        assert_eq!(classify(&v("cluster create --name dev --workers 2")), Some(Risk::SafeWrite));
        assert_eq!(classify(&v("cluster start lab")), Some(Risk::SafeWrite));
        assert_eq!(classify(&v("cluster load myapp:dev --name dev")), Some(Risk::SafeWrite));
        assert!(!classify(&v("cluster create --name dev")).unwrap().requires_confirm());
        // Disruptivas — pedem confirmação.
        assert_eq!(classify(&v("cluster stop lab")), Some(Risk::Disruptive));
        assert_eq!(classify(&v("cluster drain lab-w1 --name lab")), Some(Risk::Disruptive));
        assert_eq!(classify(&v("cluster uncordon lab-w1 --name lab")), Some(Risk::Disruptive));
        assert!(classify(&v("cluster stop lab")).unwrap().requires_confirm());
        assert!(classify(&v("cluster drain lab-w1 --name lab")).unwrap().requires_confirm());
        // Destrutiva — remove o cluster inteiro, pede confirmação. A UI emite -f
        // (salta o prompt do CLI, que bloquearia sem TTY); o prefixo casa na mesma.
        assert_eq!(classify(&v("cluster destroy dev -f")), Some(Risk::Destructive));
        assert!(classify(&v("cluster destroy dev -f")).unwrap().requires_confirm());
        // Provisionamento pesado continua FORA (não é kind-mode operável no app).
        assert_eq!(classify(&v("cluster kubeadm --name lab")), None);
        assert_eq!(classify(&v("cluster apply -f prod.yaml")), None);
        assert_eq!(classify(&v("cluster prune dev")), None);
    }

    #[test]
    fn kubectl_passthrough_is_read_only() {
        // Só verbos de leitura passam (o backend REVALIDA o que o cli.ts monta).
        assert!(kubectl_read_only(&v("get nodes -o json")));
        assert!(kubectl_read_only(&v("get pods -A -o json")));
        assert!(kubectl_read_only(&v("get pods -n teamA -o json")));
        assert!(kubectl_read_only(&v("logs web -n default --tail 500")));
        assert!(kubectl_read_only(&v("describe node lab-cp")));
        assert!(kubectl_read_only(&v("top nodes")));
        assert!(kubectl_read_only(&v("version -o json")));
        // Verbos destrutivos/mutantes — recusados (falha fechada).
        assert!(!kubectl_read_only(&v("delete pod web -n default")));
        assert!(!kubectl_read_only(&v("apply -f manifest.yaml")));
        assert!(!kubectl_read_only(&v("edit deploy web")));
        assert!(!kubectl_read_only(&v("scale deploy web --replicas 3")));
        assert!(!kubectl_read_only(&v("patch node lab-cp -p {}")));
        assert!(!kubectl_read_only(&v("exec -it web -- sh")));
        assert!(!kubectl_read_only(&v("cordon lab-w1")));
        assert!(!kubectl_read_only(&v("drain lab-w1")));
        assert!(!kubectl_read_only(&v("cp web:/x /tmp/x")));
        assert!(!kubectl_read_only(&v("port-forward web 8080:80")));
        // Nenhum argumento pode redefinir identidade/alvo (fixamos o kubeconfig).
        assert!(!kubectl_read_only(&v("get pods --kubeconfig /etc/evil.yaml")));
        assert!(!kubectl_read_only(&v("get pods --server https://evil")));
        assert!(!kubectl_read_only(&v("get pods --token abc")));
        assert!(!kubectl_read_only(&v("get pods --kubeconfig=/etc/evil.yaml")));
        // Vazio / só flags — recusado (sem subcomando posicional de leitura).
        assert!(!kubectl_read_only(&v("")));
        assert!(!kubectl_read_only(&v("-o json")));
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
