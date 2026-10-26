// Associação FICHEIRO → JSON Schema para o monaco-yaml (validação + completação
// + hover do IDE, §10). Módulo PURO (sem Monaco, sem DOM, sem rede) para ser
// testável e para ficar FORA do chunk pesado do editor.
//
// Três famílias de schema:
//  - "delonix"  — o manifesto Delonix. O schema vem do ENGINE em runtime
//                 (`delonix manifest schema`), por isso é injetado (não embebido).
//  - "k8s"      — Kubernetes. Schema EMBEBIDO localmente (subconjunto pragmático).
//  - "compose"  — docker-compose. Schema EMBEBIDO localmente (subconjunto).
//
// Embebidos porque a CSP do Tauri (`default-src 'self'`) proíbe buscar schemas
// da net; são um subconjunto razoável, não a especificação completa — a verdade
// autoritária continua a ser o engine (`manifest validate` / `compose config`).
import composeSchema from "./schemas/compose.schema.json";
import k8sSchema from "./schemas/k8s.schema.json";

export type SchemaKind = "delonix" | "k8s" | "compose";

// Um ficheiro YAML aberto, para classificação. `uri` é a string do model URI do
// Monaco (monaco.Uri.parse(path).toString()); é o que o monaco-yaml compara com
// o `fileMatch`. `name` é o basename; `content` o buffer atual (para a heurística).
export interface YamlFile {
  uri: string;
  name: string;
  content: string;
}

// Uma associação pronta a passar ao monaco-yaml (espelha SchemasSettings).
export interface YamlSchemaEntry {
  uri: string;
  fileMatch: string[];
  schema: object;
}

const lower = (s: string) => s.toLowerCase();

// Nome → família por NOME (prioridade sobre o conteúdo).
function classifyByName(name: string): SchemaKind | null {
  const n = lower(name);
  if (
    n === "delonix.yaml" || n === "delonix.yml" ||
    n === "delonix-manifest.yaml" || n === "delonix-manifest.yml" ||
    n.endsWith(".delonix.yaml") || n.endsWith(".delonix.yml")
  ) {
    return "delonix";
  }
  // Compose por NOME (task §10): qualquer *compose*.y{a,}ml — docker-compose.yml,
  // compose.yaml, app.compose.yaml, docker-compose.override.yml, …
  if ((n.endsWith(".yml") || n.endsWith(".yaml")) && n.includes("compose")) {
    return "compose";
  }
  return null;
}

// Valor de `apiVersion:` no topo do documento (1ª ocorrência), sem aspas; "" se
// ausente. Tolerante a indentação e a aspas simples/duplas.
export function apiVersionOf(content: string): string {
  const m = /^\s*apiVersion:\s*(['"]?)([\w./-]+)\1\s*$/m.exec(content);
  return m ? m[2] : "";
}

// Tem uma linha `kind: <algo>`?
function hasKind(content: string): boolean {
  return /^\s*kind:\s*\S+/m.test(content);
}

// Família por HEURÍSTICA de conteúdo (apiVersion:/kind:). Um apiVersion de
// delonix.io é um manifesto Delonix; qualquer outro apiVersion+kind é Kubernetes.
function classifyByContent(content: string): SchemaKind | null {
  const api = lower(apiVersionOf(content));
  if (!api) return null;
  if (api.includes("delonix.io")) return "delonix";
  if (hasKind(content)) return "k8s";
  return null;
}

// Família de UM ficheiro: NOME primeiro, depois conteúdo. null = sem schema
// conhecido (YAML genérico, só realce de sintaxe).
export function classifyYaml(name: string, content: string): SchemaKind | null {
  return classifyByName(name) ?? classifyByContent(content);
}

// Schema embebido de cada família conhecida localmente. O "delonix" NÃO está
// aqui — é injetado em runtime (vem do engine).
export const EMBEDDED_SCHEMAS: Record<"k8s" | "compose", object> = {
  k8s: k8sSchema as object,
  compose: composeSchema as object,
};

// URIs identificadoras de cada schema (fonte mostrada nos hovers do monaco-yaml).
const SCHEMA_URI: Record<SchemaKind, string> = {
  delonix: "delonix-desktop://schemas/delonix-manifest.json",
  k8s: "delonix-desktop://schemas/k8s.json",
  compose: "delonix-desktop://schemas/compose.json",
};

// Constrói as associações para o monaco-yaml a partir dos ficheiros YAML abertos.
// Agrupa os URIs por família e emite uma entrada por família COM ficheiros. A
// família "delonix" só entra se o schema do engine já tiver sido obtido
// (`delonixSchema` não-nulo) — degrada sem rebentar quando o engine não responde.
export function buildSchemas(files: YamlFile[], delonixSchema: object | null): YamlSchemaEntry[] {
  const byKind: Record<SchemaKind, string[]> = { delonix: [], k8s: [], compose: [] };
  for (const f of files) {
    const kind = classifyYaml(f.name, f.content);
    if (kind) byKind[kind].push(f.uri);
  }
  const entries: YamlSchemaEntry[] = [];
  const push = (kind: SchemaKind, schema: object | null) => {
    if (schema && byKind[kind].length) {
      entries.push({ uri: SCHEMA_URI[kind], fileMatch: [...byKind[kind]], schema });
    }
  };
  push("delonix", delonixSchema);
  push("k8s", EMBEDDED_SCHEMAS.k8s);
  push("compose", EMBEDDED_SCHEMAS.compose);
  return entries;
}

// Rótulo humano da família (para o painel de Problemas / chips).
export function schemaKindLabel(kind: SchemaKind | null): string {
  switch (kind) {
    case "delonix": return "manifesto Delonix";
    case "k8s": return "Kubernetes";
    case "compose": return "Compose";
    default: return "YAML";
  }
}

// Assinatura ESTÁVEL do conjunto de associações (família→uris ordenados). Serve
// para só reconfigurar o monaco-yaml quando a associação muda de facto — e não a
// cada tecla —, evitando reenviar o schema (grande) do Delonix ao worker.
export function schemasSignature(files: YamlFile[], delonixReady: boolean): string {
  const byKind: Record<string, string[]> = {};
  for (const f of files) {
    const kind = classifyYaml(f.name, f.content);
    if (!kind) continue;
    if (kind === "delonix" && !delonixReady) continue;
    (byKind[kind] ??= []).push(f.uri);
  }
  return Object.keys(byKind)
    .sort()
    .map((k) => `${k}:${byKind[k].sort().join(",")}`)
    .join("|");
}
