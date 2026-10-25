import { describe, expect, it } from "vitest";
import { aggregateBand, parseDescribeMembers } from "./network";

// Bloco real de `delonix network describe app` (estilo kubectl): os membros são
// as linhas indentadas sob "Containers:", no formato `nome (shortid) ip`.
const DESCRIBE = `Name:           app
Driver:         bridge
Bridge:         dlxnbb8ff7d9
Subnet:         10.234.0.0/16
Gateway:        10.234.0.1
Prefix:         10.234
Labels:         <none>
Containers:
  web (a1b2c3d4e5f6) 10.234.0.2
  db (0f1e2d3c4b5a) 10.234.0.3
`;

const EMPTY = `Name:           lonely
Driver:         bridge
Subnet:         10.200.0.0/16
Labels:         <none>
Containers:     <none>
`;

describe("parseDescribeMembers", () => {
  it("extrai nome e IP de cada container do bloco Containers", () => {
    const members = parseDescribeMembers(DESCRIBE);
    expect(members).toEqual([
      { name: "web", ip: "10.234.0.2" },
      { name: "db", ip: "10.234.0.3" },
    ]);
  });

  it("devolve vazio quando o bloco é <none> (nenhum membro)", () => {
    expect(parseDescribeMembers(EMPTY)).toEqual([]);
  });

  it("não confunde a secção Labels com membros", () => {
    const withLabels = `Name:  x
Labels:
  delonix.io/managed-by=delonix
Containers:
  web (aaa111bbb222) 10.0.0.2
`;
    expect(parseDescribeMembers(withLabels)).toEqual([{ name: "web", ip: "10.0.0.2" }]);
  });

  it("trata `<no ip>` como IP vazio", () => {
    const noIp = `Name: x
Containers:
  pending (abcdef012345) <no ip>
`;
    expect(parseDescribeMembers(noIp)).toEqual([{ name: "pending", ip: "" }]);
  });
});

describe("aggregateBand", () => {
  const members = [{ name: "web" }, { name: "db" }, { name: "idle" }];

  it("soma as taxas dos membros presentes (null conta como 0 na soma)", () => {
    const rates = new Map([
      ["web", { rx: 100, tx: 10 }],
      ["db", { rx: 50, tx: null }],
    ]);
    expect(aggregateBand(members, rates)).toEqual({ rx: 150, tx: 10 });
  });

  it("devolve null/null quando nenhum membro tem medição", () => {
    expect(aggregateBand(members, new Map())).toEqual({ rx: null, tx: null });
  });
});
