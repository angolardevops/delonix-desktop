//! Lifecycle de VM pelo contrato de socket `delonix.node.v1` (§5).
//!
//! Este é o SEGUNDO contrato da app: ao lado da ponte CLI-JSON (src/cli.rs),
//! as VMs passam pelo `VirtualMachineService` servido em
//! `delonix serve node-api` (socket Unix 0600). Reutilizamos o
//! `delonix_desktop_core::NodeClient` (HTTP/1.1 cru sobre `UnixStream`), que
//! resolve o caminho do socket por ambiente (`NodeClient::from_env`:
//! `$DELONIX_NODE_API_ADDR` → `$XDG_RUNTIME_DIR/delonix-node.sock` →
//! `/run/delonix-node.sock`).
//!
//! O `NodeClient` é bloqueante (socket síncrono), por isso cada comando corre
//! o IO num `spawn_blocking` para não prender o runtime async do Tauri.
//!
//! A tabela (vista de Workloads) continua a listar VMs pela CLI
//! (`workload ls -o json`); ESTE módulo serve as AÇÕES de ciclo de vida, a
//! criação e os snapshots — e a leitura rica (`node_vm_get`) de uma VM.

use delonix_desktop_core::model::{Operation, SnapshotList, Vm, VmCreate, VmList};
use delonix_desktop_core::{CoreError, NodeClient};

/// Namespace default do contrato quando o frontend não o passa.
const DEFAULT_NS: &str = "default";

/// Converte um erro do core numa string acionável para a UI. Em especial, a
/// falha de ligação ao socket aponta explicitamente para o comando que o serve.
fn redact(e: CoreError) -> String {
    match e {
        CoreError::Connect { socket, .. } => format!(
            "node-api indisponível em {socket} — inicie `delonix serve node-api`"
        ),
        other => other.to_string(),
    }
}

/// Corre uma operação bloqueante do `NodeClient` fora do runtime async.
async fn on_node<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&NodeClient) -> delonix_desktop_core::Result<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || f(&NodeClient::from_env()).map_err(redact))
        .await
        .map_err(|e| format!("falha a agendar o IO do node-api: {e}"))?
}

#[tauri::command]
pub async fn node_vm_list() -> Result<VmList, String> {
    on_node(|c| c.vms()).await
}

#[tauri::command]
pub async fn node_vm_get(name: String) -> Result<Vm, String> {
    on_node(move |c| c.vm(&name)).await
}

#[tauri::command]
pub async fn node_vm_create(req: VmCreate) -> Result<Operation, String> {
    on_node(move |c| c.vm_create(&req)).await
}

#[tauri::command]
pub async fn node_vm_start(name: String) -> Result<Operation, String> {
    on_node(move |c| c.vm_start(&name)).await
}

#[tauri::command]
pub async fn node_vm_stop(name: String) -> Result<Operation, String> {
    on_node(move |c| c.vm_stop(&name)).await
}

#[tauri::command]
pub async fn node_vm_delete(name: String) -> Result<Operation, String> {
    on_node(move |c| c.vm_delete(&name)).await
}

#[tauri::command]
pub async fn node_vm_snapshot_create(name: String, snapshot: String) -> Result<Operation, String> {
    on_node(move |c| c.vm_snapshot_create(&name, &snapshot)).await
}

#[tauri::command]
pub async fn node_vm_snapshots(name: String) -> Result<SnapshotList, String> {
    on_node(move |c| c.vm_snapshots(&name)).await
}

#[tauri::command]
pub async fn node_vm_snapshot_restore(
    name: String,
    snapshot: String,
) -> Result<Operation, String> {
    on_node(move |c| c.vm_snapshot_restore(&name, &snapshot)).await
}

// --- ContainerService (`delonix.node.v1`) -----------------------------------
//
// As LEITURAS de container pelo contrato de socket, ao lado das VMs. A aba
// "Inspecionar" do detalhe (WorkloadDetail) usa `node_container` em vez de
// `workload describe` (CLI): devolve o JSON cru do contrato (meta/spec/status).
// Um 501 DX-6001 (ContainerService não servido ainda por este engine) sobe como
// erro para a UI mostrar a razão — a ponte CLI continua disponível para VMs/pods.

/// `ListContainers` — `GET /v1/namespaces/{ns}/containers`.
#[tauri::command]
pub async fn node_containers(namespace: Option<String>) -> Result<serde_json::Value, String> {
    let ns = namespace.unwrap_or_else(|| DEFAULT_NS.into());
    on_node(move |c| c.containers(&ns)).await
}

/// `GetContainer` — `GET /v1/namespaces/{ns}/containers/{name}`.
#[tauri::command]
pub async fn node_container(
    namespace: Option<String>,
    name: String,
) -> Result<serde_json::Value, String> {
    let ns = namespace.unwrap_or_else(|| DEFAULT_NS.into());
    on_node(move |c| c.container(&ns, &name)).await
}
