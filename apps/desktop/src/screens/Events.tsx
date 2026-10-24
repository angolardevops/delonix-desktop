import { useEffect, useState } from "react";
import { useApp } from "../app/context";
import { Chip, CliHint, PageHead } from "../components/ui";
import { cmd, show } from "../lib/cli";
import type { EngineEvent } from "../lib/types";

const tone = (a: string): "bad" | "warn" | "inf" | "neu" =>
  /oom|die|error|fail/.test(a) ? "bad" : /warn|kill|stop/.test(a) ? "warn" : /start|create|pull/.test(a) ? "inf" : "neu";

export function Events() {
  const { client, history } = useApp();
  const [events, setEvents] = useState<EngineEvent[]>([]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    void client.events((e) => setEvents((p) => [e, ...p].slice(0, 500))).then((s) => (stop = s));
    return () => stop?.();
  }, [client]);

  return (
    <>
      <PageHead title="Eventos e métricas" subtitle="Eventos do engine em direto, correlacionados por segundo">
        <button className="btn" type="button" onClick={() => {
          const script = history.filter((h) => h.ok).map((h) => h.command).reverse().join("\n");
          void navigator.clipboard?.writeText(`#!/bin/sh\nset -e\n${script}\n`);
        }}>Copiar sessão como script</button>
      </PageHead>
      <div className="split">
        <div className="primary">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Hora</th><th>Origem</th><th>Tipo</th><th>Evento</th></tr></thead>
              <tbody>
                {events.map((e, i) => {
                  const sameSecond = events[i - 1]?.time === e.time || events[i + 1]?.time === e.time;
                  return (
                    <tr key={i} style={sameSecond && tone(e.action) === "bad" ? { background: "var(--hot-row)" } : undefined}>
                      <td className="mono muted">{e.time}</td>
                      <td className="mono">{e.name}</td>
                      <td><Chip tone={tone(e.action)}>{e.action}</Chip></td>
                      <td>{e.kind}{e.detail ? ` · ${e.detail}` : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="toolbar"><CliHint argv={cmd.events()} compact /></div>
        </div>
        <aside className="aside">
          <section className="section">
            <h2>Histórico de ações desta sessão</h2>
            {history.length === 0 && <span className="muted">Sem ações ainda.</span>}
            {history.map((h, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                <span className="mono muted">{h.at.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}</span>
                <Chip tone={h.ok ? "ok" : "bad"}>{h.ok ? "ok" : "falhou"}</Chip>
                <span style={{ flex: 1 }}>{h.label}</span>
              </div>
            ))}
          </section>
          <section className="section">
            <h2>Exportar</h2>
            <span className="muted" style={{ fontSize: 12 }}>Runbook em Markdown e OpenTelemetry: ver PROMPT.md §8.8.</span>
            <span className="mono muted" style={{ fontSize: 11 }}>{show(["system", "events", "-o", "json"])}</span>
          </section>
        </aside>
      </div>
    </>
  );
}
