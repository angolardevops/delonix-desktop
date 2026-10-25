import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DelonixClient, ExecSession } from "./client";
import { cmd, kubectl, type Argv } from "./cli";
import { parseDoctor } from "./doctor";
import { parseDescribeMembers } from "./network";
import type {
  BackupRow, CapabilityLabel, CapabilityRow, CliResult, ClusterRow, ComposeService, DashRow, DashSummary, DoctorItem, EngineEvent, ImageRow, K8sNode, K8sPod, NetDiagnoseFinding, NetworkRow, ProviderReport, ResourceAdvice, ResourceBottleneck, ResourceSeverity, RiskLevel, SecretRow, StackPlanRow, SystemMetrics, SystemResources, VmCreateInput, VmDetail, VmSnapshot, VolumeRow, WorkloadRow,
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

// Formata um instante unix (segundos) numa data local curta; "" se não medido.
const fmtUnix = (secs: number | null): string => {
  if (secs == null || !Number.isFinite(secs)) return "";
  return new Date(secs * 1000).toLocaleString("pt-AO", { dateStyle: "short", timeStyle: "short" });
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

  workloads() {
    return json<WorkloadRow[]>(cmd.workloads());
  }

  async images(): Promise<ImageRow[]> {
    const rows = asArray(await json<unknown>(cmd.images()));
    return rows.map((o) => {
      const repo = str(o, "repository", "name", "ref", "reference");
      const tag = str(o, "tag");
      return {
        ref: tag && !repo.includes(":") ? `${repo}:${tag}` : repo,
        id: str(o, "id", "digest").replace(/^sha256:/, "").slice(0, 12),
        size: str(o, "size_human", "size"),
        created: str(o, "created_human", "created", "created_at"),
        usedBy: list(o, "used_by", "containers"),
      };
    });
  }

  async volumes(): Promise<VolumeRow[]> {
    const rows = asArray(await json<unknown>(cmd.volumes()));
    return rows.map((o) => ({
      name: str(o, "name"),
      driver: str(o, "driver") || "local",
      size: str(o, "size_human", "size"),
      usedBy: list(o, "used_by", "mounted_by", "containers"),
    }));
  }

  // `network ls -o json` traz name/driver/bridge/subnet/`used_by` (NOMES dos
  // containers ligados, sem IP). Os membros ficam com `ip: ""` na lista; o IP e
  // o gateway só se obtêm no detalhe (networkDetail → `network describe`).
  async networks(): Promise<NetworkRow[]> {
    const rows = asArray(await json<unknown>(cmd.networks()));
    return rows.map((o) => ({
      name: str(o, "name"),
      driver: str(o, "driver", "kind"),
      subnet: str(o, "subnet", "cidr"),
      bridge: str(o, "bridge"),
      gateway: str(o, "gateway"),
      members: list(o, "used_by", "members", "containers").map((name) => ({ name, ip: "" })),
    }));
  }

  // Detalhe de UMA rede: `inspect -o json` dá gateway/bridge de forma estável;
  // `describe` é a ÚNICA forma que lista os membros COM o IP por rede (bloco
  // "Containers:" com linhas `nome (shortid) ip`). Juntam-se aqui. Se o describe
  // falhar, devolve na mesma a rede com membros sem IP (a topologia degrada bem).
  async networkDetail(name: string): Promise<NetworkRow> {
    const arr = asArray(await json<unknown>(cmd.networkInspect(name)));
    const o = arr[0] ?? {};
    const base: NetworkRow = {
      name: str(o, "name") || name,
      driver: str(o, "driver", "kind"),
      subnet: str(o, "subnet", "cidr"),
      bridge: str(o, "bridge"),
      gateway: str(o, "gateway"),
      members: [],
    };
    const r = await invoke<CliResult>("dlx_run", { args: cmd.networkDescribe([name]), confirm: false }).catch(() => null);
    if (r && r.ok) base.members = parseDescribeMembers(r.stdout);
    return base;
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

  // --- Camada declarativa (§E) --------------------------------------------
  // `stack plan -o json` devolve um array [{kind,name,action,changed,diffs[],
  // planDigest}]. O engine pode imprimir um `warning` em TEXTO antes do JSON
  // (ex.: "kind: Container … kind: Pod"), por isso corre por dlx_run e corta a
  // partir do primeiro `[`, em vez de dlx_json (que exigiria stdout JSON puro).
  async stackPlan(manifest?: string): Promise<StackPlanRow[]> {
    const r = await invoke<CliResult>("dlx_run", { args: cmd.stackPlan(manifest), confirm: false });
    const start = r.stdout.indexOf("[");
    if (start < 0) {
      if (!r.ok) throw new Error(r.stderr.trim() || `stack plan saiu com código ${r.code}`);
      return [];
    }
    let arr: unknown;
    try {
      arr = JSON.parse(r.stdout.slice(start));
    } catch {
      throw new Error(r.stderr.trim() || "stack plan: saída não-JSON");
    }
    return asArray(arr).map((o) => ({
      kind: str(o, "kind"),
      name: str(o, "name"),
      action: str(o, "action"),
      changed: bool(o, "changed") ?? false,
      diffs: asArray(pick(o, "diffs")).length,
      planDigest: str(o, "planDigest", "plan_digest"),
    }));
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

  async stream(id: string, argv: Argv, onLine: (line: string) => void, onEnd?: () => void) {
    const un = await listen<{ id: string; line: string }>("dlx-stream", (e) => {
      if (e.payload.id === id) onLine(e.payload.line);
    });
    // O backend emite `dlx-stream-end` com o id quando o processo termina
    // (relevante para fluxos finitos como `build`).
    const unEnd = await listen<string>("dlx-stream-end", (e) => {
      if (e.payload === id) onEnd?.();
    });
    await invoke("dlx_stream_start", { id, args: argv });
    return () => {
      un();
      unEnd();
      void invoke("dlx_stream_stop", { id });
    };
  }

  async exec(id: string, name: string, onData: (data: string) => void, onEnd: () => void): Promise<ExecSession> {
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
    await invoke("dlx_exec_start", { id, name });
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

  events(onEvent: (e: EngineEvent) => void) {
    return this.stream("engine-events", cmd.events(), (line) => {
      try {
        const o = JSON.parse(line) as Obj;
        onEvent({
          time: str(o, "time", "timestamp", "ts"),
          kind: str(o, "type", "kind", "resource"),
          action: str(o, "action", "event", "status"),
          name: str(o, "name", "id", "actor"),
          detail: str(o, "detail", "message"),
        });
      } catch {
        /* linha não-JSON: ignorar */
      }
    });
  }
}
