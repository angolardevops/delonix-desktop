import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DelonixClient } from "./client";
import { cmd, type Argv } from "./cli";
import type {
  CapabilityLabel, CapabilityRow, CliResult, DashSummary, EngineEvent, ImageRow, NetworkRow, ProviderReport, RiskLevel, VolumeRow, WorkloadRow,
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

  dash() {
    return json<DashSummary>(cmd.dash());
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
