// El resumen de "seguir con otro modelo" (electron/resumen-traspaso.ts): sale del transcript con objetivo, archivos, decisiones, estado y
// qué sigue; ignora subagentes y ruido del sistema; respeta el tope y se puede leer de un archivo.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { extraerDatos, resumenDeTranscript, resumenTraspaso, TOPE_RESUMEN } from "../electron/resumen-traspaso.ts";

const usuario = (content: unknown, extra: object = {}) => JSON.stringify({ type: "user", message: { role: "user", content }, ...extra });
const asistente = (content: unknown[], extra: object = {}) => JSON.stringify({ type: "assistant", message: { role: "assistant", content }, ...extra });
const texto = (text: string) => ({ type: "text", text });
const uso = (name: string, input: object) => ({ type: "tool_use", id: "t1", name, input });

const TRANSCRIPT = [
  usuario("<system-reminder>reglas del proyecto</system-reminder>\nArreglá el login del proyecto demo: el botón no responde."),
  asistente([texto("Voy a mirar el componente."), uso("Read", { file_path: "/repo/src/login.tsx" })]),
  usuario([{ type: "tool_result", tool_use_id: "t1", content: "código" }]),
  asistente([texto("Decisión: uso un estado local en vez de un contexto.\nSupuesto: el backend ya valida."), uso("Edit", { file_path: "/repo/src/login.tsx" })]),
  asistente([uso("Edit", { file_path: "/repo/src/login.tsx" }), uso("Write", { file_path: "/repo/src/login.test.tsx" })]),
  asistente([uso("Bash", { command: "npx tsc --noEmit" }), uso("Bash", { command: "git commit -m 'fix: login'" })]),
  usuario("Y agregale un test del caso vacío."),
  asistente([uso("TodoWrite", { todos: [{ content: "Test del caso vacío", status: "pending" }, { content: "Arreglar el botón", status: "completed" }] })]),
  asistente([texto("Listo el botón.\nFalta: el test del caso vacío.\nPendiente: revisar el estilo.")]),
  // un subagente no cuenta
  asistente([uso("Edit", { file_path: "/repo/otro/secreto.ts" })], { isSidechain: true }),
  "esto no es json",
];

test("extraerDatos: objetivo sin el ruido del sistema, archivos únicos y verificaciones", () => {
  const d = extraerDatos(TRANSCRIPT);
  assert.equal(d.objetivo, "Arreglá el login del proyecto demo: el botón no responde.");
  assert.deepEqual(d.pedidos, ["Y agregale un test del caso vacío."]);
  assert.deepEqual(d.archivos, ["/repo/src/login.tsx", "/repo/src/login.test.tsx"]);
  assert.deepEqual(d.verificaciones, ["npx tsc --noEmit"]);
  assert.equal(d.commits, 1);
  assert.equal(d.decisiones.length, 2);
  assert.deepEqual(d.pendientes, ["Test del caso vacío"]);
  assert.deepEqual(d.hechos, ["Arreglar el botón"]);
});

test("resumenTraspaso: trae todas las secciones y el pedido extra", () => {
  const t = resumenTraspaso(TRANSCRIPT, { modeloAnterior: "claude-sonnet-5-5", motivo: "sin cupo", pedido: "Terminá sólo el test." });
  for (const s of ["# Traspaso", "claude-sonnet-5-5", "sin cupo", "## Objetivo", "## Qué sigue", "## Estado", "## Decisiones", "## Archivos que tocó", "## Verificaciones", "## Pedido para vos"])
    assert.ok(t.includes(s), `falta «${s}»`);
  assert.ok(t.includes("- Test del caso vacío"), "qué sigue sale de la lista de pasos pendientes");
  assert.ok(t.includes("/repo/src/login.test.tsx"));
  assert.ok(t.includes("Terminá sólo el test."));
  assert.ok(!t.includes("secreto.ts"), "lo de un subagente no entra");
  assert.ok(!t.includes("reglas del proyecto"), "el system-reminder no entra");
});

test("resumenTraspaso: sin lista de pasos, qué sigue sale de las líneas «Falta/Pendiente» del último mensaje", () => {
  const t = resumenTraspaso(TRANSCRIPT.filter((l) => !l.includes("TodoWrite")));
  assert.ok(t.includes("- Falta: el test del caso vacío."));
  assert.ok(t.includes("- Pendiente: revisar el estilo."));
});

test("resumenTraspaso: un transcript vacío igual da un texto usable", () => {
  const t = resumenTraspaso([]);
  assert.ok(t.includes("el transcript no trae el pedido original"));
  assert.ok(t.includes("no quedó anotado"));
});

test("resumenTraspaso: respeta el tope aunque haya cientos de archivos y mensajes enormes", () => {
  const muchos = [
    usuario("x".repeat(20_000)),
    ...Array.from({ length: 300 }, (_, i) => asistente([uso("Edit", { file_path: `/repo/src/${"d".repeat(80)}/archivo-${i}.ts` })])),
    asistente([texto(`${"y".repeat(10_000)}\nFalta: ${"z".repeat(5_000)}`)]),
  ];
  for (const tope of [TOPE_RESUMEN, 2500, 100]) {
    const t = resumenTraspaso(muchos, { tope });
    assert.ok([...t].length <= Math.max(800, tope), `tope ${tope}: salió de ${[...t].length}`);
    assert.ok(t.includes("## Objetivo"));
  }
  assert.ok(resumenTraspaso(muchos).includes("más"), "los archivos de más se resumen en una línea");
});

test("resumenDeTranscript: lee el archivo con el lector incremental; sin archivo o vacío da null", async () => {
  const d = mkdtempSync(path.join(os.tmpdir(), "trama-traspaso-"));
  const f = path.join(d, "s.jsonl");
  writeFileSync(f, `${TRANSCRIPT.join("\n")}\n`);
  const t = await resumenDeTranscript(f, { tope: 3000 });
  assert.ok(t?.includes("## Objetivo"));
  assert.equal(await resumenDeTranscript(path.join(d, "no-existe.jsonl")), null);
  writeFileSync(path.join(d, "vacio.jsonl"), "");
  assert.equal(await resumenDeTranscript(path.join(d, "vacio.jsonl")), null);
});
