// Cartão de KPI (§B) — conta uma HISTÓRIA, não só um número: valor grande +
// variação (delta sobre a janela de histórico) + sparkline da própria série +
// pulso "ao vivo". Alimentado por useTrail (uma amostra por poll), por isso
// move-se em real-time à medida que o engine responde. Sem dados suficientes
// (< 2 amostras) degrada com elegância: mostra só o valor.
import type { ReactNode } from "react";
import { Sparkline } from "../Sparkline";

export interface KpiCardProps {
  label: string;
  value: ReactNode; // valor grande já formatado (ex.: "62%", "3", "1,2 MB/s")
  history: number[]; // série para sparkline + delta (ordem cronológica)
  format?: (n: number) => string; // formatação do delta (por omissão, inteiro com sinal)
  color?: string;
  sub?: ReactNode; // linha secundária pequena
  live?: boolean; // mostra o ponto pulsante "ao vivo"
  onClick?: () => void;
}

const defaultFmt = (n: number) => (n > 0 ? `+${Math.round(n)}` : `${Math.round(n)}`);

export function KpiCard({ label, value, history, format = defaultFmt, color = "var(--chart-1)", sub, live, onClick }: KpiCardProps) {
  const pts = history.filter((v) => Number.isFinite(v));
  // Delta = última amostra − primeira da janela (a "história" visível). Direção
  // neutra: subir nem sempre é bom (ex.: memória), por isso só seta + magnitude,
  // sem cor de estado.
  const delta = pts.length >= 2 ? pts[pts.length - 1] - pts[0] : null;
  const dir = delta == null || Math.abs(delta) < 1e-9 ? "flat" : delta > 0 ? "up" : "down";
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "→";

  const body = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {live && <span className="dlx-live-dot" style={{ background: color }} aria-hidden />}
        <span className="lbl" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 650, lineHeight: 1, color: "var(--tx)" }}>{value}</span>
        {delta != null && dir !== "flat" && (
          <span className="mono" style={{ fontSize: 12, color: "var(--mut)", display: "inline-flex", alignItems: "center", gap: 3, paddingBottom: 2 }} title={`Variação na janela: ${format(delta)}`}>
            <span aria-hidden style={{ fontSize: 9 }}>{arrow}</span>
            {format(Math.abs(delta))}
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8, minHeight: 20 }}>
        <span className="muted" style={{ fontSize: 11, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</span>
        <Sparkline values={pts} width={84} height={22} color={color} ariaLabel={`${label}: tendência de ${pts.length} amostras`} />
      </div>
    </>
  );

  const style: React.CSSProperties = {
    background: "var(--panel)",
    border: "1px solid var(--line)",
    borderRadius: 8,
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    minWidth: 0,
    textAlign: "left",
  };

  return onClick ? (
    <button type="button" className="kpi-card" onClick={onClick} style={{ ...style, cursor: "pointer", color: "var(--tx)" }}>
      {body}
    </button>
  ) : (
    <div className="kpi-card" style={style}>{body}</div>
  );
}

// Grelha compacta de KPIs (tiles mais pequenos que os Cards de gráfico).
export function KpiGrid({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, padding: "16px 24px 0" }}>
      {children}
    </div>
  );
}
