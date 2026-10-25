import { describe, expect, it } from "vitest";
import { breadcrumb, joinPath, parentPath } from "./fsx";

describe("joinPath", () => {
  it("junta na raiz sem barra dupla", () => {
    expect(joinPath("/", "etc")).toBe("/etc");
    expect(joinPath("", "etc")).toBe("/etc");
  });
  it("junta num diretório normal", () => {
    expect(joinPath("/home/walter", "delonix.yaml")).toBe("/home/walter/delonix.yaml");
  });
  it("tolera a barra final", () => {
    expect(joinPath("/home/walter/", "a")).toBe("/home/walter/a");
  });
});

describe("parentPath", () => {
  it("sobe um nível", () => {
    expect(parentPath("/a/b/c")).toBe("/a/b");
    expect(parentPath("/a/b/c/")).toBe("/a/b");
  });
  it("de um filho da raiz volta à raiz", () => {
    expect(parentPath("/a")).toBe("/");
  });
  it("a raiz é o seu próprio pai", () => {
    expect(parentPath("/")).toBe("/");
    expect(parentPath("")).toBe("/");
  });
});

describe("breadcrumb", () => {
  it("começa sempre na raiz", () => {
    expect(breadcrumb("/")).toEqual([{ label: "/", path: "/" }]);
  });
  it("acumula os segmentos", () => {
    expect(breadcrumb("/home/walter")).toEqual([
      { label: "/", path: "/" },
      { label: "home", path: "/home" },
      { label: "walter", path: "/home/walter" },
    ]);
  });
});
