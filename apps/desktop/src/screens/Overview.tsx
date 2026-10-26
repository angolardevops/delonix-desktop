import { useApp } from "../app/context";
import { Chip, ErrorNote, PageHead } from "../components/ui";
import { FleetMetrics } from "../components/FleetMetrics";
import { HealthPanel } from "../components/HealthPanel";
import { TopConsumers } from "../components/TopConsumers";
import { Icon } from "../components/Icon";
import { AreaChart, Card, CardGrid, KpiCard, KpiGrid, useRate, useTrail, type AreaSeries } from "../components/charts";
import { bucketOf } from "../lib/capability";
import { cmd } from "../lib/cli";
import { fmtBytes, isOom, runState, useResource } from "../lib/hooks";
import { fmtBinBytes } from "../lib/metrics";
import type { ResourceAdvice } from "../lib/types";

export function Overview() {
  const { client, go, act, openDock, namespace } = useApp();
  // Fontes do Dashboard SRE (§B) pelo store PARTILHADO (sem pollers duplicados):
  // frota estruturada, saúde do nó, rows+problems do dashboard, workloads e
  // providers. images/volumes alimentam a higiene de espaço.
  const metrics = useResource("system-metrics", () => client.systemMetrics(), 5000);
  const resources = useResource("system-resources", () => client.systemResources(), 15000);
  const dash = useResource("dashboard", () => client.dash(), 5000);
  const wl = useResource(["workloads", namespace], () => client.workloads(namespace), 5000);
  const prov = useResource("providers", () => client.providers(), 60000);
  const images = useResource("images", () => client.images(), 30000);
  const volumes = useResource(["volumes", namespace], () => client.volumes(namespace), 30000);

  const m = metrics.data;
  const res = resources.data;
  const rows = dash.data?.rows ?? [];
  const problems = dash.data?.problems ?? [];
  const workloads = wl.data ?? [];
  const caps = (prov.data ?? []).flatMap((p) => p.capabilities);
  const count = (b: string) => caps.filter((c) => bucketOf(c.state) === b).length;
  const oom = workloads.filter((w) => isOom(w.status));
  const unusedImages = (images.data ?? []).filter((i) => i.usedBy.length === 0).length;
  const orphanVolumes = (volumes.data ?? []).filter((v) => v.usedBy.length === 0).length;
  const running = workloads.filter((w) => runState(w.status) === "running");
  // Memória instantânea por workload a correr (das rows do dashboard), quando medida.
  const memByName = new Map(rows.filter((r) => r.mem_bytes != null).map((r) => [r.name, r.mem_bytes as number]));

  // Tendências de séries curtas (histórico acumulado entre polls do store).
  // Memória usada do engine e pressão PSI (avg10) por recurso. Uma amostra por
  // poll; só quando há dados (useTrail ignora nulos). Área num só eixo y.
  const memTrail = useTrail(metrics.data, () => (m ? m.memory_bytes_used : null), 48);
  const psiAvg = (name: string) => res?.pressure.find((p) => p.resource === name)?.avg10 ?? null;

  // --- KPIs de topo: séries REAIS (uma amostra por poll), contam uma história
  // em real-time (valor + delta sobre a janela + sparkline). Só aparecem os que
  // têm dados — nada é fabricado quando o engine devolve null. ---------------
  const runningCount = m ? m.containers_running + m.vms_running : null;
  const runTrail = useTrail(metrics.data, () => runningCount, 48);
  const memPct = m && m.memory_bytes_limit > 0 ? (m.memory_bytes_used / m.memory_bytes_limit) * 100 : null;
  const memPctTrail = useTrail(metrics.data, () => memPct, 48);
  // Taxa de rede = derivada do contador cumulativo rx+tx (B/s). null em rootless
  // sem medição → o KPI nem aparece.
  const netTotal = m && m.network_rx_bytes != null && m.network_tx_bytes != null ? m.network_rx_bytes + m.network_tx_bytes : null;
  const netRate = useRate(metrics.data, netTotal);
  const netTrail = useTrail(metrics.data, () => netRate, 48);
  const cpuPsiNow = psiAvg("cpu");
  const cpuTrail = useTrail(resources.data, () => cpuPsiNow, 48);
  const psiTrail = useTrail(
    resources.data,
    () => (res && res.pressure.length > 0 ? { cpu: psiAvg("cpu") ?? 0, memory: psiAvg("memory") ?? 0, io: psiAvg("io") ?? 0 } : null),
    48,
  );
  const psiSeries: AreaSeries[] = [
    { key: "cpu", label: "CPU", color: "var(--chart-1)", values: psiTrail.map((s) => s.cpu) },
    { key: "memory", label: "Memória", color: "var(--chart-2)", values: psiTrail.map((s) => s.memory) },
    { key: "io", label: "Disco (IO)", color: "var(--bar-ok)", values: psiTrail.map((s) => s.io) },
  ];
  const hasTrends = memTrail.length >= 2 || psiTrail.length >= 2;

  const subtitle = m
    ? `${m.containers_total + m.vms_total} workloads · ${m.containers_running + m.vms_running} a correr`
    : "A ler o engine…";

  const onAdvice = (a: ResourceAdvice) => {
    // Conselhos de configuração (delegação de controladores) resolvem-se nas
    // definições de recursos; os de capacidade, a libertar espaço (imagens).
    if (a.class === "capacity" || a.subject === "disk") go({ name: "images" });
    else go({ name: "settings", section: "resources" });
  };

  return (
    <>
      <PageHead title="Visão geral" subtitle={subtitle}>
        <button className="btn" type="button" onClick={() => go({ name: "images" })}><Icon name="activity" />Puxar imagem</button>
        <button className="btn pri" type="button" onClick={() => go({ name: "create" })}><Icon name="plus" />Novo workload</button>
      </PageHead>
      {(dash.error || metrics.error || resources.error) && <ErrorNote error={dash.error || metrics.error || resources.error || ""} />}

      <HealthPanel
        advice={res?.advice ?? []}
        bottleneck={res?.bottleneck ?? null}
        problems={problems}
        oom={oom}
        unusedImages={unusedImages}
        orphanVolumes={orphanVolumes}
        onOomLogs={(w) => { go({ name: "workload", id: w.name }); openDock("logs"); }}
        onOomStart={(w) => void act(cmd.start(w), `Iniciar ${w.name}`)}
        onAdvice={onAdvice}
        onCleanup={() => go({ name: "images" })}
      />

      {/* KPIs ao vivo — a "história" do nó em real-time (valor + variação +
          sparkline). Só os que têm série é que aparecem. */}
      {(runningCount != null || memPct != null || netRate != null || cpuPsiNow != null) && (
        <KpiGrid>
          {runningCount != null && (
            <KpiCard
              label="Workloads a correr"
              value={runningCount}
              history={runTrail}
              color="var(--chart-1)"
              live
              sub={m ? `${m.containers_total + m.vms_total} no total` : undefined}
              onClick={() => go({ name: "workloads" })}
            />
          )}
          {memPct != null && (
            <KpiCard
              label="Memória do engine"
              value={`${Math.round(memPct)}%`}
              history={memPctTrail}
              color="var(--chart-2)"
              live
              format={(n) => `${n > 0 ? "+" : ""}${n.toFixed(0)} pp`}
              sub={m ? `${fmtBytes(m.memory_bytes_used)} de ${fmtBytes(m.memory_bytes_limit)}` : undefined}
            />
          )}
          {netRate != null && (
            <KpiCard
              label="Rede (rx+tx)"
              value={`${fmtBytes(netRate)}/s`}
              history={netTrail}
              color="var(--bar-ok)"
              live
              format={(n) => `${fmtBytes(n)}/s`}
              sub="taxa derivada do cumulativo"
            />
          )}
          {cpuPsiNow != null && (
            <KpiCard
              label="Pressão CPU (PSI 10 s)"
              value={`${cpuPsiNow.toFixed(0)}%`}
              history={cpuTrail}
              color="var(--chart-1)"
              live
              format={(n) => `${n > 0 ? "+" : ""}${n.toFixed(1)} pp`}
              sub="estagnação de CPU, média 10 s"
            />
          )}
        </KpiGrid>
      )}

      <FleetMetrics metrics={m ?? null} host={res?.host ?? null} pressure={res?.pressure ?? []} go={go} />

      {hasTrends && (
        <CardGrid>
          <Card title="Tendência de memória">
            <AreaChart
              series={[{ key: "mem", label: "Memória usada", color: "var(--chart-1)", values: memTrail }]}
              format={fmtBytes}
              ariaLabel={`Tendência de memória usada do engine, ${memTrail.length} amostras`}
            />
          </Card>
          {psiTrail.length >= 2 && (
            <Card title="Tendência de pressão (PSI, 10 s)">
              <AreaChart series={psiSeries} max={100} format={(n) => `${n.toFixed(1)}%`} ariaLabel="Tendência de pressão PSI por recurso" />
            </Card>
          )}
        </CardGrid>
      )}

      <TopConsumers rows={rows} go={go} />

      {caps.length > 0 && (
        <section style={{ padding: "16px 24px", borderBottom: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="lbl">Capacidades dos providers</span>
            <button className="btn sm" type="button" onClick={() => go({ name: "capabilities" })}>Diagnóstico</button>
          </div>
          <div style={{ display: "flex", height: 6, gap: 2 }} role="img" aria-label={`${count("works")} funcionam, ${count("limited")} com limites, ${count("broken")} não funcionam`}>
            <span style={{ flex: count("works"), background: "var(--bar-ok)" }} />
            <span style={{ flex: count("limited"), background: "var(--bar-warn)" }} />
            <span style={{ flex: count("broken"), background: "var(--bar-bad)" }} />
          </div>
          <span className="muted" style={{ fontSize: 12 }}>{count("works")} funcionam · {count("limited")} com limites · {count("broken")} não funcionam</span>
        </section>
      )}

      <section aria-labelledby="run">
        <div style={{ display: "flex", alignItems: "center", padding: "12px 24px 6px" }}>
          <h2 id="run" style={{ margin: 0, fontSize: 13 }}>A correr agora</h2>
          <button className="btn sm" type="button" style={{ marginLeft: "auto" }} onClick={() => go({ name: "workloads" })}>Ver todos</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Nome</th><th>Tipo</th><th>Estado</th><th style={{ textAlign: "right" }}>Memória</th><th>Info</th></tr></thead>
            <tbody>
              {running.map((w) => (
                <tr key={w.name} onDoubleClick={() => go({ name: "workload", id: w.name })}>
                  <td><button type="button" className="btn ico" style={{ width: "auto", color: "var(--tx)", fontWeight: 500 }} onClick={() => go({ name: "workload", id: w.name })}>{w.name}</button></td>
                  <td><Chip tone={w.type === "container" ? "neu" : "inf"}>{w.type}</Chip></td>
                  <td><Chip tone="ok" dot>{w.status}</Chip></td>
                  <td className="mono" style={{ textAlign: "right" }}>{memByName.has(w.name) ? fmtBinBytes(memByName.get(w.name)) : "—"}</td>
                  <td className="mono muted">{w.info}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
