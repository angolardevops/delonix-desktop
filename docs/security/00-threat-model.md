# Threat model — Delonix Desktop (inicial)

> Fase 0. Cobre as fronteiras do brief §12. Vivo: revisto a cada fase que
> introduza uma nova superfície (streaming, cloud, packaging, extensões).

## Activos a proteger
- Credenciais cloud (Bearer em `~/.delonix/auth.json`).
- O socket do node-api (controlo total do runtime do utilizador).
- Integridade dos workloads e dos dados persistentes.
- A cadeia de fornecimento (binários, dependências, actualizações).

## Superfícies e ameaças

### 1. Renderer / IPC
- **Ameaça**: conteúdo hostil no webview (ex.: nome de recurso, log) a escapar
  para execução; comando IPC não autorizado.
- **Controlo**: CSP estrita (`default-src 'self'`, sem rede aberta); IPC é uma
  **allowlist tipada** de 4 comandos; o renderer **não** tem acesso a
  rede/FS/processos; nenhum `connect-src` para hosts externos.
- **Estado**: ✅ desenhado (`tauri.conf.json`, `src-tauri/src/main.rs`).

### 2. Core ↔ runtime (local)
- **Ameaça**: outro utilizador/processo a falar com o runtime; injecção via
  argumentos da ponte CLI.
- **Controlo**: socket `0600` + `SO_PEERCRED` (só o uid chamador); a ponte passa
  **args separados** e valida `name`/`image` (rejeita `-flag`, espaços, `;`,
  metacaracteres) — `cli_bridge.rs::validate_*`, com testes. Sem `sh -c` a partir
  de input.
- **Estado**: ✅ desenhado + testado.

### 3. Core ↔ cloud (remoto) — Fase 4
- **Ameaça**: roubo de token; confusão de tenant; MITM.
- **Controlo**: TLS; Bearer em ficheiro `0600`; **tenant deriva do token** (nunca
  de cabeçalho do cliente); nunca expor API privilegiada em TCP sem auth.
- **Estado**: ⬜ a implementar (padrão `delonixctl`).

### 4. Segredos e diagnóstico
- **Ameaça**: segredos em logs/URLs/argumentos; pacote de diagnóstico a vazar
  dados.
- **Controlo**: erros IPC devolvem mensagem redigida (`CoreError::Display` não
  inclui tokens); credenciais só nos mecanismos do SO / ficheiro `0600`; pacotes
  de diagnóstico revistos e redigidos antes de partilha.
- **Estado**: 🟡 princípio aplicado no core; diagnóstico formal ⬜.

### 5. Cadeia de fornecimento / actualização — Fase 6
- **Ameaça**: binário/atualização adulterados; dependência maliciosa.
- **Controlo**: artefactos assinados + verificação antes de instalar; SBOM e
  provenance; updater com verificação de integridade; rollback respeita
  migrações (sem downgrade quando o formato de dados mudou).
- **Estado**: ⬜ (Fase 6).

### 6. Imagens / pull / build — Fase 3
- **Ameaça**: imagem maliciosa, whiteouts OCI mal aplicados (defeito conhecido do
  runtime — ver memórias), extracção com traversal.
- **Controlo**: delegado ao runtime (scan cosign/CVE embutido); o desktop
  **mostra** o risco, não reimplementa extracção.
- **Estado**: ⬜ (Fase 3).

## Princípios herdados (não negociáveis)
1. Interface **sem privilégios administrativos permanentes**; helpers só com
   operações limitadas e inputs validados.
2. **Loopback não é autorização.** Nunca API privilegiada em TCP sem auth.
3. Rust e rootless **não** são prova de segurança — cada fronteira é verificada.
4. Nenhuma alteração silenciosa ao host (firewall, grupos, WSL global, sockets de
   outras ferramentas).

## Dívida / riscos aceites nesta fase
- Durabilidade do estado do runtime (rename sem fsync, `delonix-state`) — fora do
  controlo do desktop; documentado.
- Dependência do formato JSON da CLI (drift) — mitigada por DTOs tolerantes.
