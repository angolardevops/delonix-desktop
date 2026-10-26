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
import { cmd, k8sVersionImage, K8S_VERSION_CUSTOM, K8S_VERSIONS, type Argv } from "../lib/cli";
import { useResource } from "../lib/hooks";
import { imageHost, readRegistryAuths, type RegistryReadResult } from "../lib/registries";
import type { ClusterRow, ImageRow } from "../lib/types";

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

// Registries (§ registries) — FUNCIONAL (anatomia Docker/Podman Desktop) dentro
// do que o engine 5.1.1 permite. Em vez de listar só a sessão, a tela LÊ o
// `auth.json` persistido (`<root>/delonix/auth.json`, formato docker/podman) e
// mostra o estado REAL das credenciais por registry; depois de cada login/logout
// relê o ficheiro. Por registry cruza com as imagens LOCAIS (`image ls`) desse
// host e oferece pull/push.
//
// CONSTRANGIMENTO: a password do login só entra por STDIN, nunca por argv — por
// isso o login passa por um comando backend dedicado (`dlx_login`). O `image
// logout` é argv normal (SafeWrite). SEGURANÇA: a password nunca é lida, mostrada
// nem registada — do auth.json só se extrai o utilizador.
// LIMITE HONESTO: o engine 5.1.1 NÃO tem catálogo remoto (`image ls-remote`),
// mirror/pull-through nem promoção — só credenciais + pull/push.
export function Registries() {
  const { client, act } = useApp();
  const { data: imagesData, refresh: refreshImages } = useResource("images", () => client.images(), 15000);
  const images = imagesData ?? [];

  // Credenciais PERSISTIDAS (auth.json). Relidas após cada login/logout.
  const [reg, setReg] = useState<RegistryReadResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const reload = async () => {
    setLoading(true);
    try {
      setReg(await readRegistryAuths());
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void reload(); }, []);

  const registries = reg?.registries ?? [];
  const authedHosts = new Set(registries.map((r) => r.registry));
  const imagesOf = (host: string) => images.filter((i) => imageHost(i.ref) === host);
  // Hosts com imagens locais mas SEM credencial guardada (sugestão de login).
  const unauthedHosts = [...new Set(images.map((i) => imageHost(i.ref)))].filter((h) => !authedHosts.has(h)).sort();

  const [selected, setSelected] = useState<string | null>(null);
  const selImages = selected ? imagesOf(selected) : [];

  // Login (Drawer; password por stdin).
  const [registry, setRegistry] = useState("ghcr.io");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const openLogin = (prefill?: string) => { if (prefill) setRegistry(prefill); setErr(null); setLoginOpen(true); };

  const login = () => {
    const r = registry.trim();
    const user = username.trim();
    if (!r || !user || !password) return;
    setErr(null);
    setMsg(null);
    setBusy(true);
    void client
      .login(r, user, password)
      .then(async (res) => {
        if (!res.ok) { setErr(res.stderr.trim() || `login falhou (código ${res.code})`); return; }
        setPassword(""); // a password nunca fica retida na UI após o login
        setUsername("");
        setLoginOpen(false);
        setMsg(`Autenticado em ${r}. Credencial guardada no auth.json.`);
        await reload(); // a lista reflete o estado REAL persistido, não a memória
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setBusy(false));
  };

  const logout = (host: string) =>
    void act(cmd.imageLogout(host), `Terminar sessão em ${host}`).then(async (ok) => {
      if (!ok) return;
      if (selected === host) setSelected(null);
      setMsg(`Sessão terminada em ${host}.`);
      await reload();
    });

  // Pull (Drawer). A referência pré-preenche o host selecionado.
  const [pullRef, setPullRef] = useState("");
  const [pullOpen, setPullOpen] = useState(false);
  const openPull = (host?: string) => { setPullRef(host && host !== "docker.io" ? `${host}/` : ""); setPullOpen(true); };

  const imgColumns: Column<ImageRow>[] = [
    { key: "ref", header: "Repositório : tag", truncate: true, width: 300, cellClassName: "mono", cellStyle: { color: "var(--tx)", fontWeight: 500 } },
    { key: "id", header: "ID", truncate: true, width: 120, cellClassName: "mono muted" },
    { key: "size", header: "Tamanho", cellClassName: "mono" },
    { key: "usedBy", header: "Usada por", truncate: true, width: 180, render: (i) => (i.usedBy.length ? i.usedBy.join(", ") : i.orphan ? <Chip tone="warn">órfã</Chip> : <Chip tone="ok">em uso</Chip>) },
  ];

  const columns: Column<RegistryRow>[] = [
    { key: "registry", header: "Registry", truncate: true, width: 220, cellClassName: "mono", cellStyle: { color: "var(--tx)", fontWeight: 500 } },
    { key: "username", header: "Utilizador", cellClassName: "mono muted", render: (r) => r.username || <span className="muted">—</span> },
    { key: "images", header: "Imagens locais", cellClassName: "mono muted", sortable: true, sortValue: (r) => r.images, render: (r) => r.images || "—" },
    { key: "state", header: "Estado", render: () => <Chip tone="ok" dot>autenticado</Chip> },
  ];
  const rows: RegistryRow[] = registries.map((r) => ({ ...r, images: imagesOf(r.registry).length }));

  return (
    <>
      <PageHead title="Registries" subtitle="Credenciais OCI persistidas (auth.json) · login/logout, pull e push por registry">
        <button className="btn" type="button" onClick={() => void reload()}><Icon name="restart" size={13} /> Atualizar</button>
        <button className="btn" type="button" onClick={() => openPull()}><Icon name="download" size={13} /> Puxar imagem</button>
        <button className="btn pri" type="button" onClick={() => openLogin()}><Icon name="plus" size={13} /> Autenticar</button>
      </PageHead>
      <div className="note">
        <Chip tone="neu" dot>Limite do engine 5.1.1</Chip>
        <span style={{ flex: "1 1 360px" }}>
          Gere credenciais reais + <span className="mono">pull</span>/<span className="mono">push</span>. Não há catálogo remoto (<span className="mono">image ls-remote</span>), mirror pull-through nem promoção — o engine só guarda credenciais por registry e transfere imagens.
        </span>
      </div>
      {reg?.error && <ErrorNote error={`Não foi possível ler o auth.json: ${reg.error}`} />}
      {msg && <div className="note" role="status" style={{ background: "var(--okb, rgba(0,160,80,.08))" }}><span>{msg}</span></div>}
      {reg && (
        <p className="muted" style={{ fontSize: 11, margin: "10px 0 0" }}>
          {reg.available
            ? <>Lido de <span className="mono">{reg.path}</span>{loading ? " · a atualizar…" : ""}</>
            : <>Fora da app de secretária (Tauri) não há filesystem — a mostrar uma amostra de exemplo.</>}
        </p>
      )}
      <DataTable<RegistryRow>
        columns={columns}
        rows={rows}
        getKey={(r) => r.registry}
        searchPlaceholder="Pesquisar registry ou utilizador…"
        searchLabel="Pesquisar registries"
        searchText={(r) => `${r.registry} ${r.username}`}
        empty={loading ? "A ler o auth.json…" : <>Sem registries autenticados. Autentica num com <span className="mono">Autenticar</span>.</>}
        onRowDoubleClick={(r) => setSelected(r.registry)}
        actions={(r) => (
          <>
            <button className="btn sm" type="button" onClick={() => setSelected(r.registry === selected ? null : r.registry)} title="Ver imagens locais deste registry"><Icon name="images" size={12} /> Imagens</button>
            <button className="btn sm" type="button" onClick={() => logout(r.registry)} title="Remover a credencial guardada">Terminar sessão</button>
          </>
        )}
      />

      {unauthedHosts.length > 0 && (
        <section className="section" style={{ marginTop: 12 }}>
          <h2 style={{ margin: 0, fontSize: 13 }}>Hosts com imagens locais, sem credencial</h2>
          <div className="row" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            {unauthedHosts.map((h) => (
              <button key={h} className="btn sm" type="button" onClick={() => openLogin(h)} title={`Autenticar em ${h}`}>
                <span className="mono">{h}</span> <span className="muted">· {imagesOf(h).length} · autenticar</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {selected && (
        <section className="section" style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <h2 style={{ margin: 0 }}>Imagens locais de <span className="mono">{selected}</span> <span className="muted">({selImages.length})</span></h2>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn sm" type="button" onClick={() => openPull(selected)}><Icon name="download" size={12} /> Puxar</button>
              <button className="btn sm" type="button" onClick={() => setSelected(null)}><Icon name="close" size={12} /> Fechar</button>
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <DataTable<ImageRow>
              columns={imgColumns}
              rows={selImages}
              getKey={(i) => i.ref + i.id}
              tieBreak={(i) => i.ref + i.id}
              search={false}
              pageSize={10}
              empty={<>Sem imagens locais de <span className="mono">{selected}</span>. Puxa uma com <span className="mono">Puxar</span>.</>}
              actions={(i) => (
                <button className="btn sm" type="button" title={`Publicar ${i.ref} no registry`} onClick={() => void act(cmd.imagePush(i.ref), `Publicar ${i.ref}`).then((ok) => { if (ok) setMsg(`Publicada ${i.ref}.`); })}>
                  <Icon name="up" size={12} /> Publicar
                </button>
              )}
            />
          </div>
        </section>
      )}

      {/* Autenticar (login) — password por stdin */}
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
          {err && <ErrorNote error={err} />}
          <button className="btn pri" type="button" disabled={busy || !registry.trim() || !username.trim() || !password} onClick={login}>
            {busy ? "A autenticar…" : "Autenticar"}
          </button>
          <p className="muted" style={{ fontSize: 11, margin: 0 }}>
            A password segue por <span className="mono">stdin</span> (nunca pela linha de comando) e não é guardada na app. Equivale a: <span className="mono">printf … | delonix image login {registry.trim() || "<registry>"} -u {username.trim() || "<user>"} --password-stdin</span>
          </p>
        </section>
      </Drawer>

      {/* Puxar imagem (pull) */}
      <Drawer open={pullOpen} onClose={() => setPullOpen(false)} title="Puxar imagem">
        <section className="section">
          <label className="muted" style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
            Referência
            <input className="input mono" value={pullRef} placeholder="ghcr.io/angolardevops/delonix-runtime:edge" onChange={(e) => setPullRef(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && pullRef.trim()) void act(cmd.pull(pullRef.trim()), `Puxar ${pullRef.trim()}`).then((ok) => { if (ok) { setPullOpen(false); void refreshImages(); } }); }} />
          </label>
          <button className="btn pri" type="button" disabled={!pullRef.trim()} onClick={() => void act(cmd.pull(pullRef.trim()), `Puxar ${pullRef.trim()}`).then((ok) => { if (ok) { setPullOpen(false); void refreshImages(); } })}>Puxar</button>
          {pullRef.trim() && <CliHint argv={cmd.pull(pullRef.trim())} compact />}
          <p className="muted" style={{ fontSize: 11, margin: 0 }}>Usa a credencial guardada do host da referência, se existir. Imagens privadas exigem login primeiro.</p>
        </section>
      </Drawer>
    </>
  );
}

// Linha da tabela de registries: a credencial persistida + a contagem de imagens
// locais desse host (cruzamento com `image ls`).
interface RegistryRow {
  registry: string;
  username: string;
  hasCredential: boolean;
  images: number;
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
  // Versão do Kubernetes → imagem de nó `kindest/node:<tag>` (§6). "" = default
  // do engine (sem --image); "custom" revela o campo de imagem/tag livre.
  const [cK8sVersion, setCK8sVersion] = useState("");
  const [cCustomImage, setCCustomImage] = useState("");
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
    image: k8sVersionImage(cK8sVersion, cCustomImage),
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
          <label className="lbl">Versão do Kubernetes</label>
          <Select
            value={cK8sVersion}
            onChange={setCK8sVersion}
            options={K8S_VERSIONS.map((v) => ({ value: v.value, label: v.label }))}
            ariaLabel="Versão do Kubernetes"
          />
          {cK8sVersion === K8S_VERSION_CUSTOM && (
            <input
              className="input mono"
              placeholder="kindest/node:v1.33.4 (ou só v1.33.4)"
              value={cCustomImage}
              onChange={(e) => setCCustomImage(e.target.value)}
              aria-label="Imagem de nó personalizada"
            />
          )}
          <p className="muted" style={{ margin: 0, fontSize: 11 }}>
            A versão escolhe a imagem de nó <span className="mono">kindest/node:&lt;tag&gt;</span>. Padrão = a imagem fixada por digest do engine (sem <span className="mono">--image</span>). Mínima suportada: <span className="mono">v1.34.x</span>.
          </p>
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
