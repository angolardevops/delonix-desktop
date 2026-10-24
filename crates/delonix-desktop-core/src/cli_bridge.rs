//! Ponte CLI-JSON: envolve `delonix … -o json` com nomes de campo ESTÁVEIS
//! (ADR-0005 do runtime) para as capacidades que o contrato `node.v1` ainda
//! não serve — hoje, sobretudo **containers e pods** (a raiz de `/v1` não os
//! anuncia; `ContainerService` responde 501 DX-6001).
//!
//! Regra de segurança (brief §6): NUNCA construir uma linha de shell a partir
//! de texto do utilizador. Cada argumento é um item separado de `Command`;
//! não há `sh -c`, não há interpolação. A saída é JSON estruturado, não
//! stdout para parsing frágil.

use std::path::PathBuf;
use std::process::Command;

use crate::error::{CoreError, Result};
use crate::model::Workload;

/// Invoca o binário `delonix` com saída JSON.
#[derive(Debug, Clone)]
pub struct CliBridge {
    bin: PathBuf,
}

impl CliBridge {
    pub fn new(bin: impl Into<PathBuf>) -> Self {
        Self { bin: bin.into() }
    }

    /// Resolve o binário por `$DELONIX_BIN`, senão `delonix` no PATH.
    pub fn from_env() -> Self {
        Self::new(std::env::var("DELONIX_BIN").unwrap_or_else(|_| "delonix".into()))
    }

    /// Containers correntes: `container ps -o json`.
    pub fn containers(&self) -> Result<Vec<Workload>> {
        self.json_array(&["container", "ps", "-o", "json"])
    }

    /// Todos os containers (inclui parados): `container ps -a -o json`.
    pub fn containers_all(&self) -> Result<Vec<Workload>> {
        self.json_array(&["container", "ps", "-a", "-o", "json"])
    }

    /// Camada unificada container+VM: `workload ls -o json`.
    pub fn workloads(&self) -> Result<Vec<Workload>> {
        self.json_array(&["workload", "ls", "-o", "json"])
    }

    // Contagens por recurso para os cartões de métricas do Dashboard. Cada uma
    // é uma leitura JSON independente: quem chama decide o que fazer quando uma
    // falha (ver `LocalContext::resource_counts`, que degrada para `None`).

    /// Quantos containers correndo: `container ps -o json`.
    pub fn containers_count(&self) -> Result<usize> {
        self.count(&["container", "ps", "-o", "json"])
    }

    /// Quantos containers no total (inclui parados): `container ps -a -o json`.
    pub fn containers_total_count(&self) -> Result<usize> {
        self.count(&["container", "ps", "-a", "-o", "json"])
    }

    /// Quantos pods: `get pods -o json` (os verbos genéricos por-Kind servem a
    /// listagem; `pod` só tem lifecycle — create/logs/exec/…).
    pub fn pods_count(&self) -> Result<usize> {
        self.count(&["get", "pods", "-o", "json"])
    }

    /// Quantas imagens locais: `image ls -o json`.
    pub fn images_count(&self) -> Result<usize> {
        self.count(&["image", "ls", "-o", "json"])
    }

    /// Quantos volumes: `volume ls -o json`.
    pub fn volumes_count(&self) -> Result<usize> {
        self.count(&["volume", "ls", "-o", "json"])
    }

    /// Logs de um container (nome validado: sem espaços nem flags).
    pub fn logs(&self, name: &str) -> Result<String> {
        let name = validate_name(name)?;
        let out = self.run(&["container", "logs", name])?;
        Ok(String::from_utf8_lossy(&out).into_owned())
    }

    /// Corre um container destacado e devolve o seu id (stdout trimado).
    /// `image` e `name` validados; `cmd` passado como argumentos SEPARADOS.
    pub fn run_detached(&self, name: &str, image: &str, cmd: &[&str]) -> Result<String> {
        let name = validate_name(name)?;
        let image = validate_ref(image)?;
        let mut args = vec!["container", "run", "-d", "--name", name, image];
        args.extend_from_slice(cmd);
        let out = self.run(&args)?;
        Ok(String::from_utf8_lossy(&out).trim().to_string())
    }

    /// (Re)arranca um container parado: `container start <name>`. Distinto de
    /// `run_detached` (que cria um novo a partir de uma imagem) — este reanima
    /// um que já existe, o verbo natural do botão "Start" da lista.
    pub fn start(&self, name: &str) -> Result<()> {
        let name = validate_name(name)?;
        self.run(&["container", "start", name]).map(|_| ())
    }

    pub fn stop(&self, name: &str) -> Result<()> {
        let name = validate_name(name)?;
        self.run(&["container", "stop", name]).map(|_| ())
    }
    pub fn remove(&self, name: &str) -> Result<()> {
        let name = validate_name(name)?;
        self.run(&["container", "rm", name]).map(|_| ())
    }

    // Helpers -------------------------------------------------------------

    /// Conta os elementos de um array JSON sem os desserializar num tipo
    /// concreto — basta o comprimento para uma métrica, e cada recurso tem a
    /// sua própria forma (imagem ≠ volume ≠ container).
    fn count(&self, args: &[&str]) -> Result<usize> {
        let items: Vec<serde_json::Value> = self.json_array(args)?;
        Ok(items.len())
    }

    fn json_array<T: serde::de::DeserializeOwned>(&self, args: &[&str]) -> Result<Vec<T>> {
        let out = self.run(args)?;
        if out.iter().all(u8::is_ascii_whitespace) {
            return Ok(Vec::new());
        }
        serde_json::from_slice(&out).map_err(CoreError::Json)
    }

    fn run(&self, args: &[&str]) -> Result<Vec<u8>> {
        let output = Command::new(&self.bin)
            .args(args)
            .output()
            .map_err(|e| CoreError::Spawn {
                bin: self.bin.display().to_string(),
                source: e,
            })?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(CoreError::Cli {
                args: args.join(" "),
                code: output.status.code(),
                stderr,
            });
        }
        Ok(output.stdout)
    }
}

/// Um nome de recurso é `[A-Za-z0-9._-]+` — nunca começa por `-` (não pode ser
/// confundido com uma flag) e não contém separadores de shell.
fn validate_name(name: &str) -> Result<&str> {
    let ok = !name.is_empty()
        && !name.starts_with('-')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if ok {
        Ok(name)
    } else {
        Err(CoreError::Protocol(format!("nome inválido: {name:?}")))
    }
}

/// Uma referência de imagem permite ainda `/`, `:` e `@` (registo/tag/digest),
/// mas continua a não poder começar por `-`.
fn validate_ref(image: &str) -> Result<&str> {
    let ok = !image.is_empty()
        && !image.starts_with('-')
        && image
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '/' | ':' | '@'));
    if ok {
        Ok(image)
    } else {
        Err(CoreError::Protocol(format!(
            "referência inválida: {image:?}"
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_flag_like_names() {
        assert!(validate_name("--privileged").is_err());
        assert!(validate_name("a b").is_err());
        assert!(validate_name("x;rm -rf").is_err());
        assert!(validate_name("dd-proof").is_ok());
    }

    #[test]
    fn image_ref_allows_registry_tag_digest() {
        assert!(validate_ref("docker.io/library/busybox:latest").is_ok());
        assert!(validate_ref("ghcr.io/x/y@sha256:deadbeef").is_ok());
        assert!(validate_ref("-flag").is_err());
        assert!(validate_ref("img;evil").is_err());
    }
}
