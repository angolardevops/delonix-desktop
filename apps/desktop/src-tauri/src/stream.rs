//! Fluxos longos do CLI: `delonix logs -f <nome>` e `delonix system events -f -o json`
//! (JSONL, um objeto por linha). Cada linha é emitida para a UI no evento
//! `dlx-stream`; o fim do processo emite `dlx-stream-end`.

use serde::Serialize;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

// O estado dos fluxos é um Arc partilhado: a task que lê o stdout precisa de
// reclamar o Child no fim para o `wait()` (código de saída), por isso clona-se o
// Arc para dentro dela em vez de depender do State (que não é 'static).
#[derive(Default, Clone)]
pub struct Streams(pub Arc<Mutex<HashMap<String, Child>>>);

#[derive(Clone, Serialize)]
struct Line {
    id: String,
    line: String,
}

// Evento final com o CÓDIGO DE SAÍDA do processo (None se o processo foi morto
// por sinal ou já reclamado por um stop()). A UI usa-o para decidir
// sucesso/falha de build e pull sem adivinhar pela existência da imagem.
#[derive(Clone, Serialize)]
struct Exit {
    id: String,
    code: Option<i32>,
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
    // `image pull` corre por STREAM para dar progresso ao vivo (o engine emite
    // linhas INFO no stderr e o digest no stdout) + código de saída acionável.
    &["image", "pull"],
    // `cluster create` arranca um cluster kind-mode (bootstrap kubeadm) e emite
    // progresso demorado — a tela Kubernetes mostra-o ao vivo. Classificado
    // SafeWrite em cli.rs (não destrói nada); aqui ganha a via de STREAM.
    &["cluster", "create"],
    // `stack apply` e `stack wait` são o motor do Architecture Studio (§11): o
    // apply materializa o manifesto por ordem de dependências (logs ao vivo +
    // código de saída) e o wait bloqueia até cada recurso estar Ready. O
    // STREAMABLE é ORTOGONAL ao classify (como `build`): `stack apply` continua
    // classificado SafeWrite/Destructive em cli.rs — aqui só ganha a via de
    // STREAM para o progresso ao vivo. Confirmados por `--help` no 5.1.1.
    &["stack", "apply"],
    &["stack", "wait"],
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
        // stderr é CAPTURADO (não descartado): o progresso de `cluster create` e
        // os erros de `build` saem por aí — a UI mostra tudo no mesmo painel.
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("não foi possível iniciar `delonix`: {e}"))?;
    let stdout = child.stdout.take().ok_or("o processo não tem stdout")?;
    let stderr = child.stderr.take();

    {
        let mut map = streams.0.lock().map_err(|_| "estado dos fluxos corrompido")?;
        if let Some(mut old) = map.insert(id.clone(), child) {
            let _ = old.start_kill();
        }
    }

    // stderr corre numa task à parte, emitindo para o MESMO evento `dlx-stream`
    // (linhas interleaved). Não emite `-end`: o fim é marcado quando o stdout
    // fecha (o processo terminou).
    if let Some(stderr) = stderr {
        let app_err = app.clone();
        let id_err = id.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app_err.emit("dlx-stream", Line { id: id_err.clone(), line });
            }
        });
    }

    let store = streams.0.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app.emit("dlx-stream", Line { id: id.clone(), line });
        }
        // O stdout fechou → o processo terminou. Reclama o Child do mapa (sem
        // manter o lock através do await) e colhe o código de saída. Se já não
        // estiver no mapa foi um stop() explícito → code None.
        let child = { store.lock().ok().and_then(|mut m| m.remove(&id)) };
        let code = match child {
            Some(mut c) => c.wait().await.ok().and_then(|s| s.code()),
            None => None,
        };
        let _ = app.emit("dlx-stream-exit", Exit { id: id.clone(), code });
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
    fn streamable_allows_logs_events_pod_logs_build_and_cluster_create() {
        assert!(allowed(&v("container logs -f odoo-16")));
        assert!(allowed(&v("system events -f -o json")));
        assert!(allowed(&v("pod logs -f web")));
        assert!(allowed(&v("build -t app:v1 .")));
        assert!(allowed(&v("image pull alpine:3.20")));
        assert!(allowed(&v("cluster create --name dev --workers 2")));
    }

    #[test]
    fn streamable_allows_stack_apply_and_wait() {
        // O Architecture Studio (§11) corre apply/wait por STREAM para o
        // progresso ao vivo (DX-recusa "fluxo não permitido" sem isto).
        assert!(allowed(&v("stack apply -f /tmp/studio.yaml")));
        assert!(allowed(&v("stack wait -f /tmp/studio.yaml --timeout 180")));
    }

    #[test]
    fn streamable_refuses_everything_else() {
        // Nem verbos destrutivos nem aliases de raiz entram por aqui.
        assert!(!allowed(&v("workload rm -f web")));
        assert!(!allowed(&v("logs -f web")));
        assert!(!allowed(&v("pod create -f pod.yaml")));
        // Outros subcomandos de `stack` NÃO entram por aqui (só apply/wait).
        assert!(!allowed(&v("stack rm -f web-db")));
        assert!(!allowed(&v("stack")));
    }
}
