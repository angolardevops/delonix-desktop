import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reconnectingStream, type StreamStatus } from "./reconnectingStream";

describe("reconnectingStream — reconexão com backoff", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("religa ao fim do fluxo e pára de vez no stop()", async () => {
    let lastOnEnd: () => void = () => {};
    let lastOnLine: (l: string) => void = () => {};
    const stopSpy = vi.fn();
    const start = vi.fn((onLine: (l: string) => void, onEnd: () => void) => {
      lastOnLine = onLine;
      lastOnEnd = onEnd;
      return Promise.resolve(stopSpy);
    });
    const lines: string[] = [];
    const statuses: StreamStatus[] = [];

    const stop = reconnectingStream({
      start,
      onLine: (l) => lines.push(l),
      onStatus: (s) => statuses.push(s),
      backoffMs: 4000,
    });

    await vi.advanceTimersByTimeAsync(0); // deixa a 1.ª ligação arrancar
    expect(start).toHaveBeenCalledTimes(1);
    expect(statuses).toContain("streaming");

    // Dados a fluir chegam ao consumidor.
    lastOnLine("linha-1");
    expect(lines).toEqual(["linha-1"]);

    // Fim do processo → interrompido + reconexão agendada (backoff base).
    lastOnEnd();
    expect(statuses[statuses.length - 1]).toBe("interrupted");
    await vi.advanceTimersByTimeAsync(4000);
    expect(start).toHaveBeenCalledTimes(2);

    // stop() corta a ligação viva e cancela futuras reconexões.
    stop();
    expect(stopSpy).toHaveBeenCalled();
    lastOnEnd(); // já cancelado → ignorado
    await vi.advanceTimersByTimeAsync(60000);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("faz backoff exponencial enquanto não recebe dados", async () => {
    let lastOnEnd: () => void = () => {};
    const start = vi.fn((_onLine: (l: string) => void, onEnd: () => void) => {
      lastOnEnd = onEnd;
      return Promise.resolve(() => {});
    });
    const stop = reconnectingStream({ start, onLine: () => {}, backoffMs: 1000, maxBackoffMs: 30000 });

    await vi.advanceTimersByTimeAsync(0);
    expect(start).toHaveBeenCalledTimes(1);

    lastOnEnd();                                   // 1.ª falha → 1000ms
    await vi.advanceTimersByTimeAsync(1000);
    expect(start).toHaveBeenCalledTimes(2);

    lastOnEnd();                                   // 2.ª falha seguida → 2000ms
    await vi.advanceTimersByTimeAsync(1999);
    expect(start).toHaveBeenCalledTimes(2);        // ainda não
    await vi.advanceTimersByTimeAsync(1);
    expect(start).toHaveBeenCalledTimes(3);

    stop();
  });
});
