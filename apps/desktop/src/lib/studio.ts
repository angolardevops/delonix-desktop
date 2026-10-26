// Architecture Studio (§11) — modelo PURO do estúdio visual de arquitetura.
//
// Este módulo NÃO toca em React nem no engine: é a lógica testável que
// descreve o CATÁLOGO de componentes, as regras de LIGAÇÃO tipada, a VALIDAÇÃO
// do desenho, a serialização do design (.json) e a GERAÇÃO do manifesto de
// stack (YAML) que o `delonix stack apply -f` / `manifest validate -f` aceitam.
//
// O desenho (StudioDesign) é a fonte canónica, redonda em JSON. O manifesto é
// derivado de design → YAML (designToManifest) e, DESDE §11, reimportado de
// YAML → design (manifestToDesign), fechando o ciclo nos dois sentidos. Campos
// de um manifesto externo que o modelo não representa são PRESERVADOS num
// `extra` (por nó e ao nível do documento) e re-emitidos tal e qual no export,
// para que o roundtrip não perca informação em silêncio.

import { parseAllDocuments } from "yaml";
import { cmd, type Argv } from "./cli";
import type { NetworkRow, StackPlanRow, VmDetail, WorkloadRow } from "./types";

// --- Modelo -----------------------------------------------------------------

// Tipos mapeados aos ARRAYS do StackSpec do engine (§2 do prompt), um por
// componente que alimenta o motor. Todos menos `cluster` materializam-se no
// manifesto de stack; `cluster` é de DESENHO (provisiona-se por `cluster
// create`, fora do stack — ver STACK_KINDS / provisionActions). O mapeamento
// StudioKind → bucket do StackSpec:
//   container→containers · vm→vms · pod→pods · network→networks ·
//   volume→volumes · secret→secrets · image→images · app→apps ·
//   service→services · ingress→ingress · tunnel→tunnels ·
//   gateway→networkGateways · dependency→dependencies.
export type StudioKind =
  | "container"
  | "vm"
  | "pod"
  | "network"
  | "volume"
  | "secret"
  | "image"
  | "app"
  | "service"
  | "ingress"
  | "tunnel"
  | "gateway"
  | "dependency"
  | "cluster";

export interface StudioNode {
  id: string;
  kind: StudioKind;
  name: string;
  x: number;
  y: number;
  /** Propriedades editáveis (chave→valor), específicas do tipo. */
  props: Record<string, string>;
  /**
   * Campos do `spec` de um manifesto reimportado que o modelo NÃO representa.
   * Guardados em cru e re-emitidos tal e qual no export (designToManifest), para
   * o roundtrip YAML→design→YAML não perder informação. Ausente nos nós criados
   * no estúdio.
   */
  extra?: Record<string, unknown>;
}

export interface StudioEdge {
  id: string;
  source: string; // id do nó
  target: string; // id do nó
}

export interface StudioDesign {
  version: 1;
  name: string;
  namespace: string;
  nodes: StudioNode[];
  edges: StudioEdge[];
  /**
   * Partes de um manifesto reimportado que não pertencem a nenhum nó: chaves do
   * documento de topo além de apiVersion/kind/metadata/spec (`doc`) e secções do
   * `spec` que não são dos seis buckets conhecidos (`spec`). Re-emitidas no
   * export. Ausente num desenho criado no estúdio.
   */
  extra?: { doc?: Record<string, unknown>; spec?: Record<string, unknown> };
}

export function emptyDesign(name = "nova-arquitetura"): StudioDesign {
  return { version: 1, name, namespace: "", nodes: [], edges: [] };
}

// --- Catálogo ---------------------------------------------------------------

export interface FieldDef {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "number";
  /** Dica curta mostrada por baixo do campo. */
  hint?: string;
}

export interface CatalogEntry {
  kind: StudioKind;
  label: string;
  /** Nome do ícone (Icon.tsx). */
  icon: string;
  /** Token de cor para o nó/aresta (coerente com o resto da app). */
  color: string;
  /** Verdadeiro quando o tipo entra no manifesto de stack gerado. */
  emitsToStack: boolean;
  /** Campos editáveis no painel de propriedades. */
  fields: FieldDef[];
  /** Propriedades por omissão de um nó novo deste tipo. */
  defaults: Record<string, string>;
  /** Uma linha a explicar o papel do componente. */
  blurb: string;
}

export const CATALOG: Record<StudioKind, CatalogEntry> = {
  container: {
    kind: "container", label: "Container", icon: "workloads", color: "var(--chart-1)", emitsToStack: true,
    blurb: "Processo em OCI rootless. Liga a redes, volumes e segredos.",
    fields: [
      { key: "image", label: "Imagem", placeholder: "nginx:latest", hint: "Obrigatória (repo:tag)." },
      { key: "ports", label: "Portas", placeholder: "8080:80, 443:443", hint: "host:container, separadas por vírgula." },
      { key: "env", label: "Ambiente", placeholder: "KEY=valor, OUTRA=1", hint: "KEY=valor, separadas por vírgula." },
      { key: "command", label: "Comando", placeholder: "nginx -g 'daemon off;'" },
    ],
    defaults: { image: "", ports: "", env: "", command: "" },
  },
  vm: {
    kind: "vm", label: "Máquina virtual", icon: "workloads", color: "var(--inf)", emitsToStack: true,
    blurb: "microVM (Cloud Hypervisor/libvirt). Arranca de um disco base.",
    fields: [
      { key: "disk", label: "Disco base", placeholder: "ubuntu-22.04", hint: "Nome da imagem de VM no store (campo spec.disk)." },
      { key: "vcpus", label: "vCPUs", placeholder: "2", type: "number" },
      { key: "memory", label: "Memória", placeholder: "2G" },
    ],
    defaults: { disk: "", vcpus: "", memory: "" },
  },
  pod: {
    kind: "pod", label: "Pod", icon: "workloads", color: "var(--chart-2)", emitsToStack: true,
    blurb: "Grupo de containers com rede partilhada (kind: Pod).",
    fields: [
      { key: "image", label: "Imagem", placeholder: "redis:7", hint: "Imagem do container principal do pod." },
      { key: "ports", label: "Portas", placeholder: "6379", hint: "Portas do container, separadas por vírgula." },
    ],
    defaults: { image: "", ports: "" },
  },
  network: {
    kind: "network", label: "Rede", icon: "networks", color: "var(--brand-core)", emitsToStack: true,
    blurb: "Rede de sobreposição/bridge rootless. Liga workloads entre si.",
    fields: [
      { key: "driver", label: "Driver", placeholder: "bridge", hint: "bridge | macvlan | ipvlan | overlay" },
      { key: "subnet", label: "Sub-rede", placeholder: "10.89.0.0/24", hint: "Opcional no bridge (o engine escolhe uma /16 livre)." },
    ],
    defaults: { driver: "bridge", subnet: "" },
  },
  volume: {
    kind: "volume", label: "Volume", icon: "volumes", color: "var(--chart-3, var(--ok))", emitsToStack: true,
    blurb: "Volume persistente. Monta-se num container ou pod.",
    fields: [
      // `size` só vale DENTRO de um storage pool; um volume AVULSO usa `quota`
      // (DX-1217). O campo "Tamanho" mapeia para `quota` fora de um pool e para
      // `size` quando "Storage pool" está preenchido.
      { key: "quota", label: "Tamanho", placeholder: "1G", hint: "Fora de um pool é a quota; num pool vira o size fixo (opcional)." },
      { key: "pool", label: "Storage pool", placeholder: "", hint: "Opcional. Dentro de um pool o tamanho é um size reservado; fora, uma quota." },
      { key: "driver", label: "Driver", placeholder: "local" },
      { key: "mount", label: "Ponto de montagem", placeholder: "/data", hint: "Caminho dentro do container ligado." },
    ],
    defaults: { quota: "", pool: "", driver: "local", mount: "/data" },
  },
  secret: {
    kind: "secret", label: "Segredo", icon: "secrets", color: "var(--warn)", emitsToStack: true,
    blurb: "Mapa chave→valor. As chaves declaram-se aqui; os valores NUNCA no desenho.",
    fields: [
      { key: "keys", label: "Chaves", placeholder: "API_KEY, DB_PASSWORD", hint: "Só os NOMES. Os valores definem-se fora do estúdio." },
    ],
    defaults: { keys: "" },
  },
  image: {
    kind: "image", label: "Imagem", icon: "images", color: "var(--chart-2)", emitsToStack: true,
    blurb: "Imagem OCI do stack: puxa de um registry (pull) OU constrói de um contexto (build).",
    fields: [
      { key: "pull", label: "Puxar (pull)", placeholder: "nginx:latest", hint: "Referência a puxar. Deixa vazio para CONSTRUIR em vez de puxar." },
      { key: "buildTag", label: "Construir — tag", placeholder: "minha-app:1", hint: "Só se não puxares: a tag que a imagem construída recebe." },
      { key: "buildContext", label: "Construir — contexto", placeholder: ".", hint: "Diretório do build (default '.')." },
    ],
    defaults: { pull: "", buildTag: "", buildContext: "." },
  },
  app: {
    kind: "app", label: "App (buildpack)", icon: "build", color: "var(--chart-4, var(--inf))", emitsToStack: true,
    blurb: "Aplicação por Cloud Native Buildpacks: constrói do código-fonte, sem Dockerfile.",
    fields: [
      { key: "image", label: "Imagem de saída", placeholder: "api:latest", hint: "Obrigatória: a tag que a imagem construída recebe no store local." },
      { key: "builder", label: "Builder", placeholder: "auto | heroku | <imagem>", hint: "'auto' deteta a stack (Paketo); um builder próprio exige runImage." },
      { key: "source", label: "Código-fonte", placeholder: ".", hint: "Diretório a construir (relativo ao CWD, default '.')." },
    ],
    defaults: { image: "", builder: "auto", source: "." },
  },
  service: {
    kind: "service", label: "Serviço", icon: "service", color: "var(--chart-1)", emitsToStack: true,
    blurb: "Serviço DNS/VirtualIP que seleciona workloads por rótulo (matchLabels).",
    fields: [
      { key: "port", label: "Porta", placeholder: "80", type: "number", hint: "Porta do container que os workloads selecionados servem." },
      { key: "selector", label: "Seletor", placeholder: "app=web, tier=front", hint: "matchLabels: pares rótulo=valor. Vazio → app=<nome do serviço>." },
      { key: "type", label: "Tipo", placeholder: "DNS | VirtualIP", hint: "DNS (default, ADR-0032) ou VirtualIP (ADR-0066)." },
    ],
    defaults: { port: "", selector: "", type: "DNS" },
  },
  ingress: {
    kind: "ingress", label: "Ingress (HTTP)", icon: "ingress", color: "var(--inf)", emitsToStack: true,
    blurb: "Entrada HTTP(S) do proxy L7: encaminha host/caminho para um container. Liga ao container de destino.",
    fields: [
      { key: "host", label: "Host", placeholder: "exemplo.local", hint: "Opcional: host a casar. Vazio = qualquer host." },
      { key: "path", label: "Caminho", placeholder: "/", hint: "Prefixo a casar (default '/')." },
      { key: "port", label: "Porta do backend", placeholder: "80", type: "number", hint: "Porta do container de destino." },
    ],
    defaults: { host: "", path: "/", port: "80" },
  },
  tunnel: {
    kind: "tunnel", label: "Túnel público", icon: "tunnel", color: "var(--chart-4, var(--inf))", emitsToStack: true,
    blurb: "Expõe uma porta local à internet (pinggy/ngrok/cloudflare). Entra no stack (kind: Tunnel).",
    fields: [
      { key: "provider", label: "Fornecedor", placeholder: "pinggy | ngrok | cloudflare", hint: "Obrigatório." },
      { key: "localPort", label: "Porta local", placeholder: "8080", type: "number", hint: "Obrigatória: a porta local exposta." },
      { key: "hostname", label: "Hostname", placeholder: "app.exemplo.com", hint: "Opcional: hostname custom/reservado (depende do fornecedor)." },
    ],
    defaults: { provider: "pinggy", localPort: "", hostname: "" },
  },
  gateway: {
    kind: "gateway", label: "Gateway (appliance)", icon: "networks", color: "var(--chart-3, var(--ok))", emitsToStack: true,
    blurb: "Gateway de appliance (NAT/políticas/aliases) via provider registado. Entra no stack (kind: NetworkGateway).",
    fields: [
      { key: "provider", label: "Provider", placeholder: "opnsense", hint: "Id do GatewayProvider registado. Opcional (ADR-0059 F2c)." },
    ],
    defaults: { provider: "opnsense" },
  },
  dependency: {
    kind: "dependency", label: "Dependência", icon: "dependency", color: "var(--chart-2)", emitsToStack: true,
    blurb: "Dependência dirigida: 'from' alcança 'to' (ordena o apply e protege o alvo). from/to são nomes de container/VM/pod.",
    fields: [
      { key: "from", label: "De (from)", placeholder: "web", hint: "Obrigatório: quem INICIA a ligação (container/VM que 'conhece')." },
      { key: "to", label: "Para (to)", placeholder: "db", hint: "Obrigatório: alvo(s) alcançados, separados por vírgula." },
      { key: "ports", label: "Portas", placeholder: "5432", hint: "Portas de 'to' abertas a 'from' (vazio = qualquer)." },
      { key: "proto", label: "Protocolo", placeholder: "tcp | udp | any", hint: "Opcional (default any)." },
    ],
    defaults: { from: "", to: "", ports: "", proto: "" },
  },
  cluster: {
    kind: "cluster", label: "Cluster Kubernetes", icon: "kubernetes", color: "var(--chart-2)", emitsToStack: false,
    blurb: "Cluster kind-mode. DESENHO — cria-se por `cluster create`, não pelo stack.",
    fields: [
      { key: "controlPlanes", label: "Control-planes", placeholder: "1", type: "number" },
      { key: "workers", label: "Workers", placeholder: "2", type: "number" },
      { key: "cni", label: "CNI", placeholder: "default | none" },
    ],
    defaults: { controlPlanes: "1", workers: "2", cni: "default" },
  },
};

export const ALL_KINDS: StudioKind[] = Object.keys(CATALOG) as StudioKind[];

// Tipos que se materializam no manifesto de stack (os outros são de desenho).
export const STACK_KINDS: StudioKind[] = ALL_KINDS.filter((k) => CATALOG[k].emitsToStack);

// --- Modelos (templates) ----------------------------------------------------
// Desenhos de arranque PRONTOS. São puros (sem React) para os testes poderem
// provar que cada modelo gera um manifesto que o engine valida. O estúdio abre
// no primeiro ("web-db") para o canvas NÃO parecer vazio; "Vazio" limpa.

export interface StudioTemplate {
  id: string;
  label: string;
  blurb: string;
  make: () => StudioDesign;
}

export const STUDIO_TEMPLATES: StudioTemplate[] = [
  {
    id: "web-db",
    label: "Web + Base de dados",
    blurb: "Front-end numa rede, base de dados com volume persistente e segredo.",
    make: (): StudioDesign => ({
      version: 1,
      name: "web-db",
      namespace: "",
      nodes: [
        { id: "net", kind: "network", name: "app", x: 360, y: 40, props: { driver: "bridge", subnet: "10.89.0.0/24" } },
        { id: "web", kind: "container", name: "web", x: 120, y: 260, props: { image: "nginx:latest", ports: "8080:80", env: "", command: "" } },
        { id: "db", kind: "container", name: "db", x: 600, y: 260, props: { image: "postgres:16", ports: "", env: "POSTGRES_PASSWORD=change-me", command: "" } },
        { id: "data", kind: "volume", name: "pgdata", x: 600, y: 480, props: { quota: "5G", driver: "local", mount: "/var/lib/postgresql/data" } },
        { id: "sec", kind: "secret", name: "db-secret", x: 360, y: 480, props: { keys: "POSTGRES_PASSWORD" } },
      ],
      edges: [
        { id: "e1", source: "net", target: "web" },
        { id: "e2", source: "net", target: "db" },
        { id: "e3", source: "db", target: "data" },
        { id: "e4", source: "db", target: "sec" },
      ],
    }),
  },
  {
    id: "pod-net",
    label: "Pod numa rede",
    blurb: "Um pod (rede partilhada entre containers) ligado a uma rede.",
    make: (): StudioDesign => ({
      version: 1,
      name: "pod-stack",
      namespace: "",
      nodes: [
        { id: "net", kind: "network", name: "mesh", x: 320, y: 60, props: { driver: "bridge", subnet: "" } },
        { id: "pod", kind: "pod", name: "cache", x: 320, y: 280, props: { image: "redis:7", ports: "6379" } },
      ],
      edges: [{ id: "e1", source: "net", target: "pod" }],
    }),
  },
  {
    id: "vm-net",
    label: "VM numa rede",
    blurb: "microVM ligada a uma rede bridge — ponto de partida para um host.",
    make: (): StudioDesign => ({
      version: 1,
      name: "vm-stack",
      namespace: "",
      nodes: [
        { id: "net", kind: "network", name: "lan", x: 320, y: 60, props: { driver: "bridge", subnet: "" } },
        { id: "vm", kind: "vm", name: "host", x: 320, y: 280, props: { disk: "ubuntu-22.04", vcpus: "2", memory: "2G" } },
      ],
      edges: [{ id: "e1", source: "net", target: "vm" }],
    }),
  },
];

export function defaultDesign(): StudioDesign {
  return STUDIO_TEMPLATES[0].make();
}

// --- Ligações tipadas -------------------------------------------------------
// Pares VÁLIDOS (não-orientados). Uma ligação container↔container, por exemplo,
// não tem significado no modelo e é recusada.
const VALID_PAIRS = new Set<string>([
  pair("container", "network"),
  pair("container", "volume"),
  pair("container", "secret"),
  pair("vm", "network"),
  pair("pod", "network"),
  pair("pod", "volume"),
  // Ingress → backend: a aresta resolve o `backend.service.name` do ingress para
  // o container/pod de destino (o proxy L7 encaminha HTTP para ele). É a ÚNICA
  // ligação nova QUE EMITE no manifesto (e se reconstrói no reimport).
  pair("ingress", "container"),
  pair("ingress", "pod"),
  // Gateway (appliance) serve uma rede — informativo (não altera o spec).
  pair("gateway", "network"),
]);

function pair(a: StudioKind, b: StudioKind): string {
  return [a, b].sort().join("|");
}

export function canConnect(a: StudioKind, b: StudioKind): boolean {
  if (a === b) return false;
  return VALID_PAIRS.has(pair(a, b));
}

// Explica porque uma ligação é inválida (para o feedback na UI).
export function connectionError(a: StudioKind, b: StudioKind): string | null {
  if (canConnect(a, b)) return null;
  if (a === b) return `Dois ${CATALOG[a].label.toLowerCase()} não se ligam diretamente.`;
  return `${CATALOG[a].label} e ${CATALOG[b].label} não formam uma ligação válida.`;
}

// Rótulo curto para a aresta, derivado dos tipos dos extremos (e do ponto de
// montagem do volume, quando aplicável). Dá significado visível à ligação no
// canvas — "rede", "monta em /data", "segredo", "expõe". Puro e testável.
export function edgeLabel(design: StudioDesign, edge: StudioEdge): string {
  const byId = new Map(design.nodes.map((n) => [n.id, n]));
  const s = byId.get(edge.source);
  const t = byId.get(edge.target);
  if (!s || !t) return "";
  const kinds = new Set<StudioKind>([s.kind, t.kind]);
  const vol = s.kind === "volume" ? s : t.kind === "volume" ? t : null;
  if (vol) return `monta em ${vol.props.mount?.trim() || `/mnt/${vol.name.trim()}`}`;
  if (kinds.has("secret")) return "segredo";
  if (kinds.has("ingress")) return "encaminha";
  if (kinds.has("gateway")) return "serve";
  if (kinds.has("network")) return "rede";
  return "";
}

// --- Validação do desenho ---------------------------------------------------

export type IssueLevel = "error" | "warn";

export interface Issue {
  level: IssueLevel;
  nodeId?: string;
  message: string;
}

const NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export function validateDesign(d: StudioDesign): Issue[] {
  const issues: Issue[] = [];
  const byId = new Map(d.nodes.map((n) => [n.id, n]));

  // Nomes: obrigatórios, DNS-1123 e únicos por tipo.
  const seen = new Map<string, string>();
  for (const n of d.nodes) {
    const nm = n.name.trim();
    if (!nm) { issues.push({ level: "error", nodeId: n.id, message: `${CATALOG[n.kind].label} sem nome.` }); continue; }
    if (!NAME_RE.test(nm)) issues.push({ level: "error", nodeId: n.id, message: `Nome inválido "${nm}" — usa minúsculas, dígitos e hífen.` });
    const key = `${n.kind}/${nm}`;
    if (seen.has(key)) issues.push({ level: "error", nodeId: n.id, message: `Nome repetido: já existe um ${CATALOG[n.kind].label.toLowerCase()} "${nm}".` });
    seen.set(key, n.id);
  }

  // Campos obrigatórios por tipo + conselhos. Nomes de workload por tipo+nome
  // (para avisar quando uma dependência aponta para um recurso inexistente).
  const names = new Set(d.nodes.map((n) => `${n.kind}/${n.name.trim()}`));
  const anyNamed = (nm: string) => ["container", "vm", "pod"].some((k) => names.has(`${k}/${nm}`));
  for (const n of d.nodes) {
    if ((n.kind === "container" || n.kind === "pod") && !n.props.image?.trim())
      issues.push({ level: "error", nodeId: n.id, message: `${CATALOG[n.kind].label} "${n.name}" sem imagem.` });
    if (n.kind === "vm" && !n.props.disk?.trim())
      issues.push({ level: "error", nodeId: n.id, message: `VM "${n.name}" sem disco base.` });
    if (n.kind === "secret" && !n.props.keys?.trim())
      issues.push({ level: "warn", nodeId: n.id, message: `Segredo "${n.name}" sem chaves declaradas.` });
    if (n.kind === "image" && !n.props.pull?.trim() && !n.props.buildTag?.trim())
      issues.push({ level: "error", nodeId: n.id, message: `Imagem "${n.name}" sem referência: define "pull" OU a tag de build.` });
    if (n.kind === "app" && !n.props.image?.trim())
      issues.push({ level: "error", nodeId: n.id, message: `App "${n.name}" sem imagem de saída.` });
    if (n.kind === "service") {
      const port = Number(n.props.port);
      if (!Number.isInteger(port) || port <= 0)
        issues.push({ level: "error", nodeId: n.id, message: `Serviço "${n.name}" sem porta válida.` });
    }
    if (n.kind === "tunnel") {
      if (!n.props.provider?.trim())
        issues.push({ level: "error", nodeId: n.id, message: `Túnel "${n.name}" sem fornecedor.` });
      const lp = Number(n.props.localPort);
      if (!Number.isInteger(lp) || lp <= 0)
        issues.push({ level: "error", nodeId: n.id, message: `Túnel "${n.name}" sem porta local válida.` });
    }
    if (n.kind === "dependency") {
      if (!n.props.from?.trim()) issues.push({ level: "error", nodeId: n.id, message: `Dependência "${n.name}" sem "from".` });
      if (!csv(n.props.to).length) issues.push({ level: "error", nodeId: n.id, message: `Dependência "${n.name}" sem "to".` });
      // Avisos de referência: o engine recusa um from/to que não seja um
      // container/VM/pod declarado (visto ao vivo em `manifest validate`).
      if (n.props.from?.trim() && !anyNamed(n.props.from.trim()))
        issues.push({ level: "warn", nodeId: n.id, message: `Dependência "${n.name}": "from" ("${n.props.from.trim()}") não é um workload declarado — o engine recusa a referência.` });
      for (const to of csv(n.props.to)) if (!anyNamed(to))
        issues.push({ level: "warn", nodeId: n.id, message: `Dependência "${n.name}": "to" ("${to}") não é um workload declarado — o engine recusa a referência.` });
    }
    if (n.kind === "ingress") {
      const hasBackend = d.edges.some((e) => {
        const other = e.source === n.id ? byId.get(e.target) : e.target === n.id ? byId.get(e.source) : undefined;
        return other && (other.kind === "container" || other.kind === "pod");
      });
      if (!hasBackend)
        issues.push({ level: "warn", nodeId: n.id, message: `Ingress "${n.name}" sem backend — liga-o a um container/pod de destino.` });
    }
  }

  // Arestas: extremos existentes e par tipado válido.
  for (const e of d.edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) { issues.push({ level: "error", message: "Ligação com extremo inexistente." }); continue; }
    const err = connectionError(s.kind, t.kind);
    if (err) issues.push({ level: "error", message: err });
  }

  // Conselhos de ligação em falta (não bloqueiam).
  const degree = new Map<string, number>();
  for (const e of d.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  for (const n of d.nodes) {
    if ((n.kind === "container" || n.kind === "vm" || n.kind === "pod") && !(degree.get(n.id))) {
      issues.push({ level: "warn", nodeId: n.id, message: `${CATALOG[n.kind].label} "${n.name}" não está ligado a nenhuma rede.` });
    }
  }

  return issues;
}

// --- Emissor YAML mínimo ----------------------------------------------------
// Suficiente para a forma restrita do manifesto (mapas, listas, escalares). NÃO
// é um serializador YAML geral — só o que precisamos emitir deterministicamente.

type Yaml = string | number | boolean | Yaml[] | { [k: string]: Yaml };

function needsQuote(s: string): boolean {
  if (s === "") return true;
  // Barewords seguros: letras/dígitos/_/./- e que não pareçam número/booleano.
  if (/^[A-Za-z0-9_./-]+$/.test(s) && !/^[0-9]/.test(s) && !/^(true|false|null|yes|no|on|off)$/i.test(s)) return false;
  return true;
}

function scalar(v: string | number | boolean): string {
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  return needsQuote(v) ? JSON.stringify(v) : v;
}

export function toYaml(value: Yaml, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((item) => {
        if (item !== null && typeof item === "object" && !Array.isArray(item)) {
          // Item-objeto: primeira chave na mesma linha do traço.
          const body = toYaml(item, indent + 1);
          const lines = body.split("\n");
          const firstNonEmpty = lines.findIndex((l) => l.trim() !== "");
          lines[firstNonEmpty] = `${pad}- ${lines[firstNonEmpty].trimStart()}`;
          return lines.join("\n");
        }
        return `${pad}- ${Array.isArray(item) ? "\n" + toYaml(item, indent + 1) : scalar(item as string | number | boolean)}`;
      })
      .join("\n");
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return "{}";
    return entries
      .map(([k, v]) => {
        if (v !== null && typeof v === "object" && (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0)) {
          return `${pad}${k}:\n${toYaml(v, indent + 1)}`;
        }
        if (v !== null && typeof v === "object") {
          return `${pad}${k}: ${Array.isArray(v) ? "[]" : "{}"}`;
        }
        return `${pad}${k}: ${scalar(v as string | number | boolean)}`;
      })
      .join("\n");
  }
  return `${pad}${scalar(value)}`;
}

// --- Geração do manifesto ---------------------------------------------------

function csv(s?: string): string[] {
  return (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
}

// Separa uma lista "k=v, k2=v2" num mapa {k: v}. Inverso de kvJoin. Puro.
function parseKV(s?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of csv(s)) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
// Junta um mapa {k: v} em "k=v, k2=v2" (ordem de inserção). Inverso de parseKV.
function kvJoin(m: Record<string, unknown>): string {
  return Object.entries(m).map(([k, v]) => `${k}=${str(v)}`).join(", ");
}

// Funde campos "extra" (preservados de uma reimportação) num objeto de spec, SEM
// sobrepor as chaves que o mapeamento conhecido já produziu. Puro.
function mergeExtra<T extends Record<string, Yaml>>(spec: T, extra?: Record<string, unknown>): T {
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (!(k in spec)) (spec as Record<string, Yaml>)[k] = v as Yaml;
    }
  }
  return spec;
}

export interface ManifestResult {
  yaml: string;
  warnings: string[];
}

// Converte o desenho num manifesto `kind: Stack`, mapeando cada tipo ao seu
// bucket do StackSpec (containers/networks/volumes/secrets/images/apps/services/
// ingress/tunnels/networkGateways/dependencies/pods/vms). Resolve as arestas:
// container→rede (spec.network), container/pod→volume (spec.volumes com o ponto
// de montagem), container→segredo (spec.secret) e ingress→container/pod
// (rules[].http.paths[].backend.service.name). O único tipo de DESENHO é
// `cluster` — NÃO entra no stack (aviso honesto; provisiona-se por `cluster
// create`, ver provisionActions). Campos preservados de uma reimportação
// (node.extra / design.extra) são re-emitidos tal e qual, fechando o roundtrip
// com manifestToDesign (ver abaixo).
export function designToManifest(d: StudioDesign, opts?: { namespace?: string }): ManifestResult {
  const warnings: string[] = [];
  const byId = new Map(d.nodes.map((n) => [n.id, n]));

  // Vizinhos por nó (não-orientado), filtrados por tipo do outro extremo.
  const neighborsOf = (id: string, kind: StudioKind): StudioNode[] => {
    const out: StudioNode[] = [];
    for (const e of d.edges) {
      const other = e.source === id ? byId.get(e.target) : e.target === id ? byId.get(e.source) : undefined;
      if (other && other.kind === kind) out.push(other);
    }
    return out;
  };

  const spec: Record<string, Yaml> = {};
  const push = (bucket: string, item: Yaml) => {
    (spec[bucket] as Yaml[] | undefined) ? (spec[bucket] as Yaml[]).push(item) : (spec[bucket] = [item]);
  };

  for (const n of d.nodes) {
    const name = n.name.trim();
    if (!CATALOG[n.kind].emitsToStack) {
      warnings.push(`${CATALOG[n.kind].label} "${name}" não entra no manifesto de stack (provisiona-se à parte).`);
      continue;
    }
    switch (n.kind) {
      case "network": {
        const s: Record<string, Yaml> = { driver: n.props.driver?.trim() || "bridge" };
        if (n.props.subnet?.trim()) s.subnet = n.props.subnet.trim();
        mergeExtra(s, n.extra);
        push("networks", { name, spec: s });
        break;
      }
      case "volume": {
        const s: Record<string, Yaml> = {};
        // DX-1217: `size` só é válido DENTRO de um storage pool; um volume
        // AVULSO usa `quota`. O campo "Tamanho" (props.quota) vira `size` quando
        // há `pool` e `quota` quando não há.
        const pool = n.props.pool?.trim();
        const amount = n.props.quota?.trim();
        if (pool) {
          s.pool = pool;
          if (amount) s.size = amount;
        } else if (amount) {
          s.quota = amount;
        }
        if (n.props.driver?.trim() && n.props.driver.trim() !== "local") s.driver = n.props.driver.trim();
        mergeExtra(s, n.extra);
        push("volumes", { name, spec: s });
        break;
      }
      case "secret": {
        const stringData: Record<string, Yaml> = {};
        for (const k of csv(n.props.keys)) stringData[k] = "";
        const ss: Record<string, Yaml> = {};
        if (Object.keys(stringData).length) ss.stringData = stringData;
        mergeExtra(ss, n.extra);
        push("secrets", { name, spec: ss });
        break;
      }
      case "container": {
        const s: Record<string, Yaml> = { image: n.props.image?.trim() || "" };
        const nets = neighborsOf(n.id, "network");
        if (nets[0]) s.network = nets[0].name.trim();
        if (nets.length > 1) warnings.push(`Container "${name}" ligado a ${nets.length} redes — o manifesto usa a primeira ("${nets[0].name}").`);
        const ports = csv(n.props.ports);
        if (ports.length) s.ports = ports;
        const env = csv(n.props.env);
        if (env.length) s.env = env;
        if (n.props.command?.trim()) s.command = csv(n.props.command).length > 1 ? csv(n.props.command) : [n.props.command.trim()];
        const vols = neighborsOf(n.id, "volume").map((v) => `${v.name.trim()}:${v.props.mount?.trim() || `/mnt/${v.name.trim()}`}`);
        if (vols.length) s.volumes = vols;
        const secs = neighborsOf(n.id, "secret").map((x) => x.name.trim());
        if (secs.length) s.secret = secs;
        mergeExtra(s, n.extra);
        push("containers", { name, spec: s });
        break;
      }
      case "pod": {
        const c: Record<string, Yaml> = { name, image: n.props.image?.trim() || "" };
        const pports = csv(n.props.ports)
          .map((p) => Number(p.split(":").pop()))
          .filter((p) => Number.isInteger(p) && p > 0)
          .map((p) => ({ containerPort: p }));
        if (pports.length) c.ports = pports;
        const ps: Record<string, Yaml> = {};
        const pnets = neighborsOf(n.id, "network");
        if (pnets[0]) ps.network = pnets[0].name.trim();
        if (pnets.length > 1) warnings.push(`Pod "${name}" ligado a ${pnets.length} redes — o manifesto usa a primeira ("${pnets[0].name}").`);
        ps.containers = [c];
        mergeExtra(ps, n.extra);
        push("pods", { name, spec: ps });
        break;
      }
      case "vm": {
        const s: Record<string, Yaml> = {};
        if (n.props.disk?.trim()) s.disk = n.props.disk.trim();
        if (n.props.vcpus?.trim()) s.vcpus = Number(n.props.vcpus) || n.props.vcpus.trim();
        if (n.props.memory?.trim()) s.memory = n.props.memory.trim();
        const vnets = neighborsOf(n.id, "network");
        if (vnets[0]) s.network = vnets[0].name.trim();
        if (vnets.length > 1) warnings.push(`VM "${name}" ligada a ${vnets.length} redes — o manifesto usa a primeira ("${vnets[0].name}").`);
        mergeExtra(s, n.extra);
        push("vms", { name, spec: s });
        break;
      }
      case "image": {
        const s: Record<string, Yaml> = {};
        if (n.props.pull?.trim()) {
          s.pull = n.props.pull.trim();
        } else if (n.props.buildTag?.trim()) {
          s.build = { tag: n.props.buildTag.trim(), context: n.props.buildContext?.trim() || "." };
        }
        mergeExtra(s, n.extra);
        push("images", { name, spec: s });
        break;
      }
      case "app": {
        const s: Record<string, Yaml> = { image: n.props.image?.trim() || "" };
        if (n.props.builder?.trim() && n.props.builder.trim() !== "auto") s.builder = n.props.builder.trim();
        if (n.props.source?.trim() && n.props.source.trim() !== ".") s.source = n.props.source.trim();
        mergeExtra(s, n.extra);
        push("apps", { name, spec: s });
        break;
      }
      case "service": {
        const s: Record<string, Yaml> = {};
        const port = Number(n.props.port);
        if (Number.isInteger(port) && port > 0) s.port = port;
        // selector é OBRIGATÓRIO no ServiceSpec: vazio → seleciona app=<nome>.
        const sel = parseKV(n.props.selector);
        s.selector = { matchLabels: Object.keys(sel).length ? sel : { app: name } };
        if (n.props.type?.trim() && n.props.type.trim() !== "DNS") s.type = n.props.type.trim();
        mergeExtra(s, n.extra);
        push("services", { name, spec: s });
        break;
      }
      case "ingress": {
        const s: Record<string, Yaml> = {};
        const backends = [...neighborsOf(n.id, "container"), ...neighborsOf(n.id, "pod")];
        if (backends[0]) {
          const port = Number(n.props.port) || 80;
          const rule: Record<string, Yaml> = {};
          if (n.props.host?.trim()) rule.host = n.props.host.trim();
          rule.http = {
            paths: [{
              path: n.props.path?.trim() || "/",
              pathType: "Prefix",
              backend: { service: { name: backends[0].name.trim(), port: { number: port } } },
            }],
          };
          s.rules = [rule];
          if (backends.length > 1) warnings.push(`Ingress "${name}" ligado a ${backends.length} backends — o manifesto encaminha para o primeiro ("${backends[0].name}").`);
        } else {
          warnings.push(`Ingress "${name}" sem backend — liga-o a um container/pod; o manifesto fica sem regras.`);
        }
        mergeExtra(s, n.extra);
        push("ingress", { name, spec: s });
        break;
      }
      case "tunnel": {
        const s: Record<string, Yaml> = { provider: n.props.provider?.trim() || "pinggy" };
        const lp = Number(n.props.localPort);
        if (Number.isInteger(lp) && lp > 0) s.localPort = lp;
        if (n.props.hostname?.trim()) s.hostname = n.props.hostname.trim();
        mergeExtra(s, n.extra);
        push("tunnels", { name, spec: s });
        break;
      }
      case "gateway": {
        const s: Record<string, Yaml> = {};
        if (n.props.provider?.trim()) s.provider = n.props.provider.trim();
        mergeExtra(s, n.extra);
        push("networkGateways", { name, spec: s });
        break;
      }
      case "dependency": {
        const s: Record<string, Yaml> = {};
        if (n.props.from?.trim()) s.from = n.props.from.trim();
        const to = csv(n.props.to);
        if (to.length === 1) s.to = to[0];
        else if (to.length > 1) s.to = to;
        const ports = csv(n.props.ports);
        if (ports.length) s.ports = ports;
        if (n.props.proto?.trim()) s.proto = n.props.proto.trim();
        mergeExtra(s, n.extra);
        push("dependencies", { name, spec: s });
        break;
      }
      default:
        break;
    }
  }

  // Secções de spec preservadas de uma reimportação (buckets desconhecidos).
  mergeExtra(spec, d.extra?.spec);

  // Namespace SEMPRE emitida (silencia o WARN "stack declares no namespace"): a
  // do desenho, senão a namespace ativa do contexto, senão "default" (onde o
  // engine as poria de qualquer forma — explicitá-la é honesto).
  const namespace = d.namespace.trim() || opts?.namespace?.trim() || "default";
  const doc: Record<string, Yaml> = {
    apiVersion: "core.delonix.io/v1alpha1",
    kind: "Stack",
    metadata: { name: d.name.trim() || "studio-stack", namespace },
    spec,
  };

  // Chaves de topo preservadas de uma reimportação (além das quatro canónicas).
  mergeExtra(doc, d.extra?.doc);

  return { yaml: toYaml(doc) + "\n", warnings };
}

// --- Reimportação (YAML → desenho) ------------------------------------------
// Inverso de designToManifest: lê um manifesto `kind: Stack` e reconstrói o
// grafo (nós + arestas) para o canvas. Mapeia spec.{networks,volumes,secrets,
// containers,pods,vms} em nós; container.spec.{network,volumes,secret} em
// arestas (rede, volume montado, segredo). Campos que o modelo não representa
// são PRESERVADOS (por nó, em `extra`; buckets/chaves de topo desconhecidos no
// `extra` do desenho) e re-emitidos tal e qual no export — nunca se perdem em
// silêncio; cada preservação deixa um aviso. As posições (x/y) são atribuídas
// numa grelha simples (rede em cima, workloads no meio, dados em baixo).

export interface ImportResult {
  design: StudioDesign;
  warnings: string[];
}

const KNOWN_SPEC_BUCKETS = [
  "networks", "volumes", "secrets", "containers", "pods", "vms",
  "images", "apps", "services", "ingress", "tunnels", "networkGateways", "dependencies",
] as const;
const DOC_TOP_KEYS = ["apiVersion", "kind", "metadata", "spec"];

function asObjArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Record<string, unknown>[]) : [];
}
function str(v: unknown): string {
  return v == null ? "" : String(v);
}
// Junta uma lista YAML (ou um escalar) numa string "a, b, c" — inverso de csv().
function joinList(v: unknown): string {
  return Array.isArray(v) ? v.map((x) => str(x)).join(", ") : str(v);
}
// Separa as chaves CONHECIDAS de um spec das desconhecidas (preservadas em extra).
function splitExtra(spec: Record<string, unknown>, known: string[]): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(spec)) if (!known.includes(k)) extra[k] = val;
  return extra;
}
function asSpec(item: Record<string, unknown>): Record<string, unknown> {
  return item.spec && typeof item.spec === "object" ? (item.spec as Record<string, unknown>) : {};
}

export function manifestToDesign(text: string): ImportResult {
  const warnings: string[] = [];
  let parsedDocs;
  try {
    parsedDocs = parseAllDocuments(text, { prettyErrors: true });
  } catch (e) {
    throw new Error(`YAML inválido: ${e instanceof Error ? e.message : String(e)}`);
  }
  const parsed: Record<string, unknown>[] = [];
  for (const d of parsedDocs) {
    if (d.errors && d.errors.length) throw new Error(`YAML inválido: ${d.errors[0].message}`);
    const js = d.toJS();
    if (js && typeof js === "object" && !Array.isArray(js)) parsed.push(js as Record<string, unknown>);
  }
  if (parsed.length === 0) throw new Error("Manifesto vazio: nenhum documento YAML com conteúdo.");

  const stacks = parsed.filter((d) => str(d.kind).toLowerCase() === "stack");
  let doc: Record<string, unknown>;
  if (stacks.length > 0) {
    doc = stacks[0];
    if (parsed.length > 1) warnings.push(`O ficheiro tem ${parsed.length} documentos; importei o primeiro \`kind: Stack\` e ignorei os restantes ${parsed.length - 1}.`);
  } else {
    const cand = parsed.find((d) => d.spec && typeof d.spec === "object" && KNOWN_SPEC_BUCKETS.some((b) => (d.spec as Record<string, unknown>)[b] != null));
    if (!cand) throw new Error("Não é um manifesto `kind: Stack` (nem tem um `spec` reconhecível).");
    doc = cand;
    warnings.push("O documento não declara `kind: Stack`; importei-o pelo `spec` reconhecido.");
  }

  const spec = (doc.spec && typeof doc.spec === "object" ? doc.spec : {}) as Record<string, unknown>;
  const meta = (doc.metadata && typeof doc.metadata === "object" ? doc.metadata : {}) as Record<string, unknown>;

  const nodes: StudioNode[] = [];
  const edges: StudioEdge[] = [];
  let eseq = 0;
  const byKindName = new Map<string, StudioNode>();
  const add = (n: StudioNode, extra: Record<string, unknown>) => {
    if (Object.keys(extra).length) n.extra = extra;
    nodes.push(n);
    byKindName.set(`${n.kind}/${n.name}`, n);
  };
  const rowY = { net: 40, build: 160, work: 280, store: 520, policy: 640, expose: 760 } as const;
  type Row = keyof typeof rowY;
  const col: Record<Row, number> = { net: 0, build: 0, work: 0, store: 0, policy: 0, expose: 0 };
  const place = (row: Row) => ({ x: 60 + col[row]++ * 230, y: rowY[row] });

  for (const item of asObjArray(spec.networks)) {
    const name = str(item.name), s = asSpec(item), p = place("net");
    add({ id: `imp:network:${name}`, kind: "network", name, x: p.x, y: p.y, props: { driver: str(s.driver) || "bridge", subnet: str(s.subnet) } }, splitExtra(s, ["driver", "subnet"]));
  }
  for (const item of asObjArray(spec.volumes)) {
    const name = str(item.name), s = asSpec(item), p = place("store");
    // DX-1217: dentro de um pool o tamanho é `size`; fora, `quota`. Ambos caem
    // no campo "Tamanho" (props.quota); `pool` guarda-se à parte.
    const pool = str(s.pool);
    const amount = pool ? str(s.size) : str(s.quota);
    add({ id: `imp:volume:${name}`, kind: "volume", name, x: p.x, y: p.y, props: { quota: amount, pool, driver: str(s.driver) || "local", mount: "" } }, splitExtra(s, ["size", "quota", "pool", "driver"]));
  }
  for (const item of asObjArray(spec.secrets)) {
    const name = str(item.name), s = asSpec(item), p = place("store");
    const sd = (s.stringData && typeof s.stringData === "object" ? s.stringData : {}) as Record<string, unknown>;
    add({ id: `imp:secret:${name}`, kind: "secret", name, x: p.x, y: p.y, props: { keys: Object.keys(sd).join(", ") } }, splitExtra(s, ["stringData"]));
  }
  const containerItems: { node: StudioNode; s: Record<string, unknown> }[] = [];
  for (const item of asObjArray(spec.containers)) {
    const name = str(item.name), s = asSpec(item), p = place("work");
    const node: StudioNode = { id: `imp:container:${name}`, kind: "container", name, x: p.x, y: p.y, props: { image: str(s.image), ports: joinList(s.ports), env: joinList(s.env), command: joinList(s.command) } };
    add(node, splitExtra(s, ["image", "network", "ports", "env", "command", "volumes", "secret"]));
    containerItems.push({ node, s });
  }
  // Rede de um workload (pod/vm): resolve a aresta ou avisa se a rede não existe.
  const linkNetwork = (node: StudioNode, net: string) => {
    if (!net) return;
    const nn = byKindName.get(`network/${net}`);
    if (nn) edges.push({ id: `ie${eseq++}`, source: nn.id, target: node.id });
    else warnings.push(`O ${CATALOG[node.kind].label.toLowerCase()} "${node.name}" refere a rede "${net}", não declarada — ligação não criada.`);
  };
  for (const item of asObjArray(spec.pods)) {
    const name = str(item.name), s = asSpec(item), p = place("work");
    const first = asObjArray(s.containers)[0] ?? {};
    const ports = asObjArray(first.ports).map((pp) => str(pp.containerPort)).filter(Boolean);
    const node: StudioNode = { id: `imp:pod:${name}`, kind: "pod", name, x: p.x, y: p.y, props: { image: str(first.image), ports: ports.join(", ") } };
    add(node, splitExtra(s, ["containers", "network"]));
    linkNetwork(node, str(s.network));
  }
  for (const item of asObjArray(spec.vms)) {
    const name = str(item.name), s = asSpec(item), p = place("work");
    const node: StudioNode = { id: `imp:vm:${name}`, kind: "vm", name, x: p.x, y: p.y, props: { disk: str(s.disk), vcpus: str(s.vcpus), memory: str(s.memory) } };
    add(node, splitExtra(s, ["disk", "vcpus", "memory", "network"]));
    linkNetwork(node, str(s.network));
  }
  // Imagens: pull OU build (tag + context).
  for (const item of asObjArray(spec.images)) {
    const name = str(item.name), s = asSpec(item), p = place("build");
    const b = (s.build && typeof s.build === "object" ? s.build : {}) as Record<string, unknown>;
    add({ id: `imp:image:${name}`, kind: "image", name, x: p.x, y: p.y, props: { pull: str(s.pull), buildTag: str(b.tag), buildContext: str(b.context) || (b.tag ? "." : "") } }, splitExtra(s, ["pull", "build", "pullSecret"]));
  }
  // Apps (buildpack).
  for (const item of asObjArray(spec.apps)) {
    const name = str(item.name), s = asSpec(item), p = place("build");
    add({ id: `imp:app:${name}`, kind: "app", name, x: p.x, y: p.y, props: { image: str(s.image), builder: str(s.builder) || "auto", source: str(s.source) || "." } }, splitExtra(s, ["image", "builder", "source", "runImage"]));
  }
  // Serviços (selector matchLabels → "k=v, …"; port; type).
  for (const item of asObjArray(spec.services)) {
    const name = str(item.name), s = asSpec(item), p = place("policy");
    const sel = (s.selector && typeof s.selector === "object" ? s.selector : {}) as Record<string, unknown>;
    const ml = (sel.matchLabels && typeof sel.matchLabels === "object" ? sel.matchLabels : {}) as Record<string, unknown>;
    add({ id: `imp:service:${name}`, kind: "service", name, x: p.x, y: p.y, props: { port: str(s.port), selector: kvJoin(ml), type: str(s.type) || "DNS" } }, splitExtra(s, ["selector", "port", "type"]));
  }
  // Túneis públicos.
  for (const item of asObjArray(spec.tunnels)) {
    const name = str(item.name), s = asSpec(item), p = place("expose");
    add({ id: `imp:tunnel:${name}`, kind: "tunnel", name, x: p.x, y: p.y, props: { provider: str(s.provider), localPort: str(s.localPort), hostname: str(s.hostname) } }, splitExtra(s, ["provider", "localPort", "hostname", "token", "tokenSecretRef", "insecureSkipTlsVerify"]));
  }
  // Gateways de appliance.
  for (const item of asObjArray(spec.networkGateways)) {
    const name = str(item.name), s = asSpec(item), p = place("expose");
    add({ id: `imp:gateway:${name}`, kind: "gateway", name, x: p.x, y: p.y, props: { provider: str(s.provider) } }, splitExtra(s, ["provider", "aliases", "nat", "policies", "rules"]));
  }
  // Dependências (from/to/ports/proto).
  for (const item of asObjArray(spec.dependencies)) {
    const name = str(item.name), s = asSpec(item), p = place("policy");
    add({ id: `imp:dependency:${name}`, kind: "dependency", name, x: p.x, y: p.y, props: { from: str(s.from), to: joinList(s.to), ports: joinList(s.ports), proto: str(s.proto) } }, splitExtra(s, ["from", "to", "ports", "proto"]));
  }
  // Ingress: host/path/porta do primeiro path + aresta para o container/pod de
  // backend (rules[].http.paths[].backend.service.name, ou defaultBackend).
  for (const item of asObjArray(spec.ingress)) {
    const name = str(item.name), s = asSpec(item), p = place("expose");
    const rule0 = asObjArray(s.rules)[0] ?? {};
    const http = (rule0.http && typeof rule0.http === "object" ? rule0.http : {}) as Record<string, unknown>;
    const path0 = asObjArray(http.paths)[0] ?? {};
    const backend = (path0.backend && typeof path0.backend === "object" ? path0.backend : (s.defaultBackend && typeof s.defaultBackend === "object" ? s.defaultBackend : {})) as Record<string, unknown>;
    const svc = (backend.service && typeof backend.service === "object" ? backend.service : {}) as Record<string, unknown>;
    const port = (svc.port && typeof svc.port === "object" ? (svc.port as Record<string, unknown>).number : svc.port);
    const node: StudioNode = { id: `imp:ingress:${name}`, kind: "ingress", name, x: p.x, y: p.y, props: { host: str(rule0.host), path: str(path0.path) || "/", port: str(port) || "80" } };
    add(node, splitExtra(s, ["rules", "defaultBackend", "tls", "entrypoints", "ingressClassName"]));
    const backendName = str(svc.name);
    if (backendName) {
      const target = byKindName.get(`container/${backendName}`) ?? byKindName.get(`pod/${backendName}`);
      if (target) edges.push({ id: `ie${eseq++}`, source: node.id, target: target.id });
      else warnings.push(`O ingress "${name}" encaminha para "${backendName}", não declarado — ligação não criada.`);
    }
  }

  // Segunda passagem: arestas dos containers (rede, volume montado, segredo).
  for (const { node, s } of containerItems) {
    const net = str(s.network);
    if (net) {
      const nn = byKindName.get(`network/${net}`);
      if (nn) edges.push({ id: `ie${eseq++}`, source: nn.id, target: node.id });
      else warnings.push(`O container "${node.name}" refere a rede "${net}", não declarada — ligação não criada.`);
    }
    for (const raw of Array.isArray(s.volumes) ? s.volumes : []) {
      const ref = str(raw);
      const idx = ref.indexOf(":");
      const vname = idx >= 0 ? ref.slice(0, idx) : ref;
      const mount = idx >= 0 ? ref.slice(idx + 1) : "";
      const vn = byKindName.get(`volume/${vname}`);
      if (vn) {
        if (mount) vn.props.mount = mount;
        edges.push({ id: `ie${eseq++}`, source: node.id, target: vn.id });
      } else warnings.push(`O container "${node.name}" monta o volume "${vname}", não declarado — ligação não criada.`);
    }
    for (const raw of Array.isArray(s.secret) ? s.secret : []) {
      const sname = str(raw);
      const sn = byKindName.get(`secret/${sname}`);
      if (sn) edges.push({ id: `ie${eseq++}`, source: node.id, target: sn.id });
      else warnings.push(`O container "${node.name}" usa o segredo "${sname}", não declarado — ligação não criada.`);
    }
  }

  // Preservação do que o modelo não representa (re-emitido no export).
  const specExtra = Object.fromEntries(Object.entries(spec).filter(([k]) => !KNOWN_SPEC_BUCKETS.includes(k as (typeof KNOWN_SPEC_BUCKETS)[number])));
  const docExtra = Object.fromEntries(Object.entries(doc).filter(([k]) => !DOC_TOP_KEYS.includes(k)));
  const designExtra: NonNullable<StudioDesign["extra"]> = {};
  if (Object.keys(specExtra).length) { designExtra.spec = specExtra; warnings.push(`Secções de spec não representadas preservadas (re-emitidas no export): ${Object.keys(specExtra).join(", ")}.`); }
  if (Object.keys(docExtra).length) { designExtra.doc = docExtra; warnings.push(`Chaves de topo não representadas preservadas (re-emitidas no export): ${Object.keys(docExtra).join(", ")}.`); }
  const nodesWithExtra = nodes.filter((n) => n.extra && Object.keys(n.extra).length);
  if (nodesWithExtra.length) warnings.push(`Campos não representados preservados como extra (re-emitidos no export): ${nodesWithExtra.map((n) => `${n.name} [${Object.keys(n.extra!).join(", ")}]`).join("; ")}.`);

  const design: StudioDesign = {
    version: 1,
    name: str(meta.name) || "importado",
    namespace: str(meta.namespace),
    nodes,
    edges,
  };
  if (designExtra.spec || designExtra.doc) design.extra = designExtra;
  return { design, warnings };
}

// --- Serialização do desenho (.json) ----------------------------------------

export function serializeDesign(d: StudioDesign): string {
  return JSON.stringify(d, null, 2);
}

// Lê um desenho de JSON com validação defensiva da forma (um ficheiro externo
// pode estar corrompido). Lança com mensagem clara se não for um desenho.
export function parseDesign(text: string): StudioDesign {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Ficheiro inválido: não é JSON.");
  }
  if (!raw || typeof raw !== "object") throw new Error("Ficheiro inválido: raiz não é um objeto.");
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) throw new Error("Versão de desenho não suportada.");
  if (!Array.isArray(o.nodes) || !Array.isArray(o.edges)) throw new Error("Desenho sem nodes/edges.");
  const nodes: StudioNode[] = (o.nodes as unknown[]).map((raw, i) => {
    const n = raw as Record<string, unknown>;
    const kind = n.kind as StudioKind;
    if (!CATALOG[kind]) throw new Error(`Tipo desconhecido no nó ${i}: ${String(n.kind)}`);
    const node: StudioNode = {
      id: String(n.id ?? `n${i}`),
      kind,
      name: String(n.name ?? ""),
      x: Number(n.x ?? 0),
      y: Number(n.y ?? 0),
      props: (n.props && typeof n.props === "object" ? (n.props as Record<string, string>) : {}),
    };
    if (n.extra && typeof n.extra === "object") node.extra = n.extra as Record<string, unknown>;
    return node;
  });
  const ids = new Set(nodes.map((n) => n.id));
  const edges: StudioEdge[] = (o.edges as unknown[])
    .map((raw, i) => {
      const e = raw as Record<string, unknown>;
      return { id: String(e.id ?? `e${i}`), source: String(e.source ?? ""), target: String(e.target ?? "") };
    })
    .filter((e) => ids.has(e.source) && ids.has(e.target));
  const design: StudioDesign = {
    version: 1,
    name: String(o.name ?? "arquitetura"),
    namespace: String(o.namespace ?? ""),
    nodes,
    edges,
  };
  if (o.extra && typeof o.extra === "object") design.extra = o.extra as StudioDesign["extra"];
  return design;
}

// --- Modo Live: runtime observado → desenho (só-leitura) --------------------
// Constrói um desenho a partir do estado VIVO: cada rede vira um nó-rede, cada
// membro (container/vm/pod) um nó-workload ligado à rede. VMs sem rede
// aparecem soltas. Reaproveita a abordagem de NetworkTopology.

export function liveToDesign(
  networks: NetworkRow[],
  workloads: WorkloadRow[],
  vms: VmDetail[],
): StudioDesign {
  const nodes: StudioNode[] = [];
  const edges: StudioEdge[] = [];
  const nodeByName = new Map<string, StudioNode>();

  const kindByName = new Map<string, StudioKind>();
  for (const w of workloads) kindByName.set(w.name, w.type as StudioKind);

  networks.forEach((net, ni) => {
    const netId = `net:${net.name}`;
    const netNode: StudioNode = {
      id: netId, kind: "network", name: net.name,
      x: 60 + (ni % 3) * 420, y: 40 + Math.floor(ni / 3) * 360,
      props: { driver: net.driver || "bridge", subnet: net.subnet || "" },
    };
    nodes.push(netNode);
    net.members.forEach((m, mi) => {
      const wkind = kindByName.get(m.name) ?? "container";
      let wn = nodeByName.get(m.name);
      if (!wn) {
        wn = {
          id: `wk:${m.name}`, kind: wkind, name: m.name,
          x: netNode.x + 180 + (mi % 2) * 180, y: netNode.y + 120 + mi * 70,
          props: { image: "", _ip: m.ip },
        };
        nodes.push(wn);
        nodeByName.set(m.name, wn);
      }
      edges.push({ id: `e:${net.name}:${m.name}`, source: netId, target: wn.id });
    });
  });

  // VMs do socket que não apareceram como membros de nenhuma rede.
  vms.forEach((vm, i) => {
    if (nodeByName.has(vm.name)) return;
    nodes.push({
      id: `wk:${vm.name}`, kind: "vm", name: vm.name,
      x: 60 + (i % 4) * 200, y: 640,
      props: { disk: vm.image || "", vcpus: String(vm.vcpus || ""), _phase: vm.phase },
    });
  });

  return { version: 1, name: "runtime", namespace: "", nodes, edges };
}

// --- Modo Plan: diff entre o desenho e o estado vivo ------------------------

export type PlanAction = "create" | "keep" | "remove";

export interface PlanRow {
  kind: StudioKind;
  name: string;
  action: PlanAction;
}

// Diff por (tipo, nome). O que está no desenho e não no vivo → create; só no
// vivo → remove; em ambos → keep. É um diff de PRESENÇA (nomes), não de campos:
// o `delonix stack plan -o json` dá o diff fino de campos no Apply.
export function diffDesignVsLive(design: StudioDesign, live: StudioDesign): PlanRow[] {
  const key = (n: StudioNode) => `${n.kind}/${n.name.trim()}`;
  const liveKeys = new Map(live.nodes.map((n) => [key(n), n]));
  const designKeys = new Map(design.nodes.map((n) => [key(n), n]));
  const rows: PlanRow[] = [];

  for (const n of design.nodes) {
    if (!n.name.trim()) continue;
    rows.push({ kind: n.kind, name: n.name.trim(), action: liveKeys.has(key(n)) ? "keep" : "create" });
  }
  for (const n of live.nodes) {
    if (!designKeys.has(key(n))) rows.push({ kind: n.kind, name: n.name.trim(), action: "remove" });
  }
  rows.sort((a, b) => (a.action === b.action ? a.name.localeCompare(b.name) : a.action.localeCompare(b.action)));
  return rows;
}

// --- Provisão do tipo de DESENHO (cluster) ----------------------------------
// `cluster` é o ÚNICO tipo que NÃO entra no manifesto de stack (ver STACK_KINDS)
// — mas não é inerte: mapeia para um comando REAL do engine que o Apply mostra
// como PASSO ADICIONAL (separado do `stack apply`), corrido com confirmação de
// risco. cluster → `cluster create` (kubeadm, kind-mode). Confirmado por `--help`
// no delonix 5.1.1. `available` é falso quando faltam parâmetros para montar um
// comando completo — aí `note` diz honestamente o que falta e o comando parcial
// fica na mesma para copiar. (O antigo `gateway`/túnel agora materializa-se no
// stack como `tunnels[]`/`networkGateways[]`, por isso já não vive aqui.)

export interface ProvisionAction {
  nodeId: string;
  kind: "cluster";
  name: string;
  /** Rótulo humano do passo. */
  label: string;
  /** argv do comando do engine (sempre presente, mesmo que parcial). */
  argv: Argv;
  /** Verdadeiro quando o argv está completo e pode correr. */
  available: boolean;
  /** Explicação do risco, para a confirmação do Apply. */
  risk: string;
  /** Nota honesta quando o comando não está pronto a correr. */
  note?: string;
}

export function provisionActions(d: StudioDesign): ProvisionAction[] {
  const out: ProvisionAction[] = [];
  for (const n of d.nodes) {
    const name = n.name.trim();
    if (n.kind === "cluster") {
      const cps = (n.props.controlPlanes ?? "").trim();
      const workers = (n.props.workers ?? "").trim();
      const cni = (n.props.cni ?? "").trim();
      out.push({
        nodeId: n.id,
        kind: "cluster",
        name,
        label: `Criar cluster "${name}" (${cps || "1"} control-plane / ${workers || "0"} worker)`,
        argv: cmd.clusterCreate({
          name,
          controlPlanes: cps ? Number(cps) : undefined,
          workers: workers ? Number(workers) : undefined,
          cni: cni && cni !== "default" ? cni : undefined,
        }),
        available: !!name,
        risk: "Arranca nós kind-mode e faz bootstrap kubeadm — consome CPU/memória/disco e demora. Provisiona-se FORA do stack.",
        note: name ? undefined : "Dá um nome ao cluster para o comando ficar completo.",
      });
    }
  }
  return out;
}

// --- Plan REAL: resumo do `stack plan -o json` ------------------------------
// O `delonix stack plan -o json` devolve um DIFF DE 3 VIAS (manifesto × máquina
// × último apply) — linhas {kind,name,action,changed,diffs,planDigest} já
// parseadas por client.stackPlan(). Aqui resumimos os números para o cabeçalho
// (criar/alterar/reverter/manter) e decidimos se o Apply pode seguir. É o
// equivalente do `terraform plan`. Puro e testável.

export interface PlanSummary {
  create: number;
  update: number;
  remove: number;
  noop: number;
  changed: number; // total de recursos que o apply mexeria
  total: number;
}

// Normaliza a `action` do engine (create/update/replace/delete/remove/noop/keep)
// para um verbo estável da UI.
export type FinePlanAction = "create" | "update" | "remove" | "noop";
export function normalizePlanAction(action: string): FinePlanAction {
  const a = action.trim().toLowerCase();
  if (a === "create" || a === "add") return "create";
  if (a === "delete" || a === "remove" || a === "destroy" || a === "prune") return "remove";
  if (a === "noop" || a === "keep" || a === "unchanged" || a === "") return "noop";
  return "update"; // update / replace / reboot / change
}

export function summarizePlan(rows: StackPlanRow[]): PlanSummary {
  const s: PlanSummary = { create: 0, update: 0, remove: 0, noop: 0, changed: 0, total: rows.length };
  for (const r of rows) {
    s[normalizePlanAction(r.action)]++;
    if (r.changed) s.changed++;
  }
  return s;
}

// --- Apply ATÉ READY: progresso por recurso (`stack ls -f`) -----------------
// O `stack ls` é TEXTO (sem -o json no 5.1.1): colunas KIND DOMAIN NAME PRESENT
// STATUS NAMESPACE. Parseamos por posição de cabeçalho (resiste a colunas
// variáveis) e derivamos o ESTADO de cada recurso para a vista de progresso do
// Apply: Pendente → Presente → Ready (ou Falhou), estilo `terraform apply`.

export interface StackLsRow {
  kind: string;
  name: string;
  present: string; // "yes" | "no" | "-" (recursos declarativos não têm presença)
  status: string;
  namespace: string;
}

// Parser de tabela por posição de cabeçalho. Cada coluna começa no índice do seu
// título; o valor vai até ao início da coluna seguinte. Tolerante a espaços nos
// valores e a colunas ausentes.
export function parseStackLs(text: string): StackLsRow[] {
  const lines = text.split("\n").filter((l) => l.trim());
  const headerIdx = lines.findIndex((l) => /\bKIND\b/.test(l) && /\bNAME\b/.test(l));
  if (headerIdx < 0) return [];
  const header = lines[headerIdx];
  // TODAS as colunas do cabeçalho (inclui as que não mapeamos, p.ex. DOMAIN) —
  // as fronteiras de corte têm de as respeitar, senão o valor de KIND engoliria
  // o DOMAIN. Cada token é uma coluna que começa no seu índice.
  const tokens: { title: string; at: number }[] = [];
  const re = /\S+/g;
  for (let m = re.exec(header); m; m = re.exec(header)) tokens.push({ title: m[0], at: m.index });
  const KNOWN: Record<string, keyof StackLsRow> = { KIND: "kind", NAME: "name", PRESENT: "present", STATUS: "status", NAMESPACE: "namespace" };
  const rows: StackLsRow[] = [];
  for (const line of lines.slice(headerIdx + 1)) {
    if (/^-{3,}/.test(line.trim())) continue;
    const row: StackLsRow = { kind: "", name: "", present: "", status: "", namespace: "" };
    for (let i = 0; i < tokens.length; i++) {
      const key = KNOWN[tokens[i].title];
      if (!key) continue;
      const start = tokens[i].at;
      const end = i + 1 < tokens.length ? tokens[i + 1].at : line.length;
      row[key] = line.slice(start, end).trim();
    }
    if (row.kind || row.name) rows.push(row);
  }
  return rows;
}

export type ResourceState = "pending" | "present" | "ready" | "failed" | "declarative";

export interface ProgressRow {
  kind: string;
  name: string;
  state: ResourceState;
  status: string;
}

export interface Progress {
  rows: ProgressRow[];
  ready: number; // recursos Ready ou declarativos aplicados
  total: number;
  done: boolean; // tudo convergido (ready/declarative), nada pendente/falhado
}

const READY_RE = /\b(up|running|ready|healthy|active|ok|present)\b/i;
const FAIL_RE = /\b(fail|error|crash|exited|dead|unhealthy|refused)\b/i;

// Classifica cada linha do `stack ls` num estado de progresso. Recursos
// DECLARATIVOS (ingress/networkPolicy/…), cujo PRESENT é "-", contam como
// aplicados assim que o stack aplica. Puro.
export function resourceProgress(ls: StackLsRow[]): Progress {
  const rows: ProgressRow[] = ls.map((r) => {
    const present = r.present.trim().toLowerCase();
    const status = r.status.trim();
    let state: ResourceState;
    if (FAIL_RE.test(status)) state = "failed";
    else if (present === "-" || present === "n/a" || present === "") {
      // Sem conceito de presença: declarativo. Se o status disser "declarative"
      // ou vier vazio, consideramo-lo aplicado.
      state = present === "" && status === "" ? "pending" : "declarative";
    } else if (present === "yes" || present === "true") {
      state = READY_RE.test(status) || status === "" || status === "-" ? "ready" : "present";
    } else {
      state = "pending"; // "no" / "false"
    }
    return { kind: r.kind, name: r.name, state, status };
  });
  const ready = rows.filter((r) => r.state === "ready" || r.state === "declarative").length;
  const done = rows.length > 0 && rows.every((r) => r.state === "ready" || r.state === "declarative");
  return { rows, ready, total: rows.length, done };
}

// --- Histórico de revisões (`stack history -o json`, ADR-0019) --------------
// Uma revisão por apply que pediu mudança (falhadas incluídas e marcadas). O
// JSON carrega o erro COMPLETO de uma revisão falhada. Parse defensivo dos
// nomes de campo (o engine pode variá-los entre versões). Puro.

export interface RevisionRow {
  revision: number;
  at: string;
  action: string;
  ok: boolean;
  error: string;
}

function pickStr(o: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) if (o[k] != null) return str(o[k]);
  return "";
}

export function parseStackHistory(text: string): RevisionRow[] {
  const start = text.indexOf("[");
  if (start < 0) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(text.slice(start));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x) => x && typeof x === "object")
    .map((raw) => {
      const o = raw as Record<string, unknown>;
      const okRaw = o.ok ?? o.success;
      const status = pickStr(o, "status", "result", "state").toLowerCase();
      const ok = typeof okRaw === "boolean" ? okRaw : status ? !/fail|error/.test(status) : true;
      return {
        revision: Number(pickStr(o, "revision", "rev", "n", "id")) || 0,
        at: pickStr(o, "at", "time", "appliedAt", "timestamp", "date"),
        action: pickStr(o, "action", "op", "kind") || (ok ? "apply" : "falhou"),
        ok,
        error: pickStr(o, "error", "err", "message"),
      };
    })
    .sort((a, b) => b.revision - a.revision);
}
