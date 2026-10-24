// Tipos que espelham o JSON do CLI (ADR-0005 do delonix-runtime).
// Fonte: bins/delonix-runtime-bin/src/cmd/workload.rs (WorkloadRow),
// crates/contexts/delonix-compute/src/capability.rs (CapabilityState).
// Campos de imagens, volumes, redes e providers: confirmar contra `-o json`
// real; o cliente normaliza e tolera campos em falta.
//
// DashSummary é a forma NORMALIZADA que a UI consome. O `dashboard --json` do
// engine 5.1.1 NÃO devolve estes campos planos: devolve `{scope, tiles[], rows[]}`
// com `tiles:[{label,value,sub}]` já formatados em string. O tauriClient faz o
// parsing dessas tiles (contagens e bytes humanos) para este formato. Só há um
// STORAGE total — não há bytes por-categoria.
export interface DashSummary {
  containers_running: number;
  containers_total: number;
  vms_running: number;
  vms_total: number;
  networks_total: number;
  volumes_total: number;
  images_total: number;
  secrets_total: number;
  memory_bytes_used: number;
  memory_bytes_limit: number;
  network_rx_bytes: number | null;
  network_tx_bytes: number | null;
  storage_bytes_total: number | null;
  // Métricas numéricas por recurso (§8). O dashboard devolve `rows[]` em paralelo
  // às `tiles[]`; o tauriClient parseia-as aqui. Opcional porque um engine antigo
  // (ou o parsing só-tiles) pode não as trazer.
  rows?: DashRow[];
}

// Uma linha de métrica por recurso do `dashboard --json` (rows[]).
// cpu_usage_usec: contador MONOTÓNICO em microssegundos (NÃO percentagem).
// mem_bytes: memory.current em bytes (instantâneo).
// io_* / net_*: contadores CUMULATIVOS em bytes.
// Campos a null quando não medíveis (rootless, ou VMs — rows de VM não trazem
// cpu/mem). Os booleanos `up`/`ok` podem faltar → null.
export interface DashRow {
  kind: string; // "container" | "vm" | "pod" | "node"…
  name: string;
  status: string;
  up: boolean | null;
  extra: string;
  ok: boolean | null;
  cpu_usage_usec: number | null;
  mem_bytes: number | null;
  io_read_bytes: number | null;
  io_write_bytes: number | null;
  net_rx_bytes: number | null;
  net_tx_bytes: number | null;
}

export type WorkloadType = "container" | "vm" | "pod";

export interface WorkloadRow {
  type: WorkloadType;
  name: string;
  status: string; // já reconciliado pelo engine: "Up 3m", "Running", "Exited (137)"
  info: string; // imagem (container) ou "2 vCPU, 4G" (vm)
  namespace: string;
}

export interface ImageRow {
  ref: string;
  id: string;
  size: string;
  created: string;
  usedBy: string[];
}

export interface VolumeRow {
  name: string;
  driver: string;
  size: string;
  usedBy: string[];
}

export interface NetworkRow {
  name: string;
  driver: string;
  subnet: string;
  members: { name: string; ip: string }[];
}

export interface DoctorItem {
  status: "ok" | "warn" | "fail";
  code?: string; // ex.: "DLX-RES-001"
  title: string;
  detail: string;
  fix?: string; // comando de correção (texto após "→")
  needsSudo: boolean;
}

export type CapabilityLabel =
  | "supported"
  | "partial"
  | "unsupported-by-provider"
  | "requires-external-component"
  | "not-implemented"
  | "unavailable-on-host";

export interface CapabilityRow {
  name: string; // nome do catálogo (ex.: "vm.hotplug.memory.add")
  state: CapabilityLabel;
  detail: string; // evidence | detail | reason | component
}

export interface ProviderReport {
  id: string; // "cloud-hypervisor", "linux", "opnsense"…
  kind: "compute" | "network" | "storage" | "image" | "gateway";
  available: boolean;
  catalogVersion: string;
  capabilities: CapabilityRow[];
}

export interface EngineEvent {
  time: string;
  kind: string; // container, vm, image…
  action: string; // create, start, die, oom, remove…
  name: string;
  detail?: string;
}

export interface CliResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
  argv: string[];
}

// Mesmos nomes do servidor MCP (crates/interfaces/delonix-mcp/src/risk.rs).
export type RiskLevel = "READ" | "SAFE_WRITE" | "DISRUPTIVE" | "DESTRUCTIVE" | "PRIVILEGED";

// --- VirtualMachineService (contrato de socket delonix.node.v1, §5) ---------
// Forma NORMALIZADA que a UI consome. Os campos vêm do proto3 JSON do contrato
// (snake_case por `preserve_proto_field_names`); o tauriClient normaliza-os
// para estes nomes camelCase. `memoryBytes` chega como string no JSON (int64
// do proto3) e é convertido para número.

// Uma VM lida pelo socket (`node_vm_get`/`node_vm_list`).
export interface VmDetail {
  name: string;
  namespace: string;
  phase: string; // "VIRTUAL_MACHINE_PHASE_RUNNING" | …
  provider: string;
  ipAddresses: string[];
  ipPredicted: boolean;
  vcpus: number;
  memoryBytes: number;
  image: string;
}

// Entrada do formulário de criação de VM (CreateWorkload).
export interface VmCreateInput {
  name: string;
  image: string;
  vcpus: number;
  memoryBytes: number;
  diskBytes: number;
  network: string; // "" = sem anexo de rede explícito
}

// Um snapshot de VM (`node_vm_snapshots`).
export interface VmSnapshot {
  name: string;
  includesMemory: boolean;
  state: string; // estado do guest na captura: "running" | "shutoff"
}

export interface McpTool {
  name: string;
  risk: RiskLevel;
}

// --- Camada declarativa (§E) ------------------------------------------------
// Uma linha de `stack plan -o json`: o que um `apply` FARIA, sem tocar na
// máquina. `stack` não tem registo próprio no engine (é só um manifesto), por
// isso a leitura estruturada da "estrutura" de um stack vem do plano. O `ls`
// texto usa `drop_uninformative` (colunas variáveis) → o plano é mais robusto.
// Fonte: `delonix stack plan -o json` (ADR-0005/ADR-0019) do engine 5.1.1.
export interface StackPlanRow {
  kind: string; // Network | Volume | Image | Vm | Container | Pod | …
  name: string;
  action: string; // create | update | delete | noop
  changed: boolean; // true quando o apply mexeria neste recurso
  diffs: number; // nº de campos que divergem (comprimento de diffs[])
  planDigest: string; // digest do plano (para `apply --plan-digest`)
}

// Uma linha de `cluster ls` (TEXTO — não há `-o json` no 5.1.1). Colunas reais:
// NAME MODE STATE CONTROL-PLANES WORKERS API PORT UPTIME LAST RESTART CRI SOCKET
// K8S VERSION. O cliente parseia por NOME de coluna (resiste a reordenação).
export interface ClusterRow {
  name: string;
  mode: string; // kind | vm
  state: string; // "up" | "2/3 up"
  controlPlanes: string;
  workers: string;
  apiPort: string;
  k8sVersion: string;
}

// Um serviço de `compose ps` (TEXTO). Colunas: SERVICE NAME IMAGE STATUS.
export interface ComposeService {
  service: string;
  name: string;
  image: string;
  status: string;
}

// --- Segredos (§E) ----------------------------------------------------------
// SÓ metadados. O valor de um segredo NUNCA chega ao renderer: `secret ls -o
// json` devolve o nome, o número de chaves e os NOMES das chaves (nunca os
// valores). Fonte: `delonix secret ls -o json` do engine 5.1.1.
export interface SecretRow {
  name: string;
  keys: number; // número de chaves (pares KEY=value) no segredo
  names: string[]; // nomes das chaves (ex.: ["POSTGRES_PASSWORD", "DATABASE_URL"]) — nunca valores
  updated: string; // data humana derivada de updated_unix
  version: number;
  usedBy: string[]; // recursos que consomem o segredo
}

// --- Backups (§E) -----------------------------------------------------------
// Um arquivo de UM recurso (container/pod/vm/stack). O `backup ls` do engine
// 5.1.1 é TEXTO (não há `-o json`): colunas ARCHIVE KIND NAME CREATED SIZE HOST.
// O `archive` (nome do ficheiro) é o identificador para inspect/restore/remove.
export interface BackupRow {
  archive: string; // nome do arquivo, ex.: "container-db-20260811-205312.tar.gz" — é o id
  kind: string; // container | pod | vm | stack | systemcontainer
  name: string; // nome do recurso arquivado
  created: string;
  size: string;
  host: string;
}
