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

// ─────────────── Logs de container pelo contrato node.v1 (gRPC) ───────────────
//
// Decisão B: os logs de CONTAINER deixam de passar por `delonix container logs -f`
// (CLI, acima) e vêm do server-stream `ContainerService.Logs` (gRPC, crate::grpc).
// Cada `LogChunk` é fragmentado por linha e emitido no MESMO evento `dlx-stream`
// que os fluxos do CLI — por isso o frontend consome-o igual (ver containerLogs).
// Pods continuam na via CLI (`pod logs -f`) enquanto essa fatia não migra.

/// Tasks de stream de logs por id (abortáveis no stop/substituição).
#[derive(Default)]
pub struct NodeLogs(pub Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>);

#[tauri::command]
pub async fn node_logs_start(
    app: AppHandle,
    tasks: State<'_, NodeLogs>,
    id: String,
    name: String,
    namespace: String,
    follow: bool,
    tail_lines: i64,
    timestamps: bool,
) -> Result<(), String> {
    let mut stream =
        crate::grpc::logs_stream(&name, &namespace, follow, tail_lines, timestamps).await?;

    let stream_id = id.clone();
    let handle = tauri::async_runtime::spawn(async move {
        let mut buf: Vec<u8> = Vec::new();
        loop {
            match stream.message().await {
                Ok(Some(chunk)) => {
                    buf.extend_from_slice(&chunk.data);
                    // Emitir cada linha completa; guardar o resto parcial no buffer.
                    while let Some(nl) = buf.iter().position(|&b| b == b'\n') {
                        let line = String::from_utf8_lossy(&buf[..nl]).into_owned();
                        buf.drain(..=nl);
                        let _ = app.emit("dlx-stream", Line { id: stream_id.clone(), line });
                    }
                }
                Ok(None) => break, // fim do stream
                Err(status) => {
                    let _ = app.emit(
                        "dlx-stream",
                        Line { id: stream_id.clone(), line: format!("[erro de stream: {}]", status.message()) },
                    );
                    break;
                }
            }
        }
        if !buf.is_empty() {
            let line = String::from_utf8_lossy(&buf).into_owned();
            let _ = app.emit("dlx-stream", Line { id: stream_id.clone(), line });
        }
        let _ = app.emit("dlx-stream-end", stream_id);
    });

    if let Ok(mut map) = tasks.0.lock() {
        if let Some(old) = map.insert(id, handle) {
            old.abort();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn node_logs_stop(tasks: State<'_, NodeLogs>, id: String) {
    if let Ok(mut map) = tasks.0.lock() {
        if let Some(h) = map.remove(&id) {
            h.abort();
        }
    }
}

// ─────────────── Exec de container pelo contrato node.v1 (gRPC bidi) ───────────────
//
// Decisão B: o modo `container-exec` da aba Terminal (shell NOVO dentro do
// container) deixa de ser `delonix container exec -it` (PTY+CLI, exec.rs) e passa
// pelo stream BIDIRECIONAL `ContainerService.Exec` (gRPC). stdout/stderr do
// servidor viram o MESMO evento `dlx-exec {id,data}` que o PTY, e o fim o
// `dlx-exec-end {id}` — por isso o componente Terminal não muda. stdin e resize
// vão como frames pelo `tx`. Attach/pod-exec/vm-console/host continuam no PTY.

/// Uma sessão de Exec gRPC viva: o `tx` para empurrar stdin/resize e a task que
/// lê as respostas (abortável no stop).
pub struct NodeExecHandle {
    tx: tokio::sync::mpsc::Sender<crate::grpc::pb::ExecRequest>,
    task: tauri::async_runtime::JoinHandle<()>,
}

#[derive(Default)]
pub struct NodeExecs(pub Mutex<HashMap<String, NodeExecHandle>>);

#[derive(Clone, Serialize)]
struct ExecOut {
    id: String,
    data: String,
}

#[tauri::command]
pub async fn node_exec_start(
    app: AppHandle,
    execs: State<'_, NodeExecs>,
    id: String,
    name: String,
    namespace: String,
) -> Result<(), String> {
    use crate::grpc::pb::exec_response;
    // Shell novo (command vazio = o servidor escolhe bash→sh), com TTY. Tamanho
    // inicial 24x80; o frontend redimensiona a seguir pela geometria real.
    let sess = crate::grpc::exec_open(&name, &namespace, Vec::new(), true, 24, 80).await?;
    let mut responses = sess.responses;

    let stream_id = id.clone();
    let task = tauri::async_runtime::spawn(async move {
        loop {
            match responses.message().await {
                Ok(Some(resp)) => match resp.frame {
                    // Com TTY, stdout traz tudo; stderr fica para o caso sem TTY.
                    Some(exec_response::Frame::Stdout(b))
                    | Some(exec_response::Frame::Stderr(b)) => {
                        let data = String::from_utf8_lossy(&b).into_owned();
                        let _ = app.emit(
                            "dlx-exec",
                            ExecOut {
                                id: stream_id.clone(),
                                data,
                            },
                        );
                    }
                    Some(exec_response::Frame::ExitCode(_)) | None => {}
                },
                Ok(None) => break, // fim do stream
                Err(status) => {
                    let _ = app.emit(
                        "dlx-exec",
                        ExecOut {
                            id: stream_id.clone(),
                            data: format!("\r\n[erro de exec: {}]\r\n", status.message()),
                        },
                    );
                    break;
                }
            }
        }
        let _ = app.emit(
            "dlx-exec-end",
            ExecOut {
                id: stream_id,
                data: String::new(),
            },
        );
    });

    if let Ok(mut map) = execs.0.lock() {
        if let Some(old) = map.insert(id, NodeExecHandle { tx: sess.tx, task }) {
            old.task.abort();
        }
    }
    Ok(())
}

/// Clona o `tx` de uma sessão sem segurar o lock através do await.
fn exec_tx(
    execs: &State<'_, NodeExecs>,
    id: &str,
) -> Option<tokio::sync::mpsc::Sender<crate::grpc::pb::ExecRequest>> {
    execs
        .0
        .lock()
        .ok()
        .and_then(|m| m.get(id).map(|h| h.tx.clone()))
}

#[tauri::command]
pub async fn node_exec_write(
    execs: State<'_, NodeExecs>,
    id: String,
    data: String,
) -> Result<(), String> {
    use crate::grpc::pb::{exec_request, ExecRequest};
    let tx = exec_tx(&execs, &id).ok_or("sessão de exec inexistente")?;
    tx.send(ExecRequest {
        frame: Some(exec_request::Frame::Stdin(data.into_bytes())),
    })
    .await
    .map_err(|_| "a sessão de exec já fechou".to_string())
}

#[tauri::command]
pub async fn node_exec_resize(
    execs: State<'_, NodeExecs>,
    id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    use crate::grpc::pb::{exec_request, ExecRequest, TerminalSize};
    let tx = exec_tx(&execs, &id).ok_or("sessão de exec inexistente")?;
    tx.send(ExecRequest {
        frame: Some(exec_request::Frame::Resize(TerminalSize { rows, cols })),
    })
    .await
    .map_err(|_| "a sessão de exec já fechou".to_string())
}

#[tauri::command]
pub fn node_exec_stop(execs: State<'_, NodeExecs>, id: String) {
    if let Ok(mut map) = execs.0.lock() {
        if let Some(h) = map.remove(&id) {
            // Largar o tx fecha o stream de pedidos (o servidor termina o exec);
            // abortar a task pára a leitura das respostas.
            h.task.abort();
            drop(h.tx);
        }
    }
}

// ─────────────── Eventos do nó pelo contrato node.v1 (gRPC) ───────────────
//
// Decisão B: o fluxo de eventos deixa de ser `delonix system events -f -o json`
// (CLI) e vem do server-stream `NodeService.WatchEvents` (gRPC). Cada `Event` é
// mapeado para a forma que a UI já consome ({ts, kind, action, name, detail}) e
// emitido como uma LINHA JSON no MESMO evento `dlx-stream` — o events() do
// frontend parseia-a igual ao JSONL do CLI.

/// Task do stream de eventos por id (abortável no stop/substituição).
#[derive(Default)]
pub struct NodeEvents(pub Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>);

/// Um `Event` do contrato → a linha JSON que o `events()` do frontend parseia.
/// `name` é o `target` sem o prefixo de tipo ("Container/web" → "web"); `detail`
/// vem dos atributos (message/reason) quando presente.
fn event_to_line(ev: &crate::grpc::pb::Event) -> String {
    let ts = ev.time.as_ref().map(|t| t.seconds).unwrap_or(0);
    let name = ev.target.rsplit('/').next().unwrap_or(&ev.target);
    let detail = ev
        .attributes
        .get("message")
        .or_else(|| ev.attributes.get("reason"))
        .or_else(|| ev.attributes.get("detail"))
        .cloned()
        .unwrap_or_default();
    serde_json::json!({
        "ts": ts,
        "kind": ev.kind,
        "action": ev.action,
        "name": name,
        "detail": detail,
    })
    .to_string()
}

#[tauri::command]
pub async fn node_events_start(
    app: AppHandle,
    tasks: State<'_, NodeEvents>,
    id: String,
    namespace: String,
    kinds: Vec<String>,
) -> Result<(), String> {
    let mut stream = crate::grpc::events_stream(&namespace, kinds).await?;

    let stream_id = id.clone();
    let handle = tauri::async_runtime::spawn(async move {
        loop {
            match stream.message().await {
                Ok(Some(ev)) => {
                    let line = event_to_line(&ev);
                    let _ = app.emit(
                        "dlx-stream",
                        Line {
                            id: stream_id.clone(),
                            line,
                        },
                    );
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }
        let _ = app.emit("dlx-stream-end", stream_id);
    });

    if let Ok(mut map) = tasks.0.lock() {
        if let Some(old) = map.insert(id, handle) {
            old.abort();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn node_events_stop(tasks: State<'_, NodeEvents>, id: String) {
    if let Ok(mut map) = tasks.0.lock() {
        if let Some(h) = map.remove(&id) {
            h.abort();
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
