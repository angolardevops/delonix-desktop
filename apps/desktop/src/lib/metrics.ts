// Métricas por recurso (§8) — funções PURAS e testáveis.
//
// Fonte dos dados: as `rows[]` do `delonix dashboard --json` (engine 5.1.1).
// Unidades confirmadas no engine:
//  - cpu_usage_usec: contador MONOTÓNICO em microssegundos (cgroup cpu.stat),
//    NÃO é percentagem. A taxa obtém-se por diferença entre duas amostras.
//  - mem_bytes: memory.current em bytes (valor instantâneo, não cumulativo).
//  - io_* / net_*: contadores CUMULATIVOS em bytes; a taxa é Δbytes/Δt.
//  - Campos a null/ausentes quando não medível (rootless, ou VMs — as rows de
//    VM NÃO preenchem cpu/mem; essas chegam aqui como null).
import type { ContainerStatsSample } from "./client";
import type { DashRow, SystemMetrics } from "./types";

// Uma amostra tirada num instante `t` (epoch em milissegundos).
export interface Sample {
  t: number;
  cpu_usage_usec: number | null;
  mem_bytes: number | null;
  io_read_bytes: number | null;
  io_write_bytes: number | null;
  net_rx_bytes: number | null;
  net_tx_bytes: number | null;
}

export interface CpuRate {
  cores: number; // núcleos equivalentes consumidos (1.0 = um núcleo a 100%)
  pctPerCore: number; // % por núcleo: cores×100 (2 núcleos = 200%, NÃO limitado a 100)
  pctCapacity: number | null; // % da capacidade allocatable, só se cpu_millis conhecido
}

// CPU entre duas amostras: cores = (Δcpu_usec/1000) / Δt_ms.
//  Δcpu_usec/1000 → milissegundos de tempo-CPU consumido; Δt_ms → tempo de
//  parede. O quociente é o nº de núcleos equivalentes. % por núcleo = cores×100.
// Devolve null (sem dados) se:
//  - falta cpu_usage_usec em qualquer amostra,
//  - Δt <= 0 (amostra duplicada / relógio não avançou),
//  - Δcpu_usec < 0 (reinício de contador — nunca mostrar negativo).
// Se `cpuMillis` (allocatable) for conhecido e > 0, calcula também a % de
// capacidade = cores / (cpu_millis/1000) × 100; senão fica null (não inventar).
export function cpuRate(prev: Sample, curr: Sample, cpuMillis?: number | null): CpuRate | null {
  if (prev.cpu_usage_usec == null || curr.cpu_usage_usec == null) return null;
  const dtMs = curr.t - prev.t;
  if (dtMs <= 0) return null;
  const dUsec = curr.cpu_usage_usec - prev.cpu_usage_usec;
  if (dUsec < 0) return null; // reinício de contador
  const cores = dUsec / 1000 / dtMs;
  const pctCapacity = cpuMillis != null && cpuMillis > 0 ? (cores / (cpuMillis / 1000)) * 100 : null;
  return { cores, pctPerCore: cores * 100, pctCapacity };
}

// Taxa de um contador cumulativo de bytes, em BYTES/SEGUNDO.
// Devolve null se faltar um dos valores, Δt <= 0, ou Δ < 0 (reinício).
export function byteRate(
  prevVal: number | null | undefined,
  currVal: number | null | undefined,
  prevT: number,
  currT: number,
): number | null {
  if (prevVal == null || currVal == null) return null;
  const dtMs = currT - prevT;
  if (dtMs <= 0) return null;
  const d = currVal - prevVal;
  if (d < 0) return null; // reinício de contador
  return d / (dtMs / 1000);
}

export interface Rates {
  cpu: CpuRate | null;
  mem: number | null; // valor INSTANTÂNEO em bytes (não é taxa)
  ioRead: number | null; // bytes/s (NÃO é IOPS)
  ioWrite: number | null; // bytes/s
  netRx: number | null; // bytes/s
  netTx: number | null; // bytes/s
  samples: number; // nº de amostras no histórico
}

// Calcula as taxas a partir das DUAS amostras mais recentes do histórico.
// Com menos de 2 amostras não há taxa possível: cpu/io/net ficam null
// (a UI mostra "sem dados"); a memória, por ser instantânea, já aparece
// com a primeira amostra.
export function latestRates(hist: Sample[], cpuMillis?: number | null): Rates {
  const n = hist.length;
  const curr = hist[n - 1];
  const mem = curr?.mem_bytes ?? null;
  if (n < 2) return { cpu: null, mem, ioRead: null, ioWrite: null, netRx: null, netTx: null, samples: n };
  const prev = hist[n - 2];
  return {
    cpu: cpuRate(prev, curr, cpuMillis),
    mem,
    ioRead: byteRate(prev.io_read_bytes, curr.io_read_bytes, prev.t, curr.t),
    ioWrite: byteRate(prev.io_write_bytes, curr.io_write_bytes, prev.t, curr.t),
    netRx: byteRate(prev.net_rx_bytes, curr.net_rx_bytes, prev.t, curr.t),
    netTx: byteRate(prev.net_tx_bytes, curr.net_tx_bytes, prev.t, curr.t),
    samples: n,
  };
}

// Converte uma row do dashboard numa amostra datada.
export function sampleFromRow(r: DashRow, t: number): Sample {
  return {
    t,
    cpu_usage_usec: r.cpu_usage_usec,
    mem_bytes: r.mem_bytes,
    io_read_bytes: r.io_read_bytes,
    io_write_bytes: r.io_write_bytes,
    net_rx_bytes: r.net_rx_bytes,
    net_tx_bytes: r.net_tx_bytes,
  };
}

// Uma amostra a partir do `ContainerStats` do contrato node.v1 (gRPC): cpu em
// NANOs (→ usec, ÷1000, a unidade do Sample); mem = working set; rede = rx/tx.
// O contrato não separa IO de leitura/escrita (só `writable_layer_bytes`, um
// TAMANHO, não contador) → io fica null (a UI mostra "não medido" sem inventar).
export function sampleFromStats(s: ContainerStatsSample, t: number): Sample {
  return {
    t,
    cpu_usage_usec: s.cpuUsageNanos / 1000,
    mem_bytes: s.memoryWorkingSetBytes,
    io_read_bytes: null,
    io_write_bytes: null,
    net_rx_bytes: s.networkRxBytes,
    net_tx_bytes: s.networkTxBytes,
  };
}

// Formatação em unidades BINÁRIAS, rotuladas corretamente (KiB=1024, não "KB").
// Separador decimal em vírgula (pt-AO), coerente com fmtBytes de lib/hooks.ts.
const BIN_UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
export function fmtBinBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  let v = n;
  let i = 0;
  while (Math.abs(v) >= 1024 && i < BIN_UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0).replace(".", ",")} ${BIN_UNITS[i]}`;
}

// Taxa em bytes/s formatada ("1,5 MiB/s"); null → "—".
export function fmtRate(bytesPerSec: number | null | undefined): string {
  return bytesPerSec == null ? "—" : `${fmtBinBytes(bytesPerSec)}/s`;
}

// --- Storage por categoria (§B, de `system metrics`) ------------------------
// Um segmento do storage: rótulo, bytes e a cor do token do tema para a barra.
export interface StorageSegment {
  key: "images" | "volumes" | "vm_images" | "containers";
  label: string;
  bytes: number;
  color: string;
}

// Decompõe o storage de `system metrics` nas suas 4 categorias, já com rótulo
// pt-AO e cor de tema, para uma barra empilhada. Ordem estável (maior família
// primeiro) para a legenda não saltar entre amostras.
export function storageBreakdown(m: SystemMetrics): StorageSegment[] {
  return [
    { key: "images", label: "Imagens", bytes: m.storage_bytes_images, color: "var(--chart-1)" },
    { key: "vm_images", label: "Imagens de VM", bytes: m.storage_bytes_vm_images, color: "var(--chart-2)" },
    { key: "volumes", label: "Volumes", bytes: m.storage_bytes_volumes, color: "var(--bar-ok)" },
    { key: "containers", label: "Containers", bytes: m.storage_bytes_containers, color: "var(--neu)" },
  ];
}

// Total de storage = soma das 4 categorias (o `system metrics` não traz total).
export function storageTotal(m: SystemMetrics): number {
  return m.storage_bytes_images + m.storage_bytes_volumes + m.storage_bytes_vm_images + m.storage_bytes_containers;
}
