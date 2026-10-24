import { useState } from "react";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { Chip, CliHint, ErrorNote, PageHead, Tabs } from "../components/ui";
import { Pager } from "../components/Pager";
import { cmd, type Argv } from "../lib/cli";
import { orderBy, usePagination } from "../lib/pagination";
import type { ComposeService, StackPlanRow } from "../lib/types";

// Camada declarativa (§E): Stacks e Compose. Ambos pedem CONTEXTO por CAMINHO
// (manifesto / ficheiro docker-compose.yml) num CAMPO DE TEXTO — sem plugin de
// diálogo. Todos os comandos são verbos AGRUPADOS (existem em 5.1.1 E develop).
export function Declarativo() {
  const [tab, setTab] = useState<"stacks" | "compose">("stacks");
  return (
    <>
      <PageHead title="Declarativo" subtitle="Manifestos (stack) e docker-compose.yml, aplicados nativamente — sem daemon, sem Docker" />
      <div style={{ padding: "10px 24px 0" }}>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[{ id: "stacks", label: "Stacks" }, { id: "compose", label: "Compose" }]}
        />
      </div>
      {tab === "stacks" ? <StacksPanel /> : <ComposePanel />}
    </>
  );
}

// Painel de saída de texto cru (stack validate/describe/history, compose config).
function OutputPanel({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  return (
    <section className="section" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <button className="btn sm" type="button" onClick={onClose}><Icon name="close" size={12} /> Fechar</button>
      </div>
      <pre className="mono" style={{ margin: "8px 0 0", padding: 12, background: "var(--bg2, rgba(0,0,0,.04))", borderRadius: 6, overflow: "auto", maxHeight: 320, fontSize: 12, whiteSpace: "pre", border: "1px solid var(--line)" }}>
        {text || "(sem saída)"}
      </pre>
    </section>
  );
}

const actionTone = (a: string): "ok" | "warn" | "bad" | "inf" | "neu" => {
  if (a === "create") return "inf";
  if (a === "update") return "warn";
  if (a === "delete") return "bad";
  return "neu"; // noop / desconhecido
};

function StacksPanel() {
  const { client, act } = useApp();
  const [manifest, setManifest] = useState("");
  const [rows, setRows] = useState<StackPlanRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ title: string; text: string } | null>(null);

  const plan = async () => {
    setBusy(true);
    setError(null);
    try {
      setRows(await client.stackPlan(manifest));
    } catch (e) {
      setError(String(e));
      setRows(null);
    } finally {
      setBusy(false);
    }
  };

  // Leitura só-texto (validate/describe/history): mostra o stdout num painel.
  const showText = async (argv: Argv, title: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await client.readText(argv);
      setOut({ title, text: [r.stdout, r.stderr].filter((s) => s.trim()).join("\n") });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const all = rows ?? [];
  const changes = all.filter((r) => r.changed).length;
  const page = usePagination(orderBy(all, (r) => `${r.kind}/${r.name}`));

  return (
    <div style={{ padding: "14px 24px 0" }}>
      <div className="toolbar" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", paddingBottom: 12 }}>
        <input
          className="input mono"
          placeholder="caminho do manifesto (ex.: /proj/delonix-manifest.yaml) — vazio = diretório do engine"
          value={manifest}
          onChange={(e) => setManifest(e.target.value)}
          aria-label="Caminho do manifesto"
          style={{ flex: "1 1 360px", minWidth: 260 }}
        />
        <button className="btn pri" type="button" disabled={busy} onClick={() => void plan()}>
          <Icon name="overview" size={13} /> Planear
        </button>
        <button className="btn" type="button" disabled={busy} onClick={() => void showText(cmd.stackValidate(manifest), "stack validate")}>Validar</button>
        <button className="btn" type="button" disabled={busy} onClick={() => void showText(cmd.stackDescribe(manifest), "stack describe")}>Descrever</button>
        <button className="btn" type="button" disabled={busy} onClick={() => void showText(cmd.stackHistory(manifest), "stack history")}>Histórico</button>
      </div>

      {error && <ErrorNote error={error} />}

      <div className="split">
        <div className="primary">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Kind</th><th>Nome</th><th>Ação</th><th>Diffs</th></tr></thead>
              <tbody>
                {rows === null && (
                  <tr><td colSpan={4} className="muted" style={{ textAlign: "center", padding: 24 }}>Indica um manifesto e clica <b>Planear</b> para ver o que um <span className="mono">apply</span> faria.</td></tr>
                )}
                {rows !== null && page.total === 0 && (
                  <tr><td colSpan={4} className="muted" style={{ textAlign: "center", padding: 24 }}>Nada a aplicar — a máquina já corresponde ao manifesto.</td></tr>
                )}
                {page.items.map((r) => (
                  <tr key={`${r.kind}/${r.name}`}>
                    <td className="muted">{r.kind}</td>
                    <td className="mono" style={{ color: "var(--tx)", fontWeight: 500 }}>{r.name}</td>
                    <td><Chip tone={actionTone(r.action)}>{r.action}</Chip></td>
                    <td className="mono muted">{r.diffs || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page.page} pages={page.pages} total={page.total} canPrev={page.canPrev} canNext={page.canNext} onFirst={page.first} onPrev={page.prev} onNext={page.next} onLast={page.last} />
          {out && <OutputPanel title={out.title} text={out.text} onClose={() => setOut(null)} />}
        </div>

        <aside className="aside">
          <section className="section">
            <h2>Aplicar manifesto</h2>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              {rows === null ? "Planeia primeiro." : changes ? `${changes} recurso(s) mudariam.` : "Sem alterações pendentes."}
            </p>
            <button
              className="btn pri"
              type="button"
              disabled={busy}
              onClick={() => void act(cmd.stackApply(manifest), `Aplicar stack${manifest ? ` (${manifest})` : ""}`).then((ok) => { if (ok) void plan(); })}
            >
              <Icon name="play" size={13} /> Aplicar
            </button>
            <button
              className="btn danger"
              type="button"
              disabled={busy}
              onClick={() => void act(cmd.stackDestroy(manifest), `Destruir stack${manifest ? ` (${manifest})` : ""}`).then((ok) => { if (ok) void plan(); })}
            >
              <Icon name="trash" size={13} /> Destruir
            </button>
            <CliHint argv={cmd.stackApply(manifest)} compact />
            <p className="muted" style={{ margin: 0, fontSize: 11 }}>
              O stack não tem estado próprio no engine — é o manifesto mais os recursos que ele cria (rotulados <span className="mono">delonix.io/stack</span>). Destruir remove só o que o stack possui.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function ComposePanel() {
  const { client, act } = useApp();
  const [file, setFile] = useState("");
  const [rows, setRows] = useState<ComposeService[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [withVolumes, setWithVolumes] = useState(false);
  const [out, setOut] = useState<{ title: string; text: string } | null>(null);

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      setRows(await client.composePs(file));
    } catch (e) {
      setError(String(e));
      setRows(null);
    } finally {
      setBusy(false);
    }
  };

  const showConfig = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await client.readText(cmd.composeConfig(file));
      setOut({ title: "compose config", text: [r.stdout, r.stderr].filter((s) => s.trim()).join("\n") });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const all = rows ?? [];
  const page = usePagination(orderBy(all, (s) => s.service || s.name));

  return (
    <div style={{ padding: "14px 24px 0" }}>
      <div className="toolbar" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", paddingBottom: 12 }}>
        <input
          className="input mono"
          placeholder="caminho do docker-compose.yml — vazio = diretório do engine"
          value={file}
          onChange={(e) => setFile(e.target.value)}
          aria-label="Caminho do ficheiro compose"
          style={{ flex: "1 1 360px", minWidth: 260 }}
        />
        <button className="btn pri" type="button" disabled={busy} onClick={() => void refresh()}>
          <Icon name="restart" size={13} /> Ver serviços
        </button>
        <button className="btn" type="button" disabled={busy} onClick={() => void showConfig()}>Config</button>
      </div>

      {error && <ErrorNote error={error} />}

      <div className="split">
        <div className="primary">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Serviço</th><th>Container</th><th>Imagem</th><th>Estado</th></tr></thead>
              <tbody>
                {rows === null && (
                  <tr><td colSpan={4} className="muted" style={{ textAlign: "center", padding: 24 }}>Indica um ficheiro compose e clica <b>Ver serviços</b>.</td></tr>
                )}
                {rows !== null && page.total === 0 && (
                  <tr><td colSpan={4} className="muted" style={{ textAlign: "center", padding: 24 }}>Nenhum serviço deste projeto está de pé. Usa <b>Subir</b>.</td></tr>
                )}
                {page.items.map((s) => (
                  <tr key={s.name || s.service}>
                    <td className="mono" style={{ color: "var(--tx)", fontWeight: 500 }}>{s.service || "—"}</td>
                    <td className="mono muted">{s.name}</td>
                    <td className="muted">{s.image}</td>
                    <td><Chip tone={/run|up/i.test(s.status) ? "ok" : "neu"} dot>{s.status}</Chip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page.page} pages={page.pages} total={page.total} canPrev={page.canPrev} canNext={page.canNext} onFirst={page.first} onPrev={page.prev} onNext={page.next} onLast={page.last} />
          {out && <OutputPanel title={out.title} text={out.text} onClose={() => setOut(null)} />}
        </div>

        <aside className="aside">
          <section className="section">
            <h2>Ciclo de vida</h2>
            <button
              className="btn pri"
              type="button"
              disabled={busy}
              onClick={() => void act(cmd.composeUp(file), `compose up${file ? ` (${file})` : ""}`).then((ok) => { if (ok) void refresh(); })}
            >
              <Icon name="play" size={13} /> Subir (up -d)
            </button>
            <label className="muted" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={withVolumes} onChange={(e) => setWithVolumes(e.target.checked)} />
              Remover volumes nomeados (-v)
            </label>
            <button
              className="btn danger"
              type="button"
              disabled={busy}
              onClick={() => void act(cmd.composeDown(file, withVolumes), `compose down${withVolumes ? " -v" : ""}${file ? ` (${file})` : ""}`).then((ok) => { if (ok) void refresh(); })}
            >
              <Icon name="stop" size={13} /> Baixar (down{withVolumes ? " -v" : ""})
            </button>
            <CliHint argv={cmd.composeDown(file, withVolumes)} compact />
            <p className="muted" style={{ margin: 0, fontSize: 11 }}>
              <span className="mono">down -v</span> apaga os volumes nomeados do projeto — os dados vão com eles.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
