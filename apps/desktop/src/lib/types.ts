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
  // `problems[]` do dashboard: alertas já formatados pelo engine (ex.: OOM, disco
  // cheio). Vêm como texto; o cliente normaliza strings/objetos para string.
  problems?: string[];
}

// --- Métricas de frota ESTRUTURADAS (`system metrics -o json`, §B) ----------
// A MESMA `DashStats` que o dashboard e o endpoint Prometheus usam
// (delonix-mgmt::dashstats::collect), SEM a formatação humana das tiles. Traz o
// que as tiles não têm: STORAGE por categoria (imagens/volumes/vm-images/
// containers) e o nº de containers com rede não medida. Fonte confirmada por
// `--help` + `-o json` no engine 5.1.1.
export interface SystemMetrics {
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
  network_unmeasured_containers: number;
  // Storage POR CATEGORIA (bytes). O total é a soma (ver lib/metrics.ts).
  storage_bytes_images: number;
  storage_bytes_volumes: number;
  storage_bytes_vm_images: number;
  storage_bytes_containers: number;
}

// --- Saúde do nó (`system resources -o json`, §B) ---------------------------
// Severidade de um conselho: `blocking` (impede ou ignora silenciosamente algo),
// `warn` (vale a pena rever), `info` (contexto). A UI ordena blocking primeiro.
export type ResourceSeverity = "blocking" | "warn" | "info";

// Um conselho acionável do nó. `id` é o código DLX-RES-NNN; `class` diz de que
// tipo é (config/capacity/load); `action` é o comando/passo de correção.
export interface ResourceAdvice {
  id: string;
  subject: string; // cgroup | io | disk | memory…
  severity: ResourceSeverity;
  finding: string; // o que foi observado
  action: string; // como resolver
  class: string; // config | capacity | load
}

// O gargalo do nó AGORA (pode ser null quando nada está sob pressão). Forma
// NORMALIZADA e tolerante — o engine devolve null na folga, por isso os nomes de
// campo são lidos defensivamente no cliente.
export interface ResourceBottleneck {
  resource: string; // cpu | memory | io | disk
  detail: string;
  severity: ResourceSeverity | null;
}

// Uma amostra de pressão PSI por recurso (médias de 10/60/300 s, em %).
export interface PressureSample {
  resource: string; // cpu | memory | io
  avg10: number;
  avg60: number;
  avg300: number;
}

// Capacidade do host (o que ESTE nó tem). Campos a null quando não medíveis.
export interface ResourceHost {
  cpus: number | null;
  cpuTemperatureC: number | null;
  memoryBytes: number | null;
  memoryAvailableBytes: number | null;
  stateRootFreeBytes: number | null;
  swapBytes: number | null;
  swapUsedBytes: number | null;
}

export interface SystemResources {
  advice: ResourceAdvice[];
  bottleneck: ResourceBottleneck | null;
  pressure: PressureSample[];
  host: ResourceHost;
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
  ref: string; // repo_tags[0] na forma CURTA (sem docker.io/library/); "<none>:<none>" se sem tags
  tags: string[]; // todas as tags (curtas, deduplicadas) — a UI pode mostrar várias
  id: string; // sha256 sem prefixo, 12 chars
  size: string; // size_bytes humanizado (KiB/MiB/GiB)
  created: string; // created_unix como data curta + relativo
  orphan: boolean; // sinal AUTORITÁRIO do engine para "sem uso" (eixo/limpeza)
  usedBy: string[]; // workloads que correm esta imagem (cruzamento best-effort)
}

export interface VolumeRow {
  name: string;
  driver: string;
  size: string;
  usedBy: string[];
}

// Um membro de uma rede: o nome do workload e o seu IP nessa rede. O IP só é
// conhecido no DETALHE (`network describe`), que é a única forma que o traz por
// membro; na LISTA (`network ls -o json` → `used_by`) vem vazio.
export interface NetworkMember {
  name: string;
  ip: string;
}

export interface NetworkRow {
  name: string;
  driver: string;
  subnet: string;
  bridge: string; // bridge do holder (dlxn…); "" nos drivers sem plano físico
  gateway: string; // em vigor; só preenchido no detalhe (networkDetail)
  members: NetworkMember[];
}

// Uma linha de `network diagnose -o json`: um facto do estado VIVO do nó, o seu
// veredito e como o corrigir. status: "ok" | "warn" | "down".
export interface NetDiagnoseFinding {
  check: string;
  status: string;
  detail: string;
  fix?: string;
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
  ts: number; // epoch em SEGUNDOS (0 se desconhecido) — usado na correlação ao segundo
  time: string; // hora local formatada (fmtUnix) — NUNCA o epoch cru
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

// Entrada de um container de um pod no formulário de criação (node.v1 CreatePod).
// O caminho `CreatePod` só carrega a forma simples — para mounts/resources/… usa
// o manifesto (ApplyStack). `command` é a linha a correr (vira `entrypoint` no
// contrato, i.e. `command:` do manifesto k8s).
export interface PodContainerInput {
  name: string;
  image: string;
  command: string; // separada por espaços; vazio = entrypoint da imagem
  env: string; // "CHAVE=valor" por linha/vírgula
}

// Entrada do formulário "Novo pod" (node.v1 CreatePod).
export interface PodCreateInput {
  name: string;
  namespace?: string;
  containers: PodContainerInput[];
  shareProcessNamespace?: boolean;
}

// Entrada do formulário "Novo container" (node.v1 CreateContainer + Start). Os
// campos-texto são separados por linha/vírgula. `ports` ainda NÃO é servido pelo
// contrato (precisa do slirp) — se preenchido, o engine recusa com UNIMPLEMENTED.
export interface ContainerCreateInput {
  name: string;
  image: string;
  namespace?: string;
  env: string; // "CHAVE=valor"
  volumes: string; // "nome:/caminho" (ou "/host:/caminho[:ro]")
  ports: string; // "host:contentor" — gap do contrato
  memory: string; // "1g" / "512m"
  cpus: string; // "2" / "0.5"
  restart: string; // unless-stopped | always | on-failure | no
  logCri: boolean;
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

// --- Recursos DENTRO de um cluster (kubectl READ) ---------------------------
// O engine 5.1.1 não tem `cluster kubectl` passthrough, por isso estes vêm de
// correr o `kubectl` do sistema contra o kubeconfig em cache (comando backend
// `dlx_kubectl`, só-leitura). Formas NORMALIZADas a partir do `-o json` do
// kubectl (`items[]`), tolerantes a campos em falta.

// Um nó do cluster (`kubectl get nodes -o json`).
export interface K8sNode {
  name: string;
  ready: boolean; // condição Ready == "True"
  status: string; // "Ready" | "NotReady"
  schedulable: boolean; // !spec.unschedulable (false = cordonado)
  roles: string[]; // control-plane, worker… (das labels node-role.kubernetes.io/*)
  version: string; // kubeletVersion (status.nodeInfo)
}

// Um pod do cluster (`kubectl get pods -A -o json`).
export interface K8sPod {
  namespace: string;
  name: string;
  phase: string; // Running | Pending | Succeeded | Failed | Unknown
  ready: string; // "2/2" (containers prontos / total)
  restarts: number; // soma dos restartCount dos containers
  node: string; // spec.nodeName (onde está agendado)
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

// Detalhe revelável de UM segredo (`secret inspect [--reveal] -o json`). O
// engine devolve um array `[{name, keys[], data:{KEY:VALUE}, revealed}]`; a UI
// consome só o mapa `keys` (chave→valor) e o flag `revealed`. Quando
// `revealed=false`, os valores são a máscara "••••••" do próprio engine.
export interface SecretReveal {
  keys: Record<string, string>; // KEY → valor (em claro se revealed, senão "••••••")
  revealed: boolean;
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
