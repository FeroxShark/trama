// electron/pasos-worker.ts: quién mira qué worker, los cambios en lotes y que sin nadie no quede ni un watch.
// Con transcripts y `.sid` inventados en un tmp. Sin tocar el `$PA_STATE` de verdad.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { crearPasos } from "../electron/pasos-worker.ts";
import type { CambioPasos } from "../electron/pasos.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-pasos-worker-"));
const proyectos = path.join(tmp, "claude", "projects");
const paState = path.join(tmp, "pa");
const T0 = Date.parse("2026-03-10T12:00:00Z");
const hora = (s: number) => new Date(T0 + s * 1000).toISOString();
const U = { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 10, output_tokens: 1 };
const l = (o: object) => JSON.stringify(o) + "\n";
const tarea = l({ type: "user", timestamp: hora(0), message: { role: "user", content: "hacé algo" } });
const texto = (id: string, t: string, s: number) => l({ type: "assistant", timestamp: hora(s), message: { id, model: "claude-opus-5-5", usage: U, content: [{ type: "text", text: t }] } });
const ID1 = "20260310-100000-111";
const ID2 = "20260310-100100-222";

function worker(proyecto: string, id: string, sid: string, contenido: string | null) {
  mkdirSync(path.join(paState, proyecto), { recursive: true });
  writeFileSync(path.join(paState, proyecto, `${id}.sid`), sid);
  if (contenido === null) return;
  mkdirSync(path.join(proyectos, "-tmp-x"), { recursive: true });
  writeFileSync(path.join(proyectos, "-tmp-x", `${sid}.jsonl`), contenido);
}
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function hasta(f: () => boolean, ms = 3000) {
  const fin = Date.now() + ms;
  while (!f() && Date.now() < fin) await esperar(20);
  assert.ok(f(), "no llegó a tiempo");
}

const avisos: CambioPasos[] = [];
const p = crearPasos({ proyectos, paState, alCambiar: (c) => avisos.push(c), espera: 40 });
after(() => {
  p.soltar("ventana");
  p.soltar("celular");
});

worker("atlas", ID1, "sid-1", tarea + texto("m1", "uno", 1));

test("mirar contesta la vista entera; un id que no es un id, o un worker sin transcript, hay: false", async () => {
  const v = await p.mirar("ventana", ID1);
  assert.equal(v.hay, true);
  assert.deepEqual(v.pasos.map((x) => x.titulo), ["uno"]);
  assert.equal(v.encabezado.tarea, "hacé algo");
  assert.equal((await p.mirar("celular", "../../etc/passwd")).hay, false);
  assert.equal((await p.mirar("celular", ID2)).hay, false);
  p.soltar("celular");
});

test("un transcript que crece llega como un solo lote, con los pasos nuevos desde la revisión", async () => {
  const v = await p.mirar("ventana", ID1);
  avisos.length = 0;
  const ruta = path.join(proyectos, "-tmp-x", "sid-1.jsonl");
  // Varias líneas seguidas: un lote.
  appendFileSync(ruta, texto("m2", "dos", 2));
  appendFileSync(ruta, texto("m3", "tres", 3));
  appendFileSync(ruta, texto("m4", "cuatro", 4));
  await hasta(() => avisos.length > 0);
  await esperar(150);
  assert.equal(avisos.length, 1);
  const c = avisos[0];
  assert.equal(c.id, ID1);
  assert.equal(c.gen, v.gen);
  assert.equal(c.desde, v.v);
  assert.deepEqual(c.cambios.map((x) => x.titulo), ["dos", "tres", "cuatro"]);
  assert.equal(c.total, 4);
});

test("la carpeta de subagentes que aparece después también se mira", async () => {
  const ruta = path.join(proyectos, "-tmp-x", "sid-1.jsonl");
  avisos.length = 0;
  appendFileSync(
    ruta,
    l({ type: "assistant", timestamp: hora(10), message: { id: "m9", model: "claude-opus-5-5", usage: U, content: [{ type: "tool_use", id: "tu9", name: "Agent", input: { description: "d", prompt: "p" } }] } }) +
      l({ type: "user", timestamp: hora(11), toolUseResult: { agentId: "ag9", isAsync: true, status: "async_launched" }, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu9", content: "lanzado" }] } }),
  );
  await hasta(() => avisos.length > 0);
  await esperar(100);
  avisos.length = 0;
  const sub = path.join(proyectos, "-tmp-x", "sid-1", "subagents");
  mkdirSync(sub, { recursive: true });
  writeFileSync(path.join(sub, "agent-ag9.jsonl"), l({ type: "assistant", isSidechain: true, timestamp: hora(12), message: { id: "s1", model: "claude-haiku-5-5", usage: U, content: [{ type: "text", text: "del subagente" }] } }));
  await hasta(() => avisos.some((c) => c.cambios.some((x) => x.detalle.clase === "delegar" && x.detalle.pasos.length === 1)));
});

test("un worker sin transcript lo recibe cuando aparece (faltantes), sin reloj", async () => {
  const v = await p.mirar("celular", ID2);
  assert.equal(v.hay, false);
  avisos.length = 0;
  worker("atlas", ID2, "sid-2", tarea + texto("n1", "recién", 1));
  p.faltantes();
  await hasta(() => avisos.length > 0);
  assert.equal(avisos[0].id, ID2);
  assert.deepEqual(avisos[0].cambios.map((x) => x.titulo), ["recién"]);
});

test("dos vistas del mismo worker comparten lo armado; sin nadie mirando no queda nada", async () => {
  p.soltar("celular");
  assert.deepEqual(p.mirando(), [ID1]);
  await p.mirar("celular", ID1);
  p.soltar("ventana");
  assert.deepEqual(p.mirando(), [ID1]);
  p.soltar("celular");
  assert.deepEqual(p.mirando(), []);
  // Y sin nadie, un transcript que crece no avisa nada.
  avisos.length = 0;
  appendFileSync(path.join(proyectos, "-tmp-x", "sid-1.jsonl"), texto("m10", "diez", 20));
  await esperar(300);
  assert.equal(avisos.length, 0);
});

test("cambiar de worker suelta el anterior", async () => {
  await p.mirar("ventana", ID1);
  await p.mirar("ventana", ID2);
  assert.deepEqual(p.mirando(), [ID2]);
  p.soltar("ventana");
  assert.deepEqual(p.mirando(), []);
});
