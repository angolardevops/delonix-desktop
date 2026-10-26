import { describe, expect, it } from "vitest";
import {
  canConnect,
  CATALOG,
  defaultDesign,
  designToManifest,
  diffDesignVsLive,
  edgeLabel,
  emptyDesign,
  parseDesign,
  serializeDesign,
  STUDIO_TEMPLATES,
  toYaml,
  validateDesign,
  type StudioDesign,
} from "./studio";

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

describe("designToManifest — tipos de desenho avisam, não quebram", () => {
  it("gateway e cluster não entram no stack mas geram aviso", () => {
    const d = emptyDesign("mix");
    d.nodes.push({ id: "g", kind: "gateway", name: "edge", x: 0, y: 0, props: { provider: "cloudflare", port: "8080" } });
    d.nodes.push({ id: "k", kind: "cluster", name: "lab", x: 0, y: 0, props: {} });
    const { yaml, warnings } = designToManifest(d);
    expect(yaml).not.toContain("edge");
    expect(warnings).toHaveLength(2);
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
