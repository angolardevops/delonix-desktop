//! Fluxos longos do CLI: `delonix logs -f <nome>` e `delonix system events -f -o json`
//! (JSONL, um objeto por linha). Cada linha é emitida para a UI no evento
//! `dlx-stream`; o fim do processo emite `dlx-stream-end`.

use serde::Serialize;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

#[derive(Default)]
pub struct Streams(pub Mutex<HashMap<String, Child>>);

#[derive(Clone, Serialize)]
struct Line {
    id: String,
    line: String,
}

// Fluxos permitidos. `build` produz logs demorados em tempo real; `pod logs`
// segue os logs de um membro de um pod (ambos confirmados por `--help` no
// 5.1.1). `build` é um verbo de raiz LEGÍTIMO do engine (não um alias estilo
// Docker) — a regra §4 dos aliases de raiz só vale para a allowlist de argv de
// `dlx_run` (classify), não para os fluxos.
const STREAMABLE: &[&[&str]] = &[
    &["container", "logs"],
    &["system", "events"],
    &["pod", "logs"],
    &["build"],
];

fn allowed(args: &[String]) -> bool {
    STREAMABLE
        .iter()
        .any(|p| args.len() >= p.len() && p.iter().zip(args).all(|(a, b)| a == b))
}

#[tauri::command]
pub async fn dlx_stream_start(
    app: AppHandle,
    streams: State<'_, Streams>,
    id: String,
    args: Vec<String>,
) -> Result<(), String> {
    if !allowed(&args) {
        return Err(format!("fluxo não permitido: delonix {}", args.join(" ")));
    }
    let mut child = Command::new(crate::cli::bin())
        .args(&args)
        .env("NO_COLOR", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("não foi possível iniciar `delonix`: {e}"))?;
    let stdout = child.stdout.take().ok_or("o processo não tem stdout")?;

    {
        let mut map = streams.0.lock().map_err(|_| "estado dos fluxos corrompido")?;
        if let Some(mut old) = map.insert(id.clone(), child) {
            let _ = old.start_kill();
        }
    }

    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app.emit("dlx-stream", Line { id: id.clone(), line });
        }
        let _ = app.emit("dlx-stream-end", id);
    });
    Ok(())
}

#[tauri::command]
pub fn dlx_stream_stop(streams: State<'_, Streams>, id: String) {
    if let Ok(mut map) = streams.0.lock() {
        if let Some(mut child) = map.remove(&id) {
            let _ = child.start_kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(s: &str) -> Vec<String> {
        s.split_whitespace().map(String::from).collect()
    }

    #[test]
    fn streamable_allows_logs_events_pod_logs_and_build() {
        assert!(allowed(&v("container logs -f odoo-16")));
        assert!(allowed(&v("system events -f -o json")));
        assert!(allowed(&v("pod logs -f web")));
        assert!(allowed(&v("build -t app:v1 .")));
    }

    #[test]
    fn streamable_refuses_everything_else() {
        // Nem verbos destrutivos nem aliases de raiz entram por aqui.
        assert!(!allowed(&v("workload rm -f web")));
        assert!(!allowed(&v("logs -f web")));
        assert!(!allowed(&v("pod create -f pod.yaml")));
    }
}
