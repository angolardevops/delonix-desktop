import { memo, useEffect, useState, type ComponentType } from "react";
import { FixedSizeList as RWList, type FixedSizeListProps, type ListChildComponentProps } from "react-window";

// react-window expõe FixedSizeList como class component; os @types colidem com
// o @types/react 18.3 (erro "refs missing") em JSX. O cast para ComponentType
// resolve sem alterar o comportamento em runtime.
const VList = RWList as unknown as ComponentType<FixedSizeListProps<EngineEvent[]>>;
import { useApp } from "../app/context";
import { Chip, CliHint, PageHead } from "../components/ui";
import { useElementSize } from "../lib/hooks";
import { cmd, show } from "../lib/cli";
import type { EngineEvent } from "../lib/types";

const tone = (a: string): "bad" | "warn" | "inf" | "neu" =>
  /oom|die|error|fail/.test(a) ? "bad" : /warn|kill|stop/.test(a) ? "warn" : /start|create|pull/.test(a) ? "inf" : "neu";

const GRID = "90px 160px 120px 1fr";
const ROW_H = 30;

// Uma linha virtualizada. Memoizada: o react-window só monta as ~N linhas
// visíveis, por isso um evento novo não re-renderiza as 500 — só a janela.
const EventRow = memo(function EventRow({ index, style, data }: ListChildComponentProps<EngineEvent[]>) {
  const events = data;
  const e = events[index];
  const sameSecond = events[index - 1]?.time === e.time || events[index + 1]?.time === e.time;
  const hot = sameSecond && tone(e.action) === "bad";
  return (
    <div
      style={{ ...style, display: "grid", gridTemplateColumns: GRID, alignItems: "center", gap: 8, padding: "0 16px", fontSize: 13, borderBottom: "1px solid var(--line2)", background: hot ? "var(--hot-row)" : undefined }}
    >
      <span className="mono muted">{e.time}</span>
      <span className="mono dt-trunc">{e.name}</span>
      <span><Chip tone={tone(e.action)}>{e.action}</Chip></span>
      <span className="dt-trunc">{e.kind}{e.detail ? ` · ${e.detail}` : ""}</span>
    </div>
  );
});

export function Events() {
  const { client, history } = useApp();
  const [events, setEvents] = useState<EngineEvent[]>([]);
  const [listRef, size] = useElementSize<HTMLDivElement>();

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
        <div className="primary" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          {/* Cabeçalho fixo + corpo virtualizado: só as linhas visíveis vão ao
              DOM, por isso um fluxo de 500 eventos não re-renderiza tudo. */}
          <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 8, padding: "8px 16px", borderBottom: "1px solid var(--line)", fontSize: 12, fontWeight: 600, color: "var(--mut)" }}>
            <span>Hora</span><span>Origem</span><span>Tipo</span><span>Evento</span>
          </div>
          <div ref={listRef} style={{ flex: 1, minHeight: 200 }}>
            {events.length === 0 ? (
              <p className="muted" style={{ padding: 16, margin: 0 }}>Sem eventos ainda — ações no engine aparecem aqui em direto.</p>
            ) : size.height > 0 ? (
              <VList
                height={size.height}
                width={size.width || "100%"}
                itemCount={events.length}
                itemSize={ROW_H}
                itemData={events}
                overscanCount={8}
              >
                {EventRow}
              </VList>
            ) : null}
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
