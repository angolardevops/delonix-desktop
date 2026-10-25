---
session: 022de946-os-native
opened: 2026-10-25T02:40:00+01:00
branch: feat/desktop-os-native
status: open
---

# Objective
Integração nativa com o SO (eixo A): plugins Tauri para notificações, diálogo de ficheiros, clipboard e window-state; menu da barra de título funcional.

# Done when
- [x] Notificações do SO em eventos críticos (OOM/die/error do stream de eventos); diálogo de ficheiros NATIVO a substituir os inputs de texto de caminho (manifesto/Dockerfile/compose); window-state a persistir posição/tamanho entre arranques; "Copiar CLI" via clipboard nativo; os menus da TitleBar (Ficheiro/Editar/…) passam a funcionais (ou removidos) — nada decorativo.
- [x] Plugins no Cargo.toml + init em lib.rs + permissões em capabilities; `cargo check`+`cargo build` (webkit presente), `npm run typecheck`, `npm run build`, `npm run test` verdes.

# Out of scope
- Eixo B (dashboard) — NÃO tocar Overview.tsx/cli.ts/cli.rs/tauriClient.ts (parsing de dash).
- Contexto remoto paas.

# Handoff

Feito e verde. Plugins oficiais Tauri 2.x adicionados (Cargo.toml + package.json + init em lib.rs + permissões em capabilities/default.json):
- `tauri-plugin-notification` 2.7.0 / `@tauri-apps/plugin-notification` — perm `notification:default`.
- `tauri-plugin-dialog` 2.8.3 / `@tauri-apps/plugin-dialog` — perm `dialog:default`.
- `tauri-plugin-clipboard-manager` 2.5.0 / `@tauri-apps/plugin-clipboard-manager` — perm `clipboard-manager:allow-write-text` (só escrita).
- `tauri-plugin-window-state` 2.5.0 — Rust-only (autosave de geometria), sem permissão de frontend, sem dep JS.

Onde:
- `lib/native.ts` (NOVO): abstrai notify/pickFile/pickDirectory/copyText/aboutDialog com fallback gracioso (navigator.clipboard / Notification / no-op) quando fora do Tauri; `nativeDialogsAvailable()` esconde "Procurar…" no dev browser.
- `App.tsx`: efeito de topo subscreve `client.events`, filtra OOM/die(saída suja)/erro, dedup 30s por recurso + intervalo global 5s, dispara `notify`. Só sob `client.live`. Exposto helper `toast` no contexto.
- `components/ui.tsx` (CliHint): "Copiar CLI" passou a `copyText` nativo, feedback "Copiado" só em sucesso.
- `TitleBar.tsx`: 6 menus (Ficheiro/Editar/Ver/Workloads/Janela/Ajuda) agora dropdowns reais via Popover (foco preso, Esc/clique-fora), ações ligadas (go/openDock/openPalette/win/about/copyDocs). Nada decorativo.
- Diálogo nativo: `screens/Declarativo.tsx` (manifesto stack + ficheiro compose), `screens/Build.tsx` (contexto=dir, Dockerfile=file), `screens/CreateWorkload.tsx` (manifesto pod). Inputs de texto continuam editáveis.
- `lib.rs`: `.plugin(window_state…build())` primeiro (restaura geometria na criação da janela) + notification/dialog/clipboard.

Gates: `npm run typecheck` verde; `npm run build` verde; `npm run test` 46/46; `cargo check` e `cargo build` verdes (webkit2gtk-4.1 presente). O `cargo build` passar valida os identificadores de permissão do ACL (tauri-codegen).

Lacunas / notas:
- Não há plugin opener/shell → "documentação" copia o link para o clipboard em vez de abrir o browser (ação real, não decorativa).
- Validação do menu/diálogos/notificações ao vivo na janela (XTEST) não feita nesta sessão — provado por gates; convém conduzir a janela depois.
- `npm audit` reporta vulnerabilidades em deps transitivas (pré-existentes, não introduzidas aqui).
