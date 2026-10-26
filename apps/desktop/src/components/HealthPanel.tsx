// Secção 1 do Dashboard SRE (§B): ALERTAS / SAÚDE acionáveis.
//
// Junta três fontes numa lista única ordenada por gravidade (blocking primeiro):
//  - `advice[]` de `system resources` (conselhos DLX-RES-NNN com `action`),
//  - o `bottleneck` do nó (gargalo agora, se houver),
//  - `problems[]` do dashboard (alertas já formatados pelo engine),
//  - OOM detetado nos workloads (código 137) — continua a aparecer,
//  - higiene: imagens sem uso + volumes órfãos.
// Cada alerta traz uma AÇÃO (o `action` do conselho, "Ver logs", "Rever e
// limpar", etc.). Sem nada a reportar, a secção não se desenha.
import type { ReactNode } from "react";
import type { ResourceAdvice, ResourceBottleneck, ResourceSeverity, WorkloadRow } from "../lib/types";
import { Chip } from "./ui";
import { Icon } from "./Icon";

type Tone = "bad" | "warn" | "neu";

interface Alert {
  key: string;
  tone: Tone;
  badge: string;
  title: ReactNode;
  action?: string; // comando/passo (mono, secundário)
  buttons?: { label: string; pri?: boolean; onClick: () => void }[];
}

const toneOf = (s: ResourceSeverity): Tone => (s === "blocking" ? "bad" : s === "warn" ? "warn" : "neu");
const sevRank: Record<ResourceSeverity, number> = { blocking: 0, warn: 1, info: 2 };

export interface HealthPanelProps {
  advice: ResourceAdvice[];
  bottleneck: ResourceBottleneck | null;
  problems: string[];
  oom: WorkloadRow[];
  unusedImages: number;
  orphanVolumes: number;
  onOomLogs: (w: WorkloadRow) => void;
  onOomStart: (w: WorkloadRow) => void;
  onAdvice: (a: ResourceAdvice) => void;
  onCleanup: () => void;
}

export function HealthPanel({ advice, bottleneck, problems, oom, unusedImages, orphanVolumes, onOomLogs, onOomStart, onAdvice, onCleanup }: HealthPanelProps) {
  const alerts: Alert[] = [];

  // OOM — sempre crítico, no topo.
  for (const w of oom) {
    alerts.push({
      key: `oom-${w.name}`,
      tone: "bad",
      badge: "OOM",
      title: <><b>{w.name}</b> terminou com código 137 (sem memória) · {w.status}</>,
      buttons: [
        { label: "Ver logs", onClick: () => onOomLogs(w) },
        { label: "Iniciar de novo", pri: true, onClick: () => onOomStart(w) },
      ],
    });
  }

  // Gargalo do nó agora.
  if (bottleneck) {
    alerts.push({
      key: "bottleneck",
      tone: bottleneck.severity ? toneOf(bottleneck.severity) : "warn",
      badge: "Gargalo",
      title: <><b>{bottleneck.resource || "nó"}</b> — {bottleneck.detail || "sob pressão agora"}</>,
    });
  }

  // Conselhos do `system resources`, ordenados por gravidade.
  for (const a of [...advice].sort((x, y) => sevRank[x.severity] - sevRank[y.severity])) {
    alerts.push({
      key: `advice-${a.id}`,
      tone: toneOf(a.severity),
      badge: a.id || a.subject || "aviso",
      title: <><b>{a.subject}</b> — {a.finding}</>,
      action: a.action || undefined,
      buttons: a.action ? [{ label: "Como resolver", onClick: () => onAdvice(a) }] : undefined,
    });
  }

  // Problems do dashboard (texto do engine).
  for (const [i, p] of problems.entries()) {
    alerts.push({ key: `problem-${i}`, tone: "warn", badge: "Engine", title: p });
  }

  // Higiene de espaço (mantida do Overview original).
  if (unusedImages + orphanVolumes > 0) {
    alerts.push({
      key: "cleanup",
      tone: "neu",
      badge: "Espaço",
      title: `${unusedImages} imagens sem uso e ${orphanVolumes} volumes órfãos`,
      buttons: [{ label: "Rever e limpar", onClick: onCleanup }],
    });
  }

  if (alerts.length === 0) return null;

  const blocking = alerts.filter((a) => a.tone === "bad").length;

  return (
    <section aria-labelledby="sre-health" style={{ borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 24px 8px" }}>
        <Icon name="activity" size={14} />
        <h2 id="sre-health" style={{ margin: 0, fontSize: 13 }}>Saúde e alertas</h2>
        <Chip tone={blocking ? "bad" : "warn"}>{alerts.length}</Chip>
        {blocking > 0 && <span className="muted" style={{ fontSize: 12 }}>{blocking} a precisar de ação</span>}
      </div>
      {alerts.map((a) => (
        <div className="row" key={a.key}>
          <Chip tone={a.tone === "bad" ? "bad" : a.tone === "warn" ? "warn" : "neu"}>{a.badge}</Chip>
          <div style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span>{a.title}</span>
            {a.action && <span className="mono muted" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis" }}>{a.action}</span>}
          </div>
          {a.buttons?.map((b) => (
            <button key={b.label} className={`btn sm${b.pri ? " pri" : ""}`} type="button" onClick={b.onClick}>{b.label}</button>
          ))}
        </div>
      ))}
    </section>
  );
}
