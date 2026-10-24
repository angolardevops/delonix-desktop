// Vocabulário dos estados de capability do runtime (ADR-0050), partilhado
// entre a camada-core (Rust) e a UI. Os literais são EXACTAMENTE os que o
// contrato `delonix.node.v1` serializa em `/v1/providers` — medidos ao vivo
// (ver reports/2026-10-24-linux-vertical-slice.md): são SEIS, não cinco.

export type CapabilityState =
  | 'supported'
  | 'partial'
  | 'not-implemented'
  | 'unsupported-by-provider'
  | 'requires-external-component'
  | 'unavailable-on-host';

export interface CapabilityStyle {
  /** Rótulo pt-AO para leitores de ecrã e chip (nunca só cor). */
  label: string;
  /** Token de cor de texto/filete. */
  fg: string;
  /** Token de cor de fundo do chip. */
  bg: string;
  /** A UI deve oferecer a acção? Só `supported`. */
  actionable: boolean;
}

const STYLES: Record<CapabilityState, CapabilityStyle> = {
  supported: {
    label: 'Suportado',
    fg: 'var(--cap-supported)',
    bg: 'var(--cap-supported-bg)',
    actionable: true,
  },
  partial: {
    label: 'Parcial',
    fg: 'var(--cap-partial)',
    bg: 'var(--cap-partial-bg)',
    actionable: false,
  },
  'not-implemented': {
    label: 'Não implementado',
    fg: 'var(--cap-not-implemented)',
    bg: 'var(--cap-not-implemented-bg)',
    actionable: false,
  },
  'unsupported-by-provider': {
    label: 'Não suportado pelo provider',
    fg: 'var(--cap-unsupported)',
    bg: 'var(--cap-unsupported-bg)',
    actionable: false,
  },
  'requires-external-component': {
    label: 'Requer componente externo',
    fg: 'var(--cap-requires-external)',
    bg: 'var(--cap-requires-external-bg)',
    actionable: false,
  },
  'unavailable-on-host': {
    label: 'Indisponível neste host',
    fg: 'var(--cap-unavailable-host)',
    bg: 'var(--cap-unavailable-host-bg)',
    actionable: false,
  },
};

/** Estilo de um estado; degrada para «não implementado» se o contrato trouxer
 *  um estado novo que esta versão da UI ainda não conhece (ADR-0042). */
export function capabilityStyle(state: string): CapabilityStyle {
  return STYLES[state as CapabilityState] ?? STYLES['not-implemented'];
}
