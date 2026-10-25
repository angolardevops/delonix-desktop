import { describe, expect, it } from "vitest";
import { fmtDuration, parseHistory, parseScanSummary, scanTotal } from "./build";

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
    expect(s).toEqual({ critical: 0, high: 1, medium: 0, low: 0, packages: 14, vulnerabilities: 1 });
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
