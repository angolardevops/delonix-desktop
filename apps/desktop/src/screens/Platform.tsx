// Telas da camada de plataforma. Onde o engine já tem a base, a tela lê dados
// reais; o resto aparece como pré-visualização marcada com <Planned>.
import { useState } from "react";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { DataTable, type Column } from "../components/DataTable";
import { Drawer } from "../components/Drawer";
import { Chip, CliHint, ErrorNote, PageHead, Planned } from "../components/ui";
import { cmd, type Argv } from "../lib/cli";
import { useResource } from "../lib/hooks";
import type { ClusterRow } from "../lib/types";

export function Workspaces() {
  const { client } = useApp();
  const wl = useResource(() => client.workloads(), 10000).data ?? [];
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

// Kubernetes/Clusters (§E). Lê clusters reais por `cluster ls` (TEXTO, sem -o
// json no 5.1.1 — parseado por nome de coluna). Ações de LEITURA: saúde
// (`cluster health`), kubeconfig (`cluster kubeconfig`) e gerar manifesto a
// partir de um container (`cluster kube generate`). O provisionamento pesado
// (create/kubeadm/apply/destroy) fica fora da allowlist, de propósito.
export function Kubernetes() {
  const { client } = useApp();
  const { data, error, refresh } = useResource(() => client.clusters(true), 15000);
  const [gen, setGen] = useState("");
  const [out, setOut] = useState<{ title: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [genOpen, setGenOpen] = useState(false);

  const showText = async (argv: Argv, title: string) => {
    setBusy(true);
    try {
      const r = await client.readText(argv);
      setOut({ title, text: [r.stdout, r.stderr].filter((s) => s.trim()).join("\n") });
    } finally {
      setBusy(false);
    }
  };

  const rows = data ?? [];

  const columns: Column<ClusterRow>[] = [
    { key: "name", header: "Nome", truncate: true, width: 200, cellClassName: "mono", cellStyle: { color: "var(--tx)", fontWeight: 500 } },
    { key: "mode", header: "Modo", render: (c) => <Chip tone={c.mode === "vm" ? "inf" : "neu"}>{c.mode || "—"}</Chip> },
    { key: "state", header: "Estado", render: (c) => <Chip tone={c.state === "up" ? "ok" : "warn"} dot>{c.state || "—"}</Chip> },
    { key: "controlPlanes", header: "CP", cellClassName: "mono muted", render: (c) => c.controlPlanes || "—" },
    { key: "workers", header: "Workers", cellClassName: "mono muted", render: (c) => c.workers || "—" },
    { key: "apiPort", header: "API", cellClassName: "mono muted", render: (c) => c.apiPort || "—" },
    { key: "k8sVersion", header: "K8s", cellClassName: "mono muted", render: (c) => c.k8sVersion || "—" },
  ];

  return (
    <>
      <PageHead title="Kubernetes" subtitle={`${rows.length} cluster(s) · kind e VM · saúde, kubeconfig e geração de manifestos`}>
        <button className="btn" type="button" onClick={() => void refresh()}><Icon name="restart" size={13} /> Atualizar</button>
        <button className="btn pri" type="button" onClick={() => setGenOpen(true)}><Icon name="declarative" size={13} /> Gerar manifesto</button>
      </PageHead>
      <div className="note">
        <span>O engine serve CRI e tem <span className="mono">delonix cluster</span>. Esta tela lê <span className="mono">cluster ls/health/kubeconfig</span> e gera manifestos com <span className="mono">cluster kube generate</span>. O arranque de clusters (create/kubeadm) faz-se pela CLI.</span>
      </div>
      {error && <ErrorNote error={error} />}
      <DataTable<ClusterRow>
        columns={columns}
        rows={rows}
        getKey={(c) => c.name}
        searchPlaceholder="Pesquisar cluster, modo ou versão…"
        searchLabel="Pesquisar clusters"
        searchText={(c) => `${c.name} ${c.mode} ${c.state} ${c.k8sVersion}`}
        empty={<>Sem clusters — cria um com <span className="mono">delonix cluster create</span>.</>}
        actions={(c) => (
          <>
            <button className="btn sm" type="button" disabled={busy} onClick={() => void showText(cmd.clusterHealth(c.name), `cluster health ${c.name}`)}>Saúde</button>
            <button className="btn sm" type="button" disabled={busy} onClick={() => void showText(cmd.clusterKubeconfig(c.name), `kubeconfig ${c.name}`)}>Kubeconfig</button>
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
      <Drawer open={genOpen} onClose={() => setGenOpen(false)} title="Gerar manifesto Kubernetes">
        <section className="section">
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>Um <span className="mono">kind: Pod</span> a partir de um container (ou pod) já a correr localmente.</p>
          <input className="input mono" placeholder="nome do container/pod" value={gen} onChange={(e) => setGen(e.target.value)} aria-label="Nome do container ou pod" />
          <button className="btn pri" type="button" disabled={!gen || busy} onClick={() => void showText(cmd.clusterKubeGenerate(gen), `cluster kube generate ${gen}`).then(() => setGenOpen(false))}>Gerar</button>
          {gen && <CliHint argv={cmd.clusterKubeGenerate(gen)} compact />}
        </section>
      </Drawer>
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
