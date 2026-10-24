import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useApp } from "../app/context";
import type { ExecSession } from "../lib/client";

// Um terminal real (xterm.js) ligado a um exec interativo no container via PTY
// no backend. Monta o xterm, subscreve `dlx-exec` através do cliente, escreve
// stdin com `dlx_exec_write` e redimensiona com `addon-fit` → `dlx_exec_resize`.
export function Terminal({ name }: { name: string }) {
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

    const id = `exec-${name}`;
    let session: ExecSession | undefined;
    let disposed = false;

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
        (data) => term.write(data),
        () => term.write("\r\n\x1b[2m[sessão terminada]\x1b[0m\r\n"),
      )
      .then((s) => {
        if (disposed) {
          s.stop();
          return;
        }
        session = s;
        s.resize(term.cols, term.rows);
        term.onData((d) => s.write(d));
        term.focus();
      });

    return () => {
      disposed = true;
      ro.disconnect();
      session?.stop();
      term.dispose();
    };
  }, [client, name]);

  return <div ref={host} style={{ flex: 1, minHeight: 360, padding: 8, background: "#0b0e14" }} />;
}
