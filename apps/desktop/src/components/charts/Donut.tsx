// Donut/anel por categoria — total ao centro e legenda com valor + %.
// SVG self-contained, só tokens de tema, acessível (role=img + aria-label com
// cada categoria e valor). Usado para o armazenamento por categoria (Imagens /
// Imagens de VM / Volumes / Containers).
import { donutArcs, type DonutInput } from "./geometry";
import { usePrefersReducedMotion } from "./motion";

export interface DonutProps {
  segments: DonutInput[]; // {key,label,value,color} — ordem preservada
  centerLabel?: string; // ex.: "Total"
  centerValue?: string; // total já formatado
  format: (n: number) => string; // formatação dos valores da legenda
  size?: number; // diâmetro em px (default 140)
  thickness?: number; // espessura do anel (default 18)
  ariaLabel?: string;
}

export function Donut({ segments, centerLabel, centerValue, format, size = 140, thickness = 18, ariaLabel }: DonutProps) {
  const reduce = usePrefersReducedMotion();
  const cx = size / 2;
  const cy = size / 2;
  const r = cx - thickness / 2 - 1;
  const { arcs, total } = donutArcs(segments, { cx, cy, r, gapDeg: 3 });
  const label = ariaLabel ?? (total > 0 ? arcs.map((a) => `${a.label} ${Math.round(a.pct * 100)}%`).join(", ") : "sem dados");
  const single = arcs.length === 1;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} style={{ flex: "none" }}>
        {/* Pista de fundo. */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--track)" strokeWidth={thickness} />
        {total <= 0 ? null : single ? (
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={arcs[0].color} strokeWidth={thickness} />
        ) : (
          arcs.map((a, i) => (
            <path
              key={a.key}
              d={a.d}
              fill="none"
              stroke={a.color}
              strokeWidth={thickness}
              strokeLinecap="butt"
              style={reduce ? undefined : { opacity: 0, animation: `dlx-donut-in .4s ease ${i * 0.06}s forwards` }}
            />
          ))
        )}
        {/* Total ao centro. */}
        {centerValue && (
          <text x={cx} y={cy - 2} textAnchor="middle" fontSize={size * 0.15} fontWeight={600} fill="var(--tx)">
            {centerValue}
          </text>
        )}
        {centerLabel && (
          <text x={cx} y={cy + size * 0.12} textAnchor="middle" fontSize={size * 0.085} fill="var(--mut)" style={{ textTransform: "uppercase", letterSpacing: ".06em" }}>
            {centerLabel}
          </text>
        )}
        {/* Keyframe local (self-contained); desativado por prefers-reduced-motion. */}
        <style>{"@keyframes dlx-donut-in{to{opacity:1}}"}</style>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        {segments.map((s) => {
          const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
          return (
            <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color, flex: "none" }} />
              <span style={{ color: "var(--tx2)", minWidth: 110 }}>{s.label}</span>
              <span className="mono" style={{ color: "var(--tx)" }}>{format(s.value)}</span>
              <span className="muted mono" style={{ fontSize: 11 }}>{pct}%</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
