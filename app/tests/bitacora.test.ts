// El log propio (electron/bitacora.ts): la rotación por tamaño (1 MB, 3 archivos) y el tope de recargas
// del renderer. Todo en una carpeta temporal.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { ARCHIVOS, crearBitacora, crearTope, describir, MAX_BYTES } from "../electron/bitacora.ts";

const tmp = mkdtempSync(path.join(tmpdir(), "trama-bitacora-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

test("una entrada: fecha, nivel, dónde y el error con su stack, sangrado", () => {
  const archivo = path.join(tmp, "uno", "trama.log");
  const b = crearBitacora({ archivo, ahora: () => Date.UTC(2026, 9, 13, 20, 0, 0) });
  b.escribir("error", "main uncaughtException", new Error("se rompió"));
  b.escribir("aviso", "pa", "texto suelto");
  const lineas = readFileSync(archivo, "utf8").split("\n");
  assert.match(lineas[0], /^2026-10-13T20:00:00\.000Z error \[main uncaughtException\] Error: se rompió$/);
  assert.match(lineas[1], /^ {2,}at /, "el stack va con sangría");
  assert.ok(lineas.some((l) => l === "2026-10-13T20:00:00.000Z aviso [pa] texto suelto"));
  assert.equal(describir({ a: 1 }), '{"a":1}');
});

test("rota por tamaño: nunca más de 3 archivos y el más viejo se pierde", () => {
  const dir = path.join(tmp, "rota");
  const archivo = path.join(dir, "trama.log");
  const b = crearBitacora({ archivo, maxBytes: 1000 });
  const entrada = (n: number) => `n${String(n).padStart(3, "0")}`.padEnd(200, "x");
  for (let n = 0; n < 20; n++) b.escribir("info", "t", entrada(n));
  assert.deepEqual(readdirSync(dir).sort(), ["trama.log", "trama.log.1", "trama.log.2"]);
  for (const f of readdirSync(dir)) assert.ok(statSync(path.join(dir, f)).size <= 1000, `${f} pasó el tope`);
  const [a, b1, b2] = ["trama.log", "trama.log.1", "trama.log.2"].map((f) => readFileSync(path.join(dir, f), "utf8"));
  // El archivo vivo tiene lo más nuevo y .2 lo más viejo que sobrevive; lo más viejo de todo ya no está.
  assert.ok(a.includes("n019"));
  assert.ok(!b2.includes("n000") && !a.includes("n000") && !b1.includes("n000"));
  const ultimaDeB2 = Number(/n(\d{3})/g.exec(b2.split("\n").filter(Boolean).at(-1)!)?.[1]);
  const primeraDeB1 = Number(/n(\d{3})/.exec(b1)?.[1]);
  assert.equal(primeraDeB1, ultimaDeB2 + 1, "sin huecos entre un archivo y el siguiente");
});

test("al abrir sigue donde quedó el archivo, y con el tamaño de verdad rota a 1 MB", () => {
  const dir = path.join(tmp, "grande");
  const archivo = path.join(dir, "trama.log");
  assert.equal(MAX_BYTES, 1024 * 1024);
  assert.equal(ARCHIVOS, 3);
  const b = crearBitacora({ archivo });
  const pesado = "y".repeat(4000);
  for (let i = 0; i < 400; i++) b.escribir("info", "t", pesado);
  assert.ok(existsSync(`${archivo}.1`), "pasado 1 MB rotó");
  assert.ok(!existsSync(`${archivo}.2`));
  assert.ok(statSync(archivo).size <= MAX_BYTES);
  // Un proceso nuevo cuenta lo que ya hay.
  writeFileSync(archivo, "z".repeat(MAX_BYTES - 10));
  crearBitacora({ archivo }).escribir("info", "t", "una más que no entra");
  assert.ok(statSync(`${archivo}.1`).size >= MAX_BYTES - 10, "lo que había pasó a .1");
  assert.ok(statSync(archivo).size < 200);
});

test("una carpeta imposible no tira nada, y un stack enorme se corta", () => {
  const roto = path.join(tmp, "es-un-archivo");
  writeFileSync(roto, "");
  assert.doesNotThrow(() => crearBitacora({ archivo: path.join(roto, "no", "trama.log") }).escribir("error", "t", "x"));
  const archivo = path.join(tmp, "corto", "trama.log");
  crearBitacora({ archivo }).escribir("error", "t", "q".repeat(100_000));
  assert.ok(statSync(archivo).size < 9000);
  assert.match(readFileSync(archivo, "utf8"), /cortado/);
});

test("el tope: muere 2 veces en un minuto y se recarga; a la tercera, el cartel", () => {
  let ahora = 0;
  const tope = crearTope({ ahora: () => ahora });
  assert.equal(tope.muerte(), true);
  ahora += 10_000;
  assert.equal(tope.muerte(), true);
  ahora += 10_000;
  assert.equal(tope.muerte(), false, "3 en menos de un minuto");
  ahora += 5_000;
  assert.equal(tope.muerte(), false, "y sigue sin recargar");
});

test("el tope: las muertes viejas se olvidan, y reiniciar empieza de cero", () => {
  let ahora = 0;
  const tope = crearTope({ ahora: () => ahora });
  tope.muerte();
  ahora += 30_000;
  tope.muerte();
  ahora += 40_000; // la primera ya pasó el minuto
  assert.equal(tope.muerte(), true, "van 2 en la ventana");
  ahora += 1_000;
  assert.equal(tope.muerte(), false);
  tope.reiniciar();
  assert.equal(tope.muerte(), true);
});
