import { useEffect, useRef, useState } from "react";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { LazyTerminal as Terminal } from "../components/LazyTerminal";
import { CliHint, Chip, ErrorNote, Planned, StateChip, Tabs, TypeChip } from "../components/ui";
import type { ExecMode } from "../lib/client";
import { cmd, show } from "../lib/cli";
import { splitTimestamp } from "../lib/logs";
import { runState, useDebounced, useResource } from "../lib/hooks";
import { fmtBinBytes, fmtRate, latestRates, sampleFromRow, type Sample } from "../lib/metrics";
import type { DashRow, WorkloadRow } from "../lib/types";

type T = "logs" | "terminal" | "inspect" | "stats" | "snapshots";

export function WorkloadDetail({ id }: { id: string }) {
  const { client, go, act, namespace } = useApp();
  const wl = useResource(["workloads", namespace], () => client.workloads(namespace), 3000);
  const w = wl.data?.find((x) => x.name === id);
  const [tab, setTab] = useState<T>("logs");
  const [lines, setLines] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [follow, setFollow] = useState(true);
  // Timestamps por linha (só containers, e só se o container foi corrido com
  // --log-cri — senão o engine recusa a flag; ver Novo workload).
  const [timestamps, setTimestamps] = useState(false);
  const [nodeErr, setNodeErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  // Ciclo de vida pelo contrato node.v1: VMs pelo VirtualMachineService e
  // containers pelo ContainerService (decisão B — sem CLI). Pods continuam na
  // ponte CLI via `act`. `back` navega de volta após um remover bem-sucedido.
  const nodeAct = (fn: () => Promise<void>, back = false) => {
    setNodeErr(null);
    void fn()
      .then(() => (back ? go({ name: "workloads" }) : void wl.refresh()))
      .catch((e) => setNodeErr(String(e)));
  };

  useEffect(() => {
    // Logs ao vivo para containers e pods. VMs usam a consola série (`vm console`),
    // fora deste fluxo.
    if (tab !== "logs" || !w || (w.type !== "container" && w.type !== "pod")) return;
    setLines([]);
    const onLine = (l: string) => setLines((p) => [...p.slice(-1999), l]);
    let stop: (() => void) | undefined;
    if (w.type === "container") {
      // Container: stream gRPC de `ContainerService.Logs` (node.v1), não
      // `container logs -f` (CLI) — decisão B. Toggle de timestamps preservado.
      void client.containerLogs(`detail-${id}`, id, w.namespace, onLine, timestamps).then((s) => (stop = s));
    } else {
      // Pod: ainda `pod logs -f` (CLI, 1.º membro) enquanto essa fatia não migra.
      void client.stream(`detail-${id}`, cmd.podLogsFollow(id), onLine).then((s) => (stop = s));
    }
    return () => stop?.();
  }, [client, id, tab, w?.type, w?.namespace, timestamps]);

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
                ? <button className="btn" type="button" onClick={() => nodeAct(() => client.vmStop(w.name))}><Icon name="stop" />Parar</button>
                : <button className="btn" type="button" onClick={() => nodeAct(() => client.vmStart(w.name))}><Icon name="play" />Iniciar</button>}
              <button className="btn danger" type="button"
                onClick={() => { if (window.confirm(`Remover a VM ${w.name}? O disco é libertado (destruir).`)) nodeAct(() => client.vmDelete(w.name), true); }}><Icon name="trash" />Remover</button>
            </>
          ) : w.type === "container" ? (
            // Container pelo ContainerService (node.v1), sem CLI (decisão B).
            <>
              {st === "running"
                ? <button className="btn" type="button" onClick={() => nodeAct(() => client.containerStop(w.namespace, w.name))}><Icon name="stop" />Parar</button>
                : <button className="btn" type="button" onClick={() => nodeAct(() => client.containerStart(w.namespace, w.name))}><Icon name="play" />Iniciar</button>}
              <button className="btn" type="button" onClick={() => nodeAct(() => client.containerRestart(w.namespace, w.name))}><Icon name="restart" />Reiniciar</button>
              <button className="btn danger" type="button"
                onClick={() => { if (window.confirm(`Remover o container ${w.name}?`)) nodeAct(() => client.containerRemove(w.namespace, w.name), true); }}><Icon name="trash" />Remover</button>
            </>
          ) : (
            // Pods: ainda pela ponte CLI (fatia futura).
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
      {nodeErr && <div style={{ padding: "0 24px" }}><ErrorNote error={nodeErr} /></div>}
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
                {w.type === "container" && (
                  <button className="btn sm" type="button" style={{ color: timestamps ? "var(--inf)" : undefined }} onClick={() => setTimestamps((t) => !t)} title="Requer o container corrido com --log-cri (ligado por omissão em Novo workload). Sem isso, o engine recusa --timestamps.">
                    Timestamps
                  </button>
                )}
                <button className="btn sm" type="button" style={{ color: follow ? "var(--ok)" : undefined }} onClick={() => setFollow(!follow)}><span className="dot" />Seguir</button>
              </div>
              <div className="log" style={{ flex: 1, overflow: "auto", border: 0, minHeight: 360 }}>
                {w.type === "vm"
                  ? "Uma VM não expõe logs de guest ao engine — só a consola série. Abra o separador Terminal para a consola série real (apanha os logs de arranque e o login)."
                  : timestamps && w.type === "container"
                    ? shown.map((l, i) => {
                        const { ts, text } = splitTimestamp(l);
                        return (
                          <div key={i} style={{ whiteSpace: "pre-wrap" }}>
                            {ts && <span style={{ color: "var(--inf)", marginRight: 8 }}>{ts}</span>}
                            {text}
                          </div>
                        );
                      })
                    : shown.join("\n")}
                <div ref={end} />
              </div>
            </>
          )}
          {tab === "terminal" && <TerminalTab w={w} />}
          {tab === "inspect" && <Inspect w={w} />}
          {tab === "stats" && <Stats w={w} />}
          {tab === "snapshots" && <Snapshots name={w.name} />}
        </div>
        <aside className="aside">
          <section className="section">
            <h2>Equivalente na CLI</h2>
            <CliHint argv={cmd.describe(w.name)} />
            <CliHint argv={w.type === "pod" ? cmd.podLogsFollow(w.name) : cmd.containerLogs(w.name, { follow: true, timestamps: w.type === "container" && timestamps })} />
          </section>
          <section className="section">
            <h2>Estado</h2>
            <dl className="kv">
              <dt>Tipo</dt><dd>{w.type}</dd>
              <dt>Estado</dt><dd>{w.status}</dd>
              <dt>Info</dt><dd className="mono">{w.info}</dd>
              <dt>Namespace</dt><dd className="mono">{w.namespace}</dd>
            </dl>
            {w.type === "vm" && <VmState name={w.name} />}
            {/\(137\)/.test(w.status) && <Chip tone="bad">Terminou por falta de memória (OOM)</Chip>}
          </section>
        </aside>
      </div>
    </>
  );
}

// Separador Terminal (§6): distingue CLARAMENTE as ligações interativas.
// - Container: duas abas — "Shell novo (exec)" abre um shell NOVO dentro do
//   container; "Attach (processo principal)" re-liga à saída do PID 1 (só
//   saída no 5.1.1; fechar NÃO mata o workload).
// - Pod: um shell num membro (`pod exec`).
// - VM: a CONSOLA SÉRIE real (`vm console`), rotulada como tal — não é um shell
//   autenticado; o detach é Ctrl-D e não desliga a VM.
function TerminalTab({ w }: { w: WorkloadRow }) {
  const [sub, setSub] = useState<ExecMode>(w.type === "vm" ? "vm-console" : w.type === "pod" ? "pod-exec" : "container-exec");
  const st = runState(w.status);
  const running = st === "running";

  if (w.type === "container") {
    const argv = sub === "container-attach" ? cmd.attach(w.name) : cmd.exec(w.name);
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div className="toolbar" style={{ background: "var(--panel)", gap: 8, flexWrap: "wrap" }}>
          <Chip tone="inf" title="Terminal DENTRO deste container — não é um shell do host">Sessão no container {w.name}</Chip>
          <div role="tablist" aria-label="Tipo de sessão" style={{ display: "inline-flex", gap: 4 }}>
            <button type="button" role="tab" aria-selected={sub === "container-exec"} className={`btn sm${sub === "container-exec" ? " pri" : ""}`} onClick={() => setSub("container-exec")}>Shell novo (exec)</button>
            <button type="button" role="tab" aria-selected={sub === "container-attach"} className={`btn sm${sub === "container-attach" ? " pri" : ""}`} onClick={() => setSub("container-attach")}>Attach (processo principal)</button>
          </div>
          <span className="muted" style={{ fontSize: 12 }}>
            {sub === "container-attach"
              ? "Liga-se à saída do processo principal (só saída). Fechar NÃO mata o container."
              : "Abre um shell novo DENTRO do container (bash→sh) — não é a consola do host."}
          </span>
          <span className="mono muted" style={{ marginLeft: "auto", fontSize: 12 }}>{show(argv)}</span>
        </div>
        {running
          ? <div style={{ flex: 1, minHeight: 0 }}><Terminal key={`${w.name}-${sub}`} name={w.name} mode={sub} /></div>
          : <p className="muted" style={{ padding: 24 }}>O container está parado. Inicie-o para abrir {sub === "container-attach" ? "o attach à saída" : "um shell"}.</p>}
      </div>
    );
  }

  if (w.type === "pod") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div className="toolbar" style={{ background: "var(--panel)", gap: 8, flexWrap: "wrap" }}>
          <Chip tone="inf" title="Terminal DENTRO de um membro do pod — não é um shell do host">Sessão no pod {w.name}</Chip>
          <span className="muted" style={{ fontSize: 12 }}>Abre `sh` no 1.º membro (o COMMAND é obrigatório no engine) — não é a consola do host.</span>
          <span className="mono muted" style={{ marginLeft: "auto", fontSize: 12 }}>{show(cmd.podExec(w.name))}</span>
        </div>
        {running
          ? <div style={{ flex: 1, minHeight: 0 }}><Terminal key={`${w.name}-pod`} name={w.name} mode="pod-exec" /></div>
          : <p className="muted" style={{ padding: 24 }}>O pod está parado. Inicie-o para abrir um shell num membro.</p>}
      </div>
    );
  }

  // VM: consola SÉRIE real. Funciona mesmo sem IP (logs de arranque, login).
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div className="toolbar" style={{ background: "var(--panel)", gap: 8, flexWrap: "wrap" }}>
        <Chip tone="inf" title="Consola série DESTA VM — não é a consola do host">Sessão na VM {w.name}</Chip>
        <Chip tone="warn">Consola série — não é um shell autenticado</Chip>
        <span className="muted" style={{ fontSize: 12 }}>Terminal série da VM (arranque/login), não a consola do host. Ctrl-D sai sem desligar a VM.</span>
        <span className="mono muted" style={{ marginLeft: "auto", fontSize: 12 }}>{show(cmd.vmConsole(w.name))}</span>
      </div>
      {running
        ? <div style={{ flex: 1, minHeight: 0 }}><Terminal key={`${w.name}-console`} name={w.name} mode="vm-console" /></div>
        : <p className="muted" style={{ padding: 24 }}>A VM está parada. Inicie-a para abrir a consola série (apanha os logs de arranque).</p>}
    </div>
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

// Aba "Inspecionar": containers pelo contrato node.v1 (REST GetContainer),
// VMs/pods pela ponte CLI (`workload describe`), que o contrato ainda não cobre
// para esses tipos. O container mostra o JSON cru do contrato (meta/spec/status);
// um node-api em baixo ou um 501 DX-6001 aparecem como texto de erro na própria aba.
function Inspect({ w }: { w: WorkloadRow }) {
  const { client } = useApp();
  const [out, setOut] = useState("A ler…");
  useEffect(() => {
    let alive = true;
    const show = (s: string) => { if (alive) setOut(s); };
    if (w.type === "container") {
      client.containerInspect(w.namespace || "default", w.name)
        .then((j) => show(JSON.stringify(j, null, 2)))
        .catch((e) => show(String(e)));
    } else {
      void client.run(cmd.describe(w.name), false).then((r) => show(r.ok ? r.stdout : r.stderr || "sem saída (duplo local)"));
    }
    return () => { alive = false; };
  }, [client, w.type, w.name, w.namespace]);
  return <pre className="log" style={{ flex: 1, border: 0, margin: 0 }}>{out}</pre>;
}

// Leitura RICA de uma VM pelo socket node.v1 (§5): `vmGet` (node_vm_get) traz
// IP/imagem/provider/vcpus/memória/fase que a row da CLI (`workload ls`) não
// tem. Chave de store `["vm", name]` (partilha com quem mais a peça). Distingue
// node-api EM BAIXO ("inicie `delonix serve node-api`") de VM não encontrada —
// e NÃO duplica o ciclo de vida (os botões Parar/Iniciar/Remover ficam no topo).
function VmState({ name }: { name: string }) {
  const { client } = useApp();
  const vm = useResource(["vm", name], () => client.vmGet(name), 0);
  const d = vm.data;

  if (vm.error) {
    // A mensagem do core já aponta o comando quando o socket está em baixo.
    const down = /node-api/i.test(vm.error);
    return (
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        {down
          ? <>Detalhe rico da VM indisponível — inicie <span className="mono">delonix serve node-api</span>.</>
          : <>Não foi possível ler a VM pelo node-api: {vm.error}</>}
      </p>
    );
  }
  if (!d) return <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>A ler a VM…</p>;

  // "VIRTUAL_MACHINE_PHASE_RUNNING" → "Running".
  const phase = d.phase.replace(/^VIRTUAL_MACHINE_PHASE_/, "").toLowerCase().replace(/(^|_)(\w)/g, (_, _s, c) => c.toUpperCase());
  const ips = d.ipAddresses.length ? d.ipAddresses.join(", ") : "—";

  return (
    <dl className="kv" style={{ marginTop: 8 }}>
      <dt>Fase</dt><dd className="mono">{phase || "—"}</dd>
      <dt>Provider</dt><dd className="mono">{d.provider || "—"}</dd>
      <dt>Imagem</dt><dd className="mono" style={{ wordBreak: "break-all" }}>{d.image || "—"}</dd>
      <dt>vCPUs</dt><dd className="mono">{d.vcpus || "—"}</dd>
      <dt>Memória</dt><dd className="mono">{d.memoryBytes ? fmtBinBytes(d.memoryBytes) : "—"}</dd>
      <dt>IP{d.ipPredicted ? " (previsto)" : ""}</dt><dd className="mono">{ips}</dd>
    </dl>
  );
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
