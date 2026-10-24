import { Select } from "./Select";

// Controlos de paginação: primeira / anterior / próxima / última, com a
// indicação "página X de Y · N itens". Com uma só página (ou lista vazia) os
// controlos ficam desativados mas o resumo continua visível.
//
// Opcionalmente mostra um seletor de TAMANHO DE PÁGINA (10/25/50/100): o
// utilizador escolhe quantos itens vê. A pesquisa/ordenação continuam a operar
// sobre o conjunto completo — só muda o tamanho da fatia visível.
//
// Usa glifos tipográficos (« ‹ › ») em vez de ícones SVG para não depender do
// catálogo de ícones (components/Icon.tsx), que é de outra frente.
export function Pager({
  page,
  pages,
  total,
  onFirst,
  onPrev,
  onNext,
  onLast,
  canPrev,
  canNext,
  pageSize,
  pageSizeOptions = [10, 25, 50, 100],
  onPageSize,
}: {
  page: number;
  pages: number;
  total: number;
  onFirst: () => void;
  onPrev: () => void;
  onNext: () => void;
  onLast: () => void;
  canPrev: boolean;
  canNext: boolean;
  pageSize?: number;
  pageSizeOptions?: number[];
  onPageSize?: (n: number) => void;
}) {
  return (
    <nav
      className="toolbar"
      aria-label="Paginação"
      style={{ borderTop: "1px solid var(--line)", borderBottom: 0, background: "var(--panel)", fontSize: 12, color: "var(--mut)" }}
    >
      <span>
        Página {page} de {pages} · {total} {total === 1 ? "item" : "itens"}
      </span>
      {pageSize !== undefined && onPageSize && (
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 16 }}>
          <span>Por página</span>
          <Select
            size="sm"
            ariaLabel="Itens por página"
            searchable={false}
            value={String(pageSize)}
            onChange={(v) => onPageSize(Number(v))}
            options={pageSizeOptions.map((n) => ({ value: String(n), label: String(n) }))}
            style={{ width: 72 }}
          />
        </label>
      )}
      <span style={{ marginLeft: "auto", display: "inline-flex", gap: 4 }}>
        <button className="btn sm" type="button" aria-label="Primeira página" disabled={!canPrev} onClick={onFirst}>
          <span aria-hidden>«</span>
        </button>
        <button className="btn sm" type="button" aria-label="Página anterior" disabled={!canPrev} onClick={onPrev}>
          <span aria-hidden>‹</span>
        </button>
        <button className="btn sm" type="button" aria-label="Próxima página" disabled={!canNext} onClick={onNext}>
          <span aria-hidden>›</span>
        </button>
        <button className="btn sm" type="button" aria-label="Última página" disabled={!canNext} onClick={onLast}>
          <span aria-hidden>»</span>
        </button>
      </span>
    </nav>
  );
}
