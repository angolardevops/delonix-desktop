//! Sessões interativas por PTY (§3/§6).
//!
//! Há DUAS naturezas de terminal, deliberadamente separadas (o dono pediu que a
//! app nunca mais as confunda):
//!
//! 1. SESSÃO DENTRO de um workload (container/pod/VM) — liga-se SEMPRE pelo
//!    engine `delonix`, nunca a uma shell do host. São quatro ligações, cada uma
//!    com a sua semântica:
//!    - `container exec -it <id>` — abre um SHELL NOVO dentro do container (tenta
//!      `bash`, cai para `sh`). É um processo FILHO do container; sair dele não
//!      mata o container.
//!    - `container attach <id>` — RE-LIGA à saída do processo PRINCIPAL do
//!      container. No 5.1.1 é OUTPUT-ONLY (o `-i`/stdin é recusado com erro
//!      claro: um container destacado não tem conduta de stdin viva). "Detach"
//!      aqui é fechar a NOSSA ligação (matar o processo `delonix container
//!      attach`, que é apenas um leitor do ficheiro de log) — NUNCA toca no
//!      container, que continua a correr.
//!    - `pod exec -it <pod> <cmd>` — shell num membro do pod (o COMMAND é
//!      obrigatório no 5.1.1, por isso usamos `sh`).
//!    - `vm console <name>` — a CONSOLA SÉRIE interativa da VM (não um shell
//!      autenticado; a sequência de detach é Ctrl-D, gerida pelo próprio engine).
//!
//! 2. CONSOLA DO HOST (`HostShell`) — o emulador de terminal da PRÓPRIA máquina
//!    do utilizador: abre o seu shell de login (`$SHELL`, ou `/bin/bash` por
//!    omissão) com `-l`, `cwd=$HOME` e o ambiente herdado. NÃO passa pelo engine.
//!
//!    FRONTEIRA DE CONFIANÇA: a consola do host é ACESSO TOTAL à máquina do
//!    utilizador — tudo o que o utilizador pode fazer num terminal, pode fazer
//!    aqui. É por isso EXPLÍCITA e rotulada como tal na UI (não se abre por
//!    conteúdo não-confiável; é a consola do próprio utilizador, equivalente a
//!    abrir um Terminal no sistema). Mantém-se o fail-closed: o HostShell NÃO
//!    aceita quaisquer argumentos vindos do frontend — corre SÓ o shell de login
//!    (o parâmetro `name` é ignorado), por isso o webview nunca pode pedir que a
//!    consola do host execute um comando arbitrário.
//!
//! Abrimos um pseudo-terminal (portable-pty) e lançamos o programa SEMPRE por
//! argv (nunca por uma shell interpretada por string). A saída do PTY é emitida
//! para o webview no evento `dlx-exec` `{id, data}`; o fim do processo emite
//! `dlx-exec-end` `{id}`.
//!
//! VALIDAÇÃO fail-closed: só se permitem os CINCO modos acima (nada mais). Para
//! os quatro modos de SESSÃO, o nome do recurso tem de ser não-vazio e sem
//! caracteres de shell (defesa em profundidade). Para o HostShell não há nome a
//! validar — não se passa nada do frontend ao shell.

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

/// PTYs abertos, por id de sessão (o frontend escolhe o id, p.ex. `exec-<nome>`).
#[derive(Default)]
pub struct Execs(pub Mutex<HashMap<String, ExecHandle>>);

/// Um PTY vivo: o master (para redimensionar), o writer (stdin) e o filho
/// (para matar). O reader corre numa thread própria com um clone do reader.
pub struct ExecHandle {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Clone, Serialize)]
struct ExecData {
    id: String,
    data: String,
}

/// Caracteres de shell e espaços recusados no nome (defesa em profundidade).
const FORBIDDEN: &[char] = &[
    ' ', '\t', '\n', '\r', '|', '&', ';', '<', '>', '(', ')', '$', '`', '\\', '"', '\'', '*', '?',
    '[', ']', '{', '}', '!', '#', '~',
];

/// Fail-closed: nome não-vazio, comprimento sensato e sem caracteres de shell.
fn exec_allowed(name: &str) -> bool {
    !name.is_empty() && name.len() <= 256 && !name.chars().any(|c| FORBIDDEN.contains(&c))
}

/// Os cinco modos interativos permitidos (ver cabeçalho). Qualquer outra string
/// é recusada (falha fechada).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecMode {
    /// `container exec -it <id>` — shell NOVO dentro do container.
    ContainerExec,
    /// `container attach <id>` — re-liga à saída do processo PRINCIPAL (só saída).
    ContainerAttach,
    /// `pod exec -it <pod> sh` — shell num membro do pod.
    PodExec,
    /// `vm console <name>` — consola série da VM (não é shell autenticado).
    VmConsole,
    /// Consola do HOST: o shell de login da própria máquina do utilizador. NÃO
    /// passa pelo engine e NÃO recebe argumentos do frontend (corre só o shell).
    HostShell,
}

impl ExecMode {
    /// Um modo de SESSÃO liga-se por `delonix` e exige um nome de recurso válido.
    /// O `HostShell` é a única exceção (consola da máquina; não há recurso).
    fn is_session(self) -> bool {
        !matches!(self, ExecMode::HostShell)
    }
}

/// Mapeia o identificador vindo do frontend para um modo. Só estas cinco
/// strings são aceites — falha fechada para o resto.
fn parse_mode(s: &str) -> Option<ExecMode> {
    match s {
        "container-exec" => Some(ExecMode::ContainerExec),
        "container-attach" => Some(ExecMode::ContainerAttach),
        "pod-exec" => Some(ExecMode::PodExec),
        "vm-console" => Some(ExecMode::VmConsole),
        "host" => Some(ExecMode::HostShell),
        _ => None,
    }
}

/// O shell de login da máquina para a consola do host: `$SHELL` se definido e
/// não-vazio, senão `/bin/bash`. NUNCA deriva de dados do frontend.
fn host_login_shell() -> OsString {
    match std::env::var_os("SHELL") {
        Some(s) if !s.is_empty() => s,
        _ => OsString::from("/bin/bash"),
    }
}

/// Constrói o argv da sessão interativa para cada modo. Fail-closed por
/// construção: a allowlist é o `match` — não há como pedir outro comando.
///
/// Notas por modo (confirmadas por `--help` no engine 5.1.1):
/// - `container attach` NÃO leva `-it` (é output-only; o `-i` seria recusado).
/// - `pod exec` exige um COMMAND posicional → usamos `sh` (universal; o engine
///   não faz o fallback bash→sh automático do `container exec`).
/// - `vm console` gere o detach pela sua própria sequência (Ctrl-D).
fn exec_argv(mode: ExecMode, name: &str) -> Vec<String> {
    let s = |x: &str| x.to_string();
    match mode {
        ExecMode::ContainerExec => vec![s("container"), s("exec"), s("-it"), name.to_string()],
        ExecMode::ContainerAttach => vec![s("container"), s("attach"), name.to_string()],
        ExecMode::PodExec => vec![s("pod"), s("exec"), s("-it"), name.to_string(), s("sh")],
        ExecMode::VmConsole => vec![s("vm"), s("console"), name.to_string()],
        // A consola do host NÃO passa pelo engine `delonix`, por isso não tem
        // argv de subcomando — é tratada à parte em `dlx_exec_start` (corre o
        // shell de login). Devolve vazio para o `match` ficar exaustivo.
        ExecMode::HostShell => Vec::new(),
    }
}

#[tauri::command]
pub async fn dlx_exec_start(
    app: AppHandle,
    execs: State<'_, Execs>,
    id: String,
    name: String,
    mode: String,
) -> Result<(), String> {
    let mode = parse_mode(&mode)
        .ok_or_else(|| format!("modo de sessão interativa não permitido: {mode:?}"))?;
    // Para os modos de SESSÃO (container/pod/vm), o nome tem de ser válido. Para
    // a consola do HOST, o `name` é IGNORADO — não se passa nada do frontend ao
    // shell (fail-closed: o webview não pode fazer a consola do host correr um
    // comando arbitrário).
    if mode.is_session() && !exec_allowed(&name) {
        return Err(format!("nome de recurso inválido para a sessão: {name:?}"));
    }

    let pty = native_pty_system();
    let pair = pty
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("não foi possível abrir o PTY: {e}"))?;

    // Descrição humana do processo, para as mensagens de erro.
    let descr: String;
    let mut cmd = match mode {
        // CONSOLA DO HOST: o shell de login da máquina, com `-l` e `cwd=$HOME`.
        // NÃO toca no engine e NÃO leva argumentos do frontend — só o shell.
        ExecMode::HostShell => {
            let shell = host_login_shell();
            descr = format!("consola do host ({} -l)", shell.to_string_lossy());
            let mut c = CommandBuilder::new(&shell);
            c.arg("-l");
            if let Some(home) = std::env::var_os("HOME") {
                if !home.is_empty() {
                    c.cwd(home);
                }
            }
            c
        }
        // SESSÃO no workload: sempre pelo binário `delonix`, por argv.
        _ => {
            let argv = exec_argv(mode, &name);
            descr = format!("delonix {}", argv.join(" "));
            let mut c = CommandBuilder::new(crate::cli::bin().as_os_str());
            for a in &argv {
                c.arg(a);
            }
            c
        }
    };
    // CRÍTICO: o CommandBuilder do portable-pty NÃO herda o ambiente. Sem
    // XDG_RUNTIME_DIR/HOME/PATH o engine rootless não encontra o estado do
    // container (`no such container`) e o exec sai de imediato; e a consola do
    // host precisa do mesmo PATH/HOME do utilizador. Herdar tudo.
    for (k, v) in std::env::vars() {
        cmd.env(k, v);
    }
    // Um terminal a sério quer cor e um TERM conhecido pelo xterm do frontend.
    cmd.env("TERM", "xterm-256color");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("não foi possível lançar `{descr}`: {e}"))?;
    // Já não precisamos do slave neste processo; fechá-lo garante EOF no reader
    // quando o filho terminar.
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("não foi possível ler do PTY: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("não foi possível escrever no PTY: {e}"))?;

    {
        let mut map = execs.0.lock().map_err(|_| "estado de exec corrompido")?;
        if let Some(mut old) = map.insert(
            id.clone(),
            ExecHandle {
                master: pair.master,
                writer,
                child,
            },
        ) {
            let _ = old.child.kill();
        }
    }

    // O portable-pty é bloqueante: lemos numa thread do SO (não no runtime async).
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = app.emit(
                        "dlx-exec",
                        ExecData {
                            id: id.clone(),
                            data,
                        },
                    );
                }
                Err(_) => break,
            }
        }
        let _ = app.emit("dlx-exec-end", ExecData { id, data: String::new() });
    });

    Ok(())
}

#[tauri::command]
pub fn dlx_exec_write(execs: State<'_, Execs>, id: String, data: String) -> Result<(), String> {
    let mut map = execs.0.lock().map_err(|_| "estado de exec corrompido")?;
    let h = map.get_mut(&id).ok_or("sessão de exec inexistente")?;
    h.writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("falha ao escrever no PTY: {e}"))?;
    h.writer
        .flush()
        .map_err(|e| format!("falha ao esvaziar o PTY: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn dlx_exec_resize(
    execs: State<'_, Execs>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let map = execs.0.lock().map_err(|_| "estado de exec corrompido")?;
    let h = map.get(&id).ok_or("sessão de exec inexistente")?;
    h.master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("falha ao redimensionar o PTY: {e}"))
}

#[tauri::command]
pub fn dlx_exec_stop(execs: State<'_, Execs>, id: String) {
    if let Ok(mut map) = execs.0.lock() {
        if let Some(mut h) = map.remove(&id) {
            let _ = h.child.kill();
            // O master é largado aqui; o reader recebe EOF e emite `dlx-exec-end`.
        }
    }
}

/// Identidade do host para ROTULAR a consola do host na UI (ex.
/// `walter@maquina · /bin/bash`). Puramente informativa — NÃO influencia o que é
/// executado (o shell é sempre o `host_login_shell`). Lê-se de env/`/etc/hostname`.
#[derive(Clone, Serialize)]
pub struct HostIdentity {
    user: String,
    host: String,
    shell: String,
}

fn hostname() -> String {
    if let Some(h) = std::env::var_os("HOSTNAME").filter(|h| !h.is_empty()) {
        return h.to_string_lossy().into_owned();
    }
    std::fs::read_to_string("/etc/hostname")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "host".to_string())
}

#[tauri::command]
pub fn dlx_host_identity() -> HostIdentity {
    let user = std::env::var("USER")
        .or_else(|_| std::env::var("LOGNAME"))
        .unwrap_or_else(|_| "utilizador".to_string());
    HostIdentity {
        user,
        host: hostname(),
        shell: host_login_shell().to_string_lossy().into_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_plain_container_names() {
        assert!(exec_allowed("odoo-16"));
        assert!(exec_allowed("postgres_dev"));
        assert!(exec_allowed("web.1"));
        assert!(exec_allowed("a1b2c3d4e5f6"));
    }

    #[test]
    fn rejects_empty_and_shell_metacharacters() {
        assert!(!exec_allowed(""));
        assert!(!exec_allowed("web; rm -rf /"));
        assert!(!exec_allowed("$(id)"));
        assert!(!exec_allowed("a`b`"));
        assert!(!exec_allowed("a|b"));
        assert!(!exec_allowed("a b"));
        assert!(!exec_allowed("a&b"));
        assert!(!exec_allowed("a>b"));
    }

    #[test]
    fn rejects_overlong_names() {
        assert!(!exec_allowed(&"a".repeat(257)));
    }

    fn argv(mode: ExecMode, name: &str) -> Vec<String> {
        exec_argv(mode, name)
    }

    #[test]
    fn argv_for_each_of_the_four_session_modes() {
        // container exec: shell NOVO, interativo (-it).
        assert_eq!(argv(ExecMode::ContainerExec, "web"), ["container", "exec", "-it", "web"]);
        // container attach: processo PRINCIPAL, SEM -it (output-only no 5.1.1).
        assert_eq!(argv(ExecMode::ContainerAttach, "web"), ["container", "attach", "web"]);
        // pod exec: COMMAND obrigatório → sh.
        assert_eq!(argv(ExecMode::PodExec, "api"), ["pod", "exec", "-it", "api", "sh"]);
        // vm console: consola série.
        assert_eq!(argv(ExecMode::VmConsole, "fc-1"), ["vm", "console", "fc-1"]);
    }

    #[test]
    fn host_shell_never_produces_engine_argv() {
        // A consola do host NÃO passa pelo engine: não há subcomando `delonix`,
        // e o `name` do frontend é ignorado por completo (fail-closed).
        assert!(argv(ExecMode::HostShell, "web").is_empty());
        assert!(argv(ExecMode::HostShell, "$(rm -rf /)").is_empty());
    }

    #[test]
    fn only_host_shell_is_a_non_session_mode() {
        assert!(!ExecMode::HostShell.is_session());
        for m in [ExecMode::ContainerExec, ExecMode::ContainerAttach, ExecMode::PodExec, ExecMode::VmConsole] {
            assert!(m.is_session(), "{m:?} devia ser um modo de sessão");
        }
    }

    /// Prova VIVA (ignorada por omissão: toca no SO): abre um PTY com o shell de
    /// login do host — exatamente a mesma receita de `dlx_exec_start` para o
    /// `HostShell` — escreve um `echo` e confirma que a saída volta. Corre com
    /// `cargo test -- --ignored run_host_shell_echoes`.
    #[test]
    #[ignore]
    fn run_host_shell_echoes() {
        use std::io::{Read, Write};
        use std::time::{Duration, Instant};

        let pty = native_pty_system();
        let pair = pty
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .expect("abrir PTY");

        let shell = host_login_shell();
        let mut cmd = CommandBuilder::new(&shell);
        cmd.arg("-l");
        if let Some(home) = std::env::var_os("HOME") {
            cmd.cwd(home);
        }
        for (k, v) in std::env::vars() {
            cmd.env(k, v);
        }
        cmd.env("TERM", "xterm-256color");

        let mut child = pair.slave.spawn_command(cmd).expect("lançar o shell de login");
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().expect("reader");
        let mut writer = pair.master.take_writer().expect("writer");

        writer.write_all(b"echo HOSTSHELL_OK_42\n").expect("escrever no PTY");
        writer.flush().ok();

        let (tx, rx) = std::sync::mpsc::channel::<String>();
        std::thread::spawn(move || {
            let mut acc = String::new();
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        acc.push_str(&String::from_utf8_lossy(&buf[..n]));
                        if acc.contains("HOSTSHELL_OK_42") {
                            let _ = tx.send(acc.clone());
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        let deadline = Instant::now() + Duration::from_secs(10);
        let mut seen = false;
        while Instant::now() < deadline {
            if let Ok(out) = rx.recv_timeout(Duration::from_millis(250)) {
                // Mais do que o eco do comando: a LINHA de saída do echo.
                seen = out.matches("HOSTSHELL_OK_42").count() >= 2 || out.contains("HOSTSHELL_OK_42\r\n");
                break;
            }
        }
        let _ = writer.write_all(b"exit\n");
        let _ = child.kill();
        assert!(seen, "o shell de login do host devia ecoar HOSTSHELL_OK_42");
    }

    #[test]
    fn host_login_shell_is_an_absolute_program() {
        // Nota: SHELL está quase sempre definido no ambiente de teste, por isso
        // validamos a invariante (programa não-vazio e absoluto) sem mexer no
        // ambiente global do processo de teste.
        let s = host_login_shell();
        assert!(!s.is_empty());
        assert!(std::path::Path::new(&s).is_absolute(), "o shell de login deve ser um caminho absoluto: {s:?}");
    }

    #[test]
    fn attach_never_carries_interactive_stdin_flag() {
        // O engine 5.1.1 RECUSA `-i` no attach; a nossa allowlist nunca o emite.
        assert!(!argv(ExecMode::ContainerAttach, "web").iter().any(|a| a == "-i" || a == "-it"));
    }

    #[test]
    fn parse_mode_is_fail_closed() {
        assert_eq!(parse_mode("container-exec"), Some(ExecMode::ContainerExec));
        assert_eq!(parse_mode("container-attach"), Some(ExecMode::ContainerAttach));
        assert_eq!(parse_mode("pod-exec"), Some(ExecMode::PodExec));
        assert_eq!(parse_mode("vm-console"), Some(ExecMode::VmConsole));
        assert_eq!(parse_mode("host"), Some(ExecMode::HostShell));
        // Tudo o resto é recusado — nunca se executa um comando fora dos 5 modos.
        for bad in ["", "exec", "container exec", "vm-ssh", "pod-attach", "shell", "container-rm", "host-exec", "hostshell", "bash"] {
            assert_eq!(parse_mode(bad), None, "modo não devia ser aceite: {bad:?}");
        }
    }
}
