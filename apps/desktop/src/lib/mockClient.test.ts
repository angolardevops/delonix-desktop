import { describe, expect, it } from "vitest";
import { MockClient } from "./mockClient";

// Fase 1-B no duplo local: o seletor de namespace filtra a lista (prova em
// browser dev) e o inspect revela/oculta sem nunca inventar valores reais.
describe("MockClient — namespace e secret inspect", () => {
  it("workloads() sem namespace lista todas; com namespace filtra", async () => {
    const c = new MockClient();
    const all = await c.workloads();
    const def = await c.workloads("default");
    const team = await c.workloads("team-a");
    // A descoberta (sem -n) vê mais que uma namespace.
    expect(new Set(all.map((w) => w.namespace)).size).toBeGreaterThan(1);
    // Filtrar muda a lista — a prova pedida.
    expect(def.length).toBeLessThan(all.length);
    expect(def.every((w) => w.namespace === "default")).toBe(true);
    expect(team.map((w) => w.name).sort()).toEqual(["team-a-api", "team-a-worker"]);
  });

  it("secretInspect: redige por omissão, revela a pedido (valor de duplo local)", async () => {
    const c = new MockClient();
    const [s] = await c.secrets();
    const redacted = await c.secretInspect(s.name, false);
    expect(redacted.revealed).toBe(false);
    expect(Object.values(redacted.keys).every((v) => v === "••••••")).toBe(true);

    const revealed = await c.secretInspect(s.name, true);
    expect(revealed.revealed).toBe(true);
    expect(Object.keys(revealed.keys)).toEqual(s.names);
    expect(Object.values(revealed.keys).some((v) => v === "••••••")).toBe(false);
  });
});
