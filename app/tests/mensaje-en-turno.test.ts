// Un mensaje que se le escribe a un `claude` por stdin EN MEDIO de un turno: qué hace el CLI, cómo se ve en el stream y en el
// transcript, y qué se rompería en la app si `mandarYa` dejara de rechazarlo.
// Los fixtures (tests/fixtures/mensaje-en-turno/) son líneas REALES del `claude` 2.1.310 (Haiku 5.5), recortadas:
//   herramienta.*  el mensaje sale 3 s después de que arranca una herramienta larga (python sleep)
//   texto.*        el mensaje sale con el primer delta de la respuesta final, sin herramientas (la carrera con el `result`)
// Con HILOS_CLAUDE_REAL=1 se vuelve a medir con un `claude` real (scripts/medir-mensaje-en-turno.mjs, unos centavos de Haiku).
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-mensaje-turno-")));
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");

const lider = await import("../electron/lider.ts");
const { avanzarConv, convNueva, parsearLinea } = await import("../electron/lider-arma.ts");
after(() => lider.cerrarTodos(true));

const FIX = path.join(import.meta.dirname, "fixtures", "mensaje-en-turno");
const jsonl = (n: string): any[] =>
  readFileSync(path.join(FIX, n), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const ruta = (n: string) => path.join(FIX, n);

/** Lo que el stdout le da a la app, línea por línea (sin la hora que le puso el medidor). */
const eventos = (n: string) =>
  jsonl(n).map(({ ms, ...o }) => ({ ms: ms as number, o, ev: parsearLinea(JSON.stringify(o)) }));

/** Reproduce la regla de hoy de `lider.ts`: ocupado se pone al escribir un mensaje y sólo el `fin` (el `result`) lo baja. */
function ocupadoSegunHoy(n: string, escritoEn: number) {
  let ocupado = true; // el primer mensaje ya salió
  const linea: { ms: number; que: string; ocupado: boolean }[] = [];
  for (const { ms, o, ev } of eventos(n)) {
    if (ev.some((e) => e.tipo === "fin")) ocupado = false;
    linea.push({ ms, que: `${o.type}${o.subtype ? "/" + o.subtype : ""}`, ocupado });
  }
  return { linea, escritoEn };
}

const adjuntoDe = (transcript: any[]) => transcript.find((o) => o.type === "attachment" && o.attachment?.type === "queued_command");

// --- 1. a) El CLI lo entrega DENTRO del turno, entre dos herramientas, sin cortar la que corre -------------------------

test("herramienta: el CLI absorbe el mensaje en el turno (queued_command + absorbed_mid_turn), una sola vez", () => {
  const t = jsonl("herramienta.transcript.jsonl");
  const adj = adjuntoDe(t);
  assert.ok(adj, "el transcript trae el adjunto queued_command");
  assert.match(adj.attachment.prompt[0].text, /^MENSAJE-1: /);
  const quitado = t.find((o) => o.type === "queue-operation" && o.operation === "remove");
  assert.equal(quitado.reason, "absorbed_mid_turn");
  assert.equal(quitado.commandUuid, adj.attachment.source_uuid);
  // No es un mensaje `user`: sólo existe como adjunto.
  assert.equal(t.filter((o) => o.type === "user" && JSON.stringify(o.message.content).includes("MENSAJE-1")).length, 0);
  // Un solo turno: un solo `result`, y el modelo ya lo tenía (turnos: 2 = herramienta + respuesta).
  const res = jsonl("herramienta.stdout.jsonl").filter((o) => o.type === "result");
  assert.equal(res.length, 1);
  assert.equal(res[0].num_turns, 2);
  assert.match(res[0].result, /CLAVE-ZETA-77/);
});

test("herramienta: la herramienta larga NO se corta; el mensaje llega pegado a su tool_result", () => {
  const e = jsonl("herramienta.stdout.jsonl");
  const usoHerramienta = e.find((o) => o.type === "assistant" && o.message.content.some((c: any) => c.type === "tool_use"));
  const resultado = e.find((o) => o.type === "user" && JSON.stringify(o.message.content).includes("tool_result"));
  assert.ok(JSON.stringify(resultado.message.content).includes("TOOL-TERMINO"), "la herramienta terminó sola, con su salida");
  assert.ok(resultado.ms - usoHerramienta.ms >= 7000, "tardó lo que tarda (sleep de 8 s), no se interrumpió");
  // En el transcript: tool_result → (adjuntos) → queued_command → … → siguiente respuesta del modelo.
  const t = jsonl("herramienta.transcript.jsonl");
  const iResult = t.findIndex((o) => o.type === "user" && JSON.stringify(o.message.content).includes("tool_result"));
  const iAdj = t.findIndex((o) => o.type === "attachment" && o.attachment?.type === "queued_command");
  const iSigue = t.findIndex((o, i) => i > iAdj && o.type === "assistant");
  assert.ok(iResult >= 0 && iResult < iAdj && iAdj < iSigue);
});

// --- 2. Cómo se ve en el stream de salida ---------------------------------------------------------------------------

test("stream: el mensaje absorbido no deja NINGÚN evento propio (sin --replay-user-messages la app no se entera)", () => {
  for (const { o } of eventos("herramienta.stdout.jsonl")) {
    if (o.type === "assistant") continue; // el texto del modelo sí nombra la clave
    assert.ok(!JSON.stringify(o).includes("MENSAJE-1"), `ni ${o.type}/${o.subtype ?? ""} lo nombra`);
  }
});

// --- 4. Riesgo `ocupado`: un mensaje que NO se absorbe arranca un turno propio, con otro `result` --------------------

test("texto (sin herramientas): no hay punto donde absorberlo; arranca un segundo turno con su propio result", () => {
  const e = jsonl("texto.stdout.jsonl");
  assert.equal(e.filter((o) => o.type === "result").length, 2);
  const t = jsonl("texto.transcript.jsonl");
  assert.equal(adjuntoDe(t), undefined, "no hay queued_command");
  const u = t.filter((o) => o.type === "user" && JSON.stringify(o.message.content).includes("MENSAJE-1"));
  assert.equal(u.length, 1, "queda como mensaje `user` normal, con su uuid");
  assert.ok(typeof u[0].uuid === "string" && u[0].parentUuid);
  assert.ok(!t.some((o) => o.type === "queue-operation" && o.reason === "absorbed_mid_turn"));
});

test("texto: el primer result baja `ocupado` aunque el CLI ya tenga el segundo turno en marcha (~40 ms después)", () => {
  const e = eventos("texto.stdout.jsonl");
  const iFin = e.findIndex((x) => x.ev.some((v) => v.tipo === "fin"));
  const iInit = e.findIndex((x, i) => i > iFin && x.o.type === "system" && x.o.subtype === "init");
  assert.ok(iFin >= 0 && iInit > iFin, "después del primer result llega system/init del segundo turno");
  assert.ok(e[iInit].ms - e[iFin].ms < 200, `el segundo turno arranca solo, ${e[iInit].ms - e[iFin].ms} ms después`);
  // Ese init, y todo lo del segundo turno hasta su result, NO produce el evento que prendería `ocupado` (no hay): sólo `fin` lo toca.
  const entre = e.slice(iFin + 1).flatMap((x) => x.ev.map((v) => v.tipo));
  assert.ok(!entre.includes("estado"), "el stream nunca dice 'estado ocupado' por su cuenta");
  const sim = ocupadoSegunHoy("texto.stdout.jsonl", 0).linea;
  const delInit = sim.find((x, i) => i > iFin && x.que === "system/init")!;
  assert.equal(delInit.ocupado, false, "con la regla de hoy la app cree que no hace nada mientras corre el segundo turno");
  // Hasta el segundo result el modelo está trabajando, y ahí sale su texto: la vista lo recibiría con la barra en reposo.
  assert.equal(e.filter((x) => x.ev.some((v) => v.tipo === "fin")).length, 2);
});

test("herramienta: con un mensaje absorbido hay UN result, así que `ocupado` (true al escribir, false al fin) queda bien", () => {
  const e = eventos("herramienta.stdout.jsonl");
  assert.equal(e.filter((x) => x.ev.some((v) => v.tipo === "fin")).length, 1);
  const sim = ocupadoSegunHoy("herramienta.stdout.jsonl", 0).linea;
  assert.equal(sim.at(-1)!.ocupado, false);
  assert.ok(sim.slice(0, -1).every((x) => x.ocupado), "ocupado hasta el último result");
});

test("un turno que arranca sin que la app haya escrito nada (task_notification) tampoco prende `ocupado` hoy", () => {
  // Mismo hueco, sin mensaje en medio: el stream trae system/init + status al empezar cualquier turno y la app sólo mira el result.
  const init = jsonl("texto.stdout.jsonl").filter((o) => o.type === "system" && o.subtype === "init");
  assert.equal(init.length, 2, "una vez al arrancar y otra al empezar el segundo turno");
});

// --- 4. Riesgo rebobinado por uuid ----------------------------------------------------------------------------------

test("rebobinar: el adjunto trae uuid y cuelga de la cadena; rebobinar antes lo descarta, en él o después lo conserva", async () => {
  const f = ruta("herramienta.transcript.jsonl");
  const t = jsonl("herramienta.transcript.jsonl");
  const adj = adjuntoDe(t);
  assert.match(adj.uuid, /^[0-9a-f-]{36}$/);
  const antes = t.find((o) => o.type === "user" && JSON.stringify(o.message.content).includes("tool_result"));
  const despues = t.findLast((o) => o.type === "assistant");
  const hasta = async (u: string) => (await lider.cadenaHasta(f, u))!.lineas.map((o: any) => o.uuid);
  assert.ok(!(await hasta(antes.uuid)).includes(adj.uuid), "antes del adjunto: el mensaje queda fuera de la cadena");
  assert.ok((await hasta(adj.uuid)).includes(adj.uuid), "en el adjunto: dentro");
  assert.ok((await hasta(despues.uuid)).includes(adj.uuid), "después: dentro");
});

test("la conversación de la app muestra el mensaje absorbido como del usuario, con su uuid y sin cortar la cadena", () => {
  const t = jsonl("herramienta.transcript.jsonl");
  const adj = adjuntoDe(t);
  const est = convNueva();
  avanzarConv(est, readFileSync(ruta("herramienta.transcript.jsonl"), "utf8"));
  const m = est.todos.find((x: any) => String(x.texto).includes("MENSAJE-1"));
  assert.ok(m, "el mensaje absorbido es un mensaje de la conversación");
  assert.equal(m.rol, "user");
  assert.equal(m.uuid, adj.uuid, "con el uuid del adjunto (Editar / Volver acá / Ramificar)");
  assert.equal(est.posDe.get(adj.uuid), est.todos.indexOf(m));
  // El adjunto en medio de la cadena no corta nada: los mensajes de después se siguen sumando, y el mensaje queda antes de la respuesta.
  const ultimo = t.findLast((o) => o.type === "assistant");
  assert.ok(est.posDe.has(ultimo.uuid));
  assert.ok(est.posDe.get(ultimo.uuid)! > est.posDe.get(adj.uuid)!);
  // Releer el transcript entero da lo mismo (no desaparece, no se duplica).
  const est3 = convNueva();
  const todo = readFileSync(ruta("herramienta.transcript.jsonl"), "utf8");
  avanzarConv(est3, todo);
  avanzarConv(est3, "");
  assert.equal(est3.todos.filter((x: any) => String(x.texto).includes("MENSAJE-1")).length, 1);
  // El mensaje sin absorber (texto.*) sigue siendo un `user` normal.
  const est2 = convNueva();
  avanzarConv(est2, readFileSync(ruta("texto.transcript.jsonl"), "utf8"));
  assert.ok(est2.todos.some((x: any) => x.rol === "user" && String(x.texto).includes("MENSAJE-1")));
});

test("un queued_command que no es un pedido del usuario (una notificación de fondo) no es un mensaje suyo", () => {
  const est = convNueva();
  const linea = (o: unknown) => JSON.stringify(o) + "\n";
  avanzarConv(
    est,
    linea({ type: "attachment", uuid: "n1", attachment: { type: "queued_command", commandMode: "task-notification", prompt: "<task-notification>listo</task-notification>" } }),
  );
  assert.equal(est.todos.length, 0);
  avanzarConv(est, linea({ type: "attachment", uuid: "p1", attachment: { type: "queued_command", commandMode: "prompt", prompt: [{ type: "text", text: "hola ya" }] } }));
  assert.equal(est.todos.length, 1);
  assert.equal(est.todos[0].texto, "hola ya");
});

// --- Con un claude real (cuesta unos centavos de Haiku; HILOS_CLAUDE_REAL=1) ---------------------------------------------

const real = { skip: process.env.HILOS_CLAUDE_REAL ? false : "HILOS_CLAUDE_REAL=1 corre el `claude` real (scripts/medir-mensaje-en-turno.mjs)" };
const medir = async (...a: string[]) => {
  const { stdout } = await promisify(execFile)("node", [path.join(import.meta.dirname, "..", "scripts", "medir-mensaje-en-turno.mjs"), ...a], {
    env: { ...process.env, TRAMA_MEDIR_SEG: process.env.TRAMA_MEDIR_SEG ?? "20" },
    timeout: 280_000,
    maxBuffer: 8e6,
  });
  return JSON.parse(stdout.trim().split("\n").at(-1)!);
};

test("REAL herramienta: entregado dentro del turno, la herramienta de 20 s no se corta, un solo result", real, async () => {
  const r = await medir("herramienta");
  assert.equal(r.tool.ok, true, "la herramienta terminó con su salida");
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].tieneClave, true);
  assert.equal(r.transcript.queued.length, 1);
  assert.ok(r.transcript.ops.some((o: any) => o.razon === "absorbed_mid_turn"));
  assert.equal(r.transcript.mensajesUser, 0);
  const llegada = r.tool.fin - r.escritos[0]; // el modelo lo lee al terminar la herramienta
  assert.ok(llegada > 10_000, `espera a que la herramienta termine (${llegada} ms)`);
});

test("REAL texto: sin punto de absorción arranca un segundo turno con su propio result", real, async () => {
  const r = await medir("texto");
  assert.equal(r.results.length, 2);
  assert.equal(r.results[1].tieneClave, true);
  assert.equal(r.transcript.queued.length, 0);
  assert.equal(r.transcript.mensajesUser, 1);
});

test("REAL dos mensajes seguidos en la herramienta: se absorben juntos en el mismo punto", real, async () => {
  const r = await medir("dos");
  assert.equal(r.results.length, 1);
  assert.ok(r.results[0].tieneClave && r.results[0].tieneClave2);
  assert.equal(r.transcript.queued.length, 2);
});

test("REAL rebobinar: antes del mensaje no lo conoce; en él y después sí", real, async () => {
  const r = await medir("rebobinar");
  assert.equal(r.rebobinar.antes.sabe, false);
  assert.equal(r.rebobinar.enElMensaje.sabe, true);
  assert.equal(r.rebobinar.despues.sabe, true);
});
