// Telas da camada de plataforma. Onde o engine já tem a base, a tela lê dados
// reais; o resto aparece como pré-visualização marcada com <Planned>.
import { useState } from "react";
import { useApp } from "../app/context";
import { Icon } from "../components/Icon";
import { Pager } from "../components/Pager";
import { Chip, CliHint, ErrorNote, PageHead, Planned } from "../components/ui";
import { cmd, type Argv } from "../lib/cli";
import { useResource } from "../lib/hooks";
import { orderBy, usePagination } from "../lib/pagination";

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

export function Registries() {
  return (
    <>
      <PageHead title="Registries" subtitle="Local, privados e públicos num só sítio" />
      <Planned what="Regras de encaminhamento, mirror pull-through, promoção e modo offline" dependsOn="configuração de registries no engine; hoje `pull`/`push` aceitam credenciais por registry (delonix-oci)" />
      <div className="table-wrap" style={{ marginTop: 14 }}>
        <table>
          <thead><tr><th>Registry</th><th>Tipo</th><th>Estado</th></tr></thead>
          <tbody>
            <tr><td className="mono">localhost:5000</td><td><Chip tone="inf">local</Chip></td><td className="muted">exemplo</td></tr>
            <tr><td className="mono">mirror · docker.io</td><td><Chip tone="inf">mirror</Chip></td><td className="muted">exemplo</td></tr>
            <tr><td className="mono">registry.empresa.internal</td><td><Chip tone="neu">privado</Chip></td><td className="muted">exemplo</td></tr>
          </tbody>
        </table>
      </div>
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
  const page = usePagination(orderBy(rows, (c) => c.name));

  return (
    <>
      <PageHead title="Kubernetes" subtitle={`${rows.length} cluster(s) · kind e VM · saúde, kubeconfig e geração de manifestos`}>
        <button className="btn" type="button" onClick={() => void refresh()}><Icon name="restart" size={13} /> Atualizar</button>
      </PageHead>
      <div className="note">
        <span>O engine serve CRI e tem <span className="mono">delonix cluster</span>. Esta tela lê <span className="mono">cluster ls/health/kubeconfig</span> e gera manifestos com <span className="mono">cluster kube generate</span>. O arranque de clusters (create/kubeadm) faz-se pela CLI.</span>
      </div>
      {error && <ErrorNote error={error} />}
      <div className="split">
        <div className="primary">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nome</th><th>Modo</th><th>Estado</th><th>CP</th><th>Workers</th><th>API</th><th>K8s</th><th style={{ textAlign: "right" }}>Ações</th></tr></thead>
              <tbody>
                {page.total === 0 && (
                  <tr><td colSpan={8} className="muted" style={{ textAlign: "center", padding: 24 }}>Sem clusters — cria um com <span className="mono">delonix cluster create</span>.</td></tr>
                )}
                {page.items.map((c) => (
                  <tr key={c.name}>
                    <td className="mono" style={{ color: "var(--tx)", fontWeight: 500 }}>{c.name}</td>
                    <td><Chip tone={c.mode === "vm" ? "inf" : "neu"}>{c.mode || "—"}</Chip></td>
                    <td><Chip tone={c.state === "up" ? "ok" : "warn"} dot>{c.state || "—"}</Chip></td>
                    <td className="mono muted">{c.controlPlanes || "—"}</td>
                    <td className="mono muted">{c.workers || "—"}</td>
                    <td className="mono muted">{c.apiPort || "—"}</td>
                    <td className="mono muted">{c.k8sVersion || "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 4 }}>
                        <button className="btn sm" type="button" disabled={busy} onClick={() => void showText(cmd.clusterHealth(c.name), `cluster health ${c.name}`)}>Saúde</button>
                        <button className="btn sm" type="button" disabled={busy} onClick={() => void showText(cmd.clusterKubeconfig(c.name), `kubeconfig ${c.name}`)}>Kubeconfig</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page.page} pages={page.pages} total={page.total} canPrev={page.canPrev} canNext={page.canNext} onFirst={page.first} onPrev={page.prev} onNext={page.next} onLast={page.last} />
          {out && (
            <section className="section" style={{ marginTop: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h2 style={{ margin: 0 }}>{out.title}</h2>
                <button className="btn sm" type="button" onClick={() => setOut(null)}><Icon name="close" size={12} /> Fechar</button>
              </div>
              <pre className="mono" style={{ margin: "8px 0 0", padding: 12, background: "var(--bg2, rgba(0,0,0,.04))", borderRadius: 6, overflow: "auto", maxHeight: 320, fontSize: 12, whiteSpace: "pre", border: "1px solid var(--line)" }}>{out.text || "(sem saída)"}</pre>
            </section>
          )}
        </div>
        <aside className="aside">
          <section className="section">
            <h2>Gerar manifesto Kubernetes</h2>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>Um <span className="mono">kind: Pod</span> a partir de um container (ou pod) já a correr localmente.</p>
            <input className="input mono" placeholder="nome do container/pod" value={gen} onChange={(e) => setGen(e.target.value)} aria-label="Nome do container ou pod" />
            <button className="btn pri" type="button" disabled={!gen || busy} onClick={() => void showText(cmd.clusterKubeGenerate(gen), `cluster kube generate ${gen}`)}>Gerar</button>
            {gen && <CliHint argv={cmd.clusterKubeGenerate(gen)} compact />}
          </section>
        </aside>
      </div>
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
