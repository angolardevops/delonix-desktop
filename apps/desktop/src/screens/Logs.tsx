import { useEffect, useRef, useState } from "react";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { Select } from "../components/Select";
import { Chip, CliHint, ErrorNote, PageHead, Tabs } from "../components/ui";
import { cmd, show } from "../lib/cli";
import { saveTextViaDialog } from "../lib/fsx";
import { useDebounced, useResource } from "../lib/hooks";
import {
  BUFFER_LIMITS, capLines, filterLogLines, LOG_SOURCES, logFilename, sourceMeta, splitTimestamp, type BufferLimit, type LogSource,
} from "../lib/logs";
import { copyText, nativeDialogsAvailable } from "../lib/native";

// Explorador de LOGS unificado (§7). Separa visualmente LOGS (abaixo) de
// EVENTOS de lifecycle (reaproveita `system events`) em duas abas. As origens
// são HONESTAS: container/pod fazem stream ao vivo; VM não tem logs de guest
// (só consola série); build mostra-se ao vivo na tela Construir; pods de cluster
// vêm por `cluster kubectl logs` (instantâneo).
export function Logs() {
  const [tab, setTab] = useState<"logs" | "events">("logs");
  return (
    <>
      <PageHead title="Logs" subtitle="Explorador unificado — logs por recurso e eventos de lifecycle do engine" />
      <Tabs<"logs" | "events">
        value={tab}
        onChange={setTab}
        items={[{ id: "logs", label: "Logs" }, { id: "events", label: "Eventos (lifecycle)" }]}
      />
      {tab === "logs" ? <LogsExplorer /> : <EventsExplorer />}
    </>
  );
}

// Barra de exportação partilhada: save-dialog nativo sob Tauri; cópia para o
// clipboard no duplo local (sem diálogos). Devolve o texto completo (não o
// filtrado) para o utilizador ficar com o log inteiro.
function useExport() {
  const { toast } = useApp();
  return async (text: string, filename: string) => {
    if (!text.trim()) {
      toast("Nada para exportar.", false);
      return;
    }
    try {
      if (nativeDialogsAvailable()) {
        const path = await saveTextViaDialog(text, {
          title: "Exportar log",
          defaultPath: filename,
          filters: [{ name: "Log", extensions: ["log", "txt"] }, { name: "Todos os ficheiros", extensions: ["*"] }],
        });
        if (path) toast(`Log gravado em ${path}`);
      } else if (await copyText(text)) {
        toast("Log copiado para o clipboard (sem diálogos fora da app).");
      } else {
        toast("Não foi possível exportar.", false);
      }
    } catch (e) {
      toast(String(e), false);
    }
  };
}

type Status = "idle" | "streaming" | "paused" | "interrupted" | "snapshot";

function LogsExplorer() {
  const { client, namespace } = useApp();
  const doExport = useExport();
  const workloads = useResource(["workloads", namespace], () => client.workloads(namespace), 10000).data ?? [];

  const [source, setSource] = useState<LogSource>("container");
  const [resource, setResource] = useState("");
  const [follow, setFollow] = useState(true);
  const [timestamps, setTimestamps] = useState(false);
  const [limit, setLimit] = useState<BufferLimit>(5000);
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [gen, setGen] = useState(0); // bump → re-prova o stream (reconexão)
  const end = useRef<HTMLDivElement>(null);
  const limitRef = useRef(limit);
  limitRef.current = limit;

  const meta = sourceMeta(source);
  // Candidatos a recurso por origem (container/pod vêm dos workloads).
  const candidates =
    source === "container" ? workloads.filter((w) => w.type === "container")
      : source === "pod" ? workloads.filter((w) => w.type === "pod")
        : source === "vm" ? workloads.filter((w) => w.type === "vm")
          : [];

  // Escolhe automaticamente o 1.º recurso válido quando a origem muda ou o
  // selecionado deixa de existir.
  useEffect(() => {
    if (candidates.length && !candidates.some((c) => c.name === resource)) setResource(candidates[0].name);
    if (!candidates.length && (source === "container" || source === "pod" || source === "vm")) setResource("");
  }, [source, candidates, resource]);

  // Limpa o buffer quando muda o ASSUNTO ou o FORMATO (timestamps). Não limpa ao
  // pausar/retomar nem ao reconectar (aí mantém o que já apanhou).
  useEffect(() => setLines([]), [source, resource, timestamps]);
  // Reduz o buffer ao vivo quando o teto diminui.
  useEffect(() => setLines((p) => capLines(p, limit)), [limit]);

  // Stream ao vivo (só container/pod). Pausa = congela (pára o processo, mantém
  // o buffer). Fim do `-f` (container parou) → "interrompido" + re-prova em 4 s.
  useEffect(() => {
    if (!meta.streams || !resource) {
      setStatus("idle");
      return;
    }
    if (!follow) {
      setStatus("paused");
      return;
    }
    setStatus("streaming");
    const argv = source === "pod"
      ? cmd.podLogsFollow(resource)
      : cmd.containerLogs(resource, { follow: true, timestamps });
    let stop: (() => void) | undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void client
      .stream("logs-explorer", argv,
        (l) => setLines((p) => capLines([...p, l], limitRef.current)),
        () => {
          if (cancelled) return;
          setStatus("interrupted");
          timer = setTimeout(() => { if (!cancelled) setGen((g) => g + 1); }, 4000);
        })
      .then((s) => { if (cancelled) s(); else stop = s; });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      stop?.();
    };
  }, [client, source, resource, follow, timestamps, meta.streams, gen]);

  const debouncedQuery = useDebounced(query, 220);
  const shown = filterLogLines(lines, debouncedQuery);
  useEffect(() => { if (follow) end.current?.scrollIntoView({ block: "end" }); }, [shown, follow]);

  const argvShown = source === "pod" ? cmd.podLogsFollow(resource || "<pod>") : cmd.containerLogs(resource || "<id>", { follow: true, timestamps });

  return (
    <div className="split">
      <div className="primary" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div className="toolbar" style={{ background: "var(--panel)", gap: 8, flexWrap: "wrap" }}>
          <label className="muted" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
            Origem
            <Select size="sm" ariaLabel="Origem dos logs" value={source} onChange={(v) => setSource(v as LogSource)}
              options={LOG_SOURCES.map((s) => ({ value: s.id, label: s.label }))} style={{ minWidth: 150 }} />
          </label>
          {(source === "container" || source === "pod" || source === "vm") && (
            <label className="muted" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
              Recurso
              <Select size="sm" mono ariaLabel="Recurso" value={resource} onChange={setResource}
                options={candidates.map((c) => ({ value: c.name, label: c.name }))}
                placeholder={candidates.length ? undefined : "Nenhum"} style={{ minWidth: 180 }} />
            </label>
          )}
          {meta.streams && (
            <button className="btn sm" type="button" style={{ color: follow ? "var(--ok)" : undefined }} onClick={() => setFollow((f) => !f)}>
              <Icon name={follow ? "stop" : "play"} size={13} />{follow ? "Pausar" : "Seguir"}
            </button>
          )}
          {meta.timestamps && (
            <button className="btn sm" type="button" style={{ color: timestamps ? "var(--inf)" : undefined }} onClick={() => setTimestamps((t) => !t)} title="Requer `--log-cri` no run (container logs --timestamps)">
              Timestamps
            </button>
          )}
          <label className="muted" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
            Buffer
            <Select size="sm" ariaLabel="Teto do buffer" value={String(limit)} onChange={(v) => setLimit(Number(v) as BufferLimit)}
              options={BUFFER_LIMITS.map((n) => ({ value: String(n), label: `${n} linhas` }))} style={{ minWidth: 110 }} />
          </label>
          <button className="btn sm" type="button" onClick={() => setLines([])}>Limpar</button>
          <button className="btn sm" type="button" onClick={() => void doExport(lines.join("\n"), logFilename(source, resource))}>
            <Icon name="download" size={13} />Exportar
          </button>
        </div>

        <div className="toolbar" style={{ background: "var(--panel)", gap: 8 }}>
          <input className="input mono" style={{ flex: "1 1 240px" }} placeholder="Pesquisar nos logs" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Pesquisar nos logs" />
          <span className="muted" style={{ fontSize: 12 }}>{shown.length}/{lines.length} linhas</span>
          <StatusChip status={status} />
          {status === "interrupted" && (
            <button className="btn sm" type="button" onClick={() => setGen((g) => g + 1)}><Icon name="restart" size={13} />Reconectar</button>
          )}
        </div>

        {meta.streams ? (
          <div className="log" style={{ flex: 1, overflow: "auto", border: 0, minHeight: 320 }}>
            {!resource
              ? <span className="muted">Escolha um {source === "pod" ? "pod" : "container"} a correr.</span>
              : shown.length === 0
                ? <span className="muted">{lines.length ? "Sem linhas para o filtro atual." : "Sem logs ainda."}</span>
                : shown.map((l, i) => {
                    const { ts, text } = timestamps ? splitTimestamp(l) : { ts: null, text: l };
                    return (
                      <div key={i} style={{ whiteSpace: "pre-wrap" }}>
                        {ts && <span style={{ color: "var(--inf)", marginRight: 8 }}>{ts}</span>}
                        {text}
                      </div>
                    );
                  })}
            <div ref={end} />
          </div>
        ) : source === "cluster" ? (
          <ClusterLogs onExport={doExport} query={debouncedQuery} />
        ) : (
          <div style={{ flex: 1, padding: 24 }}>
            <Chip tone="warn">Sem logs próprios</Chip>
            <p style={{ color: "var(--tx2)", marginTop: 10 }}>{meta.note}</p>
          </div>
        )}
      </div>

      <aside className="aside">
        <section className="section">
          <h2>Equivalente na CLI</h2>
          {meta.streams
            ? <CliHint argv={argvShown} />
            : source === "vm"
              ? <CliHint argv={cmd.vmConsole(resource || "<vm>")} />
              : source === "build"
                ? <CliHint argv={["build", "-t", "<tag>", "."]} />
                : <p className="mono muted" style={{ fontSize: 12 }}>kubectl logs &lt;pod&gt; -n &lt;ns&gt; --tail 1000 (kubeconfig em cache; o engine 5.1.1 não tem passthrough)</p>}
          {meta.timestamps && (
            <p className="muted" style={{ fontSize: 12 }}>
              <span className="mono">--timestamps</span> só funciona em containers corridos com <span className="mono">--log-cri</span> (o formato simples é bytes crus, sem carimbo por linha). Sem isso, o engine devolve um erro a nomear a flag.
            </p>
          )}
          {meta.note && !meta.streams && source !== "cluster" && (
            <p className="muted" style={{ fontSize: 12 }}>{meta.note}</p>
          )}
        </section>
        <section className="section">
          <h2>Origens</h2>
          <dl className="kv" style={{ fontSize: 12 }}>
            <dt>container</dt><dd>stream `container logs -f`</dd>
            <dt>pod</dt><dd>stream `pod logs -f` (1.º membro)</dd>
            <dt>VM</dt><dd>só consola série (sem logs de guest)</dd>
            <dt>build</dt><dd>ao vivo na tela Construir</dd>
            <dt>cluster</dt><dd>instantâneo `cluster kubectl logs`</dd>
          </dl>
        </section>
      </aside>
    </div>
  );
}

function StatusChip({ status }: { status: Status }) {
  switch (status) {
    case "streaming": return <Chip tone="ok" dot>a seguir</Chip>;
    case "paused": return <Chip tone="neu">pausado</Chip>;
    case "interrupted": return <Chip tone="warn" dot>interrompido — a reconectar…</Chip>;
    case "snapshot": return <Chip tone="inf">instantâneo</Chip>;
    default: return <Chip tone="neu">—</Chip>;
  }
}

// Logs de um pod DENTRO de um cluster (kubectl READ, kubeconfig em cache). É um
// INSTANTÂNEO (sem follow): escolhe-se o cluster e o pod, e carrega-se o tail.
function ClusterLogs({ onExport, query }: { onExport: (text: string, filename: string) => void; query: string }) {
  const { client } = useApp();
  const clusters = useResource("clusters-all", () => client.clusters(true), 0).data ?? [];
  const [cluster, setCluster] = useState("");
  const [podKey, setPodKey] = useState(""); // "namespace/name"
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (clusters.length && !clusters.some((c) => c.name === cluster)) setCluster(clusters[0].name); }, [clusters, cluster]);
  const pods = useResource(cluster ? ["cluster-pods", cluster] : "cluster-pods-none", () => (cluster ? client.clusterPods(cluster) : Promise.resolve([])), 0);
  const podList = pods.data ?? [];
  useEffect(() => { if (podList.length && !podList.some((p) => `${p.namespace}/${p.name}` === podKey)) setPodKey(`${podList[0].namespace}/${podList[0].name}`); }, [podList, podKey]);

  const load = () => {
    const [ns, name] = podKey.split("/");
    if (!cluster || !ns || !name) return;
    setBusy(true);
    setErr(null);
    client.clusterPodLogs(cluster, name, ns, 1000)
      .then(setText)
      .catch((e) => setErr(String(e)))
      .finally(() => setBusy(false));
  };
  // Carrega quando o pod escolhido muda.
  useEffect(() => { if (podKey && cluster) load(); /* eslint-disable-next-line */ }, [podKey, cluster]);

  const shown = filterLogLines(text.split("\n"), query);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className="toolbar" style={{ background: "var(--panel)", gap: 8, flexWrap: "wrap" }}>
        <label className="muted" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
          Cluster
          <Select size="sm" mono ariaLabel="Cluster" value={cluster} onChange={setCluster}
            options={clusters.map((c) => ({ value: c.name, label: c.name }))} placeholder={clusters.length ? undefined : "Nenhum"} style={{ minWidth: 140 }} />
        </label>
        <label className="muted" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
          Pod
          <Select size="sm" mono ariaLabel="Pod" value={podKey} onChange={setPodKey}
            options={podList.map((p) => ({ value: `${p.namespace}/${p.name}`, label: `${p.namespace}/${p.name}` }))} placeholder={podList.length ? undefined : "Nenhum"} style={{ minWidth: 220 }} />
        </label>
        <button className="btn sm" type="button" onClick={load} disabled={busy || !podKey}><Icon name="restart" size={13} />Recarregar</button>
        <button className="btn sm" type="button" onClick={() => onExport(text, logFilename("cluster", podKey.replace("/", "-")))}><Icon name="download" size={13} />Exportar</button>
        <Chip tone="inf">instantâneo · sem follow</Chip>
      </div>
      {pods.error && <div style={{ padding: "8px 16px" }}><ErrorNote error={String(pods.error)} /></div>}
      {err && <div style={{ padding: "8px 16px" }}><ErrorNote error={err} /></div>}
      <div className="log" style={{ flex: 1, overflow: "auto", border: 0, minHeight: 280 }}>
        {busy ? <span className="muted">A carregar…</span> : shown.length ? shown.join("\n") : <span className="muted">Sem logs (ou kubectl inacessível).</span>}
      </div>
    </div>
  );
}

// Eventos de LIFECYCLE do engine (`system events -f -o json`), separados dos
// logs. Pausa/retoma, pesquisa e exportação (como texto).
function EventsExplorer() {
  const { client } = useApp();
  const doExport = useExport();
  const [events, setEvents] = useState<string[]>([]);
  const [follow, setFollow] = useState(true);
  const [query, setQuery] = useState("");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!follow) return;
    let stop: (() => void) | undefined;
    void client
      .events((e) => {
        const line = `${e.time}  ${e.kind.padEnd(10)} ${e.action.padEnd(10)} ${e.name}${e.detail ? ` · ${e.detail}` : ""}`;
        setEvents((p) => capLines([...p, line], 2000));
      })
      .then((s) => (stop = s));
    return () => stop?.();
  }, [client, follow]);

  const debounced = useDebounced(query, 220);
  const shown = filterLogLines(events, debounced);
  useEffect(() => { if (follow) end.current?.scrollIntoView({ block: "end" }); }, [shown, follow]);

  return (
    <div className="split">
      <div className="primary" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div className="toolbar" style={{ background: "var(--panel)", gap: 8 }}>
          <button className="btn sm" type="button" style={{ color: follow ? "var(--ok)" : undefined }} onClick={() => setFollow((f) => !f)}>
            <Icon name={follow ? "stop" : "play"} size={13} />{follow ? "Pausar" : "Seguir"}
          </button>
          <input className="input mono" style={{ flex: "1 1 240px" }} placeholder="Pesquisar nos eventos" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Pesquisar nos eventos" />
          <span className="muted" style={{ fontSize: 12 }}>{shown.length}/{events.length}</span>
          <button className="btn sm" type="button" onClick={() => setEvents([])}>Limpar</button>
          <button className="btn sm" type="button" onClick={() => void doExport(events.join("\n"), logFilename("build", "events").replace("build-", "events-"))}><Icon name="download" size={13} />Exportar</button>
          <Chip tone={follow ? "ok" : "neu"} dot={follow}>{follow ? "a seguir" : "pausado"}</Chip>
        </div>
        <div className="log" style={{ flex: 1, overflow: "auto", border: 0, minHeight: 320 }}>
          {shown.length ? shown.join("\n") : <span className="muted">Sem eventos ainda — ações no engine aparecem aqui em direto.</span>}
          <div ref={end} />
        </div>
        <div className="toolbar"><CliHint argv={cmd.events()} compact /></div>
      </div>
      <aside className="aside">
        <section className="section">
          <h2>Logs vs Eventos</h2>
          <p className="muted" style={{ fontSize: 12 }}>
            Os <strong>logs</strong> são a saída dos processos (stdout/stderr). Os <strong>eventos</strong> são as transições de ciclo de vida do engine (create/start/die/oom/remove), correlacionáveis ao segundo. São fontes distintas — por isso ficam em abas separadas.
          </p>
        </section>
      </aside>
    </div>
  );
}
