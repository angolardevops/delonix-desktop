// Tipos que espelham o JSON do CLI (ADR-0005 do delonix-runtime).
// Fonte: crates/interfaces/delonix-mgmt/src/dashstats.rs (DashSummary),
// bins/delonix-runtime-bin/src/cmd/workload.rs (WorkloadRow),
// crates/contexts/delonix-compute/src/capability.rs (CapabilityState).
// Campos de imagens, volumes, redes e providers: confirmar contra `-o json`
// real; o cliente normaliza e tolera campos em falta.

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
  storage_bytes_images: number | null;
  storage_bytes_volumes: number | null;
  storage_bytes_vm_images: number | null;
  storage_bytes_containers: number | null;
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

export interface McpTool {
  name: string;
  risk: RiskLevel;
}
