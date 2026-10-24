# Prova técnica — Linux vertical slice (Fase 1)

**Host:** Zorin OS 18 (base Ubuntu 24.04 «noble»), kernel 7.0.0-38-generic, x86_64, **rootless**.
**Engine:** delonix 5.1.1 (commit `c37b12cb2`), `delonix-node-api` 5.1.1.
**Data:** 2026-10-24.
**Objectivo:** provar ao vivo, neste host, o caminho crítico da arquitectura do desktop:
cliente → `node-api` (`delonix.node.v1`) no socket Unix **e** ponte CLI-JSON para o que o
contrato ainda não serve (containers), com um workload real.

> Limitação de ambiente registada (não mascarada): a **janela Tauri não compila neste host**
> porque falta `libwebkit2gtk-4.1-dev` (e deps GTK). A prova exercita a **camada-core** — o
> backend que os comandos Tauri invocam — de forma headless. Instalar as deps de sistema é uma
> acção `sudo` do dono, documentada em `docs/architecture/`, não executada silenciosamente.

## 1. node-api vivo no socket Unix (daemonless)

Arranque: `delonix-node-api --addr unix://$XDG_RUNTIME_DIR/delonix-desktop-node.sock --idle-timeout 900s`
(socket `srw-------`, só o uid chamador; em produção arranca por socket-activation do systemd
e sai após idle — ADR-0040 P5).

### `GET /v1` (GetApiRoot — hipermédia)
```json
{"api_version":"delonix.node.v1","links":[
 {"rel":"self","href":"/v1"}, {"rel":"node","href":"/v1/node"},
 {"rel":"health","href":"/v1/node/health"}, {"rel":"capacity","href":"/v1/node/capacity"},
 {"rel":"providers","href":"/v1/providers"},
 {"rel":"networks","href":"/v1/namespaces/default/networks"},
 {"rel":"volumes","href":"/v1/namespaces/default/volumes"},
 {"rel":"operations","href":"/v1/operations"},
 {"rel":"openapi","href":"/openapi.json"}, {"rel":"docs","href":"/docs"}, {"rel":"redoc","href":"/redoc"}]}
```
A raiz anuncia **só o que serve**: há node/health/capacity/providers/networks/volumes/operations,
**não há `containers`** — confirma que `ContainerService` ainda não está registado (responde 501
DX-6001). Daí a ponte CLI-JSON na secção 2.

### `GET /v1/node` (GetNodeInfo)
```json
{"arch":"x86_64","rootless":true,"cgroup_delegated":true,"cgroup_driver":"cgroupfs",
 "engine_version":"5.1.1","engine_commit":"c37b12cb2","hostname":"delonix","kernel":"7.0.0-38-generic",
 "supported_workload_types":["container","pod","vm","microvm"]}
```

### `GET /v1/node/health`
`NetworkReady=TRUE`, `StoreWritable=TRUE` (`~/.local/share/delonix` writable),
`CgroupDelegated=TRUE` (memory, cpu e pids impostos).

### `GET /v1/node/capacity`
`cpu_millis_total=20000`, `cpu_millis_allocatable=17000`, `containers_running=0`,
filesystems com `role` (`state`, `images`) e bytes/inodes.

### `GET /v1/providers` (ListProviders → capability catalog) — **o diferenciador**
8 providers: compute(`cloud-hypervisor`,`libvirt`,`proxmox`,`linux`),
network(`linux`,`proxmox`), storage(`linux`), gateway(`opnsense`).
Distribuição de **549 entradas de capability** por estado (medido neste host):

| estado | contagem |
|---|---|
| `supported` | 106 |
| `partial` | 92 |
| `not-implemented` | 72 |
| `unsupported-by-provider` | 230 |
| `requires-external-component` | 12 |
| `unavailable-on-host` | 3 |

> Correcção à auditoria: são **6** estados ao vivo (inclui `requires-external-component`),
> não 5. Esta matriz é o que o desktop consome para **feature-gating honesto da UI**.

## 2. Ponte CLI-JSON — ciclo de vida real de um container

```
$ delonix container run -d --name dd-proof docker.io/library/busybox:latest \
      sh -c 'for i in $(seq 1 15); do echo "tick $i"; sleep 1; done'
pulling docker.io/library/busybox:latest…  (platform linux/amd64)
e55999829c1b3476

$ delonix container ps -o json
  dd-proof   Up 1 second   docker.io/library/busybox:latest

$ delonix system events | tail
  2026-10-24 11:35:36  security  ADM-NO-RUNTIME-POLICY   dd-proof
  2026-10-24 11:35:39  container create  e55999829c1b  dd-proof (docker.io/library/busybox:latest)

$ delonix container logs dd-proof
  tick 1
  tick 2
  tick 3
```
Cleanup: `container stop/rm dd-proof` → 0 órfãos restantes.

## 3. Veredicto

A arquitectura proposta é **viável e provada ao vivo**: o desktop lê estado e capacidades pelo
contrato versionado `delonix.node.v1` e opera containers pela ponte CLI-JSON (campos estáveis
ADR-0005) até `ContainerService` aterrar no contrato, sem mudar a UI. Tudo rootless, daemonless,
num host real.
