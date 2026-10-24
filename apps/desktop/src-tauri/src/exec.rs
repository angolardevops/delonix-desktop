//! Exec interativo num container via PTY (§3).
//!
//! O engine expõe `delonix container exec -it <id>` — um shell interativo que
//! tenta `bash` e cai para `sh` (ver `container exec --help`). Aqui abrimos um
//! pseudo-terminal (portable-pty) e lançamos esse comando SEMPRE por argv
//! (nunca uma shell do host). A saída do PTY é emitida para o webview no evento
//! `dlx-exec` `{id, data}`; o fim do processo emite `dlx-exec-end` `{id}`.
//!
//! VALIDAÇÃO fail-closed: só se permite o padrão `container exec` (e, no futuro,
//! `pod exec`), e o nome do container tem de ser não-vazio e sem caracteres de
//! shell — defesa em profundidade, já que nunca passamos por uma shell.

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

/// Constrói o argv do exec interativo. Só `container exec` nesta frente
/// (pod exec fica anotado para a próxima). Sem comando → fallback bash/sh do
/// próprio engine.
fn exec_argv(name: &str) -> Vec<String> {
    vec![
        "container".into(),
        "exec".into(),
        "-it".into(),
        name.to_string(),
    ]
}

#[tauri::command]
pub async fn dlx_exec_start(
    app: AppHandle,
    execs: State<'_, Execs>,
    id: String,
    name: String,
) -> Result<(), String> {
    if !exec_allowed(&name) {
        return Err(format!("nome de container inválido para exec: {name:?}"));
    }
    let argv = exec_argv(&name);

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

    #[test]
    fn argv_is_container_exec_only() {
        // Fail-closed: só o padrão `container exec -it <nome>`.
        assert_eq!(
            exec_argv("web"),
            vec!["container", "exec", "-it", "web"]
                .into_iter()
                .map(String::from)
                .collect::<Vec<_>>()
        );
    }
}
