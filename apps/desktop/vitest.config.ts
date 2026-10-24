import { defineConfig } from "vitest/config";

// Testes unitários da lógica pura (paginação/ordenação, métricas). Sem DOM:
// as funções são puras, por isso corre em Node.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
