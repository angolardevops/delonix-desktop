import { describe, expect, it } from "vitest";
import { byteRate, cpuRate, fmtBinBytes, fmtRate, latestRates, type Sample } from "./metrics";

// Amostra mínima: só os campos relevantes; o resto a null.
const S = (t: number, over: Partial<Sample> = {}): Sample => ({
  t,
  cpu_usage_usec: null,
  mem_bytes: null,
  io_read_bytes: null,
  io_write_bytes: null,
  net_rx_bytes: null,
  net_tx_bytes: null,
  ...over,
});

describe("cpuRate", () => {
  it("2 núcleos durante 1 s → 200% por núcleo", () => {
    // 2 núcleos-segundo = 2_000_000 usec consumidos num Δt de 1000 ms.
    const prev = S(1000, { cpu_usage_usec: 0 });
    const curr = S(2000, { cpu_usage_usec: 2_000_000 });
    const r = cpuRate(prev, curr);
    expect(r).not.toBeNull();
    expect(r!.cores).toBeCloseTo(2, 6);
    expect(r!.pctPerCore).toBeCloseTo(200, 6); // NÃO limitado a 100
    expect(r!.pctCapacity).toBeNull(); // sem cpu_millis → sem % de capacidade
  });

  it("0.5 núcleos → 50% por núcleo", () => {
    const r = cpuRate(S(0, { cpu_usage_usec: 0 }), S(1000, { cpu_usage_usec: 500_000 }));
    expect(r!.pctPerCore).toBeCloseTo(50, 6);
  });

  it("% de capacidade só quando cpu_millis é conhecido", () => {
    // 2 núcleos de 4000 millis allocatable = 50% da capacidade.
    const r = cpuRate(S(0, { cpu_usage_usec: 0 }), S(1000, { cpu_usage_usec: 2_000_000 }), 4000);
    expect(r!.pctCapacity).toBeCloseTo(50, 6);
  });

  it("reinício de contador (Δ<0) → null (nunca negativo)", () => {
    const r = cpuRate(S(0, { cpu_usage_usec: 9_000_000 }), S(1000, { cpu_usage_usec: 10_000 }));
    expect(r).toBeNull();
  });

  it("falta cpu_usage_usec → null", () => {
    expect(cpuRate(S(0), S(1000, { cpu_usage_usec: 1000 }))).toBeNull();
    expect(cpuRate(S(0, { cpu_usage_usec: 1000 }), S(1000))).toBeNull();
  });

  it("Δt<=0 (amostra duplicada) → null", () => {
    expect(cpuRate(S(1000, { cpu_usage_usec: 0 }), S(1000, { cpu_usage_usec: 10 }))).toBeNull();
  });
});

describe("byteRate", () => {
  it("Δbytes/Δt em bytes/s", () => {
    // 150 KiB em 1,5 s = 100 KiB/s.
    expect(byteRate(0, 150 * 1024, 0, 1500)).toBeCloseTo(100 * 1024, 6);
  });

  it("reinício de contador (Δ<0) → null", () => {
    expect(byteRate(1_000_000, 10, 0, 1000)).toBeNull();
  });

  it("valor em falta → null", () => {
    expect(byteRate(null, 1000, 0, 1000)).toBeNull();
    expect(byteRate(1000, null, 0, 1000)).toBeNull();
  });

  it("Δt<=0 → null", () => {
    expect(byteRate(0, 1000, 1000, 1000)).toBeNull();
  });
});

describe("latestRates", () => {
  it("primeira amostra: sem taxas, mas memória instantânea aparece", () => {
    const r = latestRates([S(0, { mem_bytes: 2048, cpu_usage_usec: 0 })]);
    expect(r.samples).toBe(1);
    expect(r.cpu).toBeNull();
    expect(r.ioRead).toBeNull();
    expect(r.netTx).toBeNull();
    expect(r.mem).toBe(2048);
  });

  it("histórico vazio: tudo null", () => {
    const r = latestRates([]);
    expect(r.samples).toBe(0);
    expect(r.mem).toBeNull();
    expect(r.cpu).toBeNull();
  });

  it("usa as DUAS últimas amostras para io/net", () => {
    const hist: Sample[] = [
      S(0, { io_read_bytes: 0, net_rx_bytes: 0 }),
      S(1000, { io_read_bytes: 1024, net_rx_bytes: 2048 }),
      S(2000, { io_read_bytes: 1024 + 4096, net_rx_bytes: 2048 + 8192, mem_bytes: 512 }),
    ];
    const r = latestRates(hist);
    expect(r.ioRead).toBeCloseTo(4096, 6); // (4096 bytes) / 1 s
    expect(r.netRx).toBeCloseTo(8192, 6);
    expect(r.mem).toBe(512);
    expect(r.samples).toBe(3);
  });
});

describe("fmtBinBytes / fmtRate (unidades binárias)", () => {
  it("1024 B rotula KiB, não KB", () => {
    expect(fmtBinBytes(1024)).toBe("1,0 KiB");
  });

  it("MiB e GiB", () => {
    expect(fmtBinBytes(1024 ** 2)).toBe("1,0 MiB");
    expect(fmtBinBytes(1.5 * 1024 ** 3)).toBe("1,5 GiB");
  });

  it("bytes crus sem unidade decimal", () => {
    expect(fmtBinBytes(512)).toBe("512 B");
  });

  it("null → travessão", () => {
    expect(fmtBinBytes(null)).toBe("—");
    expect(fmtRate(null)).toBe("—");
  });

  it("taxa acrescenta /s", () => {
    expect(fmtRate(100 * 1024)).toBe("100 KiB/s");
  });
});
