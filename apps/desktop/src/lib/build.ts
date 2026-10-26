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
  /**
   * A base de CVEs usada é o PLACEHOLDER embebido (não um feed real). O próprio
   * engine 5.1.1 avisa: `database source: EMBEDDED database (placeholder)` +
   * `warning EMBEDDED CVE database (placeholder, …) — NOT a real feed; a "no
   * vulnerabilities" is not to be trusted`. Quando true, um "0 vulnerabilidades"
   * NÃO é de confiar e a UI tem de o dizer, sugerindo `image scan --update`.
   */
  placeholder: boolean;
}

// Deteta se a saída de um scan veio da base embebida placeholder (ver acima).
// Olha tanto para a linha `database source:` como para o aviso textual — basta
// uma delas nomear "EMBEDDED"/"placeholder" para não confiarmos no resultado.
export function scanUsesPlaceholderDb(stdout: string): boolean {
  return /database source:\s*EMBEDDED/i.test(stdout)
    || /EMBEDDED CVE database/i.test(stdout)
    || /placeholder/i.test(stdout)
    || /not a real feed/i.test(stdout);
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
    placeholder: scanUsesPlaceholderDb(stdout),
  };
}

// Comando sugerido para sincronizar o feed de CVEs (deixa de ser placeholder).
// Confirmado por `image scan --help` no 5.1.1: `--update [--feed <URL|FICHEIRO>]`
// (ou $DELONIX_ADVISORY_FEED). O URL é um exemplo — o utilizador põe o seu feed.
export const SCAN_UPDATE_HINT = "delonix image scan --update --feed <URL do feed OSV/JSON>";

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

// --- Persistência do histórico de builds -----------------------------------
// A LISTA de builds (tag/estado/duração/hora/argv) persiste em localStorage e é
// reposta no arranque, para "Re-executar" sobreviver a um reinício da app. Os
// LOGS (lines) NÃO se persistem: são grandes, efémeros, e só fazem sentido na
// sessão viva — por isso "Ver logs" de um build reposto mostra "(sem logs
// guardados)". Cap de 50 entradas (as mais recentes primeiro).
export const BUILD_HISTORY_KEY = "delonix.build.history";
export const BUILD_HISTORY_CAP = 50;

// A forma guardada: tudo menos as linhas de log.
type BuildMeta = Omit<BuildRecord, "lines">;

function isBuildMeta(x: unknown): x is BuildMeta {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return typeof r.id === "string"
    && typeof r.tag === "string"
    && (r.state === "building" || r.state === "ok" || r.state === "fail")
    && typeof r.startedAt === "number"
    && (r.durationMs === null || typeof r.durationMs === "number")
    && Array.isArray(r.argv)
    && (r.argv as unknown[]).every((a) => typeof a === "string");
}

// localStorage de forma segura (ausente em testes/SSR ou bloqueado) — devolve
// null em vez de rebentar. Permite injetar um Storage nos testes.
function safeStorage(store?: Storage): Storage | null {
  if (store) return store;
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadBuildHistory(store?: Storage): BuildRecord[] {
  const s = safeStorage(store);
  if (!s) return [];
  try {
    const raw = s.getItem(BUILD_HISTORY_KEY);
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(isBuildMeta)
      // Um build "a construir" guardado é de uma sessão que já morreu: ao repor,
      // nunca pode continuar a correr → marca-se como falhado (honesto).
      .map((m) => ({ ...m, state: m.state === "building" ? "fail" as const : m.state, lines: [] }))
      .slice(0, BUILD_HISTORY_CAP);
  } catch {
    return [];
  }
}

export function saveBuildHistory(records: BuildRecord[], store?: Storage): void {
  const s = safeStorage(store);
  if (!s) return;
  try {
    // Descarta as linhas (não se persistem) e aplica o cap.
    const slim: BuildMeta[] = records.slice(0, BUILD_HISTORY_CAP).map(({ lines, ...meta }) => { void lines; return meta; });
    s.setItem(BUILD_HISTORY_KEY, JSON.stringify(slim));
  } catch {
    /* quota cheia ou storage indisponível — o histórico fica só-sessão */
  }
}
