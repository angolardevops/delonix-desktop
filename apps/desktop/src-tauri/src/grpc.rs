//! Cliente gRPC (tonic) do contrato `delonix.node.v1` sobre o **socket Unix**
//! local do node-api, para os STREAMS do ContainerService: Logs, Exec e Stats.
//!
//! Porquê um transporte à parte do `NodeClient` do core? O core é HTTP/1.1
//! síncrono — perfeito para as leituras unárias e o lifecycle (resposta JSON
//! curta, `Connection: close`). O streaming (logs ao vivo, exec bidirecional)
//! precisa de HTTP/2 multiplexado: é isso que o tonic dá. O endereço é o MESMO
//! socket (resolvido pelo core, `NodeClient::from_env().socket()`), por isso não
//! há TLS — só o `SO_PEERCRED` do servidor contra o uid chamador (ADR-0010).

use std::path::PathBuf;

use tokio::net::UnixStream;

/// Cliente gRPC gerado do subconjunto de `delonix.node.v1` (ver `proto/`).
pub mod pb {
    tonic::include_proto!("delonix.node.v1");
}

/// O socket do node-api, pela MESMA resolução do core (`NodeClient::from_env`:
/// `$DELONIX_NODE_API_ADDR` → `$XDG_RUNTIME_DIR/delonix-node.sock` →
/// `/run/delonix-node.sock`). Assim o gRPC e o REST falam sempre com o mesmo nó.
fn socket_path() -> PathBuf {
    delonix_desktop_core::NodeClient::from_env()
        .socket()
        .to_path_buf()
}

/// Abre um canal gRPC (tonic) sobre o socket Unix do node-api. O URI é só um
/// placeholder — o conector ignora-o e liga sempre ao socket local.
async fn grpc_channel() -> Result<tonic::transport::Channel, String> {
    use hyper_util::rt::TokioIo;
    use tonic::transport::{Endpoint, Uri};
    use tower::service_fn;

    let sock = socket_path();
    Endpoint::try_from("http://localhost")
        .map_err(|e| e.to_string())?
        .connect_with_connector(service_fn(move |_: Uri| {
            let sock = sock.clone();
            async move {
                let s = UnixStream::connect(sock).await?;
                Ok::<_, std::io::Error>(TokioIo::new(s))
            }
        }))
        .await
        .map_err(|e| format!("não liga ao node-api (gRPC): {e}"))
}

/// Um cliente do ContainerService ligado ao socket local.
async fn container_client(
) -> Result<pb::container_service_client::ContainerServiceClient<tonic::transport::Channel>, String>
{
    Ok(pb::container_service_client::ContainerServiceClient::new(
        grpc_channel().await?,
    ))
}

/// Abre o server-stream de `ContainerService.Logs`. Devolve o `Streaming` de
/// `LogChunk` — quem chama consome e emite por linha.
pub async fn logs_stream(
    name: &str,
    namespace: &str,
    follow: bool,
    tail_lines: i64,
    timestamps: bool,
) -> Result<tonic::Streaming<pb::LogChunk>, String> {
    let mut client = container_client().await?;
    let req = pb::LogsRequest {
        container: name.to_string(),
        namespace: namespace.to_string(),
        follow,
        tail_lines,
        timestamps,
    };
    let resp = client
        .logs(req)
        .await
        .map_err(|e| format!("Logs gRPC: {}", e.message()))?;
    Ok(resp.into_inner())
}

/// `ContainerService.Stats` (unário): uma amostra de métricas do cgroup vivo.
pub async fn stats_once(name: &str, namespace: &str) -> Result<pb::ContainerStats, String> {
    let mut client = container_client().await?;
    let req = pb::StatsRequest {
        name: name.to_string(),
        namespace: namespace.to_string(),
    };
    let resp = client
        .stats(req)
        .await
        .map_err(|e| format!("Stats gRPC: {}", e.message()))?;
    Ok(resp.into_inner())
}
