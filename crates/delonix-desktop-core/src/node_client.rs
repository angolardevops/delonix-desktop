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
use crate::model::{
    ApiRoot, Health, ListProviders, NodeInfo, Operation, Snapshot, SnapshotList, Vm, VmCreate,
    VmList,
};

/// O namespace de isolamento por defeito do contrato (empty = `default`). A
/// vista de VM do desktop trabalha neste namespace; `*` (todos) é uma extensão
/// futura da UI.
const DEFAULT_NS: &str = "default";

// --- Construtores de caminho REST (puros, testados) -------------------------
//
// Espelham as anotações `google.api.http` de `VirtualMachineService` em
// `proto/delonix/node/v1/compute.proto`. Os nomes de VM/snapshot do engine são
// DNS-like (sem `:`/`/`/espaços — o `transcode` recusaria um `:` no valor de um
// `{var}` simples), por isso não são percent-encoded aqui.

/// `.../virtualmachines` — List (GET) e Create (POST).
fn vm_collection(ns: &str) -> String {
    format!("/v1/namespaces/{ns}/virtualmachines")
}
/// `.../virtualmachines/{name}` — Get (GET) e Delete (DELETE).
fn vm_resource(ns: &str, name: &str) -> String {
    format!("/v1/namespaces/{ns}/virtualmachines/{name}")
}
/// `.../virtualmachines/{name}:{verb}` — Start/Stop/Pause/Resume (POST).
fn vm_verb(ns: &str, name: &str, verb: &str) -> String {
    format!("/v1/namespaces/{ns}/virtualmachines/{name}:{verb}")
}
/// `.../virtualmachines/{vm}/snapshots` — ListSnapshots (GET) e Create (POST).
fn snapshot_collection(ns: &str, vm: &str) -> String {
    format!("/v1/namespaces/{ns}/virtualmachines/{vm}/snapshots")
}
/// `.../snapshots/{snapshot}:restore` — RestoreSnapshot (POST).
fn snapshot_restore(ns: &str, vm: &str, snapshot: &str) -> String {
    format!("/v1/namespaces/{ns}/virtualmachines/{vm}/snapshots/{snapshot}:restore")
}

// Rotas de `ContainerService` (`delonix.node.v1`). As leituras de container
// (List/Get) partilham o mesmo transporte HTTP/JSON das VMs; o streaming de
// Logs (gRPC) é um transporte à parte no crate do desktop. Os nomes de
// container do engine são DNS-like (sem `:`/`/`), por isso não são
// percent-encoded, tal como os de VM.

/// `.../containers` — ListContainers (GET).
fn container_collection(ns: &str) -> String {
    format!("/v1/namespaces/{ns}/containers")
}
/// `.../containers/{name}` — GetContainer (GET) e DeleteContainer (DELETE).
fn container_resource(ns: &str, name: &str) -> String {
    format!("/v1/namespaces/{ns}/containers/{name}")
}
/// `.../containers/{name}:{verb}` — Start/Stop/Kill (POST).
fn container_verb(ns: &str, name: &str, verb: &str) -> String {
    format!("/v1/namespaces/{ns}/containers/{name}:{verb}")
}

// Rotas de `NetworkService` e `VolumeService` (`delonix.node.v1`). Mesmo
// transporte HTTP/JSON das VMs/containers.

/// `.../networks` — ListNetworks (GET) e CreateNetwork (POST).
fn network_collection(ns: &str) -> String {
    format!("/v1/namespaces/{ns}/networks")
}
/// `.../networks/{name}` — GetNetwork (GET) e DeleteNetwork (DELETE).
fn network_resource(ns: &str, name: &str) -> String {
    format!("/v1/namespaces/{ns}/networks/{name}")
}
/// `.../networks/{network}:{verb}` — ConnectContainer/DisconnectContainer (POST).
fn network_verb(ns: &str, network: &str, verb: &str) -> String {
    format!("/v1/namespaces/{ns}/networks/{network}:{verb}")
}
/// `.../volumes` — ListVolumes (GET) e CreateVolume (POST).
fn volume_collection(ns: &str) -> String {
    format!("/v1/namespaces/{ns}/volumes")
}
/// `.../volumes/{name}` — GetVolume (GET) e DeleteVolume (DELETE).
fn volume_resource(ns: &str, name: &str) -> String {
    format!("/v1/namespaces/{ns}/volumes/{name}")
}

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

    /// POST tipado de um corpo JSON, desserializando a resposta. Uma resposta
    /// 2xx de corpo vazio (algum endpoint pode não devolver `Operation`) é lida
    /// como `{}` — os campos opcionais dos DTOs degradam para o default.
    pub fn post<T: DeserializeOwned>(&self, path: &str, body: &[u8]) -> Result<T> {
        self.recv_typed("POST", path, Some(body))
    }

    /// DELETE tipado (sem corpo de pedido). Mesma tolerância a corpo de resposta
    /// vazio que [`Self::post`].
    pub fn delete<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        self.recv_typed("DELETE", path, None)
    }

    fn recv_typed<T: DeserializeOwned>(
        &self,
        method: &str,
        path: &str,
        body: Option<&[u8]>,
    ) -> Result<T> {
        let raw = self.send(method, path, body)?;
        let bytes: &[u8] = if raw.iter().all(u8::is_ascii_whitespace) {
            b"{}"
        } else {
            &raw
        };
        serde_json::from_slice(bytes).map_err(CoreError::Json)
    }

    // --- VirtualMachineService (`delonix.node.v1` §5) -----------------------

    /// `ListVirtualMachines` — `GET /v1/namespaces/{ns}/virtualmachines`.
    pub fn vms(&self) -> Result<VmList> {
        self.get(&vm_collection(DEFAULT_NS))
    }
    /// `GetVirtualMachine` — `GET /v1/namespaces/{ns}/virtualmachines/{name}`.
    pub fn vm(&self, name: &str) -> Result<Vm> {
        self.get(&vm_resource(DEFAULT_NS, name))
    }
    /// `CreateVirtualMachine` — `POST /v1/namespaces/{ns}/virtualmachines` (body `*`).
    pub fn vm_create(&self, req: &VmCreate) -> Result<Operation> {
        let body = serde_json::to_vec(req).map_err(CoreError::Json)?;
        self.post(&vm_collection(DEFAULT_NS), &body)
    }
    /// `StartVirtualMachine` — `POST .../{name}:start` (body `*`).
    pub fn vm_start(&self, name: &str) -> Result<Operation> {
        self.post(&vm_verb(DEFAULT_NS, name, "start"), b"{}")
    }
    /// `StopVirtualMachine` — `POST .../{name}:stop` (body `*`). Mantém o disco
    /// (destruir é [`Self::vm_delete`]).
    pub fn vm_stop(&self, name: &str) -> Result<Operation> {
        self.post(&vm_verb(DEFAULT_NS, name, "stop"), b"{}")
    }
    /// `DeleteVirtualMachine` — `DELETE .../{name}`.
    pub fn vm_delete(&self, name: &str) -> Result<Operation> {
        self.delete(&vm_resource(DEFAULT_NS, name))
    }
    /// `CreateSnapshot` — `POST .../{vm}/snapshots` (body `*`, `{snapshot}` no corpo).
    pub fn vm_snapshot_create(&self, name: &str, snapshot: &str) -> Result<Operation> {
        let body = serde_json::json!({ "snapshot": snapshot });
        let body = serde_json::to_vec(&body).map_err(CoreError::Json)?;
        self.post(&snapshot_collection(DEFAULT_NS, name), &body)
    }
    /// `ListSnapshots` — `GET .../{vm}/snapshots`.
    pub fn vm_snapshots(&self, name: &str) -> Result<SnapshotList> {
        self.get(&snapshot_collection(DEFAULT_NS, name))
    }
    /// `RestoreSnapshot` — `POST .../{vm}/snapshots/{snapshot}:restore` (body `*`).
    pub fn vm_snapshot_restore(&self, name: &str, snapshot: &str) -> Result<Operation> {
        self.post(&snapshot_restore(DEFAULT_NS, name, snapshot), b"{}")
    }

    // --- ContainerService (`delonix.node.v1`) -------------------------------
    //
    // Leituras (List/Get) pelo mesmo transporte HTTP/JSON das VMs. Devolvem o
    // JSON CRU do contrato (meta/spec/status): a UI serializa-o na aba
    // "Inspecionar" sem um DTO tipado — o contrato de container é mais largo que
    // a `WorkloadRow` e a aba mostra-o tal como vem. Um 501 DX-6001
    // (ContainerService não servido) sobe como `CoreError::Http { status: 501 }`.

    /// `ListContainers` — `GET /v1/namespaces/{ns}/containers`.
    pub fn containers(&self, ns: &str) -> Result<serde_json::Value> {
        self.get_raw(&container_collection(ns))
    }
    /// `GetContainer` — `GET /v1/namespaces/{ns}/containers/{name}`.
    pub fn container(&self, ns: &str, name: &str) -> Result<serde_json::Value> {
        self.get_raw(&container_resource(ns, name))
    }
    /// `StartContainer` — `POST .../{name}:start` (body `*`). Devolve o Container.
    pub fn container_start(&self, ns: &str, name: &str) -> Result<serde_json::Value> {
        self.post(&container_verb(ns, name, "start"), b"{}")
    }
    /// `StopContainer` — `POST .../{name}:stop` (body `*`). Paragem graciosa.
    pub fn container_stop(&self, ns: &str, name: &str) -> Result<serde_json::Value> {
        self.post(&container_verb(ns, name, "stop"), b"{}")
    }
    /// `KillContainer` — `POST .../{name}:kill` (body `*`). SIGKILL imediato.
    pub fn container_kill(&self, ns: &str, name: &str) -> Result<serde_json::Value> {
        self.post(&container_verb(ns, name, "kill"), b"{}")
    }
    /// `DeleteContainer` — `DELETE .../{name}`. Devolve uma Operation.
    pub fn container_delete(&self, ns: &str, name: &str) -> Result<serde_json::Value> {
        self.delete(&container_resource(ns, name))
    }
    /// Reiniciar: o ContainerService não tem RPC `Restart`; compõe-se de
    /// `StopContainer` seguido de `StartContainer` (como o `delonix restart`).
    pub fn container_restart(&self, ns: &str, name: &str) -> Result<serde_json::Value> {
        self.container_stop(ns, name)?;
        self.container_start(ns, name)
    }

    // --- NetworkService (`delonix.node.v1`) ---------------------------------
    //
    // Leituras cruas (meta/spec/conditions). A UI normaliza; os MEMBROS de uma
    // rede (containers ligados, com IP) NÃO vêm aqui — reconstroem-se cruzando
    // com os containers (`spec.networks[].ipv4_address`), no frontend.

    /// `ListNetworks` — `GET /v1/namespaces/{ns}/networks`.
    pub fn networks(&self, ns: &str) -> Result<serde_json::Value> {
        self.get_raw(&network_collection(ns))
    }
    /// `GetNetwork` — `GET /v1/namespaces/{ns}/networks/{name}`.
    pub fn network(&self, ns: &str, name: &str) -> Result<serde_json::Value> {
        self.get_raw(&network_resource(ns, name))
    }
    /// `CreateNetwork` — `POST .../networks` (body `{name, spec}`). `topology` é o
    /// nome do enum proto3 JSON (ex. `NETWORK_TOPOLOGY_BRIDGE`); `ipv4_cidr` vazio
    /// = alocado pelo provider.
    pub fn network_create(
        &self,
        ns: &str,
        name: &str,
        topology: &str,
        ipv4_cidr: &str,
    ) -> Result<serde_json::Value> {
        let mut spec = serde_json::json!({ "topology": topology });
        if !ipv4_cidr.is_empty() {
            spec["ipv4_cidr"] = serde_json::json!(ipv4_cidr);
        }
        let body = serde_json::json!({ "name": name, "spec": spec });
        let body = serde_json::to_vec(&body).map_err(CoreError::Json)?;
        self.post(&network_collection(ns), &body)
    }
    /// `DeleteNetwork` — `DELETE .../networks/{name}`.
    pub fn network_delete(&self, ns: &str, name: &str) -> Result<serde_json::Value> {
        self.delete(&network_resource(ns, name))
    }
    /// `ConnectContainer` — `POST .../networks/{network}:connect` (body `*`).
    pub fn network_connect(
        &self,
        ns: &str,
        network: &str,
        container: &str,
    ) -> Result<serde_json::Value> {
        let body =
            serde_json::json!({ "network": network, "container": container, "namespace": ns });
        let body = serde_json::to_vec(&body).map_err(CoreError::Json)?;
        self.post(&network_verb(ns, network, "connect"), &body)
    }
    /// `DisconnectContainer` — `POST .../networks/{network}:disconnect` (body `*`).
    pub fn network_disconnect(
        &self,
        ns: &str,
        network: &str,
        container: &str,
    ) -> Result<serde_json::Value> {
        let body =
            serde_json::json!({ "network": network, "container": container, "namespace": ns });
        let body = serde_json::to_vec(&body).map_err(CoreError::Json)?;
        self.post(&network_verb(ns, network, "disconnect"), &body)
    }

    // --- VolumeService (`delonix.node.v1`) ----------------------------------
    //
    // A LISTA não mede o tamanho (rootless: os diretórios pertencem a outro uid;
    // ver condition UsageMeasured) nem lista quem monta cada volume — o `usedBy`
    // reconstrói-se cruzando com os containers (`spec.mounts[].volume`).

    /// `ListVolumes` — `GET /v1/namespaces/{ns}/volumes`.
    pub fn volumes(&self, ns: &str) -> Result<serde_json::Value> {
        self.get_raw(&volume_collection(ns))
    }
    /// `GetVolume` — `GET /v1/namespaces/{ns}/volumes/{name}`.
    pub fn volume(&self, ns: &str, name: &str) -> Result<serde_json::Value> {
        self.get_raw(&volume_resource(ns, name))
    }
    /// `CreateVolume` — `POST .../volumes` (body `{name}`; o source local é o default).
    pub fn volume_create(&self, ns: &str, name: &str) -> Result<serde_json::Value> {
        let body = serde_json::json!({ "name": name });
        let body = serde_json::to_vec(&body).map_err(CoreError::Json)?;
        self.post(&volume_collection(ns), &body)
    }
    /// `DeleteVolume` — `DELETE .../volumes/{name}`.
    pub fn volume_delete(&self, ns: &str, name: &str) -> Result<serde_json::Value> {
        self.delete(&volume_resource(ns, name))
    }

    /// GET/DELETE sem corpo de pedido (compat com os leitores existentes).
    fn request(&self, method: &str, path: &str) -> Result<Vec<u8>> {
        self.send(method, path, None)
    }

    /// HTTP/1.1 mínimo sobre o socket, `Connection: close`. Com `body`, anexa
    /// `Content-Type: application/json` + `Content-Length` e escreve o corpo.
    /// Devolve o corpo da resposta (bytes). Erros do servidor viram
    /// `CoreError::Http` com o problema RFC 9457 anexado quando presente.
    fn send(&self, method: &str, path: &str, body: Option<&[u8]>) -> Result<Vec<u8>> {
        let mut stream = UnixStream::connect(&self.socket).map_err(|e| CoreError::Connect {
            socket: self.socket.display().to_string(),
            source: e,
        })?;
        stream.set_read_timeout(Some(self.timeout)).ok();
        stream.set_write_timeout(Some(self.timeout)).ok();

        let mut req = format!(
            "{method} {path} HTTP/1.1\r\nHost: localhost\r\nAccept: application/json\r\nConnection: close\r\n"
        );
        if let Some(b) = body {
            req.push_str(&format!(
                "Content-Type: application/json\r\nContent-Length: {}\r\n",
                b.len()
            ));
        }
        req.push_str("\r\n");
        stream.write_all(req.as_bytes()).map_err(CoreError::Io)?;
        if let Some(b) = body {
            stream.write_all(b).map_err(CoreError::Io)?;
        }

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
    haystack.windows(needle.len()).position(|w| w == needle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{VmNetworkAttachment, VmSpec};

    #[test]
    fn vm_routes_match_the_contract_templates() {
        // Fonte: `google.api.http` de VirtualMachineService em
        // proto/delonix/node/v1/compute.proto.
        assert_eq!(
            vm_collection("default"),
            "/v1/namespaces/default/virtualmachines"
        );
        assert_eq!(
            vm_resource("default", "web"),
            "/v1/namespaces/default/virtualmachines/web"
        );
        assert_eq!(
            vm_verb("default", "web", "start"),
            "/v1/namespaces/default/virtualmachines/web:start"
        );
        assert_eq!(
            vm_verb("default", "web", "stop"),
            "/v1/namespaces/default/virtualmachines/web:stop"
        );
        assert_eq!(
            snapshot_collection("default", "web"),
            "/v1/namespaces/default/virtualmachines/web/snapshots"
        );
        assert_eq!(
            snapshot_restore("default", "web", "nightly"),
            "/v1/namespaces/default/virtualmachines/web/snapshots/nightly:restore"
        );
    }

    #[test]
    fn container_routes_match_the_contract_templates() {
        // Fonte: `google.api.http` de ContainerService em
        // proto/delonix/node/v1/compute.proto (List/Get).
        assert_eq!(
            container_collection("default"),
            "/v1/namespaces/default/containers"
        );
        assert_eq!(
            container_resource("default", "odoo-16"),
            "/v1/namespaces/default/containers/odoo-16"
        );
        assert_eq!(
            container_verb("default", "odoo-16", "start"),
            "/v1/namespaces/default/containers/odoo-16:start"
        );
        assert_eq!(
            container_verb("default", "odoo-16", "stop"),
            "/v1/namespaces/default/containers/odoo-16:stop"
        );
        assert_eq!(
            container_verb("default", "odoo-16", "kill"),
            "/v1/namespaces/default/containers/odoo-16:kill"
        );
    }

    #[test]
    fn network_and_volume_routes_match_the_contract_templates() {
        // Fonte: `google.api.http` de NetworkService/VolumeService em infra.proto.
        assert_eq!(
            network_collection("default"),
            "/v1/namespaces/default/networks"
        );
        assert_eq!(
            network_resource("default", "edge"),
            "/v1/namespaces/default/networks/edge"
        );
        assert_eq!(
            network_verb("default", "edge", "connect"),
            "/v1/namespaces/default/networks/edge:connect"
        );
        assert_eq!(
            volume_collection("default"),
            "/v1/namespaces/default/volumes"
        );
        assert_eq!(
            volume_resource("default", "pgdata"),
            "/v1/namespaces/default/volumes/pgdata"
        );
    }

    #[test]
    fn parses_a_list_response_with_proto3_json_int64_as_string() {
        // Forma REAL: `preserve_proto_field_names()` (snake_case) e `int64`
        // (memory_bytes/disk_bytes) como STRING.
        let raw = r#"{
          "virtual_machines": [
            {
              "meta": {"name": "web", "namespace": "default"},
              "spec": {
                "image": "ubuntu.qcow2", "vcpus": 2,
                "memory_bytes": "2147483648", "disk_bytes": "0",
                "networks": [{"network": "ingress", "ipv4_address": "10.0.0.2"}],
                "provider": "cloud-hypervisor"
              },
              "status": {
                "phase": "VIRTUAL_MACHINE_PHASE_RUNNING", "provider": "cloud-hypervisor",
                "ip_addresses": ["10.0.0.2"], "ip_predicted": false
              }
            }
          ],
          "page": {"next_page_token": ""}
        }"#;
        let list: VmList = serde_json::from_str(raw).unwrap();
        assert_eq!(list.virtual_machines.len(), 1);
        let vm = &list.virtual_machines[0];
        assert_eq!(vm.meta.name, "web");
        assert_eq!(vm.spec.vcpus, 2);
        assert_eq!(vm.spec.memory_bytes, 2_147_483_648);
        assert_eq!(vm.spec.networks[0].network, "ingress");
        assert_eq!(vm.status.phase, "VIRTUAL_MACHINE_PHASE_RUNNING");
        assert!(!vm.status.ip_predicted);
    }

    #[test]
    fn parses_a_snapshot_list() {
        let raw = r#"{"snapshots":[{"name":"nightly","includes_memory":true,"state":"running"}]}"#;
        let list: SnapshotList = serde_json::from_str(raw).unwrap();
        assert_eq!(list.snapshots[0].name, "nightly");
        assert!(list.snapshots[0].includes_memory);
    }

    #[test]
    fn create_body_sends_int64_as_string_and_omits_namespace() {
        let req = VmCreate {
            name: "web".into(),
            spec: VmSpec {
                image: "ubuntu.qcow2".into(),
                vcpus: 2,
                memory_bytes: 2_147_483_648,
                disk_bytes: 10_737_418_240,
                networks: vec![VmNetworkAttachment {
                    network: "ingress".into(),
                    ipv4_address: String::new(),
                }],
                provider: String::new(),
            },
        };
        let v = serde_json::to_value(&req).unwrap();
        // int64 como STRING (proto3 JSON); o namespace NÃO vai no corpo.
        assert_eq!(v["spec"]["memory_bytes"], serde_json::json!("2147483648"));
        assert_eq!(v["spec"]["disk_bytes"], serde_json::json!("10737418240"));
        assert_eq!(v["spec"]["vcpus"], serde_json::json!(2));
        assert!(v.get("namespace").is_none());
        // ipv4_address vazio é omitido; provider vazio é omitido.
        assert!(v["spec"]["networks"][0].get("ipv4_address").is_none());
        assert!(v["spec"].get("provider").is_none());
    }

    #[test]
    fn create_body_accepts_int64_as_number_on_read_back() {
        // O invoke do Tauri entrega números JS; o DTO tem de os aceitar.
        let v = serde_json::json!({
            "name": "web",
            "spec": {"image": "u.qcow2", "vcpus": 1, "memory_bytes": 1024, "disk_bytes": 0}
        });
        let req: VmCreate = serde_json::from_value(v).unwrap();
        assert_eq!(req.spec.memory_bytes, 1024);
    }
}
