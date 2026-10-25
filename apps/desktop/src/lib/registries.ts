// Registries OCI (§ registries). O engine 5.1.1 guarda as credenciais por
// registry em `<root>/auth.json` (formato docker/podman), onde `<root>` é a raiz
// de dados do delonix — `$XDG_DATA_HOME/delonix` ou, na falta, `~/.local/share/
// delonix`. NÃO há `image login --list`, por isso a app LÊ esse ficheiro para
// mostrar o estado REAL persistido (e não só o que foi autenticado na sessão).
//
// Segurança: a password NUNCA é exposta. O campo `auth` é `base64(user:pass)`;
// daqui só se extrai o UTILIZADOR (a parte antes de ':'), nunca o segredo.
import { isTauri } from "./client";
import { exists, homeDir, joinPath, readTextFile } from "./fsx";

// Um registry autenticado, tal como persistido no auth.json.
export interface RegistryAuth {
  registry: string; // host (ex.: "ghcr.io", "docker.io")
  username: string; // extraído de `username` ou do base64 de `auth` (nunca a password)
  hasCredential: boolean; // há `auth`/`identitytoken` guardado
}

export interface RegistryReadResult {
  available: boolean; // há filesystem (Tauri)? Fora do Tauri devolve uma amostra.
  path: string | null; // caminho lido (null fora do Tauri)
  registries: RegistryAuth[];
  error: string | null; // erro de leitura/parse (ficheiro ilegível), se houver
}

// Extrai só o UTILIZADOR de um `auth` base64 (`base64(user:pass)`). Devolve ""
// se não decodificar. NUNCA devolve a parte da password (corta no primeiro ':').
export function decodeAuthUser(auth: unknown): string {
  if (typeof auth !== "string" || !auth) return "";
  if (typeof atob !== "function") return "";
  try {
    const decoded = atob(auth);
    const i = decoded.indexOf(":");
    return i >= 0 ? decoded.slice(0, i) : decoded;
  } catch {
    return "";
  }
}

// Parser PURO do auth.json (formato docker/podman). Tolerante: JSON inválido,
// `auths` em falta ou entradas estranhas não partem a lista — devolve o que
// conseguir. A ordenação é estável (por host) para a UI não "saltar".
export function parseAuthJson(text: string): RegistryAuth[] {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return [];
  }
  const auths = (doc as { auths?: unknown } | null)?.auths;
  if (!auths || typeof auths !== "object") return [];
  const out: RegistryAuth[] = [];
  for (const [registry, raw] of Object.entries(auths as Record<string, unknown>)) {
    if (!registry) continue;
    const v = (raw ?? {}) as { username?: unknown; auth?: unknown; identitytoken?: unknown };
    const username =
      (typeof v.username === "string" && v.username) || decodeAuthUser(v.auth) || "";
    const hasCredential = Boolean(v.auth || v.identitytoken);
    out.push({ registry, username, hasCredential });
  }
  out.sort((a, b) => a.registry.localeCompare(b.registry));
  return out;
}

// Host de registry de uma referência de imagem, pela regra do Docker: o primeiro
// segmento é o host SE tiver um ponto, dois-pontos (porta) ou for "localhost";
// caso contrário a imagem é do Docker Hub ("docker.io"). PURO (testável).
// Ex.: "ghcr.io/org/x:tag" → "ghcr.io"; "postgres:16" → "docker.io";
//      "firecracker/ci:24.04" → "docker.io"; "localhost:5000/x" → "localhost:5000".
export function imageHost(ref: string): string {
  const slash = ref.indexOf("/");
  if (slash < 0) return "docker.io";
  const first = ref.slice(0, slash);
  if (first.includes(".") || first.includes(":") || first === "localhost") return first;
  return "docker.io";
}

// Raiz de dados do delonix (`<root>` do auth.json). Honra $XDG_DATA_HOME pela API
// de caminhos do Tauri (dataDir() devolve $XDG_DATA_HOME ou ~/.local/share); cai
// em ~/.local/share quando não houver.
async function dataRoot(): Promise<string> {
  if (isTauri()) {
    try {
      const { dataDir } = await import("@tauri-apps/api/path");
      const d = await dataDir();
      if (d) return d.replace(/\/+$/, "");
    } catch {
      /* cai no fallback por $HOME */
    }
  }
  const home = await homeDir();
  return joinPath(home === "/" ? "" : home.replace(/\/+$/, ""), ".local/share");
}

// Caminho absoluto do auth.json (`<root>/delonix/auth.json`).
export async function authJsonPath(): Promise<string> {
  const root = await dataRoot();
  return `${root}/delonix/auth.json`;
}

// Amostra para dev no browser (sem filesystem): a tela aparece povoada em vez de
// vazia. Sob Tauri isto NUNCA é usado — lê-se o ficheiro real.
const MOCK_SAMPLE: RegistryAuth[] = [
  { registry: "ghcr.io", username: "angolardevops", hasCredential: true },
  { registry: "docker.io", username: "biblioteca", hasCredential: true },
];

// Lê os registries autenticados do auth.json persistido. Fora do Tauri devolve a
// amostra (available=false). Ficheiro inexistente → lista vazia (estado claro).
export async function readRegistryAuths(): Promise<RegistryReadResult> {
  if (!isTauri()) {
    return { available: false, path: null, registries: MOCK_SAMPLE, error: null };
  }
  const path = await authJsonPath();
  try {
    if (!(await exists(path))) return { available: true, path, registries: [], error: null };
    const text = await readTextFile(path);
    return { available: true, path, registries: parseAuthJson(text), error: null };
  } catch (e) {
    return { available: true, path, registries: [], error: String(e) };
  }
}
