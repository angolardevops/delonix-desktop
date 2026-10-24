import { useState } from "react";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { Chip, CliHint, ErrorNote, PageHead } from "../components/ui";
import { Pager } from "../components/Pager";
import { cmd } from "../lib/cli";
import { useResource } from "../lib/hooks";
import { orderBy, usePagination } from "../lib/pagination";

export function Volumes() {
  const { client, act, go } = useApp();
  const { data, error, refresh } = useResource(() => client.volumes(), 15000);
  const providers = useResource(() => client.providers(), 60000).data ?? [];
  const [name, setName] = useState("");
  const rows = data ?? [];
  const orphans = rows.filter((v) => v.usedBy.length === 0);
  // Ordenação determinística (desempate por nome) antes de paginar 10/página.
  const page = usePagination(orderBy(rows, (v) => v.name));
  // Snapshots dependem do provider de storage (btrfs/zfs/lvm). Mostra o estado real do catálogo.
  const snapshot = providers.filter((p) => p.kind === "storage").flatMap((p) => p.capabilities).find((c) => c.name.includes("snapshot"));

  return (
    <>
      <PageHead title="Volumes" subtitle={`${rows.length} volumes · ${orphans.length} órfãos`}>
        <button className="btn danger" type="button" disabled={!orphans.length} onClick={async () => { for (const v of orphans) await act(cmd.volumeRm(v.name), `Remover volume ${v.name}`); void refresh(); }}>Remover {orphans.length} órfãos</button>
      </PageHead>
      {snapshot && snapshot.state !== "supported" && (
        <div className="note">
          <span style={{ flex: "1 1 360px" }}><b>Snapshots: {snapshot.state}.</b> {snapshot.detail}</span>
          <button className="btn sm" type="button" onClick={() => go({ name: "capabilities" })}>Como resolver</button>
        </div>
      )}
      {error && <ErrorNote error={error} />}
      <div className="split">
        <div className="primary">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nome</th><th>Driver</th><th>Tamanho</th><th>Montado em</th><th style={{ textAlign: "right" }}>Ações</th></tr></thead>
              <tbody>
                {page.total === 0 && (
                  <tr><td colSpan={5} className="muted" style={{ textAlign: "center", padding: 24 }}>Sem volumes</td></tr>
                )}
                {page.items.map((v) => (
                  <tr key={v.name}>
                    <td className="mono" style={{ color: "var(--tx)", fontWeight: 500 }}>{v.name}</td>
                    <td className="muted">{v.driver}</td>
                    <td className="mono">{v.size}</td>
                    <td>{v.usedBy.length ? v.usedBy.join(", ") : <Chip tone="warn">órfão</Chip>}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn ico danger" type="button" aria-label={`Remover ${v.name}`} onClick={() => void act(cmd.volumeRm(v.name), `Remover volume ${v.name}`).then(() => refresh())}><Icon name="trash" /></button>
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
            <h2>Criar volume</h2>
            <input className="input mono" placeholder="nome" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome do volume" />
            <button className="btn pri" type="button" disabled={!name} onClick={() => void act(cmd.volumeCreate(name), `Criar volume ${name}`).then(() => refresh())}>Criar</button>
            {name && <CliHint argv={cmd.volumeCreate(name)} compact />}
          </section>
        </aside>
      </div>
    </>
  );
}
