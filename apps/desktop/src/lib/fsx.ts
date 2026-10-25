// Camada de acesso ao FILESYSTEM para o explorador de ficheiros (eixo A).
// Abstrai o plugin oficial `@tauri-apps/plugin-fs` (LEITURA) e o comando
// backend `dlx_save_text` (ESCRITA só pelo save-dialog) num punhado de funções
// com FALLBACK GRACIOSO: fora do Tauri (dev no browser) não há filesystem, por
// isso as leituras rejeitam com uma mensagem clara e `fsAvailable()` devolve
// false — a tela mostra um aviso em vez de rebentar.
//
// Decisão de segurança (ver capabilities/default.json): a LEITURA é ampla
// (a partir de "/" e $HOME) porque um explorador de DevOps precisa de navegar o
// disco todo; a ESCRITA NÃO passa pelo plugin fs — grava-se por `dlx_save_text`
// num caminho escolhido pelo utilizador no diálogo nativo. Assim o webview
// nunca escreve no disco por conta própria.
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./client";
import { pickSavePath, YAML_FILTERS, type FileFilter } from "./native";

// Há filesystem? (Só sob Tauri.) A tela usa isto para o estado de "indisponível".
export const fsAvailable = (): boolean => isTauri();

export interface FsEntry {
  name: string;
  /** Caminho absoluto completo (dir + nome). */
  path: string;
  isDir: boolean;
  isFile: boolean;
  isSymlink: boolean;
  /** Tamanho em bytes; null quando o stat falhou (ex.: sem permissão). */
  size: number | null;
  /** Data de modificação; null quando não medida. */
  mtime: Date | null;
}

const notAvailable = (): never => {
  throw new Error("Filesystem indisponível: o explorador só funciona na app de secretária (Tauri).");
};

// Junta um diretório e um nome num caminho absoluto, tolerando a barra final e
// a raiz ("/"). Puro — exportado para a tela construir caminhos de navegação.
export function joinPath(dir: string, name: string): string {
  if (dir === "/" || dir === "") return `/${name}`;
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

// Caminho do diretório-pai ("/a/b/c" → "/a/b"; "/a" → "/"; "/" → "/"). Puro.
export function parentPath(path: string): string {
  if (path === "/" || path === "") return "/";
  const trimmed = path.replace(/\/+$/, "");
  const i = trimmed.lastIndexOf("/");
  return i <= 0 ? "/" : trimmed.slice(0, i);
}

// Segmentos do caminho para o breadcrumb: [{label, path}], começando na raiz.
export function breadcrumb(path: string): { label: string; path: string }[] {
  const crumbs: { label: string; path: string }[] = [{ label: "/", path: "/" }];
  const parts = path.split("/").filter(Boolean);
  let acc = "";
  for (const p of parts) {
    acc = `${acc}/${p}`;
    crumbs.push({ label: p, path: acc });
  }
  return crumbs;
}

// Diretório HOME do utilizador (pelo backend). Cai em "/" fora do Tauri.
export async function homeDir(): Promise<string> {
  if (!isTauri()) return "/";
  try {
    return (await invoke<string>("dlx_home_dir")) || "/";
  } catch {
    return "/";
  }
}

// Lista um diretório. Cada entrada é enriquecida com size/mtime por um `stat`
// best-effort (uma falha de permissão numa entrada não parte a listagem toda).
export async function readDir(path: string): Promise<FsEntry[]> {
  if (!isTauri()) return notAvailable();
  const { readDir: fsReadDir } = await import("@tauri-apps/plugin-fs");
  const entries = await fsReadDir(path);
  return Promise.all(
    entries.map(async (e) => {
      const full = joinPath(path, e.name);
      let size: number | null = null;
      let mtime: Date | null = null;
      try {
        const info = await stat(full);
        size = info.size;
        mtime = info.mtime;
      } catch {
        /* sem permissão / link partido: deixa size/mtime a null */
      }
      return {
        name: e.name,
        path: full,
        isDir: Boolean(e.isDirectory),
        isFile: Boolean(e.isFile),
        isSymlink: Boolean(e.isSymlink),
        size,
        mtime,
      };
    }),
  );
}

export interface FsStat {
  isDir: boolean;
  isFile: boolean;
  size: number | null;
  mtime: Date | null;
}

export async function stat(path: string): Promise<FsStat> {
  if (!isTauri()) return notAvailable();
  const { stat: fsStat } = await import("@tauri-apps/plugin-fs");
  const info = await fsStat(path);
  const mt = info.mtime as Date | null | undefined;
  return {
    isDir: Boolean(info.isDirectory),
    isFile: Boolean(info.isFile),
    size: typeof info.size === "number" ? info.size : null,
    mtime: mt instanceof Date ? mt : mt ? new Date(mt) : null,
  };
}

export async function exists(path: string): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { exists: fsExists } = await import("@tauri-apps/plugin-fs");
    return await fsExists(path);
  } catch {
    return false;
  }
}

// Limite de pré-visualização: 2 MiB. Acima disto não se lê para a memória do
// renderer (um ficheiro de log gigante travaria a UI).
export const PREVIEW_MAX_BYTES = 2 * 1024 * 1024;

export async function readTextFile(path: string): Promise<string> {
  if (!isTauri()) return notAvailable();
  const { readTextFile: fsReadText } = await import("@tauri-apps/plugin-fs");
  return fsReadText(path);
}

// Grava TEXTO num destino escolhido pelo utilizador no save-dialog nativo. NÃO
// usa o plugin fs (sem permissão de escrita): delega no comando `dlx_save_text`.
// Devolve o caminho gravado, ou null se o utilizador cancelou / não há Tauri.
export async function saveTextViaDialog(
  content: string,
  opts?: { title?: string; defaultPath?: string; filters?: FileFilter[] },
): Promise<string | null> {
  if (!isTauri()) return null;
  const path = await pickSavePath({
    title: opts?.title ?? "Guardar ficheiro",
    defaultPath: opts?.defaultPath,
    filters: opts?.filters ?? YAML_FILTERS,
  });
  if (!path) return null;
  await invoke("dlx_save_text", { path, content });
  return path;
}
