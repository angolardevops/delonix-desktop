import { createContext, useContext } from "react";
import type { DelonixClient } from "../lib/client";
import type { Argv } from "../lib/cli";

export type Route =
  | { name: "overview" }
  | { name: "workspaces" }
  | { name: "workloads" }
  | { name: "workload"; id: string }
  | { name: "create" }
  | { name: "images" }
  | { name: "build" }
  | { name: "volumes" }
  | { name: "secrets" }
  | { name: "backups" }
  | { name: "declarative" }
  | { name: "kubernetes" }
  | { name: "networks" }
  | { name: "registries" }
  | { name: "events" }
  | { name: "capabilities" }
  | { name: "extensions" }
  | { name: "settings"; section?: "general" | "resources" | "ai" };

export type DockTab = "terminal" | "logs" | "assistant" | "activity";

export interface AppCtx {
  client: DelonixClient;
  route: Route;
  go: (r: Route) => void;
  openDock: (tab: DockTab) => void;
  openPalette: () => void;
  // Executa uma ação do CLI: pede confirmação se o risco o exige, regista no
  // histórico e mostra o resultado. Devolve true se correu bem.
  act: (argv: Argv, label: string) => Promise<boolean>;
  history: HistoryEntry[];
}

export interface HistoryEntry {
  at: Date;
  label: string;
  command: string;
  ok: boolean;
}

export const Ctx = createContext<AppCtx | null>(null);

export const useApp = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp fora do <Ctx.Provider>");
  return c;
};
