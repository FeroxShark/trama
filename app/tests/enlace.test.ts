// Los enlaces que se abren afuera (electron/enlace.ts): sólo una página o un correo,
// y en las pruebas nada llega al navegador (`HILOS_ABRIR`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { abrible, abrirEnlace } from "../electron/enlace.ts";

test("abrible: http, https y mailto; nada más", () => {
  assert.equal(abrible("https://example.com/a?b=1#c"), "https://example.com/a?b=1#c");
  assert.equal(abrible("http://example.com"), "http://example.com/");
  assert.equal(abrible("mailto:alguien@example.com"), "mailto:alguien@example.com");
  for (const no of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,<b>x</b>", "vscode://file/x", "smb://servidor/x", "about:blank", "/etc/passwd", "example.com", "", "https://"]) assert.equal(abrible(no), null, no);
});

test("abrirEnlace: abre lo que se puede abrir y nada más", () => {
  const antes = process.env.HILOS_ABRIR;
  delete process.env.HILOS_ABRIR;
  try {
    const abiertos: string[] = [];
    assert.equal(abrirEnlace("https://example.com/x", (u) => abiertos.push(u)), true);
    assert.equal(abrirEnlace("file:///etc/passwd", (u) => abiertos.push(u)), false);
    assert.equal(abrirEnlace("no es una url", (u) => abiertos.push(u)), false);
    assert.deepEqual(abiertos, ["https://example.com/x"]);
  } finally {
    if (antes !== undefined) process.env.HILOS_ABRIR = antes;
  }
});

test("abrirEnlace: con HILOS_ABRIR anota la URL y no abre nada", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "hilos-enlace-"));
  const antes = process.env.HILOS_ABRIR;
  process.env.HILOS_ABRIR = path.join(dir, "abiertos");
  try {
    let abrio = false;
    assert.equal(abrirEnlace("https://example.com/a", () => (abrio = true)), true);
    assert.equal(abrirEnlace("mailto:alguien@example.com", () => (abrio = true)), true);
    assert.equal(abrio, false);
    assert.equal(readFileSync(process.env.HILOS_ABRIR, "utf8"), "https://example.com/a\nmailto:alguien@example.com\n");
  } finally {
    if (antes === undefined) delete process.env.HILOS_ABRIR;
    else process.env.HILOS_ABRIR = antes;
    rmSync(dir, { recursive: true, force: true });
  }
});
