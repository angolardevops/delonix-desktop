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

// Ações de ciclo de vida de container pelo contrato (decisão B: sem CLI). A UI
// só precisa de sucesso/erro, por isso descartamos o corpo (Container/Operation).

/// `StartContainer` — `POST .../{name}:start`.
#[tauri::command]
pub async fn node_container_start(namespace: Option<String>, name: String) -> Result<(), String> {
    let ns = namespace.unwrap_or_else(|| DEFAULT_NS.into());
    on_node(move |c| c.container_start(&ns, &name).map(|_| ())).await
}

/// `StopContainer` — `POST .../{name}:stop` (paragem graciosa).
#[tauri::command]
pub async fn node_container_stop(namespace: Option<String>, name: String) -> Result<(), String> {
    let ns = namespace.unwrap_or_else(|| DEFAULT_NS.into());
    on_node(move |c| c.container_stop(&ns, &name).map(|_| ())).await
}

/// Reiniciar (stop + start — o contrato não tem RPC Restart).
#[tauri::command]
pub async fn node_container_restart(namespace: Option<String>, name: String) -> Result<(), String> {
    let ns = namespace.unwrap_or_else(|| DEFAULT_NS.into());
    on_node(move |c| c.container_restart(&ns, &name).map(|_| ())).await
}

/// `DeleteContainer` — `DELETE .../{name}`.
#[tauri::command]
pub async fn node_container_delete(namespace: Option<String>, name: String) -> Result<(), String> {
    let ns = namespace.unwrap_or_else(|| DEFAULT_NS.into());
    on_node(move |c| c.container_delete(&ns, &name).map(|_| ())).await
}

/// Amostra de métricas de um container (`ContainerService.Stats`, gRPC) — a aba
/// de Estatísticas. Forma serializável (snake_case) do `pb::ContainerStats`; as
/// taxas (CPU, rede) são calculadas no frontend a partir de amostras sucessivas.
#[derive(serde::Serialize)]
pub struct ContainerStatsDto {
    pub cpu_usage_nanos: i64,
    pub memory_working_set_bytes: i64,
    pub memory_limit_bytes: i64,
    pub pids: i64,
    pub network_rx_bytes: i64,
    pub network_tx_bytes: i64,
    pub writable_layer_bytes: i64,
    pub unmeasured: Vec<String>,
}

/// `Stats` por gRPC (não CLI). Ao contrário das leituras unárias (HTTP/JSON do
/// NodeClient), o Stats vem pelo canal tonic do crate::grpc.
#[tauri::command]
pub async fn node_container_stats(
    namespace: Option<String>,
    name: String,
) -> Result<ContainerStatsDto, String> {
    let ns = namespace.unwrap_or_else(|| DEFAULT_NS.into());
    let s = crate::grpc::stats_once(&name, &ns).await?;
    Ok(ContainerStatsDto {
        cpu_usage_nanos: s.cpu_usage_nanos,
        memory_working_set_bytes: s.memory_working_set_bytes,
        memory_limit_bytes: s.memory_limit_bytes,
        pids: s.pids,
        network_rx_bytes: s.network_rx_bytes,
        network_tx_bytes: s.network_tx_bytes,
        writable_layer_bytes: s.writable_layer_bytes,
        unmeasured: s.unmeasured,
    })
}

// --- NetworkService / VolumeService (`delonix.node.v1`) ---------------------
//
// Leituras e mutações de rede/volume pelo contrato (decisão B: sem CLI). As
// leituras devolvem o JSON cru; a UI normaliza e reconstrói membros/usedBy
// cruzando com os containers. O `network diagnose` NÃO tem serviço node.v1 —
// fica na ponte CLI.

/// `ListNetworks` — `GET /v1/namespaces/{ns}/networks`.
#[tauri::command]
pub async fn node_networks(namespace: Option<String>) -> Result<serde_json::Value, String> {
    let ns = namespace.unwrap_or_else(|| DEFAULT_NS.into());
    on_node(move |c| c.networks(&ns)).await
}

/// `GetNetwork` — `GET /v1/namespaces/{ns}/networks/{name}`.
#[tauri::command]
pub async fn node_network(
    namespace: Option<String>,
    name: String,
) -> Result<serde_json::Value, String> {
    let ns = namespace.unwrap_or_else(|| DEFAULT_NS.into());
    on_node(move |c| c.network(&ns, &name)).await
}

/// `CreateNetwork` — `POST .../networks`. `driver` → topologia do contrato
/// (bridge/overlay); `subnet` vazio = alocado.
#[tauri::command]
pub async fn node_network_create(
    namespace: Option<String>,
    name: String,
    driver: Option<String>,
    subnet: Option<String>,
) -> Result<(), String> {
    let ns = namespace.unwrap_or_else(|| DEFAULT_NS.into());
    let topology = match driver.as_deref() {
        Some("overlay") => "NETWORK_TOPOLOGY_OVERLAY",
        _ => "NETWORK_TOPOLOGY_BRIDGE",
    };
    let subnet = subnet.unwrap_or_default();
    on_node(move |c| c.network_create(&ns, &name, topology, &subnet).map(|_| ())).await
}

/// `DeleteNetwork` — `DELETE .../networks/{name}`.
#[tauri::command]
pub async fn node_network_delete(namespace: Option<String>, name: String) -> Result<(), String> {
    let ns = namespace.unwrap_or_else(|| DEFAULT_NS.into());
    on_node(move |c| c.network_delete(&ns, &name).map(|_| ())).await
}

/// `ConnectContainer` — `POST .../networks/{network}:connect`.
#[tauri::command]
pub async fn node_network_connect(
    namespace: Option<String>,
    network: String,
    container: String,
) -> Result<(), String> {
    let ns = namespace.unwrap_or_else(|| DEFAULT_NS.into());
    on_node(move |c| c.network_connect(&ns, &network, &container).map(|_| ())).await
}

/// `DisconnectContainer` — `POST .../networks/{network}:disconnect`.
#[tauri::command]
pub async fn node_network_disconnect(
    namespace: Option<String>,
    network: String,
    container: String,
) -> Result<(), String> {
    let ns = namespace.unwrap_or_else(|| DEFAULT_NS.into());
    on_node(move |c| c.network_disconnect(&ns, &network, &container).map(|_| ())).await
}

/// `ListVolumes` — `GET /v1/namespaces/{ns}/volumes`.
#[tauri::command]
pub async fn node_volumes(namespace: Option<String>) -> Result<serde_json::Value, String> {
    let ns = namespace.unwrap_or_else(|| DEFAULT_NS.into());
    on_node(move |c| c.volumes(&ns)).await
}

/// `CreateVolume` — `POST .../volumes` (source local por omissão).
#[tauri::command]
pub async fn node_volume_create(namespace: Option<String>, name: String) -> Result<(), String> {
    let ns = namespace.unwrap_or_else(|| DEFAULT_NS.into());
    on_node(move |c| c.volume_create(&ns, &name).map(|_| ())).await
}

/// `DeleteVolume` — `DELETE .../volumes/{name}`.
#[tauri::command]
pub async fn node_volume_delete(namespace: Option<String>, name: String) -> Result<(), String> {
    let ns = namespace.unwrap_or_else(|| DEFAULT_NS.into());
    on_node(move |c| c.volume_delete(&ns, &name).map(|_| ())).await
}

// --- ImageService (`delonix.node.v1`, node-wide) ----------------------------
//
// Imagens não são namespaced. Pull/Delete devolvem uma Operation (já terminal,
// pois o engine corre a pull síncrona) — a UI inspeciona o estado/erro.

/// `ListImages` — `GET /v1/images`.
#[tauri::command]
pub async fn node_images() -> Result<serde_json::Value, String> {
    on_node(|c| c.images()).await
}

/// `PullImage` — `POST /v1/images:pull`. `platform` vazio = host.
#[tauri::command]
pub async fn node_image_pull(
    reference: String,
    platform: Option<String>,
) -> Result<serde_json::Value, String> {
    let platform = platform.unwrap_or_default();
    on_node(move |c| c.image_pull(&reference, &platform)).await
}

/// `DeleteImage` — `POST /v1/images:delete`.
#[tauri::command]
pub async fn node_image_delete(reference: String) -> Result<serde_json::Value, String> {
    on_node(move |c| c.image_delete(&reference)).await
}

// --- PodService (`delonix.node.v1`) -----------------------------------------
//
// Só leitura: os pods são derivados dos containers no engine. A lista Workloads
// funde-os com os containers.

/// `ListPods` — `GET /v1/namespaces/{ns}/pods`.
#[tauri::command]
pub async fn node_pods(namespace: Option<String>) -> Result<serde_json::Value, String> {
    let ns = namespace.unwrap_or_else(|| DEFAULT_NS.into());
    on_node(move |c| c.pods(&ns)).await
}

/// `DeletePod` — `DELETE /v1/namespaces/{ns}/pods/{name}`. `name` é o id
/// `pod-<nome>` do ListPods; `force` remove um pod a correr.
#[tauri::command]
pub async fn node_pod_delete(
    name: String,
    namespace: Option<String>,
    force: Option<bool>,
) -> Result<serde_json::Value, String> {
    let ns = namespace.unwrap_or_else(|| DEFAULT_NS.into());
    let force = force.unwrap_or(false);
    on_node(move |c| c.pod_delete(&ns, &name, force)).await
}

// --- StackService (`delonix.node.v1`) ---------------------------------------
//
// O manifesto vive num ficheiro no host (o Studio grava-o antes). O comando
// lê-o aqui e passa os bytes ao core (que os base64-encoda). Plan devolve um
// StackPlan; apply/destroy uma Operation já terminal (sem progresso ao vivo).

/// Lê o manifesto do caminho e deriva o nome do stack do nome do ficheiro.
fn read_manifest(path: &str) -> Result<(String, Vec<u8>), String> {
    let bytes = std::fs::read(path).map_err(|e| format!("a ler o manifesto {path}: {e}"))?;
    let stack = std::path::Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("stack")
        .to_string();
    Ok((stack, bytes))
}

/// `PlanStack` — `POST /v1/stacks/{stack}:plan`.
#[tauri::command]
pub async fn node_stack_plan(
    path: String,
    prune: Option<bool>,
) -> Result<serde_json::Value, String> {
    let (stack, manifest) = read_manifest(&path)?;
    let prune = prune.unwrap_or(false);
    on_node(move |c| c.stack_plan(&stack, &manifest, prune)).await
}

/// `ApplyStack` — `POST /v1/stacks/{stack}:apply`.
#[tauri::command]
pub async fn node_stack_apply(
    path: String,
    prune: Option<bool>,
    replace: Option<Vec<String>>,
) -> Result<serde_json::Value, String> {
    let (stack, manifest) = read_manifest(&path)?;
    let prune = prune.unwrap_or(false);
    let replace = replace.unwrap_or_default();
    on_node(move |c| c.stack_apply(&stack, &manifest, prune, &replace)).await
}

/// `DestroyStack` — `POST /v1/stacks/{stack}:destroy`.
#[tauri::command]
pub async fn node_stack_destroy(path: String) -> Result<serde_json::Value, String> {
    let (stack, manifest) = read_manifest(&path)?;
    on_node(move |c| c.stack_destroy(&stack, &manifest)).await
}
