// Stream longo COM reconexão (§3/§4). Extraído do padrão que a tela de Logs já
// usava em linha (re-provar o `-f` ao fim) para ser PARTILHADO pelos vários
// fluxos longos (logs de container/pod, eventos de lifecycle) — DRY.
//
// Um fluxo `-f` do engine daemonless termina quando o processo acaba (o
// container parou, o engine caiu, a ligação do socket de eventos fechou). Este
// orquestrador religa automaticamente com BACKOFF e sinaliza a interrupção à UI,
// sem a tela ter de reimplementar timers/cancelamento. É PURO (sem React):
// recebe um `start` que devolve a função de corte, igual ao `DelonixClient.stream`.

export type StreamStatus = "streaming" | "interrupted";

export interface ReconnectingStreamOpts {
  // Arranca uma ligação. Recebe o callback de linha e o de fim-do-processo, e
  // devolve a função que corta ESTA ligação (igual a `client.stream(...)`).
  start: (onLine: (line: string) => void, onEnd: () => void) => Promise<() => void>;
  // Cada linha recebida (de qualquer ligação). Receber linhas repõe o backoff.
  onLine: (line: string) => void;
  // Transição de estado para a UI (a seguir / interrompido — a reconectar).
  onStatus?: (status: StreamStatus) => void;
  // Atraso base da reconexão (ms). Dobra a cada tentativa seguida sem dados,
  // até `maxBackoffMs`. Default 4000 (o valor que a tela de Logs já usava).
  backoffMs?: number;
  maxBackoffMs?: number;
}

// Arranca o fluxo com reconexão. Devolve uma função para PARAR de vez (corta a
// ligação viva e cancela qualquer reconexão agendada). Idempotente.
export function reconnectingStream(opts: ReconnectingStreamOpts): () => void {
  const base = opts.backoffMs ?? 4000;
  const max = opts.maxBackoffMs ?? 30000;
  let cancelled = false;
  let unsub: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;

  const onLine = (line: string) => {
    attempt = 0; // receber dados = ligação saudável → repõe o backoff
    opts.onLine(line);
  };

  const connect = () => {
    if (cancelled) return;
    opts.onStatus?.("streaming");
    void opts
      .start(onLine, () => {
        if (cancelled) return;
        opts.onStatus?.("interrupted");
        const delay = Math.min(base * 2 ** attempt, max);
        attempt += 1;
        timer = setTimeout(connect, delay);
      })
      .then((stop) => {
        // Se já foi cancelado enquanto arrancava, corta já esta ligação.
        if (cancelled) stop();
        else unsub = stop;
      })
      .catch(() => {
        // Falha a ARRANCAR (ex.: backend indisponível): trata como interrupção
        // e volta a tentar com backoff, em vez de morrer silenciosamente.
        if (cancelled) return;
        opts.onStatus?.("interrupted");
        const delay = Math.min(base * 2 ** attempt, max);
        attempt += 1;
        timer = setTimeout(connect, delay);
      });
  };

  connect();

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    unsub?.();
  };
}
