//! Prova ao vivo dos STREAMS de container do contrato node.v1, exercitando o
//! MÓDULO EMBARCADO `grpc` (o mesmo que os comandos Tauri `node_logs_start` e a
//! aba de Estatísticas invocam) — não uma cópia. Contra um `delonix serve
//! node-api` vivo, prova exatamente o que a GUI corre por baixo:
//!   1. `ContainerService.Logs` (gRPC server-stream) — emite por linha;
//!   2. `ContainerService.Stats` (gRPC unário) — uma amostra de métricas.
//!
//! Uso:
//!   DELONIX_NODE_API_ADDR=unix://<sock> cargo run --example node_streams -- <container>
//!
//! Código de saída 0 = tudo passou (CI-friendly).

use delonix_desktop_lib::grpc;

#[tokio::main]
async fn main() -> Result<(), String> {
    let name = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "dd-logs-proof".into());
    let ns = "default";

    // 1. Logs pelo server-stream gRPC (== lógica do spawn de `node_logs_start`):
    //    buffer de bytes, emitir por linha completa.
    println!("→ gRPC Logs (follow) — a emitir por linha, como a GUI faz:");
    let mut stream = grpc::logs_stream(&name, ns, true, 50, false).await?;
    let mut buf: Vec<u8> = Vec::new();
    let mut emitted = 0;
    while emitted < 5 {
        match stream.message().await.map_err(|e| e.to_string())? {
            Some(chunk) => {
                buf.extend_from_slice(&chunk.data);
                while let Some(nl) = buf.iter().position(|&b| b == b'\n') {
                    let line = String::from_utf8_lossy(&buf[..nl]).into_owned();
                    buf.drain(..=nl);
                    println!("   [{:?}] {line}", chunk.stream());
                    emitted += 1;
                    if emitted >= 5 {
                        break;
                    }
                }
            }
            None => break,
        }
    }
    if emitted == 0 {
        return Err("gRPC Logs não emitiu nenhuma linha".into());
    }

    // 2. Stats pelo gRPC unário (== a aba de Estatísticas).
    let s = grpc::stats_once(&name, ns).await?;
    println!(
        "→ gRPC Stats: cpu={}ns mem_working_set={}B mem_limit={}B pids={} rx={}B tx={}B",
        s.cpu_usage_nanos,
        s.memory_working_set_bytes,
        s.memory_limit_bytes,
        s.pids,
        s.network_rx_bytes,
        s.network_tx_bytes
    );

    // 3. Exec BIDIRECIONAL (== a aba Terminal, modo container-exec): envia um
    //    comando não-interativo, lê o stdout e o exit_code pelo mesmo stream.
    use delonix_desktop_lib::grpc::pb::exec_response;
    println!("→ gRPC Exec (bidi) — comando `sh -c 'echo EXEC_OK; exit 7'`:");
    let sess = grpc::exec_open(
        &name,
        ns,
        vec!["sh".into(), "-c".into(), "echo EXEC_OK; exit 7".into()],
        false,
        0,
        0,
    )
    .await?;
    let mut responses = sess.responses;
    let mut out = String::new();
    let mut exit: Option<i32> = None;
    while let Some(resp) = responses.message().await.map_err(|e| e.to_string())? {
        match resp.frame {
            Some(exec_response::Frame::Stdout(b)) => out.push_str(&String::from_utf8_lossy(&b)),
            Some(exec_response::Frame::Stderr(b)) => {
                eprint!("[stderr] {}", String::from_utf8_lossy(&b))
            }
            Some(exec_response::Frame::ExitCode(c)) => exit = Some(c),
            None => {}
        }
    }
    // mantém o tx vivo até aqui (fechá-lo cedo encerraria o stream de pedidos).
    drop(sess.tx);
    println!("   stdout={:?}  exit={:?}", out.trim(), exit);
    if !out.contains("EXEC_OK") || exit != Some(7) {
        return Err(format!("Exec inesperado: stdout={out:?} exit={exit:?}"));
    }

    println!("\n✅ streams node.v1 da GUI (gRPC Logs + Stats + Exec bidi) validados ao vivo");
    Ok(())
}
