import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon } from "./Icon";

// Combo-box reutilizável ao estilo select2. Substitui os `<select className="input">`
// nativos, cujo popup de `<option>` se perde no tema escuro (fundo claro do SO,
// texto claro → ilegível). Aqui o popup é DOM próprio, totalmente estilizado
// pelos tokens (var(--side)/var(--tx)…), portanto correto em claro E escuro.
//
// Acessibilidade: botão role="combobox" + lista role="listbox"; navegação por
// teclado (setas, Home/End, Enter, Escape) e pesquisa incremental. Fecha ao
// clicar fora e ao perder o foco.
export interface SelectOption {
  value: string;
  label: ReactNode;
  /** Texto adicional considerado na pesquisa (quando `label` não é string). */
  keywords?: string;
  disabled?: boolean;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  /** Mostra o campo de pesquisa. Por omissão, só quando há > 7 opções. */
  searchable?: boolean;
  searchPlaceholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  size?: "sm" | "md";
  mono?: boolean;
  className?: string;
  style?: CSSProperties;
}

// Texto pesquisável de uma opção (label string + keywords + value).
function optText(o: SelectOption): string {
  const lbl = typeof o.label === "string" ? o.label : "";
  return `${lbl} ${o.keywords ?? ""} ${o.value}`.toLowerCase();
}

export function Select({
  value,
  onChange,
  options,
  placeholder = "Selecionar…",
  searchable,
  searchPlaceholder = "Pesquisar…",
  disabled,
  ariaLabel,
  size = "md",
  mono,
  className,
  style,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();

  const canSearch = searchable ?? options.length > 7;
  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? options.filter((o) => optText(o).includes(needle)) : options;
  }, [options, q]);

  // Ao abrir, foca a pesquisa e coloca o cursor na opção selecionada.
  useEffect(() => {
    if (!open) return;
    setQ("");
    const idx = filtered.findIndex((o) => o.value === value);
    setActive(idx >= 0 ? idx : 0);
    if (canSearch) queueMicrotask(() => searchRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Mantém o índice ativo dentro dos resultados filtrados.
  useEffect(() => {
    if (active >= filtered.length) setActive(filtered.length ? filtered.length - 1 : 0);
  }, [filtered.length, active]);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  // Garante a visibilidade da opção ativa.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = (o?: SelectOption) => {
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => Math.min(filtered.length - 1, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(filtered.length - 1);
        break;
      case "Enter":
        e.preventDefault();
        choose(filtered[active]);
        break;
    }
  };

  return (
    <div className={`sel${className ? ` ${className}` : ""}`} ref={rootRef} style={style}>
      <button
        type="button"
        className={`sel-btn${size === "sm" ? " sm" : ""}${mono ? " mono" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onKey}
      >
        <span className={`sel-val${selected ? "" : " muted"}`}>{selected ? selected.label : placeholder}</span>
        <Icon name="chevron" size={14} />
      </button>
      {open && (
        <div className="sel-pop" role="presentation" onKeyDown={onKey}>
          {canSearch && (
            <div className="sel-search">
              <input
                ref={searchRef}
                className="input"
                value={q}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                aria-controls={listboxId}
                onChange={(e) => {
                  setQ(e.target.value);
                  setActive(0);
                }}
              />
            </div>
          )}
          <ul className="sel-list" role="listbox" id={listboxId} aria-label={ariaLabel} ref={listRef}>
            {filtered.length === 0 && <li className="sel-empty">Sem resultados</li>}
            {filtered.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                aria-disabled={o.disabled || undefined}
                className={`sel-opt${o.value === value ? " on" : ""}${i === active ? " active" : ""}${o.disabled ? " dis" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o)}
              >
                {o.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
