import { useState } from "react";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { Chip, CliHint, ErrorNote, PageHead } from "../components/ui";
import { DataTable, type Column } from "../components/DataTable";
import { Drawer } from "../components/Drawer";
import { cmd } from "../lib/cli";
import { useResource } from "../lib/hooks";
import type { VolumeRow } from "../lib/types";

export function Volumes() {
  const { client, act, go } = useApp();
  const { data, error, refresh } = useResource(() => client.volumes(), 15000);
  const providers = useResource(() => client.providers(), 60000).data ?? [];
  const [name, setName] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const rows = data ?? [];
  const orphans = rows.filter((v) => v.usedBy.length === 0);
  // Snapshots dependem do provider de storage (btrfs/zfs/lvm). Mostra o estado real do catálogo.
  const snapshot = providers.filter((p) => p.kind === "storage").flatMap((p) => p.capabilities).find((c) => c.name.includes("snapshot"));

  const columns: Column<VolumeRow>[] = [
    { key: "name", header: "Nome", truncate: true, width: 240, cellClassName: "mono", cellStyle: { color: "var(--tx)", fontWeight: 500 } },
    { key: "driver", header: "Driver", cellClassName: "muted" },
    { key: "size", header: "Tamanho", cellClassName: "mono" },
    { key: "usedBy", header: "Montado em", truncate: true, width: 260, render: (v) => (v.usedBy.length ? v.usedBy.join(", ") : <Chip tone="warn">órfão</Chip>) },
  ];

  return (
    <>
      <PageHead title="Volumes" subtitle={`${rows.length} volumes · ${orphans.length} órfãos`}>
        <button className="btn danger" type="button" disabled={!orphans.length} onClick={async () => { for (const v of orphans) await act(cmd.volumeRm(v.name), `Remover volume ${v.name}`); void refresh(); }}>Remover {orphans.length} órfãos</button>
        <button className="btn pri" type="button" onClick={() => setCreateOpen(true)}><Icon name="plus" size={13} /> Criar volume</button>
      </PageHead>
      {snapshot && snapshot.state !== "supported" && (
        <div className="note">
          <span style={{ flex: "1 1 360px" }}><b>Snapshots: {snapshot.state}.</b> {snapshot.detail}</span>
          <button className="btn sm" type="button" onClick={() => go({ name: "capabilities" })}>Como resolver</button>
        </div>
      )}
      {error && <ErrorNote error={error} />}
      <DataTable<VolumeRow>
        columns={columns}
        rows={rows}
        getKey={(v) => v.name}
        searchPlaceholder="Pesquisar por nome, driver ou uso…"
        searchLabel="Pesquisar volumes"
        searchText={(v) => `${v.name} ${v.driver} ${v.usedBy.join(" ")}`}
        empty="Sem volumes"
        actions={(v) => (
          <button className="btn ico danger" type="button" aria-label={`Remover ${v.name}`} onClick={() => void act(cmd.volumeRm(v.name), `Remover volume ${v.name}`).then(() => refresh())}><Icon name="trash" /></button>
        )}
      />
      <Drawer open={createOpen} onClose={() => setCreateOpen(false)} title="Criar volume">
        <section className="section">
          <input className="input mono" placeholder="nome" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome do volume" />
          <button className="btn pri" type="button" disabled={!name} onClick={() => void act(cmd.volumeCreate(name), `Criar volume ${name}`).then((ok) => { if (ok) { setName(""); setCreateOpen(false); } refresh(); })}>Criar</button>
          {name && <CliHint argv={cmd.volumeCreate(name)} compact />}
        </section>
      </Drawer>
    </>
  );
}
