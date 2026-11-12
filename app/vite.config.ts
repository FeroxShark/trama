import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";

/**
 * Lleva el CHANGELOG.md de la raíz del repo a `dist/CHANGELOG.md`, que es de donde lo lee el motor (electron/novedades.ts) para las
 * novedades de cada versión. `dist/` viaja entero al AppImage (electron-builder.yml `files`), al payload del .exe nativo
 * (windows/src/payload-nativo.js, `app/dist`) y a la instalación de escritorio de Linux: con esto llega a los tres sin copias aparte.
 */
const cambios = (): Plugin => ({
  name: "trama-changelog",
  generateBundle() {
    // Se compila en `<raíz>/app` y el CHANGELOG está en `<raíz>`; en la instalación de Linux el instalador lo deja en la carpeta
    // que contiene al build (motor/scripts/instalar-producto.sh). Si falta, el build sigue: la app dice que no hay historial.
    try {
      this.emitFile({ type: "asset", fileName: "CHANGELOG.md", source: readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8") });
    } catch {
      this.warn("no encontré ../CHANGELOG.md: este build no lleva las novedades de cada versión");
    }
    try {
      this.emitFile({ type: "asset", fileName: "CHANGELOG.en.md", source: readFileSync(new URL("../CHANGELOG.en.md", import.meta.url), "utf8") });
    } catch {
      this.warn("no encontré ../CHANGELOG.en.md: este build no lleva las novedades en inglés");
    }
  },
});

// 1430 y no 1420: otra app usa 1420 y pueden correr en dev a la vez.
export default defineConfig({
  plugins: [react(), tailwindcss(), cambios()],
  // Relativo: el build se abre con loadFile (file://), no desde un servidor.
  base: "./",
  clearScreen: false,
  // La versión de este build: el aviso de Trama nueva (src/barra/AvisoClaude.tsx) sabe si la página ya corre la que se instaló.
  define: { __TRAMA_VERSION__: JSON.stringify((JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }).version) },
  server: {
    port: 1430,
    strictPort: true,
    watch: { ignored: ["**/electron/**", "**/dist-electron/**", "**/referencias/**"] },
  },
  build: { target: "chrome140" },
});
