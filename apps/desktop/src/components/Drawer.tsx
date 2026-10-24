import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FOCUSABLE, trapTab } from "../lib/focusTrap";
import { Icon } from "./Icon";

// Gaveta deslizante da direita (UI v2). Flutua SOBRE o conteúdo — a lista
// por baixo ocupa a largura toda quando a gaveta está fechada. Abre por ação
// (ex.: botão "Criar" no cabeçalho). Fecha com Escape, clique no backdrop ou
// no botão fechar. Foco preso (focus-trap) e devolvido ao fechar. Renderizada
// num portal no body para ficar no contexto de empilhamento da raiz: assim o
// z-index (abaixo de .overlay) garante que ConfirmDialog e a CommandPalette
// ficam SEMPRE por cima.
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  width = 380,
  backdrop = true,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  backdrop?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocus.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const target = panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
    target?.focus();
    return () => {
      restoreFocus.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="drawer-root">
      {backdrop && <div className="drawer-backdrop" onMouseDown={onClose} aria-hidden />}
      <div
        ref={panelRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        tabIndex={-1}
        style={{ width }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          } else {
            trapTab(e, panelRef.current);
          }
        }}
      >
        <header className="drawer-head">
          <h2>{title}</h2>
          <button className="btn ico" type="button" aria-label="Fechar" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
        {footer && <footer className="drawer-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
