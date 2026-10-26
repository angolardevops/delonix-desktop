// Fronteira LAZY do YamlView. Importa o visor (e com ele o monaco-editor +
// monaco-yaml + workers) por `React.lazy`, para que todo esse peso fique num
// chunk à parte, carregado SÓ quando um visor de YAML aparece no ecrã — nunca no
// bundle inicial. Os consumidores (Studio, Declarativo, ClusterDetail) importam
// daqui; este módulo é leve (não arrasta o monaco).
import { lazy, Suspense } from "react";
import type { YamlViewProps } from "./YamlView";

const Inner = lazy(() => import("./YamlView"));

export type { YamlViewProps } from "./YamlView";

export function YamlView(props: YamlViewProps) {
  const h = props.height != null ? props.height : "100%";
  return (
    <Suspense
      fallback={
        <div
          style={{ height: h, minHeight: props.minHeight ?? 160, display: "grid", placeItems: "center", border: "1px solid var(--line)", borderRadius: 6, background: "#0f1114", color: "var(--mut)", fontSize: 12 }}
        >
          A carregar o visor…
        </div>
      }
    >
      <Inner {...props} />
    </Suspense>
  );
}
