# ADR-0002: Contratos consumidos e modelo de contextos

- **Estado:** Aceite (2026-10-24)
- **Decisores:** Walter (dono)

## Contexto

O desktop tem de observar e operar workloads locais (estilo Docker/Podman
Desktop) e, mais tarde, recursos cloud. A auditoria (ver `docs/audit/`) mostrou:

1. O runtime expõe o contrato versionado **`delonix.node.v1`** (gRPC + HTTP/JSON
   em socket Unix, socket-activated), mas **ainda não serve containers/pods**
   (501 DX-6001); serve node/health/capacity/providers/eventos/VMs/redes/volumes/
   operações.
2. A CLI dá **saída JSON estável** (ADR-0005) para tudo, incluindo containers.
3. O cloud (`delonix-paas`) expõe `/v2` com **device-flow RFC 8628** e envelope
   ADR 0020 — o padrão do `delonixctl`.

## Decisão

### Contrato local: node-api primeiro, ponte CLI-JSON onde falta
- Ler estado/capacidades/VMs/operações pelo **`node-api`**
  (`NodeClient`, HTTP/JSON sobre o socket).
- **Containers/pods pela ponte CLI-JSON** (`CliBridge`, `delonix … -o json`) até
  `ContainerService` aterrar no contrato.
- A escolha vive num único sítio — **`LocalContext`** — que consulta a raiz
  hipermédia (`/v1`): se `containers` passar a ser anunciado, troca-se a
  implementação **sem mudar a UI**.

### Eventos e operações
- Eventos por `WatchEvents` / tail de `events.jsonl`.
- Operações longas por `OperationService` (etag + idempotency-key no retry).

### Contexto remoto (Fase 4): padrão delonixctl
- `RemoteContext` fala `/v2` com Bearer (device-flow), token em
  `~/.delonix/auth.json`. Tenant **deriva do token**, nunca do cliente. Recursos
  por **id estável** (`vm_`, `app_`, …), não por nome.

### Segurança da fronteira
- Socket Unix `0600` + `SO_PEERCRED` é a autorização local (loopback não é).
- A ponte CLI passa **argumentos separados** e valida nomes/refs
  (`validate_name`/`validate_ref`) — nunca constrói shell a partir de texto.

## Consequências

- **Positivas**: a UI é estável perante a evolução do contrato; migração
  container-CLI→contrato é uma mudança interna; segurança explícita na fronteira.
- **Negativas / a gerir**: dependência do binário `delonix` e do seu formato JSON
  (risco de drift — mitigado por DTOs tolerantes `#[serde(default)]` e testes);
  streaming (Exec/Console) ainda sem transporte REST — terminal fica para a
  Fase 3.
- **Prova**: `delonix-desktop-proof` valida o caminho completo ao vivo
  (`reports/2026-10-24-*`).

## Alternativas rejeitadas

- **Só CLI** (como alguns clientes): perde o contrato versionado, capacidades
  machine-readable e operações assíncronas — a parte que distingue este runtime.
- **Só node-api já**: impossível hoje (containers 501).
- **Docker Engine API (fatia do runtime)**: compat parcial; não expõe o catálogo
  de capabilities nem o modelo de operações — é ponte de adopção, não o contrato
  primário.
