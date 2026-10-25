import React from "react";
import ReactDOM from "react-dom/client";
// Fontes empacotadas com a app: a app funciona offline.
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./theme/tokens.css";
import "./theme/base.css";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Barreira de ÚLTIMO recurso: um crash no próprio shell (fora das rotas)
        nunca deixa a janela em branco. "Tentar de novo" recarrega a janela. */}
    <ErrorBoundary fallback={(error, reset) => <TopLevelCrash error={error} reset={reset} />}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

function TopLevelCrash({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start", padding: 40, maxWidth: 680 }}>
      <h1 style={{ margin: 0, fontSize: 20 }}>A aplicação encontrou um erro</h1>
      <p style={{ margin: 0, color: "var(--tx2)" }}>Podes tentar recuperar sem fechar a janela.</p>
      <button className="btn pri" type="button" onClick={reset}>Tentar de novo</button>
      {import.meta.env.DEV && (
        <pre className="log" style={{ alignSelf: "stretch", margin: 0, padding: 12, maxHeight: 320, overflow: "auto", fontSize: 12 }}>
          {error.message}
          {error.stack ? `\n\n${error.stack}` : ""}
        </pre>
      )}
    </div>
  );
}
