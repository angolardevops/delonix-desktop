# ADR-0001: Shell da aplicação desktop — Tauri

- **Estado:** Aceite (2026-10-24)
- **Decisores:** Walter (dono)
- **Contexto de decisão:** o brief exige um ADR a comparar Tauri e Electron
  «não escolher por popularidade ou dimensão do binário».

## Contexto

O Delonix Desktop é um cliente novo (não deriva do `delonix-console`, que é
cloud-only por ADR 0012 §5). O ecossistema é **Rust**: `delonix-runtime` e
`delonix-paas` são Rust; a camada-core do desktop (`delonix-desktop-core`) é
Rust. A pele reaproveitável (`tokens.css` com `light-dark()`, componentes,
pt-AO, xterm) é web e viaja para qualquer webview.

## Comparação

| Critério | Tauri | Electron |
|---|---|---|
| Integração com Rust | **Nativa** — comandos chamam o core directamente, sem ponte extra | Core em JS/Node; ponte N-API ou subprocess para o Rust |
| Segurança de IPC | Comandos tipados, allowlist explícita, CSP por defeito | IPC amplo; superfície maior a endurecer (contextIsolation, etc.) |
| Webview | Do SO (WebKitGTK/WebView2/WKWebView) — **menos consistência no Linux** | Chromium embutido — consistente, mas pesado |
| Terminal integrado (xterm) | OK (webview + core PTY) | OK |
| Acessibilidade | Depende do webview do SO | Chromium maduro |
| Consumo de recursos | Binário e RAM menores | Binário grande, RAM alta |
| Packaging/updates | `deb`/`appimage`/`msi`/`nsis`/`dmg`; updater assinado | maduro (electron-builder/updater) |
| Competências da equipa | Rust já domínio da casa | JS/Node |
| Coerência de filosofia | «sem Node em runtime» (console ADR 0001) | reintroduz Node |

## Decisão

**Tauri** (v2). Pesa mais a integração nativa com o core Rust, a fronteira IPC
tipada e estreita, o menor consumo, e a coerência com um ecossistema inteiramente
Rust. A pele é a mesma em qualquer webview, logo a desvantagem de Electron
(consistência Chromium) não justifica o custo.

## Consequências

- **Positivas**: um só idioma do socket ao comando; superfície de ataque menor;
  binários leves; reutilização directa de `delonix-desktop-core`.
- **Negativas / a gerir**: fragmentação do webview no Linux (WebKitGTK) — mitigar
  com matriz de versões testadas e base de browser declarada (Chrome 123 / FF 120
  / Safari 17.5, herdada da pele). **A janela exige libs de sistema**
  (`libwebkit2gtk-4.1-dev` …) que podem faltar — documentado em
  `docs/architecture/`; a arquitectura é provável sem a janela (core headless +
  `vite build`).
- **Revisão**: reabrir se a fragmentação WebKitGTK provar ser um custo de suporte
  insustentável numa distro-alvo.

## Alternativas rejeitadas

- **Electron**: consistência de webview não compensa binário/RAM, ponte extra
  para o core Rust e maior superfície de IPC.
- **Decidir após spike**: a evidência (ecossistema Rust + pele web) já é
  suficiente; um spike comparativo atrasaria sem alterar o veredicto.
