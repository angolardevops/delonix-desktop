import { useEffect, useMemo, useState } from "react";

// Paginação CLIENT-SIDE explícita.
//
// O engine Delonix não pagina: `delonix -o json` devolve SEMPRE a lista
// completa (ver lib/tauriClient.ts). Por isso a pesquisa, os filtros e a
// ordenação têm de operar sobre o conjunto COMPLETO e só DEPOIS fatiamos a
// página visível. Se um dia o engine ganhar paginação server-side, esta
// camada passa a receber já a fatia e `paginate` deixa de ser necessária.

export const PAGE_SIZE = 10;

export interface PageResult<T> {
  /** Itens da página atual (fatia do conjunto completo). */
  items: T[];
  /** Página 1-based já SATURADA ao intervalo válido [1, pages]. */
  page: number;
  /** Tamanho da página. */
  size: number;
  /** Total de itens no conjunto completo (após filtro/pesquisa). */
  total: number;
  /** Número total de páginas (>= 1, mesmo com a lista vazia). */
  pages: number;
  /** Índice 0-based do primeiro item desta página no conjunto completo. */
  start: number;
}

// Função PURA. Satura (clamp) a página ao intervalo válido: se a página pedida
// exceder o total — por exemplo depois de apagar o último item de uma página —
// devolve a última página existente em vez de uma fatia vazia.
export function paginate<T>(items: readonly T[], page: number, size = PAGE_SIZE): PageResult<T> {
  const safeSize = Math.max(1, Math.floor(size));
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / safeSize));
  const requested = Number.isFinite(page) ? Math.floor(page) : 1;
  const clamped = Math.min(Math.max(1, requested), pages);
  const start = (clamped - 1) * safeSize;
  return { items: items.slice(start, start + safeSize), page: clamped, size: safeSize, total, pages, start };
}

// Comparador DETERMINÍSTICO. Aplica `compare` (opcional) e desempata SEMPRE por
// `key(item)` (id/nome). Sem desempate, dois itens "iguais" segundo `compare`
// podem trocar de posição entre atualizações do polling, provocando duplicados
// ou omissões ao fatiar a página. A chave de desempate garante ordem estável.
export function orderBy<T>(items: readonly T[], key: (t: T) => string, compare?: (a: T, b: T) => number): T[] {
  return [...items].sort((a, b) => {
    const primary = compare ? compare(a, b) : 0;
    if (primary !== 0) return primary;
    return key(a).localeCompare(key(b));
  });
}

export interface Pagination<T> extends PageResult<T> {
  setPage: (p: number) => void;
  first: () => void;
  prev: () => void;
  next: () => void;
  last: () => void;
  canPrev: boolean;
  canNext: boolean;
}

// Hook que mantém o número da página e deriva a fatia do conjunto completo.
// Volta a saturar a página sempre que `items` encolhe (apagar/filtrar), de modo
// que a UI nunca fica presa numa página inexistente.
export function usePagination<T>(items: readonly T[], size = PAGE_SIZE): Pagination<T> {
  const [page, setPage] = useState(1);
  const result = useMemo(() => paginate(items, page, size), [items, page, size]);

  // Sincroniza o estado quando a saturação muda a página efetiva (ex.: apagar o
  // último item de uma página recua para a anterior).
  useEffect(() => {
    if (page !== result.page) setPage(result.page);
  }, [page, result.page]);

  return {
    ...result,
    setPage,
    first: () => setPage(1),
    prev: () => setPage((p) => Math.max(1, p - 1)),
    next: () => setPage((p) => Math.min(result.pages, p + 1)),
    last: () => setPage(result.pages),
    canPrev: result.page > 1,
    canNext: result.page < result.pages,
  };
}
