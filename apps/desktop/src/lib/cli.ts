// Construtores de argv para o CLI `delonix`. A UI mostra sempre o comando
// equivalente, por isso cada ação passa por aqui.
import type { WorkloadRow } from "./types";

export type Argv = string[];

export const show = (argv: Argv) =>
  ["delonix", ...argv].map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a)).join(" ");

// Emite `-f <caminho>` quando há caminho; vazio caso contrário (o engine
// recai no diretório de trabalho do processo). Partilhado por stack e compose.
const fFlag = (path?: string): Argv => (path && path.trim() ? ["-f", path.trim()] : []);

export const cmd = {
  dash: (): Argv => ["dashboard", "--json"],
  workloads: (): Argv => ["workload", "ls", "-o", "json"],
  describe: (name: string): Argv => ["workload", "describe", name],
  images: (): Argv => ["image", "ls", "-o", "json"],
  volumes: (): Argv => ["volume", "ls", "-o", "json"],
  networks: (): Argv => ["network", "ls", "-o", "json"],
  providers: (): Argv => ["provider", "ls", "-o", "json"],
  providerDescribe: (id: string, kind?: string): Argv =>
    ["provider", "describe", id, ...(kind ? ["--kind", kind] : []), "-o", "json"],
  doctor: (): Argv => ["system", "doctor"],
  mcpTools: (): Argv => ["mcp", "capabilities"],
  // Dashboard SRE (§B). `system metrics` são os contadores de frota ESTRUTURADOS
  // (o mesmo coletor do dashboard e do Prometheus), SEM a formatação das tiles e
  // com STORAGE por categoria. `system resources` traz os conselhos acionáveis
  // (advice[] DLX-RES-NNN), o gargalo atual e a pressão PSI. Ambos `-o json`,
  // ADR-0005, confirmados por `--help` no engine 5.1.1.
  systemMetrics: (): Argv => ["system", "metrics", "-o", "json"],
  systemResources: (): Argv => ["system", "resources", "-o", "json"],

  // start/restart não têm forma de raiz nem no grupo `workload`: despacham-se
  // por tipo (`vm …` para VMs, `container …` para o resto).
  start: (w: Pick<WorkloadRow, "name" | "type">): Argv => [w.type === "vm" ? "vm" : "container", "start", w.name],
  // `workload stop` encaminha para o backend certo (container ou VM).
  stop: (w: Pick<WorkloadRow, "name">): Argv => ["workload", "stop", w.name],
  restart: (w: Pick<WorkloadRow, "name" | "type">): Argv => [w.type === "vm" ? "vm" : "container", "restart", w.name],
  // `workload rm` é agnóstico ao tipo; -f força mesmo a correr.
  remove: (w: Pick<WorkloadRow, "name">): Argv => ["workload", "rm", "-f", w.name],
  logsFollow: (name: string): Argv => ["container", "logs", "-f", name],
  exec: (name: string): Argv => ["container", "exec", "-it", name],
  events: (): Argv => ["system", "events", "-f", "-o", "json"],

  pull: (ref: string): Argv => ["image", "pull", ref],
  rmi: (ref: string): Argv => ["image", "remove", ref],

  // --- Pods (§8). SÓ por manifesto (`kind: Pod`): não há flags soltas. O pod
  // aparece depois em Workloads (type=pod) e o ciclo de vida usa `workload
  // stop/rm`. `pod logs -f` segue os logs de um membro (fluxo por STREAM).
  podCreate: (manifest: string): Argv => ["pod", "create", "-f", manifest],
  podLogsFollow: (pod: string, container?: string): Argv => [
    "pod", "logs", "-f", ...(container ? ["--container", container] : []), pod,
  ],

  // --- Build de imagens (§ build). Fluxo por STREAM (logs demorados ao vivo):
  // `build -t <tag> [--file <dockerfile>] [--build-arg K=V ...] [contexto]`. O
  // contexto é posicional (default `.`); o Dockerfile default é `<contexto>/
  // Dockerfile`. Confirmado por `--help` no 5.1.1.
  build: (o: { tag: string; context?: string; dockerfile?: string; buildArgs?: string[] }): Argv => [
    "build", "-t", o.tag,
    ...(o.dockerfile && o.dockerfile.trim() ? ["-f", o.dockerfile.trim()] : []),
    ...(o.buildArgs ?? []).flatMap((a) => ["--build-arg", a]),
    (o.context && o.context.trim()) || ".",
  ],

  // --- Registries (§ registries). `image login` tem comando backend dedicado
  // (password por stdin); aqui só o argv informativo (SEM password) para o
  // CliHint. `image logout` é argv normal (SafeWrite, corre por dlx_run).
  imageLoginShown: (registry: string, username: string): Argv => [
    "image", "login", registry, "-u", username, "--password-stdin",
  ],
  imageLogout: (registry: string): Argv => ["image", "logout", registry],
  volumeCreate: (name: string): Argv => ["volume", "create", name],
  volumeRm: (name: string): Argv => ["volume", "rm", name],

  // --- Segredos (§E). SÓ verbos agrupados. ---------------------------------
  secretsLs: (): Argv => ["secret", "ls", "-o", "json"],
  // inspect devolve METADADOS (nomes das chaves, valores redigidos); nunca `--reveal`.
  secretInspect: (name: string): Argv => ["secret", "inspect", name, "-o", "json"],
  // O valor entra por `--from-literal KEY=value`. Um segredo é um mapa chave→valor.
  secretCreate: (o: { name: string; key: string; value: string; force?: boolean }): Argv => [
    "secret", "create", o.name, "--from-literal", `${o.key}=${o.value}`, ...(o.force ? ["-f"] : []),
  ],
  secretRm: (name: string): Argv => ["secret", "rm", name],
  // rotate gera um novo valor aleatório para UMA chave do segredo.
  secretRotate: (name: string, key: string): Argv => ["secret", "rotate", name, key],

  // --- Backups (§E). `backup ls` é TEXTO (sem -o json) no 5.1.1. ------------
  backupsLs: (from?: string): Argv => ["backup", "ls", ...(from ? ["--from", from] : [])],
  backupInspect: (archive: string, from?: string): Argv => ["backup", "inspect", archive, ...(from ? ["--from", from] : [])],
  // backup de UM recurso: kind (container/pod/vm/stack) + nome; --to é o destino.
  backupCreate: (o: { kind: string; name: string; to?: string }): Argv => [
    "backup", "create", o.kind, o.name, ...(o.to ? ["--to", o.to] : []),
  ],
  backupRestore: (archive: string, from?: string): Argv => ["backup", "restore", archive, ...(from ? ["--from", from] : [])],
  backupRemove: (archive: string, from?: string): Argv => ["backup", "remove", archive, ...(from ? ["--from", from] : [])],

  // --- Camada declarativa (§E): Stacks, Compose, Clusters. SÓ verbos ---------
  // AGRUPADOS. Todos pedem CONTEXTO por CAMINHO (manifesto ou ficheiro compose),
  // emitido como `-f <caminho>`; sem caminho, o engine usa o diretório de
  // trabalho do processo. Confirmado por `--help` no delonix 5.1.1.
  //
  // Stacks: `ls`/`describe`/`validate` são TEXTO; só `plan`/`history` têm
  // `-o json` (ADR-0005). Um "stack" não tem registo próprio no engine — é um
  // manifesto; por isso não há "stack ls" global, lê-se sempre de um ficheiro.
  stackPlan: (manifest?: string): Argv => ["stack", "plan", ...fFlag(manifest), "-o", "json"],
  stackHistory: (manifest?: string): Argv => ["stack", "history", ...fFlag(manifest), "-o", "json"],
  stackLs: (manifest?: string): Argv => ["stack", "ls", ...fFlag(manifest)],
  stackDescribe: (manifest?: string): Argv => ["stack", "describe", ...fFlag(manifest)],
  stackValidate: (manifest?: string): Argv => ["stack", "validate", ...fFlag(manifest)],
  stackApply: (manifest?: string): Argv => ["stack", "apply", ...fFlag(manifest)],
  stackDestroy: (manifest?: string): Argv => ["stack", "destroy", ...fFlag(manifest)],

  // Compose: opera num ficheiro `docker-compose.yml` (`-f <ficheiro>`); sem `-f`
  // procura no diretório do processo. NENHUM subcomando tem `-o json`.
  // `up` leva `-d` (no-op de compatibilidade); `down -v` leva os volumes nomeados.
  composePs: (file?: string): Argv => ["compose", "ps", ...fFlag(file)],
  composeConfig: (file?: string): Argv => ["compose", "config", ...fFlag(file)],
  composeUp: (file?: string): Argv => ["compose", "up", ...fFlag(file), "-d"],
  composeDown: (file?: string, volumes?: boolean): Argv => ["compose", "down", ...fFlag(file), ...(volumes ? ["-v"] : [])],

  // --- Manifestos / portabilidade (explorador de ficheiros). Ambos HOST-FREE
  // (não tocam na máquina) e só-leitura. `manifest render -f` imprime o
  // manifesto COMPLETO, com os defaults (`#[serde(default)]`) preenchidos — a
  // forma aplicável noutro PC (segredos NÃO são resolvidos). `manifest validate
  // -f [--strict]` verifica schema/referências/grafo. Confirmados por `--help`
  // no delonix 5.1.1.
  manifestRender: (file: string): Argv => ["manifest", "render", "-f", file],
  manifestValidate: (file: string, strict?: boolean): Argv => [
    "manifest", "validate", "-f", file, ...(strict ? ["--strict"] : []),
  ],

  // Clusters/Kubernetes: `ls` é TEXTO (sem `-o json` no 5.1.1 — recusa `-o`
  // explicitamente); `health`/`kubeconfig`/`kube generate` imprimem texto/YAML.
  // NÃO há `cluster status` em 5.1.1 (usar `health`). Verbos confirmados por
  // `--help` no 5.1.1.
  clustersLs: (all?: boolean): Argv => ["cluster", "ls", ...(all ? ["-A"] : [])],
  clusterHealth: (name?: string): Argv => ["cluster", "health", ...(name ? [name] : [])],
  clusterKubeconfig: (name?: string): Argv => ["cluster", "kubeconfig", ...(name ? [name] : [])],
  clusterKubeGenerate: (name: string): Argv => ["cluster", "kube", "generate", name],

  // --- Operar o cluster (kind-mode), como no Docker/Podman Desktop -----------
  // `create` arranca um cluster SEM manifesto e SEM Docker (nós no engine +
  // bootstrap kubeadm). Corre pela via de STREAM (logs ao vivo). Sem flags = 1
  // control-plane pronto. `--workers 0` = control-plane não-tainted (agenda
  // tudo). Confirmado por `cluster create --help` no 5.1.1.
  clusterCreate: (o: {
    name?: string;
    apiPort?: string;
    workers?: number;
    controlPlanes?: number;
    cni?: string; // "default" (kindnet) | "none"
    podSubnet?: string;
    serviceSubnet?: string;
    image?: string;
  }): Argv => [
    "cluster", "create",
    ...(o.name && o.name.trim() ? ["--name", o.name.trim()] : []),
    ...(o.apiPort && o.apiPort.trim() ? ["--api-port", o.apiPort.trim()] : []),
    ...(o.workers != null ? ["--workers", String(o.workers)] : []),
    ...(o.controlPlanes != null ? ["--control-planes", String(o.controlPlanes)] : []),
    ...(o.cni ? ["--cni", o.cni] : []),
    ...(o.podSubnet && o.podSubnet.trim() ? ["--pod-subnet", o.podSubnet.trim()] : []),
    ...(o.serviceSubnet && o.serviceSubnet.trim() ? ["--service-subnet", o.serviceSubnet.trim()] : []),
    ...(o.image && o.image.trim() ? ["--image", o.image.trim()] : []),
  ],
  // `destroy` remove o cluster inteiro. `-f` salta o prompt do CLI (bloquearia
  // sem TTY no backend) — a confirmação é a da app (Destructive).
  clusterDestroy: (name: string): Argv => ["cluster", "destroy", name, "-f"],
  clusterStart: (name?: string): Argv => ["cluster", "start", ...(name ? [name] : [])],
  clusterStop: (name?: string): Argv => ["cluster", "stop", ...(name ? [name] : [])],
  // `drain` cordona um nó e despeja os seus pods (API Kubernetes pura, pela
  // cache do kubeconfig). `NODE` é o nome como em `kubectl get nodes`.
  clusterDrain: (node: string, cluster: string, o?: { ignoreDaemonsets?: boolean; deleteEmptydirData?: boolean; force?: boolean }): Argv => [
    "cluster", "drain", node, "--name", cluster,
    ...(o?.ignoreDaemonsets ? ["--ignore-daemonsets"] : []),
    ...(o?.deleteEmptydirData ? ["--delete-emptydir-data"] : []),
    ...(o?.force ? ["--force"] : []),
  ],
  clusterUncordon: (node: string, cluster: string): Argv => ["cluster", "uncordon", node, "--name", cluster],
  // `load` importa imagens locais para os nós (sem registry), estilo `kind load`.
  clusterLoad: (images: string[], cluster?: string): Argv => [
    "cluster", "load", ...images, ...(cluster ? ["--name", cluster] : []),
  ],

  // --- Redes (§8.6). Verbos AGRUPADOS, confirmados por `--help` no 5.1.1.
  // `network ls -o json` já está em `networks()`. Aqui ficam o detalhe, o
  // diagnóstico e as OPERAÇÕES (criar/remover, ligar/desligar um workload).
  //
  // Leitura: `inspect -o json` (driver/bridge/subnet/gateway de UMA rede),
  // `describe <nomes…>` (bloco legível, inclui os containers ligados com IP —
  // é a ÚNICA forma textual com IP por membro) e `diagnose -o json` (estado
  // vivo do nó: control plane, redes realizadas, registo de endereços).
  networkInspect: (name: string): Argv => ["network", "inspect", name, "-o", "json"],
  networkDescribe: (names: string[]): Argv => ["network", "describe", ...names],
  networkDiagnose: (): Argv => ["network", "diagnose", "-o", "json"],
  // Criar: NAME é posicional (último); `--driver` (bridge|macvlan|ipvlan|overlay)
  // e `--subnet` (opcional no bridge — o engine escolhe uma /16 livre). SafeWrite.
  networkCreate: (o: { name: string; driver?: string; subnet?: string }): Argv => [
    "network", "create",
    ...(o.driver ? ["--driver", o.driver] : []),
    ...(o.subnet && o.subnet.trim() ? ["--subnet", o.subnet.trim()] : []),
    o.name,
  ],
  // Remover (Destructive): `network rm <NAME>` — leva o registo e a bridge.
  networkRm: (name: string): Argv => ["network", "rm", name],
  // Ligar/desligar um container A QUENTE (ordem Docker: NETWORK CONTAINER).
  // connect multi-homeia (adiciona uma rede extra, reversível) → SafeWrite;
  // disconnect retira a conectividade nessa rede → Disruptive. Recusa a rede
  // primária (essa só sai com o container).
  networkConnect: (network: string, container: string): Argv => ["network", "connect", network, container],
  networkDisconnect: (network: string, container: string): Argv => ["network", "disconnect", network, container],
  // Banda ao vivo por container (eBPF; degrada a contadores veth). TEXTO (sem
  // `-o json`): `net flow [--iface <veth>]`; `-w` redesenha de 2 em 2 s mas usa
  // limpeza de ecrã ANSI (não é um fluxo por linha) — a UI corre o one-shot.
  netFlow: (iface?: string): Argv => ["net", "flow", ...(iface ? ["--iface", iface] : [])],

  run: (o: { name: string; image: string; ports: string[]; env: string[]; volumes: string[]; memory?: string; cpus?: string; restart?: string }): Argv => [
    "container", "run", "-d", "--name", o.name,
    ...o.ports.flatMap((p) => ["-p", p]),
    ...o.env.flatMap((e) => ["-e", e]),
    ...o.volumes.flatMap((v) => ["-v", v]),
    ...(o.memory ? ["--memory", o.memory] : []),
    ...(o.cpus ? ["--cpus", o.cpus] : []),
    ...(o.restart ? ["--restart", o.restart] : []),
    o.image,
  ],
};

// --- kubectl READ (recursos DENTRO de um cluster) ---------------------------
// Argv do `kubectl` (NÃO do delonix) para o comando backend `dlx_kubectl`, que
// corre o kubectl do sistema contra o kubeconfig em cache. SÓ verbos de LEITURA
// são montados aqui — e o backend revalida (defesa em profundidade). Não passam
// por `show()`/CliHint (que assumem o prefixo `delonix`).
export const kubectl = {
  getNodes: (): Argv => ["get", "nodes", "-o", "json"],
  // Sem namespace = todos (-A); com namespace = só esse (-n).
  getPods: (namespace?: string): Argv => [
    "get", "pods", ...(namespace ? ["-n", namespace] : ["-A"]), "-o", "json",
  ],
  getNamespaces: (): Argv => ["get", "namespaces", "-o", "json"],
  // Logs de um pod: últimas `tail` linhas (one-shot; a UI reatualiza a pedido).
  logs: (pod: string, namespace: string, tail = 500): Argv => [
    "logs", pod, "-n", namespace, "--tail", String(tail),
  ],
};
