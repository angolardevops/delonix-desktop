//! # delonix-desktop-core
//!
//! A camada-core do Delonix Desktop, independente da GUI. É o backend que os
//! comandos Tauri invocam — e que um binário headless (`delonix-desktop-proof`)
//! exercita por inteiro, para que a arquitectura cliente↔runtime seja provável
//! sem precisar de uma janela.
//!
//! Dois contratos, uma fronteira limpa:
//! - [`node_client::NodeClient`] — o contrato versionado `delonix.node.v1`
//!   sobre socket Unix local (leituras e, à frente, mutações/streams).
//! - [`cli_bridge::CliBridge`] — a ponte CLI-JSON (ADR-0005) para o que o
//!   contrato ainda não serve (containers/pods).
//!
//! [`context::LocalContext`] compõe os dois e decide, por recurso, qual usar —
//! para que a UI nunca saiba a diferença.

pub mod cli_bridge;
pub mod context;
pub mod error;
pub mod model;
pub mod node_client;

pub use cli_bridge::CliBridge;
pub use context::LocalContext;
pub use error::{CoreError, Result};
pub use node_client::NodeClient;
