import type {
  CliResult, DashSummary, DoctorItem, EngineEvent, ImageRow, NetworkRow, ProviderReport, RiskLevel, VolumeRow, WorkloadRow,
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
  providers(): Promise<ProviderReport[]>;
  doctor(): Promise<DoctorItem[]>;
  risk(argv: Argv): Promise<RiskLevel | null>;
  run(argv: Argv, confirm: boolean): Promise<CliResult>;
  stream(id: string, argv: Argv, onLine: (line: string) => void): Promise<() => void>;
  events(onEvent: (e: EngineEvent) => void): Promise<() => void>;
  // Exec interativo (§3): abre um shell no container `name` por PTY. Os bytes
  // do PTY chegam por `onData`; o fim do processo por `onEnd`.
  exec(id: string, name: string, onData: (data: string) => void, onEnd: () => void): Promise<ExecSession>;
}

// Uma sessão de exec viva: escreve stdin, redimensiona e termina o PTY.
export interface ExecSession {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  stop(): void;
}

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
