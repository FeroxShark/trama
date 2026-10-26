// El detector de «Destrabar solo cuando se repite» (electron/destrabar.ts) y su cuenta (destrabar-registro.ts): sin Electron ni agy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { aplanar, avisoDestrabo, claveDestrabo, destrabarActivo, destrabarPorDefecto, queLlamada, Vigilante, type Bucle } from "../electron/destrabar.ts";
import { cerrarDestrabo, leerDestrabos, registrarDestrabo } from "../electron/destrabar-registro.ts";

let n = 0;
/** Una llamada y lo que devolvió, de a una señal. */
function paso(v: Vigilante, comando: string, salida: string, error = false): Bucle | null {
  const id = `t${n++}`;
  v.ver({ tipo: "llamada", id, nombre: "Bash", entrada: { command: comando } });
  return v.ver({ tipo: "resultado", id, texto: salida, error });
}

test("aplanar: los números, los % y las barras de progreso no cuentan", () => {
  assert.equal(aplanar("Descargando… 20 % (20/100 MB)"), aplanar("Descargando… 35 % (35/100 MB)"));
  assert.equal(aplanar("[=====>     ] 45%"), aplanar("[==========>] 99%"));
  assert.notEqual(aplanar("falló la descarga"), aplanar("descarga lista"));
});

test("el porcentaje que sube en la misma consulta es un bucle al sexto intento", () => {
  const v = new Vigilante();
  let b: Bucle | null = null;
  let i = 0;
  for (; i < 12 && !b; i++) b = paso(v, "curl -s localhost:9/progreso", `Descargando ${i * 8} %`);
  assert.equal(i, 6);
  assert.equal(b!.clase, "repite");
  assert.match(b!.que, /Bash: curl -s localhost:9\/progreso/);
  // Después de avisar empieza de cero: hace falta otra racha entera.
  assert.equal(paso(v, "curl -s localhost:9/progreso", "Descargando 99 %"), null);
});

test("el mismo error de siempre, aunque cambie el comando, es un bucle (clase error)", () => {
  const v = new Vigilante();
  let b: Bucle | null = null;
  for (let i = 0; i < 12 && !b; i++) b = paso(v, `ls /no/existe/${"x".repeat(i)}`, "ls: cannot access: No such file or directory", true);
  assert.equal(b?.clase, "error");
  assert.match(b!.que, /cannot access/);
});

test("dos cosas que se alternan (relee, espera, relee…) también cuentan", () => {
  const v = new Vigilante();
  let b: Bucle | null = null;
  for (let i = 0; i < 12 && !b; i++) {
    b = paso(v, "cat /tmp/progreso.log", `avance ${i * 5} %`);
    b = b ?? paso(v, "sleep 30", "");
  }
  assert.ok(b);
  assert.match(b!.que, /cat \/tmp\/progreso\.log.*sleep 30/);
});

test("no es un bucle: leer un archivo por pedazos, comandos distintos, o la misma lectura menos veces que el umbral", () => {
  const v = new Vigilante();
  for (let i = 0; i < 30; i++) assert.equal(paso(v, `sed -n ${i * 50 + 1},${i * 50 + 50}p src/a.ts`, `contenido distinto ${"y".repeat(i)}`), null);
  for (const c of ["ls", "git status", "npm test", "git diff", "cat a", "cat b", "cat c", "cat d"]) assert.equal(paso(v, c, `salida de ${c}`), null);
  const w = new Vigilante();
  for (let i = 0; i < 5; i++) assert.equal(paso(w, "curl x", `${i} %`), null);
  // Y una salida distinta en medio la deshace.
  assert.equal(paso(w, "curl x", "listo: descarga terminada"), null);
  for (let i = 0; i < 5; i++) assert.equal(paso(w, "curl x", `${i} %`), null);
});

test("el mismo mensaje de texto una y otra vez es un bucle de texto", () => {
  const v = new Vigilante();
  let b: Bucle | null = null;
  for (let i = 0; i < 10 && !b; i++) b = v.ver({ tipo: "texto", texto: `Voy a revisar el progreso otra vez (${i}).` });
  assert.equal(b?.clase, "texto");
});

test("el umbral se puede cambiar (mínimo 3)", () => {
  const v = new Vigilante(3);
  let i = 0;
  let b: Bucle | null = null;
  for (; i < 5 && !b; i++) b = paso(v, "curl x", `${i} %`);
  assert.equal(i, 3);
  assert.ok(b);
});

test("de fábrica sólo Gemini 3.8 Flash (con cualquier esfuerzo); el ajuste manda en los dos sentidos", () => {
  assert.equal(destrabarPorDefecto("gemini-3.8-flash"), true);
  assert.equal(destrabarPorDefecto("gemini-3.8-flash-low"), true);
  assert.equal(destrabarPorDefecto("gemini-4-argon-high"), false);
  assert.equal(destrabarPorDefecto("claude-opus-5-5"), false);
  assert.equal(claveDestrabo("agy:claude-opus-5-5-high"), "agy:claude-opus-5-5");
  assert.equal(destrabarActivo("gemini-3.8-flash-high", {}), true);
  assert.equal(destrabarActivo("gemini-3.8-flash-high", { "gemini-3.8-flash": false }), false);
  assert.equal(destrabarActivo("gemini-4-argon", { "gemini-4-argon": true }), true);
  assert.equal(destrabarActivo("gemini-4-argon", undefined), false);
});

test("el aviso nombra qué repetía, y el segundo del turno es más firme", () => {
  const uno = avisoDestrabo("Bash: curl x", 1);
  assert.match(uno, /^\[trama\] Te trabaste repitiendo Bash: curl x\./);
  assert.match(uno, /un solo comando que bloquee/);
  assert.doesNotMatch(uno, /segunda vez/);
  assert.match(avisoDestrabo("Bash: curl x", 2), /segunda vez/);
  assert.equal(queLlamada("Read", { file_path: "/tmp/x.log" }), "Read: /tmp/x.log");
});

test("el registro cuenta cuántas veces y cómo terminaron; sin archivo, ceros", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "hilos-destrabos-"));
  try {
    const ruta = path.join(dir, "destrabos.jsonl");
    assert.deepEqual(leerDestrabos(ruta), { veces: 0, bien: 0, mal: 0, cortado: 0, pendiente: 0 });
    const a = registrarDestrabo("gemini-3.8-flash", "Bash: curl x", undefined, ruta);
    const b = registrarDestrabo("gemini-3.8-flash", "Bash: curl y", undefined, ruta);
    const c = registrarDestrabo("gemini-3.8-flash", "Bash: curl z", undefined, ruta);
    registrarDestrabo("gemini-3.8-flash", "Bash: curl w", undefined, ruta);
    cerrarDestrabo(a, "bien", ruta);
    cerrarDestrabo(b, "mal", ruta);
    cerrarDestrabo(c, "cortado", ruta);
    assert.deepEqual(leerDestrabos(ruta), { veces: 4, bien: 1, mal: 1, cortado: 1, pendiente: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
