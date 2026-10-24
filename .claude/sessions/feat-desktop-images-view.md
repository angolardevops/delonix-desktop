---
session: 1dd5d995
opened: 2026-10-24T18:37:15+01:00
branch: feat/desktop-images-view
status: open
---

# Objective
Entregar a ação de **pull** na vista de Images do Desktop: puxar uma imagem
nova pela UI e vê-la aparecer na lista, pela ponte CLI-JSON (`delonix image
pull <ref>`), continuando a mesma branch da lista+rm (um só PR).

# Done when
- [x] A ponte tem `pull_image()` (`image pull <ref>`, validado por
  `validate_ref`, análogo a `remove_image`) exposto em `context.rs`, no comando
  Tauri `image_pull` (em `generate_handler!`) e em `ipc.ts` (`pullImage`); o
  crate e a app compilam (`cargo build` em `apps/desktop/src-tauri`).
  **Provado 2026-10-24:** `cargo build` Finished + `npm run typecheck` sem erros.
- [x] O cabeçalho de `Images.tsx` tem um campo de referência + botão «Pull» com
  estado «A puxar…», que não declara falha num poll cedo. **Provado ao vivo
  2026-10-24:** cabeçalho renderiza campo «repositório:tag» + botão «Pull»; o
  pull de `debian:12` (48.5 MB) demorou vários segundos e a UI esperou até ao
  fim sem erro, limpando o campo só no sucesso. (O frame transitório «A puxar…»
  não é fotografável via `XGetImage` por o WebKitGTK em software rendering —
  DMABUF off — não atualizar o buffer X durante o pull; limitação de captura,
  não de comportamento.)
- [x] Ao vivo (janela Tauri): puxar uma imagem ausente fá-la aparecer na lista
  após o refresh, confirmado por `delonix image ls -o json`. **Provado ao vivo
  2026-10-24:** quatro pulls pela UI — `hello-world:latest` (25→26),
  `alpine:3.20` (26→27), `caddy:2-alpine` (27→28), `debian:12` (28→29) — cada
  um apareceu no topo da lista após o refresh, confirmado pela CLI.

# Out of scope
- Outras ações de imagem (tag/prune/scan/describe/history).
- `--verify <PEM>` (assinatura cosign) no pull — só a forma comum `pull <ref>`.
- Alterar o contrato `node.v1`/raiz `/v1` para anunciar imagens.

# Handoff
(pending)
