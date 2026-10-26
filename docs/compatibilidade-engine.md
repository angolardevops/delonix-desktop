# Compatibilidade desktop × engine delonix

Fonte: prova ao vivo 2026-10-24 (auditoria de release). O **delonix-desktop** é um
cliente do CLI `delonix`; esta página fixa que versões do engine ele suporta e com
que verbos fala.

## Regra de ouro

O desktop emite **verbos agrupados** (`image ls`, `container run`, `image pull`,
`image remove`, `container logs`, `container exec`, `workload stop|rm`,
`container|vm start|stop|restart`, `volume|network create|rm`, `dashboard`,
`provider`, `system`). **Não** usa os aliases estilo Docker da raiz
(`run`/`ps`/`images`/`logs`/`pull`/`rmi`/`start`/`stop`/`restart`/`rm`).

Motivo (prova ao vivo): os aliases de raiz **só existem na `develop` do runtime**
(pós-5.1.1); o **release 5.1.1 não os tem**. Um desktop que os emitisse falharia
em Imagens e em todas as ações de ciclo de vida contra o 5.1.1. Os verbos
agrupados existem em **ambos** → o desktop funciona com 5.1.1 **e** develop.

## Matriz de verbos (prova ao vivo, host Linux x86_64)

| Operação no desktop | argv emitido | engine 5.1.1 (release) | engine develop |
|---|---|---|---|
| Listar workloads | `workload ls -o json` | ✓ | ✓ |
| Listar imagens | `image ls -o json` | ✓ | ✓ |
| Listar volumes/redes/providers | `volume/network/provider ls` | ✓ | ✓ |
| Dashboard | `dashboard --json` | ✓ | ✓ |
| Doctor/info/features | `system …` | ✓ | ✓ |
| Criar container | `container run -d …` | ✓ | ✓ |
| Iniciar | `container start` / `vm start` | ✓ | ✓ |
| Parar | `workload stop` | ✓ | ✓ |
| Reiniciar | `container restart` / `vm restart` | ✓ | ✓ |
| Remover workload | `workload rm -f` | ✓ | ✓ |
| Pull de imagem | `image pull` | ✓ | ✓ |
| Remover imagem | `image remove` (NÃO `image rm`) | ✓ | ✓ |
| Logs | `container logs -f` | ✓ | ✓ |
| Terminal | `container exec -it` | ✓ | ✓ |
| ~~aliases de raiz~~ | `run`/`ps`/`images`/`logs`/… | ✗ **inexistente** | ✓ (só aqui) |

O backend recusa qualquer aliases de raiz (teste `root_docker_aliases_are_refused`
em `src-tauri/src/cli.rs`), travando regressões.

## Dimensões NÃO cobertas (delimitação honesta)

- **Plataformas:** só testado em **Linux x86_64** (Zorin/Ubuntu noble). Windows e
  macOS por testar.
- **Prova:** a matriz acima é por **sondagem de comando** (os verbos existem e
  aceitam os args). A prova **interativa na janela Tauri ao vivo** (clicar, ver a
  lista paginar, o terminal receber teclas) ainda não foi feita.
- **Engine:** a string de versão é `5.1.1` em ambos os binários — **não distingue**
  release de develop. O diferenciador real é a presença dos aliases de raiz / o
  commit. Recomenda-se o engine ter os verbos agrupados (tem desde ≤5.1.1) — e o
  desktop só depende desses.
