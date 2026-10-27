import type {
  BackupRow, CliResult, ClusterRow, ComposeService, DashSummary, DoctorItem, EngineEvent, ImageRow, K8sNode, K8sPod, NetDiagnoseFinding, NetworkRow, ProviderReport, RiskLevel, SecretReveal, SecretRow, StackPlanRow, SystemMetrics, SystemResources, VmCreateInput, VmDetail, VmSnapshot, VolumeRow, WorkloadRow,
} from "./types";
import type { EngineInfo } from "./engine";
import type { Argv } from "./cli";

// Contrato único entre a UI e o engine. Há duas implementações:
// TauriClient (CLI real via backend Rust) e MockClient (o "duplo" local,
// usado quando a app corre no browser sem Tauri).
export interface DelonixClient {
  readonly live: boolean;
  binary(): Promise<string>;
  // Descoberta de versão/capacidades do engine (§3), lida UMA vez ao arrancar.
  // Devolve a versão semver, se é compatível com a família testada e a contagem
  // de capacidades (`mcp capabilities`). Best-effort: nunca lança (degrada a
  // version="" / compatible=true quando o engine não responde).
  engine(): Promise<EngineInfo>;
  dash(): Promise<DashSummary>;
  // Dashboard SRE (§B). `systemMetrics` são os contadores de frota estruturados
  // (storage por categoria incluído); `systemResources` traz os conselhos
  // acionáveis (advice[]), o gargalo atual e a pressão PSI. Ambos READ.
  systemMetrics(): Promise<SystemMetrics>;
  systemResources(): Promise<SystemResources>;
  // `namespace` (opcional) filtra por `workload ls -n <ns>` / `volume ls -n <ns>`
  // (os únicos verbos de lista escopados no 5.1.1); sem argumento lista todas as
  // namespaces — usado também na DESCOBERTA de namespaces do seletor global.
  workloads(namespace?: string): Promise<WorkloadRow[]>;
  images(): Promise<ImageRow[]>;
  // Imagens pelo contrato node.v1 (ListImages/Pull/Delete) — não CLI (decisão B).
  // `imagePull` corre a pull síncrona (sem progresso ao vivo no contrato) e lança
  // se falhar; `imageRemove` remove/untag. Lançam se o engine não servir (501).
  imagePull(reference: string, platform?: string): Promise<void>;
  imageRemove(reference: string): Promise<void>;
  // Volumes e redes pelo contrato node.v1 (REST) — não CLI (decisão B). O
  // tamanho do volume não é medível na lista (rootless) e os membros/usedBy
  // reconstroem-se dos containers. `networkDiagnose` fica na CLI (sem serviço).
  volumes(namespace?: string): Promise<VolumeRow[]>;
  networks(namespace?: string): Promise<NetworkRow[]>;
  // Detalhe de UMA rede (§8.6): GetNetwork + membros COM IP derivados dos
  // containers ligados. Usado pela vista de topologia.
  networkDetail(name: string): Promise<NetworkRow>;
  // Estado VIVO do nó de rede (`network diagnose -o json`): control plane,
  // redes realizadas e registo de endereços. READ. (Sem serviço node.v1 → CLI.)
  networkDiagnose(): Promise<NetDiagnoseFinding[]>;
  // Mutações de rede/volume pelo contrato node.v1 (Create/Delete; Connect liga um
  // container a uma rede). Lançam se o engine não servir o serviço (501).
  networkCreate(name: string, driver: string, subnet: string, namespace?: string): Promise<void>;
  networkRemove(name: string, namespace?: string): Promise<void>;
  networkConnect(network: string, container: string, namespace?: string): Promise<void>;
  networkDisconnect(network: string, container: string, namespace?: string): Promise<void>;
  volumeCreate(name: string, namespace?: string): Promise<void>;
  volumeRemove(name: string, namespace?: string): Promise<void>;
  // Segredos (§E): a LISTA traz só metadados (nome/chaves/versão), nunca valores.
  secrets(): Promise<SecretRow[]>;
  // Detalhe de UM segredo (`secret inspect`): o mapa chave→valor. Com
  // `reveal=false` os valores vêm redigidos ("••••••"); com `reveal=true` o
  // engine devolve-os EM CLARO (--reveal). É uma ação EXPLÍCITA do utilizador —
  // o valor revelado nunca é registado em histórico nem em log.
  secretInspect(name: string, reveal: boolean): Promise<SecretReveal>;
  // Backups (§E): arquivos no diretório `from` (default: diretório atual do engine).
  backups(from?: string): Promise<BackupRow[]>;
  providers(): Promise<ProviderReport[]>;
  doctor(): Promise<DoctorItem[]>;
  // --- Camada declarativa (§E) --------------------------------------------
  // Stacks: leitura estruturada de `stack plan -o json` (o que um apply faria).
  // O manifesto entra por caminho (-f); sem caminho usa o diretório do processo.
  stackPlan(manifest?: string): Promise<StackPlanRow[]>;
  // Stacks apply/destroy (node.v1): materializa/remove o manifesto. Uma Operation
  // JÁ TERMINAL (síncrona, sem progresso ao vivo) — lançam em caso de falha.
  stackApply(manifest?: string): Promise<void>;
  stackDestroy(manifest?: string): Promise<void>;
  // Clusters/Kubernetes: `cluster ls` é TEXTO (sem -o json no 5.1.1); parseado
  // por nome de coluna. `all` inclui clusters totalmente parados (-A).
  clusters(all?: boolean): Promise<ClusterRow[]>;
  // Recursos DENTRO de um cluster (kubectl READ, pela cache do kubeconfig). Só
  // leitura: ver nós, pods, namespaces e logs — nunca mutações. O backend
  // (`dlx_kubectl`) revalida cada subcomando como só-leitura.
  clusterNodes(cluster: string): Promise<K8sNode[]>;
  clusterPods(cluster: string, namespace?: string): Promise<K8sPod[]>;
  clusterNamespaces(cluster: string): Promise<string[]>;
  clusterPodLogs(cluster: string, pod: string, namespace: string, tail?: number): Promise<string>;
  // Compose: `compose ps` é TEXTO (SERVICE NAME IMAGE STATUS); opera num ficheiro.
  composePs(file?: string): Promise<ComposeService[]>;
  // Comandos declarativos só-texto (stack describe/validate/history, compose
  // config, cluster health/kubeconfig, cluster kube generate): a UI mostra o
  // stdout cru num painel. Todos READ → correm sem confirmação.
  readText(argv: Argv): Promise<CliResult>;
  risk(argv: Argv): Promise<RiskLevel | null>;
  run(argv: Argv, confirm: boolean): Promise<CliResult>;
  // Registries (§ registries): autentica num registry OCI. A password segue por
  // stdin no backend (comando dedicado `dlx_login`), NUNCA pelo argv. O
  // resultado (ok/erro) não contém a password.
  login(registry: string, username: string, password: string): Promise<CliResult>;
  // Fluxos longos (logs, eventos, build, pull). `onLine` recebe cada linha; o
  // `onEnd` opcional dispara quando o processo termina (ex.: um `build`/`pull`
  // acaba) com o CÓDIGO DE SAÍDA real (0 = sucesso; null se indeterminado) — os
  // fluxos infinitos (`logs -f`) nunca o chamam.
  stream(id: string, argv: Argv, onLine: (line: string) => void, onEnd?: (code: number | null) => void): Promise<() => void>;
  // Logs de um CONTAINER pelo server-stream gRPC de `ContainerService.Logs`
  // (node.v1), não por `delonix container logs -f` (CLI) — decisão B. Mesma forma
  // de `stream` (devolve o cancelador); pods continuam em `stream` (`pod logs -f`).
  containerLogs(id: string, name: string, namespace: string, onLine: (line: string) => void, timestamps?: boolean): Promise<() => void>;
  // `onEnd` (opcional) dispara quando o processo de eventos termina (o engine
  // caiu / o socket fechou) — permite ao consumidor religar com backoff
  // (lib/reconnectingStream.ts). Os fluxos infinitos saudáveis nunca o chamam.
  events(onEvent: (e: EngineEvent) => void, onEnd?: () => void): Promise<() => void>;
  // Sessão interativa por PTY (§3/§6). `mode` escolhe a semântica: `shell novo`
  // (container exec), `attach` ao processo principal (output-only), `pod exec`
  // (shell num membro), `consola série` de VM, ou a CONSOLA DO HOST (`host`) — o
  // shell de login da própria máquina. Nos modos de SESSÃO, `name` é o recurso;
  // no modo `host`, `name` é IGNORADO (o backend corre só o shell, nunca um
  // comando vindo do frontend). Os bytes do PTY chegam por `onData`; o fim por
  // `onEnd`.
  exec(id: string, name: string, mode: ExecMode, onData: (data: string) => void, onEnd: () => void): Promise<ExecSession>;
  // Identidade do host para ROTULAR a consola do host (user@host · shell). É
  // informativa: não altera o que a consola executa (o shell de login é sempre
  // fixado no backend). Best-effort — degrada para um rótulo genérico se faltar.
  hostIdentity(): Promise<HostIdentity>;
  // VMs pelo contrato de socket node.v1 (§5). As ações e a criação passam pelo
  // socket (não pela CLI); a tabela de Workloads continua a vir de `workload ls`.
  vmList(): Promise<VmDetail[]>;
  vmGet(name: string): Promise<VmDetail>;
  vmCreate(spec: VmCreateInput): Promise<void>;
  vmStart(name: string): Promise<void>;
  vmStop(name: string): Promise<void>;
  vmDelete(name: string): Promise<void>;
  vmSnapshotList(name: string): Promise<VmSnapshot[]>;
  vmSnapshotCreate(name: string, snapshot: string): Promise<void>;
  vmSnapshotRestore(name: string, snapshot: string): Promise<void>;
  // Inspeção de um CONTAINER pelo contrato node.v1 (REST GetContainer:
  // `GET /v1/namespaces/{ns}/containers/{name}`), não por `delonix describe`
  // (CLI). Devolve o JSON cru do contrato (meta/spec/status); a aba
  // "Inspecionar" serializa-o. Lança se o engine não servir ContainerService
  // (501 DX-6001) ou o container não existir — a aba mostra a razão.
  containerInspect(namespace: string, name: string): Promise<unknown>;
  // Ciclo de vida de um CONTAINER pelo contrato node.v1 (ContainerService
  // Start/Stop/Delete; "reiniciar" = stop+start, o contrato não tem RPC Restart),
  // não por `delonix` (CLI). Lançam se o engine não servir ContainerService
  // (501) — a tela mostra a razão. VMs usam `vm*`; pods continuam na CLI.
  containerStart(namespace: string, name: string): Promise<void>;
  containerStop(namespace: string, name: string): Promise<void>;
  containerRestart(namespace: string, name: string): Promise<void>;
  containerRemove(namespace: string, name: string): Promise<void>;
  // Uma amostra de métricas de container pelo `ContainerService.Stats` (gRPC),
  // não pelo `dashboard --json` (CLI) — decisão B. As taxas (CPU, rede) são
  // calculadas no frontend a partir de amostras sucessivas. Lança se o engine
  // não servir ContainerService ou o container estiver parado.
  containerStats(namespace: string, name: string): Promise<ContainerStatsSample>;
}

// Amostra crua de `ContainerStats` (node.v1): contadores ACUMULADOS (cpu_nanos,
// net rx/tx) que viram taxa no frontend, + instantâneos (mem, pids, writable).
export interface ContainerStatsSample {
  cpuUsageNanos: number;
  memoryWorkingSetBytes: number;
  memoryLimitBytes: number;
  pids: number;
  networkRxBytes: number;
  networkTxBytes: number;
  writableLayerBytes: number;
  unmeasured: string[];
}

// Os cinco modos de terminal por PTY (§6). Têm de casar EXATAMENTE com
// `parse_mode` no backend (exec.rs) — qualquer outra string é recusada (falha
// fechada), tanto no renderer como no Rust. DUAS naturezas distintas:
//  - SESSÃO dentro de um workload: `container-exec` | `container-attach` |
//    `pod-exec` | `vm-console` — ligam-se pelo engine `delonix`.
//  - CONSOLA DO HOST: `host` — o shell de login da própria máquina (acesso TOTAL
//    ao host, explícito e rotulado como tal; não passa pelo engine).
export type ExecMode = "container-exec" | "container-attach" | "pod-exec" | "vm-console" | "host";

// Identidade do host para rotular a consola do host (ex. `walter@maquina`).
export interface HostIdentity {
  user: string;
  host: string;
  shell: string;
}

// Uma sessão de exec viva: escreve stdin, redimensiona e termina o PTY.
export interface ExecSession {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  stop(): void;
}

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
