// Secção 2 do Dashboard SRE (§B): FROTA, de `system metrics -o json`
// (contadores ESTRUTURADOS, sem parsear as tiles humanas) + capacidade do nó e
// pressão PSI de `system resources`.
//
//  - tiles clicáveis: containers/VMs a correr vs total, imagens, volumes, redes,
//    segredos;
//  - memória usada/limite (barra);
//  - rede rx/tx (cumulativa);
//  - STORAGE por categoria (imagens+VM-images+volumes+containers) numa barra
//    EMPILHADA com legenda e bytes por família;
//  - capacidade do host (CPUs, temperatura, disco livre, swap) e PSI.
import type { Route } from "../app/context";
import { fmtBytes } from "../lib/hooks";
import { fmtBinBytes, storageBreakdown, storageTotal } from "../lib/metrics";
import type { PressureSample, ResourceHost, SystemMetrics } from "../lib/types";

const pct = (used: number, limit: number) => (limit > 0 ? Math.min(100, (100 * used) / limit) : 0);

export interface FleetMetricsProps {
  metrics: SystemMetrics | null;
  host: ResourceHost | null;
  pressure: PressureSample[];
  go: (r: Route) => void;
}

export function FleetMetrics({ metrics: m, host, pressure, go }: FleetMetricsProps) {
  const tiles: { l: string; v: number | undefined; s: string; r: Route }[] = [
    { l: "Containers", v: m?.containers_total, s: m ? `${m.containers_running} a correr` : "", r: { name: "workloads" } },
    { l: "VMs", v: m?.vms_total, s: m ? `${m.vms_running} a correr` : "", r: { name: "workloads" } },
    { l: "Imagens", v: m?.images_total, s: "em cache", r: { name: "images" } },
    { l: "Volumes", v: m?.volumes_total, s: "+ em rede", r: { name: "volumes" } },
    { l: "Redes", v: m?.networks_total, s: "", r: { name: "networks" } },
    { l: "Segredos", v: m?.secrets_total, s: "no cofre", r: { name: "secrets" } },
  ];

  const segments = m ? storageBreakdown(m) : [];
  const total = m ? storageTotal(m) : 0;

  return (
    <>
      <section aria-label="Frota" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", borderBottom: "1px solid var(--line)" }}>
        {tiles.map((k) => (
          <button key={k.l} type="button" onClick={() => go(k.r)} style={{ textAlign: "left", padding: "14px 24px", background: "transparent", border: 0, borderRight: "1px solid var(--line2)", color: "var(--tx)", cursor: "pointer", display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="lbl">{k.l}</span>
            <span style={{ fontSize: 26, fontWeight: 600 }}>{k.v ?? "—"}</span>
            <span className="muted" style={{ fontSize: 12 }}>{k.s}</span>
          </button>
        ))}
      </section>

      <section style={{ padding: "16px 24px", borderBottom: "1px solid var(--line)", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Memória</span><span className="mono">{m ? `${fmtBytes(m.memory_bytes_used)} de ${fmtBytes(m.memory_bytes_limit)}` : "—"}</span></div>
          <div className="bar"><span style={{ width: m ? `${pct(m.memory_bytes_used, m.memory_bytes_limit)}%` : 0 }} /></div>
          <span className="muted" style={{ fontSize: 12 }}>limite do slice do engine</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Rede</span><span className="mono">{m?.network_rx_bytes != null ? `${fmtBytes(m.network_rx_bytes)} ↓ · ${fmtBytes(m.network_tx_bytes)} ↑` : "não medida"}</span></div>
          <span className="muted" style={{ fontSize: 12 }}>{m && m.network_unmeasured_containers > 0 ? `${m.network_unmeasured_containers} container(s) sem rede medida` : "cumulativo (rx / tx)"}</span>
        </div>

        {/* Storage por categoria — barra empilhada. */}
        <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Armazenamento</span><span className="mono">{m ? fmtBinBytes(total) : "—"}</span></div>
          <div style={{ display: "flex", height: 8, gap: 2, background: "var(--track)" }} role="img" aria-label={segments.map((s) => `${s.label} ${fmtBinBytes(s.bytes)}`).join(", ")}>
            {total > 0 && segments.filter((s) => s.bytes > 0).map((s) => (
              <span key={s.key} style={{ flex: s.bytes, background: s.color }} title={`${s.label}: ${fmtBinBytes(s.bytes)}`} />
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>
            {segments.map((s) => (
              <span key={s.key} className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                <span style={{ width: 8, height: 8, background: s.color, display: "inline-block" }} />
                {s.label} <span className="mono">{fmtBinBytes(s.bytes)}</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {(host || pressure.length > 0) && (
        <section style={{ padding: "16px 24px", borderBottom: "1px solid var(--line)", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 24 }}>
          {host && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="lbl">Capacidade do nó</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 18px", fontSize: 12 }} className="mono">
                {host.cpus != null && <span>{host.cpus} CPUs</span>}
                {host.cpuTemperatureC != null && <span>{host.cpuTemperatureC} °C</span>}
                {host.stateRootFreeBytes != null && <span>{fmtBytes(host.stateRootFreeBytes)} disco livre</span>}
                {host.memoryAvailableBytes != null && <span>{fmtBytes(host.memoryAvailableBytes)} RAM livre</span>}
                {host.swapBytes != null && host.swapBytes > 0 && <span>swap {fmtBytes(host.swapUsedBytes)}/{fmtBytes(host.swapBytes)}</span>}
              </div>
            </div>
          )}
          {pressure.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="lbl">Pressão (PSI, 60 s)</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {pressure.map((p) => (
                  <div key={p.resource} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 64, fontSize: 12, textTransform: "uppercase" }} className="muted">{p.resource}</span>
                    <div className="bar" style={{ flex: 1 }}>
                      <span style={{ width: `${Math.min(100, p.avg60)}%`, background: p.avg60 >= 30 ? "var(--bar-bad)" : p.avg60 >= 10 ? "var(--bar-warn)" : "var(--bar-ok)" }} />
                    </div>
                    <span className="mono" style={{ width: 52, textAlign: "right", fontSize: 12 }}>{p.avg60.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}
