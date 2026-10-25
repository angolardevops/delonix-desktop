import { describe, expect, it } from "vitest";
import { decodeAuthUser, imageHost, parseAuthJson } from "./registries";

// base64("angolardevops:gho_segredoabc") — a parte da password NUNCA deve sair.
const AUTH_B64 = btoa("angolardevops:gho_segredoabc");

describe("decodeAuthUser", () => {
  it("extrai só o utilizador (antes do ':'), nunca a password", () => {
    expect(decodeAuthUser(AUTH_B64)).toBe("angolardevops");
    expect(decodeAuthUser(AUTH_B64)).not.toContain("gho_");
    expect(decodeAuthUser(AUTH_B64)).not.toContain(":");
  });
  it("tolera valores em falta ou inválidos", () => {
    expect(decodeAuthUser(undefined)).toBe("");
    expect(decodeAuthUser("")).toBe("");
    expect(decodeAuthUser(123)).toBe("");
  });
});

describe("parseAuthJson", () => {
  it("lê o formato docker/podman e decodifica o utilizador do base64", () => {
    const text = JSON.stringify({ auths: { "ghcr.io": { auth: AUTH_B64 } } });
    expect(parseAuthJson(text)).toEqual([
      { registry: "ghcr.io", username: "angolardevops", hasCredential: true },
    ]);
  });
  it("prefere o campo `username` explícito quando existe", () => {
    const text = JSON.stringify({ auths: { "docker.io": { username: "walter", auth: AUTH_B64 } } });
    expect(parseAuthJson(text)[0].username).toBe("walter");
  });
  it("ordena por host e aceita várias entradas", () => {
    const text = JSON.stringify({
      auths: { "quay.io": { auth: AUTH_B64 }, "ghcr.io": { auth: AUTH_B64 } },
    });
    expect(parseAuthJson(text).map((r) => r.registry)).toEqual(["ghcr.io", "quay.io"]);
  });
  it("marca entradas só com identitytoken como tendo credencial", () => {
    const text = JSON.stringify({ auths: { "ghcr.io": { identitytoken: "tok" } } });
    const r = parseAuthJson(text)[0];
    expect(r.hasCredential).toBe(true);
    expect(r.username).toBe("");
  });
  it("devolve lista vazia para JSON inválido ou sem `auths`", () => {
    expect(parseAuthJson("não é json")).toEqual([]);
    expect(parseAuthJson("{}")).toEqual([]);
    expect(parseAuthJson(JSON.stringify({ auths: null }))).toEqual([]);
  });
  it("nunca inclui a password no resultado serializado", () => {
    const text = JSON.stringify({ auths: { "ghcr.io": { auth: AUTH_B64 } } });
    expect(JSON.stringify(parseAuthJson(text))).not.toContain("gho_");
  });
});

describe("imageHost", () => {
  it("usa o primeiro segmento como host quando tem ponto/porta/localhost", () => {
    expect(imageHost("ghcr.io/org/app:tag")).toBe("ghcr.io");
    expect(imageHost("localhost:5000/app")).toBe("localhost:5000");
    expect(imageHost("registry.example.com:443/a/b")).toBe("registry.example.com:443");
  });
  it("trata as referências sem host como Docker Hub", () => {
    expect(imageHost("postgres:16")).toBe("docker.io");
    expect(imageHost("firecracker/ci:24.04")).toBe("docker.io");
    expect(imageHost("library/nginx")).toBe("docker.io");
  });
});
