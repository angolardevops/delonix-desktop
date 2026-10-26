import { useEffect, useMemo, useState } from "react";
import type { Route } from "../app/context";
import { useApp } from "../app/context";
import { cmd, show } from "../lib/cli";
import { runState, useResource } from "../lib/hooks";
import { Icon } from "./Icon";

type Opt = { group: string; icon: string; label: string; hint?: string; run: () => void };

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { client, go, act, openDock, namespace } = useApp();
  const workloads = useResource(["workloads", namespace], () => client.workloads(namespace), 0).data ?? [];
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);

  const all = useMemo<Opt[]>(() => {
    const nav: [string, string, Route][] = [
      ["Visão geral", "overview", { name: "overview" }], ["Workloads", "workloads", { name: "workloads" }],
      ["Imagens", "images", { name: "images" }], ["Volumes", "volumes", { name: "volumes" }],
      ["Redes", "networks", { name: "networks" }], ["Capacidades", "capabilities", { name: "capabilities" }],
      ["Eventos e métricas", "events", { name: "events" }], ["Definições", "settings", { name: "settings" }],
    ];
    const opts: Opt[] = [];
    for (const w of workloads) {
      opts.push({ group: "Workload", icon: "workloads", label: `${w.name} · ${w.type} · ${w.status}`, hint: "Abrir", run: () => go({ name: "workload", id: w.name }) });
      opts.push({ group: `Ações em ${w.name}`, icon: "logs", label: `Ver logs de ${w.name}`, hint: show(cmd.logsFollow(w.name)), run: () => openDock("logs") });
      const running = runState(w.status) === "running";
      const argv = running ? cmd.stop(w) : cmd.start(w);
      opts.push({ group: `Ações em ${w.name}`, icon: running ? "stop" : "play", label: `${running ? "Parar" : "Iniciar"} ${w.name}`, hint: show(argv), run: () => void act(argv, `${running ? "Parar" : "Iniciar"} ${w.name}`) });
    }
    opts.push({ group: "Comandos", icon: "plus", label: "Novo workload", hint: "Ctrl N", run: () => go({ name: "create" }) });
    for (const [label, icon, r] of nav) opts.push({ group: "Ir para", icon, label, run: () => go(r) });
    return opts;
  }, [workloads, go, act, openDock]);

  const items = all.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())).slice(0, 14);

  useEffect(() => setSel(0), [q]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    if (e.key === "Enter" && items[sel]) { items[sel].run(); onClose(); }
  };

  let lastGroup = "";
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Paleta de comandos" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <label style={{ display: "flex", alignItems: "center", gap: 10, height: 48, padding: "0 16px", borderBottom: "1px solid var(--line)" }}>
          <Icon name="search" />
          <span className="sr-only">Pesquisar ou executar</span>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar ou executar" style={{ flex: 1, background: "transparent", border: 0, outline: "none", color: "var(--tx)", fontSize: 15 }} />
          <span className="k">Esc</span>
        </label>
        <div role="listbox" style={{ maxHeight: 460, overflow: "auto", paddingBottom: 8 }}>
          {items.map((o, i) => {
            const head = o.group !== lastGroup ? <div className="lbl" style={{ padding: "10px 16px 4px" }}>{o.group}</div> : null;
            lastGroup = o.group;
            return (
              <div key={o.group + o.label}>
                {head}
                <button type="button" role="option" aria-selected={i === sel} className={`opt${i === sel ? " on" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => { o.run(); onClose(); }}>
                  <Icon name={o.icon} />
                  {o.label}
                  {o.hint && <span className="r mono muted" style={{ fontSize: 12 }}>{o.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 14, padding: "8px 16px", borderTop: "1px solid var(--line)", background: "var(--panel)", fontSize: 12, color: "var(--mut)" }}>
          <span><span className="k">↑↓</span> navegar</span><span><span className="k">Enter</span> executar</span>
          <span style={{ marginLeft: "auto" }}>Mostra sempre o comando CLI equivalente</span>
        </div>
      </div>
    </div>
  );
}
