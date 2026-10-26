//! Sessões interativas por PTY (§3/§6).
//!
//! O engine expõe QUATRO ligações interativas diferentes, cada uma com a sua
//! semântica — e esta frente distingue-as explicitamente (nunca as confunde):
//!
//! - `container exec -it <id>` — abre um SHELL NOVO dentro do container (tenta
//!   `bash`, cai para `sh`). É um processo FILHO do container; sair dele não
//!   mata o container.
//! - `container attach <id>` — RE-LIGA à saída do processo PRINCIPAL do
//!   container. No 5.1.1 é OUTPUT-ONLY (o `-i`/stdin é recusado com erro claro:
//!   um container destacado não tem conduta de stdin viva). "Detach" aqui é
//!   fechar a NOSSA ligação (matar o processo `delonix container attach`, que é
//!   apenas um leitor do ficheiro de log) — NUNCA toca no container, que
//!   continua a correr.
//! - `pod exec -it <pod> <cmd>` — shell num membro do pod (o COMMAND é
//!   obrigatório no 5.1.1, por isso usamos `sh`).
//! - `vm console <name>` — a CONSOLA SÉRIE interativa da VM (não um shell
//!   autenticado; a sequência de detach é Ctrl-D, gerida pelo próprio engine).
//!
//! Abrimos um pseudo-terminal (portable-pty) e lançamos o comando SEMPRE por
//! argv (nunca uma shell do host). A saída do PTY é emitida para o webview no
//! evento `dlx-exec` `{id, data}`; o fim do processo emite `dlx-exec-end` `{id}`.
//!
//! VALIDAÇÃO fail-closed: só se permitem os QUATRO modos acima (nada mais), e o
//! nome do recurso tem de ser não-vazio e sem caracteres de shell — defesa em
//! profundidade, já que nunca passamos por uma shell.

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
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

/// Os quatro modos interativos permitidos (ver cabeçalho). Qualquer outra string
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
}

/// Mapeia o identificador vindo do frontend para um modo. Só estas quatro
/// strings são aceites — falha fechada para o resto.
fn parse_mode(s: &str) -> Option<ExecMode> {
    match s {
        "container-exec" => Some(ExecMode::ContainerExec),
        "container-attach" => Some(ExecMode::ContainerAttach),
        "pod-exec" => Some(ExecMode::PodExec),
        "vm-console" => Some(ExecMode::VmConsole),
        _ => None,
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
    if !exec_allowed(&name) {
        return Err(format!("nome de recurso inválido para a sessão: {name:?}"));
    }
    let argv = exec_argv(mode, &name);

    let pty = native_pty_system();
    let pair = pty
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("não foi possível abrir o PTY: {e}"))?;

    let mut cmd = CommandBuilder::new(crate::cli::bin().as_os_str());
    for a in &argv {
        cmd.arg(a);
    }
    // CRÍTICO: o CommandBuilder do portable-pty NÃO herda o ambiente. Sem
    // XDG_RUNTIME_DIR/HOME/PATH o engine rootless não encontra o estado do
    // container (`no such container`) e o exec sai de imediato. Herdar tudo.
    for (k, v) in std::env::vars() {
        cmd.env(k, v);
    }
    // Um terminal a sério quer cor e um TERM conhecido pelo xterm do frontend.
    cmd.env("TERM", "xterm-256color");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("não foi possível lançar `delonix {}`: {e}", argv.join(" ")))?;
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
    fn argv_for_each_of_the_four_modes() {
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
        // Tudo o resto é recusado — nunca se executa um comando fora dos 4 modos.
        for bad in ["", "exec", "container exec", "vm-ssh", "pod-attach", "shell", "container-rm"] {
            assert_eq!(parse_mode(bad), None, "modo não devia ser aceite: {bad:?}");
        }
    }
}
