//! DTOs do contrato `delonix.node.v1` e da ponte CLI-JSON.
//!
//! Modelados a partir das respostas REAIS observadas no host de prova
//! (ver `reports/2026-10-24-linux-vertical-slice.md`). Campos opcionais e
//! `#[serde(default)]` em todo o lado: o contrato cresce por fatias
//! (ADR-0042) e um cliente tem de tolerar formas em evolução sem partir.

use serde::{Deserialize, Serialize};

/// Um link hipermédia da raiz / dos recursos do node-api.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Link {
    #[serde(default)]
    pub rel: String,
    #[serde(default)]
    pub href: String,
    #[serde(default)]
    pub method: String,
}

/// `GET /v1` — a raiz hipermédia. Anuncia só os recursos SERVIDOS hoje.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ApiRoot {
    #[serde(default)]
    pub api_version: String,
    #[serde(default)]
    pub links: Vec<Link>,
}

impl ApiRoot {
    /// Há um recurso servido com este `rel`? (feature-gating pela raiz).
    pub fn serves(&self, rel: &str) -> bool {
        self.links.iter().any(|l| l.rel == rel)
    }
}

/// `GET /v1/node` — identidade e forma do nó.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NodeInfo {
    #[serde(default)]
    pub arch: String,
    #[serde(default)]
    pub rootless: bool,
    #[serde(default)]
    pub cgroup_delegated: bool,
    #[serde(default)]
    pub cgroup_driver: String,
    #[serde(default)]
    pub engine_version: String,
    #[serde(default)]
    pub engine_commit: String,
    #[serde(default)]
    pub hostname: String,
    #[serde(default)]
    pub kernel: String,
    #[serde(default)]
    pub supported_workload_types: Vec<String>,
}

/// Uma condição estilo Kubernetes (`GET /v1/node/health` traz `conditions`).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Condition {
    #[serde(rename = "type", default)]
    pub kind: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub reason: String,
    #[serde(default)]
    pub message: String,
}

impl Condition {
    pub fn is_true(&self) -> bool {
        self.status == "CONDITION_STATUS_TRUE"
    }
}

/// `GET /v1/node/health`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Health {
    #[serde(default)]
    pub conditions: Vec<Condition>,
}

/// Os estados de capability do catálogo (ADR-0050). **SEIS** estados — medido
/// ao vivo, não cinco: `requires-external-component` existe no host de prova.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CapabilityState {
    #[serde(rename = "supported")]
    Supported,
    #[serde(rename = "partial")]
    Partial,
    #[serde(rename = "not-implemented")]
    NotImplemented,
    #[serde(rename = "unsupported-by-provider")]
    UnsupportedByProvider,
    #[serde(rename = "requires-external-component")]
    RequiresExternalComponent,
    #[serde(rename = "unavailable-on-host")]
    UnavailableOnHost,
    /// Qualquer estado novo que o catálogo venha a declarar: o cliente degrada
    /// em vez de partir (o contrato evolui — ADR-0042).
    #[serde(other)]
    Unknown,
}

impl CapabilityState {
    /// A UI deve oferecer esta capability como accionável?
    /// Só `Supported` é affordance plena; tudo o resto é informativo/bloqueado.
    pub fn is_actionable(&self) -> bool {
        matches!(self, CapabilityState::Supported)
    }
}

/// Uma capability declarada/medida por um provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Capability {
    #[serde(default)]
    pub name: String,
    pub state: CapabilityState,
    #[serde(default)]
    pub supported: bool,
    #[serde(default)]
    pub detail: String,
}

/// Um provider e o seu conjunto de capabilities (`GET /v1/providers`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provider {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub available: bool,
    #[serde(default)]
    pub catalog_version: String,
    #[serde(default)]
    pub health: Condition,
    #[serde(default)]
    pub capabilities: Vec<Capability>,
}

/// `GET /v1/providers`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ListProviders {
    #[serde(default)]
    pub providers: Vec<Provider>,
}

impl ListProviders {
    /// Contagem por estado — a base do feature-gating honesto da UI.
    pub fn state_histogram(&self) -> std::collections::BTreeMap<String, usize> {
        let mut h = std::collections::BTreeMap::new();
        for p in &self.providers {
            for c in &p.capabilities {
                *h.entry(format!("{:?}", c.state)).or_insert(0) += 1;
            }
        }
        h
    }
}

/// Um workload da ponte CLI-JSON (`container ps -o json`, `workload ls -o json`).
/// Os campos variam entre comandos; tudo opcional, tolerante por desenho.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Workload {
    #[serde(rename = "type", default)]
    pub kind: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub image: String,
    #[serde(default)]
    pub info: String,
    #[serde(default)]
    pub namespace: String,
}

impl Workload {
    /// Estado de apresentação, venha ele de `status` ou `state`.
    pub fn display_status(&self) -> &str {
        if !self.status.is_empty() {
            &self.status
        } else {
            &self.state
        }
    }
}

/// Uma imagem local da ponte CLI-JSON (`image ls -o json`). Forma própria
/// (ADR-0005 do runtime) — NÃO é um [`Workload`]: identifica-se pelo digest
/// (`id`), traz as suas tags (`repo_tags`, vazio = «sem tag»/órfã), o tamanho
/// em bytes e o instante de criação (epoch). Tudo opcional e tolerante: o
/// contrato cresce por fatias (ADR-0042).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Image {
    #[serde(default)]
    pub repo_tags: Vec<String>,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub created_unix: i64,
    #[serde(default)]
    pub size_bytes: u64,
    #[serde(default)]
    pub orphan: bool,
}

// ---------------------------------------------------------------------------
// VirtualMachineService (`delonix.node.v1`) — tipos de req/resp mínimos.
//
// A codificação REST do contrato usa `preserve_proto_field_names()` (ver
// `crates/interfaces/delonix-node-api/build.rs`): o JSON na linha traz os
// nomes de campo do proto em snake_case — logo o default do serde já casa, sem
// `rename_all`. Os campos `int64` do proto3 (`memory_bytes`/`disk_bytes`) vêm
// como STRING no JSON (regra do proto3 JSON); [`i64_str`] serializa como string
// (o que o engine aceita na criação) e desserializa de string OU número.

/// `i64` <-> JSON string (a forma canónica do proto3 JSON para `int64`).
mod i64_str {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(v: &i64, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&v.to_string())
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<i64, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum NumOrStr {
            Num(i64),
            Str(String),
        }
        match NumOrStr::deserialize(d)? {
            NumOrStr::Num(n) => Ok(n),
            NumOrStr::Str(s) if s.is_empty() => Ok(0),
            NumOrStr::Str(s) => s.parse().map_err(serde::de::Error::custom),
        }
    }
}

/// Um anexo de rede do `VirtualMachineSpec`. Só `network` é enviado na criação;
/// a leitura traz também `ipv4_address` (campos extra do contrato são ignorados).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VmNetworkAttachment {
    #[serde(default)]
    pub network: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub ipv4_address: String,
}

/// `VirtualMachineSpec` — usado na criação (enviar) e na leitura (receber).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VmSpec {
    #[serde(default)]
    pub image: String,
    #[serde(default)]
    pub vcpus: i64,
    #[serde(default, with = "i64_str")]
    pub memory_bytes: i64,
    #[serde(default, with = "i64_str")]
    pub disk_bytes: i64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub networks: Vec<VmNetworkAttachment>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub provider: String,
}

/// `ResourceMeta` reduzido ao que a UI mostra (nome e namespace).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VmMeta {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub namespace: String,
}

/// `VirtualMachineStatus`. `phase` é o nome do enum tal como o proto3 JSON o
/// serializa (ex.: `VIRTUAL_MACHINE_PHASE_RUNNING`).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VmStatus {
    #[serde(default)]
    pub phase: String,
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub ip_addresses: Vec<String>,
    #[serde(default)]
    pub ip_predicted: bool,
}

/// Uma VM do contrato (`GET .../virtualmachines/{name}`).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Vm {
    #[serde(default)]
    pub meta: VmMeta,
    #[serde(default)]
    pub spec: VmSpec,
    #[serde(default)]
    pub status: VmStatus,
}

/// `ListVirtualMachinesResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VmList {
    #[serde(default)]
    pub virtual_machines: Vec<Vm>,
}

/// Corpo de `CreateVirtualMachine` (body `*`). O `namespace` vem do caminho REST
/// — por isso NÃO vai no corpo (um `namespace` no corpo que discorde do caminho
/// é `INVALID_ARGUMENT`); só `name` e `spec` são enviados.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VmCreate {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub spec: VmSpec,
}

/// Um snapshot de VM (`Snapshot` do contrato).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Snapshot {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub includes_memory: bool,
    #[serde(default)]
    pub state: String,
}

/// `ListSnapshotsResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SnapshotList {
    #[serde(default)]
    pub snapshots: Vec<Snapshot>,
}

/// Uma `Operation` (as mutações de VM devolvem uma — ADR-0040). Reduzida aos
/// campos que a UI mostra; o resto do envelope é tolerado e ignorado.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Operation {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub target: String,
    #[serde(default)]
    pub verb: String,
    #[serde(default)]
    pub progress_message: String,
}

/// Contagens por recurso para os cartões de métricas do Dashboard.
///
/// Cada contagem é tolerante por desenho: `None` significa «indisponível»
/// (o recurso não é servido, a CLI falhou, ou o verbo não existe neste nó) —
/// a UI mostra um traço, nunca um zero enganador. Containers/pods/images/
/// volumes vêm da ponte CLI-JSON (a raiz de `/v1` ainda não os anuncia); os
/// providers são contados no cliente a partir de `/v1/providers`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ResourceCounts {
    #[serde(default)]
    pub containers_running: Option<usize>,
    #[serde(default)]
    pub containers_total: Option<usize>,
    #[serde(default)]
    pub pods: Option<usize>,
    #[serde(default)]
    pub images: Option<usize>,
    #[serde(default)]
    pub volumes: Option<usize>,
}
