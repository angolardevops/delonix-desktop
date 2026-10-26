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
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { Chip, CliHint, ErrorNote, PageHead, Tabs } from "../components/ui";
import { cmd } from "../lib/cli";
import { readTextFile, saveTextViaDialog } from "../lib/fsx";
import { nativeDialogsAvailable, pickFile, YAML_FILTERS } from "../lib/native";
import {
  ALL_KINDS,
  CATALOG,
  designToManifest,
  diffDesignVsLive,
  emptyDesign,
  liveToDesign,
  parseDesign,
  serializeDesign,
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

const TEMPLATES: { id: string; label: string; make: () => StudioDesign }[] = [
  {
    id: "web-db",
    label: "Web + Base de dados",
    make: () => {
      const d = emptyDesign("web-db");
      d.nodes = [
        { id: "net", kind: "network", name: "app", x: 320, y: 40, props: { driver: "bridge", subnet: "10.89.0.0/24" } },
        { id: "web", kind: "container", name: "web", x: 120, y: 240, props: { image: "nginx:latest", ports: "8080:80", env: "", command: "" } },
        { id: "db", kind: "container", name: "db", x: 540, y: 240, props: { image: "postgres:16", ports: "", env: "POSTGRES_PASSWORD=change-me", command: "" } },
        { id: "data", kind: "volume", name: "pgdata", x: 540, y: 440, props: { size: "5G", driver: "local", mount: "/var/lib/postgresql/data" } },
      ];
      d.edges = [
        { id: "e1", source: "net", target: "web" },
        { id: "e2", source: "net", target: "db" },
        { id: "e3", source: "db", target: "data" },
      ];
      return d;
    },
  },
];

export function Studio() {
  const { client, act, toast } = useApp();
  const [mode, setMode] = useState<Mode>("design");
  const [hist, setHist] = useState<History>({ past: [], present: emptyDesign("minha-arquitetura"), future: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const seq = useRef(1);

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
          onSelect={setSelectedId} onAdd={addNode} onMove={moveNode} onDelete={deleteNodes} onDeleteEdge={deleteEdges}
          onConnect={connectNodes} onPatch={patchNode} onDuplicate={duplicateNode}
          onTemplate={(d) => { setHist({ past: [], present: d, future: [] }); setSelectedId(null); }}
          onNew={() => { setHist({ past: [], present: emptyDesign("minha-arquitetura"), future: [] }); setSelectedId(null); }}
        />
      )}
      {mode === "live" && <LiveMode client={client} />}
      {mode === "plan" && <PlanMode client={client} design={design} />}
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
    <div style={{ display: "grid", gridTemplateColumns: "180px 1fr 280px", gap: 0, height: "calc(100vh - 220px)", minHeight: 440, padding: "12px 24px 0" }}>
      {/* Catálogo */}
      <aside style={{ borderRight: "1px solid var(--line)", paddingRight: 10, overflowY: "auto" }}>
        <div className="lbl" style={{ marginBottom: 6 }}>Catálogo</div>
        <p className="muted" style={{ fontSize: 11, margin: "0 0 10px" }}>Arrasta para a tela.</p>
        {ALL_KINDS.map((k) => {
          const c = CATALOG[k];
          return (
            <div
              key={k}
              draggable
              onDragStart={(e) => { e.dataTransfer.setData("application/delonix-kind", k); e.dataTransfer.effectAllowed = "copy"; }}
              title={c.blurb}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", marginBottom: 6, border: `1px solid var(--line)`, borderLeft: `4px solid ${c.color}`, borderRadius: 6, cursor: "grab", background: "var(--panel)" }}
            >
              <Icon name={c.icon} size={14} />
              <span style={{ fontSize: 12 }}>{c.label}</span>
              {!c.emitsToStack && <span className="chip neu" style={{ marginLeft: "auto", fontSize: 9 }} title="Só desenho — não entra no manifesto de stack">desenho</span>}
            </div>
          );
        })}
        <div className="lbl" style={{ margin: "14px 0 6px" }}>Modelos</div>
        <button className="btn sm" type="button" style={{ width: "100%", marginBottom: 6 }} onClick={props.onNew}>Vazio</button>
        {TEMPLATES.map((t) => (
          <button key={t.id} className="btn sm" type="button" style={{ width: "100%", marginBottom: 6 }} onClick={() => props.onTemplate(t.make())}>{t.label}</button>
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
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", color: "var(--mut)", fontSize: 13 }}>
            Arrasta um componente do catálogo para aqui, ou escolhe um modelo.
          </div>
        )}
      </div>

      {/* Propriedades */}
      <aside style={{ paddingLeft: 12, overflowY: "auto" }}>
        <PropertyPanel node={selected} issues={issues} onPatch={props.onPatch} onDuplicate={props.onDuplicate} onDelete={props.onDelete} />
      </aside>
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

function LiveMode({ client }: { client: ReturnType<typeof useApp>["client"] }) {
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

function PlanMode({ client, design }: { client: ReturnType<typeof useApp>["client"]; design: StudioDesign }) {
  const [rows, setRows] = useState<PlanRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const tone = (a: PlanRow["action"]) => (a === "create" ? "inf" : a === "remove" ? "bad" : "neu");
  const verb = (a: PlanRow["action"]) => (a === "create" ? "criar" : a === "remove" ? "remover" : "manter");

  return (
    <div style={{ padding: "14px 24px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 12 }}>
        <button className="btn pri" type="button" disabled={busy} onClick={() => void compute()}><Icon name="overview" size={13} /> Comparar com o runtime</button>
        <span className="muted" style={{ fontSize: 12 }}>Diff de presença (tipo + nome) entre o Design e o Live. O diff fino de campos vem do <span className="mono">stack plan</span> no Apply.</span>
      </div>
      {error && <ErrorNote error={error} />}
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
