import { useState } from "react";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { Chip, CliHint, ErrorNote, PageHead } from "../components/ui";
import { DataTable, type Column } from "../components/DataTable";
import { Drawer } from "../components/Drawer";
import { Select } from "../components/Select";
import { cmd } from "../lib/cli";
import { useResource } from "../lib/hooks";
import type { BackupRow } from "../lib/types";

const KINDS = ["container", "pod", "vm", "stack"] as const;

// Backups (§E). Um arquivo de UM recurso (container/pod/vm/stack). O `backup ls`
// lê um DIRETÓRIO (default: o diretório atual do engine); o campo "Diretório"
// controla `--from`/`--to`. O engine 5.1.1 não dá JSON aqui — o cliente parseia
// a tabela de texto.
export function Backups() {
  const { client, act } = useApp();
  // Diretório efetivo (committed) que alimenta backup ls --from.
  const [dir, setDir] = useState("");
  const [dirInput, setDirInput] = useState("");
  const { data, error, refresh } = useResource(["backups", dir], () => client.backups(dir || undefined), 20000);
  const [kind, setKind] = useState<(typeof KINDS)[number]>("container");
  const [name, setName] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const rows = data ?? [];
  const from = dir || undefined;

  const listDir = () => { setDir(dirInput.trim()); setTimeout(() => void refresh(), 0); };
  const createArgv = cmd.backupCreate({ kind, name, to: from });

  const columns: Column<BackupRow>[] = [
    { key: "archive", header: "Arquivo", truncate: true, width: 320, cellClassName: "mono", cellStyle: { color: "var(--tx)", fontWeight: 500 } },
    { key: "kind", header: "Tipo", render: (b) => <Chip tone={b.kind === "vm" ? "inf" : "neu"}>{b.kind || "—"}</Chip> },
    { key: "name", header: "Recurso", truncate: true, width: 180, cellClassName: "mono", render: (b) => b.name || "—" },
    { key: "created", header: "Criado", cellClassName: "muted", render: (b) => b.created || "—" },
    { key: "size", header: "Tamanho", cellClassName: "mono", render: (b) => b.size || "—" },
  ];

  return (
    <>
      <PageHead title="Backups" subtitle={`${rows.length} arquivos${dir ? ` · ${dir}` : " · diretório atual"}`}>
        <button className="btn pri" type="button" onClick={() => setCreateOpen(true)}><Icon name="plus" size={13} /> Criar backup</button>
      </PageHead>
      {error && <ErrorNote error={error} />}
      <div className="toolbar" style={{ borderBottom: "1px solid var(--line)", gap: 8, flexWrap: "wrap" }}>
        <input className="input mono" placeholder="Diretório (--from), vazio = atual" value={dirInput} onChange={(e) => setDirInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") listDir(); }} aria-label="Diretório dos arquivos" style={{ maxWidth: 340 }} />
        <button className="btn" type="button" onClick={listDir}>Listar</button>
      </div>
      <DataTable<BackupRow>
        columns={columns}
        rows={rows}
        getKey={(b) => b.archive}
        tieBreak={(b) => b.archive}
        searchPlaceholder="Pesquisar arquivo, recurso ou tipo…"
        searchLabel="Pesquisar backups"
        searchText={(b) => `${b.archive} ${b.name} ${b.kind}`}
        empty="Sem arquivos neste diretório"
        actions={(b) => (
          <>
            <button className="btn sm" type="button" aria-label={`Restaurar ${b.archive}`} title="Restaurar (sobrepõe o estado vivo)" onClick={() => void act(cmd.backupRestore(b.archive, from), `Restaurar ${b.archive}`).then(() => refresh())}>
              <Icon name="restart" size={13} /> Restaurar
            </button>
            <button className="btn ico danger" type="button" aria-label={`Remover ${b.archive}`} onClick={() => void act(cmd.backupRemove(b.archive, from), `Remover arquivo ${b.archive}`).then(() => refresh())}><Icon name="trash" /></button>
          </>
        )}
      />
      <Drawer open={createOpen} onClose={() => setCreateOpen(false)} title="Criar backup">
        <section className="section">
          <label className="muted" style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
            Tipo de recurso
            <Select
              ariaLabel="Tipo de recurso"
              value={kind}
              onChange={(v) => setKind(v as (typeof KINDS)[number])}
              options={KINDS.map((k) => ({ value: k, label: k }))}
            />
          </label>
          <label className="muted" style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
            Nome do recurso
            <input className="input mono" placeholder="db" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <button className="btn pri" type="button" disabled={!name} onClick={() => void act(createArgv, `Backup de ${kind} ${name}`).then((ok) => { if (ok) { setName(""); setCreateOpen(false); } refresh(); })}>Criar backup</button>
          <p className="muted" style={{ margin: 0, fontSize: 11 }}>Arquiva o registo e os dados dos volumes do recurso{dir ? ` em ${dir}` : " no diretório atual"}.</p>
          {name && <CliHint argv={createArgv} compact />}
        </section>
      </Drawer>
    </>
  );
}
