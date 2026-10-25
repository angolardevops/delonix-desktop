import { useRef, useState } from "react";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { Chip, CliHint, ErrorNote, PageHead } from "../components/ui";
import { DataTable, type Column } from "../components/DataTable";
import { Drawer } from "../components/Drawer";
import { Popover } from "../components/Popover";
import { Select } from "../components/Select";
import { cmd } from "../lib/cli";
import { useResource } from "../lib/hooks";
import type { SecretRow } from "../lib/types";

// Segredos (§E). A lista mostra SÓ metadados — nome, nº de chaves, NOMES das
// chaves, versão, quem usa. O VALOR nunca chega ao renderer (nem no create:
// enviamo-lo ao engine por `--from-literal` e esquecemo-lo de imediato).
export function Secrets() {
  const { client, act } = useApp();
  const { data, error, refresh } = useResource("secrets", () => client.secrets(), 15000);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  // Chave escolhida para rotação, por segredo.
  const [rotKey, setRotKey] = useState<Record<string, string>>({});
  const [createOpen, setCreateOpen] = useState(false);
  // Popover de rotação ancorado à ação "Rodar" da linha.
  const [rotSecret, setRotSecret] = useState<SecretRow | null>(null);
  const rotAnchor = useRef<HTMLButtonElement | null>(null);

  const rows = data ?? [];
  const createArgv = cmd.secretCreate({ name, key, value });
  const canCreate = Boolean(name && key && value);

  const columns: Column<SecretRow>[] = [
    { key: "name", header: "Nome", truncate: true, width: 200, cellClassName: "mono", cellStyle: { color: "var(--tx)", fontWeight: 500 } },
    {
      key: "keys",
      header: "Chaves",
      render: (s) => (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {s.names.length ? s.names.map((k) => <Chip key={k} tone="neu">{k}</Chip>) : <span className="muted">{s.keys} chave(s)</span>}
        </div>
      ),
    },
    { key: "version", header: "Versão", cellClassName: "mono muted", render: (s) => `v${s.version}` },
    { key: "updated", header: "Atualizado", cellClassName: "muted", render: (s) => s.updated || "—" },
    { key: "usedBy", header: "Usado por", truncate: true, width: 220, render: (s) => (s.usedBy.length ? s.usedBy.join(", ") : <span className="muted">—</span>) },
  ];

  return (
    <>
      <PageHead title="Segredos" subtitle={`${rows.length} segredos · valores nunca expostos`}>
        <button className="btn pri" type="button" onClick={() => setCreateOpen(true)}><Icon name="plus" size={13} /> Criar segredo</button>
      </PageHead>
      {error && <ErrorNote error={error} />}
      <DataTable<SecretRow>
        columns={columns}
        rows={rows}
        getKey={(s) => s.name}
        searchPlaceholder="Pesquisar nome ou chave…"
        searchLabel="Pesquisar segredos"
        searchText={(s) => `${s.name} ${s.names.join(" ")}`}
        empty="Sem segredos"
        actions={(s) => (
          <>
            <button
              className="btn sm"
              type="button"
              disabled={!s.names.length}
              aria-label={`Rodar chave de ${s.name}`}
              title="Rodar valor de uma chave"
              onClick={(e) => { rotAnchor.current = e.currentTarget; setRotSecret(s); }}
            >
              <Icon name="restart" size={13} /> Rodar
            </button>
            <button className="btn ico danger" type="button" aria-label={`Remover ${s.name}`} onClick={() => void act(cmd.secretRm(s.name), `Remover segredo ${s.name}`).then(() => refresh())}><Icon name="trash" /></button>
          </>
        )}
      />

      <Popover open={!!rotSecret} onClose={() => setRotSecret(null)} anchorRef={rotAnchor} ariaLabel={rotSecret ? `Rodar chave de ${rotSecret.name}` : undefined} width={260}>
        {rotSecret && (() => {
          const sel = rotKey[rotSecret.name] ?? rotSecret.names[0] ?? "";
          return (
            <section className="section">
              <h2 style={{ fontSize: 12 }}>Rodar chave · <span className="mono">{rotSecret.name}</span></h2>
              {rotSecret.names.length > 1 && (
                <Select
                  size="sm"
                  mono
                  ariaLabel={`Chave a rodar em ${rotSecret.name}`}
                  value={sel}
                  onChange={(v) => setRotKey((m) => ({ ...m, [rotSecret.name]: v }))}
                  options={rotSecret.names.map((k) => ({ value: k, label: k }))}
                  style={{ width: "100%" }}
                />
              )}
              <button className="btn pri" type="button" disabled={!sel} onClick={() => void act(cmd.secretRotate(rotSecret.name, sel), `Rodar ${rotSecret.name}/${sel}`).then(() => { refresh(); setRotSecret(null); })}>
                <Icon name="restart" size={13} /> Rodar {sel}
              </button>
              <p className="muted" style={{ margin: 0, fontSize: 11 }}>Gera uma nova versão do valor desta chave.</p>
            </section>
          );
        })()}
      </Popover>

      <Drawer open={createOpen} onClose={() => setCreateOpen(false)} title="Criar segredo">
        <section className="section">
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
          <button className="btn pri" type="button" disabled={!canCreate} onClick={() => void act(createArgv, `Criar segredo ${name}`).then((ok) => { if (ok) { setName(""); setKey(""); setValue(""); setCreateOpen(false); } refresh(); })}>Criar</button>
          <p className="muted" style={{ margin: 0, fontSize: 11 }}>O valor é cifrado em repouso pelo engine. A lista mostra apenas metadados.</p>
          {name && key && <CliHint argv={cmd.secretCreate({ name, key, value: value ? "••••" : "" })} compact />}
        </section>
      </Drawer>
    </>
  );
}
