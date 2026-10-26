// Foco acessível partilhado pelos painéis flutuantes (Drawer/Popover): seletor
// de elementos focáveis e um ciclo de Tab preso ao container (focus-trap).
export const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

type KeyEventLike = { key: string; shiftKey: boolean; preventDefault: () => void };

// Prende o Tab/Shift+Tab ao `container`: ao sair pela última posição volta à
// primeira (e vice-versa). Não faz nada para teclas que não sejam Tab.
export function trapTab(e: KeyEventLike, container: HTMLElement | null) {
  if (!container || e.key !== "Tab") return;
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (n) => n.offsetWidth > 0 || n.offsetHeight > 0 || n === document.activeElement,
  );
  if (nodes.length === 0) {
    e.preventDefault();
    container.focus();
    return;
  }
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (!container.contains(active)) {
    e.preventDefault();
    first.focus();
    return;
  }
  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}
