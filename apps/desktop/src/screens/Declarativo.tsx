import { useState } from "react";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { Chip, CliHint, ErrorNote, PageHead, Tabs } from "../components/ui";
import { DataTable, type Column } from "../components/DataTable";
import { Drawer } from "../components/Drawer";
import { cmd, type Argv } from "../lib/cli";
import { nativeDialogsAvailable, pickFile, YAML_FILTERS } from "../lib/native";
import type { ComposeService, StackPlanRow } from "../lib/types";

// Botão "Procurar…" ao lado de um input de caminho: abre o diálogo de ficheiros
// NATIVO do SO e preenche o input (que continua editável). Some fora do Tauri.
function BrowseFile({ title, onPick }: { title: string; onPick: (path: string) => void }) {
  if (!nativeDialogsAvailable()) return null;
  return (
    <button
      className="btn"
      type="button"
      title="Escolher ficheiro no sistema"
      onClick={() => void pickFile({ title, filters: YAML_FILTERS }).then((p) => { if (p) onPick(p); })}
    >
      <Icon name="declarative" size={13} /> Procurar…
    </button>
  );
}

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
  const [applyOpen, setApplyOpen] = useState(false);

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

  const columns: Column<StackPlanRow>[] = [
    { key: "kind", header: "Kind", cellClassName: "muted" },
    { key: "name", header: "Nome", truncate: true, width: 240, cellClassName: "mono", cellStyle: { color: "var(--tx)", fontWeight: 500 } },
    { key: "action", header: "Ação", render: (r) => <Chip tone={actionTone(r.action)}>{r.action}</Chip> },
    { key: "diffs", header: "Diffs", cellClassName: "mono muted", render: (r) => r.diffs || "—" },
  ];

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
        <BrowseFile title="Escolher manifesto da stack" onPick={setManifest} />
        <button className="btn pri" type="button" disabled={busy} onClick={() => void plan()}>
          <Icon name="overview" size={13} /> Planear
        </button>
        <button className="btn" type="button" disabled={busy} onClick={() => void showText(cmd.stackValidate(manifest), "stack validate")}>Validar</button>
        <button className="btn" type="button" disabled={busy} onClick={() => void showText(cmd.stackDescribe(manifest), "stack describe")}>Descrever</button>
        <button className="btn" type="button" disabled={busy} onClick={() => void showText(cmd.stackHistory(manifest), "stack history")}>Histórico</button>
        <button className="btn" type="button" onClick={() => setApplyOpen(true)}><Icon name="play" size={13} /> Aplicar…</button>
      </div>

      {error && <ErrorNote error={error} />}

      <DataTable<StackPlanRow>
        columns={columns}
        rows={all}
        getKey={(r) => `${r.kind}/${r.name}`}
        tieBreak={(r) => `${r.kind}/${r.name}`}
        searchPlaceholder="Pesquisar recurso, kind ou ação…"
        searchLabel="Pesquisar plano"
        searchText={(r) => `${r.kind} ${r.name} ${r.action}`}
        empty={
          rows === null
            ? <>Indica um manifesto e clica <b>Planear</b> para ver o que um <span className="mono">apply</span> faria.</>
            : <>Nada a aplicar — a máquina já corresponde ao manifesto.</>
        }
      />
      {out && <OutputPanel title={out.title} text={out.text} onClose={() => setOut(null)} />}

      <Drawer open={applyOpen} onClose={() => setApplyOpen(false)} title="Aplicar manifesto">
        <section className="section">
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
      </Drawer>
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
  const [lifeOpen, setLifeOpen] = useState(false);

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

  const columns: Column<ComposeService>[] = [
    { key: "service", header: "Serviço", truncate: true, width: 180, cellClassName: "mono", cellStyle: { color: "var(--tx)", fontWeight: 500 }, render: (s) => s.service || "—" },
    { key: "name", header: "Container", truncate: true, width: 200, cellClassName: "mono muted" },
    { key: "image", header: "Imagem", truncate: true, width: 240, cellClassName: "muted" },
    { key: "status", header: "Estado", render: (s) => <Chip tone={/run|up/i.test(s.status) ? "ok" : "neu"} dot>{s.status}</Chip> },
  ];

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
        <BrowseFile title="Escolher ficheiro docker-compose" onPick={setFile} />
        <button className="btn pri" type="button" disabled={busy} onClick={() => void refresh()}>
          <Icon name="restart" size={13} /> Ver serviços
        </button>
        <button className="btn" type="button" disabled={busy} onClick={() => void showConfig()}>Config</button>
        <button className="btn" type="button" onClick={() => setLifeOpen(true)}><Icon name="play" size={13} /> Ciclo de vida…</button>
      </div>

      {error && <ErrorNote error={error} />}

      <DataTable<ComposeService>
        columns={columns}
        rows={all}
        getKey={(s) => s.name || s.service}
        tieBreak={(s) => s.service || s.name}
        searchPlaceholder="Pesquisar serviço, container ou imagem…"
        searchLabel="Pesquisar serviços"
        searchText={(s) => `${s.service} ${s.name} ${s.image} ${s.status}`}
        empty={
          rows === null
            ? <>Indica um ficheiro compose e clica <b>Ver serviços</b>.</>
            : <>Nenhum serviço deste projeto está de pé. Usa <b>Subir</b>.</>
        }
      />
      {out && <OutputPanel title={out.title} text={out.text} onClose={() => setOut(null)} />}

      <Drawer open={lifeOpen} onClose={() => setLifeOpen(false)} title="Ciclo de vida">
        <section className="section">
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
      </Drawer>
    </div>
  );
}
