import { useEffect, useState, type ComponentType, type SVGProps } from 'react';
import { ipc, isTauri, type Provider, type NodeInfo, type ResourceCounts, type ViewId } from './ipc';
import Dashboard from './views/Dashboard';
import {
  IconDashboard, IconContainers, IconPods, IconImages,
  IconVolumes, IconKubernetes, IconExtensions, IconSettings,
} from './icons';

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
// Contagens do duplo (valores REAIS medidos neste host a 2026-10-24: 6
// containers no total / 3 a correr, 0 pods, 25 imagens, 27 volumes).
const DEV_COUNTS: ResourceCounts = {
  containers_running: 3,
  containers_total: 6,
  pods: 0,
  images: 25,
  volumes: 27,
};

interface NavItem { id: ViewId; label: string; Icon: ComponentType<SVGProps<SVGSVGElement>>; }

const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', Icon: IconDashboard },
  { id: 'containers', label: 'Containers', Icon: IconContainers },
  { id: 'pods', label: 'Pods', Icon: IconPods },
  { id: 'images', label: 'Images', Icon: IconImages },
  { id: 'volumes', label: 'Volumes', Icon: IconVolumes },
  { id: 'kubernetes', label: 'Kubernetes', Icon: IconKubernetes },
  { id: 'extensions', label: 'Extensions', Icon: IconExtensions },
  { id: 'settings', label: 'Settings', Icon: IconSettings },
];

function NavRail({ active, onSelect }: { active: ViewId; onSelect: (id: ViewId) => void }) {
  return (
    <nav style={{
      width: 84, flexShrink: 0, background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', alignItems: 'stretch', padding: 'var(--sp-2) 0', gap: 2,
    }}>
      <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 13, color: 'var(--accent)', padding: 'var(--sp-2) 0 var(--sp-3)' }}>
        Delonix
      </div>
      {NAV.map(({ id, label, Icon }) => {
        const on = id === active;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            aria-current={on ? 'page' : undefined}
            title={label}
            style={{
              position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              padding: '10px 4px', margin: '0 var(--sp-2)', borderRadius: 'var(--r-md, 6px)', cursor: 'pointer',
              border: 'none', background: on ? 'var(--accent-dim)' : 'transparent',
              color: on ? 'var(--accent)' : 'var(--text-dim)', font: 'inherit',
            }}
          >
            {on && <span style={{ position: 'absolute', left: -8, top: 8, bottom: 8, width: 3, borderRadius: 3, background: 'var(--accent)' }} />}
            <Icon />
            <span style={{ fontSize: 10.5, lineHeight: 1.1, textAlign: 'center' }}>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '60vh', textAlign: 'center', color: 'var(--text-dim)' }}>
      <div>
        <h1 style={{ fontSize: 20, color: 'var(--text)', margin: '0 0 var(--sp-2)' }}>{title}</h1>
        <p style={{ margin: 0, fontSize: 13 }}>Vista por construir — chega numa próxima fase.</p>
      </div>
    </div>
  );
}

export default function App() {
  const live = isTauri();
  const [view, setView] = useState<ViewId>('dashboard');
  const [node, setNode] = useState<NodeInfo>(DEV_NODE);
  const [providers, setProviders] = useState<Provider[]>(DEV_PROVIDERS);
  const [counts, setCounts] = useState<ResourceCounts>(DEV_COUNTS);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!live) return;
    Promise.all([ipc.nodeInfo(), ipc.providers(), ipc.resourceCounts()])
      .then(([n, p, c]) => { setNode(n); setProviders(p); setCounts(c); setErr(null); })
      .catch((e) => setErr(String(e)));
  }, [live]);

  return (
    <div style={{ fontFamily: 'var(--sans)', color: 'var(--text)', background: 'var(--bg)', minHeight: '100vh', display: 'flex' }}>
      <NavRail active={view} onSelect={setView} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, maxHeight: '100vh', overflow: 'auto' }}>
        {!live && (
          <div role="status" style={{ background: 'var(--amber-bg)', color: 'var(--amber-ink)', padding: 'var(--sp-2) var(--sp-4)', fontSize: 13 }}>
            Modo de desenvolvimento (sem Tauri): dados do duplo local, não do runtime vivo.
          </div>
        )}
        {err && (
          <div role="alert" style={{ background: 'var(--red-bg)', color: 'var(--red)', padding: 'var(--sp-2) var(--sp-4)', fontSize: 13 }}>
            Sem ligação ao runtime: {err}
          </div>
        )}
        <main style={{ padding: 'var(--sp-5)', flex: 1 }}>
          {view === 'dashboard'
            ? <Dashboard node={node} providers={providers} counts={counts} onNavigate={setView} />
            : <Placeholder title={NAV.find((n) => n.id === view)!.label} />}
        </main>
      </div>
    </div>
  );
}
