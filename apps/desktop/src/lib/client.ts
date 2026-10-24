import type {
  CliResult, DashSummary, EngineEvent, ImageRow, NetworkRow, ProviderReport, RiskLevel, VolumeRow, WorkloadRow,
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
  risk(argv: Argv): Promise<RiskLevel | null>;
  run(argv: Argv, confirm: boolean): Promise<CliResult>;
  stream(id: string, argv: Argv, onLine: (line: string) => void): Promise<() => void>;
  events(onEvent: (e: EngineEvent) => void): Promise<() => void>;
}

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
