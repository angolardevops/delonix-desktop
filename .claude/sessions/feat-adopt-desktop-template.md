---
session: 1dd5d995
opened: 2026-10-24T19:20:00+01:00
branch: feat/adopt-desktop-template
status: open
---

# Objective
Adotar o template de referência (`~/Downloads/Delonix/VM/delonix-desktop`) como
a nova base da app, trazendo-o para `apps/desktop` em vez do protótipo
Dashboard/Containers/Images, e tê-lo a compilar e a arrancar (Fase 1 de uma
migração faseada guiada pelo PROMPT.md do template).

# Done when
- [ ] `npm run build:web` passa (typecheck + vite build) com a nova base do
  template em `apps/desktop/src` (shell + 11 screens + lib + theme).
- [ ] Ao vivo: `npm run dev` serve a app e a janela/browser mostra o shell do
  template (TitleBar + Sidebar TRABALHO/OPERAR/SISTEMA + Visão geral) com o
  `MockClient` (duplo local) e a faixa de modo de desenvolvimento.
- [ ] Ao vivo: `cargo build` em `apps/desktop/src-tauri` compila a nova ponte
  (`cli.rs`/`stream.rs`/`lib.rs`) e a janela Tauri arranca com dados reais do
  engine (ou, se faltarem libs webkit, documentado o bloqueio).

# Out of scope
- Fases 2+ do PROMPT.md §13: tokens Console9, confirmar nomes de campos JSON e
  encurtar `pick()`, terminal PTY, consola de VM, Capacidades «como resolver»,
  Redes/Kubernetes ligados aos comandos, anfitrião MCP + fornecedores de modelo,
  extensões WASM, Workspaces e Registries reais.
- Remover/limpar os órfãos `crates/delonix-desktop-core` e
  `packages/design-system` (fase de consolidação própria).
- Empacotar release/.deb da nova base.

# Handoff
(pending)
