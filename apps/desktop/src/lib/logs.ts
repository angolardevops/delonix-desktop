// Lógica PURA do explorador de logs unificado (§7). Isolada do React para ser
// testável: o teto de buffer, o filtro de pesquisa e o parsing do carimbo de
// tempo que `container logs --timestamps` antepõe. A tela (screens/Logs.tsx) só
// orquestra o stream (stream.rs) e chama estas funções.

// As origens de log. `streams` diz se há um fluxo ao vivo (`-f`) ou não; `note`
// é a limitação HONESTA a mostrar na UI quando a origem não tem logs próprios.
export type LogSource = "container" | "pod" | "vm" | "build" | "cluster";

export interface SourceMeta {
  id: LogSource;
  label: string;
  streams: boolean;
  // Só algumas origens aceitam o toggle de timestamps (`container logs
  // --timestamps`, que exige `--log-cri` no run). As outras não têm a flag.
  timestamps: boolean;
  note?: string;
}

export const LOG_SOURCES: SourceMeta[] = [
  { id: "container", label: "Container", streams: true, timestamps: true },
  { id: "pod", label: "Pod", streams: true, timestamps: false },
  {
    id: "cluster",
    label: "Pod de cluster (k8s)",
    streams: false,
    timestamps: false,
    note: "Instantâneo via `cluster kubectl logs` (kubeconfig em cache). Sem follow aqui; recarregue para atualizar. Requer kubectl acessível.",
  },
  {
    id: "vm",
    label: "VM",
    streams: false,
    timestamps: false,
    note: "Uma VM não expõe logs de guest ao engine — só a consola série (`vm console`). Abra o Terminal da VM para a consola.",
  },
  {
    id: "build",
    label: "Build",
    streams: false,
    timestamps: false,
    note: "Os logs de build aparecem AO VIVO na tela Construir durante um `build`. Não há registo histórico de builds para seguir aqui.",
  },
];

export const sourceMeta = (id: LogSource): SourceMeta =>
  LOG_SOURCES.find((s) => s.id === id) ?? LOG_SOURCES[0];

// Tetos de buffer configuráveis (linhas mantidas em memória do renderer).
export const BUFFER_LIMITS = [1000, 5000, 10000] as const;
export type BufferLimit = (typeof BUFFER_LIMITS)[number];

// Mantém só as últimas `limit` linhas (um log infinito não pode crescer sem
// travão na memória do webview). Devolve o MESMO array quando não corta.
export function capLines(lines: string[], limit: number): string[] {
  return lines.length > limit ? lines.slice(lines.length - limit) : lines;
}

// Filtro de pesquisa (case-insensitive, substring). Vazio → tudo (mesmo array).
export function filterLogLines(lines: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  return q ? lines.filter((l) => l.toLowerCase().includes(q)) : lines;
}

// Deteta o carimbo RFC3339 que `container logs --timestamps` antepõe a cada
// linha. Devolve `{ts, text}` (ts a null quando a linha não o traz — p.ex. sem
// `--log-cri`, o engine devolve a linha crua). Puro — usado para destacar a
// coluna de tempo sem a confundir com o conteúdo.
const RFC3339 = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s+([\s\S]*)$/;
export function splitTimestamp(line: string): { ts: string | null; text: string } {
  const m = RFC3339.exec(line);
  return m ? { ts: m[1], text: m[2] } : { ts: null, text: line };
}

// Nome de ficheiro sugerido para exportar um log (sem caracteres problemáticos).
export function logFilename(source: LogSource, resource: string): string {
  const safe = (resource || "logs").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "logs";
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  return `${source}-${safe}-${stamp}.log`;
}
