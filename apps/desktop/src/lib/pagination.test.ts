import { describe, expect, it } from "vitest";
import { orderBy, paginate, PAGE_SIZE } from "./pagination";

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("paginate", () => {
  it("lista vazia: 1 página, sem itens", () => {
    const r = paginate([], 1);
    expect(r.items).toEqual([]);
    expect(r.total).toBe(0);
    expect(r.pages).toBe(1);
    expect(r.page).toBe(1);
  });

  it("1 item: 1 página", () => {
    const r = paginate(range(1), 1);
    expect(r.items).toEqual([1]);
    expect(r.total).toBe(1);
    expect(r.pages).toBe(1);
  });

  it("exatamente 10 itens: 1 página cheia", () => {
    const r = paginate(range(10), 1);
    expect(r.items).toHaveLength(10);
    expect(r.pages).toBe(1);
    expect(r.items[9]).toBe(10);
  });

  it("11 itens: 2 páginas; a 2ª tem 1 item (última incompleta)", () => {
    const first = paginate(range(11), 1);
    expect(first.items).toHaveLength(10);
    expect(first.pages).toBe(2);
    const second = paginate(range(11), 2);
    expect(second.items).toEqual([11]);
    expect(second.page).toBe(2);
    expect(second.start).toBe(10);
  });

  it("navegação entre várias páginas mantém os limites corretos", () => {
    const items = range(25); // 3 páginas: 10/10/5
    expect(paginate(items, 1).items).toEqual(range(10));
    expect(paginate(items, 2).items).toEqual(range(20).slice(10));
    const last = paginate(items, 3);
    expect(last.items).toEqual([21, 22, 23, 24, 25]);
    expect(last.pages).toBe(3);
  });

  it("satura (clamp) a página quando excede o total", () => {
    // Estava na página 2 (11 itens); apagar o último item deixa 10 → só 1 página.
    const r = paginate(range(10), 2);
    expect(r.page).toBe(1);
    expect(r.items).toHaveLength(10);
  });

  it("satura simulando apagar o último item de uma página", () => {
    // 11 itens, estou na página 2 (item 11). Apago-o → 10 itens.
    const afterDelete = paginate(range(10), 2);
    expect(afterDelete.page).toBe(1);
    expect(afterDelete.pages).toBe(1);
    expect(afterDelete.items).toEqual(range(10));
  });

  it("páginas e entradas inválidas são saturadas a [1, pages]", () => {
    expect(paginate(range(30), 0).page).toBe(1);
    expect(paginate(range(30), -5).page).toBe(1);
    expect(paginate(range(30), 999).page).toBe(3);
    expect(paginate(range(30), Number.NaN).page).toBe(1);
  });

  it("PAGE_SIZE é 10 por omissão", () => {
    expect(PAGE_SIZE).toBe(10);
    expect(paginate(range(15), 1).items).toHaveLength(10);
  });
});

// Tamanho de página CONFIGURÁVEL (10/25/50/100). A pesquisa/ordenação operam
// sobre o conjunto completo; só o tamanho da FATIA visível muda.
describe("paginate com tamanho de página configurável", () => {
  it("size 25: 60 itens → 3 páginas de 25/25/10", () => {
    const items = range(60);
    expect(paginate(items, 1, 25).items).toHaveLength(25);
    expect(paginate(items, 1, 25).pages).toBe(3);
    expect(paginate(items, 2, 25).items).toEqual(range(50).slice(25));
    const last = paginate(items, 3, 25);
    expect(last.items).toHaveLength(10);
    expect(last.items[9]).toBe(60);
    expect(last.size).toBe(25);
  });

  it("size 50: 50 itens cabem numa página; 51 precisam de duas", () => {
    expect(paginate(range(50), 1, 50).pages).toBe(1);
    expect(paginate(range(50), 1, 50).items).toHaveLength(50);
    const two = paginate(range(51), 2, 50);
    expect(two.pages).toBe(2);
    expect(two.items).toEqual([51]);
    expect(two.start).toBe(50);
  });

  it("size 100: 250 itens → 3 páginas; a última tem 50", () => {
    const items = range(250);
    expect(paginate(items, 1, 100).pages).toBe(3);
    expect(paginate(items, 1, 100).items).toHaveLength(100);
    expect(paginate(items, 3, 100).items).toHaveLength(50);
  });

  it("aumentar o tamanho satura a página atual (ex.: pág. 3 de 10 vira pág. 1 com size 100)", () => {
    // 90 itens: com size 10 há 9 páginas; mudar para size 100 deixa 1 página.
    const items = range(90);
    expect(paginate(items, 3, 10).page).toBe(3);
    const bigger = paginate(items, 3, 100);
    expect(bigger.pages).toBe(1);
    expect(bigger.page).toBe(1);
    expect(bigger.items).toHaveLength(90);
  });

  it("todas as fatias (size 25) cobrem o conjunto sem lacunas nem duplicados", () => {
    const items = range(57);
    const collected = [
      ...paginate(items, 1, 25).items,
      ...paginate(items, 2, 25).items,
      ...paginate(items, 3, 25).items,
    ];
    expect(collected).toEqual(items);
  });
});

describe("orderBy (estabilidade determinística)", () => {
  it("desempata por chave quando o comparador dá empate", () => {
    const items = [
      { prio: 1, id: "c" },
      { prio: 1, id: "a" },
      { prio: 1, id: "b" },
    ];
    const sorted = orderBy(items, (x) => x.id, (a, b) => a.prio - b.prio);
    expect(sorted.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("ordem é estável entre atualizações do polling (reordenação da fonte)", () => {
    const a = orderBy([{ id: "b" }, { id: "a" }, { id: "c" }], (x) => x.id);
    const b = orderBy([{ id: "c" }, { id: "b" }, { id: "a" }], (x) => x.id);
    expect(a.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(b.map((x) => x.id)).toEqual(a.map((x) => x.id));
  });

  it("sem desempate, itens iguais não desaparecem nem duplicam ao fatiar", () => {
    const items = [
      { prio: 0, id: "y" },
      { prio: 0, id: "x" },
      { prio: 0, id: "z" },
    ];
    const sorted = orderBy(items, (x) => x.id);
    const pageA = paginate(sorted, 1, 2).items.map((x) => x.id);
    const pageB = paginate(sorted, 2, 2).items.map((x) => x.id);
    expect([...pageA, ...pageB]).toEqual(["x", "y", "z"]);
  });

  it("não muta o array de entrada", () => {
    const input = [{ id: "b" }, { id: "a" }];
    const copy = [...input];
    orderBy(input, (x) => x.id);
    expect(input).toEqual(copy);
  });
});
