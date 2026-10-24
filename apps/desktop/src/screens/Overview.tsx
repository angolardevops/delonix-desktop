import { useApp } from "../app/context";
import { Chip, ErrorNote, PageHead } from "../components/ui";
import { Icon } from "../components/Icon";
import { bucketOf } from "../lib/capability";
import { cmd } from "../lib/cli";
import { fmtBytes, isOom, runState, useResource } from "../lib/hooks";

export function Overview() {
  const { client, go, act, openDock } = useApp();
  const dash = useResource(() => client.dash(), 5000);
  const wl = useResource(() => client.workloads(), 5000);
  const prov = useResource(() => client.providers(), 60000);
  const images = useResource(() => client.images(), 30000);
  const volumes = useResource(() => client.volumes(), 30000);

  const d = dash.data;
  const workloads = wl.data ?? [];
  const caps = (prov.data ?? []).flatMap((p) => p.capabilities);
  const count = (b: string) => caps.filter((c) => bucketOf(c.state) === b).length;
  const oom = workloads.filter((w) => isOom(w.status));
  const hostIssues = caps.filter((c) => c.state === "unavailable-on-host");
  const unusedImages = (images.data ?? []).filter((i) => i.usedBy.length === 0).length;
  const orphanVolumes = (volumes.data ?? []).filter((v) => v.usedBy.length === 0).length;
  const running = workloads.filter((w) => runState(w.status) === "running");

  const attention = oom.length + hostIssues.length + (unusedImages + orphanVolumes ? 1 : 0);

  return (
    <>
      <PageHead title="Visão geral" subtitle={d ? `${d.containers_total + d.vms_total} workloads · ${d.containers_running + d.vms_running} a correr` : "A ler o engine…"}>
        <button className="btn" type="button" onClick={() => go({ name: "images" })}><Icon name="activity" />Puxar imagem</button>
        <button className="btn pri" type="button" onClick={() => go({ name: "create" })}><Icon name="plus" />Novo workload</button>
      </PageHead>
      {dash.error && <ErrorNote error={dash.error} />}

      {attention > 0 && (
        <section aria-labelledby="att" style={{ borderBottom: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 24px 8px" }}>
            <h2 id="att" style={{ margin: 0, fontSize: 13 }}>Precisa de atenção</h2>
            <Chip tone="warn">{attention}</Chip>
          </div>
          {oom.map((w) => (
            <div className="row" key={w.name}>
              <Chip tone="bad">OOM</Chip>
              <span style={{ flex: "1 1 320px" }}><b>{w.name}</b> terminou com código 137 (sem memória) · {w.status}</span>
              <button className="btn sm" type="button" onClick={() => { go({ name: "workload", id: w.name }); openDock("logs"); }}>Ver logs</button>
              <button className="btn sm pri" type="button" onClick={() => void act(cmd.start(w), `Iniciar ${w.name}`)}>Iniciar de novo</button>
            </div>
          ))}
          {hostIssues.map((c) => (
            <div className="row" key={c.name}>
              <Chip tone="bad">Host</Chip>
              <span style={{ flex: "1 1 320px" }}><span className="mono">{c.name}</span> indisponível: {c.detail}</span>
              <button className="btn sm" type="button" onClick={() => go({ name: "capabilities" })}>Resolver</button>
            </div>
          ))}
          {unusedImages + orphanVolumes > 0 && (
            <div className="row">
              <Chip tone="neu">Espaço</Chip>
              <span style={{ flex: "1 1 320px" }}>{unusedImages} imagens sem uso e {orphanVolumes} volumes órfãos</span>
              <button className="btn sm" type="button" onClick={() => go({ name: "images" })}>Rever e limpar</button>
            </div>
          )}
        </section>
      )}

      <section aria-label="Resumo" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", borderBottom: "1px solid var(--line)" }}>
        {[
          { l: "Containers", v: d?.containers_total, s: d ? `${d.containers_running} a correr` : "", r: { name: "workloads" } as const },
          { l: "VMs", v: d?.vms_total, s: d ? `${d.vms_running} a correr` : "", r: { name: "workloads" } as const },
          { l: "Imagens", v: d?.images_total, s: fmtBytes(d?.storage_bytes_images), r: { name: "images" } as const },
          { l: "Volumes", v: d?.volumes_total, s: fmtBytes(d?.storage_bytes_volumes), r: { name: "volumes" } as const },
          { l: "Redes", v: d?.networks_total, s: "", r: { name: "networks" } as const },
        ].map((k) => (
          <button key={k.l} type="button" onClick={() => go(k.r)} style={{ textAlign: "left", padding: "14px 24px", background: "transparent", border: 0, borderRight: "1px solid var(--line2)", color: "var(--tx)", cursor: "pointer", display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="lbl">{k.l}</span>
            <span style={{ fontSize: 26, fontWeight: 600 }}>{k.v ?? "—"}</span>
            <span className="muted" style={{ fontSize: 12 }}>{k.s}</span>
          </button>
        ))}
      </section>

      <section style={{ padding: "16px 24px", borderBottom: "1px solid var(--line)", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Memória</span><span className="mono">{d ? `${fmtBytes(d.memory_bytes_used)} de ${fmtBytes(d.memory_bytes_limit)}` : "—"}</span></div>
          <div className="bar"><span style={{ width: d && d.memory_bytes_limit ? `${(100 * d.memory_bytes_used) / d.memory_bytes_limit}%` : 0 }} /></div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Rede</span><span className="mono">{d?.network_rx_bytes != null ? `${fmtBytes(d.network_rx_bytes)} ↓ · ${fmtBytes(d.network_tx_bytes)} ↑` : "não medida"}</span></div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Capacidades</span><button className="btn sm" type="button" onClick={() => go({ name: "capabilities" })}>Diagnóstico</button></div>
          <div style={{ display: "flex", height: 6, gap: 2 }} role="img" aria-label={`${count("works")} funcionam, ${count("limited")} com limites, ${count("broken")} não funcionam`}>
            <span style={{ flex: count("works"), background: "var(--bar-ok)" }} />
            <span style={{ flex: count("limited"), background: "var(--bar-warn)" }} />
            <span style={{ flex: count("broken"), background: "var(--bar-bad)" }} />
          </div>
        </div>
      </section>

      <section aria-labelledby="run">
        <div style={{ display: "flex", alignItems: "center", padding: "12px 24px 6px" }}>
          <h2 id="run" style={{ margin: 0, fontSize: 13 }}>A correr agora</h2>
          <button className="btn sm" type="button" style={{ marginLeft: "auto" }} onClick={() => go({ name: "workloads" })}>Ver todos</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Nome</th><th>Tipo</th><th>Estado</th><th>Info</th></tr></thead>
            <tbody>
              {running.map((w) => (
                <tr key={w.name} onDoubleClick={() => go({ name: "workload", id: w.name })}>
                  <td><button type="button" className="btn ico" style={{ width: "auto", color: "var(--tx)", fontWeight: 500 }} onClick={() => go({ name: "workload", id: w.name })}>{w.name}</button></td>
                  <td><Chip tone={w.type === "container" ? "neu" : "inf"}>{w.type}</Chip></td>
                  <td><Chip tone="ok" dot>{w.status}</Chip></td>
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
