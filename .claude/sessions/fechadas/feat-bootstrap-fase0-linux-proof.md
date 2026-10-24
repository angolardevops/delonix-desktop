---
session: c4bbfbad-aaba-4f8f-9a3f-541318ee0381
opened: 2026-10-24T00:00:00+01:00
branch: feat/bootstrap-fase0-linux-proof
status: closed
closed: 2026-10-24T12:02:12+01:00
---

# Objective
Arrancar o repo delonix-desktop (shell Tauri, pele partilhada do console) com a Fase 0 escrita e uma prova técnica Linux ao vivo que valida a arquitectura cliente↔node-api neste host rootless.

# Done when
- [x] Repo delonix-desktop criado (main+develop, branch de trabalho a partir de develop) com os artefactos da Fase 0 commitados: auditoria consolidada, matriz de lacunas (Capacidade→evidência→estado→alvo→dependências→risco→teste), arquitectura + diagramas de fronteira, ADR-0001 (shell=Tauri, comparação Tauri/Electron), ADR-0002 (contratos & contextos: node-api local + ponte CLI-JSON + paas /v2 remoto), threat model inicial.
- [x] Prova técnica Linux ao vivo: a camada-core do desktop liga ao node-api delonix.node.v1 deste host, lê ListProviders+capabilities, segue eventos (events.jsonl/system events), e corre um container via ponte CLI-JSON mostrando logs — evidência em reports/ (`delonix-desktop-proof --run`).
- [x] Pele partilhada: package de design system derivado do console (tokens.css + light-dark() + componente CapabilityBadge) consumido pela app desktop (vite build empacota o CSS).

# Out of scope
- Provas Windows (WSL2) e macOS (Apple Virtualization).
- UI completa de todas as áreas de navegação (Overview/Images/Volumes/Networks/Stacks/VMs/K8s/Settings).
- Packaging, assinatura, notarização, auto-update.
- Integração cloud /v2 completa (device-flow só esboçado em docs, não funcional).
- Workload VMs / Kubernetes / GPU.
- Extensões / marketplace.

# Handoff
Delivered: Repo `delonix-desktop` novo (main+develop, trabalho em `feat/bootstrap-fase0-linux-proof`, HEAD 6af097a). (1) Fase 0 escrita e commitada: `docs/audit/00-auditoria-consolidada.md`, `docs/audit/01-matriz-de-lacunas.md`, `docs/architecture/00-arquitectura.md` (diagramas de fronteira mermaid), `docs/adr/0001-shell-tauri.md`, `docs/adr/0002-contratos-e-contextos.md`, `docs/security/00-threat-model.md`. (2) Camada-core `crates/delonix-desktop-core` (NodeClient UDS + CliBridge + LocalContext + model) — `cargo test` = 2 passed; binário `delonix-desktop-proof --run` validado AO VIVO (engine 5.1.1, host rootless Zorin 18): lê providers/549 caps/6 estados, corre busybox pela ponte CLI-JSON, logs tick 1/2/3, 0 órfãos — evidência em `reports/2026-10-24-*`. (3) Pele `@delonix/design-system` (tokens light-dark() + CapabilityBadge) consumida pela app; `npm run build -w @delonix/desktop-app` empacota o CSS; typecheck verde.
Not delivered: Nada em aberto nos 3 critérios. Explicitamente fora de âmbito (não iniciado): janela Tauri a correr (bloqueada por `libwebkit2gtk-4.1-dev` ausente — comando sudo em README), provas WSL2/macOS, UI completa, cloud /v2 funcional, packaging.
Learned: (a) `proto/README.md` do runtime («nothing serves these yet») está OBSOLETO — `delonix.node.v1` já serve node/health/capacity/providers/eventos/VMs/redes/volumes/operações; containers/pods dão 501 DX-6001 (raiz `/v1` não os anuncia). (b) São **6** estados de capability ao vivo, não 5 (`requires-external-component` existe). (c) `delonix serve node-api` exige o bin `delonix-node-api` ao lado do `delonix` instalado, senão DX-6000 (EX_UNAVAILABLE); correr o bin do `target/debug|release` directamente, ou `DELONIX_SERVER_FROM_PATH=1`. (d) node via nvm (v25); webkit2gtk NÃO existe como pacote — é `libwebkit2gtk-4.1-dev` em Zorin/noble. (e) verbos de topo `run`/`logs` não existem nesta build 5.1.1 (só `container run/logs`).
Next session: Criar o remoto GitHub `angolardevops/delonix-desktop` e integrar `feat/bootstrap-fase0-linux-proof` em `develop`.
