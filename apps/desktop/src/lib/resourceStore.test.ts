import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __reset, getSnapshot, normKey, subscribe } from "./resourceStore";

beforeEach(() => __reset());
afterEach(() => {
  __reset();
  vi.useRealTimers();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("resourceStore (camada de dados partilhada)", () => {
  it("dois consumidores da MESMA chave → uma só chamada a load", async () => {
    let calls = 0;
    const load = async () => {
      calls++;
      return calls;
    };
    const u1 = subscribe("workloads", load, 0, () => {});
    const u2 = subscribe("workloads", load, 0, () => {});

    await flush();

    // Partilham a entrada: a carga inicial é deduplicada numa só chamada.
    expect(calls).toBe(1);
    expect(getSnapshot<number>("workloads").data).toBe(1);

    u1();
    u2();
  });

  it("chaves diferentes → cargas independentes", async () => {
    let a = 0;
    let b = 0;
    const uA = subscribe("a", async () => (a += 1), 0, () => {});
    const uB = subscribe("b", async () => (b += 1), 0, () => {});
    await flush();
    expect(a).toBe(1);
    expect(b).toBe(1);
    uA();
    uB();
  });

  it("UM só setInterval por chave, no menor everyMs, e pára sem subscritores", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const load = async () => {
      calls++;
    };
    // Dois consumidores, intervalos diferentes (3000 e 10000) → timer único a 3000.
    const u1 = subscribe("dashboard", load, 3000, () => {});
    const u2 = subscribe("dashboard", load, 10000, () => {});

    await vi.advanceTimersByTimeAsync(0); // carga inicial (microtask)
    expect(calls).toBe(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(calls).toBe(2); // UMA carga por tick, não duas (sem polling duplicado)

    await vi.advanceTimersByTimeAsync(3000);
    expect(calls).toBe(3);

    u1();
    u2();
    await vi.advanceTimersByTimeAsync(9000);
    expect(calls).toBe(3); // sem subscritores → timer parado (sem fugas)
  });

  it("notifica os subscritores e mantém a cache no re-subscribe (StrictMode-safe)", async () => {
    let calls = 0;
    const load = async () => {
      calls++;
      return calls;
    };
    let notified = 0;
    const u1 = subscribe("images", load, 0, () => notified++);
    await flush();
    expect(calls).toBe(1);
    expect(notified).toBe(1);

    // Simula o double-invoke do StrictMode: cleanup e re-subscribe imediato.
    u1();
    const u2 = subscribe("images", load, 0, () => {});
    await flush();
    // A cache sobrevive: não há segunda carga só por re-subscrever.
    expect(calls).toBe(1);
    expect(getSnapshot<number>("images").data).toBe(1);
    u2();
  });

  it("getSnapshot devolve referência estável enquanto nada muda", async () => {
    const u = subscribe("volumes", async () => 42, 0, () => {});
    await flush();
    const s1 = getSnapshot("volumes");
    const s2 = getSnapshot("volumes");
    expect(s1).toBe(s2); // mesma referência → não provoca loop em useSyncExternalStore
    u();
  });

  it("re-chave por namespace: ['workloads', ns] são entradas INDEPENDENTES", async () => {
    // O seletor global passa a namespace na chave; cada namespace tem a sua
    // entrada no store (carga/cache própria) e mudar de namespace recarrega.
    const byNs: Record<string, string[]> = {
      default: ["pve92", "traefik"],
      "team-a": ["team-a-api", "team-a-worker"],
    };
    let defCalls = 0;
    let teamCalls = 0;
    const load = (ns: string) => async () => {
      if (ns === "default") defCalls++; else teamCalls++;
      return byNs[ns];
    };
    // Chaves distintas (normKey junta por espaço) → entradas distintas.
    const kDef = normKey(["workloads", "default"]);
    const kTeam = normKey(["workloads", "team-a"]);
    expect(kDef).not.toBe(kTeam);

    const uDef = subscribe(kDef, load("default"), 0, () => {});
    const uTeam = subscribe(kTeam, load("team-a"), 0, () => {});
    await flush();

    // Cada namespace carregou uma vez, com a SUA lista (mudar ns muda a lista).
    expect(defCalls).toBe(1);
    expect(teamCalls).toBe(1);
    expect(getSnapshot<string[]>(kDef).data).toEqual(["pve92", "traefik"]);
    expect(getSnapshot<string[]>(kTeam).data).toEqual(["team-a-api", "team-a-worker"]);

    uDef();
    uTeam();
  });

  it("um load que falha fica em error e não lança", async () => {
    const u = subscribe("doctor", async () => {
      throw new Error("engine em baixo");
    }, 0, () => {});
    await flush();
    const snap = getSnapshot("doctor");
    expect(snap.data).toBeNull();
    expect(snap.error).toContain("engine em baixo");
    u();
  });
});
