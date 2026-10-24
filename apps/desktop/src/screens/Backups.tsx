import { useState } from "react";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { Chip, CliHint, ErrorNote, PageHead } from "../components/ui";
import { Pager } from "../components/Pager";
import { cmd } from "../lib/cli";
import { useResource } from "../lib/hooks";
import { orderBy, usePagination } from "../lib/pagination";

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
  const { data, error, refresh } = useResource(() => client.backups(dir || undefined), 20000);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("container");
  const [name, setName] = useState("");

  const rows = data ?? [];
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? rows.filter((b) => b.archive.toLowerCase().includes(needle) || b.name.toLowerCase().includes(needle) || b.kind.toLowerCase().includes(needle))
    : rows;
  const page = usePagination(orderBy(filtered, (b) => b.archive));
  const from = dir || undefined;

  const listDir = () => { setDir(dirInput.trim()); setTimeout(() => void refresh(), 0); };
  const createArgv = cmd.backupCreate({ kind, name, to: from });

  return (
    <>
      <PageHead title="Backups" subtitle={`${rows.length} arquivos${dir ? ` · ${dir}` : " · diretório atual"}`} />
      {error && <ErrorNote error={error} />}
      <div className="toolbar" style={{ borderBottom: "1px solid var(--line)", gap: 8, flexWrap: "wrap" }}>
        <input className="input mono" placeholder="Diretório (--from), vazio = atual" value={dirInput} onChange={(e) => setDirInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") listDir(); }} aria-label="Diretório dos arquivos" style={{ maxWidth: 340 }} />
        <button className="btn" type="button" onClick={listDir}>Listar</button>
        <input className="input" placeholder="Pesquisar arquivo, recurso ou tipo…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Pesquisar backups" style={{ maxWidth: 280, marginLeft: "auto" }} />
      </div>
      <div className="split">
        <div className="primary">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Arquivo</th><th>Tipo</th><th>Recurso</th><th>Criado</th><th>Tamanho</th><th style={{ textAlign: "right" }}>Ações</th></tr></thead>
              <tbody>
                {page.total === 0 && (
                  <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 24 }}>Sem arquivos neste diretório</td></tr>
                )}
                {page.items.map((b) => (
                  <tr key={b.archive}>
                    <td className="mono" style={{ color: "var(--tx)", fontWeight: 500 }}>{b.archive}</td>
                    <td><Chip tone={b.kind === "vm" ? "inf" : "neu"}>{b.kind || "—"}</Chip></td>
                    <td className="mono">{b.name || "—"}</td>
                    <td className="muted">{b.created || "—"}</td>
                    <td className="mono">{b.size || "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                        <button className="btn sm" type="button" aria-label={`Restaurar ${b.archive}`} title="Restaurar (sobrepõe o estado vivo)" onClick={() => void act(cmd.backupRestore(b.archive, from), `Restaurar ${b.archive}`).then(() => refresh())}>
                          <Icon name="restart" size={13} /> Restaurar
                        </button>
                        <button className="btn ico danger" type="button" aria-label={`Remover ${b.archive}`} onClick={() => void act(cmd.backupRemove(b.archive, from), `Remover arquivo ${b.archive}`).then(() => refresh())}><Icon name="trash" /></button>
                      </div>
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
            <h2>Criar backup</h2>
            <label className="muted" style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
              Tipo de recurso
              <select className="input" value={kind} onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}>
                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            <label className="muted" style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
              Nome do recurso
              <input className="input mono" placeholder="db" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <button className="btn pri" type="button" disabled={!name} onClick={() => void act(createArgv, `Backup de ${kind} ${name}`).then((ok) => { if (ok) setName(""); refresh(); })}>Criar backup</button>
            <p className="muted" style={{ margin: 0, fontSize: 11 }}>Arquiva o registo e os dados dos volumes do recurso{dir ? ` em ${dir}` : " no diretório atual"}.</p>
            {name && <CliHint argv={createArgv} compact />}
          </section>
        </aside>
      </div>
    </>
  );
}
