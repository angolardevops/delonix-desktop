import { describe, expect, it } from "vitest";
import { baseName, extName, isYamlFile, languageForFile } from "./language";

describe("language — deteção por nome/extensão (puro, sem Monaco)", () => {
  it("baseName tira o diretório e normaliza", () => {
    expect(baseName("/etc/Delonix/Manifest.YAML")).toBe("manifest.yaml");
    expect(baseName("/a/b/")).toBe("b");
    expect(baseName("solo.json")).toBe("solo.json");
  });

  it("extName devolve a extensão sem ponto", () => {
    expect(extName("/x/y/deploy.yaml")).toBe("yaml");
    expect(extName("Makefile")).toBe("");
    expect(extName(".bashrc")).toBe(""); // dotfile puro não tem extensão
  });

  it("YAML/YML por extensão", () => {
    expect(languageForFile("/proj/delonix-manifest.yaml")).toBe("yaml");
    expect(languageForFile("values.yml")).toBe("yaml");
  });

  it("JSON/TOML/INI", () => {
    expect(languageForFile("/etc/app/config.json")).toBe("json");
    expect(languageForFile("Cargo.toml")).toBe("toml");
    expect(languageForFile("app.ini")).toBe("ini");
    expect(languageForFile("nginx.conf")).toBe("ini");
  });

  it("Dockerfile por nome e por sufixo de estágio", () => {
    expect(languageForFile("/srv/Dockerfile")).toBe("dockerfile");
    expect(languageForFile("Dockerfile.dev")).toBe("dockerfile");
    expect(languageForFile("api.dockerfile")).toBe("dockerfile");
    expect(languageForFile("Containerfile")).toBe("dockerfile");
  });

  it("docker-compose e compose são YAML pelo nome", () => {
    expect(languageForFile("docker-compose.yml")).toBe("yaml");
    expect(languageForFile("compose.yaml")).toBe("yaml");
  });

  it("shell / markdown / variados", () => {
    expect(languageForFile("entrypoint.sh")).toBe("shell");
    expect(languageForFile(".env")).toBe("shell");
    expect(languageForFile("README.md")).toBe("markdown");
    expect(languageForFile("main.rs")).toBe("rust");
    expect(languageForFile("main.go")).toBe("go");
    expect(languageForFile("main.tf")).toBe("hcl");
  });

  it("desconhecido cai em plaintext", () => {
    expect(languageForFile("foto.bin")).toBe("plaintext");
    expect(languageForFile("sem_extensao")).toBe("plaintext");
  });

  it("isYamlFile só para YAML (controla Validar/Render/Aplicar)", () => {
    expect(isYamlFile("deploy.yaml")).toBe(true);
    expect(isYamlFile("docker-compose.yml")).toBe(true);
    expect(isYamlFile("config.json")).toBe(false);
    expect(isYamlFile("Dockerfile")).toBe(false);
  });
});
