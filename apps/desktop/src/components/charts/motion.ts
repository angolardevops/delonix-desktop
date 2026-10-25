// Utilidades de movimento e histórico para os charts.
import { useEffect, useRef, useState } from "react";

// true quando o utilizador pediu menos animação (prefers-reduced-motion).
// As animações dos charts (crescimento do arco/área) respeitam esta escolha.
export function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduce, setReduce] = useState<boolean>(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = () => setReduce(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
}

// Acumula um RASTO curto de amostras: adiciona `compute()` ao histórico sempre
// que `dep` muda de identidade (uma vez por poll do resourceStore). Limitado a
// `cap` amostras. Vive num ref, por isso não dispara re-render por si só — o
// re-render vem do poll que muda `dep`. Padrão igual ao useRowHistory dos top
// consumers, mas genérico e para séries ao nível do Overview. Se `compute`
// devolver null/undefined a amostra é ignorada (não suja a série com zeros
// enquanto os dados ainda não chegaram).
export function useTrail<T>(dep: unknown, compute: () => T | null | undefined, cap = 40): T[] {
  const ref = useRef<{ last: unknown; buf: T[]; init: boolean }>({ last: undefined, buf: [], init: false });
  if (!ref.current.init || dep !== ref.current.last) {
    ref.current.init = true;
    ref.current.last = dep;
    const v = compute();
    if (v != null) {
      const next = ref.current.buf.concat(v);
      ref.current.buf = next.length > cap ? next.slice(next.length - cap) : next;
    }
  }
  return ref.current.buf;
}
