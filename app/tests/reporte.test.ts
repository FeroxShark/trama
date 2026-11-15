// «Reportar un bug» (electron/reporte.ts): el log que va a un repo público sale sin claves, tokens, correos ni la carpeta personal;
// la URL del issue lleva título, cuerpo y etiqueta; la carpeta va a Descargas y guarda sólo una captura que sea PNG.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { armarReporte, carpetaDescargas, limpiarLog, tituloDe, urlIssue } from "../electron/reporte.ts";

test("limpiarLog: saca claves, tokens, correos y la carpeta personal", () => {
  const home = "/home/ana";
  const log = [
    "aviso lider: ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
    "gh: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 en /home/ana/Proyectos/x",
    "Authorization: Bearer abc.def-ghi_jkl123456",
    "cuenta ana@ejemplo.org conectada",
    "nvidia nvapi-AAAAAAAAAAAAAAAAAAAAAAAA",
    'token: "s3cr3tvalor"',
    "google AIzaSyA-1234567890abcdefghijklmnop",
  ].join("\n");
  const l = limpiarLog(log, home);
  for (const x of ["sk-ant-", "ghp_", "abc.def", "ana@ejemplo.org", "nvapi-A", "s3cr3tvalor", "AIzaSy", "/home/ana"]) assert.ok(!l.includes(x), `quedó ${x}:\n${l}`);
  assert.match(l, /~\/Proyectos\/x/);
  assert.match(l, /<correo> conectada/);
});

test("limpiarLog: sólo las últimas líneas", () => {
  const log = Array.from({ length: 50 }, (_, i) => `linea ${i}`).join("\n");
  assert.deepEqual(limpiarLog(log, "/home/ana", 3).split("\n"), ["linea 47", "linea 48", "linea 49"]);
});

test("limpiarLog: la carpeta personal de Windows con las dos barras", () => {
  const l = limpiarLog("C:\\Users\\Ana\\x y C:/Users/Ana/y", "C:\\Users\\Ana");
  assert.equal(l, "~\\x y ~/y");
});

test("urlIssue: título de la primera línea, cuerpo con versión y adjuntos, etiqueta bug", () => {
  const u = new URL(urlIssue("duenio/trama", { descripcion: "Se cuelga al abrir\nmás detalle", version: "0.2.87", sistema: "Linux 7.3 (linux, x64)", carpeta: "~/Descargas/trama-reporte-1", conCaptura: true, conLog: true }));
  assert.equal(u.origin + u.pathname, "https://github.com/duenio/trama/issues/new");
  assert.equal(u.searchParams.get("title"), "Se cuelga al abrir");
  assert.equal(u.searchParams.get("labels"), "bug");
  const b = u.searchParams.get("body")!;
  assert.match(b, /más detalle/);
  assert.match(b, /Trama 0\.2\.87/);
  assert.match(b, /`captura\.png` y `log\.txt`/);
  assert.match(b, /~\/Descargas\/trama-reporte-1/);
});

test("urlIssue: sin adjuntos no los menciona; título largo se corta", () => {
  const u = new URL(urlIssue("a/b", { descripcion: "x".repeat(200), version: null, sistema: "s", carpeta: "c", conCaptura: false, conLog: false }));
  assert.ok(!u.searchParams.get("body")!.includes("Adjuntos"));
  assert.equal(tituloDe("x".repeat(200)).length, 80);
  assert.equal(tituloDe("   "), "Bug");
});

test("carpetaDescargas: XDG, después Downloads/Descargas, si no la carpeta personal", () => {
  const dirs = 'XDG_DOWNLOAD_DIR="$HOME/Bajadas"\n';
  assert.equal(carpetaDescargas("/home/ana", "linux", () => dirs, (f) => f === "/home/ana/Bajadas"), "/home/ana/Bajadas");
  assert.equal(carpetaDescargas("/home/ana", "linux", () => null, (f) => f === "/home/ana/Descargas"), "/home/ana/Descargas");
  assert.equal(carpetaDescargas("/home/ana", "linux", () => null, () => false), "/home/ana");
  assert.equal(carpetaDescargas("C:\\Users\\Ana", "win32", () => null, (f) => f === "C:\\Users\\Ana\\Downloads"), "C:\\Users\\Ana\\Downloads");
});

test("armarReporte: escribe la captura sólo si es PNG y devuelve la URL de GitHub", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "trama-rep-"));
  try {
    mkdirSync(path.join(home, "Downloads"));
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]).toString("base64");
    const r = armarReporte({ descripcion: "falla", captura: png, log: false }, home, new Date(2026, 10, 14, 23, 5, 9));
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.carpeta, path.join(home, "Downloads", "trama-reporte-20261114-230509"));
    assert.ok(existsSync(path.join(r.carpeta, "captura.png")));
    assert.ok(!existsSync(path.join(r.carpeta, "log.txt")));
    assert.match(r.url, /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/new\?/);
    assert.equal(readFileSync(path.join(r.carpeta, "captura.png")).subarray(1, 4).toString("latin1"), "PNG");
    const r2 = armarReporte({ descripcion: "otra", captura: Buffer.from("no es png").toString("base64"), log: false }, home, new Date(2026, 10, 14, 23, 6, 0));
    assert.ok(r2.ok && !existsSync(path.join(r2.carpeta, "captura.png")));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
