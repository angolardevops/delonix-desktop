import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { orderBy, usePagination, type Pagination } from "../lib/pagination";
import { Pager } from "./Pager";

export type SortState = { key: string; dir: "asc" | "desc" } | null;

export interface ListView<T> {
  q: string;
  setQ: (q: string) => void;
  size: number;
  setSize: (n: number) => void;
  sort: SortState;
  toggleSort: (key: string) => void;
  /** Conjunto completo após pesquisa + ordenação determinística. */
  sorted: T[];
  page: Pagination<T>;
}

// Núcleo partilhado por todas as listas (tabela OU grelha de cartões): pesquisa
// sobre o conjunto COMPLETO, ordenação determinística com desempate por chave, e
// paginação com tamanho configurável. Só DEPOIS se fatia a página — ver
// lib/pagination.ts.
export function useListView<T>(
  rows: readonly T[],
  opts: {
    getKey: (row: T) => string;
    searchText?: (row: T) => string;
    tieBreak?: (row: T) => string;
    compareFor?: (sort: NonNullable<SortState>) => ((a: T, b: T) => number) | undefined;
    initialSize?: number;
    defaultSort?: SortState;
  },
): ListView<T> {
  const { getKey, searchText, tieBreak, compareFor } = opts;
  const [q, setQ] = useState("");
  const [size, setSize] = useState(opts.initialSize ?? 10);
  const [sort, setSort] = useState<SortState>(opts.defaultSort ?? null);
  const tie = tieBreak ?? getKey;

  const needle = q.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!needle) return [...rows];
    const text = searchText ?? ((r: T) => getKey(r));
    return rows.filter((r) => text(r).toLowerCase().includes(needle));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, needle]);

  const sorted = useMemo(() => {
    const cmp = sort && compareFor ? compareFor(sort) : undefined;
    return orderBy(filtered, tie, cmp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort]);

  const page = usePagination(sorted, size);
  const toggleSort = (key: string) =>
    setSort((s) => (s && s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  const setSizeAndReset = (n: number) => {
    setSize(n);
    page.first();
  };

  return { q, setQ, size, setSize: setSizeAndReset, sort, toggleSort, sorted, page };
}

// Barra de pesquisa partilhada (markup idêntico ao das telas antigas).
export function ListSearch({
  value,
  onChange,
  placeholder = "Pesquisar…",
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
}) {
  return (
    <label className="dt-search">
      <span className="sr-only">{label ?? placeholder}</span>
      <input className="input" placeholder={placeholder} value={value} aria-label={label ?? placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

// Tabela de lista reutilizável. Concentra o que todas as telas repetiam:
// pesquisa sobre o conjunto COMPLETO, ordenação determinística (desempate por
// chave) e paginação com tamanho configurável. As telas passam só as colunas,
// as linhas e as ações — sem markup de <table>/<Pager> duplicado.
//
// Regra de ouro (ver lib/pagination.ts): pesquisa e ordenação operam sobre o
// conjunto completo; só DEPOIS se fatia a página visível.

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Conteúdo da célula. Por omissão, `String(row[key])`. */
  render?: (row: T) => ReactNode;
  /** Valor para ordenação quando a coluna é ordenável. */
  sortValue?: (row: T) => string | number;
  /** Ordenável por clique no cabeçalho (precisa de `sortValue`). */
  sortable?: boolean;
  /** Trunca com reticências (nowrap + ellipsis) limitado a `width`. */
  truncate?: boolean;
  width?: number | string;
  align?: "left" | "right";
  /** Classe aplicada à <td> (ex.: "mono muted"). */
  cellClassName?: string;
  cellStyle?: CSSProperties;
}

export interface SelectionContext {
  selectedKeys: Set<string>;
  pageKeys: string[];
  filteredKeys: string[];
  selectAllFiltered: () => void;
  clear: () => void;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: readonly T[];
  getKey: (row: T) => string;
  /** Estado vazio (quando não há linhas após filtro/pesquisa). */
  empty?: ReactNode;

  // Pesquisa
  search?: boolean;
  searchPlaceholder?: string;
  searchLabel?: string;
  /** Texto pesquisável de uma linha. Por omissão, usa getKey(row). */
  searchText?: (row: T) => string;

  // Ordenação
  /** Chave de desempate determinístico. Por omissão, getKey(row). */
  tieBreak?: (row: T) => string;
  defaultSort?: { key: string; dir: "asc" | "desc" };

  // Ações por linha (coluna final, alinhada à direita)
  actions?: (row: T) => ReactNode;
  actionsHeader?: ReactNode;

  // Seleção em massa (opcional)
  selection?: {
    value: Set<string>;
    onChange: (next: Set<string>) => void;
    bulkBar?: (ctx: SelectionContext) => ReactNode;
  };

  // Comportamento de linha
  onRowDoubleClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;

  // Paginação
  pageSize?: number;
  pageSizeOptions?: number[];

  // Slots extra
  toolbar?: ReactNode;
  footer?: ReactNode;
  /** Ocupa a altura disponível (table-wrap cresce, Pager encosta ao fundo). */
  fill?: boolean;
  wrapStyle?: CSSProperties;
}

export function DataTable<T>({
  columns,
  rows,
  getKey,
  empty = "Sem resultados",
  search = true,
  searchPlaceholder = "Pesquisar…",
  searchLabel,
  searchText,
  tieBreak,
  defaultSort,
  actions,
  actionsHeader = "Ações",
  selection,
  onRowDoubleClick,
  rowClassName,
  pageSize,
  pageSizeOptions = [10, 25, 50, 100],
  toolbar,
  footer,
  fill,
  wrapStyle,
}: DataTableProps<T>) {
  // Comparador para ordenação por coluna (precisa de `sortValue`). O desempate
  // determinístico fica a cargo do orderBy dentro do hook.
  const compareFor = (s: NonNullable<SortState>): ((a: T, b: T) => number) | undefined => {
    const col = columns.find((c) => c.key === s.key);
    if (!col?.sortValue) return undefined;
    const sv = col.sortValue;
    const dir = s.dir === "asc" ? 1 : -1;
    return (a, b) => {
      const va = sv(a);
      const vb = sv(b);
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return cmp * dir;
    };
  };

  const { q, setQ, size, setSize, sort, toggleSort, sorted, page } = useListView(rows, {
    getKey,
    searchText,
    tieBreak,
    compareFor,
    initialSize: pageSize ?? pageSizeOptions[0] ?? 10,
    defaultSort,
  });

  const pageKeys = page.items.map(getKey);
  const filteredKeys = sorted.map(getKey);
  const sel = selection?.value ?? new Set<string>();
  const pageAllSelected = pageKeys.length > 0 && pageKeys.every((k) => sel.has(k));

  const toggleRow = (k: string) => {
    if (!selection) return;
    const n = new Set(sel);
    n.has(k) ? n.delete(k) : n.add(k);
    selection.onChange(n);
  };
  const togglePage = (checked: boolean) => {
    if (!selection) return;
    const n = new Set(sel);
    for (const k of pageKeys) checked ? n.add(k) : n.delete(k);
    selection.onChange(n);
  };

  const colSpan = columns.length + (selection ? 1 : 0) + (actions ? 1 : 0);

  const cellContent = (c: Column<T>, row: T): ReactNode => {
    const v = c.render ? c.render(row) : (row as Record<string, unknown>)[c.key];
    const node = (v ?? "") as ReactNode;
    return c.truncate ? <span className="dt-trunc">{node}</span> : node;
  };

  const tdStyle = (c: Column<T>): CSSProperties => ({
    textAlign: c.align,
    ...(c.truncate ? { maxWidth: c.width ?? 160 } : c.width ? { width: c.width } : {}),
    ...c.cellStyle,
  });

  return (
    <div className={`dt${fill ? " fill" : ""}`}>
      {(search || toolbar) && (
        <div className="toolbar dt-toolbar">
          {toolbar}
          {search && <ListSearch value={q} onChange={setQ} placeholder={searchPlaceholder} label={searchLabel} />}
        </div>
      )}

      {selection?.bulkBar &&
        sel.size > 0 &&
        selection.bulkBar({
          selectedKeys: sel,
          pageKeys,
          filteredKeys,
          selectAllFiltered: () => selection.onChange(new Set([...sel, ...filteredKeys])),
          clear: () => selection.onChange(new Set()),
        })}

      <div className="table-wrap" style={wrapStyle}>
        <table className="dt-table">
          <thead>
            <tr>
              {selection && (
                <th style={{ width: 28 }}>
                  <input
                    type="checkbox"
                    aria-label="Selecionar página"
                    checked={pageAllSelected}
                    onChange={(e) => togglePage(e.target.checked)}
                  />
                </th>
              )}
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={{ textAlign: c.align, width: c.width }}
                  className={c.sortable && c.sortValue ? "dt-sort" : undefined}
                  aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                  onClick={c.sortable && c.sortValue ? () => toggleSort(c.key) : undefined}
                >
                  {c.header}
                  {c.sortable && c.sortValue && (
                    <span className="dt-sort-ind" aria-hidden>
                      {sort?.key === c.key ? (sort.dir === "asc" ? "▲" : "▼") : "⇅"}
                    </span>
                  )}
                </th>
              ))}
              {actions && <th className="dt-actions">{actionsHeader}</th>}
            </tr>
          </thead>
          <tbody>
            {page.total === 0 && (
              <tr>
                <td colSpan={colSpan} className="muted" style={{ textAlign: "center", padding: 24 }}>
                  {empty}
                </td>
              </tr>
            )}
            {page.items.map((row) => {
              const k = getKey(row);
              return (
                <tr
                  key={k}
                  className={[selection && sel.has(k) ? "sel" : "", rowClassName?.(row) ?? ""].filter(Boolean).join(" ") || undefined}
                  onDoubleClick={onRowDoubleClick ? () => onRowDoubleClick(row) : undefined}
                >
                  {selection && (
                    <td>
                      <input type="checkbox" aria-label={`Selecionar ${k}`} checked={sel.has(k)} onChange={() => toggleRow(k)} />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td key={c.key} className={c.cellClassName} style={tdStyle(c)}>
                      {cellContent(c, row)}
                    </td>
                  ))}
                  {actions && (
                    <td className="dt-actions">
                      <div className="dt-act-group">{actions(row)}</div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pager
        page={page.page}
        pages={page.pages}
        total={page.total}
        canPrev={page.canPrev}
        canNext={page.canNext}
        onFirst={page.first}
        onPrev={page.prev}
        onNext={page.next}
        onLast={page.last}
        pageSize={size}
        pageSizeOptions={pageSizeOptions}
        onPageSize={setSize}
      />
      {footer}
    </div>
  );
}
