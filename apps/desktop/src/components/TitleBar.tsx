import { useMemo, useRef, useState } from "react";
import { isTauri } from "../lib/client";
import { cmd } from "../lib/cli";
import { useResource } from "../lib/hooks";
import { aboutDialog, copyText } from "../lib/native";
import { useApp } from "../app/context";
import { Icon, Logo } from "./Icon";
import { Popover } from "./Popover";

const DOCS_URL = "https://github.com/angolardevops/delonix-desktop";

async function win(action: "minimize" | "toggleMaximize" | "close") {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow()[action]();
}

type MenuItem = { label: string; onClick: () => void; shortcut?: string; danger?: boolean } | { separator: true };

// Um menu de topo (Ficheiro, Ver…) com dropdown próprio. Com `decorations:false`
// não há menu nativo do SO, por isso montamos dropdowns acionáveis sobre o
// Popover (foco preso, Escape/clique-fora fecham). Nada decorativo.
function Menu({ label, items }: { label: string; items: MenuItem[] }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={ref}
        className="mb"
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} align="start" ariaLabel={`Menu ${label}`}>
        <div role="menu" style={{ display: "flex", flexDirection: "column", padding: 4, minWidth: 216 }}>
          {items.map((it, i) =>
            "separator" in it ? (
              <div key={`s${i}`} style={{ height: 1, background: "var(--line)", margin: "4px 6px" }} />
            ) : (
              <button
                key={it.label}
                role="menuitem"
                type="button"
                onClick={() => { setOpen(false); it.onClick(); }}
                style={{
                  display: "flex", alignItems: "center", gap: 16, justifyContent: "space-between",
                  width: "100%", padding: "7px 10px", background: "transparent", border: 0,
                  color: it.danger ? "var(--bad)" : "var(--tx)", cursor: "pointer", textAlign: "left",
                  fontSize: 13, borderRadius: 4,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                onFocus={(e) => { e.currentTarget.style.background = "var(--bg)"; }}
                onBlur={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <span>{it.label}</span>
                {it.shortcut && <span className="k" style={{ opacity: 0.6 }}>{it.shortcut}</span>}
              </button>
            ),
          )}
        </div>
      </Popover>
    </>
  );
}

// Seletor de CONTEXTO. Hoje só há o engine local (rootless); em vez de um
// chevron morto, o popover é HONESTO: mostra o host/engine reais (`system info`
// + caminho do binário) e diz que o contexto é único. Nada decorativo.
function ContextPicker() {
  const { client, engine: eng } = useApp();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const info = useResource(["system-info"], () => client.readText(cmd.systemInfo()), 0).data;
  const bin = useResource("binary", () => client.binary(), 0).data;

  // Extrai uma linha "rótulo: valor" do `system info` (texto) pelo rótulo.
  const line = (label: string): string => {
    const src = info?.ok ? info.stdout : "";
    for (const raw of src.split("\n")) {
      const m = raw.match(/^\s*([^:]+):\s*(.+?)\s*$/);
      if (m && m[1].trim().toLowerCase() === label.toLowerCase()) return m[2].trim();
    }
    return "";
  };
  const engineLine = (info?.ok ? info.stdout.split("\n")[0] : "").trim();
  const mode = line("mode");

  return (
    <>
      <button ref={ref} className="mb" type="button" aria-haspopup="menu" aria-expanded={open}
        aria-label="Mostrar o contexto" style={{ color: "var(--tx)" }} onClick={() => setOpen((o) => !o)}>
        <span className="dot" style={{ color: "var(--ok)" }} />
        local · rootless
        <Icon name="chevron" size={12} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} align="start" ariaLabel="Contexto" width={320}>
        <section className="section" style={{ padding: 10 }}>
          <h2 style={{ fontSize: 12, margin: 0 }}>Contexto único (engine local rootless)</h2>
          <dl className="kv" style={{ margin: "8px 0 0" }}>
            <dt>Engine</dt><dd className="mono">{engineLine || (client.live ? "—" : "duplo local")}</dd>
            {/* Versão descoberta ao arrancar (§3); avisa se sair da família testada. */}
            <dt>Versão</dt><dd className="mono">{eng?.version ? `${eng.version}${eng.compatible ? "" : ` · testado com ${eng.expected}.x`}` : "—"}</dd>
            <dt>Modo</dt><dd className="mono">{mode || (client.live ? "—" : "duplo local")}</dd>
            <dt>Estado</dt><dd className="mono">{line("state root") || "—"}</dd>
            <dt>Binário</dt><dd className="mono" style={{ wordBreak: "break-all" }}>{bin || "—"}</dd>
          </dl>
          <p className="muted" style={{ margin: "8px 0 0", fontSize: 11 }}>
            Hosts SSH e clusters remotos aparecem aqui quando existirem (ver PROMPT.md §6).
          </p>
        </section>
      </Popover>
    </>
  );
}

// Seletor de NAMESPACE real. As namespaces vêm de `workload ls -o json` (campo
// namespace, forma SEM `-n` = todas) unidas com "default" e a ativa. Escolher
// uma muda o estado global (persistido) e re-chaveia as listas escopadas.
function NamespacePicker() {
  const { client, namespace, setNamespace } = useApp();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // Descoberta: SEM `-n` (todas as namespaces). Chave própria, independente das
  // listas escopadas por namespace, para não se auto-filtrar.
  const all = useResource(["workloads-all"], () => client.workloads(), 30000).data ?? [];
  const namespaces = useMemo(() => {
    const set = new Set<string>(["default", namespace]);
    for (const w of all) if (w.namespace) set.add(w.namespace);
    return [...set].sort((a, b) => (a === "default" ? -1 : b === "default" ? 1 : a.localeCompare(b)));
  }, [all, namespace]);

  return (
    <>
      <button ref={ref} className="mb" type="button" aria-haspopup="menu" aria-expanded={open}
        aria-label="Mudar de namespace" style={{ color: "var(--tx)", borderLeft: "1px solid var(--line)" }}
        onClick={() => setOpen((o) => !o)}>
        <span className="muted">namespace</span>{namespace}
        <Icon name="chevron" size={12} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} align="start" ariaLabel="Namespace" width={240}>
        <div role="menu" style={{ display: "flex", flexDirection: "column", padding: 4, maxHeight: 320, overflow: "auto" }}>
          {namespaces.map((ns) => (
            <button key={ns} role="menuitemradio" aria-checked={ns === namespace} type="button"
              onClick={() => { setNamespace(ns); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "7px 10px",
                background: "transparent", border: 0, color: "var(--tx)", cursor: "pointer", textAlign: "left",
                fontSize: 13, borderRadius: 4, fontWeight: ns === namespace ? 600 : 400,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
              <span style={{ width: 14, color: "var(--ok)" }}>{ns === namespace ? "✓" : ""}</span>
              <span className="mono">{ns}</span>
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

export function TitleBar() {
  const { openPalette, sidebarCollapsed, toggleSidebar, go, openDock, toast } = useApp();

  // `document.execCommand` atua sobre o input/seleção com foco — é o caminho que
  // o webview oferece para Copiar/Selecionar sem permissões extra de clipboard.
  const edit = (cmd: "copy" | "cut" | "selectAll") => { try { document.execCommand(cmd); } catch { /* sem seleção */ } };

  const copyDocs = () => void copyText(DOCS_URL).then((ok) => toast(ok ? "Link da documentação copiado" : "Não foi possível copiar", ok));
  const about = () => void aboutDialog(
    "Delonix Desktop 0.1.0\nAmbiente de trabalho para Platform Engineering, SRE e DevOps sobre o Delonix Engine.\n\n" + DOCS_URL,
    "Sobre o Delonix Desktop",
  );

  const menus: { label: string; items: MenuItem[] }[] = [
    { label: "Ficheiro", items: [
      { label: "Novo workload", onClick: () => go({ name: "create" }), shortcut: "Ctrl N" },
      { label: "Definições", onClick: () => go({ name: "settings" }) },
      { separator: true },
      { label: "Sair", onClick: () => void win("close"), danger: true },
    ] },
    { label: "Editar", items: [
      { label: "Copiar", onClick: () => edit("copy") },
      { label: "Selecionar tudo", onClick: () => edit("selectAll") },
      { separator: true },
      { label: "Pesquisar…", onClick: openPalette, shortcut: "Ctrl K" },
    ] },
    { label: "Ver", items: [
      { label: "Visão geral", onClick: () => go({ name: "overview" }) },
      { label: "Eventos", onClick: () => go({ name: "events" }) },
      { label: "Capacidades", onClick: () => go({ name: "capabilities" }) },
      { separator: true },
      { label: "Terminal", onClick: () => openDock("terminal") },
      { label: "Logs", onClick: () => openDock("logs") },
      { separator: true },
      { label: "Recarregar", onClick: () => window.location.reload() },
    ] },
    { label: "Workloads", items: [
      { label: "Todos os workloads", onClick: () => go({ name: "workloads" }) },
      { label: "Novo…", onClick: () => go({ name: "create" }), shortcut: "Ctrl N" },
      { separator: true },
      { label: "Imagens", onClick: () => go({ name: "images" }) },
      { label: "Construir imagem", onClick: () => go({ name: "build" }) },
      { label: "Volumes", onClick: () => go({ name: "volumes" }) },
      { label: "Redes", onClick: () => go({ name: "networks" }) },
    ] },
    { label: "Janela", items: [
      { label: "Minimizar", onClick: () => void win("minimize") },
      { label: "Maximizar / restaurar", onClick: () => void win("toggleMaximize") },
      { separator: true },
      { label: "Fechar", onClick: () => void win("close"), danger: true },
    ] },
    { label: "Ajuda", items: [
      { label: "Sobre o Delonix Desktop", onClick: about },
      { label: "Copiar link da documentação", onClick: copyDocs },
      { separator: true },
      { label: "Paleta de comandos", onClick: openPalette, shortcut: "Ctrl K" },
    ] },
  ];

  return (
    <div className="titlebar" data-tauri-drag-region>
      <button
        className="wc ham"
        type="button"
        aria-label={sidebarCollapsed ? "Expandir menu lateral" : "Colapsar menu lateral"}
        aria-expanded={!sidebarCollapsed}
        aria-controls="sidebar-nav"
        title="Alternar menu lateral (Ctrl B)"
        onClick={toggleSidebar}
      >
        <Icon name="menu" />
      </button>
      <div className="brand" data-tauri-drag-region>
        <Logo />
        <span>Delonix Desktop</span>
      </div>
      <div className="ctx">
        <ContextPicker />
        <NamespacePicker />
      </div>
      <div role="menubar" aria-label="Menu da aplicação" style={{ display: "flex" }}>
        {menus.map((m) => (
          <Menu key={m.label} label={m.label} items={m.items} />
        ))}
      </div>
      <button className="search" type="button" onClick={openPalette}>
        <Icon name="search" size={14} />
        Pesquisar workloads, imagens ou comandos
        <span className="k" style={{ marginLeft: "auto" }}>Ctrl K</span>
      </button>
      <div style={{ display: "flex" }}>
        <button className="wc" type="button" aria-label="Minimizar" onClick={() => void win("minimize")}><Icon name="min" /></button>
        <button className="wc" type="button" aria-label="Maximizar" onClick={() => void win("toggleMaximize")}><Icon name="max" /></button>
        <button className="wc x" type="button" aria-label="Fechar" onClick={() => void win("close")}><Icon name="close" /></button>
      </div>
    </div>
  );
}
