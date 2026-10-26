// Sparkline minúsculo e reutilizável (§B) — tendência de uma série curta de
// métricas sem dependências de gráficos. SVG inline, escalado ao min/max da
// própria série; usa tokens do tema (correto em claro E escuro). Com menos de 2
// pontos não há tendência: mostra um travessão discreto.
import { smoothPath } from "./charts/geometry";

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  ariaLabel?: string;
}

export function Sparkline({ values, width = 72, height = 20, color = "var(--chart-1)", ariaLabel }: SparklineProps) {
  const pts = values.filter((v) => Number.isFinite(v));
  if (pts.length < 2) {
    return <span className="muted" aria-label={ariaLabel} style={{ fontSize: 12 }}>—</span>;
  }
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const stepX = width / (pts.length - 1);
  // y invertido (SVG cresce para baixo); 1px de margem para o traço não cortar.
  const y = (v: number) => height - 1 - ((v - min) / span) * (height - 2);
  // Linha suave (mesma linguagem do AreaChart): tendência contínua, não retas.
  const line = smoothPath(pts.map((v, i) => ({ x: i * stepX, y: y(v) })), 0.5);
  const area = `${line} L${width.toFixed(1)},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} style={{ display: "block", overflow: "visible" }}>
      <path d={area} fill={color} opacity={0.14} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={width} cy={y(pts[pts.length - 1])} r={1.8} fill={color} />
    </svg>
  );
}
