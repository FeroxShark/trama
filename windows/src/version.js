"use strict";
// La versión de la carcasa de Windows es la de app/package.json (la de Trama). Se copia a windows/package.json y a su
// package-lock.json antes de armar: de ahí salen el nombre del instalador, el nativo.yml y app.getVersion() (el pie de la
// ventana). Sin Electron: lo usan scripts/sincronizar-version.mjs (que corre al armar) y tests/version.test.js.
const fs = require("node:fs");
const path = require("node:path");

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function leerJson(ruta) {
  return JSON.parse(fs.readFileSync(ruta, "utf8"));
}

function escribirJson(ruta, objeto) {
  fs.writeFileSync(ruta, `${JSON.stringify(objeto, null, 2)}\n`);
}

// `app` y `windows` son las carpetas de app/ y de windows/. Devuelve la versión copiada.
function sincronizarVersion({ app, windows }) {
  const version = leerJson(path.join(app, "package.json")).version;
  if (typeof version !== "string" || !SEMVER.test(version)) {
    throw new Error(`app/package.json no tiene una versión válida: ${JSON.stringify(version)}`);
  }

  const pkgPath = path.join(windows, "package.json");
  const pkg = leerJson(pkgPath);
  if (pkg.version !== version) {
    pkg.version = version;
    escribirJson(pkgPath, pkg);
  }

  const lockPath = path.join(windows, "package-lock.json");
  if (fs.existsSync(lockPath)) {
    const lock = leerJson(lockPath);
    lock.version = version;
    if (lock.packages?.[""]) lock.packages[""].version = version;
    escribirJson(lockPath, lock);
  }

  return version;
}

module.exports = { sincronizarVersion };
