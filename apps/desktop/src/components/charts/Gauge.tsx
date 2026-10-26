// Gauge radial (arco de 270°) — valor/máximo com zonas verde/amarelo/vermelho,
// valor grande ao centro e rótulo. SVG self-contained (CSP Tauri: nada externo),
// usa só tokens do tema (correto em claro E escuro). Acessível (role=img +
// aria-label com o valor) e com animação subtil que respeita
// prefers-reduced-motion.
//
// Usado para PSI (CPU/MEM/IO) e para capacidade do nó (RAM, temperatura, swap).
import { arcPath, fraction, zoneColor, ZONES_LOAD, type Zone } from "./geometry";
import { usePrefersReducedMotion } from "./motion";

const SWEEP = 270; // varrimento do arco (graus); folga de 90° em baixo
const A0 = -135; // início (7:30), horário até +135 (4:30)

export interface GaugeProps {
  value: number | null | undefined;
  max: number;
  label: string; // ex.: "CPU", "RAM", "Temperatura"
  display?: string; // texto central (sobrepõe o % calculado), ex.: "62 °C"
  sub?: string; // linha secundária pequena por baixo do rótulo
  zones?: Zone[]; // limiares de cor; por omissão ZONES_LOAD
  size?: number; // lado em px (default 132)
  ariaLabel?: string;
}

export function Gauge({ value, max, label, display, sub, zones = ZONES_LOAD, size = 132, ariaLabel }: GaugeProps) {
  const reduce = usePrefersReducedMotion();
  const frac = fraction(value, max);
  const known = value != null && max > 0;
  const color = known ? zoneColor(frac, zones) : "var(--mut)";
  const cx = size / 2;
  const cy = size / 2;
  const stroke = Math.max(8, Math.round(size * 0.1));
  const r = cx - stroke / 2 - 2;
  const pctText = display ?? (known ? `${Math.round(frac * 100)}%` : "—");
  const label2 = ariaLabel ?? `${label}: ${known ? `${Math.round(frac * 100)}% de ${max}` : "sem dados"}`;

  // Arco completo do valor (A0..A0+SWEEP); a fração é revelada por dasharray
  // normalizado (pathLength=1) → dashoffset anima o crescimento.
  const valueArc = arcPath(cx, cy, r, A0, A0 + SWEEP);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 0 }}>
      <svg width={size} height={size * 0.82} viewBox={`0 0 ${size} ${size * 0.82}`} role="img" aria-label={label2}>
        {/* Bandas de zona no fundo (ténues), para dar contexto verde/amarelo/vermelho. */}
        {known &&
          zones.map((z, i) => {
            const from = i === 0 ? 0 : zones[i - 1].upTo;
            return (
              <path
                key={z.upTo}
                d={arcPath(cx, cy, r, A0 + from * SWEEP, A0 + z.upTo * SWEEP)}
                fill="none"
                stroke={z.color}
                strokeWidth={stroke}
                strokeLinecap="butt"
                opacity={0.18}
              />
            );
          })}
        {/* Pista base quando não há dados. */}
        {!known && <path d={valueArc} fill="none" stroke="var(--track)" strokeWidth={stroke} strokeLinecap="round" />}
        {/* Arco do valor. */}
        {known && (
          <path
            d={valueArc}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - frac}
            style={{ transition: reduce ? undefined : "stroke-dashoffset .6s ease, stroke .3s ease" }}
          />
        )}
        {/* Valor central + rótulo. */}
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize={size * 0.2} fontWeight={600} fill="var(--tx)">
          {pctText}
        </text>
        <text x={cx} y={cy + size * 0.16} textAnchor="middle" fontSize={size * 0.1} fill="var(--mut)" style={{ textTransform: "uppercase", letterSpacing: ".06em" }}>
          {label}
        </text>
      </svg>
      {sub && <span className="muted mono" style={{ fontSize: 11, marginTop: -4 }}>{sub}</span>}
    </div>
  );
}
