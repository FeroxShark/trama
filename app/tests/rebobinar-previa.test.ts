// Volver acá, Editar y Ramificar en un mensaje ANTERIOR a la última compactación. El `claude` sólo carga lo que viene después de su
// `compact_boundary` y rechaza esos `uuid` ("No message found with message.uuid"), así que trama deja el `uuid` en el mensaje
// (`previa`) y, al usarlo, bifurca de una copia de la cadena bajo un sid nuevo. Transcripts inventados, `claude` falso.
// Armado como tests/lider-reinicio.test.ts.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-previa-")));
const carpeta = path.join(tmp, "trabajo");
mkdirSync(carpeta);
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.PA_STATE = path.join(tmp, "pa");
process.env.PROYECTOS_REGISTRY = path.join(tmp, "registry.json");
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
process.env.TRAMA_FALSO_MS = "20";
mkdirSync(process.env.HILOS_SESIONES);
writeFileSync(process.env.PROYECTOS_REGISTRY, "{}");

const lider = await import("../electron/lider.ts");
const { avanzarConv, convNueva, paginaDe } = await import("../electron/lider-arma.ts");
const { turnos } = await import("../src/hilo/turnos.ts");
after(() => lider.cerrarTodos(true));

const SID = "36ac312b-6241-4230-b3b3-c3decacc39c0";
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const linea = (o: object) => JSON.stringify(o) + "\n";
const base = { timestamp: "2026-10-26T10:00:00Z", sessionId: SID, cwd: carpeta };
const user = (uuid: string, parentUuid: string | null, texto: string) => linea({ ...base, type: "user", uuid, parentUuid, message: { role: "user", content: texto } });
const asist = (uuid: string, parentUuid: string, texto: string) =>
  linea({
    ...base,
    type: "assistant",
    uuid,
    parentUuid,
    message: { id: `msg_${uuid.slice(-3)}`, role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: texto }], usage: { input_tokens: 5, output_tokens: 5 } },
  });
const marca = linea({ ...base, type: "system", subtype: "compact_boundary", uuid: U(9), parentUuid: null, compactMetadata: { trigger: "auto", preTokens: 100 } });

/** uno, dos, tres, cuatro — compactó — cinco, seis. */
const compactada =
  user(U(1), null, "uno") + asist(U(2), U(1), "dos") + user(U(3), U(2), "tres") + asist(U(4), U(3), "cuatro") + marca + user(U(10), U(9), "cinco") + asist(U(11), U(10), "seis");

const dir = path.join(tmp, "claude", "projects", carpeta.replace(/[^a-zA-Z0-9]/g, "-"));
mkdirSync(dir, { recursive: true });
const transcript = path.join(dir, `${SID}.jsonl`);
writeFileSync(transcript, compactada);

test("el parser conserva el uuid de lo anterior a la compactación y lo marca previa", () => {
  const est = convNueva();
  avanzarConv(est, compactada);
  const p = paginaDe(est, SID, null);
  assert.deepEqual(p.mensajes.map((m) => m.uuid), [U(1), U(2), U(3), U(4), undefined, U(10), U(11)]);
  assert.deepEqual(p.mensajes.map((m) => !!m.previa), [true, true, true, true, false, false, false]);
  assert.equal(p.mensajes[2].previo, U(2), "el pedido de antes de compactar sigue sabiendo su anterior (se puede editar)");
  assert.equal(p.mensajes[5].previo, undefined, "tras la marca no hay de dónde seguir antes del primero");
});

test("la vista: cada mensaje con uuid tiene su punto, y los de antes de compactar lo llevan previa", () => {
  const est = convNueva();
  avanzarConv(est, compactada);
  const its = turnos(paginaDe(est, SID, null).mensajes);
  const puntos = its.flatMap((x) => (x.tipo === "yo" || x.tipo === "turno" ? [x.punto] : []));
  assert.equal(puntos.length, 6);
  assert.ok(puntos.every((p) => p !== undefined), "ninguno sin punto");
  assert.deepEqual(puntos.map((p) => !!p?.previa), [true, true, true, true, false, false]);
});

test("cadenaHasta: la cadena desde la raíz, y si el punto es anterior a la última compactación", async () => {
  const a = await lider.cadenaHasta(transcript, U(3));
  assert.equal(a?.previa, true);
  assert.deepEqual(a?.lineas.map((o) => o.uuid), [U(1), U(2), U(3)]);
  const d = await lider.cadenaHasta(transcript, U(11));
  assert.equal(d?.previa, false);
  assert.deepEqual(d?.lineas.map((o) => o.uuid), [U(9), U(10), U(11)]);
  assert.equal(await lider.cadenaHasta(transcript, U(77)), null);
});

test("Ramificar en un punto anterior a la compactación bifurca de una copia; el original no se toca", async () => {
  const nuevo = await lider.ramificar({ sid: SID, uuid: U(3), modelo: "claude-opus-5-5", effort: "high" });
  const g = (await lider.lideresApp()).find((l) => l.sid === nuevo);
  assert.ok(g?.rama, "el líder nuevo lleva su rama");
  assert.notEqual(g.rama.de, SID, "no bifurca del archivo de origen: el claude no alcanza ese uuid");
  assert.equal(g.rama.hasta, U(3));
  const copia = path.join(dir, `${g.rama.de}.jsonl`);
  const lineas = readFileSync(copia, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lineas.map((o) => o.uuid), [U(1), U(2), U(3)]);
  assert.ok(lineas.every((o) => o.sessionId === g.rama!.de), "la copia es de su propia sesión");
  assert.equal(readFileSync(transcript, "utf8"), compactada, "el transcript de origen queda igual");
  // Lo que ve el líder nuevo antes de su primer turno: el origen cortado en el mensaje.
  const pag = await lider.conversacionLider({ sid: nuevo });
  assert.deepEqual(pag.mensajes.map((m: { texto: string }) => m.texto), ["uno", "dos", "tres"]);
});

test("Ramificar después de la compactación bifurca del origen, sin copia", async () => {
  const antes = readdirSync(dir).length;
  const nuevo = await lider.ramificar({ sid: SID, uuid: U(11), modelo: "claude-opus-5-5", effort: "high" });
  const g = (await lider.lideresApp()).find((l) => l.sid === nuevo);
  assert.deepEqual(g?.rama, { de: SID, hasta: U(11) });
  assert.equal(readdirSync(dir).length, antes, "no se creó ningún archivo");
});
