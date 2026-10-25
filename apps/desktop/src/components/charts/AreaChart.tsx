// Gráfico de ÁREA para tendências de séries curtas (histórico do resourceStore
// via useTrail). Uma ou mais séries num ÚNICO eixo y (nunca dois eixos). SVG
// self-contained, só tokens de tema, com crosshair + tooltip ao passar o rato.
// Acessível (role=img + aria-label com o último valor de cada série) e legenda
// quando há 2+ séries. É a versão "grande" do Sparkline (mesma linguagem).
import { useRef, useState } from "react";

export interface AreaSeries {
  key: string;
  label: string;
  color: string;
  values: number[];
}

export interface AreaChartProps {
  series: AreaSeries[];
  width?: number;
  height?: number;
  max?: number; // topo fixo do eixo (ex.: 100 para PSI); senão escala ao máximo
  format: (n: number) => string; // formatação de valores (tooltip + aria)
  ariaLabel?: string;
}

const PAD = 2;

export function AreaChart({ series, width = 240, height = 64, max, format, ariaLabel }: AreaChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const len = Math.max(0, ...series.map((s) => s.values.length));
  const dataMax = Math.max(1, max ?? Math.max(1, ...series.flatMap((s) => s.values)));
  const stepX = len > 1 ? width / (len - 1) : 0;
  const y = (v: number) => PAD + (1 - v / dataMax) * (height - PAD * 2);
  const x = (i: number) => i * stepX;

  const multi = series.length > 1;
  const ariaParts = series.map((s) => `${s.label} ${s.values.length ? format(s.values[s.values.length - 1]) : "—"}`);
  const label = ariaLabel ?? ariaParts.join(", ");

  if (len < 2) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center" }} aria-label={label} role="img">
        <span className="muted" style={{ fontSize: 12 }}>a recolher tendência…</span>
      </div>
    );
  }

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rel = ((e.clientX - rect.left) / rect.width) * width;
    setHover(Math.max(0, Math.min(len - 1, Math.round(rel / stepX))));
  };

  return (
    <div
      ref={wrapRef}
      style={{ position: "relative", width: "100%" }}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label} style={{ display: "block", overflow: "visible" }}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.key} id={`dlx-area-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        {series.map((s, i) => {
          if (s.values.length < 2) return null;
          const line = s.values.map((v, j) => `${j === 0 ? "M" : "L"}${x(j).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
          const area = `${line} L${x(s.values.length - 1).toFixed(1)},${height - PAD} L0,${height - PAD} Z`;
          return (
            <g key={s.key}>
              <path d={area} fill={`url(#dlx-area-${i})`} />
              <path d={line} fill="none" stroke={s.color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
        {hover != null && (
          <line x1={x(hover)} y1={0} x2={x(hover)} y2={height} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        )}
        {hover != null &&
          series.map((s) =>
            hover < s.values.length ? (
              <circle key={s.key} cx={x(hover)} cy={y(s.values[hover])} r={2.6} fill={s.color} stroke="var(--panel)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ) : null,
          )}
      </svg>
      {hover != null && (
        <div
          role="tooltip"
          style={{
            position: "absolute",
            top: 0,
            left: `${(hover / (len - 1)) * 100}%`,
            transform: `translateX(${hover > len / 2 ? "-105%" : "5%"})`,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 4,
            padding: "4px 8px",
            pointerEvents: "none",
            fontSize: 11,
            whiteSpace: "nowrap",
            zIndex: 2,
          }}
        >
          {series.map((s) => (
            <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
              {multi && <span style={{ color: "var(--tx2)" }}>{s.label}</span>}
              <span className="mono" style={{ color: "var(--tx)", marginLeft: "auto" }}>
                {hover < s.values.length ? format(s.values[hover]) : "—"}
              </span>
            </div>
          ))}
        </div>
      )}
      {multi && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 4 }}>
          {series.map((s) => (
            <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--tx2)" }}>
              <span style={{ width: 9, height: 2, background: s.color, display: "inline-block" }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
