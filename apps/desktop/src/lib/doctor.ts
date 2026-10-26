import type { DoctorItem } from "./types";

// `delonix system doctor` não tem saída JSON (confirmado contra o engine 5.1.1):
// é texto com duas partes — pré-requisitos marcados com ✓/✗ e uma secção
// «resources» com códigos DLX-RES-NNN. Cada item pode trazer uma linha de
// correção começada por «→». Este parser tolera espaçamento variável e é a
// fonte do bloco "Como resolver" na tela Capacidades.

const CHECK = /^\s*([✓✗x✔×!])\s+(ok|warn|fail|erro|error)?\s*(.+?)\s*$/i;
const RES = /^\s*(DLX-[A-Z]+-\d+)\s+(\S+)\s+(.+?)\s*$/;
const FIX = /^\s*→\s*(.+?)\s*$/;

const statusOf = (sym: string): DoctorItem["status"] =>
  sym === "✓" || sym === "✔" ? "ok" : sym === "!" ? "warn" : "fail";

export function parseDoctor(text: string): DoctorItem[] {
  const items: DoctorItem[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;

    const fix = FIX.exec(line);
    if (fix && items.length) {
      const cmd = fix[1];
      items[items.length - 1].fix = cmd;
      items[items.length - 1].needsSudo = /\bsudo\b/.test(cmd);
      continue;
    }

    const res = RES.exec(line);
    if (res) {
      items.push({ status: "warn", code: res[1], title: res[2], detail: res[3], needsSudo: false });
      continue;
    }

    const chk = CHECK.exec(line);
    if (chk) {
      items.push({ status: statusOf(chk[1]), title: chk[3], detail: "", needsSudo: false });
      continue;
    }

    // Linha indentada sem marcador: é o detalhe do item anterior.
    if (/^\s{2,}\S/.test(raw) && items.length && !items[items.length - 1].detail) {
      items[items.length - 1].detail = line.trim();
    }
  }
  return items;
}

// As accionáveis são as que trazem um comando de correção.
export const fixableItems = (items: DoctorItem[]) => items.filter((i) => i.fix);
