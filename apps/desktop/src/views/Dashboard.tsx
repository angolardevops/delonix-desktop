import { CapabilityBadge, type CapabilityState } from '@delonix/design-system';
import type { NodeInfo, Provider, ResourceCounts } from '../ipc';
import MetricCard from '../components/MetricCard';
import {
  IconContainers, IconPods, IconImages, IconVolumes, IconExtensions,
} from '../icons';

// Vista Dashboard: o conteúdo vivo (nó, cartões de métricas, histograma de
// capacidades, providers). Recebe os dados já carregados pelo shell — não fala
// com o IPC directamente.
export default function Dashboard(
  { node, providers, counts }: { node: NodeInfo; providers: Provider[]; counts: ResourceCounts },
) {
  const caps = providers.flatMap((p) => p.capabilities);
  const hist = caps.reduce<Record<string, number>>((h, c) => {
    h[c.state] = (h[c.state] ?? 0) + 1;
    return h;
  }, {});

  // Providers vêm de `/v1/providers` (já carregados); os restantes da ponte
  // CLI-JSON via `counts`. A contagem de providers nunca é desconhecida aqui.
  const providersUp = providers.filter((p) => p.available).length;
  const metrics = [
    {
      label: 'Containers', value: counts.containers_total, Icon: IconContainers,
      hint: counts.containers_running !== null ? `${counts.containers_running} a correr` : undefined,
    },
    { label: 'Pods', value: counts.pods, Icon: IconPods },
    { label: 'Imagens', value: counts.images, Icon: IconImages },
    { label: 'Volumes', value: counts.volumes, Icon: IconVolumes },
    {
      label: 'Providers ativos', value: providersUp, Icon: IconExtensions,
      hint: `de ${providers.length}`,
    },
  ];

  return (
    <>
      <header style={{ marginBottom: 'var(--sp-5)' }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Dashboard</h1>
        <p style={{ margin: '4px 0 0', color: 'var(--text-dim)', fontSize: 13 }}>
          {node.hostname} · engine {node.engine_version} · {node.arch}
          {node.rootless ? ' · rootless' : ''}{node.cgroup_delegated ? ' · cgroup delegado' : ''}
          {' · '}workloads: {node.supported_workload_types.join(', ')}
        </p>
      </header>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        gap: 'var(--sp-3)',
        marginBottom: 'var(--sp-5)',
      }}>
        {metrics.map((m) => (
          <MetricCard key={m.label} label={m.label} value={m.value} Icon={m.Icon} hint={m.hint} />
        ))}
      </div>

      <h2 style={{ fontSize: 15, color: 'var(--text-2)' }}>Capacidades por estado (feature-gating)</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', marginBottom: 'var(--sp-5)' }}>
        {Object.entries(hist).map(([state, n]) => (
          <CapabilityBadge key={state} state={state as CapabilityState}>
            {n} × {state}
          </CapabilityBadge>
        ))}
      </div>

      <h2 style={{ fontSize: 15, color: 'var(--text-2)' }}>Providers</h2>
      {providers.map((p) => (
        <section key={`${p.kind}/${p.id}`} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 'var(--sp-4)', marginBottom: 'var(--sp-3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            <strong>{p.kind}/{p.id}</strong>
            <span style={{ fontSize: 12, color: p.available ? 'var(--green)' : 'var(--text-dim)' }}>
              {p.available ? 'disponível' : 'indisponível'}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-faint)', marginLeft: 'auto' }}>
              catálogo {p.catalog_version}
            </span>
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 'var(--sp-3) 0 0', display: 'grid', gap: 'var(--sp-2)' }}>
            {p.capabilities.map((c) => (
              <li key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', fontSize: 13 }}>
                <CapabilityBadge state={c.state} />
                <code style={{ fontFamily: 'var(--mono)' }}>{c.name}</code>
                {c.detail && <span style={{ color: 'var(--text-dim)' }}>{c.detail}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
