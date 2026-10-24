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
  images: (): Argv => ["image", "ls", "-o", "json"],
  volumes: (): Argv => ["volume", "ls", "-o", "json"],
  networks: (): Argv => ["network", "ls", "-o", "json"],
  providers: (): Argv => ["provider", "ls", "-o", "json"],
  providerDescribe: (id: string, kind?: string): Argv =>
    ["provider", "describe", id, ...(kind ? ["--kind", kind] : []), "-o", "json"],
  doctor: (): Argv => ["system", "doctor"],
  mcpTools: (): Argv => ["mcp", "capabilities"],

  // start/restart não têm forma de raiz nem no grupo `workload`: despacham-se
  // por tipo (`vm …` para VMs, `container …` para o resto).
  start: (w: Pick<WorkloadRow, "name" | "type">): Argv => [w.type === "vm" ? "vm" : "container", "start", w.name],
  // `workload stop` encaminha para o backend certo (container ou VM).
  stop: (w: Pick<WorkloadRow, "name">): Argv => ["workload", "stop", w.name],
  restart: (w: Pick<WorkloadRow, "name" | "type">): Argv => [w.type === "vm" ? "vm" : "container", "restart", w.name],
  // `workload rm` é agnóstico ao tipo; -f força mesmo a correr.
  remove: (w: Pick<WorkloadRow, "name">): Argv => ["workload", "rm", "-f", w.name],
  logsFollow: (name: string): Argv => ["container", "logs", "-f", name],
  exec: (name: string): Argv => ["container", "exec", "-it", name],
  events: (): Argv => ["system", "events", "-f", "-o", "json"],

  pull: (ref: string): Argv => ["image", "pull", ref],
  rmi: (ref: string): Argv => ["image", "remove", ref],
  volumeCreate: (name: string): Argv => ["volume", "create", name],
  volumeRm: (name: string): Argv => ["volume", "rm", name],

  // --- Segredos (§E). SÓ verbos agrupados. ---------------------------------
  secretsLs: (): Argv => ["secret", "ls", "-o", "json"],
  // inspect devolve METADADOS (nomes das chaves, valores redigidos); nunca `--reveal`.
  secretInspect: (name: string): Argv => ["secret", "inspect", name, "-o", "json"],
  // O valor entra por `--from-literal KEY=value`. Um segredo é um mapa chave→valor.
  secretCreate: (o: { name: string; key: string; value: string; force?: boolean }): Argv => [
    "secret", "create", o.name, "--from-literal", `${o.key}=${o.value}`, ...(o.force ? ["-f"] : []),
  ],
  secretRm: (name: string): Argv => ["secret", "rm", name],
  // rotate gera um novo valor aleatório para UMA chave do segredo.
  secretRotate: (name: string, key: string): Argv => ["secret", "rotate", name, key],

  // --- Backups (§E). `backup ls` é TEXTO (sem -o json) no 5.1.1. ------------
  backupsLs: (from?: string): Argv => ["backup", "ls", ...(from ? ["--from", from] : [])],
  backupInspect: (archive: string, from?: string): Argv => ["backup", "inspect", archive, ...(from ? ["--from", from] : [])],
  // backup de UM recurso: kind (container/pod/vm/stack) + nome; --to é o destino.
  backupCreate: (o: { kind: string; name: string; to?: string }): Argv => [
    "backup", "create", o.kind, o.name, ...(o.to ? ["--to", o.to] : []),
  ],
  backupRestore: (archive: string, from?: string): Argv => ["backup", "restore", archive, ...(from ? ["--from", from] : [])],
  backupRemove: (archive: string, from?: string): Argv => ["backup", "remove", archive, ...(from ? ["--from", from] : [])],

  run: (o: { name: string; image: string; ports: string[]; env: string[]; volumes: string[]; memory?: string; cpus?: string; restart?: string }): Argv => [
    "container", "run", "-d", "--name", o.name,
    ...o.ports.flatMap((p) => ["-p", p]),
    ...o.env.flatMap((e) => ["-e", e]),
    ...o.volumes.flatMap((v) => ["-v", v]),
    ...(o.memory ? ["--memory", o.memory] : []),
    ...(o.cpus ? ["--cpus", o.cpus] : []),
    ...(o.restart ? ["--restart", o.restart] : []),
    o.image,
  ],
};
