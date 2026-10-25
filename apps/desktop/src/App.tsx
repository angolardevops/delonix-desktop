import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Ctx, type AppCtx, type DockTab, type HistoryEntry, type Route } from "./app/context";
import { BottomDock } from "./components/BottomDock";
import { CommandPalette } from "./components/CommandPalette";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import { isTauri, type DelonixClient } from "./lib/client";
import { show, type Argv } from "./lib/cli";
import { MockClient } from "./lib/mockClient";
import { TauriClient } from "./lib/tauriClient";
import type { RiskLevel } from "./lib/types";

// Code-splitting por rota (eixo D): cada tela entra no seu próprio chunk,
// carregado só quando se navega para ela. O bundle inicial deixa de levar as 15
// telas de uma vez. As telas são named exports, por isso mapeamos para `default`
// (o que o React.lazy exige). Platform agrupa 4 telas num só chunk partilhado.
const Overview = lazy(() => import("./screens/Overview").then((m) => ({ default: m.Overview })));
const Workloads = lazy(() => import("./screens/Workloads").then((m) => ({ default: m.Workloads })));
const WorkloadDetail = lazy(() => import("./screens/WorkloadDetail").then((m) => ({ default: m.WorkloadDetail })));
const CreateWorkload = lazy(() => import("./screens/CreateWorkload").then((m) => ({ default: m.CreateWorkload })));
const Images = lazy(() => import("./screens/Images").then((m) => ({ default: m.Images })));
const Build = lazy(() => import("./screens/Build").then((m) => ({ default: m.Build })));
const Volumes = lazy(() => import("./screens/Volumes").then((m) => ({ default: m.Volumes })));
const Secrets = lazy(() => import("./screens/Secrets").then((m) => ({ default: m.Secrets })));
const Backups = lazy(() => import("./screens/Backups").then((m) => ({ default: m.Backups })));
const Declarativo = lazy(() => import("./screens/Declarativo").then((m) => ({ default: m.Declarativo })));
const Networks = lazy(() => import("./screens/Networks").then((m) => ({ default: m.Networks })));
const Events = lazy(() => import("./screens/Events").then((m) => ({ default: m.Events })));
const Capabilities = lazy(() => import("./screens/Capabilities").then((m) => ({ default: m.Capabilities })));
const Settings = lazy(() => import("./screens/Settings").then((m) => ({ default: m.Settings })));
const Workspaces = lazy(() => import("./screens/Platform").then((m) => ({ default: m.Workspaces })));
const Kubernetes = lazy(() => import("./screens/Platform").then((m) => ({ default: m.Kubernetes })));
const Registries = lazy(() => import("./screens/Platform").then((m) => ({ default: m.Registries })));
const Extensions = lazy(() => import("./screens/Platform").then((m) => ({ default: m.Extensions })));

function ScreenLoading() {
  return (
    <div role="status" aria-live="polite" style={{ padding: 24, color: "var(--mut)", fontSize: 13 }}>
      A carregar…
    </div>
  );
}

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
          <main className="main">
            {/* Barreira por rota: um crash numa tela mostra um fallback
                acionável em vez de tela branca; a chave reinicia a barreira ao
                navegar. O Suspense cobre o carregamento do chunk lazy. */}
            <ErrorBoundary key={route.name}>
              <Suspense fallback={<ScreenLoading />}>{screen}</Suspense>
            </ErrorBoundary>
          </main>
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
