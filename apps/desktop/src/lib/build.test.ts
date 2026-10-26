import { describe, expect, it } from "vitest";
import {
  BUILD_HISTORY_CAP, BUILD_HISTORY_KEY, fmtDuration, loadBuildHistory, parseHistory,
  parseScanSummary, saveBuildHistory, scanTotal, scanUsesPlaceholderDb, type BuildRecord,
} from "./build";

// Saída real de `delonix image scan alpine:3.20` (5.1.1): a linha de contagens
// vem antes da tabela, e a tabela repete "High" SEM número — o parser não a
// pode confundir com a contagem.
const SCAN = `Vulnerability Scan · bf8527eb54c3
  SBOM: 14 package(s)   advisories: 5   vulnerabilities: 1
  CRITICAL 0   HIGH 1   MEDIUM 0   LOW 0
  database source: EMBEDDED database (placeholder) (5 advisories)
warning EMBEDDED CVE database (placeholder, 5 entries) — NOT a real feed
SEVERITY   PACKAGE   VERSION      FIXED    CVE
High       busybox   1.36.1-r31   1.37.0   CVE-2022-48174
`;

describe("parseScanSummary", () => {
  it("extrai as contagens por severidade e os totais", () => {
    const s = parseScanSummary(SCAN);
    expect(s).toEqual({ critical: 0, high: 1, medium: 0, low: 0, packages: 14, vulnerabilities: 1, placeholder: true });
  });

  it("não confunde a linha HIGH da tabela (sem número) com a contagem", () => {
    const s = parseScanSummary(SCAN)!;
    expect(s.high).toBe(1); // e não 0 nem NaN
    expect(scanTotal(s)).toBe(1);
  });

  it("devolve null quando não há linha de contagens (não é um scan)", () => {
    expect(parseScanSummary("apenas uma linha qualquer\n")).toBeNull();
    expect(parseScanSummary("")).toBeNull();
  });

  it("lê uma imagem limpa (tudo a zero)", () => {
    const clean = "  CRITICAL 0   HIGH 0   MEDIUM 0   LOW 0\n  SBOM: 3 package(s)   vulnerabilities: 0\n";
    const s = parseScanSummary(clean)!;
    expect(scanTotal(s)).toBe(0);
    expect(s.packages).toBe(3);
    expect(s.vulnerabilities).toBe(0);
    // Sem marcas de placeholder, o resultado é "confiável" (feed real presumido).
    expect(s.placeholder).toBe(false);
  });
});

describe("scanUsesPlaceholderDb", () => {
  it("deteta a base embebida placeholder a partir do aviso do engine", () => {
    expect(scanUsesPlaceholderDb(SCAN)).toBe(true);
    expect(scanUsesPlaceholderDb("database source: EMBEDDED database (placeholder) (5 advisories)")).toBe(true);
    expect(scanUsesPlaceholderDb("warning EMBEDDED CVE database (placeholder) — NOT a real feed")).toBe(true);
  });

  it("não marca placeholder quando a saída não o indica", () => {
    expect(scanUsesPlaceholderDb("  CRITICAL 0   HIGH 0   MEDIUM 0   LOW 0\n")).toBe(false);
    expect(scanUsesPlaceholderDb("database source: OSV feed (2026-10-01)")).toBe(false);
  });
});

const HISTORY = `#   LAYER                        SIZE
0   sha256:17a39c0ba978cc2…   3.3 MiB
1   sha256:abcdef0123456789…   1.1 MiB
`;

describe("parseHistory", () => {
  it("parseia as camadas (índice, digest, tamanho)", () => {
    expect(parseHistory(HISTORY)).toEqual([
      { idx: "0", layer: "sha256:17a39c0ba978cc2…", size: "3.3 MiB" },
      { idx: "1", layer: "sha256:abcdef0123456789…", size: "1.1 MiB" },
    ]);
  });

  it("tolera tabela de duas colunas (sem índice)", () => {
    const two = "LAYER                SIZE\nsha256:aaa…   2.0 MiB\n";
    expect(parseHistory(two)).toEqual([{ idx: "", layer: "sha256:aaa…", size: "2.0 MiB" }]);
  });

  it("devolve vazio para saída vazia", () => {
    expect(parseHistory("")).toEqual([]);
  });
});

describe("fmtDuration", () => {
  it("formata sub-10 s com uma casa decimal (vírgula)", () => {
    expect(fmtDuration(1234)).toBe("1,2 s");
  });
  it("formata 10–60 s em segundos inteiros", () => {
    expect(fmtDuration(42000)).toBe("42 s");
  });
  it("formata acima de um minuto", () => {
    expect(fmtDuration(125000)).toBe("2 m 05 s");
  });
  it("mostra travessão enquanto corre (null)", () => {
    expect(fmtDuration(null)).toBe("—");
  });
});

// Storage em memória (Map) para testar a persistência sem o DOM.
function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
  } as Storage;
}

const rec = (over: Partial<BuildRecord> = {}): BuildRecord => ({
  id: `build-${Math.random()}`, tag: "app:v1", state: "ok", startedAt: 1_700_000_000_000,
  durationMs: 1234, lines: ["passo 1", "passo 2"], argv: ["build", "-t", "app:v1", "."], ...over,
});

describe("persistência do histórico de builds", () => {
  it("guarda a lista e repõe-na SEM os logs (os logs não se persistem)", () => {
    const s = fakeStorage();
    saveBuildHistory([rec({ id: "build-1" }), rec({ id: "build-2" })], s);
    const back = loadBuildHistory(s);
    expect(back.map((r) => r.id)).toEqual(["build-1", "build-2"]);
    // A LISTA sobrevive (tag/estado/duração/hora/argv)…
    expect(back[0].tag).toBe("app:v1");
    expect(back[0].durationMs).toBe(1234);
    expect(back[0].argv).toEqual(["build", "-t", "app:v1", "."]);
    // …mas os logs NÃO (ficam vazios ao repor).
    expect(back[0].lines).toEqual([]);
    // E o que foi gravado não contém sequer as linhas.
    expect(s.getItem(BUILD_HISTORY_KEY)!).not.toContain("passo 1");
  });

  it("um build 'a construir' guardado volta como 'falhado' (a sessão morreu)", () => {
    const s = fakeStorage();
    saveBuildHistory([rec({ id: "build-x", state: "building", durationMs: null })], s);
    expect(loadBuildHistory(s)[0].state).toBe("fail");
  });

  it("aplica o cap de 50 entradas", () => {
    const s = fakeStorage();
    const many = Array.from({ length: 70 }, (_, i) => rec({ id: `build-${i}` }));
    saveBuildHistory(many, s);
    expect(loadBuildHistory(s)).toHaveLength(BUILD_HISTORY_CAP);
  });

  it("tolera storage vazio ou corrompido (devolve lista vazia)", () => {
    const s = fakeStorage();
    expect(loadBuildHistory(s)).toEqual([]);
    s.setItem(BUILD_HISTORY_KEY, "{ isto não é JSON válido");
    expect(loadBuildHistory(s)).toEqual([]);
    s.setItem(BUILD_HISTORY_KEY, JSON.stringify([{ id: 1, nonsense: true }]));
    expect(loadBuildHistory(s)).toEqual([]); // entradas sem a forma esperada são descartadas
  });
});
