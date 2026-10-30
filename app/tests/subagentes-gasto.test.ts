// Los subagentes de un líder y lo que gastó cada uno: una sesión inventada con 2 subagentes (uno terminado en Haiku, otro corriendo
// en Sonnet). Nada de datos reales: ids, rutas y tareas son de ejemplo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Acumulado, juntar, sinLado, ventanaSub } from "../electron/subagentes-gasto.ts";
import { carpetaDeSubagentes, crearGastos } from "../electron/subagentes-gasto-disco.ts";
import { desdeTranscript } from "../electron/contexto-desglose.ts";
import { leerCarpeta } from "../electron/subagentes.ts";

const SID = "11111111-2222-3333-4444-555555555555";
const linea = (o: object) => JSON.stringify(o) + "\n";
const usoDe = (entrada: number, creado: number, leido: number, salida: number) => ({ input_tokens: entrada, cache_creation_input_tokens: creado, cache_read_input_tokens: leido, output_tokens: salida });
const lado = { isSidechain: true, sessionId: SID, cwd: "/tmp/proyecto-ejemplo" };
const pedido = (ts: string, texto: string) => linea({ ...lado, type: "user", timestamp: ts, message: { role: "user", content: texto } });
const forma = linea({ type: "api-request-shape", sessionId: SID, timestamp: "2026-10-30T10:00:00.000Z", shape: { system: [{ type: "text", text: "Sos un agente de ejemplo.".repeat(40) }], tools: [{ name: "Bash", description: "x".repeat(300) }, { name: "Read", description: "y".repeat(150) }] } });
/** Un mensaje del modelo; `bloques` lo escribe en varias líneas con el mismo id y el mismo usage, como hace Claude Code. */
function mensaje(id: string, ts: string, modelo: string, uso: object, bloques: object[], stop = "tool_use") {
  return bloques.map((b) => linea({ ...lado, type: "assistant", timestamp: ts, message: { id, model: modelo, stop_reason: stop, usage: uso, content: [b] } })).join("");
}
const leer = (id: string, dir: string) => readFileSync(path.join(dir, `agent-${id}.jsonl`), "utf8");
const vuelta = (ts: string) => linea({ ...lado, type: "user", timestamp: ts, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }] } });

/** Una sesión con 2 subagentes: `a111` (Haiku, terminó) y `b222` (Sonnet, sigue corriendo). */
function sesion() {
  const raiz = mkdtempSync(path.join(tmpdir(), "trama-sub-gasto-"));
  const transcript = path.join(raiz, `${SID}.jsonl`);
  const dir = carpetaDeSubagentes(transcript);
  mkdirSync(dir, { recursive: true });
  writeFileSync(transcript, linea({ type: "user", timestamp: "2026-10-30T09:59:00.000Z", message: { role: "user", content: "audita los lotes" } }));
  const a =
    forma +
    pedido("2026-10-30T10:00:00.000Z", "Revisá el lote 1") +
    mensaje("m1", "2026-10-30T10:00:03.000Z", "claude-haiku-5-5", usoDe(2, 4000, 0, 300), [{ type: "text", text: "Voy" }, { type: "tool_use", id: "u1", name: "Read", input: { file_path: "/tmp/a" } }]) +
    vuelta("2026-10-30T10:00:05.000Z") +
    mensaje("m2", "2026-10-30T10:00:09.000Z", "claude-haiku-5-5", usoDe(3, 500, 4000, 1200), [{ type: "tool_use", id: "u2", name: "Bash", input: { command: "ls" } }]) +
    vuelta("2026-10-30T10:00:11.000Z") +
    mensaje("m3", "2026-10-30T10:00:20.000Z", "claude-haiku-5-5", usoDe(1, 200, 4500, 500), [{ type: "text", text: "Listo: sin hallazgos." }], "end_turn");
  writeFileSync(path.join(dir, "agent-a111.jsonl"), a);
  writeFileSync(path.join(dir, "agent-a111.meta.json"), JSON.stringify({ agentType: "general-purpose", description: "Auditar lote 1", toolUseId: "toolu_AAA", requestShape: "background", model: "haiku" }));
  const b =
    pedido("2026-10-30T10:01:00.000Z", "Revisá el lote 2") +
    mensaje("n1", "2026-10-30T10:01:03.000Z", "claude-sonnet-5-5", usoDe(5, 9000, 0, 800), [{ type: "tool_use", id: "v1", name: "Bash", input: { command: "ls" } }]);
  writeFileSync(path.join(dir, "agent-b222.jsonl"), b);
  writeFileSync(path.join(dir, "agent-b222.meta.json"), JSON.stringify({ agentType: "Explore", description: "Mapear el lote 2", toolUseId: "toolu_BBB", requestShape: "background" }));
  return { raiz, transcript, dir };
}

test("suma el usage de cada pedido una sola vez aunque el mensaje venga en varias líneas, y dice cuánto pesa su ventana", () => {
  const { raiz, dir } = sesion();
  try {
    const a = new Acumulado();
    for (const l of leer("a111", dir).split("\n")) a.linea(l);
    assert.deepEqual(a.tokens, { entrada: 6, cacheCreado: 4700, cacheLeido: 8500, salida: 2000, total: 15206 });
    assert.equal(a.pedidos, 3);
    assert.equal(a.herramientas, 2);
    assert.equal(a.contexto, 1 + 200 + 4500);
    assert.equal(a.modeloId, "claude-haiku-5-5");
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("lista los 2 subagentes con su llamada, modelo, estado y gasto; el total junta los dos", async () => {
  const { raiz, dir } = sesion();
  try {
    const g = await crearGastos().listar(dir, SID);
    assert.equal(g.subagentes.length, 2);
    const a = g.subagentes.find((s) => s.id === "a111")!;
    const b = g.subagentes.find((s) => s.id === "b222")!;
    assert.equal(a.llamada, "toolu_AAA");
    assert.equal(a.descripcion, "Auditar lote 1");
    assert.equal(a.modelo, "Haiku 5.5");
    assert.equal(a.estado, "terminado");
    assert.equal(a.tokens.total, 15206);
    assert.equal(a.ventana, 200_000);
    assert.equal(b.llamada, "toolu_BBB");
    assert.equal(b.tipo, "Explore");
    assert.equal(b.modelo, "Sonnet 5.5");
    assert.equal(b.estado, "corriendo");
    assert.equal(b.tokens.total, 5 + 9000 + 800);
    assert.equal(b.contexto, 9005);
    assert.equal(b.ventana, 1_000_000);
    assert.equal(g.total.total, a.tokens.total + b.tokens.total);
    assert.equal(g.total.salida, 2800);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("al crecer un transcript sólo se lee lo agregado, y una línea a medio escribir espera a la próxima", async () => {
  const { raiz, dir } = sesion();
  try {
    const gastos = crearGastos();
    assert.equal((await gastos.listar(dir, SID)).subagentes.find((s) => s.id === "b222")!.pedidos, 1);
    const nueva = mensaje("n2", "2026-10-30T10:01:30.000Z", "claude-sonnet-5-5", usoDe(1, 100, 9005, 400), [{ type: "text", text: "Hecho" }], "end_turn");
    appendFileSync(path.join(dir, "agent-b222.jsonl"), nueva.slice(0, 60));
    assert.equal((await gastos.listar(dir, SID)).subagentes.find((s) => s.id === "b222")!.pedidos, 1);
    appendFileSync(path.join(dir, "agent-b222.jsonl"), nueva.slice(60));
    const b = (await gastos.listar(dir, SID)).subagentes.find((s) => s.id === "b222")!;
    assert.equal(b.pedidos, 2);
    assert.equal(b.tokens.salida, 1200);
    assert.equal(b.contexto, 1 + 100 + 9005);
    // Un archivo que se achicó (se rehízo) se cuenta de nuevo, no se arrastra lo viejo.
    writeFileSync(path.join(dir, "agent-b222.jsonl"), pedido("2026-10-30T10:01:00.000Z", "otra vez"));
    assert.equal((await gastos.listar(dir, SID)).subagentes.find((s) => s.id === "b222")!.pedidos, 0);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("una carpeta sin subagentes da una lista vacía, y el id de la llamada viaja en el subagente", async () => {
  const raiz = mkdtempSync(path.join(tmpdir(), "trama-sub-gasto-"));
  try {
    const g = await crearGastos().listar(path.join(raiz, "no-hay"), SID);
    assert.deepEqual(g, juntar(SID, []));
    assert.equal(g.total.total, 0);
    const { dir } = sesion();
    assert.equal((await leerCarpeta(dir, SID)).find((u) => u.id === "a111")?.tool_use_id, "toolu_AAA");
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("el desglose de un subagente sale de su transcript como el de un worker, con su ventana y sin inventar memoria", () => {
  const { raiz, dir } = sesion();
  try {
    const ls = leer("a111", dir).split("\n").filter(Boolean);
    const d = desdeTranscript(sinLado(ls), { tipo: "subagente", id: "a111", motor: "claude", memoria: [], skills: [] });
    assert.equal(d.quien.tipo, "subagente");
    assert.equal(d.fuente, "transcript");
    assert.equal(d.modelo, "claude-haiku-5-5");
    // Lo que pesa su ventana es el último pedido, no la suma de todos.
    assert.equal(d.usado, 1 + 200 + 4500);
    assert.ok(d.categorias.some((c) => c.id === "sistema" && c.tokens > 0));
    assert.ok(d.categorias.some((c) => c.id === "herramientas" && c.tokens > 0));
    assert.deepEqual(d.herramientas.map((h) => [h.nombre, h.usos]), [["Bash", 1], ["Read", 1]]);
    assert.equal(d.memoria.length, 0);
    // Sin quitarle la marca de subagente, el lector lo ignora todo: por eso `sinLado`.
    assert.equal(desdeTranscript(ls, { tipo: "subagente", id: "a111", motor: "claude", memoria: [], skills: [] }).usado, null);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("la ventana del subagente: 200 mil en Haiku, 1 millón en los demás", () => {
  assert.equal(ventanaSub("claude-haiku-5-5"), 200_000);
  assert.equal(ventanaSub("Haiku 5.5"), 200_000);
  assert.equal(ventanaSub("claude-opus-5-5"), 1_000_000);
  assert.equal(ventanaSub(null), 1_000_000);
});
