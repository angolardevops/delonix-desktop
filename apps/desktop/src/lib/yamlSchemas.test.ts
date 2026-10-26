import { describe, expect, it } from "vitest";
import {
  apiVersionOf,
  buildSchemas,
  classifyYaml,
  schemasSignature,
  type YamlFile,
} from "./yamlSchemas";

describe("classifyYaml — por NOME", () => {
  it("reconhece o manifesto Delonix pelos nomes canónicos", () => {
    expect(classifyYaml("delonix.yaml", "")).toBe("delonix");
    expect(classifyYaml("delonix-manifest.yaml", "")).toBe("delonix");
    expect(classifyYaml("shop.delonix.yaml", "")).toBe("delonix");
    expect(classifyYaml("DELONIX.YAML", "")).toBe("delonix"); // case-insensitive
  });

  it("reconhece compose por qualquer *compose*.y{a,}ml", () => {
    expect(classifyYaml("docker-compose.yml", "")).toBe("compose");
    expect(classifyYaml("compose.yaml", "")).toBe("compose");
    expect(classifyYaml("app.compose.yaml", "")).toBe("compose");
    expect(classifyYaml("docker-compose.override.yml", "")).toBe("compose");
  });

  it("o NOME tem prioridade sobre o conteúdo", () => {
    // Um ficheiro chamado delonix.yaml é sempre Delonix, mesmo com apiVersion k8s.
    expect(classifyYaml("delonix.yaml", "apiVersion: apps/v1\nkind: Deployment\n")).toBe("delonix");
  });

  it("devolve null para YAML genérico", () => {
    expect(classifyYaml("values.yaml", "foo: bar\n")).toBeNull();
    expect(classifyYaml("notes.txt", "")).toBeNull();
  });
});

describe("classifyYaml — por HEURÍSTICA de conteúdo", () => {
  it("apiVersion delonix.io → manifesto Delonix", () => {
    expect(classifyYaml("algo.yaml", "apiVersion: delonix.io/v1\nkind: Stack\n")).toBe("delonix");
  });

  it("apiVersion + kind (não-delonix) → Kubernetes", () => {
    expect(classifyYaml("algo.yaml", "apiVersion: v1\nkind: Pod\n")).toBe("k8s");
    expect(classifyYaml("algo.yaml", "apiVersion: apps/v1\nkind: Deployment\n")).toBe("k8s");
    expect(classifyYaml("algo.yaml", "apiVersion: networking.k8s.io/v1\nkind: Ingress\n")).toBe("k8s");
  });

  it("apiVersion sem kind não é k8s", () => {
    expect(classifyYaml("algo.yaml", "apiVersion: v1\n")).toBeNull();
  });

  it("tolera aspas e indentação no apiVersion", () => {
    expect(apiVersionOf("apiVersion: 'v1'\n")).toBe("v1");
    expect(apiVersionOf('apiVersion: "apps/v1"\n')).toBe("apps/v1");
    expect(apiVersionOf("foo:\n  bar: baz\napiVersion: delonix.io/v1\n")).toBe("delonix.io/v1");
    expect(apiVersionOf("no api version here\n")).toBe("");
  });
});

describe("buildSchemas — associações para o monaco-yaml", () => {
  const delonixSchema = { title: "Delonix", type: "object" };
  const files: YamlFile[] = [
    { uri: "file:///a/delonix.yaml", name: "delonix.yaml", content: "" },
    { uri: "file:///b/docker-compose.yml", name: "docker-compose.yml", content: "" },
    { uri: "file:///c/pod.yaml", name: "pod.yaml", content: "apiVersion: v1\nkind: Pod\n" },
    { uri: "file:///d/values.yaml", name: "values.yaml", content: "foo: bar\n" },
  ];

  it("agrupa os URIs por família e associa o fileMatch certo", () => {
    const entries = buildSchemas(files, delonixSchema);
    const byUriContains = (needle: string) => entries.find((e) => e.fileMatch.some((f) => f.includes(needle)));
    expect(byUriContains("delonix.yaml")?.schema).toBe(delonixSchema);
    const compose = byUriContains("docker-compose.yml");
    expect(compose).toBeTruthy();
    expect((compose!.schema as { title: string }).title).toMatch(/Compose/i);
    const k8s = byUriContains("pod.yaml");
    expect(k8s).toBeTruthy();
    expect((k8s!.schema as { title: string }).title).toMatch(/Kubernetes/i);
    // O YAML genérico não entra em nenhuma associação.
    expect(entries.some((e) => e.fileMatch.some((f) => f.includes("values.yaml")))).toBe(false);
  });

  it("omite a família Delonix quando o schema do engine ainda não chegou", () => {
    const entries = buildSchemas(files, null);
    expect(entries.some((e) => e.fileMatch.some((f) => f.includes("delonix.yaml")))).toBe(false);
    // k8s e compose (embebidos) continuam presentes.
    expect(entries.length).toBe(2);
  });

  it("junta vários ficheiros da mesma família numa só entrada", () => {
    const two: YamlFile[] = [
      { uri: "file:///x/compose.yaml", name: "compose.yaml", content: "" },
      { uri: "file:///y/docker-compose.yml", name: "docker-compose.yml", content: "" },
    ];
    const entries = buildSchemas(two, null);
    expect(entries.length).toBe(1);
    expect(entries[0].fileMatch).toEqual(["file:///x/compose.yaml", "file:///y/docker-compose.yml"]);
  });
});

describe("schemasSignature — estável e sensível só ao que importa", () => {
  const files: YamlFile[] = [
    { uri: "file:///a/delonix.yaml", name: "delonix.yaml", content: "" },
    { uri: "file:///c/pod.yaml", name: "pod.yaml", content: "apiVersion: v1\nkind: Pod\n" },
  ];

  it("é estável independente da ordem dos ficheiros", () => {
    const a = schemasSignature(files, true);
    const b = schemasSignature([...files].reverse(), true);
    expect(a).toBe(b);
  });

  it("muda quando o schema Delonix fica disponível", () => {
    const before = schemasSignature(files, false);
    const after = schemasSignature(files, true);
    expect(before).not.toBe(after);
    // Sem o schema Delonix, a assinatura não menciona delonix.
    expect(before).not.toContain("delonix");
    expect(after).toContain("delonix");
  });

  it("não muda com edições que não alteram a classificação", () => {
    const edited: YamlFile[] = [
      { uri: "file:///a/delonix.yaml", name: "delonix.yaml", content: "metadata:\n  name: x\n" },
      { uri: "file:///c/pod.yaml", name: "pod.yaml", content: "apiVersion: v1\nkind: Pod\nmetadata: {}\n" },
    ];
    expect(schemasSignature(edited, true)).toBe(schemasSignature(files, true));
  });
});
