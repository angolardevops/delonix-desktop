import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { getSnapshot, normKey, subscribe, type ResourceKey, type Snapshot } from "./resourceStore";

// Lê um recurso e volta a ler de `everyMs` em `everyMs`. Sem daemon no engine,
// o polling curto do CLI é o modelo correto; eventos chegam por `system events -f`.
//
// Agora assenta num STORE PARTILHADO por `key` (ver lib/resourceStore.ts): todos
// os consumidores da MESMA chave partilham uma carga deduplicada e UM só timer
// (no menor `everyMs` pedido). `key` nomeia o recurso — inclui os parâmetros
// quando os há (ex.: `["backups", dir]`, `["vm-snapshots", name]`).
export function useResource<T>(key: ResourceKey, load: () => Promise<T>, everyMs = 5000): Snapshot<T> {
  const k = normKey(key);
  const loadRef = useRef(load);
  loadRef.current = load;
  // Closure estável: o store guarda esta referência mas invoca sempre o load
  // mais recente (útil quando o load fecha sobre props/estado mutáveis).
  const stableLoad = useCallback(() => loadRef.current(), []);
  const sub = useCallback((cb: () => void) => subscribe(k, stableLoad, everyMs, cb), [k, everyMs, stableLoad]);
  const get = useCallback(() => getSnapshot<T>(k), [k]);
  return useSyncExternalStore(sub, get, get);
}

// Atrasa a propagação de um valor até estabilizar `delayMs` (ex.: não filtrar a
// cada tecla). O valor imediato continua a alimentar o <input>; só o derivado
// usado no filtro é que espera.
export function useDebounced<T>(value: T, delayMs = 220): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return v;
}

// Mede um elemento (ResizeObserver) para dar altura/largura a listas
// virtualizadas sem depender de bibliotecas de auto-sizing. StrictMode-safe: o
// observer é desligado no cleanup.
export function useElementSize<E extends HTMLElement>(): [RefObject<E>, { width: number; height: number }] {
  const ref = useRef<E>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setSize((s) => (s.width === r.width && s.height === r.height ? s : { width: r.width, height: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

export const fmtBytes = (n: number | null | undefined) => {
  if (n == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0).replace(".", ",")} ${u[i]}`;
};

// O engine devolve o estado já reconciliado ("Up 3d", "Exited (137)…").
export type RunState = "running" | "error" | "stopped";
export const runState = (status: string): RunState => {
  const s = status.toLowerCase();
  if (s.startsWith("up") || s === "running") return "running";
  const code = /exited \((\d+)\)/.exec(s)?.[1];
  if (code && code !== "0") return "error";
  return "stopped";
};
export const isOom = (status: string) => /\(137\)/.test(status);
