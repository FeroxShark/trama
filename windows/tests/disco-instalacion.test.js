"use strict";
// El disco del paso «Instalar Trama» (src/disco-instalacion.js): sólo se tocan los archivos del payload; lo ajeno dentro de
// %LOCALAPPDATA%\trama\app (los logs de un servidor MCP abiertos) y lo bloqueado no frenan la actualización. Carpetas temporales y un
// `fs` que simula los bloqueos de Windows (EPERM); nunca se toca un proceso.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const D = require("../src/disco-instalacion");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "trama-wdi-"));
const eperm = (op, r) => Object.assign(new Error(`EPERM: operation not permitted, ${op} '${r}'`), { code: "EPERM" });

test("mismoArchivo: igual sólo si el contenido es el mismo", () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, "a"), Buffer.alloc(3 * 1024 * 1024 + 5, 7));
  fs.writeFileSync(path.join(d, "b"), Buffer.alloc(3 * 1024 * 1024 + 5, 7));
  const c = Buffer.alloc(3 * 1024 * 1024 + 5, 7);
  c[c.length - 1] = 8;
  fs.writeFileSync(path.join(d, "c"), c);
  fs.writeFileSync(path.join(d, "d"), "corto");
  assert.equal(D.mismoArchivo(path.join(d, "a"), path.join(d, "b")), true);
  assert.equal(D.mismoArchivo(path.join(d, "a"), path.join(d, "c")), false, "cambia el último byte");
  assert.equal(D.mismoArchivo(path.join(d, "a"), path.join(d, "d")), false, "otro tamaño");
  assert.equal(D.mismoArchivo(path.join(d, "a"), path.join(d, "no-hay")), false);
});

/** Un payload `app` inventado y una instalación vieja de Trama con archivos ajenos (los logs de un servidor MCP) adentro. */
function banco() {
  const payload = path.join(tmp(), "app");
  fs.mkdirSync(path.join(payload, "dist-electron"), { recursive: true });
  fs.writeFileSync(path.join(payload, "package.json"), "nuevo");
  fs.writeFileSync(path.join(payload, "dist-electron", "motor.js"), "motor nuevo");
  const app = path.join(tmp(), "app");
  fs.mkdirSync(path.join(app, "logs"), { recursive: true });
  fs.writeFileSync(path.join(app, "logs", "AvatarTools.log"), "log del MCP");
  fs.writeFileSync(path.join(app, "logs", "combined.log"), "otro log");
  fs.writeFileSync(path.join(app, "notas-de-otro.txt"), "ajeno");
  return { payload, app };
}
const sinTiempo = { esperar: () => {} };

test("instalarCarpeta: copia el payload y no toca nada ajeno (ni los logs abiertos por otro programa)", () => {
  const { payload, app } = banco();
  // Windows no deja renombrar ni borrar un archivo abierto por otro programa: acá, cualquier cosa que no sea del payload tira EPERM.
  const ajenos = new Set(["AvatarTools.log", "combined.log", "notas-de-otro.txt"]);
  const trampa = (op) => (r, ...resto) => {
    if (ajenos.has(path.basename(String(r)))) throw eperm(op, r);
    return fs[op](r, ...resto);
  };
  const sim = { ...fs, renameSync: trampa("renameSync"), unlinkSync: trampa("unlinkSync"), rmSync: trampa("rmSync"), copyFileSync: (a, b) => (ajenos.has(path.basename(b)) ? (() => { throw eperm("copyfile", b); })() : fs.copyFileSync(a, b)) };
  const r = D.instalarCarpeta(payload, app, { marca: "k", fs: sim, ...sinTiempo });
  assert.deepEqual({ ...r, copiados: undefined }, { copiados: undefined, apartados: [], sinReemplazar: [], quitados: 0 });
  assert.equal(fs.readFileSync(path.join(app, "dist-electron", "motor.js"), "utf8"), "motor nuevo");
  assert.equal(fs.readFileSync(path.join(app, "package.json"), "utf8"), "nuevo");
  assert.equal(fs.readFileSync(path.join(app, "logs", "AvatarTools.log"), "utf8"), "log del MCP");
  assert.equal(fs.readFileSync(path.join(app, "notas-de-otro.txt"), "utf8"), "ajeno");
  assert.deepEqual(fs.readdirSync(path.join(app, "logs")).sort(), ["AvatarTools.log", "combined.log"], "ni un .viejo- junto a los ajenos");
});

test("instalarCarpeta: lo ajeno sobrevive también a una actualización posterior (con la lista de lo instalado)", () => {
  const { payload, app } = banco();
  D.instalarCarpeta(payload, app, { marca: "a", ...sinTiempo });
  fs.writeFileSync(path.join(payload, "package.json"), "v3");
  fs.rmSync(path.join(payload, "dist-electron"), { recursive: true });
  const r = D.instalarCarpeta(payload, app, { marca: "b", ...sinTiempo });
  assert.equal(r.quitados, 1, "el motor.js que el payload ya no trae se va");
  assert.equal(fs.existsSync(path.join(app, "dist-electron")), false, "y su carpeta vacía también");
  assert.equal(fs.readFileSync(path.join(app, "package.json"), "utf8"), "v3");
  assert.equal(fs.readFileSync(path.join(app, "logs", "AvatarTools.log"), "utf8"), "log del MCP");
  assert.equal(fs.readFileSync(path.join(app, "notas-de-otro.txt"), "utf8"), "ajeno");
});

test("instalarCarpeta: un archivo propio en uso (EPERM al pisarlo) se aparta, el nuevo queda, y la próxima vez lo apartado se borra", () => {
  const { payload, app } = banco();
  fs.writeFileSync(path.join(app, "package.json"), "viejo en uso");
  let enUso = true;
  const sim = {
    ...fs,
    copyFileSync: (a, b) => (enUso && path.basename(b) === "package.json" && fs.existsSync(b) ? (() => { throw eperm("copyfile", b); })() : fs.copyFileSync(a, b)),
    unlinkSync: (r) => (enUso && /viejo-/.test(r) ? (() => { throw eperm("unlink", r); })() : fs.unlinkSync(r)),
  };
  const r = D.instalarCarpeta(payload, app, { marca: "k1", fs: sim, ...sinTiempo });
  assert.deepEqual(r.apartados, [path.join(app, "package.json.viejo-k1")]);
  assert.deepEqual(r.sinReemplazar, []);
  assert.equal(fs.readFileSync(path.join(app, "package.json"), "utf8"), "nuevo");
  assert.equal(fs.readFileSync(r.apartados[0], "utf8"), "viejo en uso", "el que corre sigue entero, a un lado");
  D.instalarCarpeta(payload, app, { marca: "k2", fs: sim, ...sinTiempo });
  assert.equal(fs.existsSync(r.apartados[0]), true, "sigue en uso: se queda");
  enUso = false;
  D.instalarCarpeta(payload, app, { marca: "k3", ...sinTiempo });
  assert.equal(fs.existsSync(r.apartados[0]), false, "ya nadie lo usa: se va");
});

test("instalarCarpeta: el archivo en uso es igual al del instalador: se deja y no es error", () => {
  const { payload, app } = banco();
  fs.writeFileSync(path.join(app, "package.json"), "nuevo");
  const sim = { ...fs, copyFileSync: (a, b) => (path.basename(b) === "package.json" ? (() => { throw eperm("copyfile", b); })() : fs.copyFileSync(a, b)) };
  const r = D.instalarCarpeta(payload, app, { marca: "k", fs: sim, ...sinTiempo });
  assert.deepEqual([r.apartados, r.sinReemplazar], [[], []]);
});

test("instalarCarpeta: un archivo propio que ni se puede apartar vuelve en sinReemplazar (sin tirar) y el resto se instala", () => {
  const { payload, app } = banco();
  fs.writeFileSync(path.join(app, "package.json"), "viejo en uso");
  const sim = {
    ...fs,
    copyFileSync: (a, b) => (path.basename(b) === "package.json" ? (() => { throw eperm("copyfile", b); })() : fs.copyFileSync(a, b)),
    renameSync: (a, b) => (path.basename(a) === "package.json" ? (() => { throw eperm("rename", a); })() : fs.renameSync(a, b)),
  };
  const r = D.instalarCarpeta(payload, app, { marca: "k", fs: sim, ...sinTiempo });
  assert.deepEqual(r.sinReemplazar, [{ ruta: path.join(app, "package.json"), motivo: "EPERM" }]);
  assert.equal(fs.readFileSync(path.join(app, "dist-electron", "motor.js"), "utf8"), "motor nuevo", "lo demás sí");
});

test("instalarCarpeta: un bloqueo pasajero se reintenta y no aparta nada", () => {
  const { payload, app } = banco();
  fs.writeFileSync(path.join(app, "package.json"), "viejo");
  let intentos = 0;
  const sim = { ...fs, copyFileSync: (a, b) => (path.basename(b) === "package.json" && intentos++ < 1 ? (() => { throw eperm("copyfile", b); })() : fs.copyFileSync(a, b)) };
  const r = D.instalarCarpeta(payload, app, { marca: "k", fs: sim, ...sinTiempo });
  assert.deepEqual([r.apartados, r.sinReemplazar], [[], []]);
  assert.equal(fs.readFileSync(path.join(app, "package.json"), "utf8"), "nuevo");
});

test("instalarCarpeta: sin lista de lo instalado (primera vez) no borra nada, y un .viejo- ajeno no se toca", () => {
  const { payload, app } = banco();
  fs.writeFileSync(path.join(app, "de-una-version-vieja.js"), "x");
  fs.writeFileSync(path.join(app, "logs", "combined.log.viejo-zz"), "ajeno");
  fs.writeFileSync(path.join(app, "package.json.viejo-q1"), "apartado por una instalación anterior");
  D.instalarCarpeta(payload, app, { marca: "k", ...sinTiempo });
  assert.equal(fs.existsSync(path.join(app, "de-una-version-vieja.js")), true);
  assert.equal(fs.existsSync(path.join(app, "logs", "combined.log.viejo-zz")), true);
  assert.equal(fs.existsSync(path.join(app, "package.json.viejo-q1")), false, "lo apartado de un archivo propio sí se limpia");
});
