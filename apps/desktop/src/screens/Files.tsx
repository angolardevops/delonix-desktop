import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { Chip, CliHint, ErrorNote, PageHead } from "../components/ui";
import { DataTable, type Column } from "../components/DataTable";
import { Drawer } from "../components/Drawer";
import { cmd } from "../lib/cli";
import { fmtBytes } from "../lib/hooks";
import { YAML_FILTERS } from "../lib/native";
import {
  breadcrumb,
  fsAvailable,
  homeDir,
  parentPath,
  readDir,
  readTextFile,
  saveTextViaDialog,
  PREVIEW_MAX_BYTES,
  type FsEntry,
} from "../lib/fsx";

// Extensões (e nomes) tratados como TEXTO pré-visualizável. Fora desta lista,
// o ficheiro mostra-se como "não pré-visualizável" (binário).
const TEXT_EXT = new Set([
  "yaml", "yml", "json", "toml", "conf", "cfg", "ini", "env", "log", "txt", "md", "markdown",
  "sh", "bash", "zsh", "fish", "properties", "xml", "csv", "tsv", "service", "rules", "repo",
  "list", "sql", "rs", "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rb", "php", "java",
  "c", "h", "cpp", "hpp", "css", "scss", "html", "htm", "lock", "gitignore", "dockerignore",
  "editorconfig", "pem", "crt", "key", "pub", "tf", "tfvars", "hcl",
]);
const TEXT_NAMES = new Set([
  "dockerfile", "makefile", "caddyfile", "procfile", "jenkinsfile", "vagrantfile",
  ".env", ".gitignore", ".dockerignore", ".editorconfig", "readme",
]);

const extOf = (name: string): string => {
  const b = name.toLowerCase();
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i + 1) : "";
};
const isTextFile = (name: string): boolean => {
  const b = name.toLowerCase();
  if (TEXT_NAMES.has(b)) return true;
  return TEXT_EXT.has(extOf(name));
};
// Qualquer YAML (filtro "só manifestos").
const isYaml = (name: string): boolean => /\.ya?ml$/i.test(name);
// Manifesto do delonix por convenção de nome (destaque visual).
const isDelonixManifest = (name: string): boolean => /^delonix(-manifest)?\.ya?ml$/i.test(name);

const fmtDate = (d: Date | null): string =>
  d ? d.toLocaleString("pt-AO", { dateStyle: "short", timeStyle: "short" }) : "—";

export function Files() {
  const available = fsAvailable();
  const [path, setPath] = useState("/");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyManifests, setOnlyManifests] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  const navigate = useCallback(
    async (to: string) => {
      if (!available) return;
      setLoading(true);
      setError(null);
      try {
        const rows = await readDir(to);
        setEntries(rows);
        setPath(to);
      } catch (e) {
        // Caminho inacessível: mantém a listagem anterior e avisa (não rebenta).
        setError(String(e instanceof Error ? e.message : e));
      } finally {
        setLoading(false);
      }
    },
    [available],
  );

  // Arranque: começa no HOME (ou "/" fora do Tauri).
  useEffect(() => {
    if (!available) return;
    void homeDir().then((h) => navigate(h || "/"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available]);

  const visible = useMemo(
    () => (onlyManifests ? entries.filter((e) => e.isDir || isYaml(e.name)) : entries),
    [entries, onlyManifests],
  );

  const open = (e: FsEntry) => {
    if (e.isDir) void navigate(e.path);
    else setPreview({ entry: e });
  };

  const crumbs = breadcrumb(path);
  const atRoot = path === "/";

  const columns: Column<FsEntry>[] = [
    {
      key: "name",
      header: "Nome",
      sortable: true,
      sortValue: (e) => e.name.toLowerCase(),
      render: (e) => (
        <button
          type="button"
          className="btn-link"
          style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "none", border: 0, padding: 0, cursor: "pointer", color: "var(--tx)", font: "inherit", textAlign: "left" }}
          onClick={() => open(e)}
          title={e.isDir ? `Abrir ${e.name}` : isTextFile(e.name) ? `Ver ${e.name}` : e.name}
        >
          <Icon name={e.isDir ? "folder" : "file"} size={15} />
          <span className="mono" style={{ fontWeight: e.isDir ? 600 : 400 }}>{e.name}</span>
          {isDelonixManifest(e.name) && <Chip tone="inf">delonix.yaml</Chip>}
          {e.isSymlink && <span className="muted" style={{ fontSize: 11 }}>↪ link</span>}
        </button>
      ),
    },
    {
      key: "type",
      header: "Tipo",
      width: 110,
      sortable: true,
      sortValue: (e) => (e.isDir ? "0" : "1"),
      render: (e) => <span className="muted">{e.isDir ? "Pasta" : isYaml(e.name) ? "YAML" : "Ficheiro"}</span>,
    },
    {
      key: "size",
      header: "Tamanho",
      width: 110,
      align: "right",
      sortable: true,
      sortValue: (e) => e.size ?? -1,
      cellClassName: "mono muted",
      render: (e) => (e.isDir ? "—" : fmtBytes(e.size)),
    },
    {
      key: "mtime",
      header: "Modificado",
      width: 160,
      sortable: true,
      sortValue: (e) => (e.mtime ? e.mtime.getTime() : 0),
      cellClassName: "muted",
      render: (e) => fmtDate(e.mtime),
    },
  ];

  return (
    <>
      <PageHead
        title="Ficheiros"
        subtitle="Navega o filesystem, localiza manifestos e exporta um delonix.yaml completo para levar a outro PC"
      >
        <label className="muted" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={onlyManifests} onChange={(e) => setOnlyManifests(e.target.checked)} />
          Só manifestos (YAML)
        </label>
      </PageHead>

      {!available ? (
        <div style={{ padding: "16px 24px" }}>
          <div className="note planned" role="note">
            <Chip tone="bad" dot>Indisponível</Chip>
            <span style={{ flex: "1 1 360px" }}>
              O explorador de ficheiros só funciona na <b>app de secretária</b> (Tauri). No modo de
              desenvolvimento (browser) não há acesso ao filesystem.
            </span>
          </div>
        </div>
      ) : (
        <div style={{ padding: "12px 24px 0" }}>
          {/* Barra de caminho: HOME, raiz, subir e breadcrumb clicável. */}
          <div className="toolbar" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", paddingBottom: 10 }}>
            <button className="btn" type="button" onClick={() => void homeDir().then((h) => navigate(h || "/"))} title="Ir para HOME">
              <Icon name="workspaces" size={13} /> HOME
            </button>
            <button className="btn" type="button" onClick={() => void navigate("/")} disabled={atRoot} title="Ir para a raiz">
              / Raiz
            </button>
            <button className="btn" type="button" onClick={() => void navigate(parentPath(path))} disabled={atRoot} title="Subir um nível">
              <Icon name="up" size={13} /> Subir
            </button>
            <nav aria-label="Caminho" className="mono" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 2, fontSize: 12, minWidth: 0 }}>
              {crumbs.map((c, i) => (
                <span key={c.path} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                  {i > 0 && <span className="muted">/</span>}
                  <button
                    type="button"
                    className="btn-link"
                    style={{ background: "none", border: 0, padding: "1px 4px", cursor: "pointer", color: i === crumbs.length - 1 ? "var(--tx)" : "var(--mut)", font: "inherit", fontWeight: i === crumbs.length - 1 ? 600 : 400 }}
                    onClick={() => void navigate(c.path)}
                    aria-current={i === crumbs.length - 1 ? "page" : undefined}
                  >
                    {c.label}
                  </button>
                </span>
              ))}
            </nav>
          </div>

          {error && <ErrorNote error={error} />}

          <DataTable<FsEntry>
            columns={columns}
            rows={visible}
            getKey={(e) => e.path}
            tieBreak={(e) => `${e.isDir ? "0" : "1"}${e.name.toLowerCase()}`}
            searchPlaceholder="Pesquisar nesta pasta…"
            searchLabel="Pesquisar na pasta atual"
            searchText={(e) => e.name}
            onRowDoubleClick={open}
            pageSize={25}
            actions={(e) =>
              e.isDir ? (
                <button className="btn sm" type="button" onClick={() => void navigate(e.path)}>Abrir</button>
              ) : (
                <button className="btn sm" type="button" onClick={() => setPreview({ entry: e })}>Ver</button>
              )
            }
            empty={loading ? "A carregar…" : onlyManifests ? "Sem manifestos YAML nesta pasta." : "Pasta vazia ou inacessível."}
          />
        </div>
      )}

      {preview && <PreviewDrawer state={preview} onClose={() => setPreview(null)} />}
    </>
  );
}

interface PreviewState {
  entry: FsEntry;
}

function PreviewDrawer({ state, onClose }: { state: PreviewState; onClose: () => void }) {
  const { client, toast } = useApp();
  const { entry } = state;
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [out, setOut] = useState<{ title: string; text: string; manifest?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const previewable = isTextFile(entry.name);
  const tooBig = entry.size != null && entry.size > PREVIEW_MAX_BYTES;

  useEffect(() => {
    setContent(null);
    setError(null);
    setOut(null);
    if (!previewable || tooBig) return;
    setLoading(true);
    readTextFile(entry.path)
      .then((t) => setContent(t))
      .catch((e) => setError(String(e instanceof Error ? e.message : e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.path]);

  // Corre `manifest render -f` (completo, defaults preenchidos) ou `validate`.
  const runManifest = async (kind: "render" | "validate") => {
    setBusy(true);
    setError(null);
    try {
      const argv = kind === "render" ? cmd.manifestRender(entry.path) : cmd.manifestValidate(entry.path);
      const r = await client.readText(argv);
      const text = [r.stdout, r.stderr].filter((s) => s.trim()).join("\n");
      if (kind === "render") {
        setOut({ title: "Manifesto completo (manifest render)", text, manifest: r.ok ? r.stdout : undefined });
      } else {
        setOut({ title: r.ok ? "Validação OK" : "Validação falhou", text });
      }
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  // Grava o manifesto renderizado num destino escolhido no save-dialog nativo.
  const saveManifest = async () => {
    if (!out?.manifest) return;
    setBusy(true);
    try {
      const saved = await saveTextViaDialog(out.manifest, {
        title: "Exportar delonix.yaml",
        defaultPath: "delonix.yaml",
        filters: YAML_FILTERS,
      });
      if (saved) toast(`Exportado para ${saved}`, true);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const yaml = isYaml(entry.name);

  return (
    <Drawer open onClose={onClose} title={entry.name} width={560}>
      <section className="section" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="mono muted" style={{ fontSize: 11, wordBreak: "break-all" }}>{entry.path}</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12 }}>
          <span className="muted">{fmtBytes(entry.size)}</span>
          <span className="muted">{fmtDate(entry.mtime)}</span>
          {yaml && <Chip tone="inf">YAML</Chip>}
        </div>

        {yaml && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn pri" type="button" disabled={busy} onClick={() => void runManifest("render")}>
              <Icon name="download" size={13} /> Exportar completo
            </button>
            <button className="btn" type="button" disabled={busy} onClick={() => void runManifest("validate")}>
              Validar / Render
            </button>
          </div>
        )}
        {yaml && <CliHint argv={cmd.manifestRender(entry.path)} compact />}

        {error && <ErrorNote error={error} />}

        {out && (
          <section className="section" style={{ marginTop: 4 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 13 }}>{out.title}</h3>
              <div style={{ display: "flex", gap: 6 }}>
                {out.manifest && (
                  <button className="btn sm pri" type="button" disabled={busy} onClick={() => void saveManifest()}>
                    <Icon name="download" size={12} /> Gravar…
                  </button>
                )}
                <button className="btn sm" type="button" onClick={() => setOut(null)}><Icon name="close" size={12} /> Fechar</button>
              </div>
            </div>
            <pre className="mono" style={preStyle}>{out.text || "(sem saída)"}</pre>
          </section>
        )}

        <h3 style={{ margin: "6px 0 0", fontSize: 13 }}>Pré-visualização</h3>
        {loading && <p className="muted" style={{ fontSize: 12, margin: 0 }}>A ler…</p>}
        {!previewable && (
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            Ficheiro binário — não pré-visualizável.
          </p>
        )}
        {previewable && tooBig && (
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            Demasiado grande para pré-visualizar ({fmtBytes(entry.size)} &gt; {fmtBytes(PREVIEW_MAX_BYTES)}).
          </p>
        )}
        {content != null && <pre className="mono" style={preStyle}>{content || "(ficheiro vazio)"}</pre>}
      </section>
    </Drawer>
  );
}

const preStyle: React.CSSProperties = {
  margin: "8px 0 0",
  padding: 12,
  background: "var(--bg2, rgba(0,0,0,.04))",
  borderRadius: 6,
  overflow: "auto",
  maxHeight: 360,
  fontSize: 12,
  whiteSpace: "pre",
  border: "1px solid var(--line)",
};
