---
session: c4bbfbad-aaba-4f8f-9a3f-541318ee0381
opened: 2026-10-24T00:00:00+01:00
branch: feat/bootstrap-fase0-linux-proof
status: open
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
Concluído e commitado em `feat/bootstrap-fase0-linux-proof` (commit 2955701),
a partir de `develop`. Os 3 done-criteria observados:
- Fase 0 escrita: `docs/audit/`, `docs/architecture/`, `docs/adr/0001-0002`,
  `docs/security/`.
- Prova Linux ao vivo: `cargo test` verde (validação de args da ponte) +
  `delonix-desktop-proof --run` ao vivo (engine 5.1.1, host rootless) —
  `reports/2026-10-24-*`.
- Pele: `@delonix/design-system` consumida; `vite build` empacota o CSS.

Decisão corrige a auditoria: há **6** estados de capability (não 5) —
`requires-external-component` existe ao vivo.

Próximos (NOVAS sessões, não alargar esta):
1. Integrar `feat/bootstrap-fase0-linux-proof` → `develop` (criar remoto no
   GitHub `angolardevops/delonix-desktop` primeiro; hoje é só local).
2. Fase 1 (cont.): provas WSL2 (Windows) e VM Linux (macOS).
3. Fase 2: primeiro fluxo completo com a JANELA Tauri (requer
   `libwebkit2gtk-4.1-dev` — comando em README/docs).
4. Streaming (Exec/Console) p/ terminal integrado quando o contrato o servir.
