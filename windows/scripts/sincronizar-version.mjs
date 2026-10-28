// Copia la versión de app/package.json a windows/package.json y a su package-lock.json. Corre antes de electron-builder
// (npm run dist:nativo y el job exe-nativo de CI), así el instalador y la carcasa salen con la versión de Trama.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { sincronizarVersion } = require("../src/version.js");
const windows = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const app = path.join(windows, "..", "app");

const version = sincronizarVersion({ app, windows });
console.log(`versión de la carcasa: ${version} (de app/package.json)`);
