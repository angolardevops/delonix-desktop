// Normalizador CENTRAL de erros do CLI `delonix` (§3). O engine é daemonless: a
// única sinalização estruturada que chega da camada de integração é o stderr (+
// o código de saída) de cada processo, mais o marcador de TIMEOUT que o backend
// Rust injeta quando mata um processo pendurado. Este módulo transforma esse
// texto cru numa forma TIPADA e acionável — uma generalização do antigo
// `extractPullError` (que só cobria o pull): filtra o ruído INFO/tracing,
// extrai os códigos `DX-NNNN`, classifica a classe do erro e mapeia-a a uma
// HINT acionável. É PURO (testável em Node, sem Tauri).

export type CliErrorKind =
  | "not-found"
  | "auth"
  | "disk"
  | "permission"
  | "timeout"
  | "unknown";

export interface CliError {
  // Código do engine quando presente (ex.: "DX-4402"). Os DLX-RES-* de conselho
  // do dashboard não entram aqui — são tratados na tela de recursos.
  code?: string;
  kind: CliErrorKind;
  // Mensagem já limpa do ruído, pronta para mostrar.
  message: string;
  // Sugestão acionável (como resolver). Pode faltar quando não há nada a propor.
  hint?: string;
  // O texto original, preservado para quem quiser o detalhe cru.
  raw: string;
}

// Marcador que o backend (src-tauri/src/cli.rs) antepõe ao erro quando MATA um
// processo que excedeu o tempo-limite. É o contrato que distingue um TIMEOUT de
// um stderr vazio. Tem de casar com `TIMEOUT_PREFIX` no Rust.
export const TIMEOUT_MARKER = "DLX_TIMEOUT";

// Linhas de ruído do stderr do engine: tracing (INFO/DEBUG/TRACE) e as linhas de
// PROGRESSO do pull/build (não são erros). WARN NÃO entra — um aviso pode ser a
// única pista útil. Igual ao filtro original do `extractPullError`.
const NOISE = /\bINFO\b|\bDEBUG\b|\bTRACE\b|^\s*(pulling|platform selected|copying|downloading|extracting)\b/i;

// Linhas que CARREGAM o erro (o que vale a pena mostrar).
const SIGNAL = /^error\b|\berror[:[]|\bDX-\d|no such|unauthorized|denied|forbidden|failed|refused|cannot|unable|not found|não (foi|encontrad)|sem (espaço|permissão)|permission|timeout|timed out/i;

// Remove as linhas de ruído de um texto de stderr, devolvendo as linhas úteis
// (trim, sem vazias). Exportado para o explorador de pull reaproveitar.
export function stripNoise(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !NOISE.test(l));
}

// Extrai o PRIMEIRO código DX-NNNN (3-4 dígitos) do texto, se existir.
const DX_CODE = /\b(DX-\d{3,4})\b/;
export function extractDxCode(text: string): string | undefined {
  return DX_CODE.exec(text)?.[1];
}

// Padrões por classe de erro. A ordem importa: timeout é detetado antes por
// causa do marcador; aqui ficam os restantes por palavra-chave.
const KIND_PATTERNS: [CliErrorKind, RegExp][] = [
  ["disk", /no space|disk (is )?full|enospc|out of space|sem espaço|espaço (em disco|insuficiente)|quota exceeded|disco cheio/i],
  ["permission", /permission denied|eacces|operation not permitted|must be root|not permitted|privilege|sem permissão/i],
  ["auth", /unauthorized|\b401\b|\b403\b|forbidden|authentication|access denied|login|credentials|sem autoriza/i],
  ["not-found", /no such|not found|não encontrad|does not exist|unknown (image|container|network|volume|secret)|inexistente/i],
];

// HINTS por código DX conhecido (o que foi MEDIDO no engine 5.1.1). Mantido
// curto e conservador — não inventa códigos que não existem.
const DX_HINTS: Record<string, { kind: CliErrorKind; hint: string }> = {
  // `image pull` de uma referência inexistente no registo (exit 4).
  "DX-4402": {
    kind: "not-found",
    hint: "Imagem inexistente no registo. Verifique a referência/tag; se for um registo privado, faça login em Plataforma › Registries.",
  },
  // Sem autorização no registo.
  "DX-4401": {
    kind: "auth",
    hint: "Sem autorização no registo. Faça login em Plataforma › Registries e tente novamente.",
  },
};

// HINT genérica por classe, quando não há um código conhecido.
const KIND_HINTS: Partial<Record<CliErrorKind, string>> = {
  "not-found": "O recurso indicado não existe. Confirme o nome ou a referência.",
  auth: "Sem autorização. Faça login em Plataforma › Registries.",
  disk: "Sem espaço em disco. Liberte espaço (imagens/volumes órfãos em GC) e repita.",
  permission: "Permissão negada. Confirme se o engine rootless tem acesso a este recurso.",
  timeout: "O comando excedeu o tempo-limite e foi terminado. O engine pode estar ocupado ou em baixo.",
};

function classifyKind(text: string): CliErrorKind {
  for (const [kind, re] of KIND_PATTERNS) if (re.test(text)) return kind;
  return "unknown";
}

// Escolhe a mensagem a mostrar: as linhas de SINAL (sem ruído); senão a última
// linha não-ruidosa; senão o código de saída; senão um fallback genérico.
function pickMessage(useful: string[], code?: number): string {
  const signal = useful.filter((l) => SIGNAL.test(l));
  if (signal.length) return signal.join("\n");
  if (useful.length) return useful[useful.length - 1];
  if (code != null && code !== 0) return `O comando saiu com o código ${code}.`;
  return "Ocorreu um erro ao falar com o engine.";
}

// Normaliza um stderr cru (+ código de saída opcional) numa `CliError` tipada.
// `raw` pode ser o stderr, uma mensagem de `invoke` rejeitada (inclui o marcador
// de TIMEOUT) ou qualquer `String(e)`.
export function toCliError(raw: string, code?: number): CliError {
  const text = (raw ?? "").toString();

  // TIMEOUT: o backend matou o processo. Classe distinta (não um stderr vazio).
  if (text.includes(TIMEOUT_MARKER) || /\btimed out\b|excedeu o tempo/i.test(text)) {
    const message = text.replace(new RegExp(`${TIMEOUT_MARKER}:?\\s*`), "").trim() || "O comando excedeu o tempo-limite.";
    return { kind: "timeout", message, hint: KIND_HINTS.timeout, raw: text };
  }

  const useful = stripNoise(text);
  const joined = useful.join("\n") || text;
  const dx = extractDxCode(joined);
  const known = dx ? DX_HINTS[dx] : undefined;
  const kind = known?.kind ?? classifyKind(joined);
  const message = pickMessage(useful, code);
  const hint = known?.hint ?? KIND_HINTS[kind];
  return { code: dx, kind, message, hint, raw: text };
}

// Renderiza uma `CliError` numa linha de texto (toast/histórico): código +
// mensagem + hint numa seta. Determinístico e sem HTML.
export function formatCliError(e: CliError): string {
  const head = e.code ? `[${e.code}] ${e.message}` : e.message;
  return e.hint ? `${head}\n→ ${e.hint}` : head;
}

// Atalho: do stderr cru (+ código) direto para a string a mostrar.
export function describeCliError(raw: string, code?: number): string {
  return formatCliError(toCliError(raw, code));
}
