import { useApp } from "../app/context";
import { CliHint, ErrorNote, PageHead } from "../components/ui";
import { Pager } from "../components/Pager";
import { cmd } from "../lib/cli";
import { runState, useResource } from "../lib/hooks";
import { orderBy, usePagination } from "../lib/pagination";

export function Networks() {
  const { client, go } = useApp();
  const { data, error } = useResource(() => client.networks(), 15000);
  const workloads = useResource(() => client.workloads(), 10000).data ?? [];
  const status = (n: string) => runState(workloads.find((w) => w.name === n)?.status ?? "");
  const color = (n: string) => ({ running: "var(--ok)", error: "var(--bad)", stopped: "var(--mut)" })[status(n)];
  // Cada rede é 1 item na grelha; ordenação determinística por nome e 10/página.
  const page = usePagination(orderBy(data ?? [], (n) => n.name));

  return (
    <>
      <PageHead title="Redes" subtitle="Topologia por rede, com os endereços de cada workload" />
      {error && <ErrorNote error={error} />}
      <div className="split">
        <div className="primary" style={{ padding: 0, display: "flex", flexDirection: "column" }}>
          {page.total === 0 && <p className="muted" style={{ padding: 24, margin: 0 }}>Sem redes</p>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12, padding: "20px 24px", flex: 1 }}>
            {page.items.map((n) => (
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
          <Pager page={page.page} pages={page.pages} total={page.total} canPrev={page.canPrev} canNext={page.canNext} onFirst={page.first} onPrev={page.prev} onNext={page.next} onLast={page.last} />
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
