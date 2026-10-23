// electron/pasos.ts: los pasos de un worker armados desde un transcript inventado: cada tipo, el
// encabezado, lo incremental (un transcript que crece) y los topes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ArmadorPasos, ColaDeLineas, TOPES, contarDiff, cortar, type Detalle, type Paso } from "../electron/pasos.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-pasos-"));
const T0 = Date.parse("2026-03-10T12:00:00Z");
const hora = (s: number) => new Date(T0 + s * 1000).toISOString();
let k = 0;
const nueva = (nombre = `t${k++}.jsonl`) => path.join(tmp, nombre);

type Bloque = Record<string, unknown>;
const U = { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 5 };
const linea = (o: object) => JSON.stringify(o) + "\n";
const tarea = (txt: string, s = 0) => linea({ type: "user", timestamp: hora(s), message: { role: "user", content: txt } });
/** Un mensaje del modelo con un bloque (una línea por bloque, con el mismo id y usage). */
const asist = (id: string, bloque: Bloque, s: number, mas: object = {}, stop: string | null = null) =>
  linea({ type: "assistant", timestamp: hora(s), effort: "high", ...mas, message: { id, model: "claude-opus-5-5", usage: U, stop_reason: stop, content: [bloque] } });
const uso = (tid: string, nombre: string, input: object) => ({ type: "tool_use", id: tid, name: nombre, input });
const resultado = (tid: string, content: unknown, s: number, tur?: object, mal = false) =>
  linea({ type: "user", timestamp: hora(s), toolUseResult: tur, message: { role: "user", content: [{ type: "tool_result", tool_use_id: tid, content, ...(mal ? { is_error: true } : {}) }] } });

const leer = async (txt: string, o = {}) => {
  const ruta = nueva();
  writeFileSync(ruta, txt);
  const a = new ArmadorPasos(ruta, o);
  await a.leer();
  return a;
};
const det = <C extends Detalle["clase"]>(p: Paso, clase: C) => {
  assert.equal(p.detalle.clase, clase);
  return p.detalle as Extract<Detalle, { clase: C }>;
};

test("pensó: un paso sin texto, con cuánto tardó", async () => {
  const a = await leer(tarea("hacé algo") + asist("m1", { type: "thinking", thinking: "", signature: "x" }, 3) + asist("m2", uso("tu1", "Read", { file_path: "/x/a.ts" }), 5));
  assert.equal(a.pasos[0].tipo, "pensar");
  assert.equal(a.pasos[0].dur, 3000);
  assert.equal(a.pasos[0].titulo, "");
  assert.equal(a.pasos[0].estado, "ok");
});

test("leyó: ruta, desde qué línea, cuántas y de cuántas", async () => {
  const a = await leer(
    tarea("t") +
      asist("m1", uso("tu1", "Read", { file_path: "/x/a.ts", offset: 10 }), 1) +
      resultado("tu1", "     10\thola\n     11\tchau", 2, { type: "text", file: { filePath: "/x/a.ts", startLine: 10, numLines: 2, totalLines: 99 } }),
  );
  const p = a.pasos[0];
  assert.equal(p.tipo, "leer");
  assert.equal(p.titulo, "/x/a.ts");
  assert.equal(p.dur, 1000);
  const d = det(p, "leer");
  assert.deepEqual([d.desde, d.lineas, d.total, d.imagen], [10, 2, 99, false]);
  assert.match(d.texto!.t, /hola/);
});

test("leyó una imagen: sin texto, marcada", async () => {
  const a = await leer(
    tarea("t") + asist("m1", uso("tu1", "Read", { file_path: "/x/f.png" }), 1) + resultado("tu1", [{ type: "image", source: { type: "base64", data: "AAAA" } }], 2, { type: "image" }),
  );
  const d = det(a.pasos[0], "leer");
  assert.equal(d.imagen, true);
  assert.equal(d.texto, null);
});

test("buscó: patrón, ruta y cuántos resultados", async () => {
  const a = await leer(
    tarea("t") +
      asist("m1", uso("g1", "Grep", { pattern: "foo\\(", path: "/x" }), 1) +
      resultado("g1", "/x/a.ts\n/x/b.ts", 2, { mode: "files_with_matches", numFiles: 2, filenames: ["/x/a.ts", "/x/b.ts"] }) +
      asist("m2", uso("g2", "Glob", { pattern: "**/*.ts" }), 3) +
      resultado("g2", "a.ts\nb.ts\nc.ts", 4, { numFiles: 3, filenames: [] }) +
      asist("m3", uso("g3", "Grep", { pattern: "zzz" }), 5) +
      resultado("g3", "No files found", 6, { mode: "files_with_matches", numFiles: 0, filenames: [] }),
  );
  assert.deepEqual(a.pasos.map((p) => p.tipo), ["buscar", "buscar", "buscar"]);
  const [x, y, z] = a.pasos.map((p) => det(p, "buscar"));
  assert.deepEqual([x.patron, x.ruta, x.resultados], ["foo\\(", "/x", 2]);
  assert.equal(y.resultados, 3);
  assert.equal(z.resultados, 0);
});

test("editó: el cambio, replace_all, la línea y lo que suma y quita", async () => {
  const a = await leer(
    tarea("t") +
      asist("m1", uso("e1", "Edit", { file_path: "/x/a.ts", old_string: "uno\ndos", new_string: "uno\nDOS\ntres", replace_all: true }), 1) +
      resultado("e1", "ok", 2, { filePath: "/x/a.ts", structuredPatch: [{ oldStart: 40, oldLines: 4, newStart: 40, newLines: 5, lines: [" ctx1", " ctx2", " uno", "-dos", "+DOS", "+tres", " ctx3"] }] }),
  );
  const p = a.pasos[0];
  assert.equal(p.tipo, "editar");
  const d = det(p, "editar");
  assert.equal(d.cambios[0].todo, true);
  assert.equal(d.cambios[0].viejo.t, "uno\ndos");
  assert.equal(d.cambios[0].nuevo.t, "uno\nDOS\ntres");
  // Primer cambio: oldStart 40 + 3 líneas de contexto.
  assert.equal(d.cambios[0].desde, 43);
  assert.deepEqual([d.mas, d.menos], [2, 1]);
  const h = a.encabezado();
  assert.deepEqual(h.archivos, [{ ruta: "/x/a.ts", mas: 2, menos: 1, ediciones: 1, nuevo: false }]);
  assert.deepEqual([h.mas, h.menos], [2, 1]);
});

test("editó sin parche en la respuesta: la cuenta sale de viejo y nuevo; si falló no suma", async () => {
  const a = await leer(
    tarea("t") +
      asist("m1", uso("e1", "Edit", { file_path: "/x/a.ts", old_string: "a\nb\nc", new_string: "a\nB\nc\nd" }), 1) +
      resultado("e1", "ok", 2, {}) +
      asist("m2", uso("e2", "Edit", { file_path: "/x/b.ts", old_string: "q", new_string: "r" }), 3) +
      resultado("e2", "<tool_use_error>String to replace not found in file.</tool_use_error>", 4, undefined, true),
  );
  const [e1, e2] = a.pasos.map((p) => det(p, "editar"));
  assert.deepEqual([e1.mas, e1.menos], [2, 1]);
  assert.deepEqual([e2.mas, e2.menos], [0, 0]);
  assert.equal(a.pasos[1].estado, "fallo");
  assert.match(a.pasos[1].error!, /not found/);
  assert.deepEqual(a.encabezado().archivos.map((f) => f.ruta), ["/x/a.ts"]);
});

test("MultiEdit: cada cambio, con tope", async () => {
  const edits = Array.from({ length: TOPES.cambios + 5 }, (_, i) => ({ old_string: `v${i}`, new_string: `n${i}` }));
  const a = await leer(tarea("t") + asist("m1", uso("e1", "MultiEdit", { file_path: "/x/a.ts", edits }), 1) + resultado("e1", "ok", 2, {}));
  const d = det(a.pasos[0], "editar");
  assert.equal(d.cambios.length, TOPES.cambios);
  assert.equal(d.masCambios, 5);
});

test("escribió: archivo, contenido, nuevo o no y líneas", async () => {
  const a = await leer(
    tarea("t") +
      asist("m1", uso("w1", "Write", { file_path: "/x/nuevo.ts", content: "a\nb\nc\n" }), 1) +
      resultado("w1", "ok", 2, { type: "create", filePath: "/x/nuevo.ts", content: "a\nb\nc\n", structuredPatch: [], originalFile: null }) +
      asist("m2", uso("w2", "Write", { file_path: "/x/viejo.ts", content: "a\nB\nc\n" }), 3) +
      resultado("w2", "ok", 4, { type: "update", filePath: "/x/viejo.ts", originalFile: "a\nb\nc\n", structuredPatch: [] }),
  );
  const [n, v] = a.pasos.map((p) => det(p, "escribir"));
  assert.equal(a.pasos[0].tipo, "escribir");
  assert.deepEqual([n.nuevo, n.lineas, n.mas, n.menos, n.contenido.t], [true, 3, 3, 0, "a\nb\nc\n"]);
  assert.deepEqual([v.nuevo, v.mas, v.menos], [false, 1, 1]);
  const h = a.encabezado();
  assert.equal(h.archivos.find((f) => f.ruta === "/x/nuevo.ts")!.nuevo, true);
  assert.deepEqual([h.mas, h.menos], [4, 1]);
});

test("corrió: comando, descripción, salida y código; fallo con su motivo", async () => {
  const a = await leer(
    tarea("t") +
      asist("m1", uso("b1", "Bash", { command: "npm test\necho listo", description: "Corre los tests" }), 1) +
      resultado("b1", "42 pass", 6, { stdout: "42 pass\n", stderr: "", interrupted: false }) +
      asist("m2", uso("b2", "Bash", { command: "false" }), 7) +
      resultado("b2", "Exit code 3\nboom: no anda", 8, undefined, true) +
      asist("m3", uso("b3", "Bash", { command: "sleep 99", run_in_background: true }), 9) +
      resultado("b3", "lanzado", 9, { stdout: "", stderr: "", interrupted: false, backgroundTaskId: "bg1" }),
  );
  const [ok, mal, fondo] = a.pasos;
  assert.equal(ok.tipo, "correr");
  assert.equal(ok.titulo, "npm test");
  assert.equal(ok.dur, 5000);
  const d = det(ok, "correr");
  assert.deepEqual([d.descripcion, d.codigo, d.salida!.t, d.comando.t], ["Corre los tests", 0, "42 pass\n", "npm test\necho listo"]);
  assert.equal(mal.estado, "fallo");
  const m = det(mal, "correr");
  assert.equal(m.codigo, 3);
  assert.equal(m.salida!.t, "boom: no anda");
  assert.equal(mal.error, "boom: no anda");
  assert.equal(det(fondo, "correr").fondo, true);
});

test("sin resultado todavía el paso está corriendo", async () => {
  const a = await leer(tarea("t") + asist("m1", uso("b1", "Bash", { command: "make" }), 1));
  assert.equal(a.pasos[0].estado, "corriendo");
  assert.equal(a.pasos[0].dur, null);
});

test("delegó: descripción, prompt y respuesta; con el transcript del subagente, sus pasos anidados", async () => {
  const ruta = nueva("s1.jsonl");
  const sub = path.join(tmp, "s1", "subagents");
  mkdirSync(sub, { recursive: true });
  const sidechain = { isSidechain: true, agentId: "ag1" };
  writeFileSync(
    path.join(sub, "agent-ag1.jsonl"),
    linea({ type: "user", timestamp: hora(11), isSidechain: true, message: { role: "user", content: "Buscá los usos de foo" } }) +
      asist("s-m1", uso("st1", "Grep", { pattern: "foo" }), 12, sidechain) +
      resultado("st1", "/x/a.ts", 13, { mode: "files_with_matches", numFiles: 1, filenames: [] }) +
      asist("s-m2", { type: "text", text: "Está en a.ts" }, 14, sidechain, "end_turn"),
  );
  writeFileSync(
    ruta,
    tarea("t") +
      asist("m1", uso("a1", "Agent", { description: "Buscar usos", subagent_type: "Explore", model: "haiku", prompt: "Buscá los usos de foo" }), 10) +
      resultado("a1", [{ type: "text", text: "Está en a.ts" }], 20, { status: "completed", agentId: "ag1", totalTokens: 1234, totalToolUseCount: 1, totalDurationMs: 9000 }),
  );
  const a = new ArmadorPasos(ruta, { carpetaSub: sub });
  assert.equal(await a.leer(), true);
  const p = a.pasos[0];
  assert.equal(p.tipo, "delegar");
  assert.equal(p.dur, 9000);
  const d = det(p, "delegar");
  assert.deepEqual([d.descripcion, d.agente, d.modelo, d.agentId, d.tokens, d.usos, d.respuesta!.t, d.fondo], ["Buscar usos", "Explore", "haiku", "ag1", 1234, 1, "Está en a.ts", false]);
  assert.deepEqual(d.pasos.map((x) => x.tipo), ["buscar", "texto"]);
  assert.equal(det(d.pasos[1], "texto").final, true);
  // Los tokens del subagente entran al encabezado.
  assert.equal(a.encabezado().tokens.salida, 5 + 10);
});

test("delegó sin transcript del subagente: sin pasos anidados, sin romper", async () => {
  const sub = path.join(tmp, "no-existe", "subagents");
  const a = await leer(
    tarea("t") + asist("m1", uso("a1", "Task", { description: "d", prompt: "p" }), 1) + resultado("a1", "listo", 2, { agentId: "agX", status: "completed" }),
    { carpetaSub: sub },
  );
  assert.deepEqual(det(a.pasos[0], "delegar").pasos, []);
});

test("delegó en segundo plano: la respuesta es 'lanzado', no lo que tardó", async () => {
  const a = await leer(
    tarea("t") + asist("m1", uso("a1", "Agent", { description: "d", prompt: "p", run_in_background: true }), 1) + resultado("a1", "Async agent launched", 2, { isAsync: true, status: "async_launched", agentId: "agB" }),
  );
  const d = det(a.pasos[0], "delegar");
  assert.equal(d.fondo, true);
  assert.equal(d.respuesta, null);
  assert.equal(a.pasos[0].dur, null);
});

test("texto final: el RESULTADO, y el texto del medio no es final", async () => {
  const a = await leer(tarea("t") + asist("m1", { type: "text", text: "Voy a mirar." }, 1) + asist("m2", { type: "text", text: "RESULTADO: listo" }, 2, {}, "end_turn"));
  assert.deepEqual(a.pasos.map((p) => det(p, "texto").final), [false, true]);
  assert.equal(a.pasos[1].titulo, "RESULTADO: listo");
});

test("herramienta desconocida: un paso 'otro' con su entrada", async () => {
  const a = await leer(tarea("t") + asist("m1", uso("x1", "TodoWrite", { todos: [] }), 1) + resultado("x1", "ok", 2, {}));
  assert.equal(a.pasos[0].tipo, "otro");
  assert.equal(det(a.pasos[0], "otro").nombre, "TodoWrite");
});

test("encabezado: modelo, turnos sin duplicar, tokens, caché, duración, tarea", async () => {
  const a = await leer(
    tarea("Hacé la pieza 1", 0) +
      // Un mensaje en dos líneas (mismo id): un turno.
      asist("m1", { type: "thinking", thinking: "" }, 2) +
      asist("m1", uso("r1", "Read", { file_path: "/x/a" }), 2) +
      resultado("r1", "x", 3, { file: { startLine: 1, numLines: 1, totalLines: 1 } }) +
      asist("m2", { type: "text", text: "listo" }, 10, {}, "end_turn"),
  );
  const h = a.encabezado();
  assert.equal(h.tarea, "Hacé la pieza 1");
  assert.equal(h.modelo, "claude-opus-5-5");
  assert.equal(h.effort, "high");
  assert.equal(h.turnos, 2);
  assert.deepEqual(h.tokens, { entrada: 20, cacheCreado: 200, cacheLeido: 2000, salida: 10 });
  assert.equal(h.total, 2230);
  assert.ok(Math.abs(h.cache! - 2000 / 2220) < 1e-9);
  assert.equal(h.dur, 10_000);
  assert.equal(h.inicio, T0);
  assert.equal(h.pasos, 3);
});

test("compactaciones se cuentan; lo de un subagente en el transcript principal no entra", async () => {
  const a = await leer(
    tarea("t") +
      linea({ type: "system", subtype: "compact_boundary", timestamp: hora(1) }) +
      asist("m1", { type: "text", text: "de un subagente" }, 2, { isSidechain: true }) +
      asist("m2", { type: "text", text: "propio" }, 3),
  );
  assert.equal(a.encabezado().compactaciones, 1);
  assert.deepEqual(a.pasos.map((p) => p.titulo), ["propio"]);
});

test("incremental: sólo lee lo que creció, con revisiones y cambios desde una revisión", async () => {
  const ruta = nueva();
  writeFileSync(ruta, tarea("t") + asist("m1", uso("b1", "Bash", { command: "make" }), 1));
  const a = new ArmadorPasos(ruta);
  assert.equal(await a.leer(), true);
  assert.equal(a.pasos.length, 1);
  assert.equal(a.pasos[0].estado, "corriendo");
  const v1 = a.v;
  const gen = a.gen;
  // Sin cambios: nada.
  assert.equal(await a.leer(), false);
  assert.equal(a.v, v1);
  // Llega el resultado y un paso nuevo; la línea de abajo queda a medias.
  const nuevo = resultado("b1", "ok", 5, { stdout: "ok", stderr: "" }) + asist("m2", uso("b2", "Read", { file_path: "/x/z" }), 6);
  const media = asist("m3", { type: "text", text: "texto entero" }, 7);
  appendFileSync(ruta, nuevo + media.slice(0, 20));
  assert.equal(await a.leer(), true);
  assert.equal(a.pasos.length, 2);
  assert.equal(a.pasos[0].estado, "ok");
  assert.equal(a.gen, gen);
  const c = a.cambio("w", v1);
  assert.deepEqual(c.cambios.map((p) => p.id), ["b1", "b2"]);
  assert.equal(c.total, 2);
  assert.equal(c.v, a.v);
  // Se completa la línea.
  const v2 = a.v;
  appendFileSync(ruta, media.slice(20));
  await a.leer();
  assert.deepEqual(a.cambiosDesde(v2).map((p) => p.tipo), ["texto"]);
  assert.equal(a.pasos.length, 3);
});

test("incremental: no vuelve a leer lo viejo", async () => {
  const ruta = nueva();
  writeFileSync(ruta, tarea("t") + asist("m1", { type: "text", text: "uno" }, 1));
  const cola = new ColaDeLineas();
  const vistas: string[] = [];
  await cola.avanzar(ruta, (l) => vistas.push(l), () => {});
  assert.equal(vistas.length, 2);
  appendFileSync(ruta, asist("m2", { type: "text", text: "dos" }, 2));
  await cola.avanzar(ruta, (l) => vistas.push(l), () => {});
  assert.equal(vistas.length, 3);
  assert.match(vistas[2], /dos/);
});

test("un transcript reescrito o achicado se arma de nuevo (sube gen)", async () => {
  const ruta = nueva();
  writeFileSync(ruta, tarea("t") + asist("m1", { type: "text", text: "uno" }, 1) + asist("m2", { type: "text", text: "dos" }, 2));
  const a = new ArmadorPasos(ruta);
  await a.leer();
  assert.equal(a.pasos.length, 2);
  const gen = a.gen;
  // Más corto: es otro.
  writeFileSync(ruta, tarea("t") + asist("m9", { type: "text", text: "nuevo" }, 1));
  assert.equal(await a.leer(), true);
  assert.equal(a.gen, gen + 1);
  assert.deepEqual(a.pasos.map((p) => p.titulo), ["nuevo"]);
  // Otro inodo, aunque sea más largo.
  const otro = nueva("otro.jsonl");
  writeFileSync(otro, tarea("t") + asist("m5", { type: "text", text: "a" }, 1) + asist("m6", { type: "text", text: "b" }, 2) + asist("m7", { type: "text", text: "c" }, 3));
  renameSync(otro, ruta);
  await a.leer();
  assert.equal(a.gen, gen + 2);
  assert.deepEqual(a.pasos.map((p) => p.titulo), ["a", "b", "c"]);
});

test("un transcript que todavía no existe no rompe y aparece después", async () => {
  const ruta = nueva();
  const a = new ArmadorPasos(ruta);
  assert.equal(await a.leer(), false);
  assert.equal(a.pasos.length, 0);
  writeFileSync(ruta, tarea("t") + asist("m1", { type: "text", text: "hola" }, 1));
  assert.equal(await a.leer(), true);
  assert.equal(a.pasos.length, 1);
});

test("topes: salida, diff y escrito largos se cortan con su marca y su tamaño", async () => {
  const grande = "x".repeat(TOPES.salida * 3);
  const viejo = "v\n".repeat(TOPES.lado);
  const a = await leer(
    tarea("t") +
      asist("m1", uso("b1", "Bash", { command: "yes" }), 1) +
      resultado("b1", grande, 2, { stdout: grande, stderr: "" }) +
      asist("m2", uso("e1", "Edit", { file_path: "/x/a", old_string: viejo, new_string: "n" }), 3) +
      resultado("e1", "ok", 4, {}) +
      asist("m3", uso("w1", "Write", { file_path: "/x/b", content: "y".repeat(TOPES.escrito * 2) }), 5) +
      resultado("w1", "ok", 6, { type: "create" }),
  );
  const s = det(a.pasos[0], "correr").salida!;
  assert.equal(s.recortado, true);
  assert.equal(s.total, grande.length);
  assert.ok(s.t.length <= TOPES.salida + 80);
  assert.match(s.t, /omitidos/);
  const c = det(a.pasos[1], "editar").cambios[0];
  assert.equal(c.viejo.recortado, true);
  assert.equal(c.viejo.total, viejo.length);
  assert.ok(c.viejo.t.length <= TOPES.lado);
  assert.equal(c.nuevo.recortado, false);
  const w = det(a.pasos[2], "escribir");
  assert.equal(w.contenido.recortado, true);
  assert.equal(w.contenido.total, TOPES.escrito * 2);
  // La cuenta de líneas sale del texto entero, no del recortado.
  assert.equal(w.lineas, 1);
});

test("topes: pasos viejos se descartan sin reusar números, y se cuenta cuántos", async () => {
  let txt = tarea("t");
  const n = TOPES.pasos + 250;
  for (let i = 0; i < n; i++) txt += asist(`m${i}`, { type: "text", text: `paso ${i}` }, i);
  const a = await leer(txt);
  assert.equal(a.encabezado().pasos, n);
  assert.equal(a.omitidos + a.pasos.length, n);
  assert.ok(a.pasos.length <= TOPES.pasos + 100);
  assert.equal(a.pasos[0].n, a.omitidos);
  assert.equal(a.pasos.at(-1)!.n, n - 1);
});

test("una línea enorme (una captura) se saltea sin romper lo que sigue", async () => {
  const ruta = nueva();
  writeFileSync(ruta, tarea("t") + linea({ type: "attachment", data: "z".repeat(5 * 1024 * 1024) }) + asist("m1", { type: "text", text: "después" }, 1));
  const a = new ArmadorPasos(ruta);
  await a.leer();
  assert.deepEqual(a.pasos.map((p) => p.titulo), ["después"]);
});

test("cortar: cabeza no deja una línea a medias; extremos conserva el final", () => {
  const texto = Array.from({ length: 100 }, (_, i) => `linea ${i}`).join("\n");
  const c = cortar(texto, 200);
  assert.equal(c.recortado, true);
  assert.ok(c.t.endsWith("\n") === false && texto.startsWith(c.t));
  assert.ok(c.t.length <= 200);
  const e = cortar(texto, 200, "extremos");
  assert.ok(e.t.startsWith("linea 0") && e.t.endsWith("linea 99"));
  assert.deepEqual(cortar("corto", 10), { t: "corto", total: 5, recortado: false });
});

test("contarDiff: lo común no cuenta", () => {
  assert.deepEqual(contarDiff("a\nb\nc", "a\nB\nc"), { mas: 1, menos: 1 });
  assert.deepEqual(contarDiff("", "a\nb"), { mas: 2, menos: 0 });
  assert.deepEqual(contarDiff("a\nb", ""), { mas: 0, menos: 2 });
  assert.deepEqual(contarDiff("a\nb\nc\nd", "a\nc\nd\ne"), { mas: 1, menos: 1 });
});
