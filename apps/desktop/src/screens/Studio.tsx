// Architecture Studio (§11) — estúdio VISUAL de arquitetura cloud.
//
// Quatro modos CLARAMENTE separados:
//   Design  — a arquitetura PROPOSTA (drag-and-drop), ainda não aplicada.
//   Live    — topologia DESCOBERTA do runtime (network+workload+vm ls), read-only.
//   Plan    — DIFF de presença entre o Design e o Live.
//   Apply   — gera um manifesto `kind: Stack`, valida-o e corre `stack apply -f`
//             (ação AUTORIZADA, por confirmação de risco via act()).
//
// O canvas (reactflow) está num chunk à parte (lazy). O desenho é a fonte
// canónica; guarda-se/carrega-se em .json. A geração do manifesto é pura
// (lib/studio.ts) e validada ao vivo pelo engine antes do apply.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { Chip, CliHint, ErrorNote, PageHead, Tabs } from "../components/ui";
import { StudioApply } from "../components/StudioApply";
import { cmd } from "../lib/cli";
import { fsAvailable, homeDir, readTextFile, saveTextViaDialog, writeTextFile } from "../lib/fsx";
import { joinPath } from "../lib/fsx";
import { nativeDialogsAvailable, pickFile, YAML_FILTERS } from "../lib/native";
import type { StackPlanRow } from "../lib/types";
import {
  ALL_KINDS,
  CATALOG,
  defaultDesign,
  designToManifest,
  diffDesignVsLive,
  emptyDesign,
  liveToDesign,
  manifestToDesign,
  normalizePlanAction,
  parseDesign,
  serializeDesign,
  STUDIO_TEMPLATES,
  summarizePlan,
  validateDesign,
  type FinePlanAction,
  type Issue,
  type PlanRow,
  type StudioDesign,
  type StudioKind,
  type StudioNode,
} from "../lib/studio";

const StudioCanvas = lazy(() => import("../components/StudioCanvas"));

type Mode = "design" | "live" | "plan" | "apply";

// Histórico simples para undo/redo: passado | presente | futuro.
interface History {
  past: StudioDesign[];
  present: StudioDesign;
  future: StudioDesign[];
}

export function Studio() {
  const { client, act, toast } = useApp();
  const [mode, setMode] = useState<Mode>("design");
  // Abre num modelo PEQUENO não-vazio para o canvas não parecer vazio.
  const [hist, setHist] = useState<History>({ past: [], present: defaultDesign(), future: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const seq = useRef(100);

  const design = hist.present;
  const issues = useMemo(() => validateDesign(design), [design]);

  // Muta o desenho e empilha no histórico (undo/redo).
  const commit = useCallback((next: StudioDesign) => {
    setHist((h) => ({ past: [...h.past, h.present].slice(-50), present: next, future: [] }));
  }, []);
  const undo = useCallback(() => setHist((h) => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h)), []);
  const redo = useCallback(() => setHist((h) => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h)), []);

  const uid = (prefix: string) => `${prefix}${seq.current++}`;

  const addNode = useCallback((kind: StudioKind, x: number, y: number) => {
    const n: StudioNode = { id: uid("n"), kind, name: `${kind}-${seq.current}`, x, y, props: { ...CATALOG[kind].defaults } };
    commit({ ...design, nodes: [...design.nodes, n] });
    setSelectedId(n.id);
  }, [commit, design]);

  const patchNode = useCallback((id: string, patch: Partial<StudioNode> & { props?: Record<string, string> }) => {
    commit({
      ...design,
      nodes: design.nodes.map((n) => (n.id === id ? { ...n, ...patch, props: patch.props ? { ...n.props, ...patch.props } : n.props } : n)),
    });
  }, [commit, design]);

  const moveNode = useCallback((id: string, x: number, y: number) => {
    // Movimento não passa por commit contínuo — regista um passo por arrasto.
    commit({ ...design, nodes: design.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) });
  }, [commit, design]);

  const deleteNodes = useCallback((ids: string[]) => {
    const set = new Set(ids);
    commit({
      ...design,
      nodes: design.nodes.filter((n) => !set.has(n.id)),
      edges: design.edges.filter((e) => !set.has(e.source) && !set.has(e.target)),
    });
    setSelectedId((s) => (s && set.has(s) ? null : s));
  }, [commit, design]);

  const duplicateNode = useCallback((id: string) => {
    const src = design.nodes.find((n) => n.id === id);
    if (!src) return;
    const copy: StudioNode = { ...src, id: uid("n"), name: `${src.name}-copia`, x: src.x + 32, y: src.y + 32, props: { ...src.props } };
    commit({ ...design, nodes: [...design.nodes, copy] });
    setSelectedId(copy.id);
  }, [commit, design]);

  const deleteEdges = useCallback((ids: string[]) => {
    const set = new Set(ids);
    commit({ ...design, edges: design.edges.filter((e) => !set.has(e.id)) });
  }, [commit, design]);

  const connectNodes = useCallback((source: string, target: string) => {
    if (design.edges.some((e) => (e.source === source && e.target === target) || (e.source === target && e.target === source))) return;
    commit({ ...design, edges: [...design.edges, { id: uid("e"), source, target }] });
  }, [commit, design]);

  // Click-para-adicionar: alternativa ÓBVIA ao drag-and-drop. Coloca o nó numa
  // grelha escalonada perto do centro, deslocando conforme o nº de nós.
  const addNodeCentered = useCallback((kind: StudioKind) => {
    const i = design.nodes.length;
    addNode(kind, 240 + (i % 4) * 60, 140 + (i % 6) * 50);
  }, [addNode, design.nodes.length]);

  // Importar a topologia LIVE para um desenho editável (copia e abre em Design).
  const importDesign = useCallback((d: StudioDesign) => {
    setHist({ past: [], present: { ...d, name: d.name === "runtime" ? "runtime-import" : d.name }, future: [] });
    setSelectedId(null);
    setMode("design");
    toast("Topologia do runtime importada para Design.");
  }, [toast]);

  // Atalhos globais: Ctrl/Cmd+Z desfazer, Ctrl+Shift+Z / Ctrl+Y refazer,
  // Ctrl+D duplicar o nó selecionado. Ignorados quando se escreve num campo.
  useEffect(() => {
    if (mode !== "design") return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); }
      else if (k === "d" && selectedId) { e.preventDefault(); duplicateNode(selectedId); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, undo, redo, duplicateNode, selectedId]);

  // --- Guardar / carregar o desenho (.json) ---------------------------------
  const saveDesign = async () => {
    const path = await saveTextViaDialog(serializeDesign(design), {
      title: "Guardar desenho",
      defaultPath: `${design.name || "arquitetura"}.studio.json`,
      filters: [{ name: "Desenho do estúdio", extensions: ["json"] }, { name: "Todos", extensions: ["*"] }],
    });
    if (path) toast(`Desenho guardado em ${path}`);
  };
  const loadDesign = async () => {
    const path = await pickFile({ title: "Carregar desenho", filters: [{ name: "Desenho do estúdio", extensions: ["json"] }, { name: "Todos", extensions: ["*"] }] });
    if (!path) return;
    try {
      const d = parseDesign(await readTextFile(path));
      setHist({ past: [], present: d, future: [] });
      setSelectedId(null);
      toast(`Desenho carregado de ${path}`);
    } catch (e) {
      toast(String(e), false);
    }
  };

  // Reimportar um manifesto `kind: Stack` (YAML) → reconstrói o grafo no canvas.
  // Inverso do Apply: fecha o ciclo nos dois sentidos (ver manifestToDesign).
  const applyImport = useCallback((d: StudioDesign, warnings: string[]) => {
    setHist({ past: [], present: d, future: [] });
    setSelectedId(null);
    setMode("design");
    setImportOpen(false);
    toast(
      warnings.length
        ? `Manifesto importado — ${warnings.length} aviso(s). 1.º: ${warnings[0]}`
        : "Manifesto importado para Design.",
      warnings.length === 0,
    );
  }, [toast]);

  const errorCount = issues.filter((i) => i.level === "error").length;

  return (
    <>
      <PageHead title="Architecture Studio" subtitle="Desenha a arquitetura, compara com o runtime e aplica como manifesto declarativo">
        <div className="actions" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button className="btn sm" type="button" onClick={undo} disabled={!hist.past.length} title="Desfazer"><Icon name="restart" size={13} /> Desfazer</button>
          <button className="btn sm" type="button" onClick={redo} disabled={!hist.future.length} title="Refazer">Refazer</button>
          <button className="btn sm" type="button" onClick={() => void saveDesign()}><Icon name="download" size={13} /> Guardar</button>
          <button className="btn sm" type="button" onClick={() => void loadDesign()}>Carregar</button>
          <button className="btn sm" type="button" onClick={() => setImportOpen(true)} title="Reconstruir o grafo a partir de um manifesto kind: Stack (YAML)"><Icon name="declarative" size={13} /> Importar manifesto…</button>
        </div>
      </PageHead>

      {importOpen && <ImportModal onClose={() => setImportOpen(false)} onImport={applyImport} />}

      <div style={{ padding: "10px 24px 0" }}>
        <Tabs
          value={mode}
          onChange={setMode}
          items={[
            { id: "design", label: "Design" },
            { id: "live", label: "Live" },
            { id: "plan", label: "Plan" },
            { id: "apply", label: <>Apply{errorCount ? <span className="chip bad" style={{ marginLeft: 6 }}>{errorCount}</span> : null}</> },
          ]}
        />
      </div>

      {mode === "design" && (
        <DesignMode
          design={design} issues={issues} selectedId={selectedId}
          onSelect={setSelectedId} onAdd={addNode} onAddCentered={addNodeCentered} onMove={moveNode} onDelete={deleteNodes} onDeleteEdge={deleteEdges}
          onConnect={connectNodes} onPatch={patchNode} onDuplicate={duplicateNode}
          onTemplate={(d) => { setHist({ past: [], present: d, future: [] }); setSelectedId(null); }}
          onNew={() => { setHist({ past: [], present: emptyDesign("minha-arquitetura"), future: [] }); setSelectedId(null); }}
        />
      )}
      {mode === "live" && <LiveMode client={client} onImport={importDesign} />}
      {mode === "plan" && <PlanMode client={client} design={design} issues={issues} toast={toast} />}
      {mode === "apply" && <StudioApply design={design} issues={issues} act={act} client={client} toast={toast} />}
    </>
  );
}

// --- Importar manifesto (YAML → desenho) ------------------------------------
// Diálogo que lê um manifesto `kind: Stack`: cola o YAML ou escolhe um ficheiro
// (diálogo nativo). O parsing é PURO (manifestToDesign); erros mostram-se inline
// e nada muda até a importação ter sucesso.
function ImportModal({ onClose, onImport }: {
  onClose: () => void;
  onImport: (design: StudioDesign, warnings: string[]) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);

  const choose = async () => {
    const path = await pickFile({ title: "Escolher manifesto", filters: YAML_FILTERS });
    if (!path) return;
    try {
      setText(await readTextFile(path));
      setSource(path);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const submit = () => {
    try {
      const { design, warnings } = manifestToDesign(text);
      onImport(design, warnings);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Importar manifesto" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "grid", placeItems: "center", zIndex: 50 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(760px, 92vw)", maxHeight: "86vh", display: "flex", flexDirection: "column", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, padding: 16, boxShadow: "0 12px 40px rgba(0,0,0,.4)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <Icon name="declarative" size={16} />
          <b style={{ fontSize: 14 }}>Importar manifesto (kind: Stack)</b>
          <button className="btn sm" type="button" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Fechar"><Icon name="close" size={13} /></button>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: "0 0 10px", lineHeight: 1.5 }}>
          Cola o YAML de um manifesto <span className="mono">kind: Stack</span> ou escolhe um ficheiro. O grafo é reconstruído no canvas (redes, workloads, volumes, segredos e as suas ligações). Os campos que o estúdio não representa são <b>preservados</b> e re-emitidos tal e qual no export — os avisos dizem o que foi preservado.
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
          {nativeDialogsAvailable() && <button className="btn sm" type="button" onClick={() => void choose()}><Icon name="file" size={12} /> Escolher ficheiro…</button>}
          {source && <span className="muted mono" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{source}</span>}
        </div>
        <textarea
          className="input mono"
          value={text}
          onChange={(e) => { setText(e.target.value); setError(null); }}
          placeholder={"apiVersion: core.delonix.io/v1alpha1\nkind: Stack\nmetadata:\n  name: a-minha-stack\nspec:\n  networks: …"}
          spellCheck={false}
          style={{ flex: 1, minHeight: 280, width: "100%", resize: "vertical", fontSize: 12, whiteSpace: "pre", overflow: "auto" }}
          aria-label="YAML do manifesto"
        />
        {error && <div style={{ marginTop: 8 }}><ErrorNote error={error} /></div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button className="btn" type="button" onClick={onClose}>Cancelar</button>
          <button className="btn pri" type="button" disabled={!text.trim()} onClick={submit}><Icon name="download" size={13} /> Importar</button>
        </div>
      </div>
    </div>
  );
}

// --- Modo Design ------------------------------------------------------------

function DesignMode(props: {
  design: StudioDesign;
  issues: Issue[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (k: StudioKind, x: number, y: number) => void;
  onAddCentered: (k: StudioKind) => void;
  onMove: (id: string, x: number, y: number) => void;
  onDelete: (ids: string[]) => void;
  onDeleteEdge: (ids: string[]) => void;
  onConnect: (s: string, t: string) => void;
  onPatch: (id: string, patch: Partial<StudioNode> & { props?: Record<string, string> }) => void;
  onDuplicate: (id: string) => void;
  onTemplate: (d: StudioDesign) => void;
  onNew: () => void;
}) {
  const { design, issues, selectedId } = props;
  const selected = design.nodes.find((n) => n.id === selectedId) ?? null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "190px 1fr 280px", gap: 0, height: "calc(100vh - 220px)", minHeight: 440, padding: "12px 24px 0" }}>
      {/* Catálogo */}
      <aside style={{ borderRight: "1px solid var(--line)", paddingRight: 10, overflowY: "auto" }}>
        <div className="lbl" style={{ marginBottom: 6 }}>Catálogo</div>
        <p className="muted" style={{ fontSize: 11, margin: "0 0 10px" }}>Clica para adicionar, ou arrasta para a tela.</p>
        {ALL_KINDS.map((k) => {
          const c = CATALOG[k];
          return (
            <div
              key={k}
              role="button"
              tabIndex={0}
              draggable
              onDragStart={(e) => { e.dataTransfer.setData("application/delonix-kind", k); e.dataTransfer.effectAllowed = "copy"; }}
              onClick={() => props.onAddCentered(k)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); props.onAddCentered(k); } }}
              title={`${c.blurb}\n\nClica para adicionar ou arrasta para a tela.`}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", marginBottom: 6, border: `1px solid var(--line)`, borderLeft: `4px solid ${c.color}`, borderRadius: 6, cursor: "grab", background: "var(--panel)" }}
            >
              <Icon name={c.icon} size={14} />
              <span style={{ fontSize: 12 }}>{c.label}</span>
              {!c.emitsToStack
                ? <span className="chip neu" style={{ marginLeft: "auto", fontSize: 9 }} title="Só desenho — não entra no manifesto de stack">desenho</span>
                : <span style={{ marginLeft: "auto", opacity: 0.55, display: "inline-flex" }}><Icon name="plus" size={12} /></span>}
            </div>
          );
        })}
        <div className="lbl" style={{ margin: "14px 0 6px" }}>Modelos</div>
        <button className="btn sm" type="button" style={{ width: "100%", marginBottom: 6 }} onClick={props.onNew}>Vazio</button>
        {STUDIO_TEMPLATES.map((t) => (
          <button key={t.id} className="btn sm" type="button" title={t.blurb} style={{ width: "100%", marginBottom: 6 }} onClick={() => props.onTemplate(t.make())}>{t.label}</button>
        ))}
      </aside>

      {/* Canvas */}
      <div style={{ position: "relative", borderRight: "1px solid var(--line)" }}>
        <Suspense fallback={<div style={{ padding: 24, color: "var(--mut)" }}>A carregar o canvas…</div>}>
          <StudioCanvas
            design={design} editable selectedId={selectedId} issues={issues}
            onSelect={props.onSelect} onAdd={props.onAdd} onMove={props.onMove}
            onDelete={props.onDelete} onDeleteEdge={props.onDeleteEdge} onConnectNodes={props.onConnect}
          />
        </Suspense>
        {design.nodes.length === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", color: "var(--mut)", fontSize: 13, textAlign: "center", padding: 24 }}>
            Clica num componente do catálogo (ou arrasta-o para aqui),<br />ou escolhe um modelo à esquerda.
          </div>
        )}
        <Legend />
      </div>

      {/* Propriedades */}
      <aside style={{ paddingLeft: 12, overflowY: "auto" }}>
        <PropertyPanel node={selected} issues={issues} onPatch={props.onPatch} onDuplicate={props.onDuplicate} onDelete={props.onDelete} />
        <div className="muted" style={{ fontSize: 10, marginTop: 14, lineHeight: 1.6, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
          <b style={{ color: "var(--mut)" }}>Atalhos</b><br />
          Ctrl+Z desfazer · Ctrl+Shift+Z / Ctrl+Y refazer<br />
          Ctrl+D duplicar · Delete apagar o selecionado<br />
          Arrasta de uma pega a outra para ligar nós.
        </div>
      </aside>
    </div>
  );
}

// Legenda flutuante com a cor/ícone de cada tipo (canto inferior esquerdo).
function Legend() {
  return (
    <div style={{ position: "absolute", left: 10, bottom: 10, display: "flex", flexWrap: "wrap", gap: 6, maxWidth: 360, padding: "6px 8px", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 8, pointerEvents: "none", opacity: 0.95 }}>
      {ALL_KINDS.map((k) => (
        <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--mut)" }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: CATALOG[k].color, display: "inline-block" }} />
          {CATALOG[k].label}
        </span>
      ))}
    </div>
  );
}

function PropertyPanel({ node, issues, onPatch, onDuplicate, onDelete }: {
  node: StudioNode | null;
  issues: Issue[];
  onPatch: (id: string, patch: Partial<StudioNode> & { props?: Record<string, string> }) => void;
  onDuplicate: (id: string) => void;
  onDelete: (ids: string[]) => void;
}) {
  if (!node) {
    return (
      <div>
        <div className="lbl" style={{ marginBottom: 6 }}>Propriedades</div>
        <p className="muted" style={{ fontSize: 12 }}>Seleciona um nó para editar. Liga nós arrastando de uma pega para outra.</p>
      </div>
    );
  }
  const c = CATALOG[node.kind];
  const nodeIssues = issues.filter((i) => i.nodeId === node.id);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Icon name={c.icon} size={15} />
        <b style={{ fontSize: 13 }}>{c.label}</b>
        {!c.emitsToStack && <span className="chip neu" style={{ fontSize: 9 }}>desenho</span>}
      </div>
      <p className="muted" style={{ fontSize: 11, margin: "0 0 10px" }}>{c.blurb}</p>

      <label style={{ display: "block", fontSize: 11, color: "var(--mut)", marginBottom: 2 }}>Nome</label>
      <input className="input mono" style={{ width: "100%", marginBottom: 10 }} value={node.name} onChange={(e) => onPatch(node.id, { name: e.target.value })} aria-label="Nome do nó" />

      {c.fields.map((f) => (
        <div key={f.key} style={{ marginBottom: 10 }}>
          <label style={{ display: "block", fontSize: 11, color: "var(--mut)", marginBottom: 2 }}>{f.label}</label>
          <input
            className="input mono"
            type={f.type === "number" ? "number" : "text"}
            style={{ width: "100%" }}
            value={node.props[f.key] ?? ""}
            placeholder={f.placeholder}
            onChange={(e) => onPatch(node.id, { props: { [f.key]: e.target.value } })}
            aria-label={f.label}
          />
          {f.hint && <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>{f.hint}</div>}
        </div>
      ))}

      {nodeIssues.length > 0 && (
        <div style={{ margin: "8px 0" }}>
          {nodeIssues.map((i, idx) => (
            <div key={idx} className="chip" style={{ display: "block", fontSize: 11, marginBottom: 4, color: i.level === "error" ? "var(--bad)" : "var(--warn)" }}>{i.message}</div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button className="btn sm" type="button" onClick={() => onDuplicate(node.id)}><Icon name="copy" size={12} /> Duplicar</button>
        <button className="btn sm danger" type="button" onClick={() => onDelete([node.id])}><Icon name="trash" size={12} /> Remover</button>
      </div>
    </div>
  );
}

// --- Modo Live --------------------------------------------------------------

function LiveMode({ client, onImport }: { client: ReturnType<typeof useApp>["client"]; onImport: (d: StudioDesign) => void }) {
  const [design, setDesign] = useState<StudioDesign | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const nets = await client.networks();
      // Enriquecer com membros (a lista traz membros vazios; o detalhe tem IPs).
      const detailed = await Promise.all(nets.map((n) => client.networkDetail(n.name).catch(() => n)));
      const [workloads, vms] = await Promise.all([
        client.workloads().catch(() => []),
        client.vmList().catch(() => []),
      ]);
      setDesign(liveToDesign(detailed, workloads, vms));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [client]);

  return (
    <div style={{ padding: "12px 24px 0", height: "calc(100vh - 220px)", minHeight: 440, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 10 }}>
        <button className="btn pri" type="button" disabled={busy} onClick={() => void load()}><Icon name="restart" size={13} /> {design ? "Atualizar" : "Descobrir runtime"}</button>
        {design && design.nodes.length > 0 && (
          <button className="btn" type="button" onClick={() => onImport(design)} title="Copia a topologia observada para um desenho editável"><Icon name="copy" size={13} /> Importar para Design</button>
        )}
        <span className="muted" style={{ fontSize: 12 }}>Topologia observada (network + workload + vm ls). Só-leitura.</span>
        {!client.live && <Chip tone="warn" dot>Duplo local</Chip>}
      </div>
      {error && <ErrorNote error={error} />}
      <div style={{ flex: 1, border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
        {design ? (
          design.nodes.length ? (
            <Suspense fallback={<div style={{ padding: 24, color: "var(--mut)" }}>A carregar o canvas…</div>}>
              <StudioCanvas design={design} editable={false} selectedId={null} />
            </Suspense>
          ) : (
            <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--mut)" }}>Nenhuma rede/workload no runtime.</div>
          )
        ) : (
          <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--mut)" }}>Clica em <b style={{ margin: "0 4px" }}>Descobrir runtime</b> para ver o estado atual.</div>
        )}
      </div>
    </div>
  );
}

// --- Modo Plan --------------------------------------------------------------

// Escreve o manifesto num caminho de trabalho SEM diálogo quando o sistema de
// ficheiros está disponível (modo Tauri); caso contrário cai no save-dialog.
async function persistForCli(yaml: string, name: string): Promise<string | null> {
  if (fsAvailable()) {
    const path = joinPath(await homeDir(), `.${name || "studio"}.delonix-plan.yaml`);
    await writeTextFile(path, yaml);
    return path;
  }
  return saveTextViaDialog(yaml, { title: "Guardar manifesto para o plano", defaultPath: `${name || "studio"}.delonix.yaml`, filters: YAML_FILTERS });
}

// Verbo/cor da ação do plano REAL (stack plan). Terraform-like.
const FINE_META: Record<FinePlanAction, { verb: string; tone: "ok" | "warn" | "bad" | "inf" | "neu" }> = {
  create: { verb: "criar", tone: "inf" },
  update: { verb: "alterar", tone: "warn" },
  remove: { verb: "reverter", tone: "bad" },
  noop: { verb: "manter", tone: "neu" },
};

function PlanMode({ client, design, issues, toast }: {
  client: ReturnType<typeof useApp>["client"];
  design: StudioDesign;
  issues: Issue[];
  toast: ReturnType<typeof useApp>["toast"];
}) {
  const [rows, setRows] = useState<PlanRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fine, setFine] = useState<StackPlanRow[] | null>(null);
  const [fineError, setFineError] = useState<string | null>(null);
  const errorCount = issues.filter((i) => i.level === "error").length;

  // Diff de presença LOCAL (complemento): Design × runtime observado.
  const compute = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const nets = await client.networks();
      const detailed = await Promise.all(nets.map((n) => client.networkDetail(n.name).catch(() => n)));
      const [workloads, vms] = await Promise.all([client.workloads().catch(() => []), client.vmList().catch(() => [])]);
      const live = liveToDesign(detailed, workloads, vms);
      setRows(diffDesignVsLive(design, live));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [client, design]);

  // Plano REAL: materializa o manifesto e corre `stack plan -f` (DIFF DE 3 VIAS
  // do engine — manifesto × máquina × último apply). É o `terraform plan`.
  const computeFine = useCallback(async () => {
    setBusy(true);
    setFine(null);
    setFineError(null);
    try {
      const { yaml } = designToManifest(design);
      const path = await persistForCli(yaml, design.name);
      if (!path) return;
      setFine(await client.stackPlan(path));
    } catch (e) {
      setFineError(String(e));
      toast("Falha no stack plan — vê a saída.", false);
    } finally {
      setBusy(false);
    }
  }, [client, design, toast]);

  const tone = (a: PlanRow["action"]) => (a === "create" ? "inf" : a === "remove" ? "bad" : "neu");
  const verb = (a: PlanRow["action"]) => (a === "create" ? "criar" : a === "remove" ? "remover" : "manter");
  const counts = rows ? { create: rows.filter((r) => r.action === "create").length, keep: rows.filter((r) => r.action === "keep").length, remove: rows.filter((r) => r.action === "remove").length } : null;
  const sum = fine ? summarizePlan(fine) : null;

  return (
    <div style={{ padding: "14px 24px 0", overflowY: "auto", height: "calc(100vh - 220px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 12, flexWrap: "wrap" }}>
        <button className="btn pri" type="button" disabled={busy || errorCount > 0} title={errorCount > 0 ? "Corrige os erros do desenho primeiro" : "Diff de 3 vias do engine (stack plan -f)"} onClick={() => void computeFine()}><Icon name="declarative" size={13} /> Plan (stack plan)</button>
        <button className="btn" type="button" disabled={busy} onClick={() => void compute()}><Icon name="overview" size={13} /> Comparar presença (local)</button>
        <span className="muted" style={{ fontSize: 12 }}>O <b>Plan</b> corre <span className="mono">stack plan -f</span> — diff de 3 vias (manifesto × máquina × último apply), como o <span className="mono">terraform plan</span>. A comparação de presença é um complemento local (tipo + nome vs runtime).</span>
      </div>

      {/* Plano REAL do engine */}
      {fineError && <ErrorNote error={fineError} />}
      {sum && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <Chip tone="inf">criar {sum.create}</Chip>
            <Chip tone="warn">alterar {sum.update}</Chip>
            <Chip tone="bad">reverter {sum.remove}</Chip>
            <Chip tone="neu">manter {sum.noop}</Chip>
            <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>{sum.changed} de {sum.total} recurso(s) mudariam no apply</span>
          </div>
          {fine && fine.length === 0
            ? <p className="muted" style={{ fontSize: 12 }}>Sem mudanças — o manifesto está convergido com a máquina (ou nada declara).</p>
            : (
              <table className="table" style={{ width: "100%", borderCollapse: "collapse", marginBottom: 18 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--mut)", fontSize: 11 }}>
                    <th style={{ padding: "6px 8px" }}>Ação</th><th style={{ padding: "6px 8px" }}>Kind</th><th style={{ padding: "6px 8px" }}>Nome</th><th style={{ padding: "6px 8px" }}>Campos</th>
                  </tr>
                </thead>
                <tbody>
                  {fine!.map((r, i) => {
                    const m = FINE_META[normalizePlanAction(r.action)];
                    return (
                      <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                        <td style={{ padding: "6px 8px" }}><Chip tone={m.tone}>{m.verb}</Chip></td>
                        <td style={{ padding: "6px 8px" }} className="muted">{r.kind}</td>
                        <td style={{ padding: "6px 8px" }} className="mono">{r.name}</td>
                        <td style={{ padding: "6px 8px" }} className="muted mono">{r.diffs > 0 ? `${r.diffs} campo(s)` : r.changed ? "—" : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
        </>
      )}

      {/* Diff de presença local (complemento) */}
      {error && <ErrorNote error={error} />}
      {counts && (
        <>
          <div className="lbl" style={{ margin: "4px 0 6px" }}>Presença (Design × runtime)</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <Chip tone="inf">criar {counts.create}</Chip>
            <Chip tone="neu">manter {counts.keep}</Chip>
            <Chip tone="bad">remover {counts.remove}</Chip>
          </div>
          <table className="table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--mut)", fontSize: 11 }}>
                <th style={{ padding: "6px 8px" }}>Ação</th><th style={{ padding: "6px 8px" }}>Tipo</th><th style={{ padding: "6px 8px" }}>Nome</th>
              </tr>
            </thead>
            <tbody>
              {rows!.length === 0 && <tr><td colSpan={3} className="muted" style={{ padding: 12 }}>O desenho corresponde ao runtime.</td></tr>}
              {rows!.map((r, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "6px 8px" }}><Chip tone={tone(r.action)}>{verb(r.action)}</Chip></td>
                  <td style={{ padding: "6px 8px" }} className="muted">{CATALOG[r.kind]?.label ?? r.kind}</td>
                  <td style={{ padding: "6px 8px" }} className="mono">{r.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
