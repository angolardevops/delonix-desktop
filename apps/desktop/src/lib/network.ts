// Funções PURAS da tela de Redes (§8.6) — sem Tauri, testáveis em isolamento.
//
// Duas responsabilidades:
//  1. Parsear o bloco "Containers:" de `network describe` (texto estilo
//     kubectl) nos membros COM IP — a única fonte por membro (o `-o json` de
//     `ls`/`inspect` não traz IP por membro).
//  2. Agregar a banda (Ingress/Egress) de uma rede a partir das taxas por
//     workload (bytes/s), somando os membros presentes.
import type { NetworkMember } from "./types";

// Extrai os membros do bloco "Containers:" de `network describe`. Cada item
// indentado é `nome (shortid) ip` — ex.: `web (a1b2c3d4e5f6) 10.234.0.2`. O
// bloco pode vir inline sem membros (`Containers:    <none>`/`<unknown>…`).
// Tolerante: ignora linhas que não casem o padrão; o `<no ip>` vira "".
export function parseDescribeMembers(stdout: string): NetworkMember[] {
  const out: NetworkMember[] = [];
  let inContainers = false;
  for (const raw of stdout.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (/^Containers:/.test(line)) {
      inContainers = true;
      continue;
    }
    if (!inContainers) continue;
    // Linha sem indentação encerra o bloco (a secção seguinte / novo registo).
    if (!/^\s+\S/.test(line)) {
      if (line.trim().length === 0) continue;
      inContainers = false;
      continue;
    }
    const m = /^\s+(\S+)\s+\([^)]*\)\s+(.+)$/.exec(line);
    if (!m) continue;
    const ip = m[2].trim();
    out.push({ name: m[1], ip: ip.startsWith("<") ? "" : ip });
  }
  return out;
}

// Taxa de rede (bytes/s) de UM workload: ingress (rx) e egress (tx). null = não
// medido (mantém distinto de 0 — ver lib/metrics.ts).
export interface NetBand {
  rx: number | null;
  tx: number | null;
}

// Banda AGREGADA de uma rede: soma as taxas dos membros presentes em `rateByName`.
// Se nenhum membro tiver medição, devolve {rx:null, tx:null} (não inventa 0); se
// pelo menos um tiver, soma os conhecidos (os null contam como 0 nessa soma).
export function aggregateBand(members: { name: string }[], rateByName: Map<string, NetBand>): NetBand {
  let rx: number | null = null;
  let tx: number | null = null;
  for (const m of members) {
    const b = rateByName.get(m.name);
    if (!b) continue;
    if (b.rx != null) rx = (rx ?? 0) + b.rx;
    if (b.tx != null) tx = (tx ?? 0) + b.tx;
  }
  return { rx, tx };
}
