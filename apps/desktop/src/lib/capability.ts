import type { CapabilityLabel } from "./types";

// Os 6 estados do catálogo agrupados em 3 baldes visuais. O motivo exato
// aparece sempre como texto secundário.
export type Bucket = "works" | "limited" | "broken";

export const bucketOf = (s: CapabilityLabel): Bucket =>
  s === "supported" ? "works" : s === "partial" ? "limited" : "broken";

export const bucketLabel: Record<Bucket, string> = {
  works: "Funciona",
  limited: "Com limites",
  broken: "Não funciona",
};

export const bucketChip: Record<Bucket, string> = { works: "ok", limited: "warn", broken: "bad" };

export const reasonLabel: Record<CapabilityLabel, string> = {
  supported: "",
  partial: "implementação parcial",
  "unsupported-by-provider": "não suportado pelo provider",
  "requires-external-component": "requer componente externo",
  "not-implemented": "ainda não implementado",
  "unavailable-on-host": "falta neste host",
};

// Só estes dois o utilizador consegue resolver sozinho.
export const userFixable = (s: CapabilityLabel) =>
  s === "unavailable-on-host" || s === "requires-external-component";
