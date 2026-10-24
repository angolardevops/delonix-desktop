import type { CSSProperties } from 'react';
import { capabilityStyle, type CapabilityState } from './capability';

export interface CapabilityBadgeProps {
  state: CapabilityState | string;
  /** Texto adicional (ex.: o nome da capability). */
  children?: React.ReactNode;
}

/**
 * Chip de estado de capability. Comunica SEMPRE por rótulo textual além da cor
 * (brief §9: «não comunicar estado apenas através de cores»), e expõe o estado
 * a leitores de ecrã via `aria-label`.
 */
export function CapabilityBadge({ state, children }: CapabilityBadgeProps) {
  const s = capabilityStyle(String(state));
  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--sp-1)',
    padding: '2px var(--sp-2)',
    borderRadius: 'var(--r-sm)',
    fontFamily: 'var(--sans)',
    fontSize: 12,
    lineHeight: 1.6,
    color: s.fg,
    background: s.bg,
  };
  const dot: CSSProperties = {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: 'currentColor',
    flex: '0 0 auto',
  };
  return (
    <span style={style} aria-label={`Estado: ${s.label}`} title={s.label}>
      <span style={dot} aria-hidden="true" />
      {children ?? s.label}
    </span>
  );
}
