import { describe, expect, it } from "vitest";
import { cmd, k8sVersionImage, K8S_VERSION_CUSTOM, K8S_VERSION_DEFAULT, K8S_VERSIONS } from "./cli";

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

// Versão do Kubernetes no "Criar cluster" (§6): lista de opções + mapeamento
// da escolha para `--image kindest/node:<tag>`.
describe("cmd.clusterCreate — versão do Kubernetes (--image)", () => {
  it("a lista oferece o default do engine, a 1.34.x (mínima) e um valor livre", () => {
    const values = K8S_VERSIONS.map((v) => v.value);
    expect(values[0]).toBe(K8S_VERSION_DEFAULT); // 1.ª opção = default do engine
    expect(values).toContain("v1.34.0"); // mínima suportada (decisão do dono)
    expect(values).toContain(K8S_VERSION_CUSTOM); // valor livre
    // Não há tags abaixo de 1.34.
    expect(values.some((v) => /^v1\.3[0-3]\./.test(v))).toBe(false);
  });

  it("k8sVersionImage mapeia a escolha para kindest/node:<tag>", () => {
    expect(k8sVersionImage(K8S_VERSION_DEFAULT)).toBeUndefined(); // default → sem --image
    expect(k8sVersionImage("")).toBeUndefined();
    expect(k8sVersionImage("v1.34.0")).toBe("kindest/node:v1.34.0");
    expect(k8sVersionImage("v1.36.0")).toBe("kindest/node:v1.36.0");
  });

  it("custom: tag nua vira kindest/node:<tag>; referência com / passa tal e qual", () => {
    expect(k8sVersionImage(K8S_VERSION_CUSTOM, "v1.33.5")).toBe("kindest/node:v1.33.5");
    expect(k8sVersionImage(K8S_VERSION_CUSTOM, "myreg.io/node:x")).toBe("myreg.io/node:x");
    expect(k8sVersionImage(K8S_VERSION_CUSTOM, "  ")).toBeUndefined(); // vazio → sem --image
    expect(k8sVersionImage(K8S_VERSION_CUSTOM)).toBeUndefined();
  });

  it("clusterCreate só emite --image quando a imagem é definida", () => {
    expect(cmd.clusterCreate({})).not.toContain("--image");
    const withImg = cmd.clusterCreate({ image: k8sVersionImage("v1.35.0") });
    expect(withImg).toContain("--image");
    expect(withImg[withImg.indexOf("--image") + 1]).toBe("kindest/node:v1.35.0");
  });
});
