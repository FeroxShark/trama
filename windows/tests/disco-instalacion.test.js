"use strict";
// El disco del paso «Instalar Trama» (src/disco-instalacion.js): el node.exe de %LOCALAPPDATA%\trama\node que otro programa tiene
// corriendo no puede frenar la actualización. Carpetas temporales y un `fs` que simula el bloqueo de Windows (EPERM al borrar/pisar
// un .exe en uso); nunca se toca un proceso.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const D = require("../src/disco-instalacion");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "trama-wdi-"));
const eperm = (op, r) => Object.assign(new Error(`EPERM: operation not permitted, ${op} '${r}'`), { code: "EPERM" });
/** Un fs donde los archivos de `enUso` no se pueden borrar ni pisar (como un .exe corriendo), pero sí renombrar. */
const fsConBloqueo = (enUso) => ({
  ...fs,
  unlinkSync: (r) => (enUso.has(path.resolve(r)) ? (() => { throw eperm("unlink", r); })() : fs.unlinkSync(r)),
});

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

test("apartarOcupados: el node.exe en uso (EPERM) se aparta, el resto se borra, y se puede copiar el nuevo encima", () => {
  const raiz = tmp();
  const viejo = path.join(raiz, "node");
  const nuevo = path.join(tmp(), "node");
  fs.mkdirSync(viejo);
  fs.mkdirSync(nuevo);
  fs.writeFileSync(path.join(viejo, "node.exe"), "node 24.1");
  fs.writeFileSync(path.join(viejo, "otro.txt"), "x");
  fs.writeFileSync(path.join(nuevo, "node.exe"), "node 24.2");
  const bloqueado = new Set([path.resolve(viejo, "node.exe")]);
  const sim = fsConBloqueo(bloqueado);

  assert.throws(() => sim.unlinkSync(path.join(viejo, "node.exe")), /EPERM/, "el bloqueo simulado es real");
  const apartados = D.apartarOcupados(viejo, "k1", sim);
  assert.deepEqual(apartados, [path.join(viejo, "node.exe.viejo-k1")]);
  assert.equal(fs.readFileSync(apartados[0], "utf8"), "node 24.1", "el que corre sigue entero, a un lado");
  assert.equal(fs.existsSync(path.join(viejo, "otro.txt")), false);
  D.copiarCarpeta(nuevo, viejo);
  assert.equal(fs.readFileSync(path.join(viejo, "node.exe"), "utf8"), "node 24.2");
});

test("apartarOcupados: sin bloqueos no aparta nada; una carpeta que no existe no es error", () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, "app", "sub"), { recursive: true });
  fs.writeFileSync(path.join(d, "app", "sub", "x.js"), "x");
  assert.deepEqual(D.apartarOcupados(path.join(d, "app"), "k", fs), []);
  assert.equal(fs.existsSync(path.join(d, "app", "sub", "x.js")), false);
  assert.deepEqual(D.apartarOcupados(path.join(d, "nada"), "k", fs), []);
});

test("apartarOcupados: si ni renombrar se puede, tira", () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, "node.exe"), "x");
  const sim = { ...fsConBloqueo(new Set([path.resolve(d, "node.exe")])), renameSync: (a) => { throw eperm("rename", a); } };
  assert.throws(() => D.apartarOcupados(d, "k", sim), /EPERM/);
});

test("limpiarViejos: borra lo apartado que ya nadie usa y deja lo que sigue corriendo", () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, "node.exe"), "nuevo");
  fs.writeFileSync(path.join(d, "node.exe.viejo-a1"), "libre");
  fs.writeFileSync(path.join(d, "node.exe.viejo-b2"), "en uso");
  const sim = fsConBloqueo(new Set([path.resolve(d, "node.exe.viejo-b2")]));
  assert.equal(D.limpiarViejos(d, sim), 1);
  assert.deepEqual(fs.readdirSync(d).sort(), ["node.exe", "node.exe.viejo-b2"]);
  assert.equal(D.limpiarViejos(d, fs), 1, "al terminar el proceso, la próxima vez se va");
  assert.deepEqual(fs.readdirSync(d), ["node.exe"]);
  assert.equal(D.limpiarViejos(path.join(d, "no-hay"), fs), 0);
});
