import { useApp } from "../app/context";
import { CliHint, ErrorNote, PageHead } from "../components/ui";
import { cmd } from "../lib/cli";
import { runState, useResource } from "../lib/hooks";

export function Networks() {
  const { client, go } = useApp();
  const { data, error } = useResource(() => client.networks(), 15000);
  const workloads = useResource(() => client.workloads(), 10000).data ?? [];
  const status = (n: string) => runState(workloads.find((w) => w.name === n)?.status ?? "");
  const color = (n: string) => ({ running: "var(--ok)", error: "var(--bad)", stopped: "var(--mut)" })[status(n)];

  return (
    <>
      <PageHead title="Redes" subtitle="Topologia por rede, com os endereços de cada workload" />
      {error && <ErrorNote error={error} />}
      <div className="split">
        <div className="primary" style={{ padding: "20px 24px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}>
            {(data ?? []).map((n) => (
              <div key={n.name} style={{ border: "1px solid var(--line)", background: "var(--panel)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--line)" }}>
                  <b className="mono">{n.name}</b>
                  <span className="chip neu" style={{ marginLeft: "auto" }}>{n.driver}</span>
                </div>
                <div className="mono muted" style={{ fontSize: 11, padding: "6px 12px" }}>{n.subnet}</div>
                {n.members.map((m) => (
                  <button key={m.name} type="button" className="opt" style={{ minHeight: 34, borderBottom: "1px solid var(--line2)" }} onClick={() => go({ name: "workload", id: m.name })}>
                    <span className="dot" style={{ color: color(m.name) }} />
                    {m.name}
                    <span className="r mono muted" style={{ fontSize: 11 }}>{m.ip}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
        <aside className="aside">
          <section className="section">
            <h2>Diagnóstico</h2>
            <p style={{ margin: 0, color: "var(--tx2)" }}>
              Teste de ligação, DNS e captura a partir de um workload usam <span className="mono">delonix net</span> e{" "}
              <span className="mono">delonix capture</span> (capacidade <span className="mono">net.capture</span>). Ver PROMPT.md §8.6.
            </p>
            <CliHint argv={cmd.networks()} compact />
          </section>
        </aside>
      </div>
    </>
  );
}
