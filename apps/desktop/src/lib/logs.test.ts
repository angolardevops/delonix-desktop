import { describe, expect, it } from "vitest";
import { BUFFER_LIMITS, capLines, filterLogLines, logFilename, LOG_SOURCES, sourceMeta, splitTimestamp } from "./logs";

describe("logs — teto de buffer", () => {
  it("mantém só as últimas `limit` linhas", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `l${i}`);
    expect(capLines(lines, 3)).toEqual(["l7", "l8", "l9"]);
  });
  it("não corta (e devolve o mesmo array) quando cabe no teto", () => {
    const lines = ["a", "b"];
    expect(capLines(lines, 5)).toBe(lines);
  });
  it("os tetos oferecidos são 1000/5000/10000", () => {
    expect([...BUFFER_LIMITS]).toEqual([1000, 5000, 10000]);
  });
});

describe("logs — filtro de pesquisa", () => {
  const lines = ["ERROR a falhou", "info ok", "WARN b", "erro minúsculo"];
  it("filtra por substring, case-insensitive", () => {
    expect(filterLogLines(lines, "err")).toEqual(["ERROR a falhou", "erro minúsculo"]);
  });
  it("pesquisa vazia devolve tudo (o mesmo array)", () => {
    expect(filterLogLines(lines, "   ")).toBe(lines);
  });
});

describe("logs — parser do carimbo --timestamps", () => {
  it("separa um carimbo RFC3339 (Z) do conteúdo", () => {
    const { ts, text } = splitTimestamp("2026-10-26T08:15:03.123456789Z LOG: ready");
    expect(ts).toBe("2026-10-26T08:15:03.123456789Z");
    expect(text).toBe("LOG: ready");
  });
  it("aceita offset numérico (+01:00)", () => {
    const { ts, text } = splitTimestamp("2026-10-26T08:15:03+01:00 arrancou");
    expect(ts).toBe("2026-10-26T08:15:03+01:00");
    expect(text).toBe("arrancou");
  });
  it("linha sem carimbo (sem --log-cri) fica intacta, ts null", () => {
    const { ts, text } = splitTimestamp("LOG: raw line without timestamp");
    expect(ts).toBeNull();
    expect(text).toBe("LOG: raw line without timestamp");
  });
});

describe("logs — metadados das origens", () => {
  it("container/pod fazem stream; vm/build/cluster não (nota honesta presente)", () => {
    expect(sourceMeta("container").streams).toBe(true);
    expect(sourceMeta("pod").streams).toBe(true);
    for (const id of ["vm", "build", "cluster"] as const) {
      const m = sourceMeta(id);
      expect(m.streams).toBe(false);
      expect(m.note && m.note.length).toBeTruthy();
    }
  });
  it("só o container oferece o toggle de timestamps", () => {
    expect(sourceMeta("container").timestamps).toBe(true);
    expect(LOG_SOURCES.filter((s) => s.timestamps).map((s) => s.id)).toEqual(["container"]);
  });
});

describe("logs — nome de ficheiro de exportação", () => {
  it("higieniza o nome do recurso e acrescenta origem + carimbo", () => {
    const name = logFilename("container", "odoo/16:weird name");
    expect(name).toMatch(/^container-odoo-16-weird-name-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.log$/);
  });
  it("cai para 'logs' quando o recurso é vazio", () => {
    expect(logFilename("pod", "")).toMatch(/^pod-logs-/);
  });
});
