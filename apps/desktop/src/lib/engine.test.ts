import { describe, expect, it } from "vitest";
import { buildEngineInfo, isCompatible, parseEngineVersion } from "./engine";

describe("engine — descoberta de versão", () => {
  it("extrai a versão semver de uma linha de texto", () => {
    expect(parseEngineVersion("delonix 5.1.1 (abc1234)")).toBe("5.1.1");
    expect(parseEngineVersion("Delonix Engine v5.1.1-rc2")).toBe("5.1.1-rc2");
    expect(parseEngineVersion("sem versão aqui")).toBe("");
    expect(parseEngineVersion("")).toBe("");
  });

  it("compatibilidade: dentro da família 5.1.x é compatível", () => {
    expect(isCompatible("5.1.1")).toBe(true);
    expect(isCompatible("5.1.9")).toBe(true);
    expect(isCompatible("5.1")).toBe(true);
  });

  it("compatibilidade: fora da família sinaliza incompatível", () => {
    expect(isCompatible("5.2.0")).toBe(false);
    expect(isCompatible("6.0.0")).toBe(false);
    expect(isCompatible("5.0.2")).toBe(false);
  });

  it("versão desconhecida NÃO alarma (compatível)", () => {
    expect(isCompatible("")).toBe(true);
  });

  it("buildEngineInfo monta o objeto tipado", () => {
    const info = buildEngineInfo("delonix 5.1.1 (abc)\noutra linha", 72);
    expect(info.version).toBe("5.1.1");
    expect(info.compatible).toBe(true);
    expect(info.capabilities).toBe(72);
    expect(info.expected).toBe("5.1");
    expect(info.raw).toBe("delonix 5.1.1 (abc)");

    const bad = buildEngineInfo("delonix 6.0.0", 0);
    expect(bad.compatible).toBe(false);
  });
});
