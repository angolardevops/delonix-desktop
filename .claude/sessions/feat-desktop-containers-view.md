---
session: 8f8b46dc-8880-4f7c-9453-12a55883dbc8
opened: 2026-10-24T17:07:31+01:00
branch: feat/desktop-containers-view
status: open
---

# Objective
Entregar a vista de Containers no Desktop (lista + detalhe + ações start/stop/rm + logs), graduando as 4 ações latentes da ponte CLI-JSON para comandos Tauri.

# Done when
- [x] `apps/desktop/src/views/Containers.tsx` existe e o rail abre-a (deixa de ser Placeholder); com a janela Tauri a correr, a lista mostra os containers reais de `delonix container ps -a -o json`
- [x] os botões start/stop/rm disparam `cli_bridge` via novos comandos Tauri e o estado na UI muda após a ação (observado ao vivo)
- [x] `delonix container logs <nome>` é visível num painel de logs (snapshot)

# Out of scope
- `logs -f` streaming (gap G1)
- abstração de transporte multi-SO do node_client (gap G4)
- integração em develop (é PR do dono; o hook recusa push/remote/merge)
- vistas de Pods/Images/Volumes/Kubernetes

# Handoff
Vista de Containers entregue e provada ao vivo neste host (janela Tauri com
GDK_BACKEND=x11 + WEBKIT_DISABLE_DMABUF_RENDERER=1, binário debug a carregar do
vite dev :5173; captura via xwd + injetor XTEST em ctypes — não há xdotool).

O que ficou:
- `cli_bridge.rs`: + `start()` (`container start`, re-arranca parados — distinto de
  `run_detached`, que cria novo a partir de imagem).
- `context.rs`: + `containers_all()`, `start_container`/`stop_container`/
  `remove_container`/`run_container` (delegam na ponte).
- `main.rs`: + comandos Tauri `container_start`/`_stop`/`_remove`/`_run`
  (registados no generate_handler!); `list_containers` passou a `containers_all`
  (inclui parados, para oferecer "Start").
- `ipc.ts`: + `startContainer`/`stopContainer`/`removeContainer`/`runContainer`.
- `Containers.tsx` (novo): lista + detalhe + ações + painel de logs; vista
  auto-contida que busca a própria lista e recarrega após cada mutação (sem
  estado otimista). `App.tsx` roteia 'containers' para ela.

Prova ao vivo (scratchpad/*.png): lista mostra 2 containers reais (03b);
Start Exited→Up + "1 a correr"→"2 a correr" + botão Start→Stop (06); logs
"ola-desktop" snapshot (05); Stop Up→Exited (09); Rm remove da lista + limpa
seleção (10). Runtime confirmado a cada passo via `container ps -a -o json`.

Gates: fmt --all --check, clippy --workspace -D warnings, build --locked, test
(2/2), typecheck, build:web — todos verdes. Tauri (workspace à parte, não gated
pelo CI por falta de webkit no runner) construído e corrido localmente, fmt+
clippy limpos.

NOTA p/ memória: a janela JÁ compila neste host (libwebkit2gtk-4.1-dev +
libsoup-3 instalados) — a nota "janela bloqueada" do bootstrap está obsoleta.

Próximo (fora de escopo desta sessão): gap G1 (`logs -f` streaming), botão/form
"Run novo container" (o comando `container_run` já está exposto, falta UI),
vistas Pods/Images/Volumes. Integração em develop é PR do dono.
