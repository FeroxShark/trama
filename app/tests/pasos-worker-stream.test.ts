// electron/pasos-worker.ts con un worker que no es de Claude (agy, codex, opencode, dsh): su stream crece y cada línea ENTERA
// avisa que el hilo cambió (`alStream`); una línea a medio escribir no avisa hasta completarse; al soltar no queda watch.
// Con un stream inventado en un tmp. Lo que la vista relee es `mensajesDeStream` (lo mismo que `pa --hilo`).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { crearPasos } from "../electron/pasos-worker.ts";
import { mensajesDeStream } from "../electron/cli/pa/hilo-stream.ts";
import { esperarHasta } from "./esperar.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-pasos-stream-"));
const paState = path.join(tmp, "pa");
const proyectos = path.join(tmp, "claude", "projects");
const ID = "20261102-100000-111";
const carpeta = path.join(paState, "atlas");
const ruta = path.join(carpeta, `${ID}.stream.jsonl`);
mkdirSync(carpeta, { recursive: true });
mkdirSync(proyectos, { recursive: true });

const l = (o: object) => JSON.stringify(o) + "\n";
const dsh = (text: string) => l({ type: "status", phase: "step_start" }) + l({ type: "text", text }); // un paso por texto: un mensaje cada uno
const avisos: string[] = [];
const p = crearPasos({ proyectos, paState, alCambiar: () => {}, alStream: (id) => avisos.push(id), espera: 20, esperaStream: 30 });
after(() => p.soltar("ventana"));
/** Lo que mostraría la vista ahora: los textos del asistente, como los arma `pa --hilo`. */
const vista = () => mensajesDeStream(readFileSync(ruta, "utf8"), "", "", "").flatMap((m: any) => (m.rol === "assistant" ? [m.texto] : []));
/** Deja pasar el tiempo para comprobar que NO pasó nada. */
const quieto = () => new Promise((r) => setTimeout(r, 200)); // espera-justificada: probar que no llega un aviso

writeFileSync(ruta, l({ type: "session", sessionId: "s-1" }) + dsh("antes de abrir"));

test("mirar un worker sin transcript pero con stream: contesta sin pasos y lo que ya tenía no avisa", async () => {
  const v = await p.mirar("ventana", ID);
  assert.equal(v.hay, false);
  await quieto();
  assert.deepEqual(avisos, []);
});

test("una línea nueva llega sola, sin esperar un cambio de estado", async () => {
  appendFileSync(ruta, dsh("una"));
  await esperarHasta(() => avisos.length >= 1);
  assert.deepEqual(avisos.slice(0, 1), [ID]);
  assert.deepEqual(vista(), ["antes de abrir", "una"]);
});

test("varias líneas seguidas, un solo aviso; otros archivos de la carpeta no cuentan", async () => {
  await quieto();
  avisos.length = 0;
  writeFileSync(path.join(carpeta, `${ID}.hilo`), "tarea=x\n");
  appendFileSync(ruta, dsh("dos") + dsh("tres") + dsh("cuatro"));
  await esperarHasta(() => avisos.length >= 1);
  await quieto();
  assert.equal(avisos.length, 1);
  assert.equal(vista().length, 5);
});

test("una línea a medio escribir no avisa ni rompe; se procesa cuando se completa", async () => {
  await quieto();
  avisos.length = 0;
  const entera = dsh("cinco");
  appendFileSync(ruta, entera.slice(0, 12));
  await quieto();
  assert.deepEqual(avisos, []);
  assert.equal(vista().length, 5, "la línea cortada no entra en el hilo");
  appendFileSync(ruta, entera.slice(12));
  await esperarHasta(() => avisos.length >= 1);
  assert.equal(vista().at(-1), "cinco");
  assert.equal(vista().length, 6);
});

test("un stream que aparece después de abrir el worker se vigila cuando algo se mueve (faltantes)", async () => {
  const otro = "20261102-100100-222";
  const ruta2 = path.join(carpeta, `${otro}.stream.jsonl`);
  assert.equal((await p.mirar("ventana", otro)).hay, false);
  avisos.length = 0;
  writeFileSync(ruta2, dsh("nace"));
  p.faltantes();
  await quieto();
  appendFileSync(ruta2, dsh("sigue"));
  await esperarHasta(() => avisos.includes(otro));
});

test("al soltar no queda ningún watch: el stream que crece ya no avisa", async () => {
  p.soltar("ventana");
  assert.deepEqual(p.mirando(), []);
  await quieto();
  avisos.length = 0;
  appendFileSync(ruta, dsh("nadie mira"));
  await quieto();
  assert.deepEqual(avisos, []);
});
