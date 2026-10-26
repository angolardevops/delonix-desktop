import { Component, type ErrorInfo, type ReactNode } from "react";

// Barreira de erro: um `throw` em QUALQUER componente filho deixava a app em
// branco (tela branca — já vimos isto a sério). Esta classe apanha o erro,
// mostra um fallback acionável e permite recuperar sem recarregar a janela.
//
// Tem de ser class component: o `getDerivedStateFromError`/`componentDidCatch`
// não têm equivalente em hooks. Em dev mostra a mensagem+stack para diagnóstico.

interface Props {
  children: ReactNode;
  // Chamado ao "tentar de novo" (ex.: limpar estado da rota). Opcional.
  onReset?: () => void;
  // Fallback alternativo (ex.: ecrã inteiro no topo da app). Por omissão usa o
  // painel padrão abaixo.
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Em runtime (Tauri) não há consola do browser visível; o registo ajuda o
    // diagnóstico quando se liga o devtools. Em dev o overlay do Vite já mostra.
    console.error("ErrorBoundary apanhou um erro:", error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return (
      <div
        role="alert"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 12,
          padding: 32,
          maxWidth: 680,
          margin: "0 auto",
        }}
      >
        <h2 style={{ margin: 0 }}>Algo correu mal</h2>
        <p style={{ margin: 0, color: "var(--tx2)" }}>
          Esta área da aplicação encontrou um erro inesperado. Os teus dados e o engine não foram afetados.
        </p>
        <button className="btn pri" type="button" onClick={this.reset}>
          Tentar de novo
        </button>
        {import.meta.env.DEV && (
          <pre
            className="log"
            style={{ alignSelf: "stretch", margin: 0, padding: 12, maxHeight: 280, overflow: "auto", fontSize: 12 }}
          >
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ""}
          </pre>
        )}
      </div>
    );
  }
}
