import { describe, expect, it } from "vitest";
import { cmd } from "./cli";

// Construtores de argv tocados na Fase 1-B: namespace nas listas escopadas e o
// `--reveal` do inspect. As classes de risco (cli.rs) não mudam: `secret
// inspect` e `workload/volume ls` continuam Read (prefixo inalterado).
describe("cmd — namespace e secret inspect --reveal", () => {
  it("workload ls só leva -n quando há namespace", () => {
    expect(cmd.workloads()).toEqual(["workload", "ls", "-o", "json"]);
    expect(cmd.workloads("team-a")).toEqual(["workload", "ls", "-n", "team-a", "-o", "json"]);
  });

  it("volume ls só leva -n quando há namespace", () => {
    expect(cmd.volumes()).toEqual(["volume", "ls", "-o", "json"]);
    expect(cmd.volumes("team-a")).toEqual(["volume", "ls", "-n", "team-a", "-o", "json"]);
  });

  it("secret inspect acrescenta --reveal só quando pedido; prefixo intacto", () => {
    expect(cmd.secretInspect("db-pass")).toEqual(["secret", "inspect", "db-pass", "-o", "json"]);
    expect(cmd.secretInspect("db-pass", true)).toEqual(["secret", "inspect", "db-pass", "--reveal", "-o", "json"]);
    // O prefixo ["secret","inspect"] (classe Read em cli.rs) é o mesmo com ou
    // sem --reveal — a classificação de risco não muda.
    expect(cmd.secretInspect("db-pass", true).slice(0, 2)).toEqual(["secret", "inspect"]);
  });
});
