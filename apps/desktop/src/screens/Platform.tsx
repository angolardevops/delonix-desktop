// Telas da camada de plataforma. Onde o engine já tem a base, a tela lê dados
// reais; o resto aparece como pré-visualização marcada com <Planned>.
import { useApp } from "../app/context";
import { Chip, PageHead, Planned } from "../components/ui";
import { useResource } from "../lib/hooks";

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

export function Kubernetes() {
  return (
    <>
      <PageHead title="Kubernetes" subtitle="Cluster local e conversão a partir de containers" />
      <div className="note">
        <span>O engine já serve CRI (<span className="mono">delonix serve cri</span>) e tem <span className="mono">delonix cluster</span> e <span className="mono">delonix kube</span>. Esta tela liga-se a esses comandos; ver PROMPT.md §8.5.</span>
      </div>
      <div style={{ padding: "32px 40px", display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Ainda não há pods</h2>
        <p className="muted" style={{ margin: 0 }}>Gerar manifestos a partir de containers, aplicar YAML ou converter compose.</p>
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
