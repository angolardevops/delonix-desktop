//! `LocalContext` — a composição que os comandos Tauri invocam. Junta o
//! cliente do contrato (`NodeClient`) e a ponte (`CliBridge`), e aplica a
//! regra de ponte: **ler pelo contrato onde servido; cair na CLI onde não**.
//!
//! É aqui que vive a decisão "containers vêm da CLI até `ContainerService`
//! aterrar" — num único sítio, para que a UI não saiba a diferença e a
//! migração seja uma mudança de implementação, não de ecrã.

use crate::cli_bridge::CliBridge;
use crate::error::Result;
use crate::model::{ApiRoot, Health, ListProviders, NodeInfo, Workload};
use crate::node_client::NodeClient;

/// O contexto LOCAL (o runtime na própria máquina). O contexto REMOTO
/// (paas `/v2`, device-flow) é um tipo-irmão a desenhar na Fase 4.
pub struct LocalContext {
    pub node: NodeClient,
    pub cli: CliBridge,
    root_cache: Option<ApiRoot>,
}

impl LocalContext {
    pub fn new(node: NodeClient, cli: CliBridge) -> Self {
        Self {
            node,
            cli,
            root_cache: None,
        }
    }

    /// Composição por defeito a partir do ambiente.
    pub fn from_env() -> Self {
        Self::new(NodeClient::from_env(), CliBridge::from_env())
    }

    /// Lê (e cacheia) a raiz hipermédia — a fonte de verdade sobre o que o
    /// contrato serve hoje neste nó.
    pub fn api_root(&mut self) -> Result<&ApiRoot> {
        if self.root_cache.is_none() {
            self.root_cache = Some(self.node.api_root()?);
        }
        Ok(self.root_cache.as_ref().unwrap())
    }

    pub fn node_info(&self) -> Result<NodeInfo> {
        self.node.node_info()
    }
    pub fn health(&self) -> Result<Health> {
        self.node.health()
    }
    pub fn providers(&self) -> Result<ListProviders> {
        self.node.providers()
    }

    /// Containers: pela CLI enquanto `containers` não aparecer na raiz do
    /// contrato; quando aparecer, troca-se por `node.get("/v1/.../containers")`
    /// sem o chamador notar.
    pub fn containers(&mut self) -> Result<Vec<Workload>> {
        if self.api_root()?.serves("containers") {
            // Futuro: self.node.get("/v1/namespaces/default/containers")
            self.cli.containers()
        } else {
            self.cli.containers()
        }
    }

    pub fn logs(&self, container: &str) -> Result<String> {
        self.cli.logs(container)
    }
}
