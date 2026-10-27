import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ContainerStatsSample, DelonixClient, ExecMode, ExecSession, HostIdentity } from "./client";
import { cmd, kubectl, type Argv } from "./cli";
import { buildEngineInfo, type EngineInfo } from "./engine";
import { parseDoctor } from "./doctor";
import { fmtUnix } from "./format";
import { crossRefUsedBy, nodeImageToRow } from "./images";
import { parseSecretInspect } from "./secrets";
import type {
  BackupRow, CapabilityLabel, CapabilityRow, CliResult, ClusterRow, ComposeService, DashRow, DashSummary, DoctorItem, EngineEvent, ImageRow, K8sNode, K8sPod, NetDiagnoseFinding, NetworkRow, ProviderReport, PodCreateInput, ResourceAdvice, ResourceBottleneck, ResourceSeverity, RiskLevel, SecretReveal, SecretRow, StackPlanRow, SystemMetrics, SystemResources, VmCreateInput, VmDetail, VmSnapshot, VolumeRow, WorkloadRow,
} from "./types";

type Obj = Record<string, unknown>;
const json = <T>(args: Argv) => invoke<T>("dlx_json", { args });

// Lê o primeiro campo presente entre vários nomes possíveis. Os nomes reais
// vêm do `-o json` do engine; confirmar e encurtar estas listas.
const pick = (o: Obj, ...keys: string[]): unknown => keys.map((k) => o[k]).find((v) => v !== undefined && v !== null);
const str = (o: Obj, ...keys: string[]) => {
  const v = pick(o, ...keys);
  return v === undefined ? "" : String(v);
};
const list = (o: Obj, ...keys: string[]) => {
  const v = pick(o, ...keys);
  return Array.isArray(v) ? v.map(String) : [];
};
const asArray = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
// Razão de falha de uma Operation terminal (null = sucesso): o `error` RFC 9457
// quando presente, senão um `state` que indique falha.
const operationError = (op: Obj): string | null => {
  const e = pick(op, "error");
  if (e && typeof e === "object") {
    const msg = str(e as Obj, "message", "detail", "title");
    if (msg) return msg;
  }
  const state = str(op, "state");
  if (/fail|error/i.test(state)) return str(op, "result") || `operação ${state}`;
  return null;
};
// Ação de uma PlannedChange do StackService → a palavra que a UI usa. O proto3
// JSON serializa a enum pelo NOME (`CHANGE_ACTION_CREATE`); também aceitamos já
// a palavra crua (robustez). NO_OP/UNSPECIFIED → "noop".
const planActionWord = (raw: string): string => {
  const a = raw.replace(/^CHANGE_ACTION_/, "").toLowerCase().replace(/_/g, "");
  if (a === "create") return "create";
  if (a === "update") return "update";
  if (a === "replace") return "replace";
  if (a === "delete") return "delete";
  if (a === "adopt") return "adopt";
  if (a === "conflict") return "conflict";
  return "noop"; // noop / unspecified / vazio
};
// Número numérico-real, ou null (mantém "não medido" distinto de 0).
const num = (o: Obj, ...keys: string[]): number | null => {
  const v = pick(o, ...keys);
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
// Booleano, ou null quando o campo falta (não assumir false).
const bool = (o: Obj, ...keys: string[]): boolean | null => {
  const v = pick(o, ...keys);
  return v === undefined || v === null ? null : Boolean(v);
};
// Uma row numérica do dashboard (métricas por recurso, §8).
const toRow = (o: Obj): DashRow => ({
  kind: str(o, "kind", "type"),
  name: str(o, "name"),
  status: str(o, "status"),
  up: bool(o, "up"),
  extra: str(o, "extra"),
  ok: bool(o, "ok"),
  cpu_usage_usec: num(o, "cpu_usage_usec"),
  mem_bytes: num(o, "mem_bytes"),
  io_read_bytes: num(o, "io_read_bytes"),
  io_write_bytes: num(o, "io_write_bytes"),
  net_rx_bytes: num(o, "net_rx_bytes"),
  net_tx_bytes: num(o, "net_tx_bytes"),
});

// O `dashboard --json` formata os valores em string ("224.0 KiB", "0/0").
// Extrai os inteiros de um valor de tile ("0/0" → [0,0]; "7" → [7]).
const ints = (s: string): number[] => (s.match(/\d+/g) ?? []).map(Number);
// Converte bytes humanos do engine ("224.0 KiB", "53.07 GiB", "0 B") em número.
// Unidades binárias (KiB=1024); tolera KB/MB/… e devolve null se não houver nenhum.
const BYTE_UNIT: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
const parseBytes = (s: string): number | null => {
  const m = /(-?[\d.]+)\s*([KMGT]?i?B)\b/i.exec(s);
  if (!m) return null;
  return Number(m[1]) * (BYTE_UNIT[m[2].toUpperCase().replace("IB", "B")] ?? 1);
};

// Normaliza uma entrada de `problems[]` (string crua ou objeto com mensagem).
const toProblem = (p: unknown): string =>
  typeof p === "string" ? p : str(p as Obj, "message", "detail", "finding", "text", "title");

// Severidade de um conselho, tolerante a rótulos próximos; default "info".
const toSeverity = (s: string): ResourceSeverity => {
  const v = s.toLowerCase();
  if (v === "blocking" || v === "critical" || v === "error") return "blocking";
  if (v === "warn" || v === "warning") return "warn";
  return "info";
};

// Parseia a tabela TEXTO do `backup ls` (sem -o json no 5.1.1). Colunas
// ARCHIVE KIND NAME CREATED SIZE HOST separadas por 2+ espaços; a 1ª linha é o
// cabeçalho. Heurística tolerante a colunas vazias/desalinhadas.
const parseBackupTable = (stdout: string): BackupRow[] => {
  const lines = stdout.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim().length);
  if (lines.length === 0) return [];
  const header = lines[0].toUpperCase();
  const body = header.includes("ARCHIVE") && header.includes("KIND") ? lines.slice(1) : lines;
  return body.map((l) => {
    const c = l.split(/\s{2,}/).map((x) => x.trim());
    return {
      archive: c[0] ?? "",
      kind: c[1] ?? "",
      name: c[2] ?? "",
      created: c[3] ?? "",
      size: c[4] ?? "",
      host: c[5] ?? "",
    };
  }).filter((b) => b.archive);
};

// Parser TOLERANTE das tabelas TEXTO do engine (output::Table: GAP=3 espaços
// entre colunas; células vazias são preenchidas com "-"/"—", nunca em branco,
// por isso nunca colapsam). Lê o CABEÇALHO e devolve (header, rows) por células
// separadas por 2+ espaços — um valor interno com UM espaço ("2/3 up", "API
// PORT") fica inteiro. Linhas de aviso/erro/vazias ("(no clusters…)") são
// descartadas. Mapeia-se cada coluna pelo NOME (resiste a reordenação).
const parseTable = (stdout: string): { header: string[]; rows: string[][] } => {
  const lines = stdout
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => {
      const t = l.trim();
      return t.length > 0 && !t.startsWith("(") && !/^(warning|error)\b/i.test(t);
    });
  if (lines.length === 0) return { header: [], rows: [] };
  const split = (l: string) => l.split(/\s{2,}/).map((x) => x.trim());
  return { header: split(lines[0]), rows: lines.slice(1).map(split) };
};
// Valor da coluna `label` de uma linha, por posição no cabeçalho; "" se ausente.
const colOf = (header: string[], row: string[], label: string): string => {
  const i = header.findIndex((h) => h.toUpperCase() === label.toUpperCase());
  return i >= 0 ? (row[i] ?? "") : "";
};

const LABELS: CapabilityLabel[] = [
  "supported", "partial", "unsupported-by-provider", "requires-external-component", "not-implemented", "unavailable-on-host",
];

const toCapability = (o: Obj): CapabilityRow => {
  const state = str(o, "state", "label", "status") as CapabilityLabel;
  return {
    name: str(o, "name", "capability", "id"),
    state: LABELS.includes(state) ? state : "not-implemented",
    detail: str(o, "detail", "evidence", "reason", "component"),
  };
};

// Normaliza uma VM do contrato (`node_vm_get`/`node_vm_list`). O JSON vem em
// snake_case (preserve_proto_field_names); `memory_bytes` é string (int64 do
// proto3) → num() converte-a. Estrutura meta/spec/status do VirtualMachine.
const toVm = (o: Obj): VmDetail => {
  const meta = (pick(o, "meta") ?? {}) as Obj;
  const spec = (pick(o, "spec") ?? {}) as Obj;
  const status = (pick(o, "status") ?? {}) as Obj;
  return {
    name: str(meta, "name"),
    namespace: str(meta, "namespace") || "default",
    phase: str(status, "phase"),
    provider: str(status, "provider") || str(spec, "provider"),
    ipAddresses: list(status, "ip_addresses"),
    ipPredicted: bool(status, "ip_predicted") ?? false,
    vcpus: num(spec, "vcpus") ?? 0,
    memoryBytes: num(spec, "memory_bytes") ?? 0,
    image: str(spec, "image"),
  };
};

// Namespace default do contrato quando a UI não passa um (seletor global).
const DEFAULT_NS = "default";

// `ContainerPhase` do contrato node.v1 → o texto de estado que a UI classifica
// (runState em hooks.ts: "Running"/"Up …" → running; "Exited (N)" N≠0 → error).
// O `(137)` em EXITED mantém o detetor de OOM da tela (chip "morto por OOM").
const phaseToStatus = (status: Obj): string => {
  const phase = str(status, "phase");
  const code = pick(status, "exit_code");
  const reason = str(status, "reason");
  switch (phase) {
    case "CONTAINER_PHASE_RUNNING": return "Running";
    case "CONTAINER_PHASE_CREATED": return "Created";
    case "CONTAINER_PHASE_PAUSED": return "Paused";
    case "CONTAINER_PHASE_EXITED":
    case "CONTAINER_PHASE_DEAD":
      return `Exited (${code ?? "?"})${reason ? ` ${reason}` : ""}`;
    default: return phase.replace(/^CONTAINER_PHASE_/, "") || "—";
  }
};

// Um Container do contrato node.v1 (meta/spec/status) → WorkloadRow (a forma que
// a lista de Workloads consome).
const nodeContainerToRow = (o: Obj): WorkloadRow => {
  const meta = (pick(o, "meta") ?? {}) as Obj;
  const spec = (pick(o, "spec") ?? {}) as Obj;
  const status = (pick(o, "status") ?? {}) as Obj;
  return {
    type: "container",
    name: str(meta, "name"),
    status: phaseToStatus(status),
    info: str(spec, "image"),
    namespace: str(meta, "namespace") || DEFAULT_NS,
  };
};

// Pod do PodService (node.v1) → linha de workload. O estado deriva da condição
// "Ready" (o engine põe-na True quando todos os membros correm); o info conta os
// membros e quantos estão a correr. Os pods são DERIVADOS dos containers.
const nodePodToRow = (o: Obj): WorkloadRow => {
  const meta = (pick(o, "meta") ?? {}) as Obj;
  const members = asArray(pick(o, "members"));
  const conditions = asArray(pick(o, "conditions"));
  const ready = conditions.find((c) => str(c, "type") === "Ready");
  const isReady = str(ready ?? {}, "status") === "CONDITION_STATUS_TRUE";
  const running = members.filter(
    (m) => str((pick(m, "status") ?? {}) as Obj, "phase") === "CONTAINER_PHASE_RUNNING",
  ).length;
  const total = members.length;
  return {
    type: "pod",
    name: str(meta, "name"),
    status: isReady ? "Ready" : `${running}/${total} up`,
    info: `${total} ${total === 1 ? "container" : "containers"}`,
    namespace: str(meta, "namespace") || DEFAULT_NS,
  };
};

// Um Network do contrato node.v1 → NetworkRow (sem membros; esses derivam-se dos
// containers). driver/bridge/gateway vêm de spec.extensions.by_provider.linux;
// subnet de spec.ipv4_cidr; o driver cai para a topologia quando o provider não
// o expõe.
const nodeNetworkToRow = (o: Obj): NetworkRow => {
  const meta = (pick(o, "meta") ?? {}) as Obj;
  const spec = (pick(o, "spec") ?? {}) as Obj;
  const ext = (pick(spec, "extensions") ?? {}) as Obj;
  const byProv = (pick(ext, "by_provider") ?? {}) as Obj;
  const linux = (pick(byProv, "linux") ?? {}) as Obj;
  const topo = str(spec, "topology");
  return {
    name: str(meta, "name"),
    driver: str(linux, "driver") || (topo === "NETWORK_TOPOLOGY_OVERLAY" ? "overlay" : "bridge"),
    subnet: str(spec, "ipv4_cidr"),
    bridge: str(linux, "bridge"),
    gateway: str(linux, "gateway"),
    members: [],
  };
};

// Membros de cada rede, reconstruídos dos containers: um container ligado a uma
// rede tem `spec.networks[].{network, ipv4_address}` (IP vazio → o 1.º
// status.ip_addresses). O contrato não lista membros do lado da rede.
const networkMembers = (containers: Obj[]): Map<string, { name: string; ip: string }[]> => {
  const m = new Map<string, { name: string; ip: string }[]>();
  for (const c of containers) {
    const name = str((pick(c, "meta") ?? {}) as Obj, "name");
    const spec = (pick(c, "spec") ?? {}) as Obj;
    const status = (pick(c, "status") ?? {}) as Obj;
    for (const att of asArray(pick(spec, "networks"))) {
      const net = str(att, "network");
      if (!net) continue;
      const ip = str(att, "ipv4_address") || list(status, "ip_addresses")[0] || "";
      (m.get(net) ?? m.set(net, []).get(net)!).push({ name, ip });
    }
  }
  return m;
};

// Quem monta cada volume, reconstruído dos containers (`spec.mounts[].volume`).
// O contrato não lista os utilizadores do lado do volume.
const volumeUsers = (containers: Obj[]): Map<string, string[]> => {
  const m = new Map<string, string[]>();
  for (const c of containers) {
    const name = str((pick(c, "meta") ?? {}) as Obj, "name");
    const spec = (pick(c, "spec") ?? {}) as Obj;
    for (const mnt of asArray(pick(spec, "mounts"))) {
      const vol = str(mnt, "volume");
      if (!vol) continue;
      (m.get(vol) ?? m.set(vol, []).get(vol)!).push(name);
    }
  }
  return m;
};

// --- Normalização do `-o json` do kubectl (items[]) ------------------------
// Um nó: nome, condição Ready, agendável (!unschedulable), papéis (das labels
// node-role.kubernetes.io/*) e versão do kubelet.
const toK8sNode = (o: Obj): K8sNode => {
  const meta = (pick(o, "metadata") ?? {}) as Obj;
  const spec = (pick(o, "spec") ?? {}) as Obj;
  const status = (pick(o, "status") ?? {}) as Obj;
  const conds = asArray(pick(status, "conditions"));
  const readyCond = conds.find((c) => str(c, "type") === "Ready");
  const ready = str(readyCond ?? {}, "status") === "True";
  const labels = (pick(meta, "labels") ?? {}) as Obj;
  const roles = Object.keys(labels)
    .map((k) => /^node-role\.kubernetes\.io\/(.+)$/.exec(k)?.[1])
    .filter((r): r is string => Boolean(r));
  const nodeInfo = (pick(status, "nodeInfo") ?? {}) as Obj;
  const schedulable = !(bool(spec, "unschedulable") ?? false);
  return {
    name: str(meta, "name"),
    ready,
    status: ready ? "Ready" : "NotReady",
    schedulable,
    roles: roles.length ? roles : ["<none>"],
    version: str(nodeInfo, "kubeletVersion"),
  };
};

// Um pod: namespace/nome, fase, prontos/total, soma de restarts e nó agendado.
const toK8sPod = (o: Obj): K8sPod => {
  const meta = (pick(o, "metadata") ?? {}) as Obj;
  const spec = (pick(o, "spec") ?? {}) as Obj;
  const status = (pick(o, "status") ?? {}) as Obj;
  const cs = asArray(pick(status, "containerStatuses"));
  const total = cs.length;
  const readyN = cs.filter((c) => bool(c, "ready") === true).length;
  const restarts = cs.reduce((sum, c) => sum + (num(c, "restartCount") ?? 0), 0);
  return {
    namespace: str(meta, "namespace") || "default",
    name: str(meta, "name"),
    phase: str(status, "phase") || "Unknown",
    ready: `${readyN}/${total}`,
    restarts,
    node: str(spec, "nodeName"),
  };
};

export class TauriClient implements DelonixClient {
  readonly live = true;

  binary() {
    return invoke<string>("dlx_bin");
  }

  // Descoberta de versão/capacidades (§3). `version` é TEXTO (lê-se por dlx_run,
  // classe Read); a contagem de capacidades vem de `mcp capabilities` (JSON).
  // Best-effort e tolerante: se o engine não responder, degrada sem lançar
  // (version="" → compatible=true, não alarma).
  async engine(): Promise<EngineInfo> {
    const vr = await invoke<CliResult>("dlx_run", { args: cmd.version(), confirm: false }).catch(() => null);
    const raw = vr?.ok ? vr.stdout : "";
    let caps = 0;
    try {
      const tools = await json<unknown>(cmd.mcpTools());
      caps = Array.isArray(tools) ? tools.length : asArray((tools as Obj)?.tools ?? (tools as Obj)?.capabilities).length;
    } catch {
      /* sem mcp capabilities: capacidades ficam a 0 (não bloqueia o arranque) */
    }
    return buildEngineInfo(raw, caps);
  }

  async dash(): Promise<DashSummary> {
    const raw = (await json<Obj>(cmd.dash())) ?? {};
    const tiles = asArray(raw.tiles);
    const by = (label: string) => tiles.find((t) => str(t, "label").toUpperCase() === label) ?? {};
    const cnt = (label: string) => ints(str(by(label), "value"));
    const c = cnt("CONTAINERS");
    const v = cnt("VMS");
    const mem = by("MEMORY");
    const [rx, tx] = str(by("TRAFFIC"), "value").split("/");
    return {
      containers_running: c[0] ?? 0,
      containers_total: c[1] ?? 0,
      vms_running: v[0] ?? 0,
      vms_total: v[1] ?? 0,
      networks_total: cnt("NETWORKS")[0] ?? 0,
      volumes_total: cnt("VOLUMES")[0] ?? 0,
      images_total: cnt("IMAGES")[0] ?? 0,
      secrets_total: cnt("SECRETS")[0] ?? 0,
      // "224.0 KiB" (value) de "of 53.07 GiB slice limit" (sub).
      memory_bytes_used: parseBytes(str(mem, "value")) ?? 0,
      memory_bytes_limit: parseBytes(str(mem, "sub")) ?? 0,
      network_rx_bytes: parseBytes(rx ?? ""),
      network_tx_bytes: parseBytes(tx ?? ""),
      storage_bytes_total: parseBytes(str(by("STORAGE"), "value")),
      // Métricas numéricas por recurso: parseadas em paralelo às tiles humanas.
      rows: asArray(raw.rows).map(toRow),
      // `problems[]`: alertas já formatados pelo engine (texto).
      problems: asArray(raw.problems).map(toProblem).filter((p) => p.length > 0),
    };
  }

  // --- Dashboard SRE (§B) -------------------------------------------------
  // `system metrics -o json` é JSON PLANO (a DashStats crua); mapeado 1:1. O
  // storage vem por categoria — o total calcula-se em lib/metrics.ts.
  async systemMetrics(): Promise<SystemMetrics> {
    const o = (await json<Obj>(cmd.systemMetrics())) ?? {};
    return {
      containers_running: num(o, "containers_running") ?? 0,
      containers_total: num(o, "containers_total") ?? 0,
      vms_running: num(o, "vms_running") ?? 0,
      vms_total: num(o, "vms_total") ?? 0,
      networks_total: num(o, "networks_total") ?? 0,
      volumes_total: num(o, "volumes_total") ?? 0,
      images_total: num(o, "images_total") ?? 0,
      secrets_total: num(o, "secrets_total") ?? 0,
      memory_bytes_used: num(o, "memory_bytes_used") ?? 0,
      memory_bytes_limit: num(o, "memory_bytes_limit") ?? 0,
      network_rx_bytes: num(o, "network_rx_bytes"),
      network_tx_bytes: num(o, "network_tx_bytes"),
      network_unmeasured_containers: num(o, "network_unmeasured_containers") ?? 0,
      storage_bytes_images: num(o, "storage_bytes_images") ?? 0,
      storage_bytes_volumes: num(o, "storage_bytes_volumes") ?? 0,
      storage_bytes_vm_images: num(o, "storage_bytes_vm_images") ?? 0,
      storage_bytes_containers: num(o, "storage_bytes_containers") ?? 0,
    };
  }

  // `system resources -o json`: advice[] (conselhos acionáveis), bottleneck (o
  // gargalo agora, pode ser null), pressure[] (PSI) e host (capacidade do nó).
  async systemResources(): Promise<SystemResources> {
    const o = (await json<Obj>(cmd.systemResources())) ?? {};
    const advice: ResourceAdvice[] = asArray(o.advice).map((a) => ({
      id: str(a, "id"),
      subject: str(a, "subject"),
      severity: toSeverity(str(a, "severity")),
      finding: str(a, "finding"),
      action: str(a, "action"),
      class: str(a, "class"),
    }));
    const bRaw = pick(o, "bottleneck");
    let bottleneck: ResourceBottleneck | null = null;
    if (bRaw && typeof bRaw === "object") {
      const b = bRaw as Obj;
      bottleneck = {
        resource: str(b, "resource", "subject", "kind"),
        detail: str(b, "detail", "finding", "reason", "why"),
        severity: pick(b, "severity") != null ? toSeverity(str(b, "severity")) : null,
      };
    }
    const host = (pick(o, "host") ?? {}) as Obj;
    return {
      advice,
      bottleneck,
      pressure: asArray(o.pressure).map((p) => ({
        resource: str(p, "resource"),
        avg10: num(p, "avg10") ?? 0,
        avg60: num(p, "avg60") ?? 0,
        avg300: num(p, "avg300") ?? 0,
      })),
      host: {
        cpus: num(host, "cpus"),
        cpuTemperatureC: num(host, "cpu_temperature_c"),
        memoryBytes: num(host, "memory_bytes"),
        memoryAvailableBytes: num(host, "memory_available_bytes"),
        stateRootFreeBytes: num(host, "state_root_free_bytes"),
        swapBytes: num(host, "swap_bytes"),
        swapUsedBytes: num(host, "swap_used_bytes"),
      },
    };
  }

  // Containers SÓ pelo contrato node.v1 (ContainerService.ListContainers) — sem
  // fallback CLI (decisão B). Se o engine não servir ContainerService (501), a
  // lista de containers fica vazia; o detalhe (Inspecionar/Logs) mostra o erro.
  // VMs e pods continuam a vir da CLI (`workload ls`) enquanto essas fatias não
  // migram — por isso ficam disponíveis mesmo com o node-api em baixo.
  private async nodeContainersRaw(namespace?: string): Promise<Obj[]> {
    const resp = (await invoke<Obj>("node_containers", { namespace: namespace ?? DEFAULT_NS })) ?? {};
    return asArray(pick(resp, "containers"));
  }

  private async nodeContainers(namespace?: string): Promise<WorkloadRow[]> {
    return (await this.nodeContainersRaw(namespace)).map(nodeContainerToRow);
  }

  // Pods pelo contrato node.v1 (PodService.ListPods, REST) — derivados dos
  // containers no engine. Só leitura; se o node-api não servir, fica vazio.
  private async nodePods(namespace?: string): Promise<WorkloadRow[]> {
    const resp = (await invoke<Obj>("node_pods", { namespace: namespace ?? DEFAULT_NS })) ?? {};
    return asArray(pick(resp, "pods")).map(nodePodToRow);
  }

  // CreatePod pelo contrato (POST .../pods). Constrói o CreatePodRequest a
  // partir do formulário: cada container vira `{name, spec:{image, entrypoint,
  // env}}` (o comando do form é o `entrypoint`/`command:` do manifesto k8s — o
  // "corre exatamente isto"). Operation terminal; lança se falhar.
  async podCreate(input: PodCreateInput): Promise<void> {
    const split = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
    const containers = input.containers.map((c) => {
      const spec: Obj = { image: c.image.trim() };
      const cmd = c.command.trim().split(/\s+/).filter(Boolean);
      if (cmd.length) spec.entrypoint = cmd;
      const env = Object.fromEntries(
        split(c.env).map((kv) => {
          const i = kv.indexOf("=");
          return i < 0 ? [kv, ""] : [kv.slice(0, i), kv.slice(i + 1)];
        }),
      );
      if (Object.keys(env).length) spec.env = env;
      return { name: c.name.trim(), spec };
    });
    const body = {
      name: input.name.trim(),
      spec: { containers, shareProcessNamespace: input.shareProcessNamespace ?? false },
    };
    const op = (await invoke<Obj>("node_pod_create", { namespace: input.namespace ?? DEFAULT_NS, body })) ?? {};
    const err = operationError(op);
    if (err) throw new Error(err);
  }

  // DeletePod pelo contrato (DELETE .../pods/{name}). O engine corre a remoção
  // síncrona e devolve uma Operation já terminal; se falhou, lançamos a razão.
  async podDelete(name: string, namespace?: string, force?: boolean): Promise<void> {
    const op = (await invoke<Obj>("node_pod_delete", {
      name,
      namespace: namespace ?? DEFAULT_NS,
      force: force ?? false,
    })) ?? {};
    const err = operationError(op);
    if (err) throw new Error(err);
  }

  async workloads(namespace?: string): Promise<WorkloadRow[]> {
    const [containers, pods, cliAll] = await Promise.all([
      this.nodeContainers(namespace).catch(() => [] as WorkloadRow[]),
      this.nodePods(namespace).catch(() => [] as WorkloadRow[]),
      json<WorkloadRow[]>(cmd.workloads(namespace)).catch(() => [] as WorkloadRow[]),
    ]);
    // Containers e pods vêm do node.v1 (decisão B); da CLI ficam só os restantes
    // tipos (VMs), que ainda não têm fatia node.v1.
    const other = cliAll.filter((w) => w.type !== "container" && w.type !== "pod");
    return [...containers, ...pods, ...other];
  }

  // Imagens pelo contrato node.v1 (ListImages, REST) — sem CLI (decisão B). O
  // contrato não traz `created` (fica "—") nem `orphan`: o `usedBy` e o eixo
  // "sem uso" derivam-se do cruzamento com os workloads (uma imagem que nenhum
  // workload corre é órfã).
  async images(): Promise<ImageRow[]> {
    const [resp, workloads] = await Promise.all([
      invoke<Obj>("node_images"),
      this.workloads().catch(() => [] as WorkloadRow[]),
    ]);
    const rows = asArray(pick(resp ?? {}, "images")).map(nodeImageToRow);
    return crossRefUsedBy(rows, workloads).map((r) => ({ ...r, orphan: r.usedBy.length === 0 }));
  }

  // Pull/Delete de imagem pelo contrato (POST /v1/images:pull|:delete). O engine
  // corre a pull síncrona e devolve uma Operation já terminal; se falhou,
  // lançamos a razão. (O progresso ao vivo do pull não é levado pelo contrato —
  // a tela mostra um spinner até terminar.)
  async imagePull(reference: string, platform = ""): Promise<void> {
    const op = (await invoke<Obj>("node_image_pull", { reference, platform })) ?? {};
    const err = operationError(op);
    if (err) throw new Error(err);
  }

  async imageRemove(reference: string): Promise<void> {
    const op = (await invoke<Obj>("node_image_delete", { reference })) ?? {};
    const err = operationError(op);
    if (err) throw new Error(err);
  }

  // Volumes pelo contrato node.v1 (ListVolumes, REST) — sem CLI (decisão B). A
  // lista do contrato NÃO mede o tamanho (rootless: os diretórios pertencem a
  // outro uid — o CLI `volume ls` também devolve vazio aqui), por isso `size` sai
  // como "—"; o `usedBy` reconstrói-se dos containers (`spec.mounts[].volume`).
  async volumes(namespace?: string): Promise<VolumeRow[]> {
    const ns = namespace ?? DEFAULT_NS;
    const [resp, containers] = await Promise.all([
      invoke<Obj>("node_volumes", { namespace: ns }),
      this.nodeContainersRaw(ns).catch(() => [] as Obj[]),
    ]);
    const users = volumeUsers(containers);
    return asArray(pick(resp ?? {}, "volumes")).map((o) => {
      const name = str((pick(o, "meta") ?? {}) as Obj, "name");
      return { name, driver: "local", size: "—", usedBy: users.get(name) ?? [] };
    });
  }

  // Redes pelo contrato node.v1 (ListNetworks, REST) — sem CLI. Os MEMBROS (com
  // IP) não vêm do lado da rede; reconstroem-se dos containers ligados.
  async networks(namespace?: string): Promise<NetworkRow[]> {
    const ns = namespace ?? DEFAULT_NS;
    const [resp, containers] = await Promise.all([
      invoke<Obj>("node_networks", { namespace: ns }),
      this.nodeContainersRaw(ns).catch(() => [] as Obj[]),
    ]);
    const members = networkMembers(containers);
    return asArray(pick(resp ?? {}, "networks")).map((o) => {
      const row = nodeNetworkToRow(o);
      row.members = members.get(row.name) ?? [];
      return row;
    });
  }

  // Detalhe de UMA rede pelo contrato (GetNetwork) + membros com IP derivados dos
  // containers. `networkDiagnose` fica na CLI (não tem serviço node.v1).
  async networkDetail(name: string): Promise<NetworkRow> {
    const ns = DEFAULT_NS;
    const [o, containers] = await Promise.all([
      invoke<Obj>("node_network", { namespace: ns, name }),
      this.nodeContainersRaw(ns).catch(() => [] as Obj[]),
    ]);
    const row = nodeNetworkToRow(o ?? {});
    if (!row.name) row.name = name;
    row.members = networkMembers(containers).get(name) ?? [];
    return row;
  }

  async networkCreate(name: string, driver: string, subnet: string, namespace?: string): Promise<void> {
    await invoke("node_network_create", { namespace: namespace ?? DEFAULT_NS, name, driver, subnet });
  }

  async networkRemove(name: string, namespace?: string): Promise<void> {
    await invoke("node_network_delete", { namespace: namespace ?? DEFAULT_NS, name });
  }

  async networkConnect(network: string, container: string, namespace?: string): Promise<void> {
    await invoke("node_network_connect", { namespace: namespace ?? DEFAULT_NS, network, container });
  }

  async networkDisconnect(network: string, container: string, namespace?: string): Promise<void> {
    await invoke("node_network_disconnect", { namespace: namespace ?? DEFAULT_NS, network, container });
  }

  async volumeCreate(name: string, namespace?: string): Promise<void> {
    await invoke("node_volume_create", { namespace: namespace ?? DEFAULT_NS, name });
  }

  async volumeRemove(name: string, namespace?: string): Promise<void> {
    await invoke("node_volume_delete", { namespace: namespace ?? DEFAULT_NS, name });
  }

  // `network diagnose -o json` → [{check,status,detail,fix?}]. READ (corre sem
  // confirmação). O `-o json` é saída pura, mas lemos por dlx_run e cortamos a
  // partir do primeiro `[` por robustez (igual ao stackPlan).
  async networkDiagnose(): Promise<NetDiagnoseFinding[]> {
    const res = await invoke<CliResult>("dlx_run", { args: cmd.networkDiagnose(), confirm: false });
    const start = res.stdout.indexOf("[");
    if (start < 0) {
      if (!res.ok) throw new Error(res.stderr.trim() || `network diagnose saiu com código ${res.code}`);
      return [];
    }
    let arr: unknown;
    try {
      arr = JSON.parse(res.stdout.slice(start));
    } catch {
      throw new Error(res.stderr.trim() || "network diagnose: saída não-JSON");
    }
    return asArray(arr).map((o) => ({
      check: str(o, "check"),
      status: str(o, "status"),
      detail: str(o, "detail"),
      fix: str(o, "fix") || undefined,
    }));
  }

  // --- Segredos (§E) ------------------------------------------------------
  // `secret ls -o json` → nome, nº de chaves, NOMES das chaves (nunca valores),
  // updated_unix, versão, used_by. Só metadados chegam ao renderer.
  async secrets(): Promise<SecretRow[]> {
    const rows = asArray(await json<unknown>(cmd.secretsLs()));
    return rows.map((o) => ({
      name: str(o, "name"),
      keys: num(o, "keys", "key_count") ?? list(o, "names", "keys_names").length,
      names: list(o, "names", "keys_names"),
      updated: fmtUnix(num(o, "updated_unix", "updated")),
      version: num(o, "version") ?? 0,
      usedBy: list(o, "used_by", "usedBy"),
    }));
  }

  // Detalhe revelável de UM segredo. `secret inspect [--reveal] -o json` devolve
  // um array `[{data:{KEY:VALUE}, revealed}]`; o parsing é PURO (lib/secrets.ts).
  // Classifica-se Read (prefixo `secret inspect`), por isso corre por `dlx_json`.
  // O valor em claro só volta quando `reveal=true` e NUNCA é registado.
  async secretInspect(name: string, reveal: boolean): Promise<SecretReveal> {
    return parseSecretInspect(await json<unknown>(cmd.secretInspect(name, reveal)));
  }

  // --- Backups (§E) -------------------------------------------------------
  // `backup ls` é TEXTO (sem -o json no 5.1.1): colunas ARCHIVE KIND NAME
  // CREATED SIZE HOST. Corre por dlx_run (READ, sem confirm) e parseia a tabela.
  async backups(from?: string): Promise<BackupRow[]> {
    const r = await invoke<CliResult>("dlx_run", { args: cmd.backupsLs(from), confirm: false });
    if (!r.ok) throw new Error(r.stderr.trim() || `backup ls saiu com código ${r.code}`);
    return parseBackupTable(r.stdout);
  }

  async providers(): Promise<ProviderReport[]> {
    const rows = asArray(await json<unknown>(cmd.providers()));
    return Promise.all(
      rows.map(async (o) => {
        const id = str(o, "id", "provider", "name");
        const kind = str(o, "kind") as ProviderReport["kind"];
        const report = await json<unknown>(cmd.providerDescribe(id, kind)).catch(() => null);
        const r = (Array.isArray(report) ? report[0] : report) as Obj | null;
        return {
          id,
          kind,
          available: Boolean(pick(o, "available", "reachable") ?? true),
          catalogVersion: r ? str(r, "catalog_version", "catalog") : "",
          capabilities: r ? asArray(pick(r, "capabilities", "entries")).map(toCapability) : [],
        };
      }),
    );
  }

  async doctor(): Promise<DoctorItem[]> {
    // `system doctor` é texto (sem -o json): classificado READ, corre sem confirm.
    const r = await invoke<CliResult>("dlx_run", { args: cmd.doctor(), confirm: false });
    return parseDoctor([r.stdout, r.stderr].filter(Boolean).join("\n"));
  }

  // --- Camada declarativa (§E) — StackService (node.v1) -------------------
  // Plan/Apply/Destroy passam pelo contrato `delonix.node.v1` (decisão B): o
  // backend Tauri lê o manifesto do caminho, base64-encoda-o e chama
  // `/v1/stacks/{stack}:plan|apply|destroy`. O nome do stack deriva do nome do
  // ficheiro. Plan devolve um StackPlan `{changes:[{target,action,fields[]}],
  // has_changes}`; apply/destroy uma Operation já terminal.
  async stackPlan(manifest?: string): Promise<StackPlanRow[]> {
    if (!manifest) throw new Error("indica o caminho do manifesto da stack");
    const plan = (await invoke<Obj>("node_stack_plan", { path: manifest })) ?? {};
    return asArray(pick(plan, "changes")).map((c) => {
      // `target` = "Kind/name" → separa no 1.º "/".
      const target = str(c, "target");
      const slash = target.indexOf("/");
      const action = planActionWord(str(c, "action"));
      return {
        kind: slash >= 0 ? target.slice(0, slash) : target,
        name: slash >= 0 ? target.slice(slash + 1) : "",
        action,
        changed: action !== "noop" && action !== "",
        diffs: asArray(pick(c, "fields")).length,
        planDigest: "", // o contrato não leva digest; o apply node.v1 não o exige
      };
    });
  }

  // Apply/Destroy pelo contrato: o engine corre a síncrona e devolve uma
  // Operation já terminal; se falhou, lançamos a razão (sem progresso ao vivo —
  // a UI mostra um spinner até terminar, como o pull de imagem).
  async stackApply(manifest?: string): Promise<void> {
    if (!manifest) throw new Error("indica o caminho do manifesto da stack");
    const op = (await invoke<Obj>("node_stack_apply", { path: manifest })) ?? {};
    const err = operationError(op);
    if (err) throw new Error(err);
  }
  async stackDestroy(manifest?: string): Promise<void> {
    if (!manifest) throw new Error("indica o caminho do manifesto da stack");
    const op = (await invoke<Obj>("node_stack_destroy", { path: manifest })) ?? {};
    const err = operationError(op);
    if (err) throw new Error(err);
  }

  // `cluster ls` é TEXTO (sem -o json): parseado por nome de coluna.
  async clusters(all = false): Promise<ClusterRow[]> {
    const r = await invoke<CliResult>("dlx_run", { args: cmd.clustersLs(all), confirm: false });
    if (!r.ok) throw new Error(r.stderr.trim() || `cluster ls saiu com código ${r.code}`);
    const { header, rows } = parseTable(r.stdout);
    return rows
      .map((row) => ({
        name: colOf(header, row, "NAME"),
        mode: colOf(header, row, "MODE"),
        state: colOf(header, row, "STATE"),
        controlPlanes: colOf(header, row, "CONTROL-PLANES"),
        workers: colOf(header, row, "WORKERS"),
        apiPort: colOf(header, row, "API PORT"),
        k8sVersion: colOf(header, row, "K8S VERSION"),
      }))
      .filter((c) => c.name);
  }

  // --- Recursos DENTRO de um cluster (kubectl READ) -----------------------
  // Corre o kubectl do sistema contra o kubeconfig em cache (backend
  // `dlx_kubectl`, só-leitura). Lança com o stderr do kubectl quando falha.
  private async kubectlJson(cluster: string, args: Argv): Promise<Obj> {
    const r = await invoke<CliResult>("dlx_kubectl", { cluster, args });
    if (!r.ok) throw new Error(r.stderr.trim() || `kubectl saiu com código ${r.code}`);
    try {
      return (JSON.parse(r.stdout) as Obj) ?? {};
    } catch {
      throw new Error(r.stderr.trim() || "kubectl: saída não-JSON");
    }
  }

  async clusterNodes(cluster: string): Promise<K8sNode[]> {
    const o = await this.kubectlJson(cluster, kubectl.getNodes());
    return asArray(o.items).map(toK8sNode);
  }

  async clusterPods(cluster: string, namespace?: string): Promise<K8sPod[]> {
    const o = await this.kubectlJson(cluster, kubectl.getPods(namespace));
    return asArray(o.items).map(toK8sPod);
  }

  async clusterNamespaces(cluster: string): Promise<string[]> {
    const o = await this.kubectlJson(cluster, kubectl.getNamespaces());
    return asArray(o.items).map((n) => str((pick(n, "metadata") ?? {}) as Obj, "name")).filter(Boolean);
  }

  async clusterPodLogs(cluster: string, pod: string, namespace: string, tail = 500): Promise<string> {
    const r = await invoke<CliResult>("dlx_kubectl", { cluster, args: kubectl.logs(pod, namespace, tail) });
    if (!r.ok) throw new Error(r.stderr.trim() || `kubectl logs saiu com código ${r.code}`);
    return r.stdout;
  }

  // `compose ps` é TEXTO: SERVICE NAME IMAGE STATUS.
  async composePs(file?: string): Promise<ComposeService[]> {
    const r = await invoke<CliResult>("dlx_run", { args: cmd.composePs(file), confirm: false });
    if (!r.ok) throw new Error(r.stderr.trim() || `compose ps saiu com código ${r.code}`);
    const { header, rows } = parseTable(r.stdout);
    return rows
      .map((row) => ({
        service: colOf(header, row, "SERVICE"),
        name: colOf(header, row, "NAME"),
        image: colOf(header, row, "IMAGE"),
        status: colOf(header, row, "STATUS"),
      }))
      .filter((s) => s.name);
  }

  readText(argv: Argv) {
    return invoke<CliResult>("dlx_run", { args: argv, confirm: false });
  }

  risk(argv: Argv) {
    return invoke<RiskLevel | null>("dlx_risk", { args: argv });
  }

  run(argv: Argv, confirm: boolean) {
    return invoke<CliResult>("dlx_run", { args: argv, confirm });
  }

  // A password vai por parâmetro ao comando backend, que a escreve no stdin do
  // `image login --password-stdin`. Nunca entra num argv nem é registada.
  login(registry: string, username: string, password: string) {
    return invoke<CliResult>("dlx_login", { registry, username, password });
  }

  async stream(id: string, argv: Argv, onLine: (line: string) => void, onEnd?: (code: number | null) => void) {
    const un = await listen<{ id: string; line: string }>("dlx-stream", (e) => {
      if (e.payload.id === id) onLine(e.payload.line);
    });
    // O backend emite `dlx-stream-exit {id, code}` com o CÓDIGO DE SAÍDA do
    // processo mesmo antes do `-end`. Guardamo-lo para o entregar ao onEnd — é a
    // forma FIÁVEL de distinguir sucesso de falha (build/pull), sem adivinhar.
    let code: number | null = null;
    const unExit = await listen<{ id: string; code: number | null }>("dlx-stream-exit", (e) => {
      if (e.payload.id === id) code = e.payload.code;
    });
    // `dlx-stream-end` marca o fim (fluxos finitos como build/pull/cluster-create).
    const unEnd = await listen<string>("dlx-stream-end", (e) => {
      if (e.payload === id) onEnd?.(code);
    });
    await invoke("dlx_stream_start", { id, args: argv });
    return () => {
      un();
      unExit();
      unEnd();
      void invoke("dlx_stream_stop", { id });
    };
  }

  // Logs do container pelo server-stream gRPC de `ContainerService.Logs`. O
  // backend emite cada linha no MESMO evento `dlx-stream` que os fluxos do CLI,
  // por isso a forma e o cancelamento são idênticos a `stream` — só a origem muda
  // (node.v1 em vez de `delonix container logs -f`). `tailLines` → `tail_lines`.
  async containerLogs(id: string, name: string, namespace: string, onLine: (line: string) => void, timestamps = false) {
    const un = await listen<{ id: string; line: string }>("dlx-stream", (e) => {
      if (e.payload.id === id) onLine(e.payload.line);
    });
    await invoke("node_logs_start", { id, name, namespace, follow: true, tailLines: 200, timestamps });
    return () => {
      un();
      void invoke("node_logs_stop", { id });
    };
  }

  async exec(id: string, name: string, mode: ExecMode, onData: (data: string) => void, onEnd: () => void): Promise<ExecSession> {
    const unData = await listen<{ id: string; data: string }>("dlx-exec", (e) => {
      if (e.payload.id === id) onData(e.payload.data);
    });
    const unEnd = await listen<{ id: string }>("dlx-exec-end", (e) => {
      if (e.payload.id === id) {
        onEnd();
        unData();
        unEnd();
      }
    });
    // `container-exec` (shell novo no container) passa pelo stream bidi gRPC
    // `ContainerService.Exec` (node.v1, decisão B) — não pelo PTY+CLI. Os eventos
    // são os mesmos (dlx-exec/dlx-exec-end), por isso o resto é idêntico. Attach,
    // pod-exec, vm-console e a consola do host continuam no PTY (exec.rs).
    if (mode === "container-exec") {
      await invoke("node_exec_start", { id, name, namespace: "default" });
      return {
        write: (data: string) => void invoke("node_exec_write", { id, data }),
        resize: (cols: number, rows: number) => void invoke("node_exec_resize", { id, cols, rows }),
        stop: () => {
          unData();
          unEnd();
          void invoke("node_exec_stop", { id });
        },
      };
    }
    await invoke("dlx_exec_start", { id, name, mode });
    return {
      write: (data: string) => void invoke("dlx_exec_write", { id, data }),
      resize: (cols: number, rows: number) => void invoke("dlx_exec_resize", { id, cols, rows }),
      stop: () => {
        unData();
        unEnd();
        void invoke("dlx_exec_stop", { id });
      },
    };
  }

  // Identidade do host para o rótulo da consola do host (backend `dlx_host_identity`).
  hostIdentity(): Promise<HostIdentity> {
    return invoke<HostIdentity>("dlx_host_identity");
  }

  // --- VMs pelo socket node.v1 (§5) ---------------------------------------

  async vmList(): Promise<VmDetail[]> {
    const raw = (await invoke<Obj>("node_vm_list")) ?? {};
    return asArray(pick(raw, "virtual_machines")).map(toVm);
  }

  async vmGet(name: string): Promise<VmDetail> {
    return toVm(await invoke<Obj>("node_vm_get", { name }));
  }

  async vmCreate(spec: VmCreateInput): Promise<void> {
    // Corpo de CreateVirtualMachine: `name` + `spec` (o namespace vem do caminho
    // REST, não do corpo). int64 em número — o DTO do core aceita-o na leitura.
    const req = {
      name: spec.name,
      spec: {
        image: spec.image,
        vcpus: spec.vcpus,
        memory_bytes: spec.memoryBytes,
        disk_bytes: spec.diskBytes,
        ...(spec.network ? { networks: [{ network: spec.network }] } : {}),
      },
    };
    await invoke("node_vm_create", { req });
  }

  async vmStart(name: string): Promise<void> {
    await invoke("node_vm_start", { name });
  }

  async vmStop(name: string): Promise<void> {
    await invoke("node_vm_stop", { name });
  }

  async vmDelete(name: string): Promise<void> {
    await invoke("node_vm_delete", { name });
  }

  async vmSnapshotList(name: string): Promise<VmSnapshot[]> {
    const raw = (await invoke<Obj>("node_vm_snapshots", { name })) ?? {};
    return asArray(pick(raw, "snapshots")).map((s) => ({
      name: str(s, "name"),
      includesMemory: bool(s, "includes_memory") ?? false,
      state: str(s, "state"),
    }));
  }

  async vmSnapshotCreate(name: string, snapshot: string): Promise<void> {
    await invoke("node_vm_snapshot_create", { name, snapshot });
  }

  async vmSnapshotRestore(name: string, snapshot: string): Promise<void> {
    await invoke("node_vm_snapshot_restore", { name, snapshot });
  }

  // Inspeção de um container pelo contrato node.v1 (REST GetContainer sobre o
  // socket Unix do node-api). Lança se o engine não servir ContainerService
  // (501 DX-6001) ou o container não existir — a aba trata o erro.
  containerInspect(namespace: string, name: string): Promise<unknown> {
    return invoke<unknown>("node_container", { namespace, name });
  }

  async containerStart(namespace: string, name: string): Promise<void> {
    await invoke("node_container_start", { namespace, name });
  }

  async containerStop(namespace: string, name: string): Promise<void> {
    await invoke("node_container_stop", { namespace, name });
  }

  async containerRestart(namespace: string, name: string): Promise<void> {
    await invoke("node_container_restart", { namespace, name });
  }

  async containerRemove(namespace: string, name: string): Promise<void> {
    await invoke("node_container_delete", { namespace, name });
  }

  async containerStats(namespace: string, name: string): Promise<ContainerStatsSample> {
    const s = (await invoke<Obj>("node_container_stats", { namespace, name })) ?? {};
    return {
      cpuUsageNanos: num(s, "cpu_usage_nanos") ?? 0,
      memoryWorkingSetBytes: num(s, "memory_working_set_bytes") ?? 0,
      memoryLimitBytes: num(s, "memory_limit_bytes") ?? 0,
      pids: num(s, "pids") ?? 0,
      networkRxBytes: num(s, "network_rx_bytes") ?? 0,
      networkTxBytes: num(s, "network_tx_bytes") ?? 0,
      writableLayerBytes: num(s, "writable_layer_bytes") ?? 0,
      unmeasured: list(s, "unmeasured"),
    };
  }

  // Eventos pelo server-stream gRPC `NodeService.WatchEvents` (node.v1), não por
  // `delonix system events -f` (CLI) — decisão B. O backend mapeia cada Event do
  // contrato para a MESMA linha JSON ({ts, kind, action, name, detail}) e emite-a
  // no evento `dlx-stream`, por isso o parser aqui é o mesmo do JSONL do CLI.
  async events(onEvent: (e: EngineEvent) => void, onEnd?: () => void) {
    const id = "engine-events";
    const un = await listen<{ id: string; line: string }>("dlx-stream", (e) => {
      if (e.payload.id !== id) return;
      try {
        const o = JSON.parse(e.payload.line) as Obj;
        const ts = num(o, "ts", "time", "timestamp") ?? 0;
        onEvent({
          ts,
          time: fmtUnix(ts) || String(ts),
          kind: str(o, "kind", "type", "resource"),
          action: str(o, "action", "event", "status"),
          name: str(o, "name", "id", "actor"),
          detail: str(o, "detail", "message") || undefined,
        });
      } catch {
        /* linha não-JSON: ignorar */
      }
    });
    const unEnd = await listen<string>("dlx-stream-end", (e) => {
      if (e.payload === id) onEnd?.();
    });
    // namespace vazio = todos: o engine ainda não carimba namespace nos eventos,
    // por isso filtrar por "default" seria recusado (filtra-se por kind, não ns).
    await invoke("node_events_start", { id, namespace: "", kinds: [] });
    return () => {
      un();
      unEnd();
      void invoke("node_events_stop", { id });
    };
  }
}
