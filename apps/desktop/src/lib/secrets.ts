// Parsing PURO do `secret inspect [--reveal] -o json` (§E). Isolado do
// tauriClient (que importa a API do Tauri) para ser testável em Node.
//
// O contrato 5.1.1 devolve um ARRAY com um elemento:
//   [{ "name": "db-pass", "keys": ["PASSWORD"],
//      "data": { "PASSWORD": "••••••" | "valor-em-claro" }, "revealed": bool }]
// A UI só precisa do mapa `data` (chave→valor) e do flag `revealed`. Sem
// `--reveal`, os valores já vêm mascarados pelo PRÓPRIO engine ("••••••") — a
// app nunca inventa nem guarda o valor em claro.
import type { SecretReveal } from "./types";

export function parseSecretInspect(raw: unknown): SecretReveal {
  const first = Array.isArray(raw) ? raw[0] : raw;
  const o = (first && typeof first === "object" ? first : {}) as Record<string, unknown>;
  const data = (o.data && typeof o.data === "object" ? o.data : {}) as Record<string, unknown>;
  const keys: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) keys[k] = v == null ? "" : String(v);
  return { keys, revealed: Boolean(o.revealed) };
}
