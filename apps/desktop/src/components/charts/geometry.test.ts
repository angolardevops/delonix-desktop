import { describe, expect, it } from "vitest";
import { arcPath, donutArcs, fraction, polar, zoneColor, ZONES_PSI, type DonutInput } from "./geometry";

describe("polar", () => {
  it("0° fica no topo (12 h)", () => {
    const p = polar(0, 0, 10, 0);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(-10, 6);
  });
  it("90° fica à direita (3 h)", () => {
    const p = polar(0, 0, 10, 90);
    expect(p.x).toBeCloseTo(10, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });
  it("180° fica em baixo (6 h)", () => {
    const p = polar(0, 0, 10, 180);
    expect(p.y).toBeCloseTo(10, 6);
  });
});

describe("arcPath", () => {
  it("começa com M e contém um comando de arco A", () => {
    const d = arcPath(50, 50, 40, -135, 135);
    expect(d.startsWith("M")).toBe(true);
    expect(d).toContain("A 40 40 0");
  });
  it("varrimento > 180° marca large-arc-flag=1", () => {
    expect(arcPath(50, 50, 40, -135, 135)).toContain(" 1 1 "); // large=1, sweep=1
  });
  it("varrimento <= 180° marca large-arc-flag=0", () => {
    expect(arcPath(50, 50, 40, 0, 90)).toContain(" 0 1 ");
  });
  it("limita varrimentos >= 360° (não fecha o traço)", () => {
    // 0..360 seria um ponto coincidente; limita a 359,99 → ainda desenha.
    const d = arcPath(50, 50, 40, 0, 360);
    const end = polar(50, 50, 40, 359.99);
    expect(d).toContain(`${end.x.toFixed(3)} ${end.y.toFixed(3)}`);
  });
});

describe("fraction", () => {
  it("razão simples", () => expect(fraction(50, 200)).toBeCloseTo(0.25, 6));
  it("limita a [0,1]", () => {
    expect(fraction(300, 200)).toBe(1);
    expect(fraction(-5, 200)).toBe(0);
  });
  it("max<=0 ou nulos → 0", () => {
    expect(fraction(5, 0)).toBe(0);
    expect(fraction(null, 10)).toBe(0);
    expect(fraction(5, null)).toBe(0);
  });
});

describe("zoneColor (PSI)", () => {
  it("abaixo de 10% → verde", () => expect(zoneColor(0.05, ZONES_PSI)).toBe("var(--bar-ok)"));
  it("entre 10% e 30% → amarelo", () => expect(zoneColor(0.2, ZONES_PSI)).toBe("var(--bar-warn)"));
  it("acima de 30% → vermelho", () => expect(zoneColor(0.6, ZONES_PSI)).toBe("var(--bar-bad)"));
  it("no limiar (0.1) ainda é verde (<=)", () => expect(zoneColor(0.1, ZONES_PSI)).toBe("var(--bar-ok)"));
});

describe("donutArcs", () => {
  const segs: DonutInput[] = [
    { key: "a", label: "A", value: 30, color: "c1" },
    { key: "b", label: "B", value: 10, color: "c2" },
    { key: "c", label: "C", value: 0, color: "c3" }, // zero → omitido
  ];
  const layout = { cx: 70, cy: 70, r: 60, gapDeg: 2 };

  it("ignora segmentos a zero e soma o total dos restantes", () => {
    const { arcs, total } = donutArcs(segs, layout);
    expect(total).toBe(40);
    expect(arcs.map((a) => a.key)).toEqual(["a", "b"]);
  });

  it("pct por segmento soma 1", () => {
    const { arcs } = donutArcs(segs, layout);
    expect(arcs.reduce((s, a) => s + a.pct, 0)).toBeCloseTo(1, 6);
    expect(arcs[0].pct).toBeCloseTo(0.75, 6);
  });

  it("varrimentos + folgas ocupam 360°", () => {
    const { arcs } = donutArcs(segs, layout);
    const n = arcs.length;
    const available = 360 - layout.gapDeg * n;
    const sweeps = arcs.reduce((s, a) => s + a.pct * available, 0);
    expect(sweeps + layout.gapDeg * n).toBeCloseTo(360, 6);
  });

  it("total zero → sem arcos", () => {
    expect(donutArcs([{ key: "z", label: "Z", value: 0, color: "c" }], layout)).toEqual({ arcs: [], total: 0 });
  });

  it("um único segmento → sem folga (gap=0)", () => {
    const { arcs } = donutArcs([{ key: "a", label: "A", value: 5, color: "c1" }], layout);
    expect(arcs).toHaveLength(1);
    expect(arcs[0].pct).toBe(1);
  });
});
