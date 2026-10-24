import { useEffect, useRef, useState } from "react";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { CliHint, Chip, Planned, StateChip, Tabs, TypeChip } from "../components/ui";
import { cmd } from "../lib/cli";
import { runState, useResource } from "../lib/hooks";
import { fmtBinBytes, fmtRate, latestRates, sampleFromRow, type Sample } from "../lib/metrics";
import type { DashRow, WorkloadRow } from "../lib/types";

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
          {tab === "stats" && <Stats w={w} />}
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

// Histórico local curto: ~60 amostras a cada 15 s ≈ 15 min.
const SAMPLE_MS = 15_000;
const MAX_SAMPLES = 60;

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 8, padding: "12px 14px", minWidth: 160 }}>
      <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div className="mono" style={{ fontSize: 20, marginTop: 4 }}>{value}</div>
      {note && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{note}</div>}
    </div>
  );
}

function Stats({ w }: { w: WorkloadRow }) {
  const { client } = useApp();
  const [hist, setHist] = useState<Sample[]>([]);
  // undefined = ainda a carregar; null = recurso sem row no dashboard.
  const [row, setRow] = useState<DashRow | null | undefined>(undefined);

  useEffect(() => {
    setHist([]);
    setRow(undefined);
    let alive = true;
    const tick = async () => {
      try {
        const d = await client.dash();
        if (!alive) return;
        const r = (d.rows ?? []).find((x) => x.name === w.name) ?? null;
        setRow(r);
        if (r) setHist((p) => [...p, sampleFromRow(r, Date.now())].slice(-MAX_SAMPLES));
      } catch {
        /* polling: ignora falha pontual */
      }
    };
    void tick();
    const t = setInterval(() => void tick(), SAMPLE_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [client, w.name]);

  // VMs: as rows não trazem cpu/mem → caminho do provider (front D) por fazer.
  if (w.type === "vm") {
    return (
      <div style={{ padding: 24 }}>
        <Planned what="Métricas de VM por recurso" dependsOn="caminho do provider (vm stats via socket, §5/D)" />
        <p className="muted" style={{ marginTop: 12 }}>
          O <span className="mono">dashboard --json</span> não preenche cpu/mem para VMs; as métricas de VM precisam do caminho do provider (CPU/memória não medida aqui).
        </p>
      </div>
    );
  }

  if (row === undefined) return <p className="muted" style={{ padding: 24 }}>A recolher amostras…</p>;
  if (row === null)
    return <p className="muted" style={{ padding: 24 }}>Sem métricas para <span className="mono">{w.name}</span> no dashboard (recurso parado ou não medível em rootless).</p>;

  const r = latestRates(hist);
  const cpu = r.cpu;
  const first = r.samples < 2;

  return (
    <div style={{ padding: 20, overflow: "auto" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <Metric
          label="CPU (% por núcleo)"
          value={cpu ? `${cpu.pctPerCore.toFixed(1).replace(".", ",")} %` : "—"}
          note={cpu ? `${cpu.cores.toFixed(2).replace(".", ",")} núcleos${cpu.pctCapacity != null ? ` · ${cpu.pctCapacity.toFixed(1).replace(".", ",")} % capacidade` : ""}` : first ? "sem dados (primeira amostra)" : "sem dados"}
        />
        <Metric
          label="Memória (atual)"
          value={fmtBinBytes(r.mem)}
          note="memory.current · sem limite por recurso"
        />
        <Metric label="IO leitura" value={fmtRate(r.ioRead)} note={first ? "sem dados (primeira amostra)" : "bytes/s (não IOPS)"} />
        <Metric label="IO escrita" value={fmtRate(r.ioWrite)} note={first ? "sem dados (primeira amostra)" : "bytes/s (não IOPS)"} />
        <Metric label="Rede rx" value={fmtRate(r.netRx)} note={first ? "sem dados (primeira amostra)" : "taxa (de contador acumulado)"} />
        <Metric label="Rede tx" value={fmtRate(r.netTx)} note={first ? "sem dados (primeira amostra)" : "taxa (de contador acumulado)"} />
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>
        {r.samples}/{MAX_SAMPLES} amostras · uma a cada {SAMPLE_MS / 1000} s (janela ~{(MAX_SAMPLES * SAMPLE_MS) / 60000} min). As taxas vêm da diferença de contadores entre as duas últimas amostras; um reinício de contador é ignorado (nunca negativo).
      </p>
    </div>
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
