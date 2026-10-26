// Visor de YAML/manifestos READ-ONLY, partilhado (§6/§10/§11). Monaco em modo
// só-leitura, com REALCE de sintaxe, dobragem, números de linha e — quando há
// schema — VALIDAÇÃO EM-VISOR (o "LP": o worker de monaco-yaml sublinha os
// problemas e lista-os numa barra). Substitui os `<pre>` de YAML espalhados
// pelos visores (Studio Apply, Declarativo, kubeconfig do ClusterDetail…).
//
// LAZY: este módulo importa `@monaco-editor/react` + `monacoSetup` (que arrasta
// o monaco-editor, o monaco-yaml e os seus workers), por isso é carregado por
// `React.lazy` (ver LazyYamlView.tsx). O monaco fica num chunk à parte, fora do
// bundle inicial — só desce quando um YamlView aparece de facto no ecrã.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import MonacoEditor, { type OnMount } from "@monaco-editor/react";
import type { editor as MonacoNS } from "monaco-editor";
import { useApp } from "../app/context";
import { cmd } from "../lib/cli";
import { saveTextViaDialog } from "../lib/fsx";
import { copyText, nativeDialogsAvailable } from "../lib/native";
import {
  isDelonixSchemaReady,
  modelUriString,
  registerYamlSchemas,
  setDelonixSchema,
  setupMonaco,
  unregisterYamlSchemas,
} from "../lib/monacoSetup";
import { classifyYaml, schemaKindLabel, type YamlFile } from "../lib/yamlSchemas";
import { Chip } from "./ui";
import { Icon } from "./Icon";

// Embebe o Monaco LOCALMENTE (workers via Vite `?worker`) antes de qualquer
// render — a CSP do Tauri proíbe o CDN. Arranca também o monaco-yaml (§10).
// Idempotente e partilhado com o Editor (mesma instância singleton).
setupMonaco();

// Tema dark alinhado ao Console9 (a app é dark-only) — o mesmo que o Editor.
const THEME = "delonix-dark";

export interface YamlViewProps {
  /** Conteúdo YAML a mostrar. */
  value: string;
  /**
   * Nome lógico do documento, para CLASSIFICAR o schema (delonix/k8s/compose) e
   * ligar a validação em-visor. Ex.: "studio.delonix.yaml", "<x>-kubeconfig.yaml",
   * "docker-compose.config.yaml". Sem nome, classifica-se só pelo conteúdo.
   */
  filename?: string;
  /** Altura do visor. Número = px; string = valor CSS. Omisso = preenche o pai. */
  height?: number | string;
  /** Altura mínima em px (quando preenche o pai). */
  minHeight?: number;
  /** Validação em-visor por JSON Schema (o "LP"). Omisso = ligada. */
  diagnostics?: boolean;
  /** Barra com copiar/guardar. Omisso = ligada. */
  actions?: boolean;
  /** Nome por omissão ao guardar em disco (diálogo nativo). */
  downloadName?: string;
  /** Rótulo opcional à esquerda da barra. */
  label?: string;
}

// MarkerSeverity: 8=erro, 4=aviso, ≤2=info.
const errorsOf = (ms: MonacoNS.IMarker[]) => ms.filter((m) => m.severity >= 8).length;

export default function YamlView({
  value,
  filename,
  height,
  minHeight = 160,
  diagnostics = true,
  actions = true,
  downloadName,
  label,
}: YamlViewProps) {
  const { client } = useApp();
  const instanceId = useId().replace(/[^\w-]/g, "");
  const name = filename ?? "documento.yaml";
  // URI ÚNICO por instância (evita colisões de modelo entre YamlViews e com o
  // Editor); o basename preserva a classificação por nome (delonix/compose).
  const path = `inmemory://yamlview/${instanceId}/${name}`;

  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
  const [markers, setMarkers] = useState<MonacoNS.IMarker[]>([]);
  const [markerTick, setMarkerTick] = useState(0);
  const [delonixReady, setDelonixReady] = useState(isDelonixSchemaReady());
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const kind = useMemo(() => classifyYaml(name, value), [name, value]);

  // Busca o schema do manifesto Delonix ao engine (uma vez por processo) SÓ se
  // este documento for um manifesto Delonix e o schema ainda não tiver chegado.
  // Best-effort: se falhar, degrada (fica sem validação do manifesto Delonix).
  useEffect(() => {
    if (!diagnostics || kind !== "delonix" || isDelonixSchemaReady()) return;
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
        /* sem schema do engine: validação do manifesto Delonix indisponível */
      }
    })();
    return () => { cancelled = true; };
  }, [client, diagnostics, kind]);

  // Regista a associação ficheiro→schema desta instância no monaco-yaml (chave
  // própria: não apaga as de outros consumidores). Reassocia quando a
  // classificação muda ou quando o schema Delonix chega. Desregista ao desmontar.
  useEffect(() => {
    if (!diagnostics || !kind) {
      unregisterYamlSchemas(path);
      return;
    }
    const files: YamlFile[] = [{ uri: modelUriString(path), name, content: value }];
    void registerYamlSchemas(path, files);
    return () => unregisterYamlSchemas(path);
    // `delonixReady` entra para reassociar quando o schema do engine chega.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, name, kind, diagnostics, delonixReady]);

  const onMount: OnMount = (_editor, monaco) => {
    monacoRef.current = monaco;
    monaco.editor.defineTheme(THEME, {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: { "editor.background": "#0f1114", "editorGutter.background": "#0f1114" },
    });
    monaco.editor.setTheme(THEME);
    monaco.editor.onDidChangeMarkers(() => setMarkerTick((t) => t + 1));
  };

  // Recalcula as marcas do modelo desta instância (validação em-visor → barra).
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco || !diagnostics) { setMarkers([]); return; }
    const resource = monaco.Uri.parse(path);
    setMarkers(monaco.editor.getModelMarkers({ resource }));
  }, [path, markerTick, value, diagnostics]);

  const doCopy = () =>
    void copyText(value).then((ok) => { if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1200); } });
  const doSave = () =>
    void saveTextViaDialog(value, { title: "Guardar YAML", defaultPath: downloadName ?? name })
      .then((p) => { if (p) { setSaved(p); setTimeout(() => setSaved(null), 2500); } });

  const errorCount = errorsOf(markers);
  const h = height != null ? height : "100%";

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, height: h, border: "1px solid var(--line)", borderRadius: 6, overflow: "hidden", background: "#0f1114" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderBottom: "1px solid var(--line2)", background: "var(--panel)" }}>
        {label && <span className="lbl" style={{ margin: 0 }}>{label}</span>}
        {diagnostics && kind && <Chip tone="ok" title="Validação por JSON Schema ativa neste documento">schema: {schemaKindLabel(kind)}</Chip>}
        {diagnostics && markers.length > 0 && (
          <Chip tone={errorCount > 0 ? "bad" : "warn"} dot>
            {markers.length} problema{markers.length === 1 ? "" : "s"}
          </Chip>
        )}
        <span style={{ flex: 1 }} />
        {actions && (
          <>
            <button className="btn sm" type="button" onClick={doCopy} title="Copiar para a área de transferência">
              <Icon name="copy" size={12} /> {copied ? "Copiado" : "Copiar"}
            </button>
            {nativeDialogsAvailable() && (
              <button className="btn sm" type="button" onClick={doSave} title="Guardar em disco">
                <Icon name="download" size={12} /> Guardar
              </button>
            )}
          </>
        )}
      </div>
      {saved && <div style={{ padding: "4px 8px", fontSize: 11, color: "var(--mut)", borderBottom: "1px solid var(--line2)" }}>Guardado em <span className="mono">{saved}</span></div>}
      <div style={{ flex: 1, minHeight, position: "relative" }}>
        <MonacoEditor
          path={path}
          value={value}
          language="yaml"
          theme={THEME}
          onMount={onMount}
          options={{
            readOnly: true,
            domReadOnly: true,
            minimap: { enabled: false },
            fontSize: 12,
            tabSize: 2,
            lineNumbers: "on",
            folding: true,
            automaticLayout: true,
            scrollBeyondLastLine: false,
            renderWhitespace: "selection",
            wordWrap: "off",
            scrollbar: { alwaysConsumeMouseWheel: false },
          }}
        />
      </div>
    </div>
  );
}
