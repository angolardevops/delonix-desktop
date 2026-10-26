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
// Este módulo é importado SÓ pelo Editor.tsx (tela lazy), por isso todo o peso
// do monaco-editor e dos seus workers fica no chunk do editor, fora do bundle
// inicial.
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

let done = false;

// Regista os workers locais e aponta o loader ao monaco empacotado. Idempotente
// (chamável a cada montagem da tela; só corre uma vez).
export function setupMonaco(): void {
  if (done) return;
  done = true;

  // O monaco pede um worker por "label" de linguagem. Os que não têm serviço
  // dedicado (yaml, toml, shell, dockerfile, …) usam o worker genérico do
  // editor — a tokenização/realce é síncrona (Monarch), não precisa de worker
  // próprio. A validação de YAML/manifesto faz-se pelo CLI `delonix`, não aqui.
  (self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      switch (label) {
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
}
