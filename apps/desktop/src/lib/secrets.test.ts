import { describe, expect, it } from "vitest";
import { parseSecretInspect } from "./secrets";

// Contrato REAL do engine 5.1.1 (medido ao vivo): `secret inspect [--reveal]
// -o json` devolve um ARRAY com um elemento {name, keys[], data{}, revealed}.
describe("parseSecretInspect (secret inspect --reveal)", () => {
  it("revelado: extrai o mapa chave→valor EM CLARO e revealed=true", () => {
    const raw = [
      { name: "db-pass", keys: ["PASSWORD"], data: { PASSWORD: "super-secreto-123" }, revealed: true },
    ];
    expect(parseSecretInspect(raw)).toEqual({ keys: { PASSWORD: "super-secreto-123" }, revealed: true });
  });

  it("sem reveal: mantém a máscara do engine e revealed=false", () => {
    const raw = [{ name: "db-pass", keys: ["PASSWORD"], data: { PASSWORD: "••••••" }, revealed: false }];
    expect(parseSecretInspect(raw)).toEqual({ keys: { PASSWORD: "••••••" }, revealed: false });
  });

  it("vários pares e campo revealed em falta → false", () => {
    const raw = [{ name: "minio", keys: ["U", "P"], data: { U: "root", P: "pw" } }];
    expect(parseSecretInspect(raw)).toEqual({ keys: { U: "root", P: "pw" }, revealed: false });
  });

  it("tolera objeto solto (não-array) e entrada vazia", () => {
    expect(parseSecretInspect({ data: { K: "v" }, revealed: true })).toEqual({ keys: { K: "v" }, revealed: true });
    expect(parseSecretInspect([])).toEqual({ keys: {}, revealed: false });
    expect(parseSecretInspect(null)).toEqual({ keys: {}, revealed: false });
  });
});
