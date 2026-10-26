import { lazy, Suspense } from "react";
import type { ExecMode } from "../lib/client";

// O xterm.js (~pesado) só é preciso quando se abre mesmo um terminal. Carregá-lo
// à parte tira-o do bundle inicial (eixo D): o chunk do xterm só entra quando o
// utilizador abre o separador Terminal, não ao arrancar a app.
const Terminal = lazy(() => import("./Terminal").then((m) => ({ default: m.Terminal })));

export function LazyTerminal({ name, mode }: { name: string; mode?: ExecMode }) {
  return (
    <Suspense fallback={<div style={{ flex: 1, minHeight: 360, padding: 12, color: "var(--mut)", fontSize: 13 }}>A abrir terminal…</div>}>
      <Terminal name={name} mode={mode} />
    </Suspense>
  );
}
