import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

function exactCasePlugin(): Plugin {
  const dirCache = new Map<string, string[]>();
  return {
    name: "exact-case-resolver",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer || !importer.includes("/src/")) return null;
      if (!source.startsWith("./") && !source.startsWith("../")) return null;

      const targetBase = path.basename(source);
      if (targetBase.includes(".")) return null;

      const dir = path.dirname(importer);
      const targetDir = path.resolve(dir, path.dirname(source));
      const firstChar = targetBase[0];
      const isCapital = firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase();

      let files = dirCache.get(targetDir);
      if (!files) {
        try {
          files = fs.readdirSync(targetDir);
          dirCache.set(targetDir, files);
        } catch {
          return null;
        }
      }

      const exts = isCapital ? [".tsx", ".ts"] : [".ts", ".tsx"];
      for (const ext of exts) {
        if (files.includes(targetBase + ext)) {
          return path.join(targetDir, targetBase + ext);
        }
      }
      return null;
    },
  };
}

// 1430 y no 1420: otra app usa 1420 y pueden correr en dev a la vez.
export default defineConfig({
  plugins: [exactCasePlugin(), react(), tailwindcss()],
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
