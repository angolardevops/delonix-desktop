import { describe, expect, it } from "vitest";
import {
  canConnect,
  designToManifest,
  diffDesignVsLive,
  emptyDesign,
  parseDesign,
  serializeDesign,
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
