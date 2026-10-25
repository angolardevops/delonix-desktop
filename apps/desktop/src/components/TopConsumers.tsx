// Secção 3 do Dashboard SRE (§B): TOP CONSUMERS, das `rows[]` do
// `dashboard --json`.
//
// As rows trazem contadores crus (cpu_usage_usec monotónico, mem_bytes
// instantâneo, io/net cumulativos). As TAXAS calculam-se de amostra-a-amostra
// (lib/metrics.ts), por isso guardamos um histórico curto POR recurso entre
// polls. VMs e recursos parados não trazem números → "não medido" honesto.
// Ordenável por CPU, memória, IO ou rede; cada linha tem um sparkline de
// tendência da métrica escolhida.
import { useRef, useState } from "react";
import type { Route } from "../app/context";
import { byteRate, cpuRate, fmtBinBytes, fmtRate, latestRates, sampleFromRow, type Sample } from "../lib/metrics";
import type { DashRow } from "../lib/types";
import { Chip } from "./ui";
import { Select } from "./Select";
import { Sparkline } from "./Sparkline";

type Metric = "cpu" | "mem" | "io" | "net";
const HISTORY_CAP = 30; // ~2,5 min a 5 s por amostra
const TOP_N = 8;

const METRICS: { value: Metric; label: string }[] = [
  { value: "cpu", label: "CPU" },
  { value: "mem", label: "Memória" },
  { value: "io", label: "Disco (IO)" },
  { value: "net", label: "Rede" },
];

// Só os recursos que CONSOMEM (container/VM/pod); redes e volumes nunca têm taxa.
const isCompute = (kind: string): boolean => {
  const k = kind.toLowerCase();
  return k.includes("container") || k.includes("vm") || k.includes("virtualmachine") || k.includes("pod");
};

const rowKey = (r: DashRow) => `${r.kind}/${r.name}`;

// Histórico curto por recurso, atualizado uma vez por amostra (identidade de
// `rows` muda a cada poll). Guardado num ref e podado aos recursos presentes.
function useRowHistory(rows: DashRow[]): Map<string, Sample[]> {
  const ref = useRef<{ last: DashRow[] | null; hist: Map<string, Sample[]> }>({ last: null, hist: new Map() });
  if (rows !== ref.current.last) {
    ref.current.last = rows;
    const t = Date.now();
    const seen = new Set<string>();
    for (const r of rows) {
      const key = rowKey(r);
      seen.add(key);
      const arr = ref.current.hist.get(key) ?? [];
      arr.push(sampleFromRow(r, t));
      if (arr.length > HISTORY_CAP) arr.shift();
      ref.current.hist.set(key, arr);
    }
    for (const k of [...ref.current.hist.keys()]) if (!seen.has(k)) ref.current.hist.delete(k);
  }
  return ref.current.hist;
}

// Série numérica da métrica escolhida ao longo do histórico (para o sparkline):
// memória é instantânea; CPU/IO/rede são taxas calculadas entre pares.
function seriesFor(hist: Sample[], metric: Metric): number[] {
  if (metric === "mem") return hist.map((s) => s.mem_bytes).filter((v): v is number => v != null);
  const out: number[] = [];
  for (let i = 1; i < hist.length; i++) {
    const a = hist[i - 1];
    const b = hist[i];
    let v: number | null = null;
    if (metric === "cpu") v = cpuRate(a, b)?.cores ?? null;
    else if (metric === "io") {
      const r = byteRate(a.io_read_bytes, b.io_read_bytes, a.t, b.t);
      const w = byteRate(a.io_write_bytes, b.io_write_bytes, a.t, b.t);
      v = r == null && w == null ? null : (r ?? 0) + (w ?? 0);
    } else {
      const rx = byteRate(a.net_rx_bytes, b.net_rx_bytes, a.t, b.t);
      const tx = byteRate(a.net_tx_bytes, b.net_tx_bytes, a.t, b.t);
      v = rx == null && tx == null ? null : (rx ?? 0) + (tx ?? 0);
    }
    if (v != null) out.push(v);
  }
  return out;
}

const typeTone = (kind: string): "neu" | "inf" => (kind.toLowerCase().includes("container") ? "neu" : "inf");
const typeLabel = (kind: string): string => {
  const k = kind.toLowerCase();
  if (k.includes("container")) return "container";
  if (k.includes("pod")) return "pod";
  return "VM";
};

export interface TopConsumersProps {
  rows: DashRow[];
  go: (r: Route) => void;
}

export function TopConsumers({ rows, go }: TopConsumersProps) {
  const [metric, setMetric] = useState<Metric>("cpu");
  const hist = useRowHistory(rows);

  const compute = rows.filter((r) => isCompute(r.kind));
  const enriched = compute.map((r) => {
    const h = hist.get(rowKey(r)) ?? [];
    const rates = latestRates(h);
    const io = rates.ioRead == null && rates.ioWrite == null ? null : (rates.ioRead ?? 0) + (rates.ioWrite ?? 0);
    const net = rates.netRx == null && rates.netTx == null ? null : (rates.netRx ?? 0) + (rates.netTx ?? 0);
    const sortVal = metric === "cpu" ? rates.cpu?.cores ?? null : metric === "mem" ? rates.mem : metric === "io" ? io : net;
    const measured = rates.cpu != null || rates.mem != null || io != null || net != null;
    return { r, rates, io, net, measured, sortVal, series: seriesFor(h, metric) };
  });

  // Medidos primeiro, por valor da métrica escolhida (desc); não medidos no fim.
  enriched.sort((a, b) => (b.sortVal ?? -1) - (a.sortVal ?? -1));
  const shown = enriched.slice(0, TOP_N);
  const measuredCount = enriched.filter((e) => e.measured).length;

  return (
    <section aria-labelledby="sre-top" style={{ borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 24px 6px" }}>
        <h2 id="sre-top" style={{ margin: 0, fontSize: 13 }}>Top consumers</h2>
        <span className="muted" style={{ fontSize: 12 }}>{measuredCount} medido(s)</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span className="lbl">Ordenar por</span>
          <Select size="sm" ariaLabel="Ordenar top consumers por" value={metric} onChange={(v) => setMetric(v as Metric)} options={METRICS} searchable={false} style={{ minWidth: 130 }} />
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Tipo</th>
              <th style={{ textAlign: "right" }}>CPU</th>
              <th style={{ textAlign: "right" }}>Memória</th>
              <th style={{ textAlign: "right" }}>Disco r/w</th>
              <th style={{ textAlign: "right" }}>Rede rx/tx</th>
              <th style={{ width: 90 }}>Tendência</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={7} className="muted" style={{ padding: "16px 24px" }}>Sem containers ou VMs a reportar métricas.</td></tr>
            )}
            {shown.map(({ r, rates, measured, series }) => (
              <tr key={rowKey(r)} onDoubleClick={() => go({ name: "workload", id: r.name })}>
                <td><button type="button" className="btn ico" style={{ width: "auto", color: "var(--tx)", fontWeight: 500 }} onClick={() => go({ name: "workload", id: r.name })}>{r.name}</button></td>
                <td><Chip tone={typeTone(r.kind)}>{typeLabel(r.kind)}</Chip></td>
                {measured ? (
                  <>
                    <td className="mono" style={{ textAlign: "right" }}>{rates.cpu ? `${rates.cpu.pctPerCore.toFixed(0)}%` : "—"}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{fmtBinBytes(rates.mem)}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{rates.ioRead == null && rates.ioWrite == null ? "—" : `${fmtRate(rates.ioRead)} / ${fmtRate(rates.ioWrite)}`}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{rates.netRx == null && rates.netTx == null ? "—" : `${fmtRate(rates.netRx)} / ${fmtRate(rates.netTx)}`}</td>
                    <td><Sparkline values={series} ariaLabel={`tendência de ${METRICS.find((m) => m.value === metric)?.label} de ${r.name}`} /></td>
                  </>
                ) : (
                  <td colSpan={5} className="muted" style={{ fontStyle: "italic" }}>não medido ({typeLabel(r.kind) === "VM" ? "VM" : "parado"})</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
