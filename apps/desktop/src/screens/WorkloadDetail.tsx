import { useEffect, useRef, useState } from "react";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { LazyTerminal as Terminal } from "../components/LazyTerminal";
import { CliHint, Chip, ErrorNote, Planned, StateChip, Tabs, TypeChip } from "../components/ui";
import { cmd } from "../lib/cli";
import { runState, useDebounced, useResource } from "../lib/hooks";
import { fmtBinBytes, fmtRate, latestRates, sampleFromRow, type Sample } from "../lib/metrics";
import type { DashRow, WorkloadRow } from "../lib/types";

type T = "logs" | "terminal" | "inspect" | "stats" | "snapshots";

export function WorkloadDetail({ id }: { id: string }) {
  const { client, go, act } = useApp();
  const wl = useResource("workloads", () => client.workloads(), 3000);
  const w = wl.data?.find((x) => x.name === id);
  const [tab, setTab] = useState<T>("logs");
  const [lines, setLines] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [follow, setFollow] = useState(true);
  const [vmErr, setVmErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  // Ciclo de vida de VM pelo socket node.v1 (§5): ao contrário dos containers
  // (que passam pela ponte CLI via `act`), as ações de VM chamam o
  // VirtualMachineService. `back` navega de volta após um remover bem-sucedido.
  const vmAct = (fn: () => Promise<void>, back = false) => {
    setVmErr(null);
    void fn()
      .then(() => (back ? go({ name: "workloads" }) : void wl.refresh()))
      .catch((e) => setVmErr(String(e)));
  };

  useEffect(() => {
    // Logs ao vivo para containers (`container logs -f`) e pods (`pod logs -f`,
    // 1.º membro). VMs usam a consola série (`vm console`), fora deste fluxo.
    if (tab !== "logs" || !w || (w.type !== "container" && w.type !== "pod")) return;
    setLines([]);
    const argv = w.type === "pod" ? cmd.podLogsFollow(id) : cmd.logsFollow(id);
    let stop: (() => void) | undefined;
    void client.stream(`detail-${id}`, argv, (l) => setLines((p) => [...p.slice(-1999), l])).then((s) => (stop = s));
    return () => stop?.();
  }, [client, id, tab, w?.type]);

  useEffect(() => {
    if (follow) end.current?.scrollIntoView({ block: "end" });
  }, [lines, follow]);

  if (!w) return <p className="muted" style={{ padding: 24 }}>{wl.data ? `O workload ${id} já não existe.` : "A carregar…"}</p>;

  const st = runState(w.status);
  // O filtro de logs varre até 2000 linhas; debounce evita refiltrar a cada tecla.
  const debouncedFilter = useDebounced(filter, 220);
  const shown = debouncedFilter ? lines.filter((l) => l.toLowerCase().includes(debouncedFilter.toLowerCase())) : lines;

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
          {w.type === "vm" ? (
            <>
              {st === "running"
                ? <button className="btn" type="button" onClick={() => vmAct(() => client.vmStop(w.name))}><Icon name="stop" />Parar</button>
                : <button className="btn" type="button" onClick={() => vmAct(() => client.vmStart(w.name))}><Icon name="play" />Iniciar</button>}
              <button className="btn danger" type="button"
                onClick={() => { if (window.confirm(`Remover a VM ${w.name}? O disco é libertado (destruir).`)) vmAct(() => client.vmDelete(w.name), true); }}><Icon name="trash" />Remover</button>
            </>
          ) : (
            <>
              {st === "running"
                ? <button className="btn" type="button" onClick={() => void act(cmd.stop(w), `Parar ${w.name}`)}><Icon name="stop" />Parar</button>
                : <button className="btn" type="button" onClick={() => void act(cmd.start(w), `Iniciar ${w.name}`)}><Icon name="play" />Iniciar</button>}
              <button className="btn" type="button" onClick={() => void act(cmd.restart(w), `Reiniciar ${w.name}`)}><Icon name="restart" />Reiniciar</button>
              <button className="btn danger" type="button" onClick={() => void act(cmd.remove(w), `Remover ${w.name}`).then((ok) => ok && go({ name: "workloads" }))}><Icon name="trash" />Remover</button>
            </>
          )}
        </div>
      </header>
      {vmErr && <div style={{ padding: "0 24px" }}><ErrorNote error={vmErr} /></div>}
      <Tabs<T> value={tab} onChange={setTab} items={[
        { id: "logs", label: "Logs" }, { id: "terminal", label: "Terminal" }, { id: "inspect", label: "Inspecionar" }, { id: "stats", label: "Estatísticas" },
        ...(w.type === "vm" ? [{ id: "snapshots" as T, label: "Snapshots" }] : []),
      ]} />
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
                {w.type === "vm" ? "A consola série de VMs liga-se em `delonix vm console` (ver PROMPT.md §8.3)." : shown.join("\n")}
                <div ref={end} />
              </div>
            </>
          )}
          {tab === "terminal" && (
            w.type === "vm"
              ? <p className="muted" style={{ padding: 24 }}>A consola de VM usa `delonix vm console` (ver PROMPT.md §8.3).</p>
              : w.type === "pod"
                ? <p className="muted" style={{ padding: 24 }}>Um shell num membro do pod abre-se por `delonix pod exec {w.name} -- sh` (ver PROMPT.md §8.4).</p>
                : <Terminal key={w.name} name={w.name} />
          )}
          {tab === "inspect" && <Inspect name={w.name} />}
          {tab === "stats" && <Stats w={w} />}
          {tab === "snapshots" && <Snapshots name={w.name} />}
        </div>
        <aside className="aside">
          <section className="section">
            <h2>Equivalente na CLI</h2>
            <CliHint argv={cmd.describe(w.name)} />
            <CliHint argv={w.type === "pod" ? cmd.podLogsFollow(w.name) : cmd.logsFollow(w.name)} />
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

// Painel de snapshots de VM pelo socket node.v1 (§5): listar / criar / restaurar
// via VirtualMachineService (ListSnapshots/CreateSnapshot/RestoreSnapshot).
function Snapshots({ name }: { name: string }) {
  const { client } = useApp();
  const snaps = useResource(["vm-snapshots", name], () => client.vmSnapshotList(name), 0);
  const [snapName, setSnapName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = (fn: () => Promise<void>) => {
    setErr(null);
    setBusy(true);
    void fn()
      .then(() => snaps.refresh())
      .catch((e) => setErr(String(e)))
      .finally(() => setBusy(false));
  };

  const list = snaps.data ?? [];

  return (
    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14, overflow: "auto" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input className="input mono" style={{ flex: "1 1 220px" }} placeholder="Nome do snapshot (ex.: pre-update)" value={snapName}
          onChange={(e) => setSnapName(e.target.value)} aria-label="Nome do snapshot" />
        <button className="btn pri" type="button" disabled={busy || !snapName.trim()}
          onClick={() => run(async () => { await client.vmSnapshotCreate(name, snapName.trim()); setSnapName(""); })}>Criar snapshot</button>
      </div>
      {err && <ErrorNote error={err} />}
      {/* snaps.error distingue "socket em baixo" de "sem snapshots". */}
      {snaps.error ? <ErrorNote error={snaps.error} />
        : list.length === 0 ? <p className="muted">Sem snapshots. Criar um captura o estado atual da VM.</p>
          : (
            <table className="table">
              <thead><tr><th>Nome</th><th>Memória</th><th>Estado na captura</th><th /></tr></thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.name}>
                    <td className="mono">{s.name}</td>
                    <td>{s.includesMemory ? <Chip tone="inf">com memória</Chip> : <Chip tone="neu">só disco</Chip>}</td>
                    <td className="mono muted">{s.state || "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn sm" type="button" disabled={busy}
                        onClick={() => { if (window.confirm(`Restaurar ${name} para o snapshot ${s.name}?`)) run(() => client.vmSnapshotRestore(name, s.name)); }}>Restaurar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      <p className="muted" style={{ fontSize: 12 }}>
        Snapshots pelo contrato de socket <span className="mono">delonix.node.v1</span> (requer <span className="mono">delonix serve node-api</span>).
      </p>
    </div>
  );
}
