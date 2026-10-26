import { describe, expect, it } from "vitest";
import {
  canConnect,
  CATALOG,
  defaultDesign,
  designToManifest,
  diffDesignVsLive,
  edgeLabel,
  emptyDesign,
  manifestToDesign,
  normalizePlanAction,
  parseDesign,
  parseStackHistory,
  parseStackLs,
  provisionActions,
  resourceProgress,
  serializeDesign,
  STUDIO_TEMPLATES,
  summarizePlan,
  toYaml,
  validateDesign,
  type StudioDesign,
  type StudioNode,
} from "./studio";
import type { StackPlanRow } from "./types";

// Assinatura SEMÂNTICA de um desenho: tipos+nomes dos nós com as suas
// propriedades relevantes, e as arestas como pares não-orientados de nomes. É o
// que o roundtrip design→YAML→design tem de preservar (ids/posições NÃO são
// estruturais e podem mudar).
function signature(d: StudioDesign) {
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const nodes = d.nodes
    .map((n) => ({ kind: n.kind, name: n.name.trim(), props: Object.fromEntries(Object.entries(n.props).filter(([, v]) => String(v).trim() !== "")) }))
    .sort((a, b) => `${a.kind}/${a.name}`.localeCompare(`${b.kind}/${b.name}`));
  const edges = d.edges
    .map((e) => {
      const s = byId.get(e.source)!, t = byId.get(e.target)!;
      return [`${s.kind}/${s.name.trim()}`, `${t.kind}/${t.name.trim()}`].sort().join(" <-> ");
    })
    .sort();
  return { nodes, edges };
}

// Desenho MÍNIMO exigido pelo prompt (§6): um container numa rede.
const minimal: StudioDesign = {
  version: 1,
  name: "studio-demo",
  namespace: "",
  nodes: [
    { id: "n1", kind: "network", name: "web", x: 0, y: 0, props: { driver: "bridge", subnet: "10.89.7.0/24" } },
    { id: "n2", kind: "container", name: "nginx", x: 200, y: 0, props: { image: "nginx:latest", ports: "8080:80", env: "", command: "" } },
  ],
  edges: [{ id: "e1", source: "n1", target: "n2" }],
};

describe("toYaml", () => {
  it("cita escalares que o YAML leria mal e deixa barewords nus", () => {
    const y = toYaml({ image: "nginx:latest", driver: "bridge", subnet: "10.89.0.0/24" });
    expect(y).toContain('image: "nginx:latest"'); // ':' obriga a aspas
    expect(y).toContain("driver: bridge");
    expect(y).toContain('subnet: "10.89.0.0/24"'); // começa por dígito
  });

  it("emite listas de objetos com o traço na primeira chave", () => {
    const y = toYaml({ networks: [{ name: "web", spec: { driver: "bridge" } }] });
    expect(y).toContain("- name: web");
    expect(y).toContain("    driver: bridge");
  });
});

describe("designToManifest — forma mínima (container numa rede)", () => {
  const { yaml, warnings } = designToManifest(minimal);

  it("gera um manifesto kind: Stack com a rede, o container e a ligação resolvida", () => {
    expect(yaml).toContain("apiVersion: core.delonix.io/v1alpha1");
    expect(yaml).toContain("kind: Stack");
    expect(yaml).toContain("name: studio-demo");
    expect(yaml).toContain("networks:");
    expect(yaml).toContain("- name: web");
    expect(yaml).toContain("containers:");
    expect(yaml).toContain("- name: nginx");
    expect(yaml).toContain('image: "nginx:latest"');
    // A aresta container↔rede materializa-se em spec.network = "web".
    expect(yaml).toContain("network: web");
    expect(yaml).toContain('- "8080:80"');
    expect(warnings).toHaveLength(0);
  });

  it("produz um documento YAML bem-formado, com indentação de 2 espaços", () => {
    // Prova de forma: sem tabs, termina em newline, estrutura aninhada correta.
    expect(yaml.endsWith("\n")).toBe(true);
    expect(yaml).not.toContain("\t");
    expect(yaml).toMatch(/spec:\n {2}networks:\n {4}- name: web/);
    expect(yaml).toMatch(/ {8}ports:\n {10}- "8080:80"/);
  });
});

describe("designToManifest — cluster é o único tipo de desenho (avisa, não quebra)", () => {
  it("cluster não entra no stack mas gera aviso; tunnel/gateway agora ENTRAM", () => {
    const d = emptyDesign("mix");
    d.nodes.push({ id: "t", kind: "tunnel", name: "edge", x: 0, y: 0, props: { provider: "cloudflare", localPort: "8080" } });
    d.nodes.push({ id: "k", kind: "cluster", name: "lab", x: 0, y: 0, props: {} });
    const { yaml, warnings } = designToManifest(d);
    // tunnel materializa-se (tunnels[]); cluster NÃO (1 aviso só).
    expect(yaml).toContain("tunnels:");
    expect(yaml).toContain("- name: edge");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/cluster/i);
  });
});

describe("canConnect — ligações tipadas", () => {
  it("aceita pares válidos", () => {
    expect(canConnect("container", "network")).toBe(true);
    expect(canConnect("container", "volume")).toBe(true);
    expect(canConnect("network", "vm")).toBe(true); // não-orientado
  });
  it("recusa pares inválidos e auto-ligações", () => {
    expect(canConnect("container", "container")).toBe(false);
    expect(canConnect("volume", "network")).toBe(false);
    expect(canConnect("secret", "network")).toBe(false);
  });
});

describe("validateDesign", () => {
  it("sem problemas no desenho mínimo", () => {
    expect(validateDesign(minimal).filter((i) => i.level === "error")).toHaveLength(0);
  });
  it("assinala container sem imagem e nomes repetidos", () => {
    const d = emptyDesign("x");
    d.nodes.push({ id: "a", kind: "container", name: "dup", x: 0, y: 0, props: { image: "" } });
    d.nodes.push({ id: "b", kind: "container", name: "dup", x: 0, y: 0, props: { image: "r:1" } });
    const errs = validateDesign(d).filter((i) => i.level === "error");
    expect(errs.some((e) => /sem imagem/.test(e.message))).toBe(true);
    expect(errs.some((e) => /repetido/.test(e.message))).toBe(true);
  });
  it("recusa uma ligação inválida", () => {
    const d = emptyDesign("x");
    d.nodes.push({ id: "v", kind: "volume", name: "v", x: 0, y: 0, props: {} });
    d.nodes.push({ id: "n", kind: "network", name: "n", x: 0, y: 0, props: {} });
    d.edges.push({ id: "e", source: "v", target: "n" });
    expect(validateDesign(d).some((i) => i.level === "error" && /ligação válida/.test(i.message))).toBe(true);
  });
});

describe("serializeDesign / parseDesign — round-trip (.json)", () => {
  it("preserva nós, arestas e metadados", () => {
    const back = parseDesign(serializeDesign(minimal));
    expect(back).toEqual(minimal);
  });
  it("descarta arestas com extremos inexistentes", () => {
    const json = JSON.stringify({ ...minimal, edges: [{ id: "bad", source: "n1", target: "zzz" }] });
    expect(parseDesign(json).edges).toHaveLength(0);
  });
  it("rejeita ficheiros que não são desenhos", () => {
    expect(() => parseDesign("não é json")).toThrow();
    expect(() => parseDesign(JSON.stringify({ version: 2 }))).toThrow();
  });
});

describe("STUDIO_TEMPLATES — modelos prontos geram manifesto válido", () => {
  it("o modelo por omissão é não-vazio (o canvas não abre vazio)", () => {
    const d = defaultDesign();
    expect(d.nodes.length).toBeGreaterThan(0);
    expect(d.edges.length).toBeGreaterThan(0);
    expect(validateDesign(d).filter((i) => i.level === "error")).toHaveLength(0);
  });

  it("todos os modelos produzem um desenho sem erros e um manifesto kind: Stack", () => {
    for (const t of STUDIO_TEMPLATES) {
      const d = t.make();
      const errs = validateDesign(d).filter((i) => i.level === "error");
      expect(errs, `modelo ${t.id}: ${errs.map((e) => e.message).join("; ")}`).toHaveLength(0);
      const { yaml } = designToManifest(d);
      expect(yaml).toContain("kind: Stack");
    }
  });

  it("Web+BD emite rede, dois containers, volume montado e segredo ligado", () => {
    const { yaml } = designToManifest(STUDIO_TEMPLATES[0].make());
    expect(yaml).toContain("networks:");
    expect(yaml).toContain("- name: web");
    expect(yaml).toContain("- name: db");
    expect(yaml).toContain("volumes:");
    expect(yaml).toContain('- "pgdata:/var/lib/postgresql/data"');
    expect(yaml).toContain("secrets:");
    expect(yaml).toContain("- name: db-secret");
    expect(yaml).toContain("POSTGRES_PASSWORD");
  });
});

describe("adicionar do catálogo → propriedades no manifesto", () => {
  // Invariante por trás do drag-drop / click-para-adicionar: um nó criado a
  // partir de CATALOG[kind].defaults, depois de nomeado/editado e ligado a uma
  // rede, materializa-se no YAML com as suas propriedades.
  it("um container adicionado com imagem+portas aparece no stack ligado à rede", () => {
    const d = emptyDesign("add-demo");
    const net = { id: "nn", kind: "network" as const, name: "edge", x: 0, y: 0, props: { ...CATALOG.network.defaults } };
    // Simula o que addNode faz: parte dos defaults do catálogo e edita os campos.
    const web = { id: "cc", kind: "container" as const, name: "api", x: 0, y: 0, props: { ...CATALOG.container.defaults, image: "caddy:2", ports: "443:443" } };
    d.nodes.push(net, web);
    d.edges.push({ id: "e", source: "nn", target: "cc" });
    expect(validateDesign(d).filter((i) => i.level === "error")).toHaveLength(0);
    const { yaml } = designToManifest(d);
    expect(yaml).toContain("- name: api");
    expect(yaml).toContain('image: "caddy:2"');
    expect(yaml).toContain("network: edge");
    expect(yaml).toContain('- "443:443"');
  });

  it("cada tipo do catálogo tem defaults e campos declarados", () => {
    for (const k of Object.keys(CATALOG) as (keyof typeof CATALOG)[]) {
      const c = CATALOG[k];
      expect(c.fields.length, `${k} sem campos`).toBeGreaterThan(0);
      // Os defaults só precisam de cobrir chaves conhecidas (podem ser vazios).
      for (const key of Object.keys(c.defaults)) {
        expect(typeof c.defaults[key]).toBe("string");
      }
    }
  });
});

describe("edgeLabel — rótulos derivados do par de extremos", () => {
  const d = STUDIO_TEMPLATES[0].make();
  const find = (src: string, tgt: string) => d.edges.find((e) => e.source === src && e.target === tgt)!;
  it("liga container↔rede → 'rede'", () => {
    expect(edgeLabel(d, find("net", "web"))).toBe("rede");
  });
  it("liga container↔volume → 'monta em <ponto>'", () => {
    expect(edgeLabel(d, find("db", "data"))).toBe("monta em /var/lib/postgresql/data");
  });
  it("liga container↔segredo → 'segredo'", () => {
    expect(edgeLabel(d, find("db", "sec"))).toBe("segredo");
  });
  it("devolve vazio para aresta com extremo inexistente", () => {
    expect(edgeLabel(d, { id: "x", source: "nada", target: "web" })).toBe("");
  });
});

describe("diffDesignVsLive — Plan", () => {
  it("classifica create/keep/remove por tipo+nome", () => {
    const live: StudioDesign = {
      version: 1, name: "runtime", namespace: "", edges: [],
      nodes: [
        { id: "l1", kind: "network", name: "web", x: 0, y: 0, props: {} },
        { id: "l2", kind: "container", name: "velho", x: 0, y: 0, props: {} },
      ],
    };
    const rows = diffDesignVsLive(minimal, live);
    expect(rows.find((r) => r.name === "web")?.action).toBe("keep");
    expect(rows.find((r) => r.name === "nginx")?.action).toBe("create");
    expect(rows.find((r) => r.name === "velho")?.action).toBe("remove");
  });
});

describe("manifestToDesign — reimport YAML → desenho", () => {
  it("reconstrói rede + container e a ligação a partir do manifesto mínimo", () => {
    const { yaml } = designToManifest(minimal);
    const { design } = manifestToDesign(yaml);
    const net = design.nodes.find((n) => n.kind === "network");
    const web = design.nodes.find((n) => n.kind === "container");
    expect(net?.name).toBe("web");
    expect(net?.props.subnet).toBe("10.89.7.0/24");
    expect(web?.name).toBe("nginx");
    expect(web?.props.image).toBe("nginx:latest");
    expect(web?.props.ports).toBe("8080:80");
    // A aresta network↔container foi reconstruída.
    expect(design.edges).toHaveLength(1);
    const byId = new Map(design.nodes.map((n) => [n.id, n]));
    const e = design.edges[0];
    expect(new Set([byId.get(e.source)!.kind, byId.get(e.target)!.kind])).toEqual(new Set(["network", "container"]));
  });

  it("recupera o ponto de montagem do volume e os segredos ligados (Web+BD)", () => {
    const { yaml } = designToManifest(STUDIO_TEMPLATES[0].make());
    const { design } = manifestToDesign(yaml);
    const vol = design.nodes.find((n) => n.kind === "volume");
    expect(vol?.name).toBe("pgdata");
    expect(vol?.props.mount).toBe("/var/lib/postgresql/data");
    const sec = design.nodes.find((n) => n.kind === "secret");
    expect(sec?.props.keys).toBe("POSTGRES_PASSWORD");
    // db liga-se à rede, ao volume e ao segredo → 2 containers + relações.
    const db = design.nodes.find((n) => n.name === "db")!;
    const touches = design.edges.filter((e) => e.source === db.id || e.target === db.id);
    expect(touches.length).toBe(3); // rede + volume + segredo
  });

  it("rejeita YAML que não é um Stack e YAML malformado", () => {
    expect(() => manifestToDesign("isto: [nao, fecha")).toThrow(/YAML inválido/);
    expect(() => manifestToDesign("apiVersion: v1\nkind: ConfigMap\ndata: {}\n")).toThrow(/Stack/);
  });

  it("aceita o manifesto reimportado no engine sendo um Stack válido (forma)", () => {
    // Prova de FORMA (sem engine): o reimport-reexport continua kind: Stack.
    const { yaml } = designToManifest(STUDIO_TEMPLATES[2].make()); // vm-net
    const { design } = manifestToDesign(yaml);
    const re = designToManifest(design).yaml;
    expect(re).toContain("kind: Stack");
    expect(re).toContain("vms:");
    expect(re).toContain("disk: ubuntu-22.04");
  });
});

describe("roundtrip design ↔ YAML — preserva a estrutura", () => {
  for (const t of STUDIO_TEMPLATES) {
    it(`modelo ${t.id}: design → YAML → design preserva nós, propriedades e arestas`, () => {
      const d = t.make();
      const { design: back } = manifestToDesign(designToManifest(d).yaml);
      expect(signature(back)).toEqual(signature(d));
    });
  }

  it("é um ponto fixo: YAML → design → YAML é idempotente", () => {
    const yaml1 = designToManifest(STUDIO_TEMPLATES[0].make()).yaml;
    const yaml2 = designToManifest(manifestToDesign(yaml1).design).yaml;
    const yaml3 = designToManifest(manifestToDesign(yaml2).design).yaml;
    expect(yaml3).toBe(yaml2);
  });
});

describe("manifestToDesign — preserva campos não representados (extra)", () => {
  const external = [
    "apiVersion: core.delonix.io/v1alpha1",
    "kind: Stack",
    "metadata:",
    "  name: ext",
    "annotations:", // chave de topo desconhecida
    "  owner: equipa-a",
    "spec:",
    "  containers:",
    "    - name: api",
    "      spec:",
    "        image: \"caddy:2\"",
    "        restartPolicy: Always", // campo de container desconhecido
    "        healthcheck:",
    "          test: curl localhost",
    "  queues:", // bucket de spec desconhecido
    "    - name: jobs",
    "",
  ].join("\n");

  it("guarda os campos desconhecidos em node.extra / design.extra e avisa", () => {
    const { design, warnings } = manifestToDesign(external);
    const api = design.nodes.find((n) => n.name === "api")!;
    expect(api.extra).toBeTruthy();
    expect(api.extra).toHaveProperty("restartPolicy", "Always");
    expect(api.extra).toHaveProperty("healthcheck");
    expect(design.extra?.spec).toHaveProperty("queues");
    expect(design.extra?.doc).toHaveProperty("annotations");
    // Nenhum silêncio: há avisos a nomear o que foi preservado.
    expect(warnings.some((w) => /não representad/i.test(w))).toBe(true);
  });

  it("re-emite os campos preservados no export (nada se perde no roundtrip)", () => {
    const { design } = manifestToDesign(external);
    const out = designToManifest(design).yaml;
    expect(out).toContain("restartPolicy: Always");
    expect(out).toContain("healthcheck:");
    expect(out).toContain('test: "curl localhost"'); // o emissor cita o escalar com espaço
    expect(out).toContain("queues:");
    expect(out).toContain("annotations:");
    expect(out).toContain("owner: equipa-a");
    // E o reimport do reexport volta a ver o extra (ponto fixo do extra).
    const again = manifestToDesign(out).design;
    expect(again.nodes.find((n) => n.name === "api")!.extra).toHaveProperty("restartPolicy", "Always");
  });
});

describe("provisionActions — cluster → comando do engine (único tipo de desenho)", () => {
  it("cluster → `cluster create` com control-planes/workers/cni", () => {
    const d = emptyDesign("mix");
    d.nodes.push({ id: "k", kind: "cluster", name: "lab", x: 0, y: 0, props: { controlPlanes: "3", workers: "2", cni: "none" } });
    const a = provisionActions(d)[0];
    expect(a.kind).toBe("cluster");
    expect(a.available).toBe(true);
    expect(a.argv).toEqual(["cluster", "create", "--name", "lab", "--workers", "2", "--control-planes", "3", "--cni", "none"]);
  });

  it("cluster com cni=default omite a flag (é o default do engine)", () => {
    const d = emptyDesign("mix");
    d.nodes.push({ id: "k", kind: "cluster", name: "dev", x: 0, y: 0, props: { controlPlanes: "1", workers: "0", cni: "default" } });
    const a = provisionActions(d)[0];
    expect(a.argv).not.toContain("--cni");
    expect(a.argv).toEqual(["cluster", "create", "--name", "dev", "--workers", "0", "--control-planes", "1"]);
  });

  it("um desenho sem tipos de desenho não gera passos de provisão", () => {
    expect(provisionActions(minimal)).toHaveLength(0);
  });
});

// --- Catálogo completo (§11 v3): novos tipos que alimentam o StackSpec -------

// Desenho com UM nó de cada tipo novo que emite, mais um container de destino
// para o ingress e a dependência. É a base dos testes de emissão/roundtrip.
function richDesign(): StudioDesign {
  const nodes: StudioNode[] = [
    { id: "net", kind: "network", name: "app", x: 0, y: 0, props: { driver: "bridge", subnet: "" } },
    { id: "web", kind: "container", name: "web", x: 0, y: 0, props: { image: "nginx:latest", ports: "", env: "", command: "" } },
    { id: "db", kind: "container", name: "db", x: 0, y: 0, props: { image: "postgres:16", ports: "", env: "", command: "" } },
    { id: "imgp", kind: "image", name: "cache-img", x: 0, y: 0, props: { pull: "redis:7", buildTag: "", buildContext: "" } },
    { id: "imgb", kind: "image", name: "built", x: 0, y: 0, props: { pull: "", buildTag: "built:1", buildContext: "src" } },
    { id: "app", kind: "app", name: "api", x: 0, y: 0, props: { image: "api:latest", builder: "heroku", source: "backend" } },
    { id: "svc", kind: "service", name: "web-svc", x: 0, y: 0, props: { port: "80", selector: "app=web, tier=front", type: "VirtualIP" } },
    { id: "ing", kind: "ingress", name: "web-ing", x: 0, y: 0, props: { host: "exemplo.local", path: "/", port: "80" } },
    { id: "tun", kind: "tunnel", name: "public", x: 0, y: 0, props: { provider: "pinggy", localPort: "8080", hostname: "" } },
    { id: "gw", kind: "gateway", name: "edge-gw", x: 0, y: 0, props: { provider: "opnsense" } },
    { id: "dep", kind: "dependency", name: "web-db", x: 0, y: 0, props: { from: "web", to: "db", ports: "5432", proto: "tcp" } },
  ];
  return {
    version: 1, name: "rico", namespace: "studio", nodes,
    edges: [
      { id: "e1", source: "net", target: "web" },
      { id: "e2", source: "ing", target: "web" }, // ingress → backend container
    ],
  };
}

describe("catálogo completo — novos tipos mapeiam para os arrays do StackSpec", () => {
  const { yaml, warnings } = designToManifest(richDesign());

  it("sem erros de validação no desenho rico", () => {
    expect(validateDesign(richDesign()).filter((i) => i.level === "error")).toHaveLength(0);
  });

  it("image emite pull OU build (tag+context)", () => {
    expect(yaml).toContain("images:");
    expect(yaml).toContain('pull: "redis:7"');
    expect(yaml).toContain("build:");
    expect(yaml).toContain('tag: "built:1"');
    expect(yaml).toContain("context: src");
  });

  it("app emite apps[] com image/builder/source", () => {
    expect(yaml).toContain("apps:");
    expect(yaml).toContain("- name: api");
    expect(yaml).toContain('image: "api:latest"');
    expect(yaml).toContain("builder: heroku");
    expect(yaml).toContain("source: backend");
  });

  it("service emite selector.matchLabels + port + type", () => {
    expect(yaml).toContain("services:");
    expect(yaml).toContain("selector:");
    expect(yaml).toContain("matchLabels:");
    expect(yaml).toContain("app: web");
    expect(yaml).toContain("tier: front");
    expect(yaml).toContain("port: 80");
    expect(yaml).toContain("type: VirtualIP");
  });

  it("ingress resolve a aresta → backend.service.name do container ligado", () => {
    expect(yaml).toContain("ingress:");
    expect(yaml).toContain("host: exemplo.local");
    expect(yaml).toContain("backend:");
    expect(yaml).toContain("name: web"); // backend aponta para o container ligado
    expect(yaml).toContain("number: 80");
  });

  it("tunnel e gateway (appliance) materializam-se no stack", () => {
    expect(yaml).toContain("tunnels:");
    expect(yaml).toContain("provider: pinggy");
    expect(yaml).toContain("localPort: 8080");
    expect(yaml).toContain("networkGateways:");
    expect(yaml).toContain("provider: opnsense");
  });

  it("dependency emite from/to/ports/proto", () => {
    expect(yaml).toContain("dependencies:");
    expect(yaml).toContain("from: web");
    expect(yaml).toContain("to: db");
    expect(yaml).toContain("proto: tcp");
    expect(yaml).toContain('- "5432"');
  });

  it("nenhum aviso espúrio (tudo mapeia)", () => {
    expect(warnings).toHaveLength(0);
  });

  it("service com selector vazio recai em app=<nome> (ServiceSpec exige selector)", () => {
    const d = emptyDesign("x");
    d.nodes.push({ id: "s", kind: "service", name: "sem-sel", x: 0, y: 0, props: { port: "443", selector: "", type: "DNS" } });
    const { yaml: y } = designToManifest(d);
    expect(y).toContain("app: sem-sel");
  });

  it("validação assinala os campos obrigatórios dos tipos novos", () => {
    const d = emptyDesign("x");
    d.nodes.push({ id: "i", kind: "image", name: "i", x: 0, y: 0, props: {} });
    d.nodes.push({ id: "t", kind: "tunnel", name: "t", x: 0, y: 0, props: {} });
    d.nodes.push({ id: "dep", kind: "dependency", name: "d", x: 0, y: 0, props: {} });
    const errs = validateDesign(d).filter((i) => i.level === "error").map((i) => i.message);
    expect(errs.some((m) => /pull.*OU.*build|build/i.test(m))).toBe(true);
    expect(errs.some((m) => /porta local|fornecedor/i.test(m))).toBe(true);
    expect(errs.some((m) => /"from"/.test(m))).toBe(true);
  });
});

describe("roundtrip dos novos tipos — design → YAML → design", () => {
  it("preserva os novos tipos, as suas propriedades e a aresta do ingress", () => {
    const d = richDesign();
    const { design: back } = manifestToDesign(designToManifest(d).yaml);
    // Todos os tipos sobrevivem.
    for (const k of ["image", "app", "service", "ingress", "tunnel", "gateway", "dependency"] as const) {
      expect(back.nodes.some((n) => n.kind === k), `tipo ${k} perdido no roundtrip`).toBe(true);
    }
    // Propriedades-chave preservadas.
    const svc = back.nodes.find((n) => n.kind === "service")!;
    expect(svc.props.port).toBe("80");
    expect(svc.props.selector).toContain("app=web");
    const app = back.nodes.find((n) => n.kind === "app")!;
    expect(app.props.image).toBe("api:latest");
    expect(app.props.builder).toBe("heroku");
    const dep = back.nodes.find((n) => n.kind === "dependency")!;
    expect(dep.props.from).toBe("web");
    expect(dep.props.to).toBe("db");
    // A aresta ingress → container foi reconstruída.
    const ing = back.nodes.find((n) => n.kind === "ingress")!;
    const web = back.nodes.find((n) => n.kind === "container" && n.name === "web")!;
    expect(back.edges.some((e) => (e.source === ing.id && e.target === web.id) || (e.source === web.id && e.target === ing.id))).toBe(true);
  });

  it("é um ponto fixo: YAML → design → YAML idempotente com os tipos novos", () => {
    const y1 = designToManifest(richDesign()).yaml;
    const y2 = designToManifest(manifestToDesign(y1).design).yaml;
    const y3 = designToManifest(manifestToDesign(y2).design).yaml;
    expect(y3).toBe(y2);
  });
});

describe("canConnect — ligações novas", () => {
  it("aceita ingress↔container e ingress↔pod", () => {
    expect(canConnect("ingress", "container")).toBe(true);
    expect(canConnect("pod", "ingress")).toBe(true); // não-orientado
  });
  it("recusa ligações sem sentido dos tipos novos", () => {
    expect(canConnect("service", "container")).toBe(false); // selector é por rótulo
    expect(canConnect("tunnel", "container")).toBe(false);
    expect(canConnect("image", "container")).toBe(false);
  });
});

describe("summarizePlan / normalizePlanAction — Plan REAL (stack plan -o json)", () => {
  const rows: StackPlanRow[] = [
    { kind: "Network", name: "app", action: "create", changed: true, diffs: 0, planDigest: "a" },
    { kind: "Container", name: "web", action: "update", changed: true, diffs: 2, planDigest: "b" },
    { kind: "Container", name: "old", action: "delete", changed: true, diffs: 0, planDigest: "c" },
    { kind: "Volume", name: "data", action: "noop", changed: false, diffs: 0, planDigest: "d" },
  ];
  it("conta create/update/remove/noop e os recursos que mudam", () => {
    const s = summarizePlan(rows);
    expect(s).toMatchObject({ create: 1, update: 1, remove: 1, noop: 1, changed: 3, total: 4 });
  });
  it("normaliza sinónimos de ação do engine", () => {
    expect(normalizePlanAction("replace")).toBe("update");
    expect(normalizePlanAction("destroy")).toBe("remove");
    expect(normalizePlanAction("keep")).toBe("noop");
    expect(normalizePlanAction("add")).toBe("create");
  });
});

describe("parseStackLs / resourceProgress — Apply até Ready", () => {
  const ls = [
    "warning qualquer coisa antes da tabela",
    "KIND            DOMAIN         NAME            PRESENT   STATUS        NAMESPACE",
    "Container       compute        web             yes       Up 3d         studio",
    "Container       compute        db              no        -             studio",
    "Network         net            app             yes       -             studio",
    "Ingress         net-exposure   web-ing         -         declarative   studio",
    "Container       compute        broken          yes       Exited (1)    studio",
  ].join("\n");

  it("parseStackLs lê as colunas por posição de cabeçalho", () => {
    const rows = parseStackLs(ls);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ kind: "Container", name: "web", present: "yes", status: "Up 3d", namespace: "studio" });
    expect(rows.find((r) => r.name === "web-ing")?.present).toBe("-");
  });

  it("resourceProgress classifica pending/present/ready/failed/declarative", () => {
    const p = resourceProgress(parseStackLs(ls));
    const by = (n: string) => p.rows.find((r) => r.name === n)!.state;
    expect(by("web")).toBe("ready"); // present yes + status Up
    expect(by("db")).toBe("pending"); // present no
    expect(by("app")).toBe("ready"); // present yes + status "-"
    expect(by("web-ing")).toBe("declarative");
    expect(by("broken")).toBe("failed");
    expect(p.done).toBe(false); // há pendentes/falhados
  });

  it("done=true quando tudo está ready/declarativo", () => {
    const allUp = [
      "KIND        NAME   PRESENT  STATUS       NAMESPACE",
      "Container   web    yes      Up           studio",
      "Ingress     ing    -        declarative  studio",
    ].join("\n");
    const p = resourceProgress(parseStackLs(allUp));
    expect(p.done).toBe(true);
    expect(p.ready).toBe(2);
  });

  it("saída sem tabela (duplo local) → zero linhas, sem rebentar", () => {
    expect(parseStackLs("duplo local — sem engine · delonix stack ls")).toHaveLength(0);
  });
});

describe("parseStackHistory — revisões (stack history -o json, ADR-0019)", () => {
  it("parseia revisões, ordena da mais recente e marca falhas", () => {
    const json = JSON.stringify([
      { revision: 1, at: "2026-10-26T10:00:00Z", action: "apply", ok: true },
      { revision: 2, appliedAt: "2026-10-26T11:00:00Z", ok: false, error: "DX-5601 recurso de outro stack" },
    ]);
    const revs = parseStackHistory(json);
    expect(revs).toHaveLength(2);
    expect(revs[0].revision).toBe(2); // ordenado desc
    expect(revs[0].ok).toBe(false);
    expect(revs[0].error).toMatch(/DX-5601/);
    expect(revs[1].ok).toBe(true);
  });
  it("lista vazia e texto não-JSON → []", () => {
    expect(parseStackHistory("[]")).toHaveLength(0);
    expect(parseStackHistory("duplo local — sem engine")).toHaveLength(0);
  });
});
