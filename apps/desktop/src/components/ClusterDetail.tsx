import { useEffect, useState } from "react";
import { useApp } from "../app/context";
import { cmd } from "../lib/cli";
import { useResource } from "../lib/hooks";
import { saveTextViaDialog } from "../lib/fsx";
import { copyText, nativeDialogsAvailable } from "../lib/native";
import type { ClusterRow, K8sNode, K8sPod } from "../lib/types";
import { DataTable, type Column } from "./DataTable";
import { Icon } from "./Icon";
import { Select } from "./Select";
import { Chip, CliHint, ErrorNote, Tabs } from "./ui";

// Detalhe OPERÁVEL de um cluster (anatomia Docker/Podman Desktop). Overlay a
// toda a largura com abas: Visão (saúde + kubeconfig), Nós (com drain/uncordon),
// Pods (por namespace, com logs) e Namespaces. Leitura de dentro do cluster por
// kubectl READ (pela cache do kubeconfig); as operações passam por `act` (risco
// + confirmação). Rendido num portal pelo chamador (Platform/Kubernetes).
type Tab = "overview" | "nodes" | "pods" | "namespaces";

export function ClusterDetail({ cluster, onClose }: { cluster: ClusterRow; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const name = cluster.name;

  return (
    <div className="overlay" onMouseDown={onClose} style={{ alignItems: "center", padding: 24 }}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Cluster ${name}`}
        style={{ maxWidth: 1080, width: "92vw", height: "86vh", display: "flex", flexDirection: "column" }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
          <Icon name="kubernetes" size={16} />
          <b className="mono">{name}</b>
          <Chip tone={cluster.mode === "vm" ? "inf" : "neu"}>{cluster.mode || "kind"}</Chip>
          <Chip tone={cluster.state === "up" ? "ok" : "warn"} dot>{cluster.state || "—"}</Chip>
          {cluster.k8sVersion && <span className="mono muted" style={{ fontSize: 12 }}>{cluster.k8sVersion}</span>}
          {cluster.apiPort && <span className="mono muted" style={{ fontSize: 12 }}>API :{cluster.apiPort}</span>}
          <button className="btn ico" type="button" aria-label="Fechar" style={{ marginLeft: "auto" }} onClick={onClose}><Icon name="close" /></button>
        </header>
        <div style={{ padding: "10px 16px 0" }}>
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            items={[
              { id: "overview", label: "Visão" },
              { id: "nodes", label: "Nós" },
              { id: "pods", label: "Pods" },
              { id: "namespaces", label: "Namespaces" },
            ]}
          />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "12px 16px" }}>
          {tab === "overview" && <Overview name={name} />}
          {tab === "nodes" && <Nodes name={name} />}
          {tab === "pods" && <Pods name={name} />}
          {tab === "namespaces" && <Namespaces name={name} />}
        </div>
      </div>
    </div>
  );
}

// --- Visão: saúde (cluster health) + kubeconfig (ver/copiar/descarregar) -----
function Overview({ name }: { name: string }) {
  const { client } = useApp();
  const [health, setHealth] = useState<{ text: string; ok: boolean } | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [kubeconfig, setKubeconfig] = useState<string | null>(null);
  const [kcBusy, setKcBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const checkHealth = async () => {
    setHealthBusy(true);
    try {
      const r = await client.readText(cmd.clusterHealth(name));
      setHealth({ text: [r.stdout, r.stderr].filter((s) => s.trim()).join("\n").trim() || "(sem saída)", ok: r.ok });
    } catch (e) {
      setHealth({ text: String(e), ok: false });
    } finally {
      setHealthBusy(false);
    }
  };

  const loadKubeconfig = async () => {
    setKcBusy(true);
    try {
      const r = await client.readText(cmd.clusterKubeconfig(name));
      setKubeconfig(r.ok ? r.stdout : (r.stderr.trim() || `código ${r.code}`));
    } catch (e) {
      setKubeconfig(String(e));
    } finally {
      setKcBusy(false);
    }
  };

  // A saúde corre ao abrir a aba.
  useEffect(() => { void checkHealth(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [name]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section className="section">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ margin: 0 }}>Saúde</h2>
          {health && <Chip tone={health.ok ? "ok" : "bad"} dot>{health.ok ? "saudável" : "com problemas"}</Chip>}
          <button className="btn sm" type="button" disabled={healthBusy} style={{ marginLeft: "auto" }} onClick={() => void checkHealth()}>
            <Icon name="restart" size={12} /> {healthBusy ? "A verificar…" : "Verificar"}
          </button>
        </div>
        <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
          O control-plane responde e todos os nós estão <span className="mono">Ready</span>? (<span className="mono">cluster health</span>)
        </p>
        {health && <pre className="code" style={{ fontSize: 12, maxHeight: 200, overflow: "auto", marginTop: 8 }}>{health.text}</pre>}
        <CliHint argv={cmd.clusterHealth(name)} compact />
      </section>

      <section className="section">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ margin: 0 }}>Kubeconfig</h2>
          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button className="btn sm" type="button" disabled={kcBusy} onClick={() => void loadKubeconfig()}>
              <Icon name="activity" size={12} /> {kcBusy ? "A ler…" : kubeconfig ? "Reler" : "Ver kubeconfig"}
            </button>
            {kubeconfig && (
              <button className="btn sm" type="button" onClick={() => void copyText(kubeconfig).then((ok) => { if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1200); } })}>
                <Icon name="copy" size={12} /> {copied ? "Copiado" : "Copiar"}
              </button>
            )}
            {kubeconfig && nativeDialogsAvailable() && (
              <button className="btn sm" type="button" onClick={() => void saveTextViaDialog(kubeconfig, { title: "Guardar kubeconfig", defaultPath: `${name}-kubeconfig.yaml` }).then((p) => { if (p) { setSaved(p); setTimeout(() => setSaved(null), 2500); } })}>
                <Icon name="download" size={12} /> Descarregar
              </button>
            )}
          </span>
        </div>
        <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
          O ficheiro da cache local (sem SSH). Copia para a área de transferência ou guarda em disco para usar com o <span className="mono">kubectl</span>.
        </p>
        {saved && <div className="note" role="status"><span>Guardado em <span className="mono">{saved}</span></span></div>}
        {kubeconfig && <pre className="code" style={{ fontSize: 11, maxHeight: 280, overflow: "auto", marginTop: 8 }}>{kubeconfig}</pre>}
        <CliHint argv={cmd.clusterKubeconfig(name)} compact />
      </section>
    </div>
  );
}

// --- Nós: kubectl get nodes + drain/uncordon por nó --------------------------
function Nodes({ name }: { name: string }) {
  const { client, act } = useApp();
  const { data, error, refresh } = useResource(["cluster-nodes", name], () => client.clusterNodes(name), 15000);
  const rows = data ?? [];

  const drain = (node: string) =>
    void act(cmd.clusterDrain(node, name, { ignoreDaemonsets: true }), `Drenar nó ${node}`).then((ok) => { if (ok) void refresh(); });
  const uncordon = (node: string) =>
    void act(cmd.clusterUncordon(node, name), `Reativar nó ${node}`).then((ok) => { if (ok) void refresh(); });

  const columns: Column<K8sNode>[] = [
    { key: "name", header: "Nó", truncate: true, width: 260, cellClassName: "mono", cellStyle: { color: "var(--tx)", fontWeight: 500 } },
    { key: "status", header: "Estado", render: (n) => <Chip tone={n.ready ? "ok" : "bad"} dot>{n.status}</Chip> },
    { key: "schedulable", header: "Agendável", render: (n) => (n.schedulable ? <Chip tone="ok">sim</Chip> : <Chip tone="warn" dot>cordonado</Chip>) },
    { key: "roles", header: "Papéis", render: (n) => n.roles.map((r) => <Chip key={r} tone={r === "control-plane" ? "inf" : "neu"}>{r}</Chip>) },
    { key: "version", header: "Versão", cellClassName: "mono muted", render: (n) => n.version || "—" },
  ];

  return (
    <>
      {error && <ErrorNote error={error} />}
      <DataTable<K8sNode>
        columns={columns}
        rows={rows}
        getKey={(n) => n.name}
        searchPlaceholder="Pesquisar nó…"
        searchLabel="Pesquisar nós"
        searchText={(n) => `${n.name} ${n.status} ${n.roles.join(" ")} ${n.version}`}
        empty={<>Sem nós, ou o <span className="mono">kubectl</span> não conseguiu falar com o cluster.</>}
        actions={(n) => (
          n.schedulable
            ? <button className="btn sm" type="button" onClick={() => drain(n.name)} title="Cordona e despeja os pods">Drenar</button>
            : <button className="btn sm" type="button" onClick={() => uncordon(n.name)} title="Marca o nó agendável de novo">Reativar</button>
        )}
      />
      <p className="muted" style={{ fontSize: 11, margin: "8px 0 0" }}>
        Nós lidos por <span className="mono">kubectl get nodes</span> (só leitura, pela cache do kubeconfig). Drenar/Reativar passam por <span className="mono">delonix cluster drain/uncordon</span>.
      </p>
    </>
  );
}

// --- Pods: selector de namespace + kubectl get pods + logs -------------------
function Pods({ name }: { name: string }) {
  const { client } = useApp();
  const [ns, setNs] = useState("__all__");
  const nsArg = ns === "__all__" ? undefined : ns;
  const namespaces = useResource(["cluster-namespaces", name], () => client.clusterNamespaces(name), 30000).data ?? [];
  const { data, error } = useResource(["cluster-pods", name, ns], () => client.clusterPods(name, nsArg), 10000);
  const rows = data ?? [];
  const [logPod, setLogPod] = useState<K8sPod | null>(null);

  const nsOptions = [{ value: "__all__", label: "Todos os namespaces" }, ...namespaces.map((n) => ({ value: n, label: n }))];

  const tone = (phase: string) => (phase === "Running" || phase === "Succeeded" ? "ok" : phase === "Pending" ? "warn" : "bad");

  const columns: Column<K8sPod>[] = [
    { key: "namespace", header: "Namespace", cellClassName: "mono muted", width: 150 },
    { key: "name", header: "Pod", truncate: true, width: 280, cellClassName: "mono", cellStyle: { color: "var(--tx)", fontWeight: 500 } },
    { key: "phase", header: "Fase", render: (p) => <Chip tone={tone(p.phase)} dot>{p.phase}</Chip> },
    { key: "ready", header: "Prontos", cellClassName: "mono muted", align: "right" },
    { key: "restarts", header: "Restarts", cellClassName: "mono muted", align: "right", sortable: true, sortValue: (p) => p.restarts, render: (p) => String(p.restarts) },
    { key: "node", header: "Nó", truncate: true, width: 200, cellClassName: "mono muted", render: (p) => p.node || "—" },
  ];

  return (
    <>
      {error && <ErrorNote error={error} />}
      <div className="toolbar" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span className="lbl">Namespace</span>
        <Select value={ns} onChange={setNs} options={nsOptions} ariaLabel="Namespace" size="sm" style={{ minWidth: 220 }} />
      </div>
      <DataTable<K8sPod>
        columns={columns}
        rows={rows}
        getKey={(p) => `${p.namespace}/${p.name}`}
        searchPlaceholder="Pesquisar pod…"
        searchLabel="Pesquisar pods"
        searchText={(p) => `${p.namespace} ${p.name} ${p.phase} ${p.node}`}
        empty={<>Sem pods, ou o <span className="mono">kubectl</span> não conseguiu falar com o cluster.</>}
        pageSize={25}
        actions={(p) => (
          <button className="btn sm" type="button" onClick={() => setLogPod(p)}><Icon name="logs" size={12} /> Logs</button>
        )}
      />
      <p className="muted" style={{ fontSize: 11, margin: "8px 0 0" }}>
        Pods lidos por <span className="mono">kubectl get pods {nsArg ? `-n ${nsArg}` : "-A"}</span> (só leitura).
      </p>
      {logPod && <PodLogs cluster={name} pod={logPod} onClose={() => setLogPod(null)} />}
    </>
  );
}

// Painel de logs de UM pod (kubectl logs --tail, one-shot com re-leitura). O
// `-f` contínuo e o exec interativo ficam para uma fatia seguinte.
function PodLogs({ cluster, pod, onClose }: { cluster: string; pod: K8sPod; onClose: () => void }) {
  const { client } = useApp();
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      setText(await client.clusterPodLogs(cluster, pod.name, pod.namespace));
    } catch (e) {
      setText(String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [cluster, pod.namespace, pod.name]);

  return (
    <div className="overlay" onMouseDown={onClose} style={{ alignItems: "center", padding: 24 }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={`Logs de ${pod.name}`} style={{ maxWidth: 900, width: "88vw", height: "76vh", display: "flex", flexDirection: "column" }} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
          <Icon name="logs" size={16} />
          <b className="mono">{pod.name}</b>
          <span className="mono muted" style={{ fontSize: 12 }}>{pod.namespace}</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button className="btn sm" type="button" disabled={busy} onClick={() => void load()}><Icon name="restart" size={12} /> {busy ? "A ler…" : "Reler"}</button>
            <button className="btn ico" type="button" aria-label="Fechar" onClick={onClose}><Icon name="close" /></button>
          </span>
        </header>
        <div className="log" style={{ flex: 1, overflow: "auto", padding: 12, whiteSpace: "pre-wrap" }}>
          {text == null ? <span className="muted">A carregar…</span> : (text.trim() || "(sem logs)")}
        </div>
        <footer style={{ padding: "8px 16px", borderTop: "1px solid var(--line)" }}>
          <span className="mono muted" style={{ fontSize: 11 }}>kubectl logs {pod.name} -n {pod.namespace} --tail 500</span>
        </footer>
      </div>
    </div>
  );
}

// --- Namespaces: lista (kubectl get namespaces) ------------------------------
function Namespaces({ name }: { name: string }) {
  const { client } = useApp();
  const { data, error } = useResource(["cluster-namespaces", name], () => client.clusterNamespaces(name), 30000);
  const rows = (data ?? []).map((n) => ({ name: n }));
  const columns: Column<{ name: string }>[] = [
    { key: "name", header: "Namespace", cellClassName: "mono", cellStyle: { color: "var(--tx)", fontWeight: 500 } },
  ];
  return (
    <>
      {error && <ErrorNote error={error} />}
      <DataTable<{ name: string }>
        columns={columns}
        rows={rows}
        getKey={(n) => n.name}
        searchPlaceholder="Pesquisar namespace…"
        searchLabel="Pesquisar namespaces"
        empty={<>Sem namespaces, ou o <span className="mono">kubectl</span> não conseguiu falar com o cluster.</>}
      />
      <p className="muted" style={{ fontSize: 11, margin: "8px 0 0" }}>
        Lidos por <span className="mono">kubectl get namespaces</span> (só leitura).
      </p>
    </>
  );
}
