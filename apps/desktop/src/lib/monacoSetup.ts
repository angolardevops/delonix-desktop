// Configuração do MONACO para o IDE integrado (§10), embebido 100% LOCALMENTE.
//
// Porquê não o default: o `@monaco-editor/react` carrega, por omissão, o monaco
// de um CDN (jsdelivr) por `loader`. A CSP do Tauri (tauri.conf.json) é
// `script-src 'self'` — um CDN é bloqueado e o editor nunca arrancaria. Aqui
// forçamos o loader a usar o `monaco-editor` EMPACOTADO pelo Vite
// (`loader.config({ monaco })`), e os WEB WORKERS do monaco são servidos
// localmente via o sufixo `?worker` do Vite (cada worker vira um chunk do
// próprio bundle, carregado da mesma origem — nunca de um CDN nem de blob).
//
// Validação/completação/hover de YAML (§10): o `monaco-yaml` traz um LSP de YAML
// baseado em JSON Schema que corre num WEB WORKER próprio (`monaco-yaml/yaml.worker`),
// também importado `?worker` (local, nunca da net — a CSP proíbe `enableSchemaRequest`).
// Os schemas por padrão de ficheiro são geridos em `lib/yamlSchemas.ts`.
//
// Este módulo é importado SÓ pelo Editor.tsx (tela lazy), por isso todo o peso
// do monaco-editor, do monaco-yaml e dos seus workers fica no chunk do editor,
// fora do bundle inicial.
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import yamlWorker from "monaco-yaml/yaml.worker?worker";
import { configureMonacoYaml, type MonacoYaml } from "monaco-yaml";
import { buildSchemas, type YamlFile } from "./yamlSchemas";

let done = false;
// Instância única do monaco-yaml (só pode haver uma — ver os docs do pacote).
let yamlHandle: MonacoYaml | null = null;
// Schema do manifesto Delonix, obtido do engine em runtime; null até lá chegar.
let delonixSchema: object | null = null;

// Regista os workers locais e aponta o loader ao monaco empacotado. Idempotente
// (chamável a cada montagem da tela; só corre uma vez).
export function setupMonaco(): void {
  if (done) return;
  done = true;

  // O monaco pede um worker por "label" de linguagem. "yaml" passa a ter o seu
  // próprio worker (monaco-yaml, LSP com schema). Os restantes sem serviço
  // dedicado (toml, shell, dockerfile, …) usam o worker genérico do editor.
  (self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      switch (label) {
        case "yaml":
          return new yamlWorker();
        case "json":
          return new jsonWorker();
        case "css":
        case "scss":
        case "less":
          return new cssWorker();
        case "html":
        case "handlebars":
        case "razor":
          return new htmlWorker();
        case "typescript":
        case "javascript":
          return new tsWorker();
        default:
          return new editorWorker();
      }
    },
  };

  // Usa o monaco empacotado em vez de o ir buscar ao CDN.
  loader.config({ monaco });

  // Arranca o monaco-yaml sem schemas (serão associados por ficheiro aberto).
  // `enableSchemaRequest: false` — nunca sai à rede (CSP). `validate`/`hover`/
  // `completion` ligados (o default), com diagnósticos a aparecer como marcas.
  yamlHandle = configureMonacoYaml(monaco, {
    enableSchemaRequest: false,
    validate: true,
    hover: true,
    completion: true,
    schemas: [],
  });
}

// String do model URI do Monaco para um caminho — é o que o monaco-yaml compara
// com o `fileMatch`. Usa o MESMO monaco que o `@monaco-editor/react` (singleton
// via loader.config), por isso o URI casa com o do modelo aberto.
export function modelUriString(path: string): string {
  return monaco.Uri.parse(path).toString();
}

// Injeta o JSON Schema do manifesto Delonix (vindo de `delonix manifest schema`).
// Best-effort: se nunca chegar, a família "delonix" fica sem schema (degrada).
export function setDelonixSchema(schema: object): void {
  delonixSchema = schema;
}

export function isDelonixSchemaReady(): boolean {
  return delonixSchema != null;
}

// Reconfigura as associações ficheiro→schema do monaco-yaml a partir dos YAML
// abertos. Só deve ser chamada quando a associação muda (ver schemasSignature)
// para não reenviar o schema grande do Delonix ao worker a cada tecla.
export async function updateYamlSchemas(files: YamlFile[]): Promise<void> {
  if (!yamlHandle) return;
  const schemas = buildSchemas(files, delonixSchema);
  await yamlHandle.update({
    enableSchemaRequest: false,
    validate: true,
    hover: true,
    completion: true,
    schemas,
  });
}
