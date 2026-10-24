import { useCallback, useEffect, useState } from 'react';
import { ipc, isTauri, type Workload } from '../ipc';
import { IconContainers } from '../icons';

// Vista de Containers: lista (esquerda) + detalhe com logs e ações (direita).
// Ao estilo Podman/Docker Desktop. Ao contrário do Dashboard — que recebe os
// dados já carregados pelo shell —, esta vista busca a SUA própria lista ao
// vivo e recarrega-a após cada mutação (start/stop/rm): nada de estado
// otimista, o novo estado vem sempre de `container ps -a` relido.
//
// Containers/mutações vêm pela ponte CLI-JSON (o contrato `node.v1` ainda não
// os serve) — a UI não sabe a diferença, fala só pelos comandos Tauri de `ipc`.

// Duplo de desenvolvimento (vite dev, sem Tauri): valores REAIS medidos neste
// host a 2026-10-24. Faixa de dev já avisa no shell que não é o runtime vivo.
const DEV_CONTAINERS: Workload[] = [
  { kind: 'container', name: 'dlx-ui-demo', status: 'Up 19 seconds', state: '', image: 'busybox' },
  { kind: 'container', name: 'dlx-ui-demo2', status: 'Exited (0)', state: '', image: 'busybox' },
];

// Um container está a correr quando o `status` da CLI começa por "Up"
// (ex.: "Up 19 seconds"); qualquer outro ("Exited (0)", "Created") é parado.
// É o estado que decide que ação oferecer: parado → Start, a correr → Stop.
function isRunning(w: Workload): boolean {
  const s = (w.status || w.state || '').trim().toLowerCase();
  return s.startsWith('up');
}

function StatusDot({ running }: { running: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        background: running ? 'var(--green)' : 'var(--text-faint)',
      }}
    />
  );
}

export default function Containers() {
  const live = isTauri();
  const [items, setItems] = useState<Workload[]>(live ? [] : DEV_CONTAINERS);
  const [selected, setSelected] = useState<string | null>(null);
  const [logs, setLogs] = useState<string | null>(null);
  const [logsFor, setLogsFor] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!live) { setItems(DEV_CONTAINERS); return; }
    setLoading(true);
    try {
      const list = await ipc.containers();
      setItems(list);
      setErr(null);
      // Se o selecionado desapareceu (ex.: após rm), limpa a seleção.
      setSelected((cur) => (cur && list.some((w) => w.name === cur) ? cur : null));
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, [live]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Executa uma mutação e recarrega a lista para observar o novo estado. O
  // `busy` trava os botões da linha visada enquanto a ação corre.
  const act = useCallback(async (name: string, verb: 'start' | 'stop' | 'rm') => {
    if (!live) { setErr('Ação indisponível no modo de desenvolvimento (sem Tauri).'); return; }
    setBusy(`${name}:${verb}`);
    setErr(null);
    try {
      if (verb === 'start') await ipc.startContainer(name);
      else if (verb === 'stop') await ipc.stopContainer(name);
      else await ipc.removeContainer(name);
      if (verb === 'rm' && logsFor === name) { setLogs(null); setLogsFor(null); }
      await refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
    }
  }, [live, logsFor, refresh]);

  const showLogs = useCallback(async (name: string) => {
    setSelected(name);
    if (!live) { setLogs('(logs indisponíveis no modo de desenvolvimento)'); setLogsFor(name); return; }
    setLogsFor(name);
    setLogs('A carregar…');
    try {
      const text = await ipc.logs(name);
      setLogs(text.length ? text : '(sem saída)');
    } catch (e) {
      setLogs(`Erro ao ler logs: ${String(e)}`);
    }
  }, [live]);

  const sel = items.find((w) => w.name === selected) ?? null;

  return (
    <>
      <header style={{ marginBottom: 'var(--sp-4)', display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Containers</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--text-dim)', fontSize: 13 }}>
            {items.length} container{items.length === 1 ? '' : 's'} · {items.filter(isRunning).length} a correr
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          style={btnStyle('ghost')}
        >
          {loading ? 'A atualizar…' : 'Atualizar'}
        </button>
      </header>

      {err && (
        <div role="alert" style={{ background: 'var(--red-bg)', color: 'var(--red)', padding: 'var(--sp-2) var(--sp-3)', borderRadius: 'var(--r-md, 6px)', fontSize: 13, marginBottom: 'var(--sp-3)' }}>
          {err}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(320px, 1.4fr)', gap: 'var(--sp-4)', alignItems: 'start' }}>
        {/* Lista */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
          {items.length === 0 ? (
            <div style={{ display: 'grid', placeItems: 'center', padding: 'var(--sp-6) var(--sp-4)', color: 'var(--text-dim)', textAlign: 'center' }}>
              <div>
                <IconContainers width={28} height={28} aria-hidden="true" />
                <p style={{ margin: 'var(--sp-2) 0 0', fontSize: 13 }}>
                  {loading ? 'A carregar containers…' : 'Nenhum container. Corre um com «delonix container run».'}
                </p>
              </div>
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {items.map((w, i) => {
                const running = isRunning(w);
                const on = w.name === selected;
                return (
                  <li key={w.name} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
                    <div
                      onClick={() => setSelected(w.name)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', padding: 'var(--sp-3)',
                        cursor: 'pointer', background: on ? 'var(--accent-dim)' : 'transparent',
                      }}
                    >
                      <StatusDot running={running} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.image}</div>
                      </div>
                      <span style={{ fontSize: 11.5, color: running ? 'var(--green)' : 'var(--text-faint)', whiteSpace: 'nowrap' }}>
                        {w.status || w.state || (running ? 'up' : 'parado')}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Detalhe */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 'var(--sp-4)', minHeight: 200 }}>
          {!sel ? (
            <div style={{ display: 'grid', placeItems: 'center', height: 160, color: 'var(--text-dim)', fontSize: 13 }}>
              Seleciona um container para ver o detalhe.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
                <StatusDot running={isRunning(sel)} />
                <strong style={{ fontSize: 15 }}>{sel.name}</strong>
              </div>
              <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px var(--sp-3)', margin: '0 0 var(--sp-4)', fontSize: 13 }}>
                <dt style={{ color: 'var(--text-dim)' }}>Imagem</dt>
                <dd style={{ margin: 0, fontFamily: 'var(--mono)' }}>{sel.image || '—'}</dd>
                <dt style={{ color: 'var(--text-dim)' }}>Estado</dt>
                <dd style={{ margin: 0 }}>{sel.status || sel.state || '—'}</dd>
              </dl>

              <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', marginBottom: 'var(--sp-4)' }}>
                {isRunning(sel) ? (
                  <button type="button" onClick={() => void act(sel.name, 'stop')} disabled={busy !== null} style={btnStyle('default')}>
                    {busy === `${sel.name}:stop` ? 'A parar…' : 'Stop'}
                  </button>
                ) : (
                  <button type="button" onClick={() => void act(sel.name, 'start')} disabled={busy !== null} style={btnStyle('primary')}>
                    {busy === `${sel.name}:start` ? 'A arrancar…' : 'Start'}
                  </button>
                )}
                <button type="button" onClick={() => void showLogs(sel.name)} disabled={busy !== null} style={btnStyle('ghost')}>
                  Logs
                </button>
                <button type="button" onClick={() => void act(sel.name, 'rm')} disabled={busy !== null} style={btnStyle('danger')}>
                  {busy === `${sel.name}:rm` ? 'A remover…' : 'Rm'}
                </button>
              </div>

              {logsFor === sel.name && logs !== null && (
                <div>
                  <h2 style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 var(--sp-2)' }}>
                    Logs <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>(snapshot)</span>
                  </h2>
                  <pre style={{
                    margin: 0, padding: 'var(--sp-3)', background: 'var(--bg)', border: '1px solid var(--border)',
                    borderRadius: 'var(--r-md, 6px)', fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--text)',
                    maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>
                    {logs}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

type BtnKind = 'default' | 'primary' | 'ghost' | 'danger';
function btnStyle(kind: BtnKind): React.CSSProperties {
  const base: React.CSSProperties = {
    font: 'inherit', fontSize: 13, padding: '6px 14px', borderRadius: 'var(--r-md, 6px)',
    cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)',
  };
  if (kind === 'primary') return { ...base, background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)' };
  if (kind === 'danger') return { ...base, color: 'var(--red)', borderColor: 'var(--red)' };
  if (kind === 'ghost') return { ...base, background: 'transparent' };
  return base;
}
