// Secção 2 do Dashboard SRE (§B): FROTA, de `system metrics -o json`
// (contadores ESTRUTURADOS, sem parsear as tiles humanas) + capacidade do nó e
// pressão PSI de `system resources`.
//
// Apresentação GRÁFICA (não barras/texto):
//  - tiles clicáveis: containers/VMs a correr vs total, imagens, volumes, redes,
//    segredos (números grandes, a forma certa para contagens);
//  - cartões (Grafana-lite): gauge de memória do engine; DONUT do storage por
//    categoria; gauges de capacidade do nó (RAM, temperatura, swap) + stats de
//    CPUs e disco livre; e gauges de PRESSÃO (PSI, CPU/MEM/IO).
import type { Route } from "../app/context";
import { fmtBytes } from "../lib/hooks";
import { fmtBinBytes, storageBreakdown, storageTotal } from "../lib/metrics";
import type { PressureSample, ResourceHost, SystemMetrics } from "../lib/types";
import { Card, CardGrid, Gauge, Donut, ZONES_LOAD, ZONES_PSI } from "./charts";

const PSI_LABEL: Record<string, string> = { cpu: "CPU", memory: "Memória", io: "Disco (IO)" };

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

  const storage = m ? storageBreakdown(m) : [];
  const segments = storage.map((s) => ({ key: s.key, label: s.label, value: s.bytes, color: s.color }));
  const total = m ? storageTotal(m) : 0;

  // Capacidade do nó: RAM usada = total − disponível; swap usado/total.
  const ramUsed = host?.memoryBytes != null && host.memoryAvailableBytes != null ? host.memoryBytes - host.memoryAvailableBytes : null;
  const hasSwap = host?.swapBytes != null && host.swapBytes > 0;

  return (
    <>
      {/* Frota — contagens (números grandes). */}
      <section aria-label="Frota" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", borderBottom: "1px solid var(--line)" }}>
        {tiles.map((k) => (
          <button key={k.l} type="button" onClick={() => go(k.r)} style={{ textAlign: "left", padding: "14px 24px", background: "transparent", border: 0, borderRight: "1px solid var(--line2)", color: "var(--tx)", cursor: "pointer", display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="lbl">{k.l}</span>
            <span style={{ fontSize: 26, fontWeight: 600 }}>{k.v ?? "—"}</span>
            <span className="muted" style={{ fontSize: 12 }}>{k.s}</span>
          </button>
        ))}
      </section>

      <CardGrid>
        {/* Memória do engine (gauge) + rede. */}
        <Card title="Memória do engine">
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <Gauge
              value={m ? m.memory_bytes_used : null}
              max={m ? m.memory_bytes_limit : 1}
              label="Uso"
              zones={ZONES_LOAD}
              sub={m ? `${fmtBytes(m.memory_bytes_used)} de ${fmtBytes(m.memory_bytes_limit)}` : undefined}
              ariaLabel={m ? `Memória do engine: ${fmtBytes(m.memory_bytes_used)} de ${fmtBytes(m.memory_bytes_limit)}` : "Memória do engine: sem dados"}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span className="lbl">Rede</span>
              <span className="mono" style={{ fontSize: 13 }}>
                {m?.network_rx_bytes != null ? `${fmtBytes(m.network_rx_bytes)} ↓` : "não medida"}
              </span>
              <span className="mono" style={{ fontSize: 13 }}>
                {m?.network_tx_bytes != null ? `${fmtBytes(m.network_tx_bytes)} ↑` : ""}
              </span>
              <span className="muted" style={{ fontSize: 11 }}>
                {m && m.network_unmeasured_containers > 0 ? `${m.network_unmeasured_containers} sem rede medida` : "cumulativo (rx / tx)"}
              </span>
            </div>
          </div>
        </Card>

        {/* Armazenamento por categoria — DONUT. */}
        <Card title="Armazenamento" action={<button className="btn sm" type="button" onClick={() => go({ name: "images" })}>Gerir</button>}>
          {total > 0 ? (
            <Donut segments={segments} centerLabel="Total" centerValue={fmtBinBytes(total)} format={fmtBinBytes} ariaLabel={`Armazenamento ${fmtBinBytes(total)}: ${segments.map((s) => `${s.label} ${fmtBinBytes(s.value)}`).join(", ")}`} />
          ) : (
            <span className="muted" style={{ fontSize: 12 }}>Sem armazenamento a reportar.</span>
          )}
        </Card>

        {/* Capacidade do nó — gauges + stats honestos (só onde há valor+máximo). */}
        {host && (
          <Card title="Capacidade do nó">
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
              {ramUsed != null && host.memoryBytes != null && (
                <Gauge value={ramUsed} max={host.memoryBytes} label="RAM" size={110} zones={ZONES_LOAD} sub={`${fmtBytes(host.memoryAvailableBytes)} livre`} ariaLabel={`RAM do nó: ${fmtBytes(ramUsed)} usados de ${fmtBytes(host.memoryBytes)}`} />
              )}
              {host.cpuTemperatureC != null && (
                <Gauge value={host.cpuTemperatureC} max={100} label="Temp." size={110} display={`${Math.round(host.cpuTemperatureC)}°`} zones={ZONES_LOAD} sub="CPU °C" ariaLabel={`Temperatura da CPU: ${Math.round(host.cpuTemperatureC)} graus`} />
              )}
              {hasSwap && host.swapBytes != null && (
                <Gauge value={host.swapUsedBytes} max={host.swapBytes} label="Swap" size={110} zones={ZONES_LOAD} sub={`${fmtBytes(host.swapUsedBytes)}/${fmtBytes(host.swapBytes)}`} ariaLabel={`Swap: ${fmtBytes(host.swapUsedBytes)} de ${fmtBytes(host.swapBytes)}`} />
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }} className="mono">
                {host.cpus != null && <span><b style={{ fontSize: 18 }}>{host.cpus}</b> <span className="muted">CPUs</span></span>}
                {host.stateRootFreeBytes != null && <span><b style={{ fontSize: 18 }}>{fmtBytes(host.stateRootFreeBytes)}</b> <span className="muted">disco livre</span></span>}
              </div>
            </div>
          </Card>
        )}

        {/* Pressão PSI — um gauge por recurso (CPU/MEM/IO). */}
        {pressure.length > 0 && (
          <Card title="Pressão (PSI, 60 s)">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "space-around" }}>
              {pressure.map((p) => (
                <Gauge
                  key={p.resource}
                  value={p.avg60}
                  max={100}
                  label={PSI_LABEL[p.resource] ?? p.resource}
                  size={108}
                  display={`${p.avg60.toFixed(0)}%`}
                  zones={ZONES_PSI}
                  ariaLabel={`Pressão ${PSI_LABEL[p.resource] ?? p.resource}: ${p.avg60.toFixed(1)}% em 60 segundos`}
                />
              ))}
            </div>
          </Card>
        )}
      </CardGrid>
    </>
  );
}
