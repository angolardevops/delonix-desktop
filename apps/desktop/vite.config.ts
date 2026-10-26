import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend do Delonix Desktop. O `build` produz assets estáticos que o Tauri
// embebe; NÃO depende do webview nem das libs GTK — por isso compila neste host
// mesmo sem `libwebkit2gtk-4.1-dev` (que só é preciso para a JANELA em runtime).
//
// Porta fixa 1420: o tauri.conf.json aponta `devUrl` para ela.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
  build: { target: "es2021", outDir: "dist", sourcemap: true },
});
