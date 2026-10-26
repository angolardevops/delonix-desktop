// Parsing PURO do `image ls -o json` do engine 5.1.1 (testável em Node).
// Contrato REAL medido (não os campos antigos repository/tag/size_human):
//   { repo_tags: string[], id: "sha256:…", created_unix: number,
//     size_bytes: number, orphan: boolean }
// `orphan` é a fonte AUTORITÁRIA de "sem uso" (não o cruzamento com workloads).
import type { ImageRow, WorkloadRow } from "./types";
import { describeCliError } from "./errors";
import { fmtCreated, humanBytes } from "./format";

type Obj = Record<string, unknown>;

// Encurta uma repo_tag removendo o prefixo implícito do Docker Hub
// (docker.io/library/… e docker.io/…). Ex.: "docker.io/library/alpine:3.20"
// → "alpine:3.20"; "ghcr.io/org/app:1" fica inalterado.
export const shortTag = (t: string): string =>
  t.replace(/^docker\.io\/library\//, "").replace(/^docker\.io\//, "");

// Escolhe a referência a mostrar a partir das repo_tags: prefere a forma CURTA
// (sem o prefixo docker.io/…) quando existir; senão encurta a primeira.
export const preferredRef = (repoTags: string[]): string => {
  if (!repoTags.length) return "";
  const nice = repoTags.find((t) => !t.startsWith("docker.io/"));
  return nice ?? shortTag(repoTags[0]);
};

const str = (o: Obj, k: string): string => {
  const v = o[k];
  return v === undefined || v === null ? "" : String(v);
};
const numOf = (o: Obj, k: string): number | null => {
  const v = o[k];
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Normaliza UMA entrada de `image ls -o json` para ImageRow. `usedBy` fica vazio
// aqui (preenchido depois por cruzamento com workloads); `orphan` vem do engine.
export const toImageRow = (raw: unknown, nowMs: number = Date.now()): ImageRow => {
  const o = (raw ?? {}) as Obj;
  const repoTags = Array.isArray(o.repo_tags) ? (o.repo_tags as unknown[]).map(String) : [];
  const tags = [...new Set(repoTags.map(shortTag))];
  const id = str(o, "id").replace(/^sha256:/, "").slice(0, 12);
  const ref = preferredRef(repoTags) || "<none>:<none>";
  return {
    ref,
    tags,
    id,
    size: humanBytes(numOf(o, "size_bytes")),
    created: fmtCreated(numOf(o, "created_unix"), nowMs),
    orphan: Boolean(o.orphan),
    usedBy: [],
  };
};

export const parseImages = (raw: unknown, nowMs: number = Date.now()): ImageRow[] =>
  (Array.isArray(raw) ? raw : []).map((r) => toImageRow(r, nowMs));

// Cruza as imagens com os workloads para preencher `usedBy` (quais workloads
// correm cada imagem). O `info` de um container é a sua imagem; compara-se com
// a ref, as tags curtas e o id (short). Best-effort — o eixo "em uso/sem uso"
// continua a basear-se em `orphan`, não neste cruzamento.
export const crossRefUsedBy = (images: ImageRow[], workloads: WorkloadRow[]): ImageRow[] => {
  return images.map((img) => {
    const keys = new Set<string>([img.ref, ...img.tags, img.id].filter(Boolean));
    const usedBy = workloads
      .filter((w) => {
        const info = (w.info ?? "").trim();
        if (!info) return false;
        return keys.has(info) || keys.has(shortTag(info)) || info.startsWith(img.id) || [...keys].some((k) => k && info.includes(k));
      })
      .map((w) => w.name);
    return usedBy.length ? { ...img, usedBy: [...new Set(usedBy)] } : img;
  });
};

// Extrai uma mensagem de erro ACIONÁVEL das linhas capturadas de um pull
// falhado. Agora delega no normalizador CENTRAL (lib/errors.ts): filtra o ruído
// INFO/tracing, extrai o código DX e junta a hint acionável (DX-4402 →
// "faça login no registry"). Mantém a assinatura (lines[] → string) para a tela
// de Imagens não mudar. Ver lib/errors.ts para a taxonomia.
export const extractPullError = (lines: string[]): string => describeCliError(lines.join("\n"));
