import type { ComponentType, SVGProps } from 'react';

// Cartão de métrica do Dashboard ao estilo Podman Desktop: um número grande
// com o seu rótulo, um ícone de recurso e uma nota opcional por baixo.
//
// `value` é `number | null`. `null` NÃO é zero: significa que a contagem está
// indisponível (recurso não servido pelo runtime, CLI em erro) — mostramos um
// traço e esbatemos o cartão, para nunca dar a entender «existem 0» quando a
// verdade é «não sei». Mesmo princípio honesto dos estados de capability.
export interface MetricCardProps {
  label: string;
  value: number | null;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Nota secundária (ex.: «3 a correr», «de 4»). */
  hint?: string;
}

export default function MetricCard({ label, value, Icon, hint }: MetricCardProps) {
  const known = value !== null && value !== undefined;
  const display = known ? String(value) : '—';
  return (
    <div
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        padding: 'var(--sp-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--sp-2)',
        opacity: known ? 1 : 0.7,
      }}
      aria-label={`${label}: ${known ? display : 'indisponível'}`}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', color: 'var(--text-dim)' }}>
        <Icon width={18} height={18} aria-hidden="true" />
        <span style={{ fontSize: 13 }}>{label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)' }}>
        <strong style={{ fontSize: 30, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {display}
        </strong>
        {hint && <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{hint}</span>}
      </div>
    </div>
  );
}
