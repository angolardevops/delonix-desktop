# Fase 0 — Matriz de lacunas

**Capacidade → evidência no código → estado actual → alvo → dependências → risco → teste de aceitação.**

> Estados: ✅ implementado · 🟡 parcial · ⬜ planeado · 🔌 ponte (via CLI-JSON).
> «Evidência» cita o repositório de origem. Datado 2026-10-24, engine 5.1.1.

## A. Contrato local (node-api `delonix.node.v1`)

| Capacidade | Evidência | Estado | Alvo (desktop) | Dependências | Risco | Teste de aceitação |
|---|---|---|---|---|---|---|
| Raiz hipermédia / descoberta | `delonix-node-api/src/lib.rs`; `GET /v1` ao vivo | ✅ | Descobrir recursos servidos e feature-gate pela raiz | socket activo | baixo | `delonix-desktop-proof` lê `api_version` e links ✔ (feito) |
| NodeInfo / Health / Capacity | `src/{node}.rs`; ao vivo | ✅ | Overview do nó | — | baixo | proof: 4/4 health, workloads ✔ (feito) |
| Providers + capabilities (6 estados) | `capability.rs` v1.4.0; `/v1/providers` ao vivo | ✅ | Feature-gating da UI | — | médio (catálogo evolui) | proof: histograma + accionáveis ✔ (feito) |
| Eventos em tempo real | `delonix-node-api/src/events.rs` (`WatchEvents`, `events.jsonl`) | ✅ | Stream para a UI | transporte streaming | médio | tail `events.jsonl` ✔; `WatchEvents` gRPC ⬜ |
| Operações assíncronas | `operations.rs` (ledger, etag, idempotency; sem `Cancel`) | ✅ | Progresso de ops longas | — | baixo | ⬜ UI de operações |
| VMs (ciclo de vida + snapshots) | `VirtualMachineService`; `vm_ops.rs` | ✅ | Área «Workload VMs» | — | médio | ⬜ (Fase 5) |
| Redes / Volumes (CRUD) | `NetworkService`/`VolumeService` | ✅/🟡 | Áreas Networks/Volumes | — | baixo | ⬜ (Fase 3) |
| **Containers / Pods** | `lib.rs` → 501 DX-6001; raiz não anuncia | ⬜→🔌 | Área Containers **via ponte CLI-JSON** | CLI `-o json` | **alto** (dependência da CLI) | proof `--run`: ps/logs/cleanup ✔ (feito) |
| Exec / Console (terminal) | stream gRPC-only; REST por fazer | 🟡 | Terminal integrado (xterm) | WebSocket/gRPC-web | alto | ⬜ (Fase 3) |
| Métricas / séries temporais | `usage.rs` «daemonless, nada acordado» | ⬜ | Gráficos | polling no desktop | médio | ⬜ |

## B. Ponte CLI-JSON (ADR-0005)

| Capacidade | Evidência | Estado | Alvo | Dependências | Risco | Teste |
|---|---|---|---|---|---|---|
| `container ps/run/stop/rm/logs` | CLI 5.1.1; `cmd/container.rs` | ✅ | Operar containers | binário `delonix` no host | médio (drift CLI) | proof `--run` ✔ (feito) |
| `workload ls -o json` (container+VM) | `cmd/workload.rs:357` | ✅ | Lista unificada | — | baixo | ⬜ |
| `image ls/pull -o json` | `cmd/image.rs:825` | ✅ | Área Images | — | baixo | ⬜ (Fase 3) |
| `compose up/down/config` | `cmd/compose.rs` | ✅ | Área Stacks | — | médio | ⬜ (Fase 4) |
| Validação de argumentos (sem shell) | `cli_bridge.rs::validate_*` | ✅ | Segurança IPC | — | baixo | testes unit ✔ (feito) |

## C. Contexto remoto (paas `/v2`)

| Capacidade | Evidência | Estado | Alvo | Dependências | Risco | Teste |
|---|---|---|---|---|---|---|
| Device-flow (RFC 8628) | `delonixctl/src/auth.rs:100-215` | ✅ (no paas) | Login cloud | — | médio | ⬜ (Fase 4) |
| Token em `~/.delonix/auth.json` | `auth.rs:21-63` | ✅ | Reutilizar sessão CLI | — | baixo | ⬜ |
| Operações assíncronas `/v2/operations` | `delonix-api/src/ui/*` | ✅ | Deploys remotos | — | médio | ⬜ |
| OpenAPI p/ gerar cliente | `assets/openapi.json` (53/278 schemas) | 🟡 | Tipos do cliente | schemas em falta | alto | ⬜ |
| Multi-contexto nomeado (kubeconfig-like) | ausente (`remote_exec.rs`) | ⬜ | Gestor de contextos | ficheiro próprio | médio | ⬜ |

## D. Shell desktop e pele

| Capacidade | Evidência | Estado | Alvo | Dependências | Risco | Teste |
|---|---|---|---|---|---|---|
| Camada-core (cliente+ponte) | `crates/delonix-desktop-core` | ✅ | Backend dos comandos Tauri | serde | baixo | `cargo test` + proof ✔ (feito) |
| Shell Tauri (janela) | `apps/desktop/src-tauri` | 🟡 | App nativa | **libwebkit2gtk-4.1-dev** (ausente) | médio | ⬜ build bloqueado — ver docs/architecture |
| Frontend React + pele | `apps/desktop`; `vite build` ✔ | ✅ | UI | node/npm | baixo | typecheck+build ✔ (feito) |
| Design system partilhado | `packages/design-system` | ✅ | Pele coerente | — | baixo | typecheck ✔ (feito) |

## E. Multiplataforma (fora do 1.º incremento)

| Capacidade | Estado | Alvo | Risco | Teste |
|---|---|---|---|---|
| Linux nativo rootless | ✅ provado | Caminho primário | baixo | proof ao vivo ✔ (feito) |
| Windows (WSL2 dedicado) | ⬜ | Runtime machine | alto | ⬜ (Fase 1 cont.) |
| macOS (Apple Virtualization) | ⬜ | Runtime machine | alto | ⬜ (Fase 1 cont.) |
| Packaging/assinatura/update | ⬜ | Release | alto | ⬜ (Fase 6) |

## Riscos transversais principais

1. **Dependência da CLI para containers** (alto) — mitigado por camada única
   `LocalContext` que migra para `ContainerService` sem mexer na UI.
2. **Durabilidade de estado do runtime** (`delonix-state/store.rs`: rename
   atómico sem fsync) — fora do controlo do desktop; documentar.
3. **Catálogo de capabilities evolui** — `CapabilityState::Unknown` degrada em
   vez de partir.
4. **GUI bloqueada por deps de sistema** — documentado, não mascarado; comando
   `sudo apt` em `docs/architecture/`.
