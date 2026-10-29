import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const aqui = path.dirname(path.dirname(import.meta.filename));
const repo = path.dirname(aqui);

test("app/electron-builder.yml: appId, productName y AppImage para Linux", () => {
  const ruta = path.join(aqui, "electron-builder.yml");
  assert.ok(existsSync(ruta), "falta app/electron-builder.yml");
  const contenido = readFileSync(ruta, "utf8");
  assert.match(contenido, new RegExp("^appId:\\s*app\\.trama$", "m"));
  assert.match(contenido, new RegExp("^productName:\\s*Trama$", "m"));
  assert.match(contenido, new RegExp("^executableName:\\s*trama$", "m"));
  assert.match(contenido, new RegExp("output:\\s*dist-appimage"));
  assert.match(contenido, new RegExp("target:\\s*AppImage"));
  assert.match(contenido, new RegExp("provider:\\s*github"));
});

test("scripts del AppImage: sintaxis válida (verificar-appimage.mjs no se rompe)", () => {
  for (const script of ["construir-appimage.mjs", "verificar-appimage.mjs"]) {
    const r = spawnSync(process.execPath, ["--check", path.join(aqui, "scripts", script)], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  }
});

test("app/build/icon.png: icono de 512x512 valido", () => {
  const ruta = path.join(aqui, "build", "icon.png");
  assert.ok(existsSync(ruta), "falta app/build/icon.png");
  const buf = readFileSync(ruta);
  assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const ancho = buf.readUInt32BE(16);
  const alto = buf.readUInt32BE(20);
  assert.equal(ancho, 512);
  assert.equal(alto, 512);
});

test("workflow de CI: arma el AppImage, verifica el arranque y publica a la release", () => {
  const ruta = path.join(repo, ".github", "workflows", "windows-exe.yml");
  assert.ok(existsSync(ruta), "falta el workflow de instaladores");
  const yml = readFileSync(ruta, "utf8");
  assert.match(yml, new RegExp("appimage-linux:"));
  assert.match(yml, new RegExp("electron-builder[\\s\\S]*--linux AppImage"));
  assert.match(yml, new RegExp("verificar-appimage\\.mjs"));
  assert.match(yml, new RegExp("xvfb-run[\\s\\S]*--no-sandbox"));
  assert.match(yml, new RegExp("--version"));
  assert.match(yml, new RegExp("latest-linux\\.yml"));
  assert.match(yml, new RegExp("Trama-\\*\\.AppImage"));
});
