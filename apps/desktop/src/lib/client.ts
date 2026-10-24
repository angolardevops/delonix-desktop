import type {
  BackupRow, CliResult, ClusterRow, ComposeService, DashSummary, DoctorItem, EngineEvent, ImageRow, NetworkRow, ProviderReport, RiskLevel, SecretRow, StackPlanRow, VmCreateInput, VmDetail, VmSnapshot, VolumeRow, WorkloadRow,
} from "./types";
import type { Argv } from "./cli";

// Contrato único entre a UI e o engine. Há duas implementações:
// TauriClient (CLI real via backend Rust) e MockClient (o "duplo" local,
// usado quando a app corre no browser sem Tauri).
export interface DelonixClient {
  readonly live: boolean;
  binary(): Promise<string>;
  dash(): Promise<DashSummary>;
  workloads(): Promise<WorkloadRow[]>;
  images(): Promise<ImageRow[]>;
  volumes(): Promise<VolumeRow[]>;
  networks(): Promise<NetworkRow[]>;
  // Segredos (§E): SÓ metadados (nome/chaves/nomes-de-chaves/versão). Nunca valores.
  secrets(): Promise<SecretRow[]>;
  // Backups (§E): arquivos no diretório `from` (default: diretório atual do engine).
  backups(from?: string): Promise<BackupRow[]>;
  providers(): Promise<ProviderReport[]>;
  doctor(): Promise<DoctorItem[]>;
  // --- Camada declarativa (§E) --------------------------------------------
  // Stacks: leitura estruturada de `stack plan -o json` (o que um apply faria).
  // O manifesto entra por caminho (-f); sem caminho usa o diretório do processo.
  stackPlan(manifest?: string): Promise<StackPlanRow[]>;
  // Clusters/Kubernetes: `cluster ls` é TEXTO (sem -o json no 5.1.1); parseado
  // por nome de coluna. `all` inclui clusters totalmente parados (-A).
  clusters(all?: boolean): Promise<ClusterRow[]>;
  // Compose: `compose ps` é TEXTO (SERVICE NAME IMAGE STATUS); opera num ficheiro.
  composePs(file?: string): Promise<ComposeService[]>;
  // Comandos declarativos só-texto (stack describe/validate/history, compose
  // config, cluster health/kubeconfig, cluster kube generate): a UI mostra o
  // stdout cru num painel. Todos READ → correm sem confirmação.
  readText(argv: Argv): Promise<CliResult>;
  risk(argv: Argv): Promise<RiskLevel | null>;
  run(argv: Argv, confirm: boolean): Promise<CliResult>;
  // Registries (§ registries): autentica num registry OCI. A password segue por
  // stdin no backend (comando dedicado `dlx_login`), NUNCA pelo argv. O
  // resultado (ok/erro) não contém a password.
  login(registry: string, username: string, password: string): Promise<CliResult>;
  // Fluxos longos (logs, eventos, build). `onLine` recebe cada linha; o `onEnd`
  // opcional dispara quando o processo termina (ex.: um `build` acaba) — os
  // fluxos infinitos (`logs -f`) nunca o chamam.
  stream(id: string, argv: Argv, onLine: (line: string) => void, onEnd?: () => void): Promise<() => void>;
  events(onEvent: (e: EngineEvent) => void): Promise<() => void>;
  // Exec interativo (§3): abre um shell no container `name` por PTY. Os bytes
  // do PTY chegam por `onData`; o fim do processo por `onEnd`.
  exec(id: string, name: string, onData: (data: string) => void, onEnd: () => void): Promise<ExecSession>;
  // VMs pelo contrato de socket node.v1 (§5). As ações e a criação passam pelo
  // socket (não pela CLI); a tabela de Workloads continua a vir de `workload ls`.
  vmList(): Promise<VmDetail[]>;
  vmGet(name: string): Promise<VmDetail>;
  vmCreate(spec: VmCreateInput): Promise<void>;
  vmStart(name: string): Promise<void>;
  vmStop(name: string): Promise<void>;
  vmDelete(name: string): Promise<void>;
  vmSnapshotList(name: string): Promise<VmSnapshot[]>;
  vmSnapshotCreate(name: string, snapshot: string): Promise<void>;
  vmSnapshotRestore(name: string, snapshot: string): Promise<void>;
}

// Uma sessão de exec viva: escreve stdin, redimensiona e termina o PTY.
export interface ExecSession {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  stop(): void;
}

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
