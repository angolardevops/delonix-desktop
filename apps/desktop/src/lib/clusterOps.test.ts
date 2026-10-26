import { describe, expect, it } from "vitest";
import { MockClient } from "./mockClient";

// Lógica pura do lado TS: o duplo local honra o contrato de clusters operáveis
// (listar/criar/destruir/iniciar/parar/drenar/reativar) e a leitura kubectl READ
// (nós/pods/namespaces/logs). Prova o comportamento OBSERVÁVEL — a UI testa-se
// contra isto quando não há cluster real no host.
describe("MockClient — clusters operáveis", () => {
  it("lista os clusters semeados", async () => {
    const rows = await new MockClient().clusters(true);
    expect(rows.map((c) => c.name)).toContain("dev");
    const dev = rows.find((c) => c.name === "dev");
    expect(dev?.mode).toBe("kind");
    expect(dev?.state).toBe("up");
  });

  it("cria um cluster e passa a listá-lo", async () => {
    const c = new MockClient();
    const r = await c.run(["cluster", "create", "--name", "prova", "--workers", "2"], false);
    expect(r.ok).toBe(true);
    const rows = await c.clusters(true);
    const novo = rows.find((x) => x.name === "prova");
    expect(novo).toBeTruthy();
    expect(novo?.workers).toBe("2");
  });

  // Nota: `mockClusters` é estado de módulo partilhado entre testes DESTE
  // ficheiro (como no vmClient.test). Para não interferir com os testes de
  // leitura que dependem de "dev", o stop/start restaura o estado e o destroy
  // opera sobre um cluster descartável.
  it("parar e iniciar mudam o estado observável (restaura no fim)", async () => {
    const c = new MockClient();
    await c.run(["cluster", "stop", "dev"], true);
    expect((await c.clusters(true)).find((x) => x.name === "dev")?.state).toBe("stopped");
    await c.run(["cluster", "start", "dev"], true);
    expect((await c.clusters(true)).find((x) => x.name === "dev")?.state).toBe("up");
  });

  it("destruir remove o cluster (num cluster descartável)", async () => {
    const c = new MockClient();
    await c.run(["cluster", "create", "--name", "efemero"], false);
    expect((await c.clusters(true)).some((x) => x.name === "efemero")).toBe(true);
    await c.run(["cluster", "destroy", "efemero", "-f"], true);
    expect((await c.clusters(true)).some((x) => x.name === "efemero")).toBe(false);
  });

  it("drenar cordona um nó; reativar volta a torná-lo agendável", async () => {
    const c = new MockClient();
    const node = "dev-worker";
    await c.run(["cluster", "drain", node, "--name", "dev"], true);
    let nodes = await c.clusterNodes("dev");
    expect(nodes.find((n) => n.name === node)?.schedulable).toBe(false);
    await c.run(["cluster", "uncordon", node, "--name", "dev"], true);
    nodes = await c.clusterNodes("dev");
    expect(nodes.find((n) => n.name === node)?.schedulable).toBe(true);
  });
});

describe("MockClient — kubectl READ dentro do cluster", () => {
  it("lista nós com estado, papéis e versão", async () => {
    const nodes = await new MockClient().clusterNodes("dev");
    expect(nodes.length).toBe(3); // 1 CP + 2 workers
    const cp = nodes.find((n) => n.roles.includes("control-plane"));
    expect(cp?.ready).toBe(true);
    expect(cp?.version).toBe("v1.31.0");
  });

  it("lista pods de todos os namespaces e filtra por namespace", async () => {
    const c = new MockClient();
    const all = await c.clusterPods("dev");
    expect(all.length).toBeGreaterThan(0);
    expect(new Set(all.map((p) => p.namespace)).size).toBeGreaterThan(1);
    const sys = await c.clusterPods("dev", "kube-system");
    expect(sys.every((p) => p.namespace === "kube-system")).toBe(true);
  });

  it("lista namespaces e devolve logs de um pod", async () => {
    const c = new MockClient();
    const ns = await c.clusterNamespaces("dev");
    expect(ns).toContain("kube-system");
    const logs = await c.clusterPodLogs("dev", "nginx-7854ff8599-2m4kd", "default");
    expect(logs.length).toBeGreaterThan(0);
  });

  it("falha claramente para um cluster inexistente", async () => {
    await expect(new MockClient().clusterNodes("fantasma")).rejects.toThrow();
  });
});
