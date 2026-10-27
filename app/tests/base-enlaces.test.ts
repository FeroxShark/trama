// cli/base/enlaces.ts: symlink real en Linux; junction / hardlink / copia por plataforma inyectada; borrar sin atravesar enlaces.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { borrarSinSeguir, enlazarArchivo, enlazarDir } from "../electron/cli/base/enlaces.ts";

const posix = process.platform !== "win32";
const dir = () => mkdtempSync(path.join(os.tmpdir(), "base-enlaces-"));

test("win32 (inyectado): carpeta = junction con destino absoluto; archivo = hardlink, y copia si no se puede enlazar", () => {
  const llamadas: unknown[][] = [];
  const t = dir();
  const tipo = enlazarDir("C:/cache/node_modules", path.join(t, "wt", "node_modules"), { plat: "win32", symlink: (...a) => void llamadas.push(a) });
  assert.equal(tipo, "junction");
  assert.deepEqual(llamadas[0].slice(0, 1).concat(llamadas[0][2]), ["C:\\cache\\node_modules", "junction"]);

  const hechos: string[] = [];
  assert.equal(enlazarArchivo("C:\\p\\.env", path.join(t, "wt", ".env"), { plat: "win32", link: () => void hechos.push("link") }), "hardlink");
  const exdev = () => { throw Object.assign(new Error("x"), { code: "EXDEV" }); };
  assert.equal(enlazarArchivo("C:\\p\\.env", path.join(t, "wt", ".env"), { plat: "win32", link: exdev, copiar: () => void hechos.push("copia") }), "copia");
  assert.deepEqual(hechos, ["link", "copia"]);
  const eexist = () => { throw Object.assign(new Error("x"), { code: "EEXIST" }); };
  assert.throws(() => enlazarArchivo("a", path.join(t, "z"), { plat: "win32", link: eexist }), { code: "EEXIST" });
});

test("linux: symlinks reales, con la carpeta del enlace creada", { skip: !posix }, () => {
  const t = dir();
  mkdirSync(path.join(t, "main", "node_modules"), { recursive: true });
  writeFileSync(path.join(t, "main", ".env"), "A=1\n");
  assert.equal(enlazarDir(path.join(t, "main", "node_modules"), path.join(t, "wt", "x", "node_modules")), "symlink");
  assert.equal(enlazarArchivo(path.join(t, "main", ".env"), path.join(t, "wt", "x", ".env")), "symlink");
  assert.equal(readlinkSync(path.join(t, "wt", "x", "node_modules")), path.join(t, "main", "node_modules"));
  assert.equal(readFileSync(path.join(t, "wt", "x", ".env"), "utf8"), "A=1\n");
});

test("borrarSinSeguir: un árbol con enlaces a un dir compartido y a un archivo deja el destino intacto", { skip: !posix }, () => {
  const t = dir();
  const compartido = path.join(t, "main", "node_modules");
  mkdirSync(path.join(compartido, "pkg"), { recursive: true });
  writeFileSync(path.join(compartido, "pkg", "index.js"), "x");
  writeFileSync(path.join(t, "main", ".env"), "A=1");
  const wt = path.join(t, "wt");
  mkdirSync(path.join(wt, "src", "hondo"), { recursive: true });
  writeFileSync(path.join(wt, "src", "hondo", "a.txt"), "a");
  enlazarDir(compartido, path.join(wt, "node_modules"));
  enlazarDir(compartido, path.join(wt, "src", "hondo", "otro"));
  enlazarArchivo(path.join(t, "main", ".env"), path.join(wt, ".env"));
  // enlace roto también
  enlazarArchivo(path.join(t, "no-existe"), path.join(wt, "roto"));
  assert.ok(lstatSync(path.join(wt, "node_modules")).isSymbolicLink());

  borrarSinSeguir(wt);
  assert.equal(existsSync(wt), false);
  assert.equal(readFileSync(path.join(compartido, "pkg", "index.js"), "utf8"), "x");
  assert.equal(readFileSync(path.join(t, "main", ".env"), "utf8"), "A=1");

  // borrar el enlace mismo (sin barra final) tampoco toca el destino; y lo inexistente no tira
  enlazarDir(compartido, path.join(t, "l"));
  borrarSinSeguir(path.join(t, "l"));
  assert.equal(existsSync(path.join(compartido, "pkg", "index.js")), true);
  borrarSinSeguir(path.join(t, "no-hay"));
});
