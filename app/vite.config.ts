import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// 1430 y no 1420: otra app usa 1420 y pueden correr en dev a la vez.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relativo: el build se abre con loadFile (file://), no desde un servidor.
  base: "./",
  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
    watch: { ignored: ["**/electron/**", "**/dist-electron/**", "**/referencias/**"] },
  },
  build: { target: "chrome140" },
});
