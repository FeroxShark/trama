// Volver acá, Editar y Ramificar un mensaje de un líder: los argumentos de `claude`, el uuid de cada mensaje y la rama.
// Todo con transcripts inventados: nunca se abre uno real. Detalle: docs/estado/rebobinar.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { argvLider, avanzarConv, convNueva, hastaUuid, leerGuardados, paginaDe } from "../electron/lider-arma.ts";
import { turnos } from "../src/hilo/turnos.ts";

const SID = "36ac312b-6241-4230-b3b3-c3decacc39c0";
const OTRO = "0a1b2c3d-1111-4222-8333-444455556666";
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const base = { modelo: "claude-opus-5-5", effort: "high", sid: SID, nombre: "trama-0a1b" };

const linea = (o: object) => JSON.stringify(o) + "\n";
const user = (uuid: string, parentUuid: string | null, texto: string) =>
  linea({ type: "user", uuid, parentUuid, timestamp: "2026-10-26T10:00:00Z", message: { role: "user", content: texto } });
const asist = (uuid: string, parentUuid: string, texto: string, id = `msg_${uuid.slice(-3)}`) =>
  linea({
    type: "assistant",
    uuid,
    parentUuid,
    timestamp: "2026-10-26T10:00:05Z",
    message: { id, role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: texto }], usage: { input_tokens: 5, output_tokens: 5 } },
  });

/** u1 pide, u2 contesta, u3 pide, u4 contesta. */
const charla = user(U(1), null, "uno") + asist(U(2), U(1), "dos") + user(U(3), U(2), "tres") + asist(U(4), U(3), "cuatro");

// --- Los argumentos de `claude` ---

test("volver a un mensaje: --resume con --resume-session-at, sin compactar ni resumir", () => {
  const a = argvLider({ ...base, resume: true, desde: U(2) });
  const i = a.indexOf("--resume");
  assert.deepEqual(a.slice(i, i + 4), ["--resume", SID, "--resume-session-at", U(2)]);
  assert.ok(!a.includes("--fork-session") && !a.includes("--session-id"));
  assert.ok(!a.some((x) => /compact|summar/i.test(x)), "ningún argumento compacta ni resume");
});

test("editar es volver al mensaje de antes: el mismo argv, con el uuid de ese mensaje", () => {
  const a = argvLider({ ...base, resume: true, desde: U(2) });
  assert.equal(a[a.indexOf("--resume-session-at") + 1], U(2));
  assert.equal(a.filter((x) => x === "--resume").length, 1);
});

test("un líder sin proceso (Murió) se rebobina con el mismo argv que uno vivo", () => {
  // `lanzar` no distingue: sin proceso y con proceso ocioso salen por `argvLider` con `resume` y `desde`.
  const vivo = argvLider({ ...base, resume: true, desde: U(2) });
  const muerto = argvLider({ ...base, resume: true, desde: U(2), modo: "default" });
  assert.deepEqual(muerto.filter((x) => x.startsWith("--resume")), vivo.filter((x) => x.startsWith("--resume")));
  assert.ok(!muerto.some((x) => /compact/i.test(x)));
});

test("retomar sin punto sigue siendo --resume a secas", () => {
  const a = argvLider({ ...base, resume: true });
  assert.ok(a.includes("--resume") && !a.includes("--resume-session-at"));
});

test("ramificar: sesión nueva bifurcada de la de origen hasta un mensaje", () => {
  const a = argvLider({ ...base, resume: false, rama: { de: OTRO, hasta: U(2) } });
  const i = a.indexOf("--resume");
  assert.deepEqual(a.slice(i, i + 9), ["--resume", OTRO, "--fork-session", "--session-id", SID, "--resume-session-at", U(2), "--name", "trama-0a1b"]);
  assert.ok(!a.some((x) => /compact|summar/i.test(x)));
});

test("los uuid de los argumentos se validan", () => {
  assert.throws(() => argvLider({ ...base, resume: true, desde: "x; ls" }));
  assert.throws(() => argvLider({ ...base, resume: false, rama: { de: OTRO, hasta: "--model" } }));
  assert.throws(() => argvLider({ ...base, resume: false, rama: { de: "../../etc", hasta: U(2) } }));
});

// --- Cada mensaje trae su uuid ---

test("la página trae el uuid de cada mensaje y el del anterior", () => {
  const est = convNueva();
  avanzarConv(est, charla);
  const p = paginaDe(est, SID, null);
  assert.deepEqual(p.mensajes.map((m) => [m.uuid, m.previo]), [[U(1), undefined], [U(2), U(1)], [U(3), U(2)], [U(4), U(3)]]);
});

test("un tool_result no es un mensaje: volver al asistente lo incluye", () => {
  const est = convNueva();
  const tool = linea({
    type: "assistant",
    uuid: U(2),
    parentUuid: U(1),
    message: { id: "m2", role: "assistant", model: "claude-opus-5-5", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] },
  });
  const res = linea({ type: "user", uuid: U(3), parentUuid: U(2), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } });
  avanzarConv(est, user(U(1), null, "corré") + tool + res + asist(U(4), U(3), "listo", "m4"));
  const p = paginaDe(est, SID, null);
  assert.equal(p.mensajes.length, 3);
  // El mensaje del asistente que pidió la herramienta termina en su resultado (U(3)): es hasta donde se puede volver.
  assert.equal(p.mensajes[1].uuid, U(3));
});

test("volver atrás en el mismo archivo: la línea nueva cuelga de un mensaje anterior y la rama vieja deja de contar", () => {
  const est = convNueva();
  avanzarConv(est, charla);
  assert.equal(paginaDe(est, SID, null).total, 4);
  // `--resume-session-at U(2)` + un pedido nuevo: cuelga de U(2); lo de U(3) y U(4) queda en el archivo, fuera de la línea.
  avanzarConv(est, user(U(5), U(2), "tres, de otra forma"));
  const p = paginaDe(est, SID, null);
  assert.deepEqual(p.mensajes.map((m) => m.texto), ["uno", "dos", "tres, de otra forma"]);
  assert.equal(p.mensajes[2].previo, U(2));
});

test("lo anterior a una compactación conserva su uuid (previa); tras la marca no hay de dónde seguir antes del primero", () => {
  const est = convNueva();
  const marca = linea({ type: "system", subtype: "compact_boundary", uuid: U(9), parentUuid: null, compactMetadata: { trigger: "auto", preTokens: 100 } });
  avanzarConv(est, charla + marca + user(U(10), U(9), "después") + asist(U(11), U(10), "sí", "m11"));
  const p = paginaDe(est, SID, null);
  assert.deepEqual(p.mensajes.map((m) => m.uuid), [U(1), U(2), U(3), U(4), undefined, U(10), U(11)]);
  assert.deepEqual(p.mensajes.map((m) => !!m.previa), [true, true, true, true, false, false, false]);
  assert.equal(p.mensajes[5].previo, undefined, "tras la marca no hay de dónde seguir antes del primero");
  // Volver o ramificar en los `previa` pasa por una copia de la cadena: tests/rebobinar-previa.test.ts.
});

test("hastaUuid: la conversación de una rama sin transcript, sin tocar el estado de origen", () => {
  const est = convNueva();
  avanzarConv(est, charla);
  const r = hastaUuid(est, U(2));
  assert.deepEqual(paginaDe(r, SID, null).mensajes.map((m) => m.texto), ["uno", "dos"]);
  assert.equal(paginaDe(est, SID, null).total, 4);
  assert.equal(paginaDe(hastaUuid(est, "no-existe"), SID, null).total, 0);
});

// --- La rama anotada ---

test("lideres.json: una rama sin primer turno se guarda y se lee; una rara se descarta", () => {
  const g = (rama: unknown) => JSON.stringify({ version: 1, lideres: [{ sid: SID, nombre: "a", modelo: "claude-opus-5-5", effort: "high", rama }] });
  const ok = leerGuardados(g({ de: OTRO, hasta: U(2) }));
  assert.deepEqual(ok[0]?.rama, { de: OTRO, hasta: U(2) });
  assert.equal(leerGuardados(g({ de: OTRO, hasta: "--x" }))[0]?.rama, undefined);
  assert.equal(leerGuardados(g(undefined))[0]?.rama, undefined);
});

// --- La vista ---

test("turnos: el pedido lleva su uuid y el del anterior; la respuesta, el de su último mensaje", () => {
  const est = convNueva();
  avanzarConv(est, charla);
  const its = turnos(paginaDe(est, SID, null).mensajes);
  assert.equal(its.length, 4);
  assert.deepEqual(its[0].tipo === "yo" && its[0].punto, { uuid: U(1), n: 1, antes: 0 });
  assert.deepEqual(its[1].tipo === "turno" && its[1].punto, { uuid: U(2), n: 2, antes: 1 });
  assert.deepEqual(its[2].tipo === "yo" && its[2].punto, { uuid: U(3), n: 3, antes: 2, previo: U(2) });
});
