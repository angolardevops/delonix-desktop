import type { Route } from "../app/context";
import { useApp } from "../app/context";
import { useResource } from "../lib/hooks";
import { Icon } from "./Icon";

type Item = { route: Route; icon: string; label: string; count?: number | string; badge?: number; dock?: boolean };

export function Sidebar() {
  const { client, route, go, openDock, sidebarCollapsed } = useApp();
  const dash = useResource("dashboard", () => client.dash(), 10000).data;
  const providers = useResource("providers", () => client.providers(), 60000).data;
  const broken = providers?.flatMap((p) => p.capabilities).filter((c) => c.state !== "supported" && c.state !== "partial").length;

  const groups: { title: string; items: Item[] }[] = [
    { title: "Trabalho", items: [
      { route: { name: "workspaces" }, icon: "workspaces", label: "Workspaces" },
      { route: { name: "overview" }, icon: "overview", label: "Visão geral" },
      { route: { name: "workloads" }, icon: "workloads", label: "Workloads", count: dash ? dash.containers_total + dash.vms_total : undefined },
      { route: { name: "images" }, icon: "images", label: "Imagens", count: dash?.images_total },
      { route: { name: "build" }, icon: "build", label: "Construir" },
      { route: { name: "volumes" }, icon: "volumes", label: "Volumes", count: dash?.volumes_total },
      { route: { name: "secrets" }, icon: "secrets", label: "Segredos", count: dash?.secrets_total },
      { route: { name: "backups" }, icon: "backups", label: "Backups" },
      { route: { name: "declarative" }, icon: "declarative", label: "Declarativo" },
      { route: { name: "kubernetes" }, icon: "kubernetes", label: "Kubernetes" },
      { route: { name: "networks" }, icon: "networks", label: "Redes", count: dash?.networks_total },
      { route: { name: "registries" }, icon: "registries", label: "Registries" },
    ] },
    { title: "Operar", items: [
      { route: { name: "studio" }, icon: "studio", label: "Architecture Studio" },
      { route: { name: "events" }, icon: "events", label: "Eventos e métricas" },
      { route: { name: "logs" }, icon: "logs", label: "Logs" },
      { route: { name: "files" }, icon: "files", label: "Ficheiros" },
      { route: { name: "ide" }, icon: "code", label: "Editor" },
      { route: route, icon: "assistant", label: "Assistente", dock: true },
    ] },
    { title: "Sistema", items: [
      { route: { name: "capabilities" }, icon: "capabilities", label: "Capacidades", badge: broken },
      { route: { name: "extensions" }, icon: "extensions", label: "Extensões" },
      { route: { name: "settings" }, icon: "settings", label: "Definições" },
    ] },
  ];

  const active = (r: Route, dock?: boolean) => !dock && (r.name === route.name || (r.name === "workloads" && (route.name === "workload" || route.name === "create")));

  return (
    <nav id="sidebar-nav" className={`sidebar${sidebarCollapsed ? " rail" : ""}`} aria-label="Navegação principal">
      {groups.map((g) => (
        <div key={g.title}>
          <div className="lbl" aria-hidden={sidebarCollapsed || undefined}>{g.title}</div>
          <ul>
            {g.items.map((i) => (
              <li key={i.label}>
                <button
                  type="button"
                  className={`nav${active(i.route, i.dock) ? " on" : ""}`}
                  aria-current={active(i.route, i.dock) ? "page" : undefined}
                  title={sidebarCollapsed ? i.label : undefined}
                  aria-label={sidebarCollapsed ? i.label : undefined}
                  onClick={() => (i.dock ? openDock("assistant") : go(i.route))}
                >
                  <Icon name={i.icon} />
                  <span className="nav-label">{i.label}</span>
                  {i.count !== undefined && <span className="count">{i.count}</span>}
                  {!!i.badge && <span className="chip bad nav-badge" aria-label={`${i.badge} por resolver`}>{i.badge}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="sidebar-foot">
        <div className="foot-line" style={{ color: client.live ? "var(--ok)" : "var(--warn)" }} title={client.live ? "Engine local" : "Duplo local (sem Tauri)"}>
          <span className="dot" />
          <span className="foot-text">{client.live ? "Engine local" : "Duplo local (sem Tauri)"}</span>
        </div>
        <div className="muted foot-text" style={{ fontSize: 12 }}>rootless · cgroup v2</div>
      </div>
    </nav>
  );
}
