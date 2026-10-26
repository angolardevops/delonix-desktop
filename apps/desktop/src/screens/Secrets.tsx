import { useEffect, useRef, useState } from "react";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { Chip, CliHint, ErrorNote, PageHead } from "../components/ui";
import { DataTable, type Column } from "../components/DataTable";
import { Drawer } from "../components/Drawer";
import { Popover } from "../components/Popover";
import { Select } from "../components/Select";
import { cmd } from "../lib/cli";
import { useResource } from "../lib/hooks";
import { copyText } from "../lib/native";
import type { SecretRow } from "../lib/types";

// Tempo (ms) após o qual um valor revelado volta a ficar OCULTO sozinho — evita
// deixar segredos em claro no ecrã depois de os consultar.
const REVEAL_MS = 30_000;

// Segredos (§E). A LISTA mostra só metadados. O engine SUPORTA revelar/copiar o
// valor de um segredo (`secret inspect --reveal`): a app fá-lo por AÇÃO
// EXPLÍCITA do utilizador, no detalhe, oculto por omissão e re-ocultado ~30 s
// depois. O valor em claro NUNCA entra em log nem no histórico de `act()` — o
// inspect corre pela via de leitura (dlx_json), nunca por `act`.
export function Secrets() {
  const { client, act, toast } = useApp();
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
  // Drawer de detalhe: o segredo aberto e o mapa de valores REVELADOS (null =
  // oculto). O timer re-oculta ao fim de REVEAL_MS.
  const [detail, setDetail] = useState<SecretRow | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string> | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealErr, setRevealErr] = useState<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHide = () => { if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; } };
  const hideValues = () => { clearHide(); setRevealed(null); };
  // Fecha o drawer e apaga qualquer valor em memória.
  const closeDetail = () => { hideValues(); setRevealErr(null); setDetail(null); };
  useEffect(() => clearHide, []); // limpa o timer ao desmontar

  // Revela os valores do segredo aberto: `secret inspect --reveal` pela via de
  // LEITURA (client.secretInspect → dlx_json), nunca por `act`, por isso o valor
  // não é registado no histórico. Re-oculta sozinho após REVEAL_MS.
  const reveal = (s: SecretRow) => {
    setRevealing(true);
    setRevealErr(null);
    void client.secretInspect(s.name, true)
      .then((r) => {
        setRevealed(r.keys);
        clearHide();
        hideTimer.current = setTimeout(() => setRevealed(null), REVEAL_MS);
      })
      .catch((e) => setRevealErr(String(e)))
      .finally(() => setRevealing(false));
  };

  // Copia UM valor para o clipboard NATIVO. Vai buscá-lo a pedido (não exige
  // revelar primeiro) e NUNCA o regista — só dá o feedback "Copiado".
  const copyValue = (s: SecretRow, k: string) => {
    const put = (v: string) => void copyText(v).then((ok) => toast(ok ? `Copiado · ${k}` : "Não foi possível copiar", ok));
    if (revealed && k in revealed) { put(revealed[k]); return; }
    void client.secretInspect(s.name, true)
      .then((r) => put(r.keys[k] ?? ""))
      .catch((e) => toast(`Falha ao ler o valor: ${e}`, false));
  };

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
      <PageHead title="Segredos" subtitle={`${rows.length} segredos · valores revelados só a pedido, nunca registados`}>
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
        onRowDoubleClick={(s) => { hideValues(); setRevealErr(null); setDetail(s); }}
        actions={(s) => (
          <>
            <button
              className="btn sm"
              type="button"
              disabled={!s.names.length}
              aria-label={`Ver valores de ${s.name}`}
              title="Ver / revelar / copiar os valores"
              onClick={() => { hideValues(); setRevealErr(null); setDetail(s); }}
            >
              <Icon name="search" size={13} /> Ver
            </button>
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

      {/* Drawer de DETALHE: revelar/copiar valores por ação explícita. */}
      <Drawer open={!!detail} onClose={closeDetail} title={detail ? `Segredo · ${detail.name}` : "Segredo"}>
        {detail && (
          <section className="section">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {revealed
                ? <button className="btn" type="button" onClick={hideValues}><Icon name="close" size={13} /> Ocultar valores</button>
                : <button className="btn pri" type="button" disabled={revealing || !detail.names.length} onClick={() => reveal(detail)}><Icon name="search" size={13} /> {revealing ? "A revelar…" : "Revelar valores"}</button>}
              <span className="muted" style={{ fontSize: 11 }}>v{detail.version} · {detail.names.length} chave(s)</span>
            </div>
            {revealErr && <ErrorNote error={revealErr} />}
            {revealed && (
              <p className="muted" style={{ margin: 0, fontSize: 11, color: "var(--warn)" }}>
                Valores em claro — re-ocultam automaticamente em {REVEAL_MS / 1000} s. Não são registados.
              </p>
            )}
            <dl className="kv" style={{ margin: 0 }}>
              {detail.names.map((k) => (
                <div key={k} style={{ display: "contents" }}>
                  <dt className="mono">{k}</dt>
                  <dd style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span className="mono" style={{ flex: 1, wordBreak: "break-all", color: revealed ? "var(--tx)" : "var(--mut)" }}>
                      {revealed ? (revealed[k] ?? "") : "••••••"}
                    </span>
                    <button className="btn ico sm" type="button" aria-label={`Copiar ${k}`} title="Copiar o valor" onClick={() => copyValue(detail, k)}>
                      <Icon name="copy" size={13} />
                    </button>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="muted" style={{ margin: 0, fontSize: 11 }}>
              O valor é cifrado em repouso pelo engine. Revelar/copiar corre <span className="mono">{cmd.secretInspect(detail.name, true).join(" ")}</span> pela via de leitura; o valor nunca entra em log nem no histórico.
            </p>
          </section>
        )}
      </Drawer>

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
          <p className="muted" style={{ margin: 0, fontSize: 11 }}>O valor é cifrado em repouso pelo engine. A lista mostra apenas metadados; os valores revelam-se depois, a pedido, no detalhe.</p>
          {name && key && <CliHint argv={cmd.secretCreate({ name, key, value: value ? "••••" : "" })} compact />}
        </section>
      </Drawer>
    </>
  );
}
