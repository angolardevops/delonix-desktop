import { describe, expect, it } from "vitest";
import { describeCliError, formatCliError, stripNoise, toCliError } from "./errors";

describe("toCliError — normalizador central de erros do CLI", () => {
  it("extrai DX-4402, filtra o ruído INFO e sugere o registry", () => {
    const stderr = [
      "2026-10-25 INFO pulling ghcr.io/org/private:1",
      "platform selected: linux/amd64",
      "error[DX-4402] no such image ghcr.io/org/private:1",
    ].join("\n");
    const e = toCliError(stderr, 4);
    expect(e.code).toBe("DX-4402");
    expect(e.kind).toBe("not-found");
    expect(e.message).toContain("DX-4402");
    expect(e.message).not.toContain("platform selected");
    expect(e.hint).toMatch(/Registries/i);
  });

  it("classifica DX-4401 como auth", () => {
    const e = toCliError("error[DX-4401] unauthorized: authentication required");
    expect(e.code).toBe("DX-4401");
    expect(e.kind).toBe("auth");
    expect(e.hint).toMatch(/login/i);
  });

  it("classifica falta de espaço em disco", () => {
    const e = toCliError("Error: write /var/lib/delonix: no space left on device");
    expect(e.kind).toBe("disk");
    expect(e.hint).toMatch(/espaço/i);
  });

  it("classifica permissão negada", () => {
    const e = toCliError("error: open /run/delonix.sock: permission denied");
    expect(e.kind).toBe("permission");
  });

  it("classifica 'não encontrado' sem código DX como not-found", () => {
    const e = toCliError("Error: no such container web-123");
    expect(e.code).toBeUndefined();
    expect(e.kind).toBe("not-found");
  });

  it("deteta o marcador de TIMEOUT do backend como classe própria", () => {
    const e = toCliError("DLX_TIMEOUT: `delonix image pull x` excedeu o tempo-limite de 600s e foi terminado.");
    expect(e.kind).toBe("timeout");
    expect(e.message).not.toContain("DLX_TIMEOUT");
    expect(e.message).toContain("excedeu");
    expect(e.hint).toMatch(/tempo-limite/i);
  });

  it("degrada para 'unknown' com o código de saída quando não há sinal", () => {
    const e = toCliError("", 2);
    expect(e.kind).toBe("unknown");
    expect(e.message).toContain("2");
  });

  it("escolhe a última linha útil quando nenhuma linha é claramente de erro", () => {
    const e = toCliError("INFO a arrancar\nalgum aviso qualquer do engine");
    expect(e.message).toBe("algum aviso qualquer do engine");
  });
});

describe("stripNoise / formatação", () => {
  it("remove INFO/DEBUG/TRACE e linhas de progresso, mantém WARN", () => {
    const useful = stripNoise("INFO x\nDEBUG y\npulling z\nWARN cuidado\nerro real");
    expect(useful).toEqual(["WARN cuidado", "erro real"]);
  });

  it("formatCliError junta código + mensagem + hint", () => {
    const s = formatCliError({ code: "DX-4402", kind: "not-found", message: "no such image", hint: "faça login", raw: "" });
    expect(s).toBe("[DX-4402] no such image\n→ faça login");
  });

  it("describeCliError é o atalho stderr→string", () => {
    expect(describeCliError("error[DX-4401] unauthorized")).toContain("DX-4401");
  });
});
