"use strict";
// Qué lleva el payload del Trama nativo de Windows y la revisión de que no lleve bash. Por LISTA PERMITIDA: sólo entra lo que
// está acá (la app compilada, los hooks .mjs, la skill, las plantillas, los datos, el node.exe fijado y los .cmd de bin\); nada
// de .sh, .service, systemd ni WSL (motor/docs/port-windows-plan.md, «Regla fija: Windows sin bash»). Sin Electron: lo usan
// scripts/preparar-payload-nativo.mjs (que arma la carpeta) y tests/payload-nativo.test.js.
//
//   payload-nativo/
//     node/node.exe                 Node fijado por versión y sha256 (NODE)
//     app/package.json              el de app/, reducido (versión, `type: module`, repo de las actualizaciones)
//     app/dist/  app/dist-electron/ la app compilada (vite build + tsc -p tsconfig.electron.json)
//     app/hooks/*.mjs               los hooks de Node (no los .sh)
//     app/skills/  app/plantillas/home/  app/datos/
//     bin/<herramienta>.cmd         `node.exe <app>\dist-electron\cli\<herramienta>.js %*`, sólo las que ya están portadas
//     .version                      huella del contenido (cambia ⇒ la carcasa reinstala)

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const NODE = {
  version: "v24.22.1",
  url: "https://nodejs.org/dist/v24.22.1/win-x64/node.exe",
  sha256: "d702daa815eabbff763c7d3808e235cf031cf2ca70211b56847bc72f51e240e5",
};

// Las herramientas de la línea de comandos que van a bin\ (cuando su .js está en dist-electron\cli\).
const HERRAMIENTAS = ["pa", "trama-estado", "proyecto-ruta", "workers", "tablero", "reparto", "cuentas"];

// [origen relativo al repo, destino relativo al payload, filtro de archivos]
const COPIAS = [
  ["app/dist", "app/dist", () => true],
  ["app/dist-electron", "app/dist-electron", (f) => !f.endsWith(".map") && path.basename(f) !== ".listo"],
  ["motor/hooks", "app/hooks", (f) => f.endsWith(".mjs")],
  ["motor/skills", "app/skills", () => true],
  ["motor/plantillas/home", "app/plantillas/home", () => true],
  ["motor/datos", "app/datos", (f) => f.endsWith(".json")],
];

const CAMPOS_PAQUETE = ["name", "productName", "version", "type", "license", "repository", "engines"];

/** El .cmd de una herramienta: rutas relativas a bin\ (%~dp0), así anda instalado en cualquier carpeta. CRLF, como cmd espera. */
const shimCmd = (nombre) => ["@echo off", `"%~dp0..\\node\\node.exe" "%~dp0..\\app\\dist-electron\\cli\\${nombre}.js" %*`, ""].join("\r\n");

// ---------- la revisión: nada de bash ----------
const EXT_PROHIBIDAS = /\.(sh|bash|zsh|py|pyc|service|timer|desktop|socket)$/i;
const NOMBRES_PROHIBIDOS = new Set(["bash", "bash.exe", "sh", "sh.exe", "jq", "jq.exe", "flock", "wsl.exe", "git-bash.exe"]);
const TEXTO = /\.(m?js|cjs|cmd|bat|ps1|json)$/i;
// Formas de LLAMAR a bash (no de nombrarlo: los hooks y el motor hablan de bash todo el tiempo, porque lo vigilan en los comandos
// de los workers).
const INVOCA_BASH = [
  [/^#!.*\b(?:ba|z)?sh\b/m, "shebang de shell"],
  [/\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync)\(\s*["'`](?:\/(?:usr\/)?bin\/)?(?:ba)?sh(?:\.exe)?["'`]/, "lanza bash/sh"],
  [/\bbash\.exe\b/i, "busca bash.exe"],
  [/\bwsl(?:\.exe)?["'`]?\s*[,(]?\s*\[?\s*["'`]?(?:-d|-e|--exec|--distribution)\b/i, "llama a wsl"],
  [/["'`](?:\/bin\/)?(?:ba)?sh["'`]\s*,\s*["'`]-l?c["'`]/, "arma un `sh -c`"],
  [/\[\s*["'`](?:ba)?sh["'`]\s*,\s*\[/, "elige bash como programa"],
  [/^\s*(?:call\s+)?(?:ba)?sh(?:\.exe)?\s/im, "un .cmd que corre bash"],
];

/**
 * Excepciones con nombre y motivo, para lo que todavía no se portó (cada una la saca la etapa que la arregla). Una excepción que
 * ya no encuentra nada se informa como «sobra», para borrarla.
 */
const EXCEPCIONES = [
  {
    archivo: "app/dist-electron/procesos.js",
    motivo: "busca el bash.exe de Git para Windows; la etapa 14 del port (ramas win32 de la app) lo saca",
  },
  {
    archivo: "app/dist-electron/actualizador.js",
    motivo: "la terminal de Linux corre la actualización con `sh -c`; la etapa 14 (terminal en win32: wt / cmd start) la cambia",
  },
  {
    archivo: "app/dist-electron/cli/pa/ramas.js",
    motivo: "correrTests: fuera de win32 corre el `tests` del registry con `bash -c` (como el original); en win32 va por cmd.exe, así que el .exe no lo lanza",
  },
  {
    archivo: "app/hooks/docker-guard.mjs",
    motivo: "no lanza nada: `/bin/sh -c` es el CMD por defecto de Docker, que la guardia reproduce para leer un Dockerfile",
  },
  {
    archivo: "app/hooks/agy-pa.mjs",
    motivo: "corre con bash sólo una guardia .sh; en Windows el plugin de agy apunta a las .mjs (hooksJsonAgy de cli/hooks.ts)",
  },
];

function* recorrer(dir, base = dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, e.name);
    if (e.isDirectory()) yield* recorrer(ruta, base);
    else yield path.relative(base, ruta).split(path.sep).join("/");
  }
}

/** Lo que el payload no puede tener: [{archivo, problema}]; `sobran` son excepciones que ya no hacen falta. */
function revisarSinBash(dir, excepciones = EXCEPCIONES) {
  const problemas = [];
  const usadas = new Set();
  for (const rel of recorrer(dir)) {
    const nombre = path.posix.basename(rel);
    if (EXT_PROHIBIDAS.test(nombre)) problemas.push({ archivo: rel, problema: "archivo de shell, python o systemd" });
    if (NOMBRES_PROHIBIDOS.has(nombre.toLowerCase())) problemas.push({ archivo: rel, problema: "binario de bash/jq/flock/wsl" });
    if (!TEXTO.test(nombre)) continue;
    const texto = fs.readFileSync(path.join(dir, rel), "utf8");
    for (const [re, que] of INVOCA_BASH) {
      if (!re.test(texto)) continue;
      const exc = excepciones.find((x) => x.archivo === rel);
      if (exc) usadas.add(exc.archivo);
      else problemas.push({ archivo: rel, problema: que });
    }
  }
  return { problemas, sobran: excepciones.filter((x) => !usadas.has(x.archivo)).map((x) => x.archivo) };
}

/** Huella del contenido (rutas + bytes, ordenado), sin `.version`: 16 hex, como el payload del instalador. */
function huella(dir) {
  const h = crypto.createHash("sha256");
  for (const rel of [...recorrer(dir)].filter((r) => r !== ".version").sort()) {
    h.update(`${rel}\0`);
    h.update(crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, rel))).digest("hex"));
    h.update("\n");
  }
  return h.digest("hex").slice(0, 16);
}

/** El package.json de la app, con sólo lo que el motor lee (versión, repo, `type: module` para los .js de dist-electron). */
function paqueteReducido(pkg) {
  const o = {};
  for (const k of CAMPOS_PAQUETE) if (pkg[k] !== undefined) o[k] = pkg[k];
  o.type = "module";
  return o;
}

/**
 * Arma el payload en `destino` desde el repo (`repo`, con app/ ya compilada) y un node.exe ya verificado (`nodeExe`).
 * Devuelve {version, herramientas, faltan}. Tira si falta la app compilada.
 */
function armarPayload({ repo, destino, nodeExe }) {
  for (const f of ["app/dist/index.html", "app/dist-electron/motor.js"]) {
    if (!fs.existsSync(path.join(repo, f))) throw new Error(`falta ${f}: compilá la app antes (npm run build en app/)`);
  }
  fs.rmSync(destino, { recursive: true, force: true });
  fs.mkdirSync(destino, { recursive: true });
  for (const [de, a, filtro] of COPIAS) {
    const origen = path.join(repo, de);
    if (!fs.existsSync(origen)) throw new Error(`falta ${de}`);
    for (const rel of recorrer(origen)) {
      if (!filtro(rel)) continue;
      const fin = path.join(destino, a, rel);
      fs.mkdirSync(path.dirname(fin), { recursive: true });
      fs.copyFileSync(path.join(origen, rel), fin);
    }
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, "app", "package.json"), "utf8"));
  fs.writeFileSync(path.join(destino, "app", "package.json"), `${JSON.stringify(paqueteReducido(pkg), null, 2)}\n`);
  fs.mkdirSync(path.join(destino, "node"), { recursive: true });
  fs.copyFileSync(nodeExe, path.join(destino, "node", "node.exe"));
  fs.mkdirSync(path.join(destino, "bin"), { recursive: true });
  const herramientas = [];
  const faltan = [];
  for (const h of HERRAMIENTAS) {
    if (fs.existsSync(path.join(destino, "app", "dist-electron", "cli", `${h}.js`))) {
      fs.writeFileSync(path.join(destino, "bin", `${h}.cmd`), shimCmd(h));
      herramientas.push(h);
    } else faltan.push(h);
  }
  const version = huella(destino);
  fs.writeFileSync(path.join(destino, ".version"), version);
  return { version, herramientas, faltan };
}

const sha256 = (ruta) => crypto.createHash("sha256").update(fs.readFileSync(ruta)).digest("hex");

module.exports = { NODE, HERRAMIENTAS, COPIAS, EXCEPCIONES, shimCmd, revisarSinBash, huella, paqueteReducido, armarPayload, sha256, recorrer };
