// Camada de integração nativa com o SO (eixo A). Abstrai os plugins oficiais do
// Tauri 2.x (notificação, diálogo de ficheiros, clipboard) num punhado de
// funções com FALLBACK GRACIOSO para quando a app corre fora do Tauri (dev no
// browser): aí não há notificações nem diálogos nativos, mas o clipboard cai no
// `navigator.clipboard` e nada rebenta. Os imports dos plugins são dinâmicos
// para o bundle do browser não tentar resolver IPC inexistente.
import { isTauri } from "./client";

// Os diálogos de ficheiro só existem sob Tauri; as telas usam isto para decidir
// se mostram o botão "Procurar…".
export const nativeDialogsAvailable = (): boolean => isTauri();

// --- Notificações do SO -----------------------------------------------------
// A permissão pede-se UMA vez (memoizada): o SO só mostra o pedido ao utilizador
// no primeiro evento crítico, não a cada notificação.
let permissionProbe: Promise<boolean> | null = null;

async function ensureNotifyPermission(): Promise<boolean> {
  if (permissionProbe) return permissionProbe;
  permissionProbe = (async () => {
    try {
      if (isTauri()) {
        const { isPermissionGranted, requestPermission } = await import("@tauri-apps/plugin-notification");
        if (await isPermissionGranted()) return true;
        return (await requestPermission()) === "granted";
      }
      // Fallback browser (dev): Notification API, se existir e for concedida.
      if (typeof Notification !== "undefined") {
        if (Notification.permission === "granted") return true;
        if (Notification.permission !== "denied") return (await Notification.requestPermission()) === "granted";
      }
    } catch {
      /* best-effort: sem permissão, não notificamos */
    }
    return false;
  })();
  return permissionProbe;
}

export async function notify(title: string, body?: string): Promise<void> {
  try {
    if (!(await ensureNotifyPermission())) return;
    if (isTauri()) {
      const { sendNotification } = await import("@tauri-apps/plugin-notification");
      sendNotification({ title, body });
    } else if (typeof Notification !== "undefined") {
      new Notification(title, { body });
    }
  } catch {
    /* uma notificação falhada nunca deve partir a app */
  }
}

// --- Diálogo de ficheiros NATIVO --------------------------------------------
export interface FileFilter {
  name: string;
  extensions: string[];
}

// Devolve o caminho escolhido, ou null se o utilizador cancelou / não há Tauri.
export async function pickFile(opts?: { title?: string; filters?: FileFilter[] }): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const sel = await open({ multiple: false, directory: false, title: opts?.title, filters: opts?.filters });
    return typeof sel === "string" ? sel : null;
  } catch {
    return null;
  }
}

export async function pickDirectory(opts?: { title?: string }): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const sel = await open({ multiple: false, directory: true, title: opts?.title });
    return typeof sel === "string" ? sel : null;
  } catch {
    return null;
  }
}

// Filtros reutilizáveis para os caminhos que a app pede.
export const YAML_FILTERS: FileFilter[] = [
  { name: "Manifesto / Compose (YAML)", extensions: ["yaml", "yml"] },
  { name: "Todos os ficheiros", extensions: ["*"] },
];

// --- Clipboard do SO --------------------------------------------------------
// Copia texto pelo clipboard nativo; cai no `navigator.clipboard` fora do Tauri.
// Devolve true se copiou (para a UI dar feedback "Copiado").
export async function copyText(text: string): Promise<boolean> {
  try {
    if (isTauri()) {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
      return true;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fallthrough */
  }
  return false;
}

// --- Caixa "Sobre" ----------------------------------------------------------
// Usa o diálogo de mensagem nativo sob Tauri; alert do browser em dev.
export async function aboutDialog(message: string, title = "Sobre"): Promise<void> {
  try {
    if (isTauri()) {
      const { message: messageDialog } = await import("@tauri-apps/plugin-dialog");
      await messageDialog(message, { title, kind: "info" });
    } else if (typeof alert === "function") {
      alert(`${title}\n\n${message}`);
    }
  } catch {
    /* best-effort */
  }
}
