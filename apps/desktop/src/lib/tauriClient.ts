import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DelonixClient } from "./client";
import { cmd, type Argv } from "./cli";
import { parseDoctor } from "./doctor";
import type {
  CapabilityLabel, CapabilityRow, CliResult, DashRow, DashSummary, DoctorItem, EngineEvent, ImageRow, NetworkRow, ProviderReport, RiskLevel, VolumeRow, WorkloadRow,
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

  async networks(): Promise<NetworkRow[]> {
    const rows = asArray(await json<unknown>(cmd.networks()));
    return rows.map((o) => ({
      name: str(o, "name"),
      driver: str(o, "driver", "kind"),
      subnet: str(o, "subnet", "cidr"),
      members: asArray(pick(o, "members", "containers", "endpoints")).map((m) => ({
        name: str(m, "name", "container"),
        ip: str(m, "ip", "ipv4", "address"),
      })),
    }));
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

  risk(argv: Argv) {
    return invoke<RiskLevel | null>("dlx_risk", { args: argv });
  }

  run(argv: Argv, confirm: boolean) {
    return invoke<CliResult>("dlx_run", { args: argv, confirm });
  }

  async stream(id: string, argv: Argv, onLine: (line: string) => void) {
    const un = await listen<{ id: string; line: string }>("dlx-stream", (e) => {
      if (e.payload.id === id) onLine(e.payload.line);
    });
    await invoke("dlx_stream_start", { id, args: argv });
    return () => {
      un();
      void invoke("dlx_stream_stop", { id });
    };
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
