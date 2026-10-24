---
session: 022de946-ui-b
opened: 2026-10-25T01:00:00+01:00
branch: feat/desktop-ui-nav-floating
status: open
---

# Objective
UI v2 (fatia B): menu hamburger para colapsar/expandir o painel de navegação (sidebar), e painéis FLUTUANTES para a configuração do item selecionado (em vez de asides sempre presentes).

# Done when
- [x] Botão hamburger na TitleBar colapsa/expande a Sidebar (colapsada = rail de ícones com tooltip; expandida = completa); estado persistido (localStorage, reposto no arranque).
- [x] Os painéis de criação/configuração à direita (Criar segredo/volume, Puxar imagem, Aplicar/Gerar manifesto, Rodar chave, etc.) passam a FLUTUANTES (drawer deslizante da direita e/ou popover ancorado ao item selecionado), abertos por ação, com Escape/clicar-fora a fechar; o conteúdo da lista ocupa a largura toda quando o painel está fechado.
- [x] `npm run typecheck`, `npm run build`, `cargo check` verdes; sem regressão de funcionalidade nem dos testes (`npm run test` verde).

# Out of scope
- Lógica de backend / novos verbos.
- Alterar o DataTable/Select (fatia A, já feita) além do necessário para os integrar.

# Handoff
Entregue em `feat/desktop-ui-nav-floating` (worktree `/tmp/wt-ui-b`). Componentes novos e alterações:

- **`lib/focusTrap.ts`** — `FOCUSABLE` + `trapTab()` (ciclo de Tab preso) partilhados.
- **`components/Drawer.tsx`** — gaveta deslizante da direita, portal no `document.body`, backdrop, Escape/clique-fora/botão fechar, focus-trap + devolução de foco, `role=dialog aria-modal`. `z-index: 8`.
- **`components/Popover.tsx`** — popover ancorado a um `anchorRef`, reposiciona em scroll/resize, Escape/clique-fora, focus-trap. `z-index: 9`.
- **Hamburger**: botão na `TitleBar` (à esquerda, antes do logótipo) — `aria-expanded`/`aria-controls="sidebar-nav"`, tooltip, atalho **Ctrl+B**. Estado em `App.tsx` (`sidebarCollapsed`), persistido em `localStorage["delonix.sidebar.collapsed"]`, exposto no contexto (`AppCtx.sidebarCollapsed`/`toggleSidebar`). `Sidebar` ganha modo `rail` (só ícones + `title` como tooltip; rótulos/contadores escondidos; badge vira ponto).
- **Asides migrados para Drawer**: Secrets (Criar segredo), Volumes (Criar volume), Images (Puxar imagem + Construir + Limpeza), Backups (Criar backup), Platform/Kubernetes (Gerar manifesto), Platform/Registries (Autenticar), Declarativo (Aplicar manifesto + Ciclo de vida compose). Cada um abre por botão no `PageHead` ou na `toolbar`; a lista (`DataTable`) ocupa a largura toda.
- **Popover ancorado**: Secrets "Rodar" de cada linha abre um popover com o seletor de chave + confirmar.

Escala de z-index (base.css): conteúdo < drawer(8)/popover(9) < `.overlay` modais+paleta(10) < toast(20) — ConfirmDialog e CommandPalette ficam SEMPRE por cima dos flutuantes. Só tokens (tema claro/escuro via tokens.css); `--w-sidebar-rail` novo.

**Gates** (nvm node v25): `typecheck` ✅ · `build` (vite) ✅ · `test` ✅ 40/40 · `cargo check` (src-tauri) ✅.

**Lacunas / não feito (deliberado)**: asides puramente informativos/integrais ficaram SEM alterar (não são "config do item selecionado") — Networks (Diagnóstico), Build, Events, WorkloadDetail, e CreateWorkload (página-assistente cujo aside é o painel de submissão). Verificação foi por gates (janela Tauri bloqueada por libwebkit no host; prova visual ao vivo por fazer). Não integrado em develop; sem git push.
