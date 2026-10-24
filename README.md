# Delonix Desktop

A aplicação desktop oficial do ecossistema **Delonix / N'GolaCloud** — um cliente
para o motor **rootless-first, daemonless-by-default**, inspirado na experiência
do Docker Desktop e do Podman Desktop, sem copiar identidade visual.

> Estado: **Fase 0 (arranque) concluída** + prova técnica Linux ao vivo.
> Ver `docs/` e `reports/`.

## O que já existe

- **`crates/delonix-desktop-core`** — camada-core em Rust (sem GUI): cliente do
  contrato `delonix.node.v1` sobre socket Unix (`NodeClient`) + ponte CLI-JSON
  (`CliBridge`), compostos em `LocalContext`. É o backend dos comandos Tauri.
- **`crates/delonix-desktop-core` → `delonix-desktop-proof`** — binário headless
  que prova o caminho cliente↔runtime ao vivo (lê providers/capabilities, corre
  um container, lê logs, limpa). `cargo run --bin delonix-desktop-proof -- --run`.
- **`packages/design-system`** (`@delonix/design-system`) — pele partilhada
  derivada do `delonix-console`: tokens `light-dark()`, estados de capability,
  componente `CapabilityBadge`.
- **`apps/desktop`** — shell Tauri (v2) + frontend React 19 que consome a pele.
  O frontend compila/empacota (`vite build`); a **janela** exige libs de sistema
  (ver abaixo).

## Arquitectura em uma frase

O desktop é um **cliente**: fala o contrato `node-api` para estado/capacidades/
VMs/operações e a **ponte CLI-JSON** para containers/pods (até `ContainerService`
aterrar), por uma camada-core Rust única que o shell Tauri expõe ao webview por
IPC tipado. Dois contextos: **LOCAL** (runtime no socket Unix) e **REMOTO**
(paas `/v2`, device-flow — Fase 4). Ver `docs/architecture/` e `docs/adr/`.

## Desenvolvimento

```bash
# core + prova (precisa de um node-api a servir — ver reports/)
cargo test
cargo run --bin delonix-desktop-proof -- --run

# frontend (pele)
npm install
npm run build -w @delonix/desktop-app
```

### Janela Tauri (Linux) — pré-requisitos de sistema

A janela precisa do webview do SO. Em Ubuntu/Zorin «noble»:

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

Sem isto, a arquitectura continua provável (core headless + `vite build`).

## Documentação

- `docs/audit/` — auditoria consolidada e matriz de lacunas.
- `docs/architecture/` — camadas, fronteiras de confiança, runtime machines.
- `docs/adr/` — ADR-0001 (shell=Tauri), ADR-0002 (contratos & contextos).
- `docs/security/` — threat model.
- `reports/` — evidência das provas ao vivo.
