import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useApp } from "../app/context";
import type { ExecMode, ExecSession } from "../lib/client";

// Id único por MONTAGEM (não por nome): o StrictMode do React monta/desmonta/
// remonta em dev, e com um id partilhado (`exec-<nome>`) as duas sessões do
// backend matavam-se uma à outra (map.insert por id) → "[sessão terminada]".
let execSeq = 0;

// Mensagem de fim HONESTA por modo: um attach/console que termina NÃO é um erro
// de shell, e sair de um shell exec não afeta o workload. Quando a sessão fecha
// sem ter recebido um único byte, é quase sempre um recurso parado/sem TTY/sem
// shell — damos uma pista acionável em vez de "[sessão terminada]" seco.
function endMessage(mode: ExecMode, gotData: boolean): string {
  if (!gotData) {
    switch (mode) {
      case "container-attach":
        return "[sem saída — o processo principal ainda não escreveu nada, ou o container está parado]";
      case "vm-console":
        return "[consola série fechada sem saída — a VM pode estar parada ou sem porta série]";
      case "pod-exec":
        return "[a sessão fechou de imediato — o pod pode estar parado ou o membro não ter `sh`]";
      default:
        return "[a sessão fechou de imediato — o container pode estar parado ou a imagem não ter shell]";
    }
  }
  switch (mode) {
    case "container-attach":
      return "[attach terminado — isto fecha só a ligação de saída; o workload continua a correr]";
    case "vm-console":
      return "[consola série desligada (Ctrl-D) — a VM continua a correr]";
    case "pod-exec":
      return "[shell do pod terminado]";
    default:
      return "[shell terminado — o container não é afetado]";
  }
}

// Um terminal real (xterm.js) ligado a uma sessão interativa por PTY no backend,
// consoante o `mode` (§6): shell novo (container exec), attach ao processo
// principal (só saída), shell num membro de pod (pod exec) ou consola série de
// VM (vm console). Monta o xterm, subscreve `dlx-exec`, escreve stdin com
// `dlx_exec_write` (no-op útil no attach, que é só saída) e redimensiona com
// `addon-fit` → `dlx_exec_resize`.
export function Terminal({ name, mode = "container-exec" }: { name: string; mode?: ExecMode }) {
  const { client } = useApp();
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const term = new XTerm({
      fontFamily: "var(--mono, 'JetBrains Mono', monospace)",
      fontSize: 13,
      cursorBlink: true,
      convertEol: false,
      theme: { background: "#0b0e14", foreground: "#d4d7dd" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    const id = `exec-${mode}-${name}-${++execSeq}`;
    let session: ExecSession | undefined;
    let disposed = false;
    let gotData = false;

    const onResize = () => {
      try {
        fit.fit();
        session?.resize(term.cols, term.rows);
      } catch {
        /* o elemento pode já não estar no DOM */
      }
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(el);

    void client
      .exec(
        id,
        name,
        mode,
        (data) => {
          gotData = true;
          term.write(data);
        },
        () => term.write(`\r\n\x1b[2m${endMessage(mode, gotData)}\x1b[0m\r\n`),
      )
      .then((s) => {
        if (disposed) {
          s.stop();
          return;
        }
        session = s;
        s.resize(term.cols, term.rows);
        // O attach e a consola série são OUTPUT-ONLY no engine; ainda assim
        // encaminhamos o stdin (é inofensivo — o engine ignora/recusa) para que
        // o Ctrl-D da consola série chegue ao processo e o detach funcione.
        term.onData((d) => s.write(d));
        term.focus();
      });

    return () => {
      disposed = true;
      ro.disconnect();
      session?.stop();
      term.dispose();
    };
  }, [client, name, mode]);

  return <div ref={host} style={{ flex: 1, minHeight: 360, padding: 8, background: "#0b0e14" }} />;
}
