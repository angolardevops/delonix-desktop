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
import { cmd } from "../lib/cli";
import { fsAvailable, homeDir, readTextFile, saveTextViaDialog, writeTextFile } from "../lib/fsx";
import { joinPath } from "../lib/fsx";
import { nativeDialogsAvailable, pickFile, YAML_FILTERS } from "../lib/native";
import {
  ALL_KINDS,
  CATALOG,
  defaultDesign,
  designToManifest,
  diffDesignVsLive,
  emptyDesign,
  liveToDesign,
  parseDesign,
  serializeDesign,
  STUDIO_TEMPLATES,
  validateDesign,
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

  const errorCount = issues.filter((i) => i.level === "error").length;

  return (
    <>
      <PageHead title="Architecture Studio" subtitle="Desenha a arquitetura, compara com o runtime e aplica como manifesto declarativo">
        <div className="actions" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button className="btn sm" type="button" onClick={undo} disabled={!hist.past.length} title="Desfazer"><Icon name="restart" size={13} /> Desfazer</button>
          <button className="btn sm" type="button" onClick={redo} disabled={!hist.future.length} title="Refazer">Refazer</button>
          <button className="btn sm" type="button" onClick={() => void saveDesign()}><Icon name="download" size={13} /> Guardar</button>
          <button className="btn sm" type="button" onClick={() => void loadDesign()}>Carregar</button>
        </div>
      </PageHead>

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
      {mode === "apply" && <ApplyMode design={design} issues={issues} act={act} client={client} toast={toast} />}
    </>
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

function PlanMode({ client, design, issues, toast }: {
  client: ReturnType<typeof useApp>["client"];
  design: StudioDesign;
  issues: Issue[];
  toast: ReturnType<typeof useApp>["toast"];
}) {
  const [rows, setRows] = useState<PlanRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [finePlan, setFinePlan] = useState<string | null>(null);
  const errorCount = issues.filter((i) => i.level === "error").length;

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

  // Plano FINO: materializa o manifesto e corre `stack plan -f` (diff de campos).
  const computeFine = useCallback(async () => {
    setBusy(true);
    setFinePlan(null);
    try {
      const { yaml } = designToManifest(design);
      const path = await persistForCli(yaml, design.name);
      if (!path) return;
      const r = await client.readText(cmd.stackPlan(path));
      setFinePlan([r.stdout, r.stderr].filter((s) => s.trim()).join("\n") || "(sem saída)");
    } catch (e) {
      setFinePlan(String(e));
      toast("Falha no stack plan — vê a saída.", false);
    } finally {
      setBusy(false);
    }
  }, [client, design, toast]);

  const tone = (a: PlanRow["action"]) => (a === "create" ? "inf" : a === "remove" ? "bad" : "neu");
  const verb = (a: PlanRow["action"]) => (a === "create" ? "criar" : a === "remove" ? "remover" : "manter");
  const counts = rows ? { create: rows.filter((r) => r.action === "create").length, keep: rows.filter((r) => r.action === "keep").length, remove: rows.filter((r) => r.action === "remove").length } : null;

  return (
    <div style={{ padding: "14px 24px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 12, flexWrap: "wrap" }}>
        <button className="btn pri" type="button" disabled={busy} onClick={() => void compute()}><Icon name="overview" size={13} /> Comparar com o runtime</button>
        <button className="btn" type="button" disabled={busy || errorCount > 0} title={errorCount > 0 ? "Corrige os erros do desenho primeiro" : "Diff fino de campos (stack plan -f)"} onClick={() => void computeFine()}><Icon name="declarative" size={13} /> Plano fino (stack plan)</button>
        <span className="muted" style={{ fontSize: 12 }}>Diff de presença (tipo + nome) entre o Design e o Live. O plano fino de campos vem de <span className="mono">stack plan -f</span>.</span>
      </div>
      {error && <ErrorNote error={error} />}
      {counts && (
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <Chip tone="inf">criar {counts.create}</Chip>
          <Chip tone="neu">manter {counts.keep}</Chip>
          <Chip tone="bad">remover {counts.remove}</Chip>
        </div>
      )}
      {rows && (
        <table className="table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--mut)", fontSize: 11 }}>
              <th style={{ padding: "6px 8px" }}>Ação</th><th style={{ padding: "6px 8px" }}>Tipo</th><th style={{ padding: "6px 8px" }}>Nome</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={3} className="muted" style={{ padding: 12 }}>O desenho corresponde ao runtime.</td></tr>}
            {rows.map((r, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                <td style={{ padding: "6px 8px" }}><Chip tone={tone(r.action)}>{verb(r.action)}</Chip></td>
                <td style={{ padding: "6px 8px" }} className="muted">{CATALOG[r.kind]?.label ?? r.kind}</td>
                <td style={{ padding: "6px 8px" }} className="mono">{r.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {finePlan && (
        <>
          <div className="lbl" style={{ margin: "14px 0 4px" }}>Plano fino (stack plan -f)</div>
          <pre className="mono" style={{ margin: 0, padding: 10, background: "var(--bg2, rgba(0,0,0,.04))", border: "1px solid var(--line)", borderRadius: 6, overflow: "auto", maxHeight: 320, fontSize: 11, whiteSpace: "pre-wrap" }}>{finePlan}</pre>
        </>
      )}
    </div>
  );
}

// --- Modo Apply -------------------------------------------------------------

function ApplyMode({ design, issues, act, client, toast }: {
  design: StudioDesign;
  issues: Issue[];
  act: ReturnType<typeof useApp>["act"];
  client: ReturnType<typeof useApp>["client"];
  toast: ReturnType<typeof useApp>["toast"];
}) {
  const { yaml, warnings } = useMemo(() => designToManifest(design), [design]);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [validateOut, setValidateOut] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errors = issues.filter((i) => i.level === "error");

  // Guarda o manifesto num caminho escolhido pelo utilizador (save-dialog) e
  // devolve-o. A validação/aplicação correm o CLI contra esse ficheiro em disco.
  const persist = async (): Promise<string | null> => {
    const path = await saveTextViaDialog(yaml, {
      title: "Guardar manifesto gerado",
      defaultPath: `${design.name || "studio"}.delonix.yaml`,
      filters: YAML_FILTERS,
    });
    if (path) setSavedPath(path);
    return path;
  };

  const validate = async () => {
    setBusy(true);
    setValidateOut(null);
    try {
      const path = savedPath ?? (await persist());
      if (!path) return;
      const r = await client.readText(cmd.manifestValidate(path));
      setValidateOut([r.stdout, r.stderr].filter((s) => s.trim()).join("\n") || "(sem saída)");
    } catch (e) {
      setValidateOut(String(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      const path = savedPath ?? (await persist());
      if (!path) return;
      await act(cmd.stackApply(path), `Aplicar arquitetura (${path})`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: "14px 24px 0", display: "grid", gridTemplateColumns: "1fr 360px", gap: 16, height: "calc(100vh - 220px)", minHeight: 440 }}>
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div className="lbl" style={{ marginBottom: 6 }}>Manifesto gerado (kind: Stack)</div>
        <pre className="mono" style={{ flex: 1, margin: 0, padding: 12, background: "var(--bg2, rgba(0,0,0,.04))", border: "1px solid var(--line)", borderRadius: 6, overflow: "auto", fontSize: 12, whiteSpace: "pre" }}>
          {yaml}
        </pre>
      </div>
      <aside style={{ overflowY: "auto" }}>
        {errors.length > 0 && (
          <div className="note" style={{ background: "var(--badb)", borderColor: "var(--bad-line)", color: "var(--bad)", marginBottom: 10 }} role="alert">
            <b>{errors.length} erro(s) no desenho.</b> Corrige-os no Design antes de aplicar.
            <ul style={{ margin: "6px 0 0 16px", fontSize: 12 }}>{errors.slice(0, 6).map((e, i) => <li key={i}>{e.message}</li>)}</ul>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="note" style={{ background: "var(--warnb)", borderColor: "var(--warn-line)", color: "var(--warn)", marginBottom: 10 }}>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {nativeDialogsAvailable() && (
            <button className="btn" type="button" disabled={busy} onClick={() => void persist()}><Icon name="download" size={13} /> Exportar manifesto…</button>
          )}
          <button className="btn" type="button" disabled={busy} onClick={() => void validate()}><Icon name="capabilities" size={13} /> Validar com o engine</button>
          <button className="btn pri" type="button" disabled={busy || errors.length > 0} onClick={() => void apply()}><Icon name="play" size={13} /> Aplicar (stack apply)</button>
        </div>

        <p className="muted" style={{ fontSize: 11, marginTop: 10 }}>
          Aplicar é EXPLÍCITO: corre <span className="mono">stack apply -f</span> com confirmação de risco. Uma ligação desenhada não autoriza por si só rede/firewall. Efeitos irreversíveis (ex.: destruir dados) não têm rollback.
        </p>
        {savedPath && <p className="muted mono" style={{ fontSize: 11 }}>Manifesto em: {savedPath}</p>}
        <div style={{ marginTop: 8 }}><CliHint argv={cmd.stackApply(savedPath ?? "<manifesto>")} compact /></div>

        {validateOut && (
          <>
            <div className="lbl" style={{ margin: "12px 0 4px" }}>Validação</div>
            <pre className="mono" style={{ margin: 0, padding: 10, background: "var(--bg2, rgba(0,0,0,.04))", border: "1px solid var(--line)", borderRadius: 6, overflow: "auto", maxHeight: 220, fontSize: 11, whiteSpace: "pre-wrap" }}>{validateOut}</pre>
          </>
        )}
      </aside>
    </div>
  );
}
