---
session: 022de946-exec
opened: 2026-10-24T21:20:00+01:00
branch: feat/desktop-exec
status: open
---

# Objective
Tornar acessível no desktop o `exec`/terminal interativo em containers (§3), via PTY no backend Tauri + emulador de terminal no frontend.

# Done when
- [x] Separador "Terminal" no WorkloadDetail (containers) liga a um shell interativo no container via PTY; entrada/saída e redimensionamento funcionam; VM mostra nota "usar vm console". (compila; prova interativa ao vivo pendente — exige a janela Tauri, outra frente)
- [x] Backend valida fail-closed o argv de exec (só `container exec`), com teste Rust (#[test] como em cli.rs).
- [x] `npm run typecheck`, `npm run build:web` e `cargo check` (src-tauri) verdes.

# Out of scope
- Paginação (§6), métricas (§8), VMs por socket, camada declarativa, prova na janela ao vivo (§7/§12, feita noutra frente).
- Exec em pods (só container nesta frente; pod fica anotado).

# Handoff

Feito: terminal interativo (exec) em containers (§3), ponta-a-ponta ao nível de contrato.

## Ficheiros
- Backend novo: `apps/desktop/src-tauri/src/exec.rs` (comandos `dlx_exec_start/write/resize/stop`, estado `Execs(Mutex<HashMap>)`, `exec_allowed`, 4 testes).
- `apps/desktop/src-tauri/src/lib.rs`: `mod exec;` + `.manage(Execs)` + 4 comandos no handler.
- `apps/desktop/src-tauri/Cargo.toml`: `portable-pty = "0.9"`.
- Frontend novo: `apps/desktop/src/components/Terminal.tsx` (xterm + addon-fit, CSS importado).
- `apps/desktop/src/lib/client.ts`: `exec(...)` + interface `ExecSession` no contrato.
- `apps/desktop/src/lib/tauriClient.ts` e `mockClient.ts`: implementação de `exec` (mock ecoa stdin no browser).
- `apps/desktop/src/lib/cli.ts`: `cmd.exec`.
- `apps/desktop/src/screens/WorkloadDetail.tsx`: separador "Terminal" (edição cirúrgica).
- `apps/desktop/package.json`: `@xterm/xterm ^5.5.0`, `@xterm/addon-fit ^0.10.0`.

## Canal do PTY
backend abre PTY (portable-pty) → lança `delonix container exec -it <name>` por argv (nunca shell do host; fallback bash→sh é do próprio engine) → thread do SO lê o master e emite `dlx-exec {id,data}` (bytes→string lossy); fim → `dlx-exec-end {id}`. Frontend: xterm `onData`→`dlx_exec_write`; ResizeObserver+FitAddon→`dlx_exec_resize`; desmontar→`dlx_exec_stop` (mata o filho, master largado → EOF → fim). `core:event` já coberto por `core:default`, capabilities intactas.

## Verificação
- `npm run typecheck`: verde (design-system + desktop-app).
- `npm run build:web`: verde (vite build ok).
- `cargo check` (src-tauri): verde (webkit2gtk-4.1 presente no host).
- `cargo test` (src-tauri): 6 passed / 0 failed (4 novos de exec_allowed/argv + 2 de cli).

## Decisões / desvios do prompt
- NÃO existe `delonix exec`; só `delonix container exec` (confirmado por `--help`). O prompt pedia `delonix exec -it <name> <shell>`; o engine faz o fallback bash→sh internamente em `container exec -it <id>` SEM comando, por isso é esse o argv usado (mais fiel ao engine, sem dupla lógica de fallback).
- Validação fail-closed no lado Rust (`exec_allowed` + `exec_argv` fixo a `container exec`), por isso dispensado o vitest (conforme contrato).

## Colisão conhecida (resolver na integração com a frente de métricas §8)
`WorkloadDetail.tsx`, 2 linhas:
1. `type T = "logs" | "terminal" | "inspect" | "stats";` — a frente de métricas também edita esta união.
2. o array de items do `<Tabs>` — ambas as frentes acrescentam entradas ao mesmo array.
Resolução: unir as uniões e os items (manter "terminal" + o que a outra frente acrescentar). O bloco condicional de "stats" é da frente de métricas; eu só acrescentei o bloco "terminal".

## Lacunas
- Prova interativa ao vivo (teclar num shell real) PENDENTE — exige a janela Tauri ao vivo (outra frente). Contratos e compilação garantidos.
- `pod exec` adiado (anotado em `exec_argv`): hoje só `container exec`.
