# Fase 0 — Auditoria consolidada do ecossistema

> Data: 2026-10-24. Método: inspecção de código (não de README) dos quatro
> repositórios em `/home/walter/workspaces/NgolaCloud/projects`, mais prova
> técnica ao vivo neste host (`reports/2026-10-24-linux-vertical-slice.md`).
> Toda a evidência cita `ficheiro:linha` no repositório de origem.

## 1. Mapa dos repositórios e fronteiras

| Repositório | Papel real (evidência) | Fronteira com o desktop |
|---|---|---|
| **delonix-runtime** | Motor local em Rust, 5 camadas clean-arch (`crates/{foundation,adapters,contexts,interfaces,providers}`). Expõe 4 superfícies de **socket Unix local** (`0600`, `SO_PEERCRED`): `node-api`, `mgmt` (legado), `CRI`, Docker-API (fatia). | **Backend do contexto LOCAL.** O desktop é cliente do `node-api` + ponte CLI. |
| **delonix-paas** | Control plane cloud. `/v2` REST canónico (278 ops; `crates/delonix-api`), device-flow RFC 8628 (`crates/delonixctl/src/auth.rs`), envelope ADR 0020. | **Backend do contexto REMOTO.** O desktop segue o padrão `delonixctl`. |
| **delonix-console** | SPA cloud multi-tenant (React 19 / Vite 8). **ADR 0012 §5 proíbe** falar com o motor local; só `/v2`. | **Não é base.** Reaproveitar só a *pele* (design system, i18n pt-AO, domains puros). |
| **delonix-deploy** | IaC do substrato (Proxmox→K8s→Longhorn→PaaS). Sem qualquer WSL. | **Fora de âmbito** no 1.º incremento. Integração cloud é via API do PaaS, não playbooks (atravessar a fronteira violaria `README.md:71-85`). |

## 2. O contrato cliente↔runtime (o achado estruturante)

O `delonix-runtime/proto/README.md` diz «nothing serves these yet» — **está
obsoleto**. O contrato versionado **`delonix.node.v1`** já é servido hoje
(`crates/interfaces/delonix-node-api/src/lib.rs:1-70`), e foi **provado ao vivo**
(engine 5.1.1).

- **Transporte**: gRPC **e** HTTP/JSON no **mesmo socket Unix**. Não é um
  daemon: arranca por **socket-activation do systemd** (`LISTEN_FDS`) e sai após
  `--idle-timeout` (ADR-0040 P5; `bins/delonix-node-api-bin/src/main.rs`). **O
  modelo daemonless é preservado.**
- **Erros**: gRPC → `google.rpc.Status`; REST → **RFC 9457 `problem+json`** com
  códigos `DX-` (os mesmos exit codes da CLI). `GET /openapi.json`, `/docs`,
  `/redoc` embebidos.
- **Servido hoje** (confirmado em `/v1`, ver report): `NodeService`
  (`GetApiRoot`/`GetNodeInfo`/`GetHealth`/`GetCapacity`/**`ListProviders`**/
  **`WatchEvents`**), `NetworkService` (CRUD), `VolumeService`,
  **`VirtualMachineService` completo** (ciclo de vida + snapshots),
  `OperationService` (ledger assíncrono, idempotency-key, etag).
- **Ainda NÃO servido**: `ContainerService`, `PodService` → respondem **501
  DX-6001** (a raiz `/v1` não os anuncia — confirmado ao vivo). `Exec`/`Console`
  são stream **só gRPC** (sem REST/WebSocket).

### 2.1 Ponte CLI-JSON (ADR-0005)
Para o que o contrato não serve, a CLI dá saída JSON com **nomes de campo
estáveis e independentes de língua** (`-o json`): `container ps -o json`,
`workload ls -o json`, `image ls -o json`, `provider ls -o json`. É a ponte
honesta até `ContainerService` aterrar. Validada ao vivo (ciclo completo de um
container + logs).

### 2.2 Eventos
Bus = ficheiro `<root>/events.jsonl` (append + rotação). Lê-se por
`NodeService.WatchEvents` (gRPC, poll 200ms, `since`+filtro `kinds`) ou tail
directo. Provado ao vivo via `delonix system events`.

### 2.3 Capacidades (o diferenciador)
Catálogo **machine-readable** `crates/contexts/delonix-compute/src/capability.rs`
(`CATALOG_VERSION=1.4.0`, ~150 capabilities, 12 domínios), exposto por
`ListProviders` e por `provider ls -o json`, com um teste que falha se divergir
da matriz publicada. **Medido ao vivo: 549 entradas em 6 estados** — `supported`
(106), `partial` (92), `not-implemented` (72), `unsupported-by-provider` (230),
`requires-external-component` (12), `unavailable-on-host` (3).

> **Correcção à auditoria inicial:** são **6** estados, não 5 — o live expôs
> `requires-external-component`. É esta matriz que dá **feature-gating honesto**
> à UI, algo que nem Docker nem Podman Desktop têm.

## 3. Contexto remoto (cloud) — padrão delonixctl

- **Auth**: OAuth 2.0 **Device Authorization Grant** (RFC 8628). Token Bearer
  (JWT Ed25519 opaco ao cliente) em `~/.delonix/auth.json` (`0600`). Referência:
  `delonix-paas/crates/delonixctl/src/auth.rs`.
- **Tenant** nunca é enviado pelo cliente: deriva da identidade autenticada
  (ADR 0020 §3). Recursos referenciados por **id estável prefixado** (`vm_`,
  `app_`, …), não por nome.
- **Operações assíncronas**: `/v2/operations/{id}` + `status.generation` para
  «está pronto?». Idempotency-key em mutações.
- **Limitação para geração de cliente**: só 53 schemas em 278 ops no
  `openapi.json`; muitos handlers devolvem `serde_json::Value`. Gera-se o cliente
  de *rotas*, com payloads livres onde faltam tipos.

## 4. Reutilização do delonix-console (pele, não motor)

- **Reaproveitável**: design system (`src/shared/ui/tokens.css`, 44 tokens com
  `light-dark()`), componentes `shared/ui`+`dataview`, i18n **pt-AO por omissão**,
  `@xterm/xterm`, domains puros (zero React/rede/DOM).
- **Descartável para desktop**: toda a camada `shared/api` (acoplada a `/v2`
  cloud, proibida de falar com o motor local), features cloud-tenant
  (quotas/billing/iam/signup).
- **Mecanismo escolhido**: novo repo `delonix-desktop` + package partilhado
  `@delonix/design-system` derivado do console (ver ADR-0001).

## 5. Implicações para a arquitectura do desktop

1. Falar o **`node-api`** para leituras/estado/capacidades/VMs/operações; **ponte
   CLI-JSON** para containers/pods até `ContainerService` aterrar — numa única
   camada (`LocalContext`) para a UI não notar a diferença.
2. **Feature-gating** pela matriz de capabilities (6 estados) — a UI oferece só o
   que é `supported`, e explica o resto (nunca esconde atrás de cor).
3. **Dois contextos**: LOCAL (socket Unix do runtime) e REMOTO (paas `/v2`,
   device-flow). O socket do node-api é o **contrato host↔guest universal**
   (local no Linux; encaminhado em WSL2/macOS).
4. **Shell Tauri** (Rust, alinhado com runtime/paas) com a pele do console.
