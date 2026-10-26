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
import {
  isDelonixSchemaReady,
  modelUriString,
  setDelonixSchema,
  setupMonaco,
  updateYamlSchemas,
} from "../lib/monacoSetup";
import { classifyYaml, schemaKindLabel, schemasSignature, type YamlFile } from "../lib/yamlSchemas";

// Embebe o Monaco LOCALMENTE (workers via Vite `?worker`, loader apontado ao
// pacote empacotado) antes de qualquer render — a CSP do Tauri proíbe o CDN.
// Isto também arranca o monaco-yaml (LSP de YAML por JSON Schema, §10).
setupMonaco();

// Severidade de uma marca → rótulo/tom (MarkerSeverity: 8=erro, 4=aviso, 2/1=info).
const severityMeta = (sev: number): { label: string; tone: "bad" | "warn" | "neu" } =>
  sev >= 8 ? { label: "erro", tone: "bad" } : sev >= 4 ? { label: "aviso", tone: "warn" } : { label: "info", tone: "neu" };

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

  // --- Diagnósticos do schema (monaco-yaml) ---------------------------------
  // Marcas do modelo ATIVO (sublinhado no editor + painel "Problemas"). Vêm do
  // LSP de YAML por JSON Schema; recalculadas por `onDidChangeMarkers` e na troca
  // de tab. `delonixReady` sobe quando o schema do engine chega (reassocia).
  const [markers, setMarkers] = useState<MonacoNS.IMarker[]>([]);
  const [delonixReady, setDelonixReady] = useState(isDelonixSchemaReady());
  const editorRef = useRef<MonacoNS.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
  const [markerTick, setMarkerTick] = useState(0);
  // Assinatura da última associação ficheiro→schema aplicada (evita reenviar o
  // schema grande do Delonix ao worker a cada tecla).
  const schemaSigRef = useRef<string>("");

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
    editorRef.current = editor;
    monacoRef.current = monaco;
    monaco.editor.defineTheme(THEME, {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: { "editor.background": "#0f1114", "editorGutter.background": "#0f1114" },
    });
    monaco.editor.setTheme(THEME);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void saveRef.current());
    // Qualquer mudança de marcas (o worker do monaco-yaml revalida em background)
    // reavalia o painel de Problemas do modelo ativo.
    monaco.editor.onDidChangeMarkers(() => setMarkerTick((t) => t + 1));
  }, []);

  // Obtém o JSON Schema do manifesto Delonix do ENGINE (`manifest schema`) UMA
  // vez e injeta-o no monaco-yaml. Best-effort: se o engine não responder ou a
  // saída não for JSON, degrada em silêncio (a família Delonix fica sem schema,
  // o resto do IDE funciona na mesma).
  useEffect(() => {
    if (isDelonixSchemaReady()) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await client.readText(cmd.manifestSchema());
        if (cancelled || !r.ok) return;
        const start = r.stdout.indexOf("{");
        if (start < 0) return;
        const schema = JSON.parse(r.stdout.slice(start)) as object;
        setDelonixSchema(schema);
        if (!cancelled) setDelonixReady(true);
      } catch {
        /* sem schema do engine: a validação do manifesto Delonix fica indisponível */
      }
    })();
    return () => { cancelled = true; };
  }, [client]);

  // Reassocia os schemas do monaco-yaml quando o conjunto de YAML abertos (ou a
  // chegada do schema Delonix) muda a classificação. Só chama o worker quando a
  // ASSINATURA muda — não a cada tecla.
  useEffect(() => {
    const files: YamlFile[] = tabs
      .filter((t) => isYamlFile(t.name))
      .map((t) => ({ uri: modelUriString(t.path), name: t.name, content: t.buffer }));
    const sig = schemasSignature(files, delonixReady);
    if (sig === schemaSigRef.current) return;
    schemaSigRef.current = sig;
    void updateYamlSchemas(files);
  }, [tabs, delonixReady]);

  // Recalcula as marcas do modelo ATIVO (na troca de tab e em cada mudança de
  // marcas). Lê diretamente do Monaco por recurso — robusto à troca de modelo.
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco || !activePath) { setMarkers([]); return; }
    const resource = monaco.Uri.parse(activePath);
    setMarkers(monaco.editor.getModelMarkers({ resource }));
  }, [activePath, markerTick, diffOpen]);

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

  // Salta o cursor para a linha/coluna de uma marca (botão "ir para" no painel).
  const goToMarker = useCallback((m: MonacoNS.IMarker) => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.setPosition({ lineNumber: m.startLineNumber, column: m.startColumn });
    ed.revealLineInCenter(m.startLineNumber);
    ed.focus();
  }, []);

  const yaml = active ? isYamlFile(active.name) : false;
  // Família de schema do ficheiro ativo (para o chip informativo).
  const schemaKind = active && yaml ? classifyYaml(active.name, active.buffer) : null;
  const errorCount = markers.filter((m) => m.severity >= 8).length;

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
              {markers.length > 0 && (
                <Chip tone={errorCount > 0 ? "bad" : "warn"} dot>
                  {markers.length} problema{markers.length === 1 ? "" : "s"}
                </Chip>
              )}
              {schemaKind && <Chip tone="ok" title="Validação por JSON Schema ativa neste ficheiro">schema: {schemaKindLabel(schemaKind)}</Chip>}
              <Chip tone="neu">{active.language}</Chip>
              {yaml && (
                <>
                  <span style={{ width: 1, height: 20, background: "var(--line)" }} />
                  <button className="btn" type="button" disabled={busy} onClick={() => void runText(cmd.manifestValidate(active.path), "manifest validate")} title="Validação AUTORITÁRIA pelo engine (schema + referências + grafo)">Validar</button>
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
          {active && (output || markers.length > 0 || (yaml && dirty)) && (
            <div style={{ borderTop: "1px solid var(--line)", background: "var(--panel)", maxHeight: 260, overflow: "auto", flex: "0 0 auto" }}>
              {yaml && dirty && (
                <div style={{ padding: "6px 12px", fontSize: 12, color: "var(--warn, #e0a030)", borderBottom: "1px solid var(--line2)" }}>
                  Atenção: Validar / Render / Aplicar usam a versão em DISCO. Guarda primeiro para avaliar as tuas alterações.
                </div>
              )}
              {markers.length > 0 && (
                <div style={{ padding: "8px 12px", borderBottom: output ? "1px solid var(--line2)" : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <Icon name="declarative" size={13} />
                    <b style={{ fontSize: 13 }}>Problemas</b>
                    <Chip tone={errorCount > 0 ? "bad" : "warn"} dot>{markers.length}</Chip>
                    <span style={{ fontSize: 11, color: "var(--mut)" }}>
                      validação rápida por JSON Schema (o editor); &ldquo;Validar&rdquo; é a verdade do engine
                    </span>
                  </div>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    {markers.map((m, i) => {
                      const meta = severityMeta(m.severity);
                      return (
                        <li key={`${m.startLineNumber}:${m.startColumn}:${i}`}>
                          <button
                            type="button"
                            onClick={() => goToMarker(m)}
                            title="Ir para a linha"
                            style={{ display: "flex", alignItems: "baseline", gap: 8, width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "3px 6px", borderRadius: 4, color: "var(--tx)", fontSize: 12 }}
                          >
                            <Chip tone={meta.tone}>{meta.label}</Chip>
                            <span className="mono" style={{ color: "var(--mut)", flex: "0 0 auto" }}>L{m.startLineNumber}:{m.startColumn}</span>
                            <span style={{ color: "var(--tx2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.message}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
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
