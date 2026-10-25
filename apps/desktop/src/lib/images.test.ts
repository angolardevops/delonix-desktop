import { describe, expect, it } from "vitest";
import { crossRefUsedBy, extractPullError, parseImages, preferredRef, shortTag, toImageRow } from "./images";
import type { WorkloadRow } from "./types";

// `now` fixo para a data/relativo serem determinísticos (2026-10-25T12:00:00Z).
const NOW = 1792972800_000;

describe("contrato real de `image ls -o json` (5.1.1)", () => {
  it("prefere a tag curta (sem docker.io/library/) e deduplica tags", () => {
    const row = toImageRow(
      { repo_tags: ["docker.io/library/alpine:3.20", "alpine:3.20"], id: "sha256:bf8527eb54c3680e728d5b4b383a8ba730d72dae7236fbc8dff97ed6b224a731", created_unix: 1792935240, size_bytes: 3630321, orphan: true },
      NOW,
    );
    expect(row.ref).toBe("alpine:3.20");
    expect(row.tags).toEqual(["alpine:3.20"]);
    expect(row.id).toBe("bf8527eb54c3"); // sha256: removido + 12 chars
    expect(row.orphan).toBe(true);
    expect(row.usedBy).toEqual([]);
  });

  it("humaniza size_bytes em unidades binárias", () => {
    expect(toImageRow({ repo_tags: ["busybox:latest"], size_bytes: 2226163 }, NOW).size).toBe("2,1 MiB");
    expect(toImageRow({ repo_tags: ["redis:7-alpine"], size_bytes: 16241702 }, NOW).size).toBe("15 MiB");
  });

  it("mantém múltiplas tags curtas distintas", () => {
    const row = toImageRow({ repo_tags: ["redis:7-alpine", "redis:7.4-alpine"], size_bytes: 10 }, NOW);
    expect(row.tags).toEqual(["redis:7-alpine", "redis:7.4-alpine"]);
    expect(row.ref).toBe("redis:7-alpine");
  });

  it("imagem sem repo_tags fica <none>:<none> com o id", () => {
    const row = toImageRow({ repo_tags: [], id: "sha256:aaef90e065235eb0", size_bytes: 1, orphan: true }, NOW);
    expect(row.ref).toBe("<none>:<none>");
    expect(row.id).toBe("aaef90e06523");
    expect(row.tags).toEqual([]);
  });

  it("created deriva de created_unix (data curta + relativo)", () => {
    const row = toImageRow({ repo_tags: ["x:1"], created_unix: NOW / 1000 - 3 * 86400 }, NOW);
    expect(row.created).toContain("há 3 dias");
  });

  it("parseImages tolera não-array", () => {
    expect(parseImages(null)).toEqual([]);
    expect(parseImages({})).toEqual([]);
    expect(parseImages([{ repo_tags: ["a:1"], size_bytes: 1 }]).length).toBe(1);
  });
});

describe("helpers de referência", () => {
  it("shortTag remove o prefixo docker.io", () => {
    expect(shortTag("docker.io/library/alpine:3.20")).toBe("alpine:3.20");
    expect(shortTag("docker.io/angolardevops/x:1")).toBe("angolardevops/x:1");
    expect(shortTag("ghcr.io/org/app:1")).toBe("ghcr.io/org/app:1");
  });
  it("preferredRef escolhe a forma não-docker.io", () => {
    expect(preferredRef(["docker.io/library/alpine:3.20", "alpine:3.20"])).toBe("alpine:3.20");
    expect(preferredRef(["docker.io/library/alpine:3.20"])).toBe("alpine:3.20");
    expect(preferredRef([])).toBe("");
  });
});

describe("cruzamento com workloads (usedBy)", () => {
  it("liga os workloads que correm a imagem por ref/tag", () => {
    const imgs = parseImages([{ repo_tags: ["postgres:16"], id: "sha256:b1a0c8e9f2d3aa", size_bytes: 1, orphan: false }], NOW);
    const wl: WorkloadRow[] = [
      { type: "container", name: "postgres-dev", status: "Up 3m", info: "postgres:16", namespace: "default" },
      { type: "container", name: "web", status: "Up", info: "nginx:1.27", namespace: "default" },
    ];
    expect(crossRefUsedBy(imgs, wl)[0].usedBy).toEqual(["postgres-dev"]);
  });
});

describe("erro acionável de pull", () => {
  it("filtra INFO e sugere login em DX-4402 / no such image", () => {
    const lines = [
      "2026-10-25 INFO pulling ghcr.io/org/private:1",
      "platform selected: linux/amd64",
      "error[DX-4402] no such image ghcr.io/org/private:1 (delonix image login)",
    ];
    const msg = extractPullError(lines);
    expect(msg).toContain("DX-4402");
    expect(msg).not.toContain("platform selected");
    expect(msg).toMatch(/login no registry|Registries/i);
  });
});
