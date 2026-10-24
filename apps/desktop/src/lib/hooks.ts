import { useCallback, useEffect, useRef, useState } from "react";

// Lê um recurso e volta a ler de `everyMs` em `everyMs`. Sem daemon no engine,
// o polling curto do CLI é o modelo correto; eventos chegam por `system events -f`.
export function useResource<T>(load: () => Promise<T>, everyMs = 5000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const refresh = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!everyMs) return;
    const t = setInterval(() => void refresh(), everyMs);
    return () => clearInterval(t);
  }, [refresh, everyMs]);

  return { data, error, refresh };
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
