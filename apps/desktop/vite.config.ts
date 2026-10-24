import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Frontend do Delonix Desktop. O `build` produz assets estáticos que o Tauri
// embebe; NÃO depende do webview nem das libs GTK — por isso compila neste host
// mesmo sem `libwebkit2gtk-4.1-dev` (que só é preciso para a JANELA em runtime).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: { target: 'es2022', outDir: 'dist' },
});
