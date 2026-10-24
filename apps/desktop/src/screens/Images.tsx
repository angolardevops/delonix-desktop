import { useState } from "react";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { Chip, CliHint, ErrorNote, PageHead, Tabs } from "../components/ui";
import { Pager } from "../components/Pager";
import { cmd } from "../lib/cli";
import { useResource } from "../lib/hooks";
import { orderBy, usePagination } from "../lib/pagination";

type F = "all" | "used" | "unused";

export function Images() {
  const { client, act } = useApp();
  const { data, error, refresh } = useResource(() => client.images(), 15000);
  const [f, setF] = useState<F>("all");
  const [ref, setRef] = useState("");
  const rows = data ?? [];
  const unused = rows.filter((r) => r.usedBy.length === 0);
  // Filtro sobre o conjunto completo, ordenação determinística (desempate por
  // ref+id) e só depois paginação de 10/página — ver lib/pagination.ts.
  const shown = orderBy(
    f === "all" ? rows : f === "used" ? rows.filter((r) => r.usedBy.length) : unused,
    (r) => r.ref + r.id,
  );
  const page = usePagination(shown);

  return (
    <>
      <PageHead title="Imagens" subtitle={`${rows.length} imagens · ${unused.length} sem uso`} />
      <Tabs<F> value={f} onChange={setF} items={[
        { id: "all", label: <>Todas <span className="muted">{rows.length}</span></> },
        { id: "used", label: <>Em uso <span className="muted">{rows.length - unused.length}</span></> },
        { id: "unused", label: <>Sem uso <span className="muted">{unused.length}</span></> },
      ]} />
      {error && <ErrorNote error={error} />}
      <div className="split">
        <div className="primary">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Repositório : tag</th><th>ID</th><th>Tamanho</th><th>Criada</th><th>Usada por</th><th style={{ textAlign: "right" }}>Ações</th></tr></thead>
              <tbody>
                {page.total === 0 && (
                  <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 24 }}>Sem imagens</td></tr>
                )}
                {page.items.map((i) => (
                  <tr key={i.ref + i.id}>
                    <td className="mono" style={{ color: "var(--tx)", fontWeight: 500 }}>{i.ref}</td>
                    <td className="mono muted">{i.id}</td>
                    <td className="mono">{i.size}</td>
                    <td className="muted">{i.created}</td>
                    <td>{i.usedBy.length ? i.usedBy.join(", ") : <Chip tone="warn">sem uso</Chip>}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn ico danger" type="button" aria-label={`Remover ${i.ref}`} onClick={() => void act(cmd.rmi(i.ref), `Remover ${i.ref}`).then(() => refresh())}><Icon name="trash" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page.page} pages={page.pages} total={page.total} canPrev={page.canPrev} canNext={page.canNext} onFirst={page.first} onPrev={page.prev} onNext={page.next} onLast={page.last} />
        </div>
        <aside className="aside">
          <section className="section">
            <h2>Puxar imagem</h2>
            <label className="muted" style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
              Referência
              <input className="input mono" value={ref} placeholder="ghcr.io/angolardevops/delonix-runtime:edge" onChange={(e) => setRef(e.target.value)} />
            </label>
            <button className="btn pri" type="button" disabled={!ref} onClick={() => void act(cmd.pull(ref), `Puxar ${ref}`).then(() => refresh())}>Puxar</button>
            {ref && <CliHint argv={cmd.pull(ref)} compact />}
          </section>
          <section className="section">
            <h2>Limpeza sugerida</h2>
            <p style={{ margin: 0, color: "var(--tx2)" }}>{unused.length} imagens sem nenhum workload a depender delas.</p>
            <button className="btn sm danger" type="button" disabled={!unused.length} onClick={async () => { for (const i of unused) await act(cmd.rmi(i.ref), `Remover ${i.ref}`); void refresh(); }}>Remover {unused.length} imagens</button>
          </section>
        </aside>
      </div>
    </>
  );
}
