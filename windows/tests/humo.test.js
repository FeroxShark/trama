"use strict";
// El script de humo de la Trama nativa (humo/humo-gonza.ps1), que corre el dueño por SSH en la PC con Trama. Acá no hay
// PowerShell para correrlo: se mira que exista, que liste sus chequeos, que sea PowerShell 5.1 y que no toque el archivo
// de credenciales de Claude.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RUTA = path.join(__dirname, "..", "humo", "humo-gonza.ps1");
const bytes = fs.readFileSync(RUTA);
const src = bytes.toString("utf8");
// Sin comentarios de línea: lo que PowerShell efectivamente ejecuta.
const codigo = src
  .replace(/^\uFEFF/, "")
  .split(/\r?\n/)
  .filter((l) => !l.trim().startsWith("#"))
  .join("\n");

const CHEQUEOS = [
  "pa --estado",
  "pa --hilos",
  "pa --proyectos",
  "pa --rinde",
  "pa --modelos",
  "pa --cupo-gemini",
  "reparto --resumen",
  "reparto --cupos",
  "cuentas --json",
  "tablero resumen",
];

test("el script de humo existe en windows/humo", () => {
  assert.ok(fs.statSync(RUTA).isFile());
});

test("lista los chequeos de pa, reparto, cuentas y tablero", () => {
  for (const c of CHEQUEOS) assert.ok(src.includes(`'${c}'`), `falta el chequeo ${c}`);
});

test("cada herramienta tiene tope de 60 s y las marcas de fallo son ENOENT y todavía no está", () => {
  assert.match(src, /\$segundosHerramienta = 60\b/);
  assert.ok(src.includes("'ENOENT'"));
  assert.ok(src.includes("todavía no está"));
});

test("el worker de prueba va en un repo temporal, con registry propio y sólo si hay claude", () => {
  assert.match(codigo, /Get-Command claude/);
  assert.match(codigo, /'--leer'/);
  assert.match(codigo, /PROYECTOS_REGISTRY/);
  assert.match(codigo, /\$env:TEMP/);
});

test("revisa las últimas 200 líneas de trama.log buscando ENOENT, canal desconocido y todavía no está", () => {
  assert.match(codigo, /estado\\hilos\\trama\.log/);
  assert.match(codigo, /-Tail 200/);
  assert.ok(codigo.includes("canal desconocido"));
});

test("sale con 0 sólo si todo está OK", () => {
  assert.match(codigo, /exit 0/);
  assert.match(codigo, /exit 1/);
});

test("PowerShell 5.1: sin BOM no leería los acentos; sin operadores de PS 7", () => {
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.doesNotMatch(codigo, /\?\?|&&|\|\||\?\./);
});

test("no lee ni nombra el archivo de credenciales de Claude", () => {
  assert.doesNotMatch(src, /credentials/i);
});
