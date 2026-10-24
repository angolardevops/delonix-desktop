import { useState } from "react";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { Chip, CliHint, ErrorNote, PageHead, Tabs } from "../components/ui";
import { DataTable, type Column } from "../components/DataTable";
import { cmd } from "../lib/cli";
import { useResource } from "../lib/hooks";
import type { ImageRow } from "../lib/types";

type F = "all" | "used" | "unused";

export function Images() {
  const { client, act, go } = useApp();
  const { data, error, refresh } = useResource(() => client.images(), 15000);
  const [f, setF] = useState<F>("all");
  const [ref, setRef] = useState("");
  const rows = data ?? [];
  const unused = rows.filter((r) => r.usedBy.length === 0);
  const shown = f === "all" ? rows : f === "used" ? rows.filter((r) => r.usedBy.length) : unused;

  const columns: Column<ImageRow>[] = [
    { key: "ref", header: "Repositório : tag", truncate: true, width: 320, cellClassName: "mono", cellStyle: { color: "var(--tx)", fontWeight: 500 } },
    { key: "id", header: "ID", truncate: true, width: 140, cellClassName: "mono muted" },
    { key: "size", header: "Tamanho", cellClassName: "mono" },
    { key: "created", header: "Criada", cellClassName: "muted" },
    { key: "usedBy", header: "Usada por", truncate: true, width: 220, render: (i) => (i.usedBy.length ? i.usedBy.join(", ") : <Chip tone="warn">sem uso</Chip>) },
  ];

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
          <DataTable<ImageRow>
            columns={columns}
            rows={shown}
            getKey={(i) => i.ref + i.id}
            tieBreak={(i) => i.ref + i.id}
            searchPlaceholder="Pesquisar por repositório, ID ou uso…"
            searchLabel="Pesquisar imagens"
            searchText={(i) => `${i.ref} ${i.id} ${i.usedBy.join(" ")}`}
            empty="Sem imagens"
            actions={(i) => (
              <button className="btn ico danger" type="button" aria-label={`Remover ${i.ref}`} onClick={() => void act(cmd.rmi(i.ref), `Remover ${i.ref}`).then(() => refresh())}><Icon name="trash" /></button>
            )}
          />
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
            <h2>Construir do Dockerfile</h2>
            <p style={{ margin: 0, color: "var(--tx2)" }}>Constrói uma imagem com <span className="mono">delonix build</span> e acompanha os logs ao vivo.</p>
            <button className="btn" type="button" onClick={() => go({ name: "build" })}><Icon name="build" size={13} /> Construir imagem</button>
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
