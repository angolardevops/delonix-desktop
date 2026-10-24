// Ícones inline (sem dependências). Traço fino, 24×24, herdam `currentColor`
// para seguir o estado activo do rail. Geométricos de propósito — identidade
// própria, não cópia de marca alheia.
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = (props: P) => ({
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...props,
});

export const IconDashboard = (p: P) => (
  <svg {...base(p)}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
);
export const IconContainers = (p: P) => (
  <svg {...base(p)}><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Z" /><path d="M3 7.5 12 12l9-4.5M12 12v9" /></svg>
);
export const IconPods = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="6" r="3" /><circle cx="6" cy="16" r="3" /><circle cx="18" cy="16" r="3" /><path d="M12 9v2.5M9.5 14l-1-1M14.5 14l1-1" /></svg>
);
export const IconImages = (p: P) => (
  <svg {...base(p)}><rect x="3" y="6" width="14" height="12" rx="1.5" /><path d="M7 6V4.5h14v12H19" /><path d="m6 14 3-3 3 2.5L15 10" /></svg>
);
export const IconVolumes = (p: P) => (
  <svg {...base(p)}><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" /></svg>
);
export const IconKubernetes = (p: P) => (
  <svg {...base(p)}><path d="m12 2 8.5 4v8L12 22 3.5 14V6L12 2Z" /><circle cx="12" cy="12" r="3" /><path d="M12 2v6.5M12 15v6.5M3.5 6l5.5 4M15 14l5.5 4M20.5 6 15 10M9 14l-5.5 4" /></svg>
);
export const IconExtensions = (p: P) => (
  <svg {...base(p)}><path d="M9 3h6v3a2 2 0 1 0 4 0h2v6h-3a2 2 0 1 0 0 4h3v3H9v-3a2 2 0 1 0-4 0H3V9h3a2 2 0 1 0 0-4H9Z" /></svg>
);
export const IconSettings = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></svg>
);
