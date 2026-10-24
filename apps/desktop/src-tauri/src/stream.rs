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

const STREAMABLE: &[&[&str]] = &[&["logs"], &["system", "events"]];

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
