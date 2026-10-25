// Primitivas GEOMÉTRICAS puras para os charts SVG (§B — dashboard gráfico).
//
// Sem React, sem DOM: só matemática de arcos e segmentos, testável em Node
// (ver geometry.test.ts). Os componentes Gauge/Donut consomem estas funções.
//
// Convenção de ÂNGULOS: graus, 0° = topo (12 h), a CRESCER no sentido horário.
// `polar` já desloca -90° para que 0 caia no topo; o flag de varrimento dos
// arcos SVG (sweep=1) coincide com este sentido horário (eixo y para baixo).

export interface Point {
  x: number;
  y: number;
}

// Ponto na circunferência (cx,cy,r) ao ângulo dado (0°=topo, horário).
export function polar(cx: number, cy: number, r: number, angleDeg: number): Point {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

// Caminho SVG de um ARCO traçado (para usar com stroke), de a0 a a1 (horário,
// a1 > a0). Varrimentos >= 360° são limitados a 359,99° (um traço fechado não
// desenha; quem quer círculo inteiro usa <circle>).
export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  let sweep = a1 - a0;
  if (sweep >= 359.99) sweep = 359.99;
  const end = a0 + sweep;
  const p0 = polar(cx, cy, r, a0);
  const p1 = polar(cx, cy, r, end);
  const large = sweep > 180 ? 1 : 0;
  return `M ${p0.x.toFixed(3)} ${p0.y.toFixed(3)} A ${r} ${r} 0 ${large} 1 ${p1.x.toFixed(3)} ${p1.y.toFixed(3)}`;
}

// Fração 0..1 de um valor contra o seu máximo (defensiva: max<=0 → 0).
export function fraction(value: number | null | undefined, max: number | null | undefined): number {
  if (value == null || max == null || max <= 0) return 0;
  const f = value / max;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

// --- Zonas de cor (verde/amarelo/vermelho) por limiar -----------------------
// Cada zona cobre de `from` (exclusivo do anterior) até `upTo` (fração 0..1).
export interface Zone {
  upTo: number; // fim da zona, fração 0..1
  color: string; // token de tema
}

// Zonas por omissão para "quanto MENOS melhor" (uso/pressão): verde até 60%,
// amarelo até 85%, vermelho acima. Thresholds afináveis por chamada.
export const ZONES_LOAD: Zone[] = [
  { upTo: 0.6, color: "var(--bar-ok)" },
  { upTo: 0.85, color: "var(--bar-warn)" },
  { upTo: 1, color: "var(--bar-bad)" },
];

// Zonas de PSI (pressão): avg em %, verde < 10, amarelo < 30, vermelho acima.
// Expressas como fração do máximo (100%).
export const ZONES_PSI: Zone[] = [
  { upTo: 0.1, color: "var(--bar-ok)" },
  { upTo: 0.3, color: "var(--bar-warn)" },
  { upTo: 1, color: "var(--bar-bad)" },
];

// Cor da zona em que cai a fração (a primeira cujo `upTo` a cobre).
export function zoneColor(frac: number, zones: Zone[] = ZONES_LOAD): string {
  for (const z of zones) if (frac <= z.upTo) return z.color;
  return zones[zones.length - 1]?.color ?? "var(--bar-ok)";
}

// --- Segmentos do donut -----------------------------------------------------
export interface DonutInput {
  key: string;
  label: string;
  value: number;
  color: string;
}

export interface DonutArc extends DonutInput {
  d: string; // caminho SVG do arco traçado
  pct: number; // fração 0..1 do total
}

export interface DonutLayout {
  cx: number;
  cy: number;
  r: number; // raio da LINHA central do traço
  gapDeg?: number; // folga angular entre segmentos (0 se < 2 segmentos)
}

// Decompõe os segmentos (value>0) em arcos traçados ao longo de 360°, com uma
// folga `gapDeg` entre cada um. Devolve também `total` e `pct` por segmento.
// Ordem preservada (estável entre amostras). Segmentos a zero são omitidos.
export function donutArcs(
  input: DonutInput[],
  layout: DonutLayout,
): { arcs: DonutArc[]; total: number } {
  const { cx, cy, r } = layout;
  const segs = input.filter((s) => s.value > 0);
  const total = segs.reduce((a, s) => a + s.value, 0);
  if (total <= 0) return { arcs: [], total: 0 };
  const gap = segs.length < 2 ? 0 : layout.gapDeg ?? 2;
  const available = 360 - gap * segs.length;
  const arcs: DonutArc[] = [];
  let cursor = 0;
  for (const s of segs) {
    const pct = s.value / total;
    const sweep = pct * available;
    arcs.push({ ...s, pct, d: arcPath(cx, cy, r, cursor, cursor + sweep) });
    cursor += sweep + gap;
  }
  return { arcs, total };
}
