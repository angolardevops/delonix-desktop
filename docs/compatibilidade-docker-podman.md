# Compatibilidade Docker / Podman — matriz versionada (§12)

**Testado com:** Delonix 5.1.1 (binário `delonix`, +293 commits). Docker Engine ≥ 24, Podman ≥ 4 (referência).

## Natureza da compatibilidade (honesto)

O Delonix Desktop fala **exclusivamente** com o **Delonix Engine**. O Delonix é um
engine PRÓPRIO: **daemonless**, rootless-first, kernel-native (Rust). **NÃO fala a
API do Docker (`/var/run/docker.sock`) nem a do Podman**, e não há adaptador/seletor
de "contexto docker/podman" na app. A única superfície de gestão é o **CLI
`delonix`** (verbos agrupados) + o socket gRPC `node.v1` (VMs).

Portanto a compatibilidade é de **EXPERIÊNCIA / anatomia** (a app replica o modelo
mental do Docker/Podman Desktop — imagens, containers, volumes, redes, registries,
build, compose, k8s), **NÃO de protocolo**. Recursos específicos do Delonix (VMs
nativas, capacidades, kubeadm offline, túneis) existem **sem fingir** suporte em
Docker/Podman.

## Matriz de capacidades

| Dimensão | Delonix 5.1.1 (via app) | Docker | Podman | Nota |
|---|---|---|---|---|
| Ligação local | ✅ CLI daemonless (sem socket de daemon) | socket daemon | socket/daemonless | modelos diferentes |
| Ligação remota | ⚠️ só VMs via node.v1; sem contexto remoto geral | contexts/TCP | ssh/TCP | §Fase 4 (paas) por fazer |
| Autenticação registry | ✅ `image login` (password por stdin) → auth.json docker/podman | ✅ | ✅ | **formato auth.json partilhado** |
| Lifecycle container | ✅ run/start/stop/restart/rm | ✅ | ✅ | verbos AGRUPADOS (não aliases Docker) |
| Pull / Push imagem | ✅ stream+progresso+cancel / push | ✅ | ✅ | sem catálogo remoto (`ls-remote`) |
| Gestão imagem | ✅ ls/inspect/tag/save/export/remove/history | ✅ | ✅ | contrato `repo_tags/size_bytes/orphan` |
| Exec | ✅ `container exec -it` (shell novo) | ✅ | ✅ | — |
| Attach | ⚠️ `container attach` **só-saída** (sem stdin) | ✅ bidirecional | ✅ | **limite do engine 5.1.1** |
| Logs | ✅ `container logs -f`; timestamps só com `--log-cri` | ✅ | ✅ | — |
| Eventos | ✅ `system events -f` (lifecycle) | ✅ | ✅ | — |
| Volumes | ✅ ls/create/rm | ✅ | ✅ | — |
| Redes | ✅ ls/create/rm/connect/disconnect/**topologia** | ✅ | ✅ | banda rx/tx null em rootless |
| Build | ✅ `build` + scan/SBOM/sign/history | ✅ buildkit | ✅ | base CVE do scan = placeholder embebido |
| Compose | ✅ `compose up/down/ps/config` | ✅ | ✅ (podman-compose) | `-f` ficheiro (sem `--project-directory`) |
| Secrets | ✅ CRUD + rotate + **revelar/copiar** | ⚠️ swarm | ✅ | engine lê o valor (`--reveal`) |
| Pods | ✅ `pod create -f`/logs/exec | ❌ | ✅ (nativo) | Delonix tem pods |
| VMs | ✅ nativas (cloud-hypervisor/libvirt) via node.v1 | ❌ | ❌ | **específico Delonix** |
| Kubernetes | ✅ `cluster` (kind/VM) + kubectl-read | ⚠️ Desktop | ⚠️ | específico Delonix |
| Rootless | ✅ **primeiro-classe** (cgroup v2 delegado) | ✅ (opt-in) | ✅ | io/cpuset precisam de `system setup --delegate` |
| Rootful | ✅ (quando delegado) | ✅ | ✅ | — |
| Formato de erro | `error[DX-NNNN] …` + exit code → taxonomia tipada na app | daemon JSON | exit codes | app normaliza DX-codes |

## Descoberta de capacidades

A app NÃO assume semântica idêntica: usa `provider ls/describe -o json` + `mcp
capabilities` + `version` (na StatusBar) para descobrir o que ESTE engine/host faz.
A tela **Capacidades** mostra 515 capacidades classificadas (funciona/com-limites/
não-funciona) com a evidência e o `delonix system doctor` para resolver.

## Limitações de compatibilidade (não corrigíveis pela app)

- Sem interop de **protocolo** Docker/Podman (engine próprio) — por desenho.
- `container attach` é **só-saída** no 5.1.1 (Docker é bidirecional).
- Métricas de rede/VM por recurso vêm **null em rootless** (precisam de eBPF/
  delegação: `sudo delonix system setup --delegate`).
- Sem **contexto remoto** geral (só VMs via node.v1); o control-plane `/v2` vive no
  delonix-paas (fora do engine local daemonless).
