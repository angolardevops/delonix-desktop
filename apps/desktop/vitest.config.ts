import { defineConfig } from "vitest/config";

// Testes unitários da lógica pura (paginação/ordenação). Sem DOM: a função
// `paginate` e o comparador `orderBy` são puros, por isso corre em Node.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
