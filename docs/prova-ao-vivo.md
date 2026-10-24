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

## NÃO provado ao vivo (honesto)

- **§3 terminal interativo**: a tab existe, mas não havia container a correr (0) para teclar num shell real; não criei um para exec.
- **§5 VM por socket**: exige `delonix serve node-api` + provider de VM a correr (não arrancados). Create/start/stop/snapshot compilam e os contratos estão provados por teste, mas não foram exercidos contra um socket vivo.
- **§7 minimizar / arrastar**: o maximizar e o fechar ficaram provados; o minimizar e o arrasto da barra não (o clique XTEST não é pixel-perfeito — mesma concessão de capability).
- **Métricas por recurso (tab Estatísticas)**: o Overview (agregado) ficou provado; a tab de estatísticas por workload precisa de um workload a correr com contadores.
- **Windows / macOS**: não testados (só Linux).

## Notas de reprodução
- Condutor e capturas em `scratchpad/` (xdo.py, grab.py, shot_*.png, dlx-shim, dlx-calls.log).
- Sessão Wayland → `GDK_BACKEND=x11` obrigatório para XTEST/XGetImage.
