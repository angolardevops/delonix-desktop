// Formatadores PUROS (sem DOM nem Tauri) partilhados pela UI. Vivem à parte do
// tauriClient para serem testáveis em Node (vitest) e reutilizáveis por ecrãs.
// Datas em pt-AO; bytes em unidades BINÁRIAS (KiB/MiB/GiB) — ver fmtBinBytes.

// Formata um instante unix (segundos) numa data+hora local curta; "" se não
// medido. NB: `timeStyle: "short"` perde os segundos — para correlação ao
// segundo usa-se o próprio epoch (campo numérico), não esta string.
export const fmtUnix = (secs: number | null | undefined): string => {
  if (secs == null || !Number.isFinite(secs)) return "";
  return new Date(secs * 1000).toLocaleString("pt-AO", { dateStyle: "short", timeStyle: "short" });
};

// Só a hora local (HH:MM:SS) de um epoch em segundos; "" se não medido. Mantém
// os segundos — útil no log de eventos, onde a correlação é ao segundo.
export const fmtClockUnix = (secs: number | null | undefined): string => {
  if (secs == null || !Number.isFinite(secs)) return "";
  return new Date(secs * 1000).toLocaleTimeString("pt-AO", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

// Tempo relativo em pt-AO a partir de um epoch em segundos ("há 3 dias",
// "daqui a 2 horas", "há instantes"). `nowMs` é injetável para testes.
export const fmtRelative = (secs: number | null | undefined, nowMs: number = Date.now()): string => {
  if (secs == null || !Number.isFinite(secs)) return "";
  const diff = Math.round(nowMs / 1000 - secs); // >0 = passado, <0 = futuro
  const abs = Math.abs(diff);
  if (abs < 60) return "há instantes";
  const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;
  let out: string;
  if (abs < 3600) out = plural(Math.floor(abs / 60), "minuto", "minutos");
  else if (abs < 86400) out = plural(Math.floor(abs / 3600), "hora", "horas");
  else if (abs < 604800) out = plural(Math.floor(abs / 86400), "dia", "dias");
  else if (abs < 2592000) out = plural(Math.floor(abs / 604800), "semana", "semanas");
  else if (abs < 31536000) out = plural(Math.floor(abs / 2592000), "mês", "meses");
  else out = plural(Math.floor(abs / 31536000), "ano", "anos");
  return diff < 0 ? `daqui a ${out}` : `há ${out}`;
};

// Data de criação de uma imagem: data curta + relativo ("25/10/26 · há 3 dias").
// "" se não medida. `nowMs` injetável para testes.
export const fmtCreated = (secs: number | null | undefined, nowMs: number = Date.now()): string => {
  if (secs == null || !Number.isFinite(secs)) return "";
  const date = new Date(secs * 1000).toLocaleDateString("pt-AO", { dateStyle: "short" });
  return `${date} · ${fmtRelative(secs, nowMs)}`;
};

// Humaniza bytes em unidades BINÁRIAS (1024): "3,5 MiB", "16,2 MiB", "0 B".
// Separador decimal em vírgula (pt-AO). null/NaN → "—". (Mesma convenção que
// metrics.fmtBinBytes; duplicada aqui para evitar um import circular leve.)
const BIN_UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
export const humanBytes = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return "—";
  let v = n;
  let i = 0;
  while (Math.abs(v) >= 1024 && i < BIN_UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0).replace(".", ",")} ${BIN_UNITS[i]}`;
};
