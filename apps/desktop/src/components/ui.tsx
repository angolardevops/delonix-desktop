import { useState, type ReactNode } from "react";
import type { RunState } from "../lib/hooks";
import { Icon } from "./Icon";
import { show, type Argv } from "../lib/cli";
import { copyText } from "../lib/native";

export function Chip({ tone, children, dot }: { tone: "ok" | "warn" | "bad" | "inf" | "neu"; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`chip ${tone}`}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

export function StateChip({ state, label }: { state: RunState; label: string }) {
  const tone = state === "running" ? "ok" : state === "error" ? "bad" : "neu";
  return <Chip tone={tone} dot>{label}</Chip>;
}

export function TypeChip({ type }: { type: string }) {
  return <Chip tone={type === "container" ? "neu" : "inf"}>{type === "vm" ? "VM" : type}</Chip>;
}

// Comando CLI equivalente, com botão copiar. Aparece em toda a ação.
export function CliHint({ argv, compact }: { argv: Argv; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const text = show(argv);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      <span className="mono muted" style={{ fontSize: compact ? 11 : 12, overflow: "hidden", textOverflow: "ellipsis" }}>{text}</span>
      <button
        className="btn sm"
        type="button"
        onClick={() => {
          void copyText(text).then((ok) => {
            if (!ok) return;
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        <Icon name="copy" size={12} />
        {copied ? "Copiado" : "Copiar CLI"}
      </button>
    </span>
  );
}

export function PageHead({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="actions">{children}</div>}
    </header>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode }[] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((i) => (
        <button key={i.id} type="button" role="tab" aria-selected={i.id === value} className={`tab${i.id === value ? " on" : ""}`} onClick={() => onChange(i.id)}>
          {i.label}
        </button>
      ))}
    </div>
  );
}

// Funcionalidade desenhada mas que o engine ainda não tem. Usa a mesma
// linguagem do feature-gating: diz o estado e de que depende.
export function Planned({ what, dependsOn }: { what: string; dependsOn: string }) {
  return (
    <div className="note planned" role="note">
      <Chip tone="bad" dot>Não funciona</Chip>
      <span style={{ flex: "1 1 360px" }}>
        <b>{what}</b> ainda não está implementado no engine. Pré-visualização com dados de exemplo. Depende de: {dependsOn}.
      </span>
    </div>
  );
}

export function ErrorNote({ error }: { error: string }) {
  return (
    <div className="note" style={{ background: "var(--badb)", borderColor: "var(--bad-line)", color: "var(--bad)" }} role="alert">
      <span className="mono" style={{ fontSize: 12 }}>{error}</span>
    </div>
  );
}
