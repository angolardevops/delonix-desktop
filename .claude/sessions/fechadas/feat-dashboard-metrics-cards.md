---
session: 6b29c5ed-846a-4c0a-a16b-d1c6bd5678aa
opened: 2026-10-24T15:00:00+01:00
branch: feat/dashboard-metrics-cards
status: open
---

# Objective
Enriquecer a vista Dashboard com uma grelha de cartões de métricas ao estilo Podman Desktop (contagem por recurso), lendo as contagens do runtime vivo — providers por `/v1`, containers/pods/images/volumes pela ponte CLI-JSON.

# Done when
- [x] A vista Dashboard mostra uma grelha de cartões de métricas (Containers, Pods, Images, Volumes, Providers ativos) acima do bloco de providers, com números lidos do runtime vivo. — IPC `resource_counts` (ponte CLI-JSON: container ps [-a], get pods, image ls, volume ls -o json) + providers de `/v1`; MetricCard local; confirmado por captura.
- [x] `npm run build:web` passa (rc=0) e `cargo check -p delonix-desktop-core` compila. — ambos rc=0; também fmt/clippy/test do core verdes e fmt do src-tauri verde.
- [x] Em modo dev (sem Tauri) os cartões mostram os valores do duplo com a faixa âmbar, sem crashar. — captura em :5173: 6 (3 a correr)/0/25/27/2-de-3 com faixa «Modo de desenvolvimento».

# Out of scope
- Tornar os cartões clicáveis/navegáveis para as respetivas vistas — fase seguinte.
- Vistas Containers/Pods/Images/Volumes com tabelas e ações reais.
- Build da janela Tauri completa (bloqueada por libwebkit2gtk-4.1-dev neste host).
- Renomear jobs de CI ou mexer no root Cargo.toml.
- push / PR / merge (ação do dono).

# Handoff
(a preencher no fecho)
