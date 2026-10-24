//! Cliente HTTP/JSON do contrato `delonix.node.v1` sobre **socket Unix**.
//!
//! Porquê HTTP/1.1 cru sobre `UnixStream` e não um stack async + hyper?
//! Para a Fase 1 as leituras do contrato são respostas JSON pequenas e não
//! fragmentadas; um cliente mínimo com `Connection: close` (lê até EOF) prova
//! o contrato sem arrastar tokio/hyper/hyperlocal para o build. O endereço é
//! sempre LOCAL (ADR-0010 do runtime: o contrato de nó é local; quem está à
//! frente trata do remoto) — por isso não há TLS, só o filtro `SO_PEERCRED`
//! do servidor contra o uid chamador. Quando o desktop precisar de streaming
//! (`WatchEvents`, `Logs`), troca-se este transporte por hyper sem mexer no
//! `NodeClient` público nem nos tipos de `model`.

use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::time::Duration;

use serde::de::DeserializeOwned;

use crate::error::{CoreError, Result};
use crate::model::{ApiRoot, Health, ListProviders, NodeInfo};

/// Um cliente do node-api ligado a um socket Unix concreto.
#[derive(Debug, Clone)]
pub struct NodeClient {
    socket: PathBuf,
    timeout: Duration,
}

impl NodeClient {
    /// Liga ao socket dado (ex.: `$XDG_RUNTIME_DIR/delonix-node.sock` ou
    /// `/run/delonix-node.sock`).
    pub fn new(socket: impl Into<PathBuf>) -> Self {
        Self {
            socket: socket.into(),
            timeout: Duration::from_secs(15),
        }
    }

    /// O socket default: `$DELONIX_NODE_API_ADDR` (prefixo `unix://` opcional),
    /// senão `$XDG_RUNTIME_DIR/delonix-node.sock` (rootless), senão
    /// `/run/delonix-node.sock`.
    pub fn from_env() -> Self {
        if let Ok(addr) = std::env::var("DELONIX_NODE_API_ADDR") {
            let path = addr.strip_prefix("unix://").unwrap_or(&addr);
            return Self::new(path);
        }
        if let Ok(run) = std::env::var("XDG_RUNTIME_DIR") {
            return Self::new(format!("{run}/delonix-node.sock"));
        }
        Self::new("/run/delonix-node.sock")
    }

    pub fn socket(&self) -> &std::path::Path {
        &self.socket
    }

    /// GET de um caminho, devolvendo o corpo JSON cru.
    pub fn get_raw(&self, path: &str) -> Result<serde_json::Value> {
        let body = self.request("GET", path)?;
        serde_json::from_slice(&body).map_err(CoreError::Json)
    }

    /// GET tipado.
    pub fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        let body = self.request("GET", path)?;
        serde_json::from_slice(&body).map_err(CoreError::Json)
    }

    pub fn api_root(&self) -> Result<ApiRoot> {
        self.get("/v1")
    }
    pub fn node_info(&self) -> Result<NodeInfo> {
        self.get("/v1/node")
    }
    pub fn health(&self) -> Result<Health> {
        self.get("/v1/node/health")
    }
    pub fn providers(&self) -> Result<ListProviders> {
        self.get("/v1/providers")
    }

    /// HTTP/1.1 `GET`/… mínimo sobre o socket, `Connection: close`. Devolve o
    /// corpo (bytes). Erros do servidor viram `CoreError::Http` com o problema
    /// RFC 9457 anexado quando presente.
    fn request(&self, method: &str, path: &str) -> Result<Vec<u8>> {
        let mut stream = UnixStream::connect(&self.socket).map_err(|e| {
            CoreError::Connect {
                socket: self.socket.display().to_string(),
                source: e,
            }
        })?;
        stream.set_read_timeout(Some(self.timeout)).ok();
        stream.set_write_timeout(Some(self.timeout)).ok();

        let req = format!(
            "{method} {path} HTTP/1.1\r\nHost: localhost\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
        );
        stream.write_all(req.as_bytes()).map_err(CoreError::Io)?;

        let mut raw = Vec::new();
        stream.read_to_end(&mut raw).map_err(CoreError::Io)?;

        let (status, body) = split_http(&raw)?;
        if !(200..300).contains(&status) {
            let detail = String::from_utf8_lossy(body).to_string();
            return Err(CoreError::Http { status, detail });
        }
        Ok(body.to_vec())
    }
}

/// Separa a resposta HTTP/1.1 em (status, corpo). Suporta `Connection: close`
/// (corpo até EOF) e `Content-Length`; não lida com `Transfer-Encoding: chunked`
/// — o que basta às leituras não-stream do contrato. O streaming terá o seu
/// próprio transporte.
fn split_http(raw: &[u8]) -> Result<(u16, &[u8])> {
    let sep = find(raw, b"\r\n\r\n")
        .ok_or_else(|| CoreError::Protocol("resposta HTTP sem fim de cabeçalhos".into()))?;
    let head = &raw[..sep];
    let body = &raw[sep + 4..];

    let head_str = String::from_utf8_lossy(head);
    let status_line = head_str
        .lines()
        .next()
        .ok_or_else(|| CoreError::Protocol("resposta HTTP vazia".into()))?;
    // "HTTP/1.1 200 OK"
    let status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or_else(|| CoreError::Protocol(format!("status line inválida: {status_line}")))?;

    Ok((status, body))
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|w| w == needle)
}
