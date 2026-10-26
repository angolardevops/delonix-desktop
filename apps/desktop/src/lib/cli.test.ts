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

// `container run --log-cri` grava o log no formato CRI (ver cli.ts). É o que
// torna `container logs --timestamps` possível; a UI liga-o por omissão.
describe("cmd.run — --log-cri", () => {
  const base = { name: "db", image: "postgres:16", ports: [], env: [], volumes: [] };

  it("acrescenta --log-cri (antes da imagem) quando logCri=true", () => {
    const argv = cmd.run({ ...base, logCri: true });
    expect(argv).toContain("--log-cri");
    // A flag vem ANTES do argumento posicional da imagem.
    expect(argv.indexOf("--log-cri")).toBeLessThan(argv.indexOf("postgres:16"));
    expect(argv[argv.length - 1]).toBe("postgres:16");
  });

  it("omite --log-cri quando logCri=false ou ausente", () => {
    expect(cmd.run({ ...base, logCri: false })).not.toContain("--log-cri");
    expect(cmd.run(base)).not.toContain("--log-cri");
  });
});
