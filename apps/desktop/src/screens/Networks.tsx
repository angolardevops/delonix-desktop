import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { Chip, CliHint, ErrorNote, PageHead } from "../components/ui";
import { DataTable, type Column } from "../components/DataTable";
import { Drawer } from "../components/Drawer";
import { Select } from "../components/Select";
import { Sparkline } from "../components/Sparkline";
import type { MemberKind } from "../components/NetworkTopology";
import { cmd } from "../lib/cli";
import { useResource } from "../lib/hooks";
import { byteRate, fmtRate, sampleFromRow, type Sample } from "../lib/metrics";
import { aggregateBand, type NetBand } from "../lib/network";
import type { DashRow, NetworkRow, WorkloadRow } from "../lib/types";

// A topologia (reactflow) entra num CHUNK À PARTE — só é descarregada quando se
// abre a vista. O bundle inicial da app não leva o reactflow nem o seu CSS.
const NetworkTopology = lazy(() => import("../components/NetworkTopology").then((m) => ({ default: m.NetworkTopology })));

const HISTORY_CAP = 30; // ~2,5 min a 5 s por amostra
const DRIVERS = [
  { value: "bridge", label: "bridge (padrão, filtrado pelo firewall)" },
  { value: "macvlan", label: "macvlan (precisa de --parent)" },
  { value: "ipvlan", label: "ipvlan (precisa de --parent)" },
  { value: "overlay", label: "overlay (VXLAN inter-nó)" },
];

interface NetSeries { rx: number[]; tx: number[] }

// Banda por workload a partir das `rows[]` do `dashboard --json`: os contadores
// net_rx/tx_bytes são CUMULATIVOS, por isso a taxa (bytes/s) sai da diferença
// entre amostras — guardamos um histórico curto por workload entre polls
// (lib/metrics.ts byteRate). Devolve a taxa atual e a série para o sparkline.
function useNetBand(): { rateByName: Map<string, NetBand>; seriesByName: Map<string, NetSeries> } {
  const { client } = useApp();
  const rows = useResource("dashboard", () => client.dash(), 5000).data?.rows ?? [];
  const ref = useRef<{ last: DashRow[] | null; hist: Map<string, Sample[]> }>({ last: null, hist: new Map() });
  if (rows !== ref.current.last) {
    ref.current.last = rows;
    const t = Date.now();
    const seen = new Set<string>();
    for (const r of rows) {
      seen.add(r.name);
      const arr = ref.current.hist.get(r.name) ?? [];
      arr.push(sampleFromRow(r, t));
      if (arr.length > HISTORY_CAP) arr.shift();
      ref.current.hist.set(r.name, arr);
    }
    for (const k of [...ref.current.hist.keys()]) if (!seen.has(k)) ref.current.hist.delete(k);
  }
  const rateByName = new Map<string, NetBand>();
  const seriesByName = new Map<string, NetSeries>();
  for (const [name, hist] of ref.current.hist) {
    const n = hist.length;
    const curr = hist[n - 1];
    const prev = hist[n - 2];
    rateByName.set(name, {
      rx: prev ? byteRate(prev.net_rx_bytes, curr.net_rx_bytes, prev.t, curr.t) : null,
      tx: prev ? byteRate(prev.net_tx_bytes, curr.net_tx_bytes, prev.t, curr.t) : null,
    });
    const rx: number[] = [];
    const tx: number[] = [];
    for (let i = 1; i < n; i++) {
      const a = hist[i - 1];
      const b = hist[i];
      const r = byteRate(a.net_rx_bytes, b.net_rx_bytes, a.t, b.t);
      const w = byteRate(a.net_tx_bytes, b.net_tx_bytes, a.t, b.t);
      if (r != null) rx.push(r);
      if (w != null) tx.push(w);
    }
    seriesByName.set(name, { rx, tx });
  }
  return { rateByName, seriesByName };
}

// Soma, alinhada pelo fim (amostra mais recente), as séries dos membros de uma
// rede — para o sparkline agregado por rede.
function aggSeries(members: { name: string }[], seriesByName: Map<string, NetSeries>, key: keyof NetSeries): number[] {
  const series = members.map((m) => seriesByName.get(m.name)?.[key] ?? []).filter((s) => s.length);
  if (!series.length) return [];
  const maxLen = Math.max(...series.map((s) => s.length));
  const out = new Array(maxLen).fill(0);
  for (const s of series) for (let i = 0; i < s.length; i++) out[maxLen - 1 - i] += s[s.length - 1 - i];
  return out;
}

export function Networks() {
  const { client, act, go } = useApp();
  const { data, error, refresh } = useResource("networks", () => client.networks(), 15000);
  const workloads = useResource("workloads", () => client.workloads(), 10000).data ?? [];
  const { rateByName, seriesByName } = useNetBand();
  const rows = data ?? [];

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [driver, setDriver] = useState("bridge");
  const [subnet, setSubnet] = useState("");
  const [connectNet, setConnectNet] = useState<string | null>(null);
  const [connectWl, setConnectWl] = useState("");
  const [topoName, setTopoName] = useState<string | null>(null);

  // Tipo de um workload (para colorir os nós da topologia e as linhas).
  const typeOf = (n: string): MemberKind => (workloads.find((w) => w.name === n)?.type ?? "unknown") as MemberKind;

  // Detalhe da rede aberta na topologia (membros COM IP + gateway). Só carrega
  // quando a vista está aberta; `null` enquanto fechada.
  const detail = useResource(
    ["network-detail", topoName ?? ""],
    () => (topoName ? client.networkDetail(topoName) : Promise.resolve(null)),
    10000,
  ).data;

  const createArgv = cmd.networkCreate({ name, driver, subnet });
  const runCreate = async () => {
    if (!name) return;
    const ok = await act(createArgv, `Criar rede ${name}`);
    if (ok) { setName(""); setSubnet(""); setDriver("bridge"); setCreateOpen(false); }
    void refresh();
  };

  // Containers EM EXECUÇÃO que ainda não estão na rede alvo (connect exige um
  // container a correr; a rede primária não se liga de novo).
  const connectCandidates = useMemo(() => {
    const net = rows.find((n) => n.name === connectNet);
    const inNet = new Set(net?.members.map((m) => m.name) ?? []);
    return workloads
      .filter((w) => w.type === "container" && /\b(up|running)\b/i.test(w.status) && !inNet.has(w.name))
      .map((w) => ({ value: w.name, label: w.name }));
  }, [rows, workloads, connectNet]);

  const runConnect = async () => {
    if (!connectNet || !connectWl) return;
    const ok = await act(cmd.networkConnect(connectNet, connectWl), `Ligar ${connectWl} a ${connectNet}`);
    if (ok) { setConnectWl(""); setConnectNet(null); }
    void refresh();
  };

  const columns: Column<NetworkRow>[] = [
    { key: "name", header: "Nome", width: 200, cellClassName: "mono", cellStyle: { color: "var(--tx)", fontWeight: 500 } },
    { key: "driver", header: "Driver", render: (n) => <Chip tone="neu">{n.driver || "bridge"}</Chip> },
    { key: "subnet", header: "Subrede", cellClassName: "mono muted" },
    { key: "members", header: "Membros", align: "right", sortable: true, sortValue: (n) => n.members.length, render: (n) => `${n.members.length}` },
    {
      key: "ingress", header: "↓ Ingress", width: 150,
      sortable: true, sortValue: (n) => aggregateBand(n.members, rateByName).rx ?? -1,
      render: (n) => {
        const b = aggregateBand(n.members, rateByName);
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span className="mono" style={{ color: "var(--ok)", minWidth: 68, textAlign: "right" }}>{fmtRate(b.rx)}</span>
            <Sparkline values={aggSeries(n.members, seriesByName, "rx")} color="var(--ok)" ariaLabel={`Ingress de ${n.name}`} />
          </span>
        );
      },
    },
    {
      key: "egress", header: "↑ Egress", width: 150,
      sortable: true, sortValue: (n) => aggregateBand(n.members, rateByName).tx ?? -1,
      render: (n) => {
        const b = aggregateBand(n.members, rateByName);
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span className="mono" style={{ color: "var(--inf)", minWidth: 68, textAlign: "right" }}>{fmtRate(b.tx)}</span>
            <Sparkline values={aggSeries(n.members, seriesByName, "tx")} color="var(--inf)" ariaLabel={`Egress de ${n.name}`} />
          </span>
        );
      },
    },
  ];

  return (
    <>
      <PageHead title="Redes" subtitle={`${rows.length} redes · banda Ingress/Egress ao vivo · clique para a topologia`}>
        <button className="btn pri" type="button" onClick={() => setCreateOpen(true)}><Icon name="plus" size={13} /> Criar rede</button>
      </PageHead>
      {error && <ErrorNote error={error} />}
      <div className="split">
        <div className="primary" style={{ padding: 0 }}>
          <DataTable<NetworkRow>
            columns={columns}
            rows={rows}
            getKey={(n) => n.name}
            searchPlaceholder="Pesquisar rede, subrede ou membro…"
            searchLabel="Pesquisar redes"
            searchText={(n) => `${n.name} ${n.driver} ${n.subnet} ${n.members.map((m) => m.name).join(" ")}`}
            empty="Sem redes"
            defaultSort={{ key: "name", dir: "asc" }}
            onRowDoubleClick={(n) => setTopoName(n.name)}
            actions={(n) => (
              <>
                <button className="btn sm" type="button" onClick={() => setTopoName(n.name)} title="Topologia"><Icon name="networks" size={12} /> Topologia</button>
                <button className="btn sm" type="button" onClick={() => { setConnectNet(n.name); setConnectWl(""); }} title="Ligar workload"><Icon name="plus" size={12} /> Ligar</button>
                <button className="btn ico danger" type="button" aria-label={`Remover ${n.name}`} onClick={() => void act(cmd.networkRm(n.name), `Remover rede ${n.name}`).then(() => refresh())}><Icon name="trash" /></button>
              </>
            )}
          />
        </div>
        <NetDiagnostics />
      </div>

      {/* Criar rede */}
      <Drawer open={createOpen} onClose={() => setCreateOpen(false)} title="Criar rede">
        <section className="section">
          <label className="lbl">Nome</label>
          <input className="input mono" placeholder="app" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome da rede" />
          <label className="lbl">Driver</label>
          <Select value={driver} onChange={setDriver} options={DRIVERS} ariaLabel="Driver da rede" />
          <label className="lbl">Subrede (opcional)</label>
          <input className="input mono" placeholder="10.234.0.0/16" value={subnet} onChange={(e) => setSubnet(e.target.value)} aria-label="Subrede" />
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            No bridge, a subrede é opcional (o engine escolhe uma /16 livre). macvlan/ipvlan exigem <span className="mono">--parent</span> e subrede.
          </p>
          <button className="btn pri" type="button" disabled={!name} onClick={runCreate}>Criar</button>
          {name && <CliHint argv={createArgv} compact />}
        </section>
      </Drawer>

      {/* Ligar workload a uma rede */}
      <Drawer open={connectNet != null} onClose={() => setConnectNet(null)} title={`Ligar workload a ${connectNet ?? ""}`}>
        <section className="section">
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Liga um container <b>em execução</b> a esta rede, a quente (multi-homing). A rede primária mantém-se.
          </p>
          <label className="lbl">Container</label>
          <Select value={connectWl} onChange={setConnectWl} options={connectCandidates} placeholder={connectCandidates.length ? "Selecionar container…" : "Sem containers em execução"} ariaLabel="Container a ligar" />
          <button className="btn pri" type="button" disabled={!connectWl} onClick={runConnect}>Ligar</button>
          {connectNet && connectWl && <CliHint argv={cmd.networkConnect(connectNet, connectWl)} compact />}
        </section>
      </Drawer>

      {/* Topologia (overlay com o grafo lazy) */}
      {topoName && createPortal(
        <TopologyOverlay
          name={topoName}
          detail={detail && detail.name === topoName ? detail : (rows.find((n) => n.name === topoName) ?? null)}
          rateByName={rateByName}
          typeOf={typeOf}
          onClose={() => setTopoName(null)}
          onConnect={() => { setConnectNet(topoName); setConnectWl(""); }}
          onDisconnect={(member) => void act(cmd.networkDisconnect(topoName, member), `Desligar ${member} de ${topoName}`).then(() => refresh())}
        />,
        document.body,
      )}
    </>
  );
}

// Overlay da topologia: cabeçalho (rede + driver + gateway), o grafo a ocupar o
// espaço e uma lista de membros com ação de desligar. O grafo é o chunk lazy.
function TopologyOverlay({
  name, detail, rateByName, typeOf, onClose, onConnect, onDisconnect,
}: {
  name: string;
  detail: NetworkRow | null;
  rateByName: Map<string, NetBand>;
  typeOf: (n: string) => MemberKind;
  onClose: () => void;
  onConnect: () => void;
  onDisconnect: (member: string) => void;
}) {
  const net: NetworkRow = detail ?? { name, driver: "", subnet: "", bridge: "", gateway: "", members: [] };
  return (
    <div className="overlay" onMouseDown={onClose} style={{ alignItems: "center", padding: 24 }}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Topologia de ${name}`}
        style={{ maxWidth: 1080, width: "92vw", height: "82vh", display: "flex", flexDirection: "column" }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
          <Icon name="networks" size={16} />
          <b className="mono">{name}</b>
          {net.driver && <Chip tone="neu">{net.driver}</Chip>}
          {net.subnet && <span className="mono muted" style={{ fontSize: 12 }}>{net.subnet}</span>}
          {net.gateway && <span className="mono muted" style={{ fontSize: 12 }}>gw {net.gateway}</span>}
          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button className="btn sm" type="button" onClick={onConnect}><Icon name="plus" size={12} /> Ligar workload</button>
            <button className="btn ico" type="button" aria-label="Fechar" onClick={onClose}><Icon name="close" /></button>
          </span>
        </header>
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
            <Suspense fallback={<div className="muted" style={{ padding: 24 }}>A carregar o grafo…</div>}>
              <NetworkTopology network={net} rateByName={rateByName} kindOf={typeOf} />
            </Suspense>
          </div>
          <aside style={{ flex: "0 0 240px", borderLeft: "1px solid var(--line)", background: "var(--panel)", overflow: "auto" }}>
            <div className="section" style={{ borderBottom: "1px solid var(--line)" }}>
              <h2 style={{ fontSize: 13 }}>Membros ({net.members.length})</h2>
            </div>
            {net.members.length === 0 && <p className="muted" style={{ padding: "12px 16px", margin: 0, fontSize: 12 }}>Nenhum workload ligado</p>}
            {net.members.map((m) => {
              const b = rateByName.get(m.name);
              return (
                <div key={m.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--line2)" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="mono" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</div>
                    <div className="mono muted" style={{ fontSize: 10 }}>{m.ip || "—"}</div>
                    {b && (b.rx != null || b.tx != null) && (
                      <div className="mono" style={{ fontSize: 10 }}>
                        <span style={{ color: "var(--ok)" }}>↓{fmtRate(b.rx)}</span> <span style={{ color: "var(--inf)" }}>↑{fmtRate(b.tx)}</span>
                      </div>
                    )}
                  </div>
                  <button className="btn ico danger" type="button" aria-label={`Desligar ${m.name}`} title="Desligar desta rede" onClick={() => onDisconnect(m.name)}><Icon name="close" size={13} /></button>
                </div>
              );
            })}
          </aside>
        </div>
      </div>
    </div>
  );
}

// Painel de Diagnóstico ligado a `network diagnose` (estado vivo do nó) + banda
// por container de `net flow`. Ambos READ.
function NetDiagnostics() {
  const { client } = useApp();
  const findings = useResource("network-diagnose", () => client.networkDiagnose(), 20000);
  const [flow, setFlow] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const runFlow = async () => {
    setBusy(true);
    try {
      const r = await client.readText(cmd.netFlow());
      setFlow((r.stdout + (r.stderr ? `\n${r.stderr}` : "")).trim() || "sem dados");
    } catch (e) {
      setFlow(String(e));
    } finally {
      setBusy(false);
    }
  };
  const tone = (s: string) => (s === "ok" ? "ok" : s === "down" ? "bad" : "warn");
  return (
    <aside className="aside">
      <section className="section">
        <h2>Diagnóstico da rede</h2>
        <p style={{ margin: 0, color: "var(--tx2)", fontSize: 12 }}>
          Estado vivo do nó: <span className="mono">network diagnose</span> (control plane, redes realizadas, registo de endereços).
        </p>
        {findings.error && <ErrorNote error={findings.error} />}
        {(findings.data ?? []).map((f) => (
          <div key={f.check} style={{ display: "flex", flexDirection: "column", gap: 2, paddingBottom: 6, borderBottom: "1px solid var(--line2)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Chip tone={tone(f.status)} dot>{f.status}</Chip>
              <b style={{ fontSize: 12 }}>{f.check}</b>
            </span>
            <span className="muted" style={{ fontSize: 12 }}>{f.detail}</span>
            {f.fix && <span className="mono" style={{ fontSize: 11, color: "var(--tx2)" }}>{f.fix}</span>}
          </div>
        ))}
        <CliHint argv={cmd.networkDiagnose()} compact />
      </section>
      <section className="section">
        <h2>Banda por container</h2>
        <p style={{ margin: 0, color: "var(--tx2)", fontSize: 12 }}>
          <span className="mono">net flow</span> — contadores de tráfego por container (eBPF; degrada a contadores veth em rootless).
        </p>
        <button className="btn sm" type="button" disabled={busy} onClick={runFlow}><Icon name="activity" size={12} /> {busy ? "A ler…" : "Ler net flow"}</button>
        {flow != null && <pre className="code" style={{ fontSize: 11, maxHeight: 200, overflow: "auto" }}>{flow}</pre>}
        <CliHint argv={cmd.netFlow()} compact />
      </section>
    </aside>
  );
}
