// «Te dejé esto en el tablero» (src/hilo/tablero-dejado.ts): qué llamadas de un líder y qué workers suyos cuentan como «dejó algo para la
// persona», y qué estado dice el tablero. Con un transcript inventado y un tablero armado a mano: nunca el real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { conversacionDe } from "../electron/lider-arma.ts";
import type { Mensaje } from "../src/datos/contrato.ts";
import { cartas, dejadoDeLlamada, dejadosDeAviso, dejadosDeMensaje, esDelWorker, sentencias } from "../src/hilo/tablero-dejado.ts";
import { turnos } from "../src/hilo/turnos.ts";
import { avisoDeTexto } from "../electron/avisos-worker.ts";
import { validar } from "../src/datos/tablero.ts";

const l = (o: unknown) => JSON.stringify(o) + "\n";
const bash = (command: string, salida: string | null, error = false) => ({ nombre: "Bash", entrada: { command }, resultado: salida === null ? undefined : { texto: salida, error } });

test("una pregunta, una prueba o algo en espera-dueno que devolvió su id cuenta", () => {
  assert.deepEqual(dejadoDeLlamada(bash(`tablero agregar "¿Publicamos ya?" --tipo pregunta --simple "¿Publico la 0.3?"`, "41\n")), { por: "llamada", id: 41, titulo: "¿Publico la 0.3?" });
  assert.deepEqual(dejadoDeLlamada(bash(`tablero agregar 'Probar el instalador' --prueba=./instalar.sh`, "42")), { por: "llamada", id: 42, titulo: "Probar el instalador" });
  assert.deepEqual(dejadoDeLlamada(bash(`~/.local/bin/tablero agregar --columna espera-dueno --proyecto trama -- "Elegir logo"`, "43")), { por: "llamada", id: 43, titulo: "Elegir logo" });
  assert.deepEqual(dejadoDeLlamada(bash(`cd /x && TABLERO_DIR=/t tablero agregar "Mirar la app" --prueba "abrir Trama"`, "44")), { por: "llamada", id: 44, titulo: "Mirar la app" });
});

test("sin id devuelto, con error, a medio correr o sin pedirle nada a la persona no cuenta", () => {
  // Corre todavía (sin resultado) o falló: no se sabe que haya quedado nada.
  assert.equal(dejadoDeLlamada(bash(`tablero agregar "x" --tipo pregunta`, null)), null);
  assert.equal(dejadoDeLlamada(bash(`tablero agregar "x" --tipo pregunta`, "tablero: no pude escribir", true)), null);
  assert.equal(dejadoDeLlamada(bash(`tablero agregar "x" --tipo pregunta`, "tablero: no pude escribir")), null);
  // Va a la bandeja (no le toca a la persona).
  assert.equal(dejadoDeLlamada(bash(`tablero agregar "refactor del puente"`, "45")), null);
  // Sólo nombra el comando.
  assert.equal(dejadoDeLlamada(bash(`echo 'tablero agregar x --tipo pregunta'`, "47")), null);
  assert.equal(dejadoDeLlamada(bash(`grep -rn "tablero agregar" docs/ --tipo pregunta`, "48")), null);
  assert.equal(dejadoDeLlamada(bash(`tablero listar --columna espera-dueno`, "49")), null);
  assert.equal(dejadoDeLlamada(bash(`tablero cerrar 12 --tipo pregunta`, "50")), null);
  // No es Bash.
  assert.equal(dejadoDeLlamada({ nombre: "Read", entrada: { command: `tablero agregar x --tipo pregunta` }, resultado: { texto: "51", error: false } }), null);
});

test("sentencias: respeta las comillas y las continuaciones de línea", () => {
  assert.deepEqual(sentencias(`a "b; c" && d 'e|f' \\\n g`), [["a", "b; c"], ["d", "e|f", "g"]]);
});

test("el transcript de un líder: la tarjeta sale de lo que de verdad devolvió tablero, y se pega al turno que la dejó", () => {
  const t =
    l({ type: "user", timestamp: "2026-11-05T10:00:00.000Z", message: { content: "dejame una pregunta" } }) +
    l({ type: "assistant", timestamp: "2026-11-05T10:00:01.000Z", message: { id: "m1", model: "claude-opus-5-5", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: `tablero agregar "¿Subimos la versión?" --tipo pregunta --simple "¿Subo la versión?"` } }] } }) +
    l({ type: "assistant", timestamp: "2026-11-05T10:00:02.000Z", message: { id: "m1", model: "claude-opus-5-5", content: [{ type: "tool_use", id: "t2", name: "Bash", input: { command: `tablero agregar "otra" --tipo pregunta` } }] } }) +
    l({ type: "user", timestamp: "2026-11-05T10:00:03.000Z", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "77" }, { type: "tool_result", tool_use_id: "t2", content: "tablero: sin permiso", is_error: true }] } }) +
    l({ type: "assistant", timestamp: "2026-11-05T10:00:04.000Z", message: { id: "m2", model: "claude-opus-5-5", content: [{ type: "text", text: "Listo, quedó en el tablero." }] } });
  const pagina = conversacionDe("00000000-0000-4000-8000-000000000001", "/t.jsonl", t);
  const msgs = pagina.mensajes as Mensaje[];
  const refs = msgs.flatMap((m) => dejadosDeMensaje(m.det));
  assert.deepEqual(refs, [{ por: "llamada", id: 77, titulo: "¿Subo la versión?" }]);
  // Y `turnos()` las lleva en el turno que las dejó.
  const turno = turnos(msgs, "/t.jsonl").find((x) => x.tipo === "turno");
  assert.ok(turno && turno.tipo === "turno");
  assert.deepEqual(turno.dejados, refs);
});

// --- El tablero ------------------------------------------------------------------------

const crudo = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  columna: "espera-dueno",
  proyecto: "trama",
  titulo: `item ${id}`,
  detalle: "",
  prueba: "",
  origen: "pa",
  clave: "",
  creado: "2026-11-05T10:00:00Z",
  tocado: "2026-11-05T10:00:00Z",
  ...extra,
});
const tablero = (colEspera: unknown[], hecho: unknown[] = [], pospuestos: unknown[] = []) =>
  validar({ version: 1, vista: { columnas: { "espera-dueno": colEspera, bandeja: [] }, contadores: {} }, hecho, proyectos: [], pospuestosLista: pospuestos, aviso: null });

test("cartas del líder: abierta, respondida, cerrada y, sin el tablero, sólo el título", () => {
  const refs = [{ por: "llamada" as const, id: 7, titulo: "de la llamada" }];
  const t1 = tablero([crudo(7, { titulo_simple: "¿Publico?", tipo: "pregunta" })]);
  assert.deepEqual(cartas(refs, t1).map((c) => [c.id, c.titulo, c.estado]), [[7, "¿Publico?", "abierto"]]);
  const t2 = tablero([crudo(7, { respuesta: { texto: "sí", fecha: "2026-11-05T11:00:00Z" } })]);
  assert.equal(cartas(refs, t2)[0].estado, "respondido");
  const t3 = tablero([], [crudo(7, { cerrado: "2026-11-05T12:00:00Z", columna: "hecho" })]);
  assert.equal(cartas(refs, t3)[0].estado, "cerrado");
  // Ya no está (cerrado hace más de lo que se guarda): lo dice igual, con el título de la llamada.
  assert.deepEqual(cartas(refs, tablero([])).map((c) => [c.titulo, c.estado]), [["de la llamada", "cerrado"]]);
  assert.deepEqual(cartas(refs, null).map((c) => [c.titulo, c.estado]), [["de la llamada", "sin-leer"]]);
});

test("cartas de un worker: por su clave pa:<id>, sólo lo que le toca a la persona o ya se cerró", () => {
  const w = "20261105-032349-2887600";
  const t = tablero(
    [
      crudo(1, { clave: `pa:${w}`, titulo_simple: "Decidir el nombre" }),
      crudo(2, { clave: `pa:${w}:p1`, tipo: "prueba", prueba: "abrir la app", titulo_simple: "Probar: abrir la app" }),
      crudo(3, { clave: `pa:${w}9:p1` }), // otro worker cuyo id empieza igual
      crudo(4, { clave: "doctor:trama:x" }),
    ],
    [crudo(5, { clave: `pa:${w}:2`, columna: "hecho", cerrado: "2026-11-05T12:00:00Z" })],
  );
  const c = cartas([{ por: "worker", worker: w }], t);
  assert.deepEqual(c.map((x) => [x.id, x.estado]), [[1, "abierto"], [2, "abierto"], [5, "cerrado"]]);
  assert.equal(c[1].tipo, "prueba");
  // Un worker que no dejó nada no genera tarjeta.
  assert.deepEqual(cartas([{ por: "worker", worker: "otro" }], t), []);
  assert.ok(esDelWorker(`pa:${w}`, w) && !esDelWorker(`pa:${w}9`, w));
});

test("los workers salen del aviso que Trama le manda a ese líder (por jefe_id), sin los que fallaron", () => {
  const a = avisoDeTexto(
    "[Aviso automático de Trama] Terminaron los 3 workers que lanzaste, 1 con falla:\n- «hacer A» (w-1): terminó pidiendo una decisión\n- «hacer B» (w-2): falló\n- «hacer C» (w-3): terminó\nRevisá cada uno con `pa --hilo <id>`.",
  );
  assert.ok(a);
  assert.deepEqual(dejadosDeAviso(a), [
    { por: "worker", worker: "w-1" },
    { por: "worker", worker: "w-3" },
  ]);
});

test("un aviso con el resultado compacto y la integración debajo sigue dando los mismos workers (sin inventar los de lo que cita el resultado)", () => {
  const a = avisoDeTexto(
    "[Aviso automático de Trama] Terminaron los 2 workers que lanzaste:\n- «hacer A» (w-1): terminó pidiendo una decisión.\n    Integración: espera integración: pide una decisión\n    RESULTADO: listo\n    DECISION: - «cuál» (w-9): terminó\n- «hacer B» (w-3): terminó.\n    Integración: integrada sola\nLo que falte, con `pa --hilo <id>`.",
  );
  assert.ok(a);
  assert.deepEqual(a.trabajos.map((t) => t.id), ["w-1", "w-3"]);
  assert.deepEqual(dejadosDeAviso(a), [
    { por: "worker", worker: "w-1" },
    { por: "worker", worker: "w-3" },
  ]);
  const uno = avisoDeTexto("[Aviso automático de Trama] Worker «hacer A» terminó. Id: w-1.\n    Integración: integrada sola\n    RESULTADO: hecho");
  assert.deepEqual(uno?.trabajos, [{ tarea: "hacer A", id: "w-1", falla: false, estado: "termino" }]);
});
