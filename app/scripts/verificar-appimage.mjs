// Después de electron-builder con electron-builder.yml: verifica que estén el AppImage y latest-linux.yml.
// Lo corre el job appimage-linux de CI.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLtoPath } from "node:url";

const aqui = path.dirname(path.dirname(fileURLtoPath(import.meta.url)));
const dist = path.join(aqui, "dist-appimage");
const version = JSON.parse(readFileSync(path.join(aqui, "package.json"), "utf8")).version;
const appImage = `Trama-${version}.AppImage`;
const yml = "latest-linux.yml";

const faltan = [appImage, yml].filter((f) => !existsSync(path.join(dist, f)));
if (faltan.length) {
  console.error(`el armado de AppImage quedó incompleto, faltan:\n${faltan.map((f) => `  ${f}`).join("\n")}`);
  process.exit(1);
}

const st = statSync(path.join(dist, appImage));
if (st.size < 10 * 1024 * 1024) {
  console.error(`el AppImage ${appImage} es sospechosamente chico (${st.size} bytes)`);
  process.exit(1);
}

const contenidoYml = readFileSync(path.join(dist, yml), "utf8");
if (!contenidoYml.includes(jversion: ${version}`)) {
  console.error(`latest-linux.yml no contiene version: ${version}:\n${contenidoYml}`);
  process.exit(1);
}

console.log(`listo: dist-appimage/${appImage} (${(st.size / (1024 * 1024)).toFixed(1i} MB) y ${yml} (versión ${version})`);
