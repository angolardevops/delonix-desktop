// Vista de TOPOLOGIA de uma rede (§8.6) — grafo profissional e interativo.
//
// Carregada SEMPRE em lazy (ver screens/Networks.tsx → React.lazy): o
// `reactflow` (e o seu CSS) ficam num chunk à parte, fora do bundle inicial.
// Nós = a própria rede (centro) + cada workload ligado; arestas = pertença,
// rotuladas com o IP do membro nessa rede e animadas quando há tráfego. O
// reactflow dá pan/zoom/arrastar, minimapa e controlos de origem.
import { useMemo } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  type Edge,
  type Node,
} from "reactflow";
import "reactflow/dist/style.css";
import { fmtRate } from "../lib/metrics";
import type { NetBand } from "../lib/network";
import type { NetworkRow, WorkloadType } from "../lib/types";
import { Icon } from "./Icon";

export type MemberKind = WorkloadType | "unknown";

// Cor de token por tipo de workload (coerente com o resto da app).
const KIND_COLOR: Record<MemberKind, string> = {
  container: "var(--chart-1)",
  vm: "var(--inf)",
  pod: "var(--chart-2)",
  unknown: "var(--neu)",
};
const KIND_LABEL: Record<MemberKind, string> = {
  container: "Container",
  vm: "VM",
  pod: "Pod",
  unknown: "Workload",
};

// Etiqueta (ReactNode) do nó central — a própria rede.
function netLabel(net: NetworkRow) {
  return (
    <div style={{ textAlign: "center", lineHeight: 1.35 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        <Icon name="networks" size={14} />
        <b className="mono" style={{ fontSize: 13 }}>{net.name}</b>
      </div>
      <div className="mono" style={{ fontSize: 10, color: "var(--mut)" }}>{net.subnet || "—"}</div>
      {net.gateway && <div className="mono" style={{ fontSize: 10, color: "var(--mut)" }}>gw {net.gateway}</div>}
    </div>
  );
}

// Etiqueta de um nó de membro: tipo, nome, IP e banda ↓/↑.
function memberLabel(name: string, kind: MemberKind, ip: string, band: NetBand | undefined) {
  return (
    <div style={{ lineHeight: 1.3 }}>
      <div style={{ fontSize: 9, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--mut)" }}>{KIND_LABEL[kind]}</div>
      <b className="mono" style={{ fontSize: 12 }}>{name}</b>
      <div className="mono" style={{ fontSize: 10, color: "var(--mut)" }}>{ip || "—"}</div>
      {band && (band.rx != null || band.tx != null) && (
        <div className="mono" style={{ fontSize: 10, marginTop: 2 }}>
          <span style={{ color: "var(--ok)" }}>↓ {fmtRate(band.rx)}</span>{"  "}
          <span style={{ color: "var(--inf)" }}>↑ {fmtRate(band.tx)}</span>
        </div>
      )}
    </div>
  );
}

export interface NetworkTopologyProps {
  network: NetworkRow;
  rateByName: Map<string, NetBand>;
  kindOf: (name: string) => MemberKind;
}

export function NetworkTopology({ network, rateByName, kindOf }: NetworkTopologyProps) {
  const { nodes, edges } = useMemo(() => {
    const members = network.members;
    const n = members.length;
    // Layout radial: a rede ao centro, os membros em círculo à volta. O raio
    // cresce com o nº de membros para não se sobreporem.
    const radius = Math.max(190, n * 34);
    const nodes: Node[] = [
      {
        id: "__net__",
        position: { x: 0, y: 0 },
        data: { label: netLabel(network) },
        style: {
          width: 150,
          background: "var(--panel)",
          border: "2px solid var(--brand-core)",
          borderRadius: 10,
          color: "var(--tx)",
          padding: 8,
        },
        draggable: true,
      },
    ];
    const edges: Edge[] = [];
    members.forEach((m, i) => {
      const angle = (i / Math.max(1, n)) * 2 * Math.PI - Math.PI / 2;
      const kind = kindOf(m.name);
      const color = KIND_COLOR[kind];
      const band = rateByName.get(m.name);
      const id = `m:${m.name}`;
      nodes.push({
        id,
        position: { x: Math.round(radius * Math.cos(angle)), y: Math.round(radius * Math.sin(angle)) },
        data: { label: memberLabel(m.name, kind, m.ip, band) },
        style: {
          width: 150,
          background: "var(--bg)",
          border: `1px solid ${color}`,
          borderLeft: `4px solid ${color}`,
          borderRadius: 8,
          color: "var(--tx)",
          padding: 8,
          fontSize: 12,
        },
        draggable: true,
      });
      const active = (band?.rx ?? 0) + (band?.tx ?? 0) > 0;
      edges.push({
        id: `e:${m.name}`,
        source: "__net__",
        target: id,
        label: m.ip || undefined,
        animated: active,
        style: { stroke: color, strokeWidth: active ? 2 : 1.25 },
        labelStyle: { fill: "var(--tx2)", fontSize: 10, fontFamily: "var(--mono, monospace)" },
        labelBgStyle: { fill: "var(--panel)", fillOpacity: 0.85 },
        markerEnd: { type: MarkerType.ArrowClosed, color },
      });
    });
    return { nodes, edges };
  }, [network, rateByName, kindOf]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      fitView
      fitViewOptions={{ padding: 0.25 }}
      minZoom={0.2}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      nodesConnectable={false}
      edgesFocusable={false}
      style={{ background: "var(--bg)" }}
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--line)" />
      <MiniMap
        pannable
        zoomable
        nodeColor={(node) => (node.id === "__net__" ? "var(--brand-core)" : "var(--chart-1)")}
        style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
        maskColor="rgba(0,0,0,0.45)"
      />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export default NetworkTopology;
