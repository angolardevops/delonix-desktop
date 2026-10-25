// Telas da camada de plataforma. Onde o engine já tem a base, a tela lê dados
// reais; o resto aparece como pré-visualização marcada com <Planned>.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../app/context";
import { ClusterDetail } from "../components/ClusterDetail";
import { Icon } from "../components/Icon";
import { DataTable, type Column } from "../components/DataTable";
import { Drawer } from "../components/Drawer";
import { Select } from "../components/Select";
import { Chip, CliHint, ErrorNote, PageHead, Planned } from "../components/ui";
import { cmd, type Argv } from "../lib/cli";
import { useResource } from "../lib/hooks";
import type { ClusterRow } from "../lib/types";

export function Workspaces() {
  const { client } = useApp();
  const wl = useResource("workloads", () => client.workloads(), 10000).data ?? [];
  const namespaces = [...new Set(wl.map((w) => w.namespace))];
  return (
    <>
      <PageHead title="Workspaces" subtitle="Uma pasta com delonix.yaml que sobe o mesmo ambiente para toda a equipa" />
      <Planned what="O ficheiro delonix.yaml de workspace (perfis, políticas, composição)" dependsOn="o engine ganhar `delonix ws up/apply` sobre `delonix stack`/`compose`" />
      <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
        <span className="lbl">Hoje, o mais próximo no engine: namespaces de isolamento</span>
        {namespaces.map((n) => (
          <div key={n} className="row" style={{ borderTop: "1px solid var(--line2)", padding: "8px 0" }}>
            <b className="mono">{n}</b>
            <span className="muted">{wl.filter((w) => w.namespace === n).length} workloads</span>
          </div>
        ))}
      </div>
    </>
  );
}

// Registries (§ registries). Liga a `image login`/`image logout` (delonix-oci).
// CONSTRANGIMENTO: a password do login só entra por STDIN, nunca por argv — por
// isso o login passa por um comando backend dedicado (`dlx_login`), não por
// `dlx_run`. O `image logout` é argv normal (SafeWrite). O engine 5.1.1 NÃO tem
// `image login --list`, por isso a lista mostra os registries autenticados
// NESTA sessão (mais os que o utilizador acrescentar), com essa nota.
export function Registries() {
  const { client, act } = useApp();
  const [registry, setRegistry] = useState("ghcr.io");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // Registries autenticados nesta sessão (o engine não expõe uma listagem).
  const [session, setSession] = useState<{ registry: string; username: string }[]>([]);
  const [loginOpen, setLoginOpen] = useState(false);

  const login = () => {
    const reg = registry.trim();
    const user = username.trim();
    if (!reg || !user || !password) return;
    setErr(null);
    setMsg(null);
    setBusy(true);
    void client
      .login(reg, user, password)
      .then((r) => {
        if (!r.ok) { setErr(r.stderr.trim() || `login falhou (código ${r.code})`); return; }
        setSession((s) => [{ registry: reg, username: user }, ...s.filter((x) => x.registry !== reg)]);
        setMsg(`Autenticado em ${reg} como ${user}.`);
        setPassword(""); // a password nunca fica retida na UI após o login
        setLoginOpen(false);
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setBusy(false));
  };

  const logout = (reg: string) =>
    void act(cmd.imageLogout(reg), `Terminar sessão em ${reg}`).then((ok) => {
      if (ok) setSession((s) => s.filter((x) => x.registry !== reg));
    });

  return (
    <>
      <PageHead title="Registries" subtitle="Autenticação em registries OCI · login (password por stdin) e logout">
        <button className="btn pri" type="button" onClick={() => setLoginOpen(true)}><Icon name="plus" size={13} /> Autenticar</button>
      </PageHead>
      <Planned what="Regras de encaminhamento, mirror pull-through, promoção e modo offline" dependsOn="configuração de registries no engine; hoje só há credenciais por registry (`image login`/`logout`, delonix-oci)" />
      <div className="note">
        <span>Registries autenticados <b>nesta sessão</b>. O engine 5.1.1 guarda as credenciais em <span className="mono">auth.json</span> mas não expõe uma listagem (<span className="mono">image login --list</span> não existe), por isso a app só mostra os que foram autenticados aqui.</span>
      </div>
      {err && <ErrorNote error={err} />}
      {msg && <div className="note" style={{ background: "var(--okb, rgba(0,160,80,.08))" }}><span>{msg}</span></div>}
      <div className="table-wrap" style={{ marginTop: 14 }}>
        <table>
          <thead><tr><th>Registry</th><th>Utilizador</th><th>Estado</th><th style={{ textAlign: "right" }}>Ações</th></tr></thead>
          <tbody>
            {session.length === 0 && (
              <tr><td colSpan={4} className="muted" style={{ textAlign: "center", padding: 24 }}>Sem registries autenticados nesta sessão.</td></tr>
            )}
            {session.map((s) => (
              <tr key={s.registry}>
                <td className="mono" style={{ color: "var(--tx)", fontWeight: 500 }}>{s.registry}</td>
                <td className="mono muted">{s.username}</td>
                <td><Chip tone="ok" dot>autenticado</Chip></td>
                <td style={{ textAlign: "right" }}>
                  <button className="btn sm" type="button" onClick={() => logout(s.registry)}>Terminar sessão</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Drawer open={loginOpen} onClose={() => setLoginOpen(false)} title="Autenticar num registry">
        <section className="section">
          <label className="muted" style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
            Registry
            <input className="input mono" value={registry} placeholder="ghcr.io" onChange={(e) => setRegistry(e.target.value)} />
          </label>
          <label className="muted" style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
            Utilizador
            <input className="input mono" value={username} placeholder="angolardevops" onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label className="muted" style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
            Password / token
            <input className="input mono" type="password" value={password} placeholder="••••••••" onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") login(); }} />
          </label>
          <button className="btn pri" type="button" disabled={busy || !registry.trim() || !username.trim() || !password} onClick={login}>
            {busy ? "A autenticar…" : "Autenticar"}
          </button>
          <p className="muted" style={{ fontSize: 11, margin: 0 }}>
            A password segue por <span className="mono">stdin</span> (nunca pela linha de comando) e não é guardada na app. Equivale a: <span className="mono">printf … | delonix image login {registry.trim() || "&lt;registry&gt;"} -u {username.trim() || "&lt;user&gt;"} --password-stdin</span>
          </p>
        </section>
      </Drawer>
    </>
  );
}

// Kubernetes/Clusters (§E) — OPERÁVEL (anatomia Docker/Podman Desktop). Lista os
// clusters por `cluster ls` (TEXTO, sem -o json no 5.1.1 — parseado por nome de
// coluna) e deixa OPERAR sem sair da app: criar (com logs ao vivo), iniciar,
// parar, destruir, e abrir o detalhe (saúde, kubeconfig, nós, pods, namespaces,
// logs). As mutações passam por `act` (risco + confirmação); o create corre pela
// via de STREAM. `cluster kube generate` (gerar manifesto) mantido.
const CNI_OPTIONS = [
  { value: "default", label: "default (kindnet, da imagem)" },
  { value: "none", label: "none (nó fica NotReady até aplicares o teu CNI)" },
];

export function Kubernetes() {
  const { client, act } = useApp();
  const { data, error, refresh } = useResource(["clusters", true], () => client.clusters(true), 15000);
  const rows = data ?? [];

  const [detail, setDetail] = useState<ClusterRow | null>(null);

  // Gerar manifesto (`cluster kube generate`) — mantido.
  const [gen, setGen] = useState("");
  const [out, setOut] = useState<{ title: string; text: string } | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const showText = async (argv: Argv, title: string) => {
    setGenBusy(true);
    try {
      const r = await client.readText(argv);
      setOut({ title, text: [r.stdout, r.stderr].filter((s) => s.trim()).join("\n") });
    } finally {
      setGenBusy(false);
    }
  };

  // Criar cluster (Drawer + logs ao vivo pela via de STREAM).
  const [createOpen, setCreateOpen] = useState(false);
  const [cName, setCName] = useState("");
  const [cWorkers, setCWorkers] = useState(0);
  const [cCps, setCCps] = useState(1);
  const [cApiPort, setCApiPort] = useState("");
  const [cCni, setCCni] = useState("default");
  const [lines, setLines] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createDone, setCreateDone] = useState(false);
  const stopRef = useRef<(() => void) | undefined>(undefined);
  const logEnd = useRef<HTMLDivElement>(null);
  useEffect(() => () => stopRef.current?.(), []);
  useEffect(() => { logEnd.current?.scrollIntoView({ block: "end" }); }, [lines]);

  const createArgv = cmd.clusterCreate({
    name: cName || undefined,
    workers: cWorkers,
    controlPlanes: cCps,
    apiPort: cApiPort || undefined,
    cni: cCni,
  });
  const startCreate = () => {
    stopRef.current?.();
    setLines([]);
    setCreateDone(false);
    setCreating(true);
    void client
      .stream(
        "cluster-create",
        createArgv,
        (l) => setLines((p) => [...p.slice(-4999), l]),
        () => { setCreating(false); setCreateDone(true); void refresh(); },
      )
      .then((s) => (stopRef.current = s))
      .catch((e) => { setLines((p) => [...p, String(e)]); setCreating(false); });
  };

  const up = (c: ClusterRow) => /\bup\b/i.test(c.state);
  const columns: Column<ClusterRow>[] = [
    { key: "name", header: "Nome", truncate: true, width: 200, cellClassName: "mono", cellStyle: { color: "var(--tx)", fontWeight: 500 } },
    { key: "mode", header: "Modo", render: (c) => <Chip tone={c.mode === "vm" ? "inf" : "neu"}>{c.mode || "—"}</Chip> },
    { key: "state", header: "Estado", render: (c) => <Chip tone={up(c) ? "ok" : "warn"} dot>{c.state || "—"}</Chip> },
    { key: "controlPlanes", header: "CP", cellClassName: "mono muted", render: (c) => c.controlPlanes || "—" },
    { key: "workers", header: "Workers", cellClassName: "mono muted", render: (c) => c.workers || "—" },
    { key: "apiPort", header: "API", cellClassName: "mono muted", render: (c) => c.apiPort || "—" },
    { key: "k8sVersion", header: "K8s", cellClassName: "mono muted", render: (c) => c.k8sVersion || "—" },
  ];

  return (
    <>
      <PageHead title="Kubernetes" subtitle={`${rows.length} cluster(s) · kind e VM · criar, operar, nós, pods e logs`}>
        <button className="btn" type="button" onClick={() => void refresh()}><Icon name="restart" size={13} /> Atualizar</button>
        <button className="btn" type="button" onClick={() => setGenOpen(true)}><Icon name="declarative" size={13} /> Gerar manifesto</button>
        <button className="btn pri" type="button" onClick={() => setCreateOpen(true)}><Icon name="plus" size={13} /> Criar cluster</button>
      </PageHead>
      <div className="note">
        <span>Opera o cluster aqui, como no Docker/Podman Desktop: <span className="mono">criar · iniciar · parar · destruir</span> e, no detalhe, <span className="mono">saúde · kubeconfig · nós · pods · logs</span>. Os recursos dentro do cluster são lidos por <span className="mono">kubectl</span> (só leitura, pela cache do kubeconfig).</span>
      </div>
      {error && <ErrorNote error={error} />}
      <DataTable<ClusterRow>
        columns={columns}
        rows={rows}
        getKey={(c) => c.name}
        searchPlaceholder="Pesquisar cluster, modo ou versão…"
        searchLabel="Pesquisar clusters"
        searchText={(c) => `${c.name} ${c.mode} ${c.state} ${c.k8sVersion}`}
        empty={<>Sem clusters — cria um com <span className="mono">Criar cluster</span>.</>}
        onRowDoubleClick={(c) => setDetail(c)}
        actions={(c) => (
          <>
            <button className="btn sm" type="button" onClick={() => setDetail(c)} title="Abrir detalhe"><Icon name="overview" size={12} /> Detalhe</button>
            {up(c)
              ? <button className="btn sm" type="button" onClick={() => void act(cmd.clusterStop(c.name), `Parar cluster ${c.name}`).then((ok) => { if (ok) void refresh(); })} title="Parar todos os nós"><Icon name="stop" size={12} /> Parar</button>
              : <button className="btn sm" type="button" onClick={() => void act(cmd.clusterStart(c.name), `Iniciar cluster ${c.name}`).then((ok) => { if (ok) void refresh(); })} title="Religar os nós"><Icon name="play" size={12} /> Iniciar</button>}
            <button className="btn ico danger" type="button" aria-label={`Destruir ${c.name}`} title="Destruir o cluster" onClick={() => void act(cmd.clusterDestroy(c.name), `Destruir cluster ${c.name}`).then((ok) => { if (ok) void refresh(); })}><Icon name="trash" /></button>
          </>
        )}
      />
      {out && (
        <section className="section" style={{ marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>{out.title}</h2>
            <button className="btn sm" type="button" onClick={() => setOut(null)}><Icon name="close" size={12} /> Fechar</button>
          </div>
          <pre className="mono" style={{ margin: "8px 0 0", padding: 12, background: "var(--bg2, rgba(0,0,0,.04))", borderRadius: 6, overflow: "auto", maxHeight: 320, fontSize: 12, whiteSpace: "pre", border: "1px solid var(--line)" }}>{out.text || "(sem saída)"}</pre>
        </section>
      )}

      {/* Criar cluster — formulário + logs ao vivo do bootstrap */}
      <Drawer open={createOpen} onClose={() => setCreateOpen(false)} title="Criar cluster Kubernetes" width={560}>
        <section className="section">
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Cluster local <b>kind-mode</b> (nós no próprio engine + bootstrap kubeadm), sem manifesto e sem Docker. Sem nome, o engine inventa um.
          </p>
          <label className="lbl">Nome (opcional)</label>
          <input className="input mono" placeholder="dev" value={cName} onChange={(e) => setCName(e.target.value)} aria-label="Nome do cluster" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="lbl">Workers</span>
              <input className="input mono" type="number" min={0} value={cWorkers} onChange={(e) => setCWorkers(Math.max(0, Number(e.target.value) || 0))} aria-label="Número de workers" />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="lbl">Control-planes</span>
              <input className="input mono" type="number" min={1} value={cCps} onChange={(e) => setCCps(Math.max(1, Number(e.target.value) || 1))} aria-label="Número de control-planes" />
            </label>
          </div>
          <label className="lbl">Porta da API (opcional)</label>
          <input className="input mono" placeholder="6443 (livre, se vazio)" value={cApiPort} onChange={(e) => setCApiPort(e.target.value)} aria-label="Porta do apiserver" />
          <label className="lbl">CNI</label>
          <Select value={cCni} onChange={setCCni} options={CNI_OPTIONS} ariaLabel="CNI" />
          <p className="muted" style={{ margin: 0, fontSize: 11 }}>
            Mais de 1 control-plane exige um endpoint estável (LB) à frente — o engine recusa se faltar.
          </p>
          <CliHint argv={createArgv} compact />
          <button className="btn pri" type="button" disabled={creating} onClick={startCreate}>
            {creating ? "A criar…" : createDone ? "Criar outro" : "Criar cluster"}
          </button>
          {(lines.length > 0 || creating) && (
            <div className="log" style={{ marginTop: 4, maxHeight: 280, overflow: "auto", border: "1px solid var(--line)", borderRadius: 6, padding: 12, fontSize: 12, whiteSpace: "pre-wrap" }}>
              {lines.join("\n")}
              <div ref={logEnd} />
            </div>
          )}
          {createDone && (
            <div className="note" role="status" style={{ background: "var(--okb, rgba(0,160,80,.08))" }}>
              <span>Cluster criado. Abre o detalhe para ver nós, pods e o kubeconfig.</span>
            </div>
          )}
        </section>
      </Drawer>

      {/* Gerar manifesto Kubernetes (`cluster kube generate`) */}
      <Drawer open={genOpen} onClose={() => setGenOpen(false)} title="Gerar manifesto Kubernetes">
        <section className="section">
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>Um <span className="mono">kind: Pod</span> a partir de um container (ou pod) já a correr localmente.</p>
          <input className="input mono" placeholder="nome do container/pod" value={gen} onChange={(e) => setGen(e.target.value)} aria-label="Nome do container ou pod" />
          <button className="btn pri" type="button" disabled={!gen || genBusy} onClick={() => void showText(cmd.clusterKubeGenerate(gen), `cluster kube generate ${gen}`).then(() => setGenOpen(false))}>Gerar</button>
          {gen && <CliHint argv={cmd.clusterKubeGenerate(gen)} compact />}
        </section>
      </Drawer>

      {/* Detalhe do cluster (overlay com abas) */}
      {detail && createPortal(
        <ClusterDetail cluster={detail} onClose={() => setDetail(null)} />,
        document.body,
      )}
    </>
  );
}

export function Extensions() {
  return (
    <>
      <PageHead title="Extensões" subtitle="Providers, UI, hooks e ferramentas MCP, com permissões declaradas" />
      <Planned what="O runtime de extensões (WASM isolado + manifesto de permissões)" dependsOn="API de extensões v1 da app (PROMPT.md §10)" />
      <p className="muted" style={{ padding: "16px 24px", margin: 0 }}>
        Os providers do engine (cloud-hypervisor, libvirt, linux, proxmox, opnsense, truenas, btrfs, zfs, lvm, powerdns) já são o primeiro tipo de extensão: aparecem em Capacidades.
      </p>
    </>
  );
}
