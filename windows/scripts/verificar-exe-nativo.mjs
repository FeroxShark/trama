// Después de `electron-builder --config electron-builder-nativo.yml`: que estén el .exe, su nativo.yml y, en la carpeta sin
// empaquetar, el payload nativo entero (node.exe, motor.js, .version) y sin bash. Lo corre el job exe-nativo de CI.
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { revisarSinBash } = require("../src/payload-nativo.js");
const aqui = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(aqui, "dist-nativo");
const version = JSON.parse(readFileSync(path.join(aqui, "package.json"), "utf8")).version;
const payload = path.join(dist, "win-unpacked", "resources", "payload-nativo");

const faltan = [
  `Trama-Nativo-Setup-${version}.exe`,
  "nativo.yml",
  "win-unpacked/resources/payload-nativo/.version",
  "win-unpacked/resources/payload-nativo/node/node.exe",
  "win-unpacked/resources/payload-nativo/app/package.json",
  "win-unpacked/resources/payload-nativo/app/dist/index.html",
  "win-unpacked/resources/payload-nativo/app/dist-electron/motor.js",
  "win-unpacked/resources/payload-nativo/app/dist-electron/cli/instalar-nativo.js",
  "win-unpacked/resources/payload-nativo/app/hooks/destructive-guard.mjs",
  "win-unpacked/resources/payload-nativo/app/scripts/asegurar-cli.mjs",
].filter((f) => !existsSync(path.join(dist, f)));
if (faltan.length) {
  console.error(`el armado quedó incompleto, faltan:\n${faltan.map((f) => `  ${f}`).join("\n")}`);
  process.exit(1);
}
const { problemas } = revisarSinBash(payload);
if (problemas.length) {
  console.error(`el payload del .exe lleva bash:\n${problemas.map((p) => `  ${p.archivo}: ${p.problema}`).join("\n")}`);
  process.exit(1);
}
console.log(`listo: dist-nativo/Trama-Nativo-Setup-${version}.exe (payload ${readFileSync(path.join(payload, ".version"), "utf8").trim()})`);
