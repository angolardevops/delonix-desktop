// Construtores de argv para o CLI `delonix`. A UI mostra sempre o comando
// equivalente, por isso cada ação passa por aqui.
import type { WorkloadRow } from "./types";

export type Argv = string[];

export const show = (argv: Argv) =>
  ["delonix", ...argv].map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a)).join(" ");

export const cmd = {
  dash: (): Argv => ["dashboard", "--json"],
  workloads: (): Argv => ["workload", "ls", "-o", "json"],
  describe: (name: string): Argv => ["workload", "describe", name],
  images: (): Argv => ["images", "-o", "json"],
  volumes: (): Argv => ["volume", "ls", "-o", "json"],
  networks: (): Argv => ["network", "ls", "-o", "json"],
  providers: (): Argv => ["provider", "ls", "-o", "json"],
  providerDescribe: (id: string, kind?: string): Argv =>
    ["provider", "describe", id, ...(kind ? ["--kind", kind] : []), "-o", "json"],
  doctor: (): Argv => ["system", "doctor"],
  mcpTools: (): Argv => ["mcp", "capabilities"],

  start: (w: Pick<WorkloadRow, "name">): Argv => ["start", w.name],
  // containers e VMs: `workload stop` encaminha para o backend certo
  stop: (w: Pick<WorkloadRow, "name">): Argv => ["workload", "stop", w.name],
  restart: (w: Pick<WorkloadRow, "name">): Argv => ["restart", w.name],
  remove: (w: Pick<WorkloadRow, "name">): Argv => ["rm", "-f", w.name],
  logsFollow: (name: string): Argv => ["logs", "-f", name],
  events: (): Argv => ["system", "events", "-f", "-o", "json"],

  pull: (ref: string): Argv => ["pull", ref],
  rmi: (ref: string): Argv => ["rmi", ref],
  volumeCreate: (name: string): Argv => ["volume", "create", name],
  volumeRm: (name: string): Argv => ["volume", "rm", name],

  run: (o: { name: string; image: string; ports: string[]; env: string[]; volumes: string[]; memory?: string; cpus?: string; restart?: string }): Argv => [
    "run", "-d", "--name", o.name,
    ...o.ports.flatMap((p) => ["-p", p]),
    ...o.env.flatMap((e) => ["-e", e]),
    ...o.volumes.flatMap((v) => ["-v", v]),
    ...(o.memory ? ["--memory", o.memory] : []),
    ...(o.cpus ? ["--cpus", o.cpus] : []),
    ...(o.restart ? ["--restart", o.restart] : []),
    o.image,
  ],
};
