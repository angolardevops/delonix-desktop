import { useCallback, useEffect, useMemo, useState } from "react";
import { Ctx, type AppCtx, type DockTab, type HistoryEntry, type Route } from "./app/context";
import { BottomDock } from "./components/BottomDock";
import { CommandPalette } from "./components/CommandPalette";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import { isTauri, type DelonixClient } from "./lib/client";
import { show, type Argv } from "./lib/cli";
import { MockClient } from "./lib/mockClient";
import { TauriClient } from "./lib/tauriClient";
import type { RiskLevel } from "./lib/types";
import { Capabilities } from "./screens/Capabilities";
import { CreateWorkload } from "./screens/CreateWorkload";
import { Events } from "./screens/Events";
import { Images } from "./screens/Images";
import { Build } from "./screens/Build";
import { Networks } from "./screens/Networks";
import { Backups } from "./screens/Backups";
import { Declarativo } from "./screens/Declarativo";
import { Overview } from "./screens/Overview";
import { Secrets } from "./screens/Secrets";
import { Extensions, Kubernetes, Registries, Workspaces } from "./screens/Platform";
import { Settings } from "./screens/Settings";
import { Volumes } from "./screens/Volumes";
import { WorkloadDetail } from "./screens/WorkloadDetail";
import { Workloads } from "./screens/Workloads";

type Pending = { argv: Argv; label: string; risk: RiskLevel; resolve: (ok: boolean) => void };

export default function App() {
  const client: DelonixClient = useMemo(() => (isTauri() ? new TauriClient() : new MockClient()), []);
  const [route, setRoute] = useState<Route>({ name: "overview" });
  const [dockOpen, setDockOpen] = useState(false);
  const [dockTab, setDockTab] = useState<DockTab>("logs");
  const [palette, setPalette] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("delonix.sidebar.collapsed") === "1"; } catch { return false; }
  });

  const openDock = useCallback((t: DockTab) => { setDockTab(t); setDockOpen(true); }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem("delonix.sidebar.collapsed", next ? "1" : "0"); } catch { /* sem localStorage (ex.: SSR/testes) */ }
      return next;
    });
  }, []);

  const act = useCallback(async (argv: Argv, label: string) => {
    const risk = await client.risk(argv);
    let confirm = false;
    if (risk === "DISRUPTIVE" || risk === "DESTRUCTIVE") {
      confirm = await new Promise<boolean>((resolve) => setPending({ argv, label, risk, resolve }));
      setPending(null);
      if (!confirm) return false;
    }
    try {
      const r = await client.run(argv, confirm);
      setHistory((h) => [{ at: new Date(), label, command: show(argv), ok: r.ok }, ...h].slice(0, 200));
      setToast({ ok: r.ok, text: r.ok ? `${label} · feito` : `${label} falhou: ${r.stderr.trim() || `código ${r.code}`}` });
      return r.ok;
    } catch (e) {
      setHistory((h) => [{ at: new Date(), label, command: show(argv), ok: false }, ...h]);
      setToast({ ok: false, text: String(e) });
      return false;
    }
  }, [client]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
      if (mod && e.key === "`") { e.preventDefault(); setDockOpen((o) => !o); }
      if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); setRoute({ name: "create" }); }
      if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); toggleSidebar(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);

  const ctx: AppCtx = { client, route, go: setRoute, openDock, openPalette: () => setPalette(true), act, history, sidebarCollapsed, toggleSidebar };

  const screen = (() => {
    switch (route.name) {
      case "overview": return <Overview />;
      case "workspaces": return <Workspaces />;
      case "workloads": return <Workloads />;
      case "workload": return <WorkloadDetail id={route.id} />;
      case "create": return <CreateWorkload />;
      case "images": return <Images />;
      case "build": return <Build />;
      case "volumes": return <Volumes />;
      case "secrets": return <Secrets />;
      case "backups": return <Backups />;
      case "declarative": return <Declarativo />;
      case "kubernetes": return <Kubernetes />;
      case "networks": return <Networks />;
      case "registries": return <Registries />;
      case "events": return <Events />;
      case "capabilities": return <Capabilities />;
      case "extensions": return <Extensions />;
      case "settings": return <Settings section={route.section} />;
    }
  })();

  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        <TitleBar />
        {!client.live && (
          <div role="status" style={{ padding: "4px 14px", background: "var(--warnb)", color: "var(--warn)", fontSize: 12, borderBottom: "1px solid var(--warn-line)" }}>
            Modo de desenvolvimento (sem Tauri): dados do duplo local, não do runtime vivo.
          </div>
        )}
        <div className="body">
          <Sidebar />
          <main className="main">{screen}</main>
        </div>
        <BottomDock tab={dockTab} open={dockOpen} setTab={setDockTab} setOpen={setDockOpen} />
        <StatusBar />
      </div>
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
      {pending && <ConfirmDialog argv={pending.argv} label={pending.label} risk={pending.risk} onAnswer={pending.resolve} />}
      {toast && (
        <div className="toast" role="status" style={{ borderLeft: `2px solid ${toast.ok ? "var(--ok)" : "var(--bad)"}` }}>
          {toast.text}
        </div>
      )}
    </Ctx.Provider>
  );
}
