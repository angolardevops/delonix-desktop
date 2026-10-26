// Canvas EDITÁVEL do Architecture Studio (§11). Carregado SEMPRE em lazy (ver
// screens/Studio.tsx): o `reactflow` e o seu CSS ficam no seu PRÓPRIO chunk,
// fora do bundle inicial e separado do chunk da tela.
//
// O desenho (StudioDesign) é controlado pela tela; aqui só o traduzimos para
// nós/arestas do reactflow e devolvemos as interações (mover, ligar, apagar,
// selecionar, largar do catálogo) por callbacks. Pan/zoom/minimapa/grelha/snap
// vêm do reactflow; as ligações são TIPADAS (isValidConnection → canConnect).
import { useCallback, useMemo } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type EdgeChange,
  type NodeChange,
  type OnEdgesChange,
  type OnNodesChange,
} from "reactflow";
import "reactflow/dist/style.css";
import { CATALOG, canConnect, edgeLabel, type Issue, type StudioDesign, type StudioKind, type StudioNode } from "../lib/studio";

export interface StudioCanvasProps {
  design: StudioDesign;
  editable: boolean;
  selectedId: string | null;
  issues?: Issue[];
  onSelect?: (id: string | null) => void;
  onConnectNodes?: (source: string, target: string) => void;
  onMove?: (id: string, x: number, y: number) => void;
  onDelete?: (ids: string[]) => void;
  onDeleteEdge?: (ids: string[]) => void;
  onAdd?: (kind: StudioKind, x: number, y: number) => void;
}

function nodeLabel(n: StudioNode) {
  const c = CATALOG[n.kind];
  const sub =
    n.kind === "container" || n.kind === "pod" ? n.props.image
    : n.kind === "network" ? (n.props.subnet || n.props.driver)
    : n.kind === "volume" ? n.props.size
    : n.kind === "vm" ? n.props.disk
    : n.kind === "secret" ? (n.props.keys ? `${n.props.keys.split(",").filter(Boolean).length} chave(s)` : "")
    : n.kind === "image" ? (n.props.pull || (n.props.buildTag ? `build ${n.props.buildTag}` : ""))
    : n.kind === "app" ? n.props.image
    : n.kind === "service" ? (n.props.port ? `:${n.props.port}${n.props.type && n.props.type !== "DNS" ? ` ${n.props.type}` : ""}` : "")
    : n.kind === "ingress" ? `${n.props.host || "*"}${n.props.path || "/"}`
    : n.kind === "tunnel" ? `${n.props.provider || "?"}:${n.props.localPort || "?"}`
    : n.kind === "dependency" ? `${n.props.from || "?"} → ${n.props.to || "?"}`
    : n.kind === "cluster" ? `${n.props.controlPlanes || "?"}cp/${n.props.workers || "?"}w`
    : n.props.provider;
  return (
    <div style={{ lineHeight: 1.3, textAlign: "left" }}>
      <div style={{ fontSize: 9, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--mut)" }}>{c.label}</div>
      <b className="mono" style={{ fontSize: 12 }}>{n.name || "(sem nome)"}</b>
      {sub ? <div className="mono" style={{ fontSize: 10, color: "var(--mut)", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div> : null}
    </div>
  );
}

function Inner(props: StudioCanvasProps) {
  const { design, editable, selectedId, issues, onSelect, onConnectNodes, onMove, onDelete, onDeleteEdge, onAdd } = props;
  const rf = useReactFlow();

  const worstByNode = useMemo(() => {
    const m = new Map<string, "error" | "warn">();
    for (const i of issues ?? []) {
      if (!i.nodeId) continue;
      if (i.level === "error" || !m.has(i.nodeId)) m.set(i.nodeId, i.level);
    }
    return m;
  }, [issues]);

  const kindById = useMemo(() => new Map(design.nodes.map((n) => [n.id, n.kind])), [design.nodes]);

  const rfNodes: Node[] = useMemo(
    () =>
      design.nodes.map((n) => {
        const color = CATALOG[n.kind].color;
        const bad = worstByNode.get(n.id);
        const ring = bad === "error" ? "var(--bad)" : bad === "warn" ? "var(--warn)" : color;
        return {
          id: n.id,
          position: { x: n.x, y: n.y },
          data: { label: nodeLabel(n) },
          selected: n.id === selectedId,
          draggable: editable,
          connectable: editable,
          style: {
            width: 164,
            background: "var(--panel)",
            border: `1px solid ${ring}`,
            borderLeft: `4px solid ${color}`,
            borderRadius: 8,
            color: "var(--tx)",
            padding: 8,
            boxShadow: n.id === selectedId ? "0 0 0 2px var(--brand-core)" : undefined,
          },
        } satisfies Node;
      }),
    [design.nodes, selectedId, editable, worstByNode],
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      design.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: edgeLabel(design, e) || undefined,
        labelBgPadding: [5, 2] as [number, number],
        labelBgBorderRadius: 4,
        labelStyle: { fill: "var(--tx)", fontSize: 10 },
        labelBgStyle: { fill: "var(--panel)", stroke: "var(--line)" },
        style: { stroke: "var(--mut)", strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "var(--mut)" },
      })),
    [design],
  );

  // Movimento: só aplicamos ao soltar (onNodeDragStop) para a tela registar um
  // passo de histórico por arrasto, não por frame.
  const onNodesChange: OnNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (!editable) return;
      for (const ch of changes) {
        if (ch.type === "remove") onDelete?.([ch.id]);
      }
    },
    [editable, onDelete],
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (!editable) return;
      const removed = changes.filter((c): c is EdgeChange & { type: "remove"; id: string } => c.type === "remove").map((c) => c.id);
      if (removed.length) onDeleteEdge?.(removed);
    },
    [editable, onDeleteEdge],
  );

  const isValid = useCallback(
    (c: Connection) => {
      const a = c.source ? kindById.get(c.source) : undefined;
      const b = c.target ? kindById.get(c.target) : undefined;
      return !!a && !!b && canConnect(a, b);
    },
    [kindById],
  );

  return (
    <div
      style={{ width: "100%", height: "100%" }}
      onDragOver={(e) => { if (editable) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
      onDrop={(e) => {
        if (!editable || !onAdd) return;
        e.preventDefault();
        const kind = e.dataTransfer.getData("application/delonix-kind") as StudioKind;
        if (!kind || !CATALOG[kind]) return;
        const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        onAdd(kind, Math.round(pos.x), Math.round(pos.y));
      }}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={(_, node) => onMove?.(node.id, Math.round(node.position.x), Math.round(node.position.y))}
        onConnect={(c) => { if (c.source && c.target) onConnectNodes?.(c.source, c.target); }}
        isValidConnection={isValid}
        onNodeClick={(_, node) => onSelect?.(node.id)}
        onPaneClick={() => onSelect?.(null)}
        nodesConnectable={editable}
        nodesDraggable={editable}
        elementsSelectable
        deleteKeyCode={editable ? ["Backspace", "Delete"] : null}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.2}
        maxZoom={2}
        snapToGrid
        snapGrid={[16, 16]}
        proOptions={{ hideAttribution: true }}
        style={{ background: "var(--bg)" }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--line)" />
        <MiniMap pannable zoomable style={{ background: "var(--panel)", border: "1px solid var(--line)" }} maskColor="rgba(0,0,0,0.45)" nodeColor={(n) => (kindById.get(n.id) ? CATALOG[kindById.get(n.id) as StudioKind].color : "var(--mut)")} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

// `screenToFlowPosition` precisa do contexto do reactflow → embrulhamos no
// Provider para o drop do catálogo converter coordenadas de ecrã em canvas.
export default function StudioCanvas(props: StudioCanvasProps) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}
