// La conversación de un líder leída de a poco (electron/conv-cache.ts): sólo la cola que creció,
// y de cero si el archivo se achicó, cambió de inodo o se reescribió.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { convDe, lecturas, olvidarConv } from "../electron/conv-cache.ts";
import { conversacionDe, paginaDe } from "../electron/lider-arma.ts";

const dir = mkdtempSync(path.join(os.tmpdir(), "hilos-conv-"));
const SID = "00000000-0000-4000-8000-000000000001";
let archivo = "";
let k = 0;

beforeEach(() => {
  olvidarConv();
  lecturas.completas = lecturas.incrementales = 0;
  archivo = path.join(dir, `t${++k}.jsonl`);
});

const l = (o: unknown) => JSON.stringify(o) + "\n";
const pregunta = (t: string) => l({ type: "user", message: { content: t } });
const respuesta = (t: string, id = "m" + t) => l({ type: "assistant", message: { id, model: "claude-opus-5-5", content: [{ type: "text", text: t }], usage: { input_tokens: 5 } } });
const pagina = async (n = 500) => paginaDe(await convDe(SID, archivo), SID, archivo, { n });
const entera = (texto: string, n = 500) => conversacionDe(SID, archivo, texto, { n });

test("conv-cache: la primera lectura es entera y la siguiente sólo trae lo nuevo", async () => {
  let texto = pregunta("hola") + respuesta("que tal");
  writeFileSync(archivo, texto);
  assert.deepEqual(await pagina(), entera(texto));
  assert.deepEqual([lecturas.completas, lecturas.incrementales], [1, 0]);

  const nuevo = pregunta("otra") + respuesta("sí");
  appendFileSync(archivo, nuevo);
  texto += nuevo;
  const r = await pagina();
  assert.deepEqual(r, entera(texto));
  assert.equal(r.total, 4);
  assert.deepEqual([lecturas.completas, lecturas.incrementales], [1, 1]);

  // Sin cambios: nada que leer, mismo resultado.
  assert.deepEqual(await pagina(), entera(texto));
  assert.equal(lecturas.completas, 1);
});

test("conv-cache: una línea a medio escribir espera a que llegue entera", async () => {
  const a = pregunta("hola");
  const b = respuesta("ñandú con acentos: áéíóú");
  writeFileSync(archivo, a + b.slice(0, 30));
  assert.equal((await pagina()).total, 1);
  appendFileSync(archivo, b.slice(30));
  const r = await pagina();
  assert.equal(r.total, 2);
  assert.deepEqual(r, entera(a + b));
  assert.equal(lecturas.completas, 1);
});

test("conv-cache: una última línea sin salto de línea pero entera se cuenta, y el salto que llega después no la duplica", async () => {
  const sin = (s: string) => s.trimEnd();
  writeFileSync(archivo, pregunta("hola") + sin(respuesta("listo")));
  assert.equal((await pagina()).total, 2);
  appendFileSync(archivo, "\n" + pregunta("y?"));
  const r = await pagina();
  assert.equal(r.total, 3);
  assert.deepEqual(r, entera(pregunta("hola") + respuesta("listo") + pregunta("y?")));
});

test("conv-cache: el resultado de una herramienta que llega después se pega a su llamada, y los pedazos del mismo mensaje se juntan", async () => {
  const uso = l({ type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "tu1", name: "Bash", input: { command: "ls" } }], usage: { input_tokens: 1 } } });
  writeFileSync(archivo, pregunta("corré ls") + uso);
  const r1 = await pagina();
  assert.equal(r1.mensajes.at(-1)!.det?.[0].resultado, undefined);

  const res = l({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "a.txt\nb.txt" }] } });
  const otro = l({ type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Ahí está." }], usage: { input_tokens: 2 } } });
  appendFileSync(archivo, res + otro);
  const r2 = await pagina();
  const todo = pregunta("corré ls") + uso + res + otro;
  assert.deepEqual(r2, entera(todo));
  assert.equal(r2.total, 2, "los dos pedazos de m1 son un solo mensaje");
  assert.match(String(r2.mensajes.at(-1)!.det?.[0].resultado?.texto), /a\.txt/);
  assert.equal(lecturas.completas, 1);
});

test("conv-cache: compactar suma al conteo y la marca se mantiene entre lecturas", async () => {
  writeFileSync(archivo, pregunta("a") + respuesta("b"));
  assert.equal((await pagina()).compactaciones, 0);
  const cb = l({ type: "system", subtype: "compact_boundary", compactMetadata: { trigger: "auto", preTokens: 900 } });
  appendFileSync(archivo, cb);
  const r = await pagina();
  assert.equal(r.compactaciones, 1);
  assert.equal(r.compactada, true);
  assert.deepEqual(r, entera(pregunta("a") + respuesta("b") + cb));
});

test("conv-cache: si el archivo se achica se lee entero de nuevo", async () => {
  writeFileSync(archivo, pregunta("uno") + respuesta("dos") + pregunta("tres") + respuesta("cuatro"));
  assert.equal((await pagina()).total, 4);
  const corto = pregunta("uno") + respuesta("dos");
  writeFileSync(archivo, corto); // mismo inodo, más chico
  const r = await pagina();
  assert.equal(r.total, 2);
  assert.deepEqual(r, entera(corto));
  assert.equal(lecturas.completas, 2);
});

test("conv-cache: si cambia de inodo (rotación, reemplazo) se lee entero aunque sea más grande", async () => {
  writeFileSync(archivo, pregunta("uno") + respuesta("dos"));
  assert.equal((await pagina()).total, 2);
  const otro = pregunta("A") + respuesta("B") + pregunta("C") + respuesta("D") + pregunta("E");
  const tmp = archivo + ".nuevo";
  writeFileSync(tmp, otro);
  renameSync(tmp, archivo);
  const r = await pagina();
  assert.equal(r.total, 5);
  assert.deepEqual(r, entera(otro));
  assert.equal(lecturas.completas, 2);
});

test("conv-cache: reescrito en el lugar y más grande: lo que ya no coincide con lo leído se detecta", async () => {
  writeFileSync(archivo, pregunta("uno") + respuesta("dos"));
  assert.equal((await pagina()).total, 2);
  const otro = pregunta("UNO") + respuesta("DOS") + pregunta("tres") + respuesta("cuatro");
  writeFileSync(archivo, otro); // mismo inodo
  const r = await pagina();
  assert.deepEqual(r, entera(otro));
  assert.equal(r.total, 4);
  assert.equal(lecturas.completas, 2);
});

test("conv-cache: un archivo de más de un pedazo (con líneas gigantes y multibyte) da lo mismo que leerlo entero", async () => {
  const grande = "ñ€😀 ".repeat(700_000); // ~ 5,6 MB en una sola línea
  let texto = pregunta("hola") + respuesta(grande, "g1");
  for (let i = 0; i < 400; i++) texto += pregunta("p" + i) + respuesta("r" + "áé".repeat(30) + i);
  writeFileSync(archivo, texto);
  const r = await pagina(500);
  assert.deepEqual(r, entera(texto, 500));
  assert.equal(r.total, 802);
});

test("conv-cache: dos lecturas a la vez no suman lo nuevo dos veces", async () => {
  writeFileSync(archivo, pregunta("a") + respuesta("b"));
  await pagina();
  appendFileSync(archivo, pregunta("c") + respuesta("d"));
  const [x, y] = await Promise.all([pagina(), pagina()]);
  assert.equal(x.total, 4);
  assert.equal(y.total, 4);
});

test("conv-cache: sin archivo o sin transcript, vacío y sin romper", async () => {
  assert.equal(paginaDe(await convDe(SID, null), SID, null).total, 0);
  rmSync(archivo, { force: true });
  assert.equal((await pagina()).total, 0);
  // Un archivo que se borra después de leerlo vuelve a vacío, y si reaparece se lee de cero.
  writeFileSync(archivo, pregunta("a"));
  assert.equal((await pagina()).total, 1);
  rmSync(archivo);
  assert.equal((await pagina()).total, 0);
  writeFileSync(archivo, pregunta("a") + respuesta("b"));
  assert.equal((await pagina()).total, 2);
});

test("conv-cache: dos sesiones no se mezclan", async () => {
  const otra = archivo + ".otra";
  writeFileSync(archivo, pregunta("a"));
  writeFileSync(otra, pregunta("x") + respuesta("y") + pregunta("z"));
  const SID2 = "00000000-0000-4000-8000-000000000002";
  assert.equal(paginaDe(await convDe(SID, archivo), SID, archivo).total, 1);
  assert.equal(paginaDe(await convDe(SID2, otra), SID2, otra).total, 3);
  appendFileSync(archivo, respuesta("b"));
  assert.equal(paginaDe(await convDe(SID, archivo), SID, archivo).total, 2);
  assert.equal(paginaDe(await convDe(SID2, otra), SID2, otra).total, 3);
  assert.equal(lecturas.completas, 2);
});
