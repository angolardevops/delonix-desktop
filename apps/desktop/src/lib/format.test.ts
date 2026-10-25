import { describe, expect, it } from "vitest";
import { fmtClockUnix, fmtCreated, fmtRelative, fmtUnix, humanBytes } from "./format";

// 2026-10-25T12:00:00Z
const NOW = 1792972800_000;

describe("fmtUnix (correção da hora dos eventos — epoch cru → hora local)", () => {
  it("não devolve o epoch cru em string", () => {
    const s = fmtUnix(1784277081);
    expect(s).not.toBe("1784277081"); // o bug era mostrar exatamente isto
    expect(s.length).toBeGreaterThan(0);
  });
  it("vazio quando não medido", () => {
    expect(fmtUnix(null)).toBe("");
    expect(fmtUnix(undefined)).toBe("");
    expect(fmtUnix(NaN)).toBe("");
  });
  it("fmtClockUnix preserva os segundos", () => {
    expect(fmtClockUnix(NOW / 1000)).toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(fmtClockUnix(null)).toBe("");
  });
});

describe("fmtRelative", () => {
  it("passado e futuro em pt-AO", () => {
    expect(fmtRelative(NOW / 1000 - 30, NOW)).toBe("há instantes");
    expect(fmtRelative(NOW / 1000 - 3600, NOW)).toBe("há 1 hora");
    expect(fmtRelative(NOW / 1000 - 2 * 86400, NOW)).toBe("há 2 dias");
    expect(fmtRelative(NOW / 1000 + 2 * 3600, NOW)).toBe("daqui a 2 horas");
  });
});

describe("fmtCreated", () => {
  it("combina data curta com o relativo", () => {
    const s = fmtCreated(NOW / 1000 - 3 * 86400, NOW);
    expect(s).toContain("·");
    expect(s).toContain("há 3 dias");
  });
  it("vazio quando não medido", () => {
    expect(fmtCreated(null, NOW)).toBe("");
  });
});

describe("humanBytes (unidades binárias, vírgula pt-AO)", () => {
  it("escala B/KiB/MiB/GiB", () => {
    expect(humanBytes(0)).toBe("0 B");
    expect(humanBytes(3630321)).toBe("3,5 MiB");
    expect(humanBytes(16241702)).toBe("15 MiB"); // ≥10 → sem decimal (convenção fmtBinBytes)
    expect(humanBytes(1610612736)).toBe("1,5 GiB");
  });
  it("traço quando não medido", () => {
    expect(humanBytes(null)).toBe("—");
    expect(humanBytes(undefined)).toBe("—");
  });
});
