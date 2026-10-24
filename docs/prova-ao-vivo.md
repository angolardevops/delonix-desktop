# Prova ao vivo da janela Tauri — 2026-10-24

Condução real da app instalada (binário Tauri debug de `integra` @25ddd16) contra o
**engine 5.1.1 instalado** (`~/.local/bin/delonix`, SEM aliases de raiz), host Linux
x86_64 / GNOME-Wayland (app forçada a X11 via `GDK_BACKEND=x11` para ser
conduzível por XTEST; `WEBKIT_DISABLE_COMPOSITING_MODE=1` para o XGetImage capturar).

Método: condutor XTEST (python-xlib) para cliques/teclas; captura por `get_image`;
**prova por efeito observável** (geometria da janela, contagens do engine, e um
*shim* que regista cada invocação do `delonix`).

## Provado ao vivo

| Área | Evidência observada |
|---|---|
| **App arranca** | Janela "Delonix Desktop" 1440×900 mapeada; webview renderiza o React (bloqueio histórico do webkit ultrapassado). |
| **§4 compat (verbos agrupados)** | O shim registou `image ls -o json`, `volume ls -o json`, `workload ls -o json`, `provider ls/describe -o json`, `dashboard --json`, `volume create` — TODOS devolvem OK contra o 5.1.1. Com os aliases de raiz antigos (`images`/`run`) a app falharia aqui. |
| **§8 dashboard/métricas** | Overview mostra dados reais: Containers 0 · VMs 1 · Imagens 25 · Volumes 27 · Redes 7; Memória "1,2 MB de 53 GB", Armazenamento 27 GB, Capacidades 312. O bug NaN está resolvido ao vivo. Avisos reais (volume.nfs/cifs/webdav precisam de CAP_SYS_ADMIN). |
| **§6 paginação** | Imagens (25) → "Página 1 de 3 · 25 itens", 10 linhas; clique "›" → "Página 2 de 3" com 10 IDs DIFERENTES. Volumes (27) → "Página 1 de 3 · 27 itens", 10 linhas. Paginação client-side sobre dados reais. |
| **§7 controlos de janela** | Clique no botão maximizar → geometria 1440×900 → **1920×1080** (ecrã inteiro); clique no botão fechar → app termina. Confirma que `capabilities/default.json` (restaurado na reconciliação) concede os controlos; sem ele os cliques seriam no-op. |
| **§4 caminho de ação (escrita)** | No form "Criar volume" escrevi um nome e cliquei Criar → shim `delonix volume create zzliveproof` → o engine criou o volume (27→**28**) → limpeza via CLI (28→27). Caminho ponta-a-ponta form→CLI→engine provado. |
| **§4 risco DESTRUCTIVE** | Clique no remover de um container → diálogo "destrutiva · Remover live-sh · `delonix workload rm -f live-sh`" (Cancelar/Remover); ao confirmar, o container foi mesmo removido (toast "feito", lista 2→1). Classificação de risco + confirmação + execução provadas ao vivo. |
| **§6 (grande dataset)** | Capacidades: "Todas 515", filtro "Não funciona 312" → **"Página 1 de 32 · 312 itens"**, 10/página; aba "Resolúveis por mim 15" (feature do doctor restaurada) presente. |
| **§5 UI de VM (detalhe)** | Detalhe da VM `pve92` renderiza com separador **Snapshots** e botões **Iniciar/Remover SEM Reiniciar** — confirma a UI da Frente D ao vivo (`vm restart` não existe no contrato). |
| **§3 exec (motor)** | `delonix container exec live-sh echo` devolveu "DELONIX-EXEC-VIVO" — o exec subjacente que o PTY da app encapsula (`container exec -it`) funciona. |

## Achados de UX da condução ao vivo
- O **dock inferior "Terminal"** é um PLACEHOLDER ("Por ligar… precisa de PTY") — o terminal REAL (xterm da Frente B) está no separador Terminal do WorkloadDetail, não no dock global. Ligar o dock ou removê-lo.
- O dock inferior "Logs" ESTÁ ligado (stream `container logs -f`, com seletor de workload).
- Segurança: condução por clique XTEST **não é pixel-perfeita** e a janela MOVE-SE entre interações → é obrigatório LER a origem absoluta da janela antes de cada clique (fiz um condutor `xdo2.py` que o faz). Um offset stale causou um clique destrutivo acidental (removeu o container de teste; sem perda de dados do dono — volumes/imagens confirmados intactos).

## NÃO provado ao vivo (honesto)

- **§3 terminal interativo**: a tab existe, mas não havia container a correr (0) para teclar num shell real; não criei um para exec.
- **§5 VM por socket**: exige `delonix serve node-api` + provider de VM a correr (não arrancados). Create/start/stop/snapshot compilam e os contratos estão provados por teste, mas não foram exercidos contra um socket vivo.
- **§7 minimizar / arrastar**: o maximizar e o fechar ficaram provados; o minimizar e o arrasto da barra não (o clique XTEST não é pixel-perfeito — mesma concessão de capability).
- **Métricas por recurso (tab Estatísticas)**: o Overview (agregado) ficou provado; a tab de estatísticas por workload precisa de um workload a correr com contadores.
- **Windows / macOS**: não testados (só Linux).

## Ronda 3 — frentes novas (E1/E2/dock), binário de integra @b5a247a

| Área | Provado ao vivo |
|---|---|
| **Sidebar wired** | Segredos (17), Backups, Declarativo, Kubernetes, Registries — todos presentes com contagens reais. |
| **§E1 Segredos** | Tela "Segredos · 17 segredos · valores nunca expostos" — 17 segredos REAIS (addon-*), só metadados (chaves/versão/data), **paginação "Página 1 de 2"**, form Criar + ação Rodar por chave. Segurança: nenhum valor exposto. |
| **§E2 Declarativo** | Tela com separadores Stacks/Compose, campo de manifesto, Planear/Validar/Descrever/Histórico + Aplicar/Destruir. Ação chega ao engine: `stack history` → **erro tipado real `error[DX-1000] invalid argument: no manifest`**. |
| **§E2 Kubernetes** | Tela "0 cluster(s)" wired a `cluster ls/health/kubeconfig`, nota CRI, painel Gerar manifesto (`cluster kube generate`), paginação. Substitui o placeholder antigo. |

### BUG §3 apanhado pela prova ao vivo (terminal interativo)
O dock "Terminal" (e o separador Terminal do detalhe) ficou LIGADO (mostra `container exec -it <nome>` + xterm), mas a **sessão termina imediatamente** ("[sessão terminada]"; teclar não revive). O shim confirma que a app CHAMA `delonix container exec -it live-sh` (sem erro no log), e o MESMO comando por CLI com TTY real FICA VIVO (só morre por `timeout`). → O exec do engine funciona; o **ciclo de vida do PTY na app (Frente B: `src-tauri/src/exec.rs` / `components/Terminal.tsx`) é o defeito** — a sessão fecha-se sozinha. A corrigir (hipóteses: EOF no master do PTY, fallback bash→sh em busybox, ou cleanup de efeito a matar o filho). Mocks/compilação escondiam isto.

## Ronda 4 — fix §3 do terminal + UI v2 (binário de integra @1e05afc)

| Área | Provado ao vivo |
|---|---|
| **§3 terminal CORRIGIDO** | Depois do fix (herdar env + id único por montagem), o terminal do dock corre comandos reais no container: `ls` → árvore do busybox; `echo delonixworks` → `delonixworks` + novo prompt `/ #`. Antes: "[sessão terminada]". |
| **#2 DataTable + paginação** | Segredos: tabela a largura TODA (aside removido), search "Pesquisar nome ou chave", rodapé "Página 1 de 2 · 17 itens · **Por página [10 ▾]**" (Select de tamanho configurável). |
| **#3 Drawer flutuante** | "Criar segredo" (botão no topo) abre uma GAVETA deslizante da direita sobre a lista (✕/Escape fecham); campos intactos; lista a largura toda quando fechada. |
| **#3 Hamburger** | Clique no ☰ colapsa a sidebar para um RAIL só de ícones (~52px) e o conteúdo expande. |
| **#4 densidade** | A tabela cabe sem scroll horizontal prematuro. |

Nota de captura: após uma TRANSIÇÃO CSS (colapso do hamburger via Ctrl+B), o
XGetImage passou a devolver tela uniforme escura embora o React continuasse VIVO
(a sondar o engine) — é a limitação conhecida do WebKit software-render (ver
memória), NÃO um crash. Capturar logo após o clique (sem esperar a transição) ou
reiniciar o webview contorna-a.

## Notas de reprodução
- Condutor e capturas em `scratchpad/` (xdo.py, grab.py, shot_*.png, dlx-shim, dlx-calls.log).
- Sessão Wayland → `GDK_BACKEND=x11` obrigatório para XTEST/XGetImage.
