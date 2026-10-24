import { useEffect, useRef, useState } from "react";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { CliHint, Chip, StateChip, Tabs, TypeChip } from "../components/ui";
import { cmd } from "../lib/cli";
import { runState, useResource } from "../lib/hooks";

type T = "logs" | "inspect" | "stats";

export function WorkloadDetail({ id }: { id: string }) {
  const { client, go, act } = useApp();
  const wl = useResource(() => client.workloads(), 3000);
  const w = wl.data?.find((x) => x.name === id);
  const [tab, setTab] = useState<T>("logs");
  const [lines, setLines] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [follow, setFollow] = useState(true);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (tab !== "logs" || !w || w.type !== "container") return;
    setLines([]);
    let stop: (() => void) | undefined;
    void client.stream(`detail-${id}`, cmd.logsFollow(id), (l) => setLines((p) => [...p.slice(-1999), l])).then((s) => (stop = s));
    return () => stop?.();
  }, [client, id, tab, w?.type]);

  useEffect(() => {
    if (follow) end.current?.scrollIntoView({ block: "end" });
  }, [lines, follow]);

  if (!w) return <p className="muted" style={{ padding: 24 }}>{wl.data ? `O workload ${id} já não existe.` : "A carregar…"}</p>;

  const st = runState(w.status);
  const shown = filter ? lines.filter((l) => l.toLowerCase().includes(filter.toLowerCase())) : lines;

  return (
    <>
      <header className="page-head">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12 }} className="muted">
            <button type="button" onClick={() => go({ name: "workloads" })} style={{ background: "none", border: 0, padding: 0, color: "var(--inf)", cursor: "pointer" }}>Workloads</button> / {w.name}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1>{w.name}</h1>
            <StateChip state={st} label={w.status} />
            <TypeChip type={w.type} />
          </div>
          <span className="mono muted" style={{ fontSize: 12 }}>{w.info} · namespace {w.namespace}</span>
        </div>
        <div className="actions">
          {st === "running"
            ? <button className="btn" type="button" onClick={() => void act(cmd.stop(w), `Parar ${w.name}`)}><Icon name="stop" />Parar</button>
            : <button className="btn" type="button" onClick={() => void act(cmd.start(w), `Iniciar ${w.name}`)}><Icon name="play" />Iniciar</button>}
          <button className="btn" type="button" onClick={() => void act(cmd.restart(w), `Reiniciar ${w.name}`)}><Icon name="restart" />Reiniciar</button>
          <button className="btn danger" type="button" onClick={() => void act(cmd.remove(w), `Remover ${w.name}`).then((ok) => ok && go({ name: "workloads" }))}><Icon name="trash" />Remover</button>
        </div>
      </header>
      <Tabs<T> value={tab} onChange={setTab} items={[{ id: "logs", label: "Logs" }, { id: "inspect", label: "Inspecionar" }, { id: "stats", label: "Estatísticas" }]} />
      <div className="split">
        <div className="primary" style={{ display: "flex", flexDirection: "column" }}>
          {tab === "logs" && (
            <>
              <div className="toolbar" style={{ background: "var(--panel)" }}>
                <input className="input mono" style={{ flex: "1 1 240px" }} placeholder="Pesquisar nos logs" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Pesquisar nos logs" />
                <span className="muted" style={{ fontSize: 12 }}>{shown.length} linhas</span>
                <button className="btn sm" type="button" style={{ color: follow ? "var(--ok)" : undefined }} onClick={() => setFollow(!follow)}><span className="dot" />Seguir</button>
              </div>
              <div className="log" style={{ flex: 1, overflow: "auto", border: 0, minHeight: 360 }}>
                {w.type !== "container" ? "A consola série de VMs liga-se em `delonix vm console` (ver PROMPT.md §8.3)." : shown.join("\n")}
                <div ref={end} />
              </div>
            </>
          )}
          {tab === "inspect" && <Inspect name={w.name} />}
          {tab === "stats" && <p className="muted" style={{ padding: 24 }}>Séries por workload: ler `workload.usage` (MCP) ou `delonix stats` e guardar histórico local de 15 min. Ver PROMPT.md §8.2.</p>}
        </div>
        <aside className="aside">
          <section className="section">
            <h2>Equivalente na CLI</h2>
            <CliHint argv={cmd.describe(w.name)} />
            <CliHint argv={cmd.logsFollow(w.name)} />
          </section>
          <section className="section">
            <h2>Estado</h2>
            <dl className="kv">
              <dt>Tipo</dt><dd>{w.type}</dd>
              <dt>Estado</dt><dd>{w.status}</dd>
              <dt>Info</dt><dd className="mono">{w.info}</dd>
              <dt>Namespace</dt><dd className="mono">{w.namespace}</dd>
            </dl>
            {/\(137\)/.test(w.status) && <Chip tone="bad">Terminou por falta de memória (OOM)</Chip>}
          </section>
        </aside>
      </div>
    </>
  );
}

function Inspect({ name }: { name: string }) {
  const { client } = useApp();
  const [out, setOut] = useState("A ler…");
  useEffect(() => {
    void client.run(cmd.describe(name), false).then((r) => setOut(r.ok ? r.stdout : r.stderr || "sem saída (duplo local)"));
  }, [client, name]);
  return <pre className="log" style={{ flex: 1, border: 0, margin: 0 }}>{out}</pre>;
}
