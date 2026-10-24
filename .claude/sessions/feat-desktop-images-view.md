# Sessão: vista de Images no Desktop

**Ramo:** `feat/desktop-images-view` (de `bcc9b46`, base release/v0.1.0)
**Aberta:** 2026-10-24

## Objetivo

Entregar a vista de **Images** no Desktop (lista + detalhe + ação rm) seguindo
o padrão da vista de Containers, falando pela ponte CLI-JSON (`delonix image
ls -o json` / `image remove`), já que o contrato `node.v1` ainda não serve
imagens.

## Done when (observável)

- [x] `apps/desktop/src/views/Images.tsx` existe e o rail roteia `'images'`
  para ela (deixa de ser Placeholder); com a janela Tauri a correr
  (`GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1`), a lista mostra as
  imagens reais de `delonix image ls -o json`. **Provado ao vivo 2026-10-24:**
  janela a renderizar a vista Images com 25 imagens reais (alpine/redis/
  postgres/wordpress/…).
- [x] A ação rm dispara o comando Tauri `image_remove` → `cli_bridge` e a
  imagem desaparece da lista (observado ao vivo, confirmado por
  `delonix image ls -o json`). **Provado ao vivo 2026-10-24:** rm de
  `busybox:latest` pela UI → lista passou de 25 a 24, imagem ausente em
  `delonix image ls -o json`; host reposto com re-pull.

## Fora de escopo

- Ações de imagem além de rm (pull/tag/prune/scan/describe/history).
- Alterar o contrato `node.v1`/raiz `/v1` para anunciar imagens.
- A vista de Containers (já entregue) e restantes rails (Pods/Volumes/etc.).
