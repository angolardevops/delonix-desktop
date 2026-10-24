# Saída do `delonix-desktop-proof --run` (ao vivo, 2026-10-24)

```
→ node-api socket: /run/user/1000/delonix-desktop-node.sock
  api_version = delonix.node.v1
  recursos servidos: self, node, health, capacity, providers, networks, volumes, operations, openapi, docs, redoc
  containers no contrato? false  (senão → ponte CLI-JSON)
→ node: x86_64 5.1.1 rootless=true cgroup_delegated=true workloads=["container", "pod", "vm", "microvm"]
→ health: 4/4 condições OK
   [ok] NetworkReady — Ok
   [ok] StoreWritable — Writable
   [ok] CgroupDelegated — Delegated
   [ok] ProvidersAvailable — LinuxAvailable
→ providers: 8
   compute/cloud-hypervisor available=true caps=90 (accionáveis=13)
   compute/libvirt available=true caps=90 (accionáveis=18)
   compute/proxmox available=false caps=90 (accionáveis=33)
   compute/linux available=true caps=90 (accionáveis=11)
   network/linux available=true caps=48 (accionáveis=10)
   network/proxmox available=false caps=48 (accionáveis=7)
   storage/linux available=true caps=11 (accionáveis=4)
   gateway/opnsense available=false caps=48 (accionáveis=10)
→ histograma de estados de capability (feature-gating):
   NotImplemented               72
   Partial                      92
   RequiresExternalComponent    12
   Supported                    106
   UnavailableOnHost            3
   UnsupportedByProvider        230

→ a correr container dd-core-proof (busybox, ponte CLI-JSON)…
   id = bcb360be09973611
   ps: dd-core-proof [Up 1 second] docker.io/library/busybox:latest
   logs (3 primeiras): ["tick 1", "tick 2", "tick 3"]
→ limpeza…
   0 órfãos

✅ prova concluída — caminho cliente↔runtime validado
```
