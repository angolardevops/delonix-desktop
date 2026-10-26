import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MonacoEditor, { DiffEditor, type OnMount } from "@monaco-editor/react";
import type { editor as MonacoNS } from "monaco-editor";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { Chip, CliHint, ErrorNote, PageHead } from "../components/ui";
import { cmd, type Argv } from "../lib/cli";
import { fmtBytes } from "../lib/hooks";
import {
  breadcrumb,
  fsAvailable,
  homeDir,
  parentPath,
  readDir,
  readTextFile,
  stat,
  writeTextFile,
  PREVIEW_MAX_BYTES,
  type FsEntry,
} from "../lib/fsx";
import { isYamlFile, languageForFile } from "../lib/language";
import { setupMonaco } from "../lib/monacoSetup";

// Embebe o Monaco LOCALMENTE (workers via Vite `?worker`, loader apontado ao
// pacote empacotado) antes de qualquer render — a CSP do Tauri proíbe o CDN.
setupMonaco();

// Tema dark alinhado ao Console9 (a app é dark-only, ver theme/tokens.css).
const THEME = "delonix-dark";

// Um ficheiro aberto numa tab. `disk` é o conteúdo em DISCO (última
// leitura/gravação); `buffer` é o que está no editor. dirty = buffer !== disk.
interface OpenTab {
  path: string;
  name: string;
  language: string;
  disk: string;
  buffer: string;
}

const baseOf = (p: string): string => {
  const t = p.replace(/\/+$/, "");
  const i = t.lastIndexOf("/");
  return i >= 0 ? t.slice(i + 1) : t;
};

export function Editor({ initialPath }: { initialPath?: string }) {
  const available = fsAvailable();
  const { client, act, toast } = useApp();

  // --- Explorador (reutiliza fsx, como a tela Ficheiros) --------------------
  const [cwd, setCwd] = useState("/");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [navError, setNavError] = useState<string | null>(null);
  const [navLoading, setNavLoading] = useState(false);

  // --- Tabs -----------------------------------------------------------------
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const active = useMemo(() => tabs.find((t) => t.path === activePath) ?? null, [tabs, activePath]);
  const dirty = active ? active.buffer !== active.disk : false;

  // --- Painéis inferiores ---------------------------------------------------
  const [diffOpen, setDiffOpen] = useState(false);
  const [output, setOutput] = useState<{ title: string; text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const navigate = useCallback(
    async (to: string) => {
      if (!available) return;
      setNavLoading(true);
      setNavError(null);
      try {
        setEntries(await readDir(to));
        setCwd(to);
      } catch (e) {
        setNavError(String(e instanceof Error ? e.message : e));
      } finally {
        setNavLoading(false);
      }
    },
    [available],
  );

  const openFile = useCallback(
    async (entry: FsEntry) => {
      // Já aberto? Ativa a tab existente.
      if (tabs.some((t) => t.path === entry.path)) {
        setActivePath(entry.path);
        return;
      }
      try {
        const info = entry.size != null ? { size: entry.size } : await stat(entry.path);
        if (info.size != null && info.size > PREVIEW_MAX_BYTES) {
          toast(`Ficheiro demasiado grande para editar (> ${fmtBytes(PREVIEW_MAX_BYTES)})`, false);
          return;
        }
        const content = await readTextFile(entry.path);
        const tab: OpenTab = {
          path: entry.path,
          name: entry.name,
          language: languageForFile(entry.name),
          disk: content,
          buffer: content,
        };
        setTabs((ts) => [...ts, tab]);
        setActivePath(entry.path);
        setDiffOpen(false);
        setOutput(null);
      } catch (e) {
        toast(`Não foi possível abrir: ${e instanceof Error ? e.message : e}`, false);
      }
    },
    [tabs, toast],
  );

  const closeTab = useCallback(
    (path: string) => {
      const tab = tabs.find((t) => t.path === path);
      if (!tab) return;
      if (tab.buffer !== tab.disk) {
        // eslint-disable-next-line no-alert
        const ok = typeof confirm === "function" ? confirm(`"${tab.name}" tem alterações não guardadas. Fechar e perder as alterações?`) : true;
        if (!ok) return;
      }
      setTabs((ts) => {
        const next = ts.filter((t) => t.path !== path);
        if (activePath === path) setActivePath(next.length ? next[next.length - 1].path : null);
        return next;
      });
    },
    [tabs, activePath],
  );

  const onChange = useCallback(
    (value: string | undefined) => {
      if (activePath == null) return;
      setTabs((ts) => ts.map((t) => (t.path === activePath ? { ...t, buffer: value ?? "" } : t)));
    },
    [activePath],
  );

  // GUARDAR (≠ aplicar): escreve o buffer no caminho em disco pelo comando
  // dedicado `dlx_write_text`. Mantém-se como ref para o atalho Ctrl+S do
  // Monaco não apanhar um closure obsoleto.
  const save = useCallback(async () => {
    if (!active || active.buffer === active.disk) return;
    setBusy(true);
    try {
      await writeTextFile(active.path, active.buffer);
      setTabs((ts) => ts.map((t) => (t.path === active.path ? { ...t, disk: t.buffer } : t)));
      setDiffOpen(false);
      toast(`Guardado · ${active.name}`, true);
    } catch (e) {
      toast(`Falha ao guardar: ${e instanceof Error ? e.message : e}`, false);
    } finally {
      setBusy(false);
    }
  }, [active, toast]);

  const saveRef = useRef(save);
  saveRef.current = save;

  // Ctrl/Cmd+S guarda (fora do editor também, ex.: foco no explorador).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Arranque: diretório inicial (vindo de "Abrir no editor") ou HOME.
  useEffect(() => {
    if (!available) return;
    void homeDir().then((h) => navigate(initialPath || h || "/"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available]);

  const onMount: OnMount = useCallback((editor, monaco) => {
    monaco.editor.defineTheme(THEME, {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: { "editor.background": "#0f1114", "editorGutter.background": "#0f1114" },
    });
    monaco.editor.setTheme(THEME);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void saveRef.current());
  }, []);

  // --- Ações de manifesto (só-leitura: Validar/Render) ----------------------
  // Correm SEMPRE contra a versão em DISCO (o CLI lê o ficheiro). Se o buffer
  // estiver sujo, avisa-se no painel.
  const runText = useCallback(
    async (argv: Argv, title: string) => {
      if (!active) return;
      setBusy(true);
      setOutput(null);
      try {
        const r = await client.readText(argv);
        const text = [r.stdout, r.stderr].filter((s) => s.trim()).join("\n");
        setOutput({ title, text: text || "(sem saída)", ok: r.ok });
      } catch (e) {
        setOutput({ title, text: String(e), ok: false });
      } finally {
        setBusy(false);
      }
    },
    [active, client],
  );

  const applyManifest = useCallback(() => {
    if (!active) return;
    // APLICAR À INFRA (≠ guardar): ação de escrita, passa pelo `act` → pede
    // confirmação de risco (stack apply = SafeWrite; a UI mostra o CLI).
    void act(cmd.stackApply(active.path), `Aplicar manifesto (${active.name})`).then((ok) => {
      if (ok) setOutput({ title: "stack apply", text: "Aplicado. Vê Workloads/Eventos para o resultado.", ok: true });
    });
  }, [active, act]);

  const yaml = active ? isYamlFile(active.name) : false;

  if (!available) {
    return (
      <>
        <PageHead title="Editor" subtitle="Editor de código integrado — manifestos, YAML, Dockerfile, configs" />
        <div style={{ padding: 24 }}>
          <ErrorNote error="O editor só funciona na aplicação de secretária (Tauri): precisa de acesso ao filesystem. Em modo de desenvolvimento no browser não há ficheiros." />
        </div>
      </>
    );
  }

  const crumbs = breadcrumb(cwd);
  const sorted = [...entries].sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));

  return (
    <>
      <PageHead
        title="Editor"
        subtitle="Abrir → editar → validar → ver diff → aplicar. Guardar escreve o ficheiro; Aplicar muda a infraestrutura."
      />
      <div className="ide" style={{ display: "flex", height: "calc(100% - 64px)", minHeight: 0, borderTop: "1px solid var(--line)" }}>
        {/* ESQUERDA — explorador de ficheiros */}
        <aside style={{ width: 260, flex: "0 0 260px", borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", minHeight: 0, background: "var(--panel)" }}>
          <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--line2)", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn sm" type="button" title="Subir um nível" disabled={cwd === "/"} onClick={() => void navigate(parentPath(cwd))}>
              <Icon name="up" size={12} />
            </button>
            <button className="btn sm" type="button" title="Ir para HOME" onClick={() => void homeDir().then((h) => navigate(h || "/"))}>
              <Icon name="files" size={12} /> HOME
            </button>
          </div>
          <div className="mono" style={{ padding: "6px 10px", fontSize: 11, color: "var(--mut)", borderBottom: "1px solid var(--line2)", overflowX: "auto", whiteSpace: "nowrap" }}>
            {crumbs.map((c, i) => (
              <span key={c.path}>
                {i > 0 && <span style={{ opacity: 0.5 }}> / </span>}
                <button type="button" className="linkish" onClick={() => void navigate(c.path)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, font: "inherit" }}>
                  {c.label}
                </button>
              </span>
            ))}
          </div>
          <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
            {navLoading && <div style={{ padding: 10, fontSize: 12, color: "var(--mut)" }}>A carregar…</div>}
            {navError && <div style={{ padding: 10 }}><ErrorNote error={navError} /></div>}
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {sorted.map((e) => (
                <li key={e.path}>
                  <button
                    type="button"
                    className="ide-entry"
                    onClick={() => (e.isDir ? void navigate(e.path) : void openFile(e))}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "5px 10px", background: "none", border: "none", color: "var(--tx)", cursor: "pointer", fontSize: 13, textAlign: "left" }}
                  >
                    <Icon name={e.isDir ? "folder" : "file"} size={14} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: e.isDir ? "var(--tx)" : "var(--tx2)" }}>{e.name}</span>
                  </button>
                </li>
              ))}
              {!navLoading && !sorted.length && <li style={{ padding: 10, fontSize: 12, color: "var(--mut)" }}>(vazio)</li>}
            </ul>
          </div>
        </aside>

        {/* CENTRO — tabs + editor + painéis */}
        <section style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
          {/* Barra de tabs */}
          <div style={{ display: "flex", alignItems: "stretch", borderBottom: "1px solid var(--line2)", background: "var(--panel)", overflowX: "auto" }}>
            {tabs.map((t) => (
              <div
                key={t.path}
                className={`ide-tab${t.path === activePath ? " on" : ""}`}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px 6px 12px", borderRight: "1px solid var(--line2)", cursor: "pointer", background: t.path === activePath ? "var(--bg)" : "transparent", whiteSpace: "nowrap" }}
                onClick={() => setActivePath(t.path)}
                title={t.path}
              >
                <span style={{ fontSize: 13, color: t.path === activePath ? "var(--tx)" : "var(--tx2)" }}>
                  {t.name}
                  {t.buffer !== t.disk && <span style={{ color: "var(--warn, #e0a030)", marginLeft: 6 }} title="Alterações não guardadas">●</span>}
                </span>
                <button type="button" className="btn sm" style={{ padding: 2, lineHeight: 0 }} title="Fechar" onClick={(ev) => { ev.stopPropagation(); closeTab(t.path); }}>
                  <Icon name="close" size={11} />
                </button>
              </div>
            ))}
            {!tabs.length && <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--mut)" }}>Escolhe um ficheiro no explorador para o abrir.</div>}
          </div>

          {/* Toolbar de ações */}
          {active && (
            <div className="toolbar" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", padding: "8px 12px", borderBottom: "1px solid var(--line2)" }}>
              <button className="btn pri" type="button" disabled={busy || !dirty} onClick={() => void save()} title="Guardar ficheiro (Ctrl+S)">
                <Icon name="download" size={13} /> Guardar{dirty ? " ●" : ""}
              </button>
              <button className={`btn${diffOpen ? " on" : ""}`} type="button" disabled={!dirty} onClick={() => setDiffOpen((o) => !o)} title="Comparar o buffer com o que está em disco">
                <Icon name="declarative" size={13} /> Diff vs disco
              </button>
              <span style={{ flex: 1 }} />
              <Chip tone="neu">{active.language}</Chip>
              {yaml && (
                <>
                  <span style={{ width: 1, height: 20, background: "var(--line)" }} />
                  <button className="btn" type="button" disabled={busy} onClick={() => void runText(cmd.manifestValidate(active.path), "manifest validate")}>Validar</button>
                  <button className="btn" type="button" disabled={busy} onClick={() => void runText(cmd.manifestRender(active.path), "manifest render")}>Render</button>
                  <button className="btn danger" type="button" disabled={busy} onClick={applyManifest} title="Converge a infraestrutura para o manifesto (stack apply)">
                    <Icon name="play" size={13} /> Aplicar à infra…
                  </button>
                </>
              )}
            </div>
          )}

          {/* Editor / Diff */}
          <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
            {active ? (
              diffOpen ? (
                <DiffEditor
                  original={active.disk}
                  modified={active.buffer}
                  language={active.language}
                  theme={THEME}
                  options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, fontSize: 13 }}
                />
              ) : (
                <MonacoEditor
                  path={active.path}
                  value={active.buffer}
                  language={active.language}
                  theme={THEME}
                  onChange={onChange}
                  onMount={onMount}
                  options={{ minimap: { enabled: false }, fontSize: 13, tabSize: 2, automaticLayout: true, scrollBeyondLastLine: false, renderWhitespace: "selection" }}
                />
              )
            ) : (
              <div style={{ padding: 32, color: "var(--mut)", fontSize: 13 }}>
                Sem ficheiro aberto. Navega no explorador à esquerda e clica num ficheiro de texto (YAML, JSON, Dockerfile, config…).
              </div>
            )}
          </div>

          {/* Painel de PROBLEMAS / saída do CLI */}
          {active && (output || (yaml && dirty)) && (
            <div style={{ borderTop: "1px solid var(--line)", background: "var(--panel)", maxHeight: 260, overflow: "auto", flex: "0 0 auto" }}>
              {yaml && dirty && (
                <div style={{ padding: "6px 12px", fontSize: 12, color: "var(--warn, #e0a030)", borderBottom: output ? "1px solid var(--line2)" : "none" }}>
                  Atenção: Validar / Render / Aplicar usam a versão em DISCO. Guarda primeiro para avaliar as tuas alterações.
                </div>
              )}
              {output && (
                <div style={{ padding: "8px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <Chip tone={output.ok ? "ok" : "bad"} dot>{output.ok ? "ok" : "erro"}</Chip>
                      <b style={{ fontSize: 13 }}>{output.title}</b>
                    </span>
                    <span style={{ display: "inline-flex", gap: 8 }}>
                      <CliHint argv={output.title === "manifest render" ? cmd.manifestRender(active.path) : cmd.manifestValidate(active.path)} compact />
                      <button className="btn sm" type="button" onClick={() => setOutput(null)}><Icon name="close" size={11} /> Fechar</button>
                    </span>
                  </div>
                  <pre className="mono" style={{ margin: 0, padding: 10, background: "var(--term)", borderRadius: 6, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", border: "1px solid var(--line2)" }}>
                    {output.text}
                  </pre>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
