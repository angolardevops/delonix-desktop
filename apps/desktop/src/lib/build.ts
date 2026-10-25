// Funções PURAS do estúdio de build (§ build / § image) — sem Tauri, testáveis
// em isolamento. Três responsabilidades:
//   1. Parsear o resumo de severidades de `image scan` (texto; não há -o json).
//   2. Parsear as camadas de `image history` (texto) para uma tabela.
//   3. Modelar o histórico de builds DESTA SESSÃO (estado em memória da tela).

// --- Resumo de um scan de vulnerabilidades ---------------------------------
// `image scan <img>` imprime, entre outras linhas:
//   SBOM: 14 package(s)   advisories: 5   vulnerabilities: 1
//   CRITICAL 0   HIGH 1   MEDIUM 0   LOW 0
// seguido de uma tabela SEVERITY/PACKAGE/… A severidade na tabela ("High  …")
// nunca é seguida de um número, por isso o regex `SEV\s+(\d+)` só casa a linha
// de contagem. Devolve null quando não há linha de contagens (não é um scan).
export interface ScanSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  /** Nº de pacotes do SBOM; null se a linha não veio. */
  packages: number | null;
  /** Nº total de vulnerabilidades; null se a linha não veio. */
  vulnerabilities: number | null;
}

export function parseScanSummary(stdout: string): ScanSummary | null {
  const sev = (name: string): number => {
    const m = new RegExp(`\\b${name}\\s+(\\d+)\\b`, "i").exec(stdout);
    return m ? Number(m[1]) : 0;
  };
  // Sem a linha de contagem CRITICAL … não há resumo fiável.
  if (!/\bCRITICAL\s+\d+/i.test(stdout)) return null;
  const pkg = /SBOM:\s*(\d+)\s*package/i.exec(stdout);
  const vuln = /vulnerabilit(?:y|ies):\s*(\d+)/i.exec(stdout);
  return {
    critical: sev("CRITICAL"),
    high: sev("HIGH"),
    medium: sev("MEDIUM"),
    low: sev("LOW"),
    packages: pkg ? Number(pkg[1]) : null,
    vulnerabilities: vuln ? Number(vuln[1]) : null,
  };
}

// Total de achados com severidade conhecida (para o badge "limpa"/"N achados").
export const scanTotal = (s: ScanSummary): number => s.critical + s.high + s.medium + s.low;

// --- Camadas de `image history` --------------------------------------------
// Tabela TEXTO com cabeçalho `#  LAYER  SIZE`:
//   0   sha256:17a39c0ba978cc2…   3.3 MiB
// Células separadas por 2+ espaços; a 1.ª linha é o cabeçalho. O digest pode
// vir truncado com "…" — preserva-se tal como o engine o imprime.
export interface LayerRow {
  idx: string;
  layer: string;
  size: string;
}

export function parseHistory(stdout: string): LayerRow[] {
  const lines = stdout
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0 && !/^(warning|error)\b/i.test(l.trim()));
  if (lines.length === 0) return [];
  const header = lines[0].toUpperCase();
  const body = header.includes("LAYER") && header.includes("SIZE") ? lines.slice(1) : lines;
  return body
    .map((l) => {
      const c = l.split(/\s{2,}/).map((x) => x.trim()).filter(Boolean);
      // Com índice (3 colunas) ou sem (2 colunas: LAYER SIZE).
      if (c.length >= 3) return { idx: c[0], layer: c[1], size: c[2] };
      if (c.length === 2) return { idx: "", layer: c[0], size: c[1] };
      return { idx: "", layer: c[0] ?? "", size: "" };
    })
    .filter((r) => r.layer);
}

// --- Histórico de builds da sessão -----------------------------------------
// Estado de um build: a construir, concluído (imagem produzida) ou falhado.
export type BuildState = "building" | "ok" | "fail";

export interface BuildRecord {
  id: string;
  tag: string;
  state: BuildState;
  /** Instante de início (ms epoch). */
  startedAt: number;
  /** Duração em ms; null enquanto corre. */
  durationMs: number | null;
  /** Linhas de log capturadas (para "Ver logs" de um build passado). */
  lines: string[];
  /** Os parâmetros do form, para "Re-executar". */
  argv: string[];
}

// Duração humana curta a partir de ms: "1,2 s", "3 s", "2 m 05 s".
export function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1).replace(".", ",")} s`;
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m} m ${String(rem).padStart(2, "0")} s`;
}

// Hora local curta (HH:MM) de um instante ms — para a coluna "Hora".
export function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("pt-AO", { hour: "2-digit", minute: "2-digit" });
}
