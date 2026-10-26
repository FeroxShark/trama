// src/qr.ts: el QR que dibuja Ajustes > Celular. Estructura (buscadores, temporizador, tamaño por versión) y, si hay `zbarimg`
// en la máquina, que un lector de verdad lo decodifique igual al texto, desde una URL corta hasta el tope de la versión 10.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { qr, qrCamino } from "../src/qr.ts";

const hayZbar = spawnSync("zbarimg", ["--version"]).status === 0;

/** Un PBM (P1) de la matriz, con la zona de silencio de 4 módulos y cada módulo de `e` píxeles. */
function pbm(m: boolean[][], e = 6): string {
  const n = (m.length + 8) * e;
  const filas: string[] = [];
  for (let y = 0; y < n; y++) {
    const f: string[] = [];
    for (let x = 0; x < n; x++) {
      const mx = Math.floor(x / e) - 4;
      const my = Math.floor(y / e) - 4;
      f.push(m[my]?.[mx] ? "1" : "0");
    }
    filas.push(f.join(" "));
  }
  return `P1\n${n} ${n}\n${filas.join("\n")}\n`;
}

test("qr: tamaño por versión y patrones fijos", () => {
  const corto = qr("http://pc.ts.net:8791/")!;
  assert.equal(corto.length, 25, "22 bytes entran en la versión 2 (25×25) con corrección M");
  const m = qr("a".repeat(100))!;
  assert.equal(m.length % 4, 1);
  // Los tres buscadores: anillo exterior oscuro, claro, centro oscuro.
  for (const [ox, oy] of [[0, 0], [m.length - 7, 0], [0, m.length - 7]]) {
    assert.equal(m[oy][ox], true);
    assert.equal(m[oy + 1][ox + 1], false);
    assert.equal(m[oy + 3][ox + 3], true);
  }
  // El temporizador alterna entre los buscadores.
  for (let i = 8; i < m.length - 8; i++) assert.equal(m[6][i], i % 2 === 0, `fila 6, columna ${i}`);
  assert.equal(m[m.length - 8][8], true, "el módulo oscuro fijo");
});

test("qr: lo que no entra da null y el camino SVG cubre sólo lo oscuro", () => {
  assert.equal(qr("x".repeat(300)), null);
  const m = qr("hola")!;
  const camino = qrCamino(m);
  const oscuros = m.flat().filter(Boolean).length;
  const area = [...camino.matchAll(/h(\d+)v1/g)].reduce((s, x) => s + Number(x[1]), 0);
  assert.equal(area, oscuros);
});

test("qr: un lector de verdad lo decodifica", { skip: !hayZbar && "sin zbarimg" }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "hilos-qr-"));
  try {
    const casos = [
      "http://pc.ts.net:8791/",
      "http://mi-computadora-larga.tail1234.ts.net:8791/",
      "ñandú ✓ — texto con acentos y símbolos",
      "x".repeat(60),
      "0123456789".repeat(10),
      "https://ejemplo.ts.net/" + "abc".repeat(40),
      "Z".repeat(200),
      "Q".repeat(213),
    ];
    for (const [i, texto] of casos.entries()) {
      const m = qr(texto);
      assert.ok(m, `entra: ${texto.slice(0, 20)}`);
      const f = path.join(dir, `q${i}.pbm`);
      writeFileSync(f, pbm(m));
      const r = spawnSync("zbarimg", ["-q", "--raw", f], { encoding: "utf8" });
      assert.equal(r.stdout.replace(/\n$/, ""), texto, `versión ${(m.length - 17) / 4}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
