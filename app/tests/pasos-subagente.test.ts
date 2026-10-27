// La vista grande de un subagente: electron/pasos-worker.ts arma sus pasos con el id `sub:<sesión>:<agentId>`
// desde `projects/<cwd>/<sesión>/subagents/agent-<id>.jsonl`, en vivo mientras crece y con el informe al final.
// Con un transcript inventado en un tmp (nada de datos reales).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { crearPasos } from "../electron/pasos-worker.ts";
import type { CambioPasos } from "../electron/pasos.ts";
import { claveSub, deClaveSub } from "../src/barra/subagente-clave.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-pasos-subagente-"));
const proyectos = path.join(tmp, "claude", "projects");
const T0 = Date.parse("2026-03-10T12:00:00Z");
const hora = (s: number) => new Date(T0 + s * 1000).toISOString();
const U = { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 20 };
const l = (o: object) => JSON.stringify(o) + "\n";
const lado = { isSidechain: true, agentId: "ag1" };
const asist = (id: string, contenido: object[], s: number, stop: string | null = null) =>
  l({ ...lado, type: "assistant", timestamp: hora(s), message: { id, model: "claude-haiku-5-5", usage: U, stop_reason: stop, content: contenido } });
const resultado = (uso: string, texto: string, s: number) =>
  l({ ...lado, type: "user", timestamp: hora(s), message: { role: "user", content: [{ type: "tool_result", tool_use_id: uso, content: texto }] } });

// El líder (sesión `sid-l`) y la carpeta de sus subagentes.
const dirProy = path.join(proyectos, "-tmp-proy");
const subs = path.join(dirProy, "sid-l", "subagents");
mkdirSync(subs, { recursive: true });
writeFileSync(path.join(dirProy, "sid-l.jsonl"), l({ type: "user", timestamp: hora(0), message: { role: "user", content: "hola" } }));
const ruta = path.join(subs, "agent-ag1.jsonl");
writeFileSync(
  ruta,
  l({ ...lado, type: "user", timestamp: hora(1), message: { role: "user", content: "Contá los tests de cauce" } }) +
    asist("m1", [{ type: "tool_use", id: "tu1", name: "Bash", input: { command: "npm test -- cauce", description: "Corre los tests" } }], 2),
);

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function hasta(f: () => boolean, ms = 3000) {
  const fin = Date.now() + ms;
  while (!f() && Date.now() < fin) await esperar(20);
  assert.ok(f(), "no llegó a tiempo");
}

const avisos: CambioPasos[] = [];
const p = crearPasos({ proyectos, paState: path.join(tmp, "pa"), alCambiar: (c) => avisos.push(c), espera: 40 });
after(() => {
  p.soltar("ventana");
  p.soltar("celular");
});

test("la clave de un subagente va y vuelve", () => {
  assert.equal(claveSub("sid-l", "ag1"), "sub:sid-l:ag1");
  assert.deepEqual(deClaveSub("sub:sid-l:ag1"), { sid: "sid-l", id: "ag1" });
  assert.equal(deClaveSub("lider:sid-l"), null);
  assert.equal(deClaveSub(null), null);
});

test("corriendo: sus pasos, con el comando todavía en curso", async () => {
  const v = await p.mirar("ventana", claveSub("sid-l", "ag1"));
  assert.equal(v.hay, true);
  assert.deepEqual(
    v.pasos.map((x) => [x.tipo, x.titulo, x.estado]),
    [["correr", "npm test -- cauce", "corriendo"]],
  );
  assert.equal(v.encabezado.modelo, "claude-haiku-5-5");
  // Un subagente no tiene "tarea" propia (su prompt lo muestra el líder).
  assert.equal(v.encabezado.tarea, null);
});

test("lo que escribe llega por lotes, y al terminar su informe es el texto final", async () => {
  const v = await p.mirar("ventana", claveSub("sid-l", "ag1"));
  avisos.length = 0;
  appendFileSync(ruta, resultado("tu1", "12 pass\n0 fail", 9));
  appendFileSync(ruta, asist("m2", [{ type: "text", text: "Hay 12 tests y pasan todos." }], 10, "end_turn"));
  await hasta(() => avisos.some((c) => c.cambios.some((x) => x.tipo === "texto")));
  const c = avisos[avisos.length - 1];
  assert.equal(c.id, "sub:sid-l:ag1");
  assert.equal(c.gen, v.gen);
  const correr = c.cambios.find((x) => x.tipo === "correr");
  assert.equal(correr?.estado, "ok");
  assert.equal(correr?.detalle.clase === "correr" ? correr.detalle.salida?.t : null, "12 pass\n0 fail");
  const fin = c.cambios.find((x) => x.tipo === "texto");
  assert.ok(fin && fin.detalle.clase === "texto" && fin.detalle.final);
  assert.equal(fin.detalle.clase === "texto" ? fin.detalle.texto.t : "", "Hay 12 tests y pasan todos.");
  assert.equal(c.encabezado.turnos, 2);
});

test("ids que no son de un subagente, o uno que no existe: hay: false, sin romper", async () => {
  assert.equal((await p.mirar("celular", "sub:../..:ag1")).hay, false);
  assert.equal((await p.mirar("celular", "sub:sid-l:../../etc")).hay, false);
  assert.equal((await p.mirar("celular", "sub:sid-l")).hay, false);
  assert.equal((await p.mirar("celular", "sub:sid-x:ag1")).hay, false);
  assert.equal((await p.mirar("celular", "sub:sid-l:agZ")).hay, false);
});

test("un subagente que todavía no escribió aparece cuando lo hace (faltantes)", async () => {
  const v = await p.mirar("celular", claveSub("sid-l", "ag2"));
  assert.equal(v.hay, false);
  avisos.length = 0;
  writeFileSync(path.join(subs, "agent-ag2.jsonl"), asist("n1", [{ type: "text", text: "arranco" }], 20));
  p.faltantes();
  await hasta(() => avisos.some((c) => c.id === "sub:sid-l:ag2" && c.cambios.length === 1));
  p.soltar("celular");
});
