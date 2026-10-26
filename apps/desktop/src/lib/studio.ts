// Architecture Studio (§11) — modelo PURO do estúdio visual de arquitetura.
//
// Este módulo NÃO toca em React nem no engine: é a lógica testável que
// descreve o CATÁLOGO de componentes, as regras de LIGAÇÃO tipada, a VALIDAÇÃO
// do desenho, a serialização do design (.json) e a GERAÇÃO do manifesto de
// stack (YAML) que o `delonix stack apply -f` / `manifest validate -f` aceitam.
//
// O desenho (StudioDesign) é a fonte canónica, redonda em JSON. O manifesto é
// derivado SÓ num sentido (design → YAML); por isso guardar/carregar usa o JSON
// e não há reimportação de YAML (ver NOTA de limitação em designToManifest).

import type { NetworkRow, VmDetail, WorkloadRow } from "./types";

// --- Modelo -----------------------------------------------------------------

// Tipos derivados das capacidades/verbos REAIS do engine (§2 do prompt). Os
// seis primeiros materializam-se num manifesto de stack; `gateway` e `cluster`
// são de DESENHO (provisionados por outra via — ver STACK_KINDS).
export type StudioKind =
  | "container"
  | "vm"
  | "pod"
  | "network"
  | "volume"
  | "secret"
  | "gateway"
  | "cluster";

export interface StudioNode {
  id: string;
  kind: StudioKind;
  name: string;
  x: number;
  y: number;
  /** Propriedades editáveis (chave→valor), específicas do tipo. */
  props: Record<string, string>;
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
      { key: "size", label: "Tamanho", placeholder: "1G", hint: "Quota do volume (opcional)." },
      { key: "driver", label: "Driver", placeholder: "local" },
      { key: "mount", label: "Ponto de montagem", placeholder: "/data", hint: "Caminho dentro do container ligado." },
    ],
    defaults: { size: "", driver: "local", mount: "/data" },
  },
  secret: {
    kind: "secret", label: "Segredo", icon: "secrets", color: "var(--warn)", emitsToStack: true,
    blurb: "Mapa chave→valor. As chaves declaram-se aqui; os valores NUNCA no desenho.",
    fields: [
      { key: "keys", label: "Chaves", placeholder: "API_KEY, DB_PASSWORD", hint: "Só os NOMES. Os valores definem-se fora do estúdio." },
    ],
    defaults: { keys: "" },
  },
  gateway: {
    kind: "gateway", label: "Gateway / Túnel", icon: "networks", color: "var(--chart-4, var(--inf))", emitsToStack: false,
    blurb: "Exposição pública (túnel). DESENHO — provisiona-se à parte, não entra no stack.",
    fields: [
      { key: "provider", label: "Fornecedor", placeholder: "cloudflare | pinggy | ngrok" },
      { key: "port", label: "Porta de origem", placeholder: "8080", type: "number" },
    ],
    defaults: { provider: "cloudflare", port: "" },
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
  pair("gateway", "container"),
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

  // Campos obrigatórios por tipo + conselhos.
  for (const n of d.nodes) {
    if ((n.kind === "container" || n.kind === "pod") && !n.props.image?.trim())
      issues.push({ level: "error", nodeId: n.id, message: `${CATALOG[n.kind].label} "${n.name}" sem imagem.` });
    if (n.kind === "vm" && !n.props.disk?.trim())
      issues.push({ level: "error", nodeId: n.id, message: `VM "${n.name}" sem disco base.` });
    if (n.kind === "secret" && !n.props.keys?.trim())
      issues.push({ level: "warn", nodeId: n.id, message: `Segredo "${n.name}" sem chaves declaradas.` });
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

export interface ManifestResult {
  yaml: string;
  warnings: string[];
}

// Converte o desenho num manifesto `kind: Stack`. Resolve as arestas:
// container→rede (spec.network), container/pod→volume (spec.volumes com o ponto
// de montagem do volume), container→segredo (spec.secret). Tipos de DESENHO
// (gateway, cluster) NÃO entram no stack — geram um aviso honesto.
//
// NOTA (limitação consciente): a geração é só num sentido (desenho → YAML). O
// desenho (.json) é a fonte canónica e redonda; não há reimportação de YAML
// (o renderer não embebe um parser YAML), por isso campos de um manifesto
// externo não são preservados — guardar/carregar faz-se pelo .json do desenho.
export function designToManifest(d: StudioDesign): ManifestResult {
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
        push("networks", { name, spec: s });
        break;
      }
      case "volume": {
        const s: Record<string, Yaml> = {};
        if (n.props.size?.trim()) s.size = n.props.size.trim();
        if (n.props.driver?.trim() && n.props.driver.trim() !== "local") s.driver = n.props.driver.trim();
        push("volumes", { name, spec: Object.keys(s).length ? s : {} });
        break;
      }
      case "secret": {
        const stringData: Record<string, Yaml> = {};
        for (const k of csv(n.props.keys)) stringData[k] = "";
        push("secrets", { name, spec: Object.keys(stringData).length ? { stringData } : {} });
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
        push("pods", { name, spec: { containers: [c] } });
        break;
      }
      case "vm": {
        const s: Record<string, Yaml> = {};
        if (n.props.disk?.trim()) s.disk = n.props.disk.trim();
        if (n.props.vcpus?.trim()) s.vcpus = Number(n.props.vcpus) || n.props.vcpus.trim();
        if (n.props.memory?.trim()) s.memory = n.props.memory.trim();
        push("vms", { name, spec: Object.keys(s).length ? s : {} });
        break;
      }
      default:
        break;
    }
  }

  const doc: Record<string, Yaml> = {
    apiVersion: "core.delonix.io/v1alpha1",
    kind: "Stack",
    metadata: d.namespace.trim()
      ? { name: d.name.trim() || "studio-stack", namespace: d.namespace.trim() }
      : { name: d.name.trim() || "studio-stack" },
    spec,
  };

  return { yaml: toYaml(doc) + "\n", warnings };
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
    return {
      id: String(n.id ?? `n${i}`),
      kind,
      name: String(n.name ?? ""),
      x: Number(n.x ?? 0),
      y: Number(n.y ?? 0),
      props: (n.props && typeof n.props === "object" ? (n.props as Record<string, string>) : {}),
    };
  });
  const ids = new Set(nodes.map((n) => n.id));
  const edges: StudioEdge[] = (o.edges as unknown[])
    .map((raw, i) => {
      const e = raw as Record<string, unknown>;
      return { id: String(e.id ?? `e${i}`), source: String(e.source ?? ""), target: String(e.target ?? "") };
    })
    .filter((e) => ids.has(e.source) && ids.has(e.target));
  return {
    version: 1,
    name: String(o.name ?? "arquitetura"),
    namespace: String(o.namespace ?? ""),
    nodes,
    edges,
  };
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
