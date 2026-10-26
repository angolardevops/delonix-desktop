import type { RiskLevel } from "../lib/types";
import { show, type Argv } from "../lib/cli";
import { Chip } from "./ui";

// Confirmação para ações DISRUPTIVE e DESTRUCTIVE (mesma regra do MCP do engine).
export function ConfirmDialog({ argv, label, risk, onAnswer }: { argv: Argv; label: string; risk: RiskLevel; onAnswer: (ok: boolean) => void }) {
  const destructive = risk === "DESTRUCTIVE";
  return (
    <div className="overlay" onMouseDown={() => onAnswer(false)}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label={label} style={{ maxWidth: 520 }} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onAnswer(false)}>
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Chip tone={destructive ? "bad" : "warn"}>{destructive ? "destrutiva" : "disruptiva"}</Chip>
            <b>{label}</b>
          </div>
          <p style={{ margin: 0, color: "var(--tx2)" }}>
            {destructive ? "Esta ação não se pode desfazer." : "Esta ação interrompe o workload enquanto corre."}
          </p>
          <pre className="code">{show(argv)}</pre>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "10px 20px", borderTop: "1px solid var(--line)", background: "var(--panel)" }}>
          <button className="btn" type="button" autoFocus onClick={() => onAnswer(false)}>Cancelar</button>
          <button className={`btn ${destructive ? "danger" : "pri"}`} type="button" onClick={() => onAnswer(true)}>{label}</button>
        </div>
      </div>
    </div>
  );
}
