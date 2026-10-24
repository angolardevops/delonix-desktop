import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { FOCUSABLE, trapTab } from "../lib/focusTrap";

// Popover ancorado a um elemento (ex.: a ação "Rodar" de uma linha). Posiciona-se
// por baixo do âncora (ou por cima, se não couber) e reposiciona em scroll/resize.
// Fecha com Escape ou clique fora. Foco preso e z-index abaixo de .overlay para
// ficar sob os modais. Portal no body — ver Drawer para o racional do z-index.
export function Popover({
  open,
  onClose,
  anchorRef,
  children,
  ariaLabel,
  align = "end",
  width,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  ariaLabel?: string;
  align?: "start" | "end";
  width?: number;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      const pop = popRef.current;
      if (!a || !pop) return;
      const w = width ?? pop.offsetWidth;
      const h = pop.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = align === "end" ? a.right - w : a.left;
      left = Math.max(8, Math.min(left, vw - w - 8));
      let top = a.bottom + 4;
      if (top + h > vh - 8) top = Math.max(8, a.top - h - 4);
      setPos({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchorRef, align, width]);

  useEffect(() => {
    if (!open) return;
    const pop = popRef.current;
    const target = pop?.querySelector<HTMLElement>(FOCUSABLE) ?? pop;
    target?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (pop && !pop.contains(t) && !anchorRef.current?.contains(t)) onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={popRef}
      className="popover"
      role="dialog"
      aria-label={ariaLabel}
      tabIndex={-1}
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width,
        visibility: pos ? "visible" : "hidden",
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        } else {
          trapTab(e, popRef.current);
        }
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
