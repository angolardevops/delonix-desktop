import { useEffect, useState } from 'react';
import { CapabilityBadge, type CapabilityState } from '@delonix/design-system';
import { ipc, isTauri, type Provider, type NodeInfo } from './ipc';

// Duplo de desenvolvimento (vite dev, sem Tauri). Valores REAIS medidos neste
// host — ver reports/2026-10-24-linux-vertical-slice.md. Faixa visível avisa.
const DEV_NODE: NodeInfo = {
  arch: 'x86_64',
  rootless: true,
  cgroup_delegated: true,
  engine_version: '5.1.1',
  hostname: 'delonix',
  supported_workload_types: ['container', 'pod', 'vm', 'microvm'],
};
const DEV_PROVIDERS: Provider[] = [
  { id: 'cloud-hypervisor', kind: 'compute', available: true, catalog_version: '1.4.0', capabilities: [
    { name: 'provider.readback', state: 'supported', supported: true, detail: 'check:CH: ls nomeia-o' },
    { name: 'provider.availability', state: 'partial', supported: true, detail: 'available() verifica o binário; provider ls sonda /dev/kvm' },
    { name: 'vm.gpu.passthrough', state: 'not-implemented', supported: false, detail: '' },
    { name: 'vm.nested', state: 'unavailable-on-host', supported: true, detail: 'declarado, não encontrado na sonda' },
  ] },
  { id: 'linux', kind: 'storage', available: true, catalog_version: '1.4.0', capabilities: [
    { name: 'volume.create', state: 'supported', supported: true, detail: 'check: cria e lê de volta' },
    { name: 'volume.snapshot', state: 'requires-external-component', supported: false, detail: 'precisa de btrfs/zfs' },
  ] },
  { id: 'opnsense', kind: 'gateway', available: false, catalog_version: '1.4.0', capabilities: [
    { name: 'firewall.rules', state: 'unsupported-by-provider', supported: false, detail: '' },
  ] },
];

export default function App() {
  const live = isTauri();
  const [node, setNode] = useState<NodeInfo>(DEV_NODE);
  const [providers, setProviders] = useState<Provider[]>(DEV_PROVIDERS);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!live) return;
    Promise.all([ipc.nodeInfo(), ipc.providers()])
      .then(([n, p]) => { setNode(n); setProviders(p); })
      .catch((e) => setErr(String(e)));
  }, [live]);

  const caps = providers.flatMap((p) => p.capabilities);
  const hist = caps.reduce<Record<string, number>>((h, c) => {
    h[c.state] = (h[c.state] ?? 0) + 1;
    return h;
  }, {});

  return (
    <div style={{ fontFamily: 'var(--sans)', color: 'var(--text)', background: 'var(--bg)', minHeight: '100vh' }}>
      {!live && (
        <div role="status" style={{ background: 'var(--amber-bg)', color: 'var(--amber-ink)', padding: 'var(--sp-2) var(--sp-4)', fontSize: 13 }}>
          Modo de desenvolvimento (sem Tauri): dados do duplo local, não do runtime vivo.
        </div>
      )}
      {err && (
        <div role="alert" style={{ background: 'var(--red-bg)', color: 'var(--red)', padding: 'var(--sp-2) var(--sp-4)' }}>
          Sem ligação ao runtime: {err}
        </div>
      )}
      <header style={{ padding: 'var(--sp-5)', borderBottom: '1px solid var(--border)' }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Delonix Desktop</h1>
        <p style={{ margin: '4px 0 0', color: 'var(--text-dim)', fontSize: 13 }}>
          {node.hostname} · engine {node.engine_version} · {node.arch}
          {node.rootless ? ' · rootless' : ''}{node.cgroup_delegated ? ' · cgroup delegado' : ''}
          {' · '}workloads: {node.supported_workload_types.join(', ')}
        </p>
      </header>

      <main style={{ padding: 'var(--sp-5)' }}>
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
      </main>
    </div>
  );
}
