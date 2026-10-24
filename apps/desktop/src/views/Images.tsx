import { useCallback, useEffect, useState } from 'react';
import { ipc, isTauri, type Image } from '../ipc';
import { IconImages } from '../icons';

// Vista de Images: lista (esquerda) + detalhe com ação rm (direita), ao estilo
// Podman/Docker Desktop e irmã de Containers. Como lá, busca a SUA própria
// lista ao vivo e recarrega-a após cada mutação (rm): sem estado otimista, o
// novo estado vem sempre de `image ls -o json` relido.
//
// Imagens vêm pela ponte CLI-JSON (o contrato `node.v1` ainda não as serve) —
// a UI fala só pelos comandos Tauri de `ipc`. Ao contrário de Containers, uma
// imagem não tem ciclo de vida (start/stop/logs): a única ação é remover.

// Duplo de desenvolvimento (vite dev, sem Tauri): forma REAL de `image ls`
// medida neste host a 2026-10-24. Faixa de dev já avisa que não é o runtime vivo.
const DEV_IMAGES: Image[] = [
  { repo_tags: ['alpine:3.19'], id: 'sha256:83b2b6703a62', created_unix: 1792855624, size_bytes: 3419815, orphan: true },
  { repo_tags: ['redis:7-alpine', 'redis:7.4-alpine'], id: 'sha256:4df5c34dc412', created_unix: 1792852463, size_bytes: 16241702, orphan: true },
  { repo_tags: ['busybox:latest', 'docker.io/library/busybox:latest'], id: 'sha256:aaef90e06523', created_unix: 1792848377, size_bytes: 2226163, orphan: false },
  { repo_tags: [], id: 'sha256:deadbeefcafe', created_unix: 1792835641, size_bytes: 3853109, orphan: true },
];

// Etiqueta de apresentação: a primeira tag, ou «sem tag» para uma imagem órfã
// sem repo_tags (que só se endereça pelo digest).
function primaryTag(img: Image): string {
  return img.repo_tags[0] ?? '<sem tag>';
}

// Identificador estável para rm e para a key da lista: o digest. É o único que
// uma imagem órfã (sem tags) tem, e remove a imagem toda (não uma só tag).
function imageRef(img: Image): string {
  return img.id;
}

// id curto para mostrar: tira o prefixo `sha256:` e trunca a 12 hex, como a CLI.
function shortId(id: string): string {
  const hex = id.startsWith('sha256:') ? id.slice('sha256:'.length) : id;
  return hex.slice(0, 12);
}

// Tamanho humano a partir de bytes (base 1000, como a CLI do delonix).
function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let u = 0;
  while (n >= 1000 && u < units.length - 1) { n /= 1000; u++; }
  return `${u === 0 ? n : n.toFixed(1)} ${units[u]}`;
}

// Data de criação a partir do epoch (segundos). Vazio/0 → traço.
function createdAt(epochSeconds: number): string {
  if (!epochSeconds) return '—';
  return new Date(epochSeconds * 1000).toLocaleString('pt-PT');
}

export default function Images() {
  const live = isTauri();
  const [items, setItems] = useState<Image[]>(live ? [] : DEV_IMAGES);
  const [selected, setSelected] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pullRef, setPullRef] = useState('');
  const [pulling, setPulling] = useState(false);

  const refresh = useCallback(async () => {
    if (!live) { setItems(DEV_IMAGES); return; }
    setLoading(true);
    try {
      const list = await ipc.images();
      setItems(list);
      setErr(null);
      // Se a imagem selecionada desapareceu (ex.: após rm), limpa a seleção.
      setSelected((cur) => (cur && list.some((img) => imageRef(img) === cur) ? cur : null));
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, [live]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Remove uma imagem e recarrega a lista para observar o novo estado. O `busy`
  // trava o botão enquanto a ação corre.
  const remove = useCallback(async (ref: string) => {
    if (!live) { setErr('Ação indisponível no modo de desenvolvimento (sem Tauri).'); return; }
    setBusy(`${ref}:rm`);
    setErr(null);
    try {
      await ipc.removeImage(ref);
      await refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
    }
  }, [live, refresh]);

  // Puxa a imagem referida no campo e recarrega a lista para a ver aparecer.
  // Pull fala com a rede e pode demorar: `pulling` trava o campo e o botão e
  // mostra «A puxar…» até o invoke devolver — não há poll a declarar falha
  // cedo (só um erro real do comando sobe). Em sucesso limpa o campo.
  const pull = useCallback(async () => {
    const ref = pullRef.trim();
    if (!ref) return;
    if (!live) { setErr('Ação indisponível no modo de desenvolvimento (sem Tauri).'); return; }
    setPulling(true);
    setErr(null);
    try {
      await ipc.pullImage(ref);
      setPullRef('');
      await refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setPulling(false);
    }
  }, [live, pullRef, refresh]);

  const sel = items.find((img) => imageRef(img) === selected) ?? null;

  return (
    <>
      <header style={{ marginBottom: 'var(--sp-4)', display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Images</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--text-dim)', fontSize: 13 }}>
            {items.length} imagem{items.length === 1 ? '' : 's'}
          </p>
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); void pull(); }}
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}
        >
          <input
            type="text"
            value={pullRef}
            onChange={(e) => setPullRef(e.target.value)}
            disabled={pulling}
            placeholder="repositório:tag (ex.: postgres:16)"
            aria-label="Referência da imagem a puxar"
            style={{
              font: 'inherit', fontSize: 13, padding: '6px 10px', width: 240,
              borderRadius: 'var(--r-md, 6px)', border: '1px solid var(--border)',
              background: 'var(--bg, var(--card))', color: 'var(--text)',
            }}
          />
          <button type="submit" disabled={pulling || pullRef.trim() === ''} style={btnStyle('primary')}>
            {pulling ? 'A puxar…' : 'Pull'}
          </button>
        </form>
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
                <IconImages width={28} height={28} aria-hidden="true" />
                <p style={{ margin: 'var(--sp-2) 0 0', fontSize: 13 }}>
                  {loading ? 'A carregar imagens…' : 'Nenhuma imagem. Puxa uma com «delonix image pull».'}
                </p>
              </div>
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {items.map((img, i) => {
                const ref = imageRef(img);
                const on = ref === selected;
                return (
                  <li key={ref} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
                    <div
                      onClick={() => setSelected(ref)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', padding: 'var(--sp-3)',
                        cursor: 'pointer', background: on ? 'var(--accent-dim)' : 'transparent',
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{primaryTag(img)}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortId(img.id)}</div>
                      </div>
                      <span style={{ fontSize: 11.5, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
                        {humanSize(img.size_bytes)}
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
              Seleciona uma imagem para ver o detalhe.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
                <strong style={{ fontSize: 15 }}>{primaryTag(sel)}</strong>
              </div>
              <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px var(--sp-3)', margin: '0 0 var(--sp-4)', fontSize: 13 }}>
                <dt style={{ color: 'var(--text-dim)' }}>Tags</dt>
                <dd style={{ margin: 0, fontFamily: 'var(--mono)' }}>
                  {sel.repo_tags.length ? sel.repo_tags.join('  ·  ') : '—'}
                </dd>
                <dt style={{ color: 'var(--text-dim)' }}>ID</dt>
                <dd style={{ margin: 0, fontFamily: 'var(--mono)', wordBreak: 'break-all' }}>{sel.id || '—'}</dd>
                <dt style={{ color: 'var(--text-dim)' }}>Tamanho</dt>
                <dd style={{ margin: 0 }}>{humanSize(sel.size_bytes)}</dd>
                <dt style={{ color: 'var(--text-dim)' }}>Criada</dt>
                <dd style={{ margin: 0 }}>{createdAt(sel.created_unix)}</dd>
                <dt style={{ color: 'var(--text-dim)' }}>Órfã</dt>
                <dd style={{ margin: 0 }}>{sel.orphan ? 'sim (sem container a usá-la)' : 'não'}</dd>
              </dl>

              <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                <button type="button" onClick={() => void remove(imageRef(sel))} disabled={busy !== null} style={btnStyle('danger')}>
                  {busy === `${imageRef(sel)}:rm` ? 'A remover…' : 'Rm'}
                </button>
              </div>
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
