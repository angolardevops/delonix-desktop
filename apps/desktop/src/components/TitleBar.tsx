import { isTauri } from "../lib/client";
import { useApp } from "../app/context";
import { Icon, Logo } from "./Icon";

async function win(action: "minimize" | "toggleMaximize" | "close") {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow()[action]();
}

export function TitleBar() {
  const { openPalette } = useApp();
  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <Logo />
        <span>Delonix Desktop</span>
      </div>
      <div className="ctx">
        {/* Contexto: engine local hoje; hosts SSH e clusters quando existirem (ver PROMPT.md §6) */}
        <button className="mb" type="button" aria-label="Mudar de contexto" style={{ color: "var(--tx)" }}>
          <span className="dot" style={{ color: "var(--ok)" }} />
          local · rootless
          <Icon name="chevron" size={12} />
        </button>
        <button className="mb" type="button" aria-label="Mudar de namespace" style={{ color: "var(--tx)", borderLeft: "1px solid var(--line)" }}>
          <span className="muted">namespace</span>default
          <Icon name="chevron" size={12} />
        </button>
      </div>
      <div role="menubar" aria-label="Menu da aplicação" style={{ display: "flex" }} data-tauri-drag-region>
        {["Ficheiro", "Editar", "Ver", "Workloads", "Janela", "Ajuda"].map((m) => (
          <button key={m} className="mb" type="button" role="menuitem">{m}</button>
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
