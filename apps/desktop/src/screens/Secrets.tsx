import { useState } from "react";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { Chip, CliHint, ErrorNote, PageHead } from "../components/ui";
import { Pager } from "../components/Pager";
import { cmd } from "../lib/cli";
import { useResource } from "../lib/hooks";
import { orderBy, usePagination } from "../lib/pagination";

// Segredos (§E). A lista mostra SÓ metadados — nome, nº de chaves, NOMES das
// chaves, versão, quem usa. O VALOR nunca chega ao renderer (nem no create:
// enviamo-lo ao engine por `--from-literal` e esquecemo-lo de imediato).
export function Secrets() {
  const { client, act } = useApp();
  const { data, error, refresh } = useResource(() => client.secrets(), 15000);
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  // Chave escolhida para rotação, por segredo.
  const [rotKey, setRotKey] = useState<Record<string, string>>({});

  const rows = data ?? [];
  // Pesquisa sobre o conjunto COMPLETO (nome + nomes das chaves), ordenação
  // determinística, e só depois paginação 10/página — ver lib/pagination.ts.
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? rows.filter((s) => s.name.toLowerCase().includes(needle) || s.names.some((k) => k.toLowerCase().includes(needle)))
    : rows;
  const page = usePagination(orderBy(filtered, (s) => s.name));

  const createArgv = cmd.secretCreate({ name, key, value });
  const canCreate = Boolean(name && key && value);

  return (
    <>
      <PageHead title="Segredos" subtitle={`${rows.length} segredos · valores nunca expostos`} />
      {error && <ErrorNote error={error} />}
      <div className="toolbar" style={{ borderBottom: "1px solid var(--line)" }}>
        <input className="input" placeholder="Pesquisar nome ou chave…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Pesquisar segredos" style={{ maxWidth: 320 }} />
      </div>
      <div className="split">
        <div className="primary">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nome</th><th>Chaves</th><th>Versão</th><th>Atualizado</th><th>Usado por</th><th style={{ textAlign: "right" }}>Ações</th></tr></thead>
              <tbody>
                {page.total === 0 && (
                  <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 24 }}>Sem segredos</td></tr>
                )}
                {page.items.map((s) => {
                  const sel = rotKey[s.name] ?? s.names[0] ?? "";
                  return (
                    <tr key={s.name}>
                      <td className="mono" style={{ color: "var(--tx)", fontWeight: 500 }}>{s.name}</td>
                      <td>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {s.names.length ? s.names.map((k) => <Chip key={k} tone="neu">{k}</Chip>) : <span className="muted">{s.keys} chave(s)</span>}
                        </div>
                      </td>
                      <td className="mono muted">v{s.version}</td>
                      <td className="muted">{s.updated || "—"}</td>
                      <td>{s.usedBy.length ? s.usedBy.join(", ") : <span className="muted">—</span>}</td>
                      <td style={{ textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                          {s.names.length > 1 && (
                            <select className="input" aria-label={`Chave a rodar em ${s.name}`} value={sel} onChange={(e) => setRotKey((m) => ({ ...m, [s.name]: e.target.value }))} style={{ height: 28, padding: "0 6px", fontSize: 12 }}>
                              {s.names.map((k) => <option key={k} value={k}>{k}</option>)}
                            </select>
                          )}
                          <button className="btn sm" type="button" disabled={!sel} aria-label={`Rodar chave ${sel} de ${s.name}`} title="Rodar valor de uma chave" onClick={() => void act(cmd.secretRotate(s.name, sel), `Rodar ${s.name}/${sel}`).then(() => refresh())}>
                            <Icon name="restart" size={13} /> Rodar
                          </button>
                          <button className="btn ico danger" type="button" aria-label={`Remover ${s.name}`} onClick={() => void act(cmd.secretRm(s.name), `Remover segredo ${s.name}`).then(() => refresh())}><Icon name="trash" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager page={page.page} pages={page.pages} total={page.total} canPrev={page.canPrev} canNext={page.canNext} onFirst={page.first} onPrev={page.prev} onNext={page.next} onLast={page.last} />
        </div>
        <aside className="aside">
          <section className="section">
            <h2>Criar segredo</h2>
            <label className="muted" style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
              Nome
              <input className="input mono" placeholder="db-pass" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="muted" style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
              Chave
              <input className="input mono" placeholder="PASSWORD" value={key} onChange={(e) => setKey(e.target.value)} />
            </label>
            <label className="muted" style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
              Valor
              <input className="input mono" type="password" placeholder="••••••••" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
            </label>
            <button className="btn pri" type="button" disabled={!canCreate} onClick={() => void act(createArgv, `Criar segredo ${name}`).then((ok) => { if (ok) { setName(""); setKey(""); setValue(""); } refresh(); })}>Criar</button>
            <p className="muted" style={{ margin: 0, fontSize: 11 }}>O valor é cifrado em repouso pelo engine. A lista mostra apenas metadados.</p>
            {name && key && <CliHint argv={cmd.secretCreate({ name, key, value: value ? "••••" : "" })} compact />}
          </section>
        </aside>
      </div>
    </>
  );
}
