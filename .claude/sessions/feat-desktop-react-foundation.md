---
session: 022de946-react-foundation
opened: 2026-10-25T02:00:00+01:00
branch: feat/desktop-react-foundation
status: open
---

# Objective
Base React sólida + UI leve (eixos C+D): ErrorBoundary, code-splitting por rota (lazy/Suspense), camada de dados partilhada (dedup/polling único por recurso em vez de N pollers), debounce de search e virtualização dos fluxos grandes.

# Done when
- [x] ErrorBoundary a envolver a app (um crash de componente mostra fallback, não tela branca); rotas carregadas com `React.lazy`+`Suspense` (bundle inicial menor); as telas/dock que leem o MESMO recurso partilham UMA só consulta (sem polling duplicado).
- [x] Search com debounce; logs/terminal/eventos e listas grandes virtualizados (ou com buffer/limite eficiente); `npm run build` com bundle inicial MENOR que o atual (576 kB num chunk → 21 chunks, inicial 206 kB).
- [x] `npm run typecheck`, `npm run build`, `npm run test`, `cargo check` verdes.

# Out of scope
- Eixo B (dashboard SRE) e eixo A (plugins SO) — fatias seguintes, assentam nesta.
- Novos verbos/backend além do mínimo.

# Handoff

Feito em `feat/desktop-react-foundation` (worktree `/tmp/wt-react-foundation`, NÃO integrada, sem push).

## Camada de dados partilhada — via escolhida: cache mínimo (opção b)
- Novo `lib/resourceStore.ts`: um `store` por CHAVE (Map global). Núcleo sem React
  (`subscribe`/`getSnapshot`/`refresh`, testável em Node). Dedup de cargas
  concorrentes (`inFlight`), UM só `setInterval` por chave no menor `everyMs`
  pedido, timer parado quando fica sem subscritores (cache mantida).
- `lib/hooks.ts`: `useResource(key, load, everyMs)` reescrito sobre
  `useSyncExternalStore` (StrictMode-safe). Assinatura ganhou `key` como 1.º arg;
  todos os ~25 call sites passam a nomear o recurso (ex.: `"workloads"`,
  `"dashboard"`, `["backups", dir]`, `["vm-snapshots", name]`).
- Porquê cache mínimo e não react-query: eixo D (leveza). Zero dependências novas
  (~1 kB vs ~12 kB gz do react-query), sem Provider a instalar, resolve
  exatamente o dedup pedido e é testável sem renderer. react-query seria maior no
  bundle inicial (usado por quase todas as telas → entraria cedo).
- Efeito: `workloads` passou de ~7 pollers paralelos para 1; `dashboard` de 3
  para 1; `providers` de 4 para 1.

## ErrorBoundary
- `components/ErrorBoundary.tsx` (class, `getDerivedStateFromError`+
  `componentDidCatch`). Barreira POR ROTA em `App.tsx` (`key={route.name}` →
  reinicia ao navegar) + barreira de ÚLTIMO recurso em `main.tsx` (shell).
  Fallback acionável "Tentar de novo"; mensagem+stack só em `import.meta.env.DEV`.

## Code-splitting + leveza (bundle)
- 15 telas → `React.lazy` + `<Suspense fallback={<ScreenLoading/>}>` em App.tsx
  (Platform agrupa 4 telas num chunk).
- xterm tirado do bundle inicial: `components/LazyTerminal.tsx` (lazy) usado pelo
  BottomDock e WorkloadDetail → chunk `Terminal` (290 kB) só carrega ao abrir um
  terminal.
- ANTES: 1 chunk app `index` 576,43 kB (gzip 160,02 kB).
  DEPOIS: `index` 205,64 kB (gzip 67,44 kB) + 20 chunks por rota/componente.
  (xterm 290 kB e Events/react-window 12,6 kB já fora do inicial.)

## Debounce + virtualização + memo
- `useDebounced` (220ms) em hooks.ts; aplicado ao search do DataTable
  (`useListView`, com reset à pág. 1) e ao filtro de logs do WorkloadDetail.
- Events virtualizado com `react-window` (`FixedSizeList`, linha memoizada,
  `useElementSize` por ResizeObserver) → só ~N linhas visíveis no DOM, não 500.
  react-window vive no chunk lazy de Events (não pesa no inicial).
- Logs (BottomDock/WorkloadDetail) mantêm buffers limitados (999/1999) — texto
  num só nó, eficiente. xterm não foi tocado.

## Gates (evidência)
- `npm run typecheck` verde · `npm run build` verde (206 kB inicial, 21 chunks)
  · `npm run test` 46/46 (6 novos em `resourceStore.test.ts`: dedup de carga,
  timer único, cleanup, re-subscribe StrictMode, snapshot estável, erro) ·
  `cargo check` (src-tauri) Finished.

## Lacunas / próximos
- Não foi possível conduzir a janela ao vivo (libwebkit2gtk runtime bloqueado);
  gates = typecheck/build/test/cargo. Recomenda-se prova ao vivo na integração.
- `resourceStore` guarda a entrada+cache por chave indefinidamente após
  desmontar (timers SÃO parados; sem fuga de timers). Se um dia as chaves forem
  muitas e dinâmicas, avaliar evicção.
