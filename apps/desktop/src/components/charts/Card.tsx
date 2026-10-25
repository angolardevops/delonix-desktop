// Cartão de dashboard (Grafana-lite): título opcional + conteúdo, com borda e
// superfície suaves de tokens. Só aqui o Overview ganha "cartões" — o resto da
// app mantém o estilo de divisórias finas.
import type { ReactNode } from "react";

export interface CardProps {
  title?: ReactNode;
  action?: ReactNode; // canto superior direito (ex.: botão)
  children: ReactNode;
  span?: number; // nº de colunas a ocupar na grelha (grid-column: span N)
}

export function Card({ title, action, children, span }: CardProps) {
  return (
    <section
      style={{
        gridColumn: span ? `span ${span}` : undefined,
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minWidth: 0,
      }}
    >
      {(title || action) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {title && <span className="lbl">{title}</span>}
          {action && <span style={{ marginLeft: "auto" }}>{action}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

// Grelha responsiva de cartões (auto-fit); o contentor da secção de dashboard.
export function CardGrid({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 16,
        padding: "16px 24px",
      }}
    >
      {children}
    </div>
  );
}
