// Duplo local: os mesmos dados dos mockups, para desenvolver no browser sem
// Tauri nem engine. A UI mostra sempre uma faixa "duplo local" neste modo.
import type { DelonixClient, ExecSession } from "./client";
import type { Argv } from "./cli";
import { show } from "./cli";
import type {
  CliResult, DashRow, DashSummary, DoctorItem, EngineEvent, ImageRow, NetworkRow, ProviderReport, RiskLevel, VolumeRow, WorkloadRow,
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
];

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

const images: ImageRow[] = [
  { ref: "postgres:16", id: "b1a0c8e9f2d3", size: "432 MB", created: "há 3 sem", usedBy: ["postgres-dev"] },
  { ref: "odoo:16", id: "4e77d1a2b9c0", size: "1,62 GB", created: "há 1 mês", usedBy: ["odoo-16"] },
  { ref: "firecracker/ci:24.04", id: "90f3e2c1d7a8", size: "412 MB", created: "hoje", usedBy: ["fc-ci-runner-1", "fc-ci-runner-2"] },
  { ref: "traefik:v3.1", id: "7a1e5b3c9d20", size: "178 MB", created: "há 2 sem", usedBy: ["traefik"] },
  { ref: "node:20-bookworm", id: "3f8c2a7e1b90", size: "1,10 GB", created: "há 2 meses", usedBy: [] },
  { ref: "rust:1.82", id: "e2b9a1c4d7f6", size: "1,48 GB", created: "há 6 sem", usedBy: [] },
];

const volumes: VolumeRow[] = [
  { name: "pgdata", driver: "local", size: "412 MB", usedBy: ["postgres-dev"] },
  { name: "odoo-filestore", driver: "local", size: "890 MB", usedBy: ["odoo-16"] },
  { name: "minio-data", driver: "local", size: "604 MB", usedBy: ["minio"] },
  { name: "ci-cache-cargo", driver: "local", size: "720 MB", usedBy: ["fc-ci-runner-1", "fc-ci-runner-2"] },
  { name: "keycloak-old", driver: "local", size: "288 MB", usedBy: [] },
];

const networks: NetworkRow[] = [
  { name: "edge", driver: "bridge", subnet: "10.89.1.0/24", members: [{ name: "traefik", ip: "10.89.1.2" }, { name: "odoo-16", ip: "10.89.1.5" }] },
  { name: "odoo-net", driver: "bridge · interna", subnet: "10.89.2.0/24", members: [{ name: "odoo-16", ip: "10.89.2.4" }, { name: "postgres-dev", ip: "10.89.2.2" }, { name: "redis", ip: "10.89.2.3" }] },
  { name: "delonix0", driver: "bridge · padrão", subnet: "10.88.0.0/16", members: [{ name: "minio", ip: "10.88.0.9" }] },
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
  [["workload", "stop"], "DISRUPTIVE"], [["container", "stop"], "DISRUPTIVE"], [["vm", "stop"], "DISRUPTIVE"], [["container", "restart"], "DISRUPTIVE"], [["vm", "restart"], "DISRUPTIVE"],
  [["container", "start"], "SAFE_WRITE"], [["vm", "start"], "SAFE_WRITE"], [["image", "pull"], "SAFE_WRITE"], [["container", "run"], "SAFE_WRITE"], [["volume", "create"], "SAFE_WRITE"], [["network", "create"], "SAFE_WRITE"],
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
  dash = () => wait({ ...dashBase, rows: mockRows() });
  workloads = () => wait(workloads);
  images = () => wait(images);
  volumes = () => wait(volumes);
  networks = () => wait(networks);
  providers = () => wait(providers);
  doctor = () => wait(doctorItems);
  risk = (argv: Argv) => wait(riskOf(argv));

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

  async stream(_id: string, _argv: Argv, onLine: (line: string) => void) {
    let i = 0;
    const t = setInterval(() => onLine(`${new Date().toISOString().replace("T", " ").slice(0, 23)}  ${LOG[i++ % LOG.length]}`), 900);
    return () => clearInterval(t);
  }

  async exec(_id: string, name: string, onData: (data: string) => void, _onEnd: () => void): Promise<ExecSession> {
    // Duplo local: um shell simulado que ecoa o que se escreve (sem engine).
    onData(`\x1b[2mduplo local — shell simulado em ${name}\x1b[0m\r\n$ `);
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

  async events(onEvent: (e: EngineEvent) => void) {
    const seed: EngineEvent[] = [
      { time: "15:02:10", kind: "container", action: "log", name: "odoo-16", detail: "A atualizar módulos: -u all" },
      { time: "15:06:03", kind: "container", action: "oom", name: "odoo-16", detail: "morto pelo kernel · código 137" },
      { time: "15:06:03", kind: "container", action: "error", name: "postgres-dev", detail: "ligação reiniciada pelo cliente 10.89.2.4" },
      { time: "15:06:41", kind: "container", action: "warning", name: "postgres-dev", detail: "a terminar ligações" },
    ];
    seed.forEach(onEvent);
    return () => {};
  }
}
