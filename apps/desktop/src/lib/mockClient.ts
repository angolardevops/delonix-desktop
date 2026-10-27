// Duplo local: os mesmos dados dos mockups, para desenvolver no browser sem
// Tauri nem engine. A UI mostra sempre uma faixa "duplo local" neste modo.
import type { ContainerStatsSample, DelonixClient, ExecMode, ExecSession, HostIdentity } from "./client";
import type { Argv } from "./cli";
import { show } from "./cli";
import { buildEngineInfo } from "./engine";
import type {
  BackupRow, CliResult, ClusterRow, ComposeService, DashRow, DashSummary, DoctorItem, EngineEvent, ImageRow, K8sNode, K8sPod, NetDiagnoseFinding, NetworkRow, ProviderReport, PodCreateInput, RiskLevel, SecretRow, StackPlanRow, SystemMetrics, SystemResources, VmCreateInput, VmDetail, VmSnapshot, VolumeRow, WorkloadRow,
} from "./types";

const GB = 1024 ** 3;
const wait = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(structuredClone(v)), 120));

let workloads: WorkloadRow[] = [
  { type: "container", name: "traefik", status: "Up 3d", info: "docker.io/traefik:v3.1", namespace: "default" },
  { type: "container", name: "postgres-dev", status: "Up 3d", info: "docker.io/library/postgres:16", namespace: "default" },
  { type: "container", name: "redis", status: "Up 3d", info: "docker.io/library/redis:7-alpine", namespace: "default" },
  { type: "container", name: "odoo-16", status: "Exited (137) 12 minutes ago", info: "docker.io/library/odoo:16", namespace: "default" },
  { type: "container", name: "minio", status: "Exited (0) 2 days ago", info: "quay.io/minio/minio:latest", namespace: "default" },
  { type: "container", name: "keycloak", status: "Exited (0) 5 days ago", info: "quay.io/keycloak/keycloak:25.0", namespace: "default" },
  { type: "vm", name: "fc-ci-runner-1", status: "Running", info: "2 vCPU, 1G", namespace: "default" },
  { type: "vm", name: "fc-ci-runner-2", status: "Running", info: "2 vCPU, 1G", namespace: "default" },
  { type: "vm", name: "fedora-kde-build", status: "Stopped", info: "8 vCPU, 8G", namespace: "default" },
  // Noutra namespace: prova visível de que o seletor de namespace filtra a lista.
  { type: "container", name: "team-a-api", status: "Up 1d", info: "ghcr.io/angolardevops/api:edge", namespace: "team-a" },
  { type: "container", name: "team-a-worker", status: "Up 1d", info: "ghcr.io/angolardevops/worker:edge", namespace: "team-a" },
];

// Snapshots simulados por VM (estado em memória do duplo local).
const snapshots: Record<string, VmSnapshot[]> = {
  "fedora-kde-build": [{ name: "pre-update", includesMemory: false, state: "shutoff" }],
};

// Deriva um VmDetail do WorkloadRow de VM (o `info` traz "2 vCPU, 8G").
const mockVm = (w: WorkloadRow): VmDetail => {
  const vcpus = Number(/(\d+)\s*vCPU/i.exec(w.info)?.[1] ?? 1);
  const g = Number(/(\d+)\s*G/i.exec(w.info)?.[1] ?? 1);
  const running = w.status === "Running";
  return {
    name: w.name,
    namespace: w.namespace,
    phase: running ? "VIRTUAL_MACHINE_PHASE_RUNNING" : "VIRTUAL_MACHINE_PHASE_STOPPED",
    provider: "cloud-hypervisor",
    ipAddresses: running ? ["192.168.122.42"] : [],
    ipPredicted: true,
    vcpus,
    memoryBytes: g * 1024 ** 3,
    image: "firecracker/ci:24.04",
  };
};

const dashBase: Omit<DashSummary, "rows"> = {
  containers_running: 3, containers_total: 6, vms_running: 2, vms_total: 3, networks_total: 4, volumes_total: 27,
  images_total: 25, secrets_total: 1, memory_bytes_used: 5.2 * GB, memory_bytes_limit: 12 * GB,
  network_rx_bytes: 2_100_000, network_tx_bytes: 340_000, storage_bytes_total: 28.4 * GB,
};

// Rows numéricas plausíveis para o modo browser. Os contadores crescem com o
// tempo decorrido (cpu_usec cumulativo, io/net cumulativos) para que as taxas
// calculadas por diferença entre amostras não sejam zero. mem_bytes é
// instantâneo. Containers parados e VMs NÃO trazem cpu/mem (null), tal como no
// engine real.
const MB = 1024 ** 2;
const started = Date.now();
const running = (name: string, cores: number, mem: number, ioR: number, ioW: number, rx: number, tx: number): DashRow => {
  const sec = (Date.now() - started) / 1000;
  return {
    kind: "container", name, status: "running", up: true, extra: "", ok: true,
    cpu_usage_usec: Math.round(cores * 1e6 * sec), // 1 núcleo-segundo = 1e6 usec
    mem_bytes: Math.round(mem),
    io_read_bytes: Math.round(ioR * sec),
    io_write_bytes: Math.round(ioW * sec),
    net_rx_bytes: Math.round(rx * sec),
    net_tx_bytes: Math.round(tx * sec),
  };
};
const unmeasured = (name: string, kind: "container" | "vm", status: string, extra = ""): DashRow => ({
  kind, name, status, up: status === "running", extra, ok: status !== "exited",
  cpu_usage_usec: null, mem_bytes: null, io_read_bytes: null, io_write_bytes: null,
  net_rx_bytes: null, net_tx_bytes: null,
});
const mockRows = (): DashRow[] => [
  running("traefik", 0.12, 64 * MB, 2 * 1024, 1 * 1024, 48 * 1024, 36 * 1024),
  running("postgres-dev", 0.35, 312 * MB, 64 * 1024, 128 * 1024, 22 * 1024, 40 * 1024),
  running("redis", 0.05, 24 * MB, 512, 256, 8 * 1024, 6 * 1024),
  unmeasured("odoo-16", "container", "exited"),
  unmeasured("minio", "container", "exited"),
  unmeasured("keycloak", "container", "exited"),
  unmeasured("fc-ci-runner-1", "vm", "running", "2 vCPU, 1G"),
  unmeasured("fc-ci-runner-2", "vm", "running", "2 vCPU, 1G"),
  unmeasured("fedora-kde-build", "vm", "stopped", "8 vCPU, 8G"),
];

// Problems do dashboard (§B), simulados: espelham o OOM do odoo-16.
const mockProblems = (): string[] =>
  workloads.some((w) => /\(137\)/.test(w.status))
    ? ["container odoo-16 foi morto por falta de memória (código 137)"]
    : [];

// Métricas de frota estruturadas (§B), com STORAGE por categoria. Coerentes com
// o dashBase (mesmas contagens/memória); somadas dão ~28,4 GiB de storage.
const mockMetrics = (): SystemMetrics => ({
  containers_running: dashBase.containers_running,
  containers_total: dashBase.containers_total,
  vms_running: dashBase.vms_running,
  vms_total: dashBase.vms_total,
  networks_total: dashBase.networks_total,
  volumes_total: dashBase.volumes_total,
  images_total: dashBase.images_total,
  secrets_total: dashBase.secrets_total,
  memory_bytes_used: dashBase.memory_bytes_used,
  memory_bytes_limit: dashBase.memory_bytes_limit,
  network_rx_bytes: dashBase.network_rx_bytes,
  network_tx_bytes: dashBase.network_tx_bytes,
  network_unmeasured_containers: 1,
  storage_bytes_images: 16.1 * GB,
  storage_bytes_volumes: 3.2 * GB,
  storage_bytes_vm_images: 8.6 * GB,
  storage_bytes_containers: 0.5 * GB,
});

// Saúde do nó (§B): um conselho blocking, um warn e um info; um gargalo de CPU;
// pressão PSI plausível; capacidade do host.
const mockResources = (): SystemResources => ({
  advice: [
    { id: "DLX-RES-001", subject: "cgroup", severity: "blocking", class: "config", finding: "1 flag(s) são aceites e silenciosamente ignoradas: --cpuset", action: "sudo delonix system setup --delegate, depois systemctl restart user@<uid>.service" },
    { id: "DLX-RES-010", subject: "disk", severity: "warn", class: "capacity", finding: "o diretório de estado está a 86% — restam 9,1 GiB", action: "libertar espaço: delonix image prune / volume prune" },
    { id: "DLX-RES-002", subject: "io", severity: "info", class: "config", finding: "--io-weight e as flags --device-* são recusadas aqui (exit 69): o io não está delegado", action: "sudo delonix system setup --delegate, depois systemctl restart user@<uid>.service" },
  ],
  bottleneck: { resource: "cpu", detail: "pressão de CPU a 32% nos últimos 60 s — um build está a saturar o nó", severity: "warn" },
  pressure: [
    { resource: "cpu", avg10: 2.35, avg60: 3.23, avg300: 4.04 },
    { resource: "memory", avg10: 0, avg60: 0, avg300: 0 },
    { resource: "io", avg10: 0.46, avg60: 0.4, avg300: 0.31 },
  ],
  host: {
    cpus: 20, cpuTemperatureC: 61, memoryBytes: 67 * GB, memoryAvailableBytes: 22 * GB,
    stateRootFreeBytes: 9.1 * GB, swapBytes: 8 * GB, swapUsedBytes: 1.2 * GB,
  },
});

let images: ImageRow[] = [
  { ref: "ghcr.io/angolardevops/delonix-runtime:edge", tags: ["ghcr.io/angolardevops/delonix-runtime:edge"], id: "c0ffee112233", size: "96,0 MiB", created: "hoje · há instantes", orphan: true, usedBy: [] },
  { ref: "ghcr.io/angolardevops/delonix-cloudshell:5.1.1", tags: ["ghcr.io/angolardevops/delonix-cloudshell:5.1.1"], id: "a1b2c3d4e5f6", size: "410 MiB", created: "há 1 sem", orphan: true, usedBy: [] },
  { ref: "postgres:16", tags: ["postgres:16"], id: "b1a0c8e9f2d3", size: "432 MiB", created: "há 3 sem", orphan: false, usedBy: ["postgres-dev"] },
  { ref: "odoo:16", tags: ["odoo:16"], id: "4e77d1a2b9c0", size: "1,6 GiB", created: "há 1 mês", orphan: false, usedBy: ["odoo-16"] },
  { ref: "firecracker/ci:24.04", tags: ["firecracker/ci:24.04"], id: "90f3e2c1d7a8", size: "412 MiB", created: "hoje · há 2 horas", orphan: false, usedBy: ["fc-ci-runner-1", "fc-ci-runner-2"] },
  { ref: "traefik:v3.1", tags: ["traefik:v3.1"], id: "7a1e5b3c9d20", size: "178 MiB", created: "há 2 sem", orphan: false, usedBy: ["traefik"] },
  { ref: "node:20-bookworm", tags: ["node:20-bookworm"], id: "3f8c2a7e1b90", size: "1,1 GiB", created: "há 2 meses", orphan: true, usedBy: [] },
  { ref: "rust:1.82", tags: ["rust:1.82"], id: "e2b9a1c4d7f6", size: "1,5 GiB", created: "há 6 sem", orphan: true, usedBy: [] },
];

let volumes: VolumeRow[] = [
  { name: "pgdata", driver: "local", size: "412 MB", usedBy: ["postgres-dev"] },
  { name: "odoo-filestore", driver: "local", size: "890 MB", usedBy: ["odoo-16"] },
  { name: "minio-data", driver: "local", size: "604 MB", usedBy: ["minio"] },
  { name: "ci-cache-cargo", driver: "local", size: "720 MB", usedBy: ["fc-ci-runner-1", "fc-ci-runner-2"] },
  { name: "keycloak-old", driver: "local", size: "288 MB", usedBy: [] },
];

let networks: NetworkRow[] = [
  { name: "edge", driver: "bridge", subnet: "10.89.1.0/24", bridge: "dlxnedge01", gateway: "10.89.1.1", members: [{ name: "traefik", ip: "10.89.1.2" }, { name: "odoo-16", ip: "10.89.1.5" }] },
  { name: "odoo-net", driver: "bridge", subnet: "10.89.2.0/24", bridge: "dlxnodoo02", gateway: "10.89.2.1", members: [{ name: "odoo-16", ip: "10.89.2.4" }, { name: "postgres-dev", ip: "10.89.2.2" }, { name: "redis", ip: "10.89.2.3" }] },
  { name: "delonix0", driver: "bridge", subnet: "10.88.0.0/16", bridge: "dlxn0default", gateway: "10.88.0.1", members: [{ name: "minio", ip: "10.88.0.9" }] },
];

// Diagnóstico simulado de `network diagnose` (§8.6): o nó está coerente.
const mockDiagnose = (): NetDiagnoseFinding[] => [
  { check: "control plane", status: "ok", detail: "pin ativo, socket de controlo responde" },
  { check: "networks", status: "ok", detail: `${networks.length} declaradas, todas realizadas` },
  { check: "address registry", status: "ok", detail: "sem fugas de lease" },
];

// Nomes REAIS do catálogo 1.4.0 (crates/contexts/delonix-compute/src/capability.rs).
const providers: ProviderReport[] = [
  { id: "cloud-hypervisor", kind: "compute", available: true, catalogVersion: "1.4.0", capabilities: [
    { name: "provider.readback", state: "supported", detail: "test:delonix-vm::readback" },
    { name: "provider.availability", state: "partial", detail: "available() verifica o binário; a sonda de /dev/kvm é à parte" },
    { name: "vm.hotplug.memory.add", state: "unavailable-on-host", detail: "o kernel do host não expõe memory hotplug" },
    { name: "vm.device.tpm", state: "requires-external-component", detail: "swtpm" },
    { name: "vm.cpu.pinning", state: "not-implemented", detail: "" },
  ] },
  { id: "linux", kind: "network", available: true, catalogVersion: "1.4.0", capabilities: [
    { name: "net.bridge", state: "supported", detail: "e2e:rede custom" },
    { name: "net.capture", state: "supported", detail: "e2e:capture" },
    { name: "net.overlay.encrypted", state: "not-implemented", detail: "" },
  ] },
  { id: "opnsense", kind: "gateway", available: false, catalogVersion: "1.4.0", capabilities: [
    { name: "net.gateway.filter", state: "unavailable-on-host", detail: "alvo não configurado em providers.yaml" },
    { name: "net.overlay.vxlan", state: "unsupported-by-provider", detail: "um appliance de perímetro não cria overlays" },
  ] },
];

// Segredos simulados (§E): SÓ metadados — o valor NUNCA existe no duplo local.
const fmtMock = (d: Date) => d.toLocaleString("pt-AO", { dateStyle: "short", timeStyle: "short" });
let secrets: SecretRow[] = [
  { name: "pg-dev", keys: 2, names: ["POSTGRES_PASSWORD", "DATABASE_URL"], updated: fmtMock(new Date(Date.now() - 3 * 864e5)), version: 1, usedBy: ["postgres-dev"] },
  { name: "minio-root", keys: 2, names: ["MINIO_ROOT_USER", "MINIO_ROOT_PASSWORD"], updated: fmtMock(new Date(Date.now() - 12 * 864e5)), version: 2, usedBy: ["minio"] },
  { name: "keycloak-db", keys: 1, names: ["KC_DB_PASSWORD"], updated: fmtMock(new Date(Date.now() - 5 * 864e5)), version: 1, usedBy: [] },
  { name: "traefik-acme", keys: 1, names: ["CF_DNS_API_TOKEN"], updated: fmtMock(new Date(Date.now() - 1 * 864e5)), version: 3, usedBy: ["traefik"] },
];

// Arquivos de backup simulados (§E). O `archive` é o id.
let backups: BackupRow[] = [
  { archive: "container-postgres-dev-20260811-205312.tar.gz", kind: "container", name: "postgres-dev", created: "11/08/26 20:53", size: "412 MB", host: "walter-dev" },
  { archive: "container-minio-20260810-030000.tar.gz", kind: "container", name: "minio", created: "10/08/26 03:00", size: "604 MB", host: "walter-dev" },
  { archive: "vm-fedora-kde-build-20260809-190000.tar.gz", kind: "vm", name: "fedora-kde-build", created: "09/08/26 19:00", size: "8,1 GB", host: "walter-dev" },
];

// --- Camada declarativa (§E), simulada --------------------------------------
// Plano simulado de `stack plan -o json`: mistura noop/update/create para a UI
// mostrar os três estados. O `apply` no duplo local marca tudo como aplicado.
let stackApplied = false;
const mockPlan = (): StackPlanRow[] => stackApplied
  ? [
      { kind: "Network", name: "edge", action: "noop", changed: false, diffs: 0, planDigest: "a1b2c3d4" },
      { kind: "Volume", name: "pgdata", action: "noop", changed: false, diffs: 0, planDigest: "e5f6a7b8" },
      { kind: "Container", name: "web", action: "noop", changed: false, diffs: 0, planDigest: "c9d0e1f2" },
      { kind: "Container", name: "api", action: "noop", changed: false, diffs: 0, planDigest: "33445566" },
    ]
  : [
      { kind: "Network", name: "edge", action: "noop", changed: false, diffs: 0, planDigest: "a1b2c3d4" },
      { kind: "Volume", name: "pgdata", action: "noop", changed: false, diffs: 0, planDigest: "e5f6a7b8" },
      { kind: "Container", name: "web", action: "update", changed: true, diffs: 2, planDigest: "c9d0e1f2" },
      { kind: "Container", name: "api", action: "create", changed: true, diffs: 0, planDigest: "33445566" },
    ];

let mockClusters: ClusterRow[] = [
  { name: "dev", mode: "kind", state: "up", controlPlanes: "1", workers: "2", apiPort: "40219", k8sVersion: "v1.31.0" },
  { name: "lab", mode: "vm", state: "2/3 up", controlPlanes: "3", workers: "1", apiPort: "6443", k8sVersion: "v1.31.2" },
];

// Nós cordonados no duplo local (drain/uncordon), por `${cluster}/${node}`.
const drained = new Set<string>();

// Nós de um cluster derivados das contagens CP/workers (os clusters criados no
// duplo local também ganham nós). O 1º control-plane hospeda os pods de sistema.
const mockNodes = (c: ClusterRow): K8sNode[] => {
  const cp = Math.max(1, Number(c.controlPlanes) || 1);
  const wk = Math.max(0, Number(c.workers) || 0);
  const nodes: K8sNode[] = [];
  for (let i = 0; i < cp; i++) {
    const name = i === 0 ? `${c.name}-control-plane` : `${c.name}-control-plane${i + 1}`;
    nodes.push({ name, ready: true, status: "Ready", schedulable: !drained.has(`${c.name}/${name}`), roles: ["control-plane"], version: c.k8sVersion });
  }
  for (let i = 0; i < wk; i++) {
    const name = i === 0 ? `${c.name}-worker` : `${c.name}-worker${i + 1}`;
    nodes.push({ name, ready: true, status: "Ready", schedulable: !drained.has(`${c.name}/${name}`), roles: ["<none>"], version: c.k8sVersion });
  }
  return nodes;
};

const K8S_NAMESPACES = ["default", "kube-system", "kube-public", "kube-node-lease", "local-path-storage"];

// Pods de um cluster: os de sistema (kube-system) no 1º control-plane + uma app
// no default. Filtra por namespace quando pedido.
const mockPods = (c: ClusterRow, namespace?: string): K8sPod[] => {
  const cpNode = `${c.name}-control-plane`;
  const wkNode = Number(c.workers) > 0 ? `${c.name}-worker` : cpNode;
  const all: K8sPod[] = [
    { namespace: "kube-system", name: `coredns-5d78c9869d-abcde`, phase: "Running", ready: "1/1", restarts: 0, node: cpNode },
    { namespace: "kube-system", name: `coredns-5d78c9869d-fghij`, phase: "Running", ready: "1/1", restarts: 0, node: cpNode },
    { namespace: "kube-system", name: `etcd-${cpNode}`, phase: "Running", ready: "1/1", restarts: 0, node: cpNode },
    { namespace: "kube-system", name: `kube-apiserver-${cpNode}`, phase: "Running", ready: "1/1", restarts: 0, node: cpNode },
    { namespace: "kube-system", name: `kube-proxy-${c.name}-x7k2p`, phase: "Running", ready: "1/1", restarts: 1, node: wkNode },
    { namespace: "local-path-storage", name: `local-path-provisioner-6bc4bddd6b-qr7st`, phase: "Running", ready: "1/1", restarts: 0, node: cpNode },
    { namespace: "default", name: `nginx-7854ff8599-2m4kd`, phase: "Running", ready: "1/1", restarts: 0, node: wkNode },
    { namespace: "default", name: `nginx-7854ff8599-9p8zx`, phase: "Pending", ready: "0/1", restarts: 0, node: "" },
  ];
  return namespace ? all.filter((p) => p.namespace === namespace) : all;
};

const findCluster = (name: string): ClusterRow | undefined => mockClusters.find((c) => c.name === name);

const mockCompose: ComposeService[] = [
  { service: "web", name: "shop-web-1", image: "docker.io/library/nginx:alpine", status: "Running" },
  { service: "db", name: "shop-db-1", image: "docker.io/library/postgres:16", status: "Running" },
  { service: "cache", name: "shop-cache-1", image: "docker.io/library/redis:7-alpine", status: "Running" },
];

// Espelha `delonix system doctor`: pré-requisitos ✓ e recursos DLX-RES-NNN.
const doctorItems: DoctorItem[] = [
  { status: "ok", title: "cgroup2 delegation (--memory/--cpus/--pids-limit)", detail: "/sys/fs/cgroup/user.slice/…/app.slice", needsSudo: false },
  { status: "ok", title: "slirp4netns — rootless networking", detail: "", needsSudo: false },
  { status: "ok", title: "nft — firewall and isolation", detail: "", needsSudo: false },
  { status: "warn", code: "DLX-RES-001", title: "cgroup", detail: "1 flag(s) are accepted and silently ignored: --cpuset", fix: "sudo delonix system setup --delegate, then systemctl restart user@<uid>.service", needsSudo: true },
  { status: "warn", code: "DLX-RES-002", title: "io", detail: "--io-weight and the --device-* flags are refused here (exit 69)", fix: "sudo delonix system setup --delegate, then systemctl restart user@<uid>.service", needsSudo: true },
];

const RISK: [string[], RiskLevel][] = [
  [["workload", "rm"], "DESTRUCTIVE"], [["container", "rm"], "DESTRUCTIVE"], [["image", "remove"], "DESTRUCTIVE"], [["volume", "rm"], "DESTRUCTIVE"], [["network", "rm"], "DESTRUCTIVE"],
  [["secret", "rm"], "DESTRUCTIVE"], [["backup", "remove"], "DESTRUCTIVE"],
  [["workload", "stop"], "DISRUPTIVE"], [["container", "stop"], "DISRUPTIVE"], [["vm", "stop"], "DISRUPTIVE"], [["container", "restart"], "DISRUPTIVE"], [["vm", "restart"], "DISRUPTIVE"],
  [["backup", "restore"], "DISRUPTIVE"],
  [["container", "start"], "SAFE_WRITE"], [["vm", "start"], "SAFE_WRITE"], [["image", "pull"], "SAFE_WRITE"], [["container", "run"], "SAFE_WRITE"], [["volume", "create"], "SAFE_WRITE"], [["network", "create"], "SAFE_WRITE"],
  // Artefactos da imagem (§ image): assinar/marcar/publicar/guardar/exportar
  // não destroem nada → SafeWrite (correm sem confirmação).
  [["image", "sign"], "SAFE_WRITE"], [["image", "tag"], "SAFE_WRITE"], [["image", "push"], "SAFE_WRITE"], [["image", "save"], "SAFE_WRITE"], [["image", "export"], "SAFE_WRITE"],
  // Redes (§8.6): ligar a quente é reversível (SAFE_WRITE); desligar retira a
  // conectividade nessa rede (DISRUPTIVE).
  [["network", "connect"], "SAFE_WRITE"], [["network", "disconnect"], "DISRUPTIVE"],
  [["secret", "create"], "SAFE_WRITE"], [["secret", "rotate"], "SAFE_WRITE"], [["backup", "create"], "SAFE_WRITE"],
  // Camada declarativa (§E): apply/up escrevem; destroy/down apagam recursos vivos.
  [["stack", "apply"], "SAFE_WRITE"], [["compose", "up"], "SAFE_WRITE"],
  [["stack", "destroy"], "DESTRUCTIVE"], [["compose", "down"], "DESTRUCTIVE"],
  // Clusters/Kubernetes (kind-mode operável): create/start/load escrevem;
  // stop/drain/uncordon interrompem carga viva; destroy apaga o cluster inteiro.
  [["cluster", "create"], "SAFE_WRITE"], [["cluster", "start"], "SAFE_WRITE"], [["cluster", "load"], "SAFE_WRITE"],
  [["cluster", "stop"], "DISRUPTIVE"], [["cluster", "drain"], "DISRUPTIVE"], [["cluster", "uncordon"], "DISRUPTIVE"],
  [["cluster", "destroy"], "DESTRUCTIVE"],
];
const riskOf = (argv: Argv) => RISK.find(([p]) => p.every((t, i) => argv[i] === t))?.[1] ?? null;

const LOG = [
  "LOG:  database system is ready to accept connections",
  "LOG:  checkpoint starting: time",
  "LOG:  checkpoint complete: wrote 412 buffers (2.5%)",
  "LOG:  connection received: host=10.88.0.15 port=48122",
  "WARNING:  there is no transaction in progress",
  "LOG:  could not receive data from client: Connection reset by peer",
];

export class MockClient implements DelonixClient {
  readonly live = false;
  binary = () => wait("duplo local");
  // Descoberta de versão (§3): o duplo local finge a família testada (5.1.1) e
  // uma contagem de capacidades plausível, para a StatusBar/ContextPicker terem
  // o que mostrar no browser sem enganar (compatível, nunca alarma).
  engine = () => wait(buildEngineInfo("delonix 5.1.1 (duplo local)", 72));
  dash = () => wait({ ...dashBase, rows: mockRows(), problems: mockProblems() });
  systemMetrics = () => wait(mockMetrics());
  systemResources = () => wait(mockResources());
  // `namespace` filtra (como `workload ls -n`); sem argumento, todas — é a
  // forma que o seletor global usa para DESCOBRIR as namespaces existentes.
  workloads = (namespace?: string) => wait(namespace ? workloads.filter((w) => w.namespace === namespace) : workloads);
  images = () => wait(images);
  // Pull/Delete de imagem no duplo local (mutam o array, como o engine faria).
  async imagePull(reference: string, _platform = ""): Promise<void> {
    if (!images.some((i) => i.ref === reference))
      images = [{ ref: reference, tags: [reference], id: Math.random().toString(16).slice(2, 14), size: "12,0 MiB", created: "—", orphan: true, usedBy: [] }, ...images];
    return wait(undefined);
  }
  async imageRemove(reference: string): Promise<void> {
    images = images.filter((i) => i.ref !== reference && i.id !== reference);
    return wait(undefined);
  }
  // Os volumes do duplo local não têm namespace própria; o argumento é aceite
  // por paridade de assinatura (o engine real filtra por `volume ls -n`).
  volumes = (_namespace?: string) => wait(volumes);
  networks = (_namespace?: string) => wait(networks);
  networkDetail = (name: string) => wait(networks.find((n) => n.name === name) ?? { name, driver: "bridge", subnet: "", bridge: "", gateway: "", members: [] });

  // Mutações de rede/volume no duplo local (mutam os arrays, como o engine faria).
  async networkCreate(name: string, driver: string, subnet: string, _namespace?: string): Promise<void> {
    if (!networks.some((n) => n.name === name))
      networks = [...networks, { name, driver: driver || "bridge", subnet, bridge: `dlxn${name.slice(0, 8)}`, gateway: subnet.replace(/\.0(\.0)?\/\d+$/, ".0.1"), members: [] }];
    return wait(undefined);
  }
  async networkRemove(name: string, _namespace?: string): Promise<void> {
    networks = networks.filter((n) => n.name !== name);
    return wait(undefined);
  }
  async networkConnect(network: string, container: string, _namespace?: string): Promise<void> {
    networks = networks.map((n) => (n.name === network && !n.members.some((m) => m.name === container) ? { ...n, members: [...n.members, { name: container, ip: "" }] } : n));
    return wait(undefined);
  }
  async networkDisconnect(network: string, container: string, _namespace?: string): Promise<void> {
    networks = networks.map((n) => (n.name === network ? { ...n, members: n.members.filter((m) => m.name !== container) } : n));
    return wait(undefined);
  }
  async volumeCreate(name: string, _namespace?: string): Promise<void> {
    if (!volumes.some((v) => v.name === name)) volumes = [...volumes, { name, driver: "local", size: "—", usedBy: [] }];
    return wait(undefined);
  }
  async volumeRemove(name: string, _namespace?: string): Promise<void> {
    volumes = volumes.filter((v) => v.name !== name);
    return wait(undefined);
  }
  networkDiagnose = () => wait(mockDiagnose());
  secrets = () => wait(secrets);
  // O duplo local NUNCA tem valores reais. Com `reveal`, devolve um placeholder
  // explícito por chave (para a UI funcionar no browser sem enganar); sem
  // `reveal`, a máscara "••••••" do engine.
  secretInspect = (name: string, reveal: boolean) => {
    const s = secrets.find((x) => x.name === name);
    const names = s?.names ?? [];
    const keys: Record<string, string> = {};
    for (const k of names) keys[k] = reveal ? `duplo-local-${k.toLowerCase()}` : "••••••";
    return wait({ keys, revealed: reveal });
  };
  backups = (_from?: string) => wait(backups);
  providers = () => wait(providers);
  doctor = () => wait(doctorItems);
  stackPlan = (_manifest?: string) => wait(mockPlan());
  stackApply = (_manifest?: string) => wait(undefined).then(() => { stackApplied = true; });
  stackDestroy = (_manifest?: string) => wait(undefined).then(() => { stackApplied = false; });
  podCreate = (input: PodCreateInput) => wait(undefined).then(() => {
    workloads = [...workloads, { type: "pod", name: `pod-${input.name}`, status: "Ready", info: `${input.containers.length} container(s)`, namespace: input.namespace ?? "default" }];
  });
  podDelete = (name: string, _namespace?: string, _force?: boolean) => wait(undefined).then(() => {
    workloads = workloads.filter((w) => !(w.type === "pod" && w.name === name));
  });
  clusters = (_all?: boolean) => wait(mockClusters);

  // Recursos DENTRO de um cluster (kubectl READ), simulados.
  async clusterNodes(cluster: string): Promise<K8sNode[]> {
    const c = findCluster(cluster);
    if (!c) throw new Error(`cluster ${cluster} não encontrado (duplo local)`);
    return wait(mockNodes(c));
  }
  async clusterPods(cluster: string, namespace?: string): Promise<K8sPod[]> {
    const c = findCluster(cluster);
    if (!c) throw new Error(`cluster ${cluster} não encontrado (duplo local)`);
    return wait(mockPods(c, namespace));
  }
  async clusterNamespaces(cluster: string): Promise<string[]> {
    if (!findCluster(cluster)) throw new Error(`cluster ${cluster} não encontrado (duplo local)`);
    return wait(K8S_NAMESPACES);
  }
  async clusterPodLogs(cluster: string, pod: string, namespace: string, _tail = 500): Promise<string> {
    void _tail;
    if (!findCluster(cluster)) throw new Error(`cluster ${cluster} não encontrado (duplo local)`);
    return wait(
      [
        `duplo local — logs simulados de ${pod} (${namespace})`,
        ...LOG,
      ].join("\n") + "\n",
    );
  }
  composePs = (_file?: string) => wait(mockCompose);
  risk = (argv: Argv) => wait(riskOf(argv));

  // Comandos declarativos só-texto: devolve stdout plausível conforme o argv.
  async readText(argv: Argv): Promise<CliResult> {
    const base = { argv: ["delonix", ...argv], ok: true, code: 0, stderr: "" };
    const j = argv.join(" ");
    let stdout = `duplo local — sem engine · ${show(argv)}\n`;
    if (j.startsWith("stack validate")) stdout = "stack validate: OK — 4 document(s), all references resolved\n";
    // `stack ls` (TEXTO): colunas KIND DOMAIN NAME PRESENT STATUS NAMESPACE. No
    // duplo, reflete se o apply simulado já correu (vista de progresso do Studio).
    else if (j.startsWith("stack ls")) stdout = stackApplied
      ? "KIND       DOMAIN   NAME   PRESENT   STATUS        NAMESPACE\nNetwork    net      app    yes       -             default\nContainer  compute  web    yes       Up            default\nContainer  compute  db     yes       Up            default\nIngress    net-exp  ing    -         declarative   default\n"
      : "KIND       DOMAIN   NAME   PRESENT   STATUS        NAMESPACE\nNetwork    net      app    no        -             default\nContainer  compute  web    no        -             default\nContainer  compute  db     no        -             default\nIngress    net-exp  ing    -         declarative   default\n";
    else if (j.startsWith("stack describe")) stdout = "KIND       NAME    PRESENT  STATUS\nNetwork    edge    yes      Up\nContainer  web     yes      Up 3d\nContainer  api     no       —\n";
    else if (j.startsWith("stack history")) stdout = "[]\n";
    else if (j.startsWith("compose config")) stdout = "name: shop\nservices:\n  web:\n    image: docker.io/library/nginx:alpine\n  db:\n    image: docker.io/library/postgres:16\n";
    else if (j.startsWith("manifest render")) stdout = "apiVersion: delonix.io/v1\nkind: Stack\nmetadata:\n  name: shop\nspec:\n  resources:\n  - kind: Network\n    name: edge\n    driver: bridge\n  - kind: Container\n    name: web\n    image: docker.io/library/nginx:alpine\n    restart: unless-stopped\n    ports:\n    - 8080:80\n";
    else if (j.startsWith("manifest validate")) stdout = "manifest validate: OK — schema, references and graph resolved (4 document(s))\n";
    // `manifest schema` no duplo local: um JSON Schema MÍNIMO do manifesto
    // Delonix, só para a completação/hover do IDE funcionarem no browser (o
    // engine real devolve o schema completo gerado dos tipos Rust).
    else if (j.startsWith("manifest schema"))
      stdout = JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        title: "Delonix manifest (duplo local)",
        type: "object",
        required: ["apiVersion", "kind"],
        properties: {
          apiVersion: { type: "string", description: "delonix.io/v1", enum: ["delonix.io/v1"] },
          kind: { type: "string", enum: ["Stack", "Container", "Network", "Volume", "Pod", "Secret", "Application", "VirtualMachine"] },
          metadata: { type: "object", properties: { name: { type: "string" }, namespace: { type: "string" } } },
          spec: { type: "object" },
        },
      }, null, 2) + "\n";
    else if (j.startsWith("cluster health")) stdout = "control-plane: reachable\nnodes: 3/3 Ready\n";
    else if (j.startsWith("cluster kubeconfig")) stdout = "apiVersion: v1\nkind: Config\nclusters:\n- name: dev\n  cluster:\n    server: https://127.0.0.1:40219\n";
    else if (j.startsWith("cluster kube generate")) stdout = `apiVersion: v1\nkind: Pod\nmetadata:\n  name: ${argv[3] ?? "web"}\nspec:\n  containers:\n  - name: ${argv[3] ?? "web"}\n    image: docker.io/library/nginx:alpine\n`;
    else if (j.startsWith("net flow")) stdout = "CONTAINER      IP           RX BYTES   TX BYTES\ntraefik        10.89.1.2    2.1 MiB    340.0 KiB\npostgres-dev   10.89.2.2    1.4 MiB    820.0 KiB\nredis          10.89.2.3    412.0 KiB  256.0 KiB\n";
    // Artefactos da imagem — saídas plausíveis do duplo local (sem engine).
    else if (j.startsWith("image scan") && argv.includes("--sbom"))
      stdout = "Packages (SBOM) · duplo local\nNAME            VERSION\nca-certificates 20240203\nmusl            1.2.5-r0\nbusybox         1.36.1-r31\n";
    else if (j.startsWith("image scan"))
      stdout = "Vulnerability Scan · duplo local\n  SBOM: 14 package(s)   advisories: 5   vulnerabilities: 2\n  CRITICAL 0   HIGH 1   MEDIUM 1   LOW 0\nSEVERITY   PACKAGE   VERSION      FIXED    CVE\nHigh       busybox   1.36.1-r31   1.37.0   CVE-2022-48174\nMedium     musl      1.2.5-r0     1.2.5-r1 CVE-2025-00000\n";
    else if (j.startsWith("image sbom"))
      stdout = "{\n  \"spdxVersion\": \"SPDX-2.3\",\n  \"name\": \"duplo-local\",\n  \"packages\": [\n    { \"name\": \"busybox\", \"versionInfo\": \"1.36.1-r31\" },\n    { \"name\": \"musl\", \"versionInfo\": \"1.2.5-r0\" }\n  ]\n}\n";
    else if (j.startsWith("image history"))
      stdout = "#   LAYER                        SIZE\n0   sha256:17a39c0ba978cc2…   3.3 MiB\n1   sha256:abcdef0123456789…   1.1 MiB\n2   sha256:0f1e2d3c4b5a6978…   256.0 KiB\n";
    else if (j.startsWith("image verify"))
      stdout = "duplo local — assinatura cosign VÁLIDA para a imagem (chave pública conferida)\n";
    return wait({ ...base, stdout });
  }

  async run(argv: Argv, confirm: boolean): Promise<CliResult> {
    const risk = riskOf(argv);
    const base = { argv: ["delonix", ...argv], stdout: "", stderr: "" };
    if (argv[0] === "workload" && argv[1] === "describe") {
      const w = workloads.find((x) => x.name === argv[2]);
      return wait({ ...base, ok: true, code: 0, stdout: w ? `Name:       ${w.name}\nType:       ${w.type}\nStatus:     ${w.status}\nInfo:       ${w.info}\nNamespace:  ${w.namespace}\n` : "" });
    }
    if (!risk) return { ...base, ok: false, code: 2, stderr: `comando não permitido: ${show(argv)}` };
    if ((risk === "DISRUPTIVE" || risk === "DESTRUCTIVE") && !confirm)
      return { ...base, ok: false, code: 1, stderr: "POLICY_DENIED: precisa de confirmação" };
    // Mutações de Segredos (§E) no duplo local. Nunca guardamos valores.
    if (argv[0] === "secret") {
      const sname = argv[2];
      if (argv[1] === "create") {
        const key = /--from-literal/.test(argv.join(" ")) ? (argv[argv.indexOf("--from-literal") + 1] ?? "").split("=")[0] : "value";
        secrets = [...secrets.filter((s) => s.name !== sname), { name: sname, keys: 1, names: [key], updated: fmtMock(new Date()), version: 1, usedBy: [] }];
      } else if (argv[1] === "rm") {
        secrets = secrets.filter((s) => s.name !== sname);
      } else if (argv[1] === "rotate") {
        secrets = secrets.map((s) => (s.name === sname ? { ...s, updated: fmtMock(new Date()), version: s.version + 1 } : s));
      }
      return wait({ ...base, ok: true, code: 0, stdout: `${sname}\n` });
    }
    // Mutações de Backups (§E) no duplo local.
    if (argv[0] === "backup") {
      if (argv[1] === "create") {
        const [, , kind, rname] = argv;
        const archive = `${kind}-${rname}-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15)}.tar.gz`;
        backups = [{ archive, kind, name: rname, created: fmtMock(new Date()), size: "128 MB", host: "walter-dev" }, ...backups];
      } else if (argv[1] === "remove") {
        backups = backups.filter((b) => b.archive !== argv[2]);
      }
      return wait({ ...base, ok: true, code: 0, stdout: `${argv[2] ?? ""}\n` });
    }
    // Mutações declarativas (§E) no duplo local.
    if (argv[0] === "stack") {
      if (argv[1] === "apply") { stackApplied = true; return wait({ ...base, ok: true, code: 0, stdout: "stack apply: 2 created, 1 updated\n" }); }
      if (argv[1] === "destroy") { stackApplied = false; return wait({ ...base, ok: true, code: 0, stdout: "stack destroy: removed 4 resource(s)\n" }); }
    }
    if (argv[0] === "compose") {
      return wait({ ...base, ok: true, code: 0, stdout: argv[1] === "up" ? "compose up: 3 service(s) started\n" : "compose down: removed 3 container(s)\n" });
    }
    // Operações de cluster (kind-mode) no duplo local.
    if (argv[0] === "cluster") {
      const sub = argv[1];
      const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
      if (sub === "create") {
        const name = flag("--name") ?? `rei-${Math.random().toString(36).slice(2, 6)}`;
        if (!mockClusters.some((c) => c.name === name)) {
          mockClusters = [...mockClusters, {
            name, mode: "kind", state: "up",
            controlPlanes: flag("--control-planes") ?? "1",
            workers: flag("--workers") ?? "0",
            apiPort: flag("--api-port") ?? "6443",
            k8sVersion: "v1.31.0",
          }];
        }
        return wait({ ...base, ok: true, code: 0, stdout: `cluster ${name} criado\n` });
      }
      if (sub === "destroy") {
        const name = argv[2] && !argv[2].startsWith("-") ? argv[2] : "";
        mockClusters = mockClusters.filter((c) => c.name !== name);
        return wait({ ...base, ok: true, code: 0, stdout: `cluster ${name} removido\n` });
      }
      if (sub === "start" || sub === "stop") {
        const name = argv[2] && !argv[2].startsWith("-") ? argv[2] : "";
        mockClusters = mockClusters.map((c) => (c.name === name ? { ...c, state: sub === "start" ? "up" : "stopped" } : c));
        return wait({ ...base, ok: true, code: 0, stdout: `cluster ${name} ${sub === "start" ? "iniciado" : "parado"}\n` });
      }
      if (sub === "drain" || sub === "uncordon") {
        const node = argv[2];
        const cluster = flag("--name") ?? "";
        const key = `${cluster}/${node}`;
        if (sub === "drain") drained.add(key); else drained.delete(key);
        return wait({ ...base, ok: true, code: 0, stdout: `node/${node} ${sub === "drain" ? "cordoned, evicted" : "uncordoned"}\n` });
      }
      if (sub === "load") return wait({ ...base, ok: true, code: 0, stdout: "imagem(ns) carregada(s) nos nós\n" });
    }
    // Mutações de Redes (§8.6) no duplo local.
    if (argv[0] === "network") {
      const sub = argv[1];
      if (sub === "create") {
        const nname = argv[argv.length - 1];
        const di = argv.indexOf("--driver");
        const si = argv.indexOf("--subnet");
        const driver = di >= 0 ? (argv[di + 1] ?? "bridge") : "bridge";
        const subnet = si >= 0 ? (argv[si + 1] ?? "") : `10.${80 + networks.length}.0.0/16`;
        if (!networks.some((n) => n.name === nname))
          networks = [...networks, { name: nname, driver, subnet, bridge: `dlxn${nname.slice(0, 8)}`, gateway: subnet.replace(/\.0\.0\/\d+$|\.0\/\d+$/, ".0.1"), members: [] }];
        return wait({ ...base, ok: true, code: 0, stdout: `${nname}\n` });
      }
      if (sub === "rm") {
        networks = networks.filter((n) => n.name !== argv[2]);
        return wait({ ...base, ok: true, code: 0, stdout: `${argv[2]}\n` });
      }
      if (sub === "connect" || sub === "disconnect") {
        const [, , net, container] = argv;
        networks = networks.map((n) => {
          if (n.name !== net) return n;
          if (sub === "connect")
            return n.members.some((m) => m.name === container) ? n : { ...n, members: [...n.members, { name: container, ip: `${n.subnet.split(".").slice(0, 2).join(".")}.0.${90 + n.members.length}` }] };
          return { ...n, members: n.members.filter((m) => m.name !== container) };
        });
        return wait({ ...base, ok: true, code: 0, stdout: `${container}\n` });
      }
    }
    const name = argv[argv.length - 1];
    workloads = workloads.map((w) =>
      w.name !== name ? w
        : argv.includes("start") || argv.includes("restart") ? { ...w, status: w.type === "vm" ? "Running" : "Up 1 second" }
        : argv.includes("stop") ? { ...w, status: w.type === "vm" ? "Stopped" : "Exited (0) 1 second ago" }
        : w,
    );
    if (argv.includes("rm")) workloads = workloads.filter((w) => w.name !== name);
    return wait({ ...base, ok: true, code: 0, stdout: `${name}\n` });
  }

  // Duplo local: o login "aceita" sempre (sem engine). A password é ignorada.
  async login(registry: string, username: string, _password: string): Promise<CliResult> {
    void _password;
    return wait({ ok: true, code: 0, stdout: `Login Succeeded (${username}@${registry})\n`, stderr: "", argv: ["delonix", "image", "login", registry, "-u", username, "--password-stdin"] });
  }

  async stream(_id: string, argv: Argv, onLine: (line: string) => void, onEnd?: (code: number | null) => void) {
    // `image pull` simulado: emite progresso e TERMINA com código 0 (sucesso),
    // acrescentando a imagem à lista como o engine faria.
    if (argv[0] === "image" && argv[1] === "pull") {
      const refArg = argv[2] ?? "alpine:3.20";
      const steps = [`pulling ${refArg}…`, "platform selected: linux/amd64", "copying blob sha256:… done", "copying config sha256:… done", `✓ ${refArg}`];
      let i = 0;
      const t = setInterval(() => {
        if (i < steps.length) { onLine(steps[i++]); return; }
        clearInterval(t);
        if (!images.some((im) => im.ref === refArg)) {
          images = [{ ref: refArg, tags: [refArg], id: Math.random().toString(16).slice(2, 14), size: "12,0 MiB", created: "agora · há instantes", orphan: true, usedBy: [] }, ...images];
        }
        onEnd?.(0);
      }, 400);
      return () => clearInterval(t);
    }
    // `cluster create` simulado: emite o progresso do bootstrap e TERMINA,
    // acrescentando o cluster à lista (como o engine faria ao concluir).
    if (argv[0] === "cluster" && argv[1] === "create") {
      const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
      const name = flag("--name") ?? `rei-${Math.random().toString(36).slice(2, 6)}`;
      const steps = [
        `• a criar o cluster kind-mode '${name}' (sem Docker)`,
        "• a arrancar o nó control-plane (kindest/node)",
        "• kubeadm init — a escrever os certificados e o control-plane estático",
        "• a instalar o CNI (kindnet)",
        "• a juntar os nós worker",
        "• a exportar o kubeconfig e a juntar a ~/.kube/config",
        `✓ cluster '${name}' pronto — delonix cluster kubeconfig ${name}`,
      ];
      let i = 0;
      const t = setInterval(() => {
        if (i < steps.length) { onLine(steps[i++]); return; }
        clearInterval(t);
        if (!mockClusters.some((c) => c.name === name)) {
          mockClusters = [...mockClusters, {
            name, mode: "kind", state: "up",
            controlPlanes: flag("--control-planes") ?? "1",
            workers: flag("--workers") ?? "0",
            apiPort: flag("--api-port") ?? "6443",
            k8sVersion: "v1.31.0",
          }];
        }
        onEnd?.(0);
      }, 500);
      return () => clearInterval(t);
    }
    // Um `build` simulado: emite algumas linhas e TERMINA (dispara onEnd). Os
    // fluxos infinitos (logs/eventos) continuam a correr até se parar.
    if (argv[0] === "build") {
      // Tag do `-t <tag>` — a imagem resultante é registada em `images` no fim,
      // para a tela de Build a encontrar (sinal de sucesso), como o engine faria.
      const ti = argv.indexOf("-t");
      const builtTag = ti >= 0 ? argv[ti + 1] : "minha-app:v1";
      const steps = ["STEP 1/4 FROM alpine:3.20", "STEP 2/4 RUN apk add --no-cache ca-certificates", "STEP 3/4 COPY . /app", "STEP 4/4 CMD [\"/app/server\"]", "--> a escrever manifesto", `COMMIT ${builtTag} (duplo local) — sem engine`];
      let i = 0;
      const t = setInterval(() => {
        if (i < steps.length) { onLine(steps[i++]); return; }
        clearInterval(t);
        if (!images.some((im) => im.ref === builtTag)) {
          images = [{ ref: builtTag, tags: [builtTag], id: Math.random().toString(16).slice(2, 14), size: "48,0 MiB", created: "agora · há instantes", orphan: true, usedBy: [] }, ...images];
        }
        onEnd?.(0);
      }, 600);
      return () => clearInterval(t);
    }
    // `stack apply` / `stack wait` simulados (Architecture Studio §11): emitem
    // alguns passos e TERMINAM com código 0. O apply marca o stack como aplicado
    // (para o `stack ls`/plano do duplo refletirem presença).
    if (argv[0] === "stack" && (argv[1] === "apply" || argv[1] === "wait")) {
      const steps = argv[1] === "apply"
        ? ["• a aplicar por ordem de dependências (Network→Volume→Image→Vm→Container)", "• Network app ✓", "• Container web ✓", "• Container db ✓", "✓ stack apply concluído (duplo local — sem engine)"]
        : ["• a aguardar que cada recurso fique Ready…", "• web: Ready", "• db: Ready", "✓ tudo Ready (duplo local — sem engine)"];
      if (argv[1] === "apply") stackApplied = true;
      let i = 0;
      const t = setInterval(() => {
        if (i < steps.length) { onLine(steps[i++]); return; }
        clearInterval(t);
        onEnd?.(0);
      }, 400);
      return () => clearInterval(t);
    }
    let i = 0;
    const t = setInterval(() => onLine(`${new Date().toISOString().replace("T", " ").slice(0, 23)}  ${LOG[i++ % LOG.length]}`), 900);
    return () => clearInterval(t);
  }

  // Duplo local: o mesmo fluxo falso de logs (não há node-api gRPC no browser).
  async containerLogs(_id: string, _name: string, _namespace: string, onLine: (line: string) => void, _timestamps = false) {
    let i = 0;
    const t = setInterval(() => onLine(`${new Date().toISOString().replace("T", " ").slice(0, 23)}  ${LOG[i++ % LOG.length]}`), 900);
    return () => clearInterval(t);
  }

  async exec(_id: string, name: string, mode: ExecMode, onData: (data: string) => void, _onEnd: () => void): Promise<ExecSession> {
    // Duplo local: cada modo tem a sua semântica simulada (sem engine).
    // - attach/vm-console: OUTPUT-ONLY (não há eco de stdin; o attach do engine
    //   recusa -i e a consola série não é um shell que ecoa aqui).
    // - host: a CONSOLA DO HOST — simula o shell de login da máquina (eco local).
    //   No duplo não há máquina real; o banner deixa claro que é a consola do host.
    // - exec/pod-exec: um shell que ecoa o que se escreve.
    const prompt = mode === "host"
      ? `\x1b[2mduplo local — CONSOLA DO HOST (shell de login da máquina; acesso total ao host)\x1b[0m\r\n$ `
      : null;
    if (mode === "container-attach" || mode === "vm-console") {
      const banner = mode === "vm-console"
        ? `\x1b[2mduplo local — consola série de ${name} (Ctrl-D sai; não é shell autenticado)\x1b[0m\r\n`
        : `\x1b[2mduplo local — attach à saída do processo principal de ${name} (só saída; detach não mata o workload)\x1b[0m\r\n`;
      onData(banner);
      let i = 0;
      const t = setInterval(() => onData(`${LOG[i++ % LOG.length]}\r\n`), 900);
      return { write: () => {}, resize: () => {}, stop: () => clearInterval(t) };
    }
    const where = mode === "pod-exec" ? `membro do pod ${name}` : name;
    onData(prompt ?? `\x1b[2mduplo local — shell simulado em ${where}\x1b[0m\r\n$ `);
    let line = "";
    return {
      write: (data: string) => {
        for (const ch of data) {
          if (ch === "\r") { onData(`\r\n$ `); line = ""; }
          else if (ch === "\x7f") { if (line) { line = line.slice(0, -1); onData("\b \b"); } }
          else { line += ch; onData(ch); }
        }
      },
      resize: () => {},
      stop: () => {},
    };
  }

  // Identidade do host simulada (o browser não tem uma máquina real por trás).
  hostIdentity(): Promise<HostIdentity> {
    return wait({ user: "demo", host: "duplo-local", shell: "/bin/bash" });
  }

  // --- VMs pelo socket node.v1 (§5), simuladas ---------------------------

  vmList = () => wait(workloads.filter((w) => w.type === "vm").map(mockVm));

  async vmGet(name: string): Promise<VmDetail> {
    const w = workloads.find((x) => x.name === name && x.type === "vm");
    if (!w) throw new Error(`VM ${name} não encontrada (duplo local)`);
    return wait(mockVm(w));
  }

  async vmCreate(spec: VmCreateInput): Promise<void> {
    const gib = spec.memoryBytes / 1024 ** 3;
    workloads = [
      ...workloads,
      { type: "vm", name: spec.name, status: "Running", info: `${spec.vcpus} vCPU, ${gib ? `${Math.round(gib)}G` : "1G"}`, namespace: "default" },
    ];
    snapshots[spec.name] = [];
    return wait(undefined);
  }

  async vmStart(name: string): Promise<void> {
    workloads = workloads.map((w) => (w.name === name ? { ...w, status: "Running" } : w));
    return wait(undefined);
  }

  async vmStop(name: string): Promise<void> {
    workloads = workloads.map((w) => (w.name === name ? { ...w, status: "Stopped" } : w));
    return wait(undefined);
  }

  async vmDelete(name: string): Promise<void> {
    workloads = workloads.filter((w) => w.name !== name);
    delete snapshots[name];
    return wait(undefined);
  }

  vmSnapshotList = (name: string) => wait(snapshots[name] ?? []);

  async vmSnapshotCreate(name: string, snapshot: string): Promise<void> {
    const w = workloads.find((x) => x.name === name);
    snapshots[name] = [
      ...(snapshots[name] ?? []).filter((s) => s.name !== snapshot),
      { name: snapshot, includesMemory: w?.status === "Running", state: w?.status === "Running" ? "running" : "shutoff" },
    ];
    return wait(undefined);
  }

  async vmSnapshotRestore(name: string, _snapshot: string): Promise<void> {
    void name;
    return wait(undefined);
  }

  // Duplo local: a forma de um Container do contrato node.v1 (meta/spec/status),
  // para a aba "Inspecionar" mostrar JSON plausível sem node-api no browser.
  async containerInspect(namespace: string, name: string): Promise<unknown> {
    const w = workloads.find((x) => x.name === name);
    return wait({
      meta: { name, namespace: w?.namespace || namespace || "default" },
      spec: { image: w?.info ?? "" },
      status: { phase: /^(Up|Running)/.test(w?.status ?? "") ? "CONTAINER_PHASE_RUNNING" : "CONTAINER_PHASE_EXITED" },
    });
  }

  // Ciclo de vida de container no duplo local: muta o array (como as VMs).
  async containerStart(_namespace: string, name: string): Promise<void> {
    workloads = workloads.map((w) => (w.name === name ? { ...w, status: "Up 1 second" } : w));
    return wait(undefined);
  }

  async containerStop(_namespace: string, name: string): Promise<void> {
    workloads = workloads.map((w) => (w.name === name ? { ...w, status: "Exited (0) 1 second ago" } : w));
    return wait(undefined);
  }

  async containerRestart(_namespace: string, name: string): Promise<void> {
    workloads = workloads.map((w) => (w.name === name ? { ...w, status: "Up 1 second" } : w));
    return wait(undefined);
  }

  async containerRemove(_namespace: string, name: string): Promise<void> {
    workloads = workloads.filter((w) => w.name !== name);
    return wait(undefined);
  }

  // Duplo local: contadores que crescem a cada amostra (para as taxas não serem 0).
  async containerStats(_namespace: string, _name: string): Promise<ContainerStatsSample> {
    this.statsTick += 1;
    const t = this.statsTick;
    return wait({
      cpuUsageNanos: t * 180_000_000, // ~18% de um núcleo entre amostras de 1s
      memoryWorkingSetBytes: 64 * 1024 * 1024,
      memoryLimitBytes: 0,
      pids: 7,
      networkRxBytes: t * 12_000,
      networkTxBytes: t * 3_000,
      writableLayerBytes: 2 * 1024 * 1024,
      unmeasured: [],
    });
  }
  private statsTick = 0;

  async events(onEvent: (e: EngineEvent) => void, _onEnd?: () => void) {
    void _onEnd; // o duplo local não termina o fluxo — sem reconexão a simular
    // `ts` em epoch (segundos); os dois eventos "15:06:03" partilham o MESMO ts
    // para exercitar a correlação ao segundo. `time` é a hora já formatada.
    const seed: EngineEvent[] = [
      { ts: 1792935730, time: "15:02:10", kind: "container", action: "log", name: "odoo-16", detail: "A atualizar módulos: -u all" },
      { ts: 1792935963, time: "15:06:03", kind: "container", action: "oom", name: "odoo-16", detail: "morto pelo kernel · código 137" },
      { ts: 1792935963, time: "15:06:03", kind: "container", action: "error", name: "postgres-dev", detail: "ligação reiniciada pelo cliente 10.89.2.4" },
      { ts: 1792936001, time: "15:06:41", kind: "container", action: "warning", name: "postgres-dev", detail: "a terminar ligações" },
    ];
    seed.forEach(onEvent);
    return () => {};
  }
}
