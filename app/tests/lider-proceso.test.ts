// electron/lider.ts entero, con el claude falso de scripts/: los turnos de un
// proceso vivo. lider.ts importa sus vecinos con `.js` (lo compila tsc): acá un
// hook de resolución los lleva al `.ts`. El entorno va antes del import (lider.ts
// lo lee al cargar): estado, sesiones y config de Claude en un tmp.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
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

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-lider-"));
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
// Turnos lentos: cada delta tarda 1 s (el interrupt corta en el primero).
process.env.TRAMA_FALSO_MS = "1000";

const lider = await import("../electron/lider.ts");
type Ev = { sid: string; e: { tipo: string } };
const eventos: Ev[] = [];
lider.alEvento((sid, e) => eventos.push({ sid, e }));
after(() => lider.cerrarTodos(true));

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function hasta(f: () => boolean, ms = 10_000) {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error("no pasó a tiempo");
    await espera(20);
  }
}
const cuantos = (sid: string, tipo: string) => eventos.filter((x) => x.sid === sid && x.e.tipo === tipo).length;

test("parar y el turno termina antes de los 3 s: el SIGINT no mata al turno siguiente", { timeout: 20_000 }, async () => {
  const sid = await lider.nuevo({ modelo: "claude-opus-5-5", effort: "high", texto: "hola" });
  // El interrupt, ya adentro del turno (si llega antes, el falso no lo corta).
  await hasta(() => cuantos(sid, "hace") > 0);
  lider.parar(sid);
  await hasta(() => cuantos(sid, "fin") === 1);
  // El turno nuevo dura más que lo que le queda al timer del parar (1,5 s + 3 deltas de 1 s).
  await lider.mandar({ sid, texto: "despacio", modelo: "claude-opus-5-5", effort: "high" });
  await hasta(() => cuantos(sid, "fin") === 2 || cuantos(sid, "salio") > 0);
  assert.equal(cuantos(sid, "salio"), 0, "el proceso murió a mitad del turno nuevo");
  assert.equal(lider.procDe(sid)?.ocupado, false);
});

test("dos mandar a la vez a un líder sin proceso: sólo uno lanza claude --resume", { timeout: 20_000 }, async () => {
  const sid = await lider.nuevo({ modelo: "claude-opus-5-5", effort: "high", texto: "hola" });
  await hasta(() => cuantos(sid, "hace") > 0);
  lider.parar(sid);
  await hasta(() => cuantos(sid, "fin") === 1);
  // Sigue en lideres.json pero sin proceso (como al reabrir trama).
  await lider.cerrarTodos(false);
  assert.equal(lider.procDe(sid), null);
  const x = { sid, texto: "otra", modelo: "claude-opus-5-5", effort: "high" };
  const r = await Promise.allSettled([lider.mandar(x), lider.mandar(x)]);
  assert.deepEqual(r.map((y) => y.status).sort(), ["fulfilled", "rejected"]);
});

test("AskUserQuestion: el pedido queda pendiente (para una vista recargada) y las answers vuelven al líder", { timeout: 20_000 }, async () => {
  const sid = await lider.nuevo({ modelo: "claude-opus-5-5", effort: "high", texto: "preguntame" });
  await hasta(() => cuantos(sid, "permiso") === 1);
  const [p] = lider.pendientes(sid);
  assert.equal(p.herramienta, "AskUserQuestion");
  assert.equal("input" in p, false);
  const [color, frutas] = p.preguntas!;
  assert.equal(frutas.multiSelect, true);
  // A medias no se contesta: sigue pendiente.
  assert.throws(() => lider.responderPermiso(sid, p.id, { ok: true, respuestas: { [color.question]: "Rojo" } }));
  assert.equal(lider.pendientes(sid).length, 1);
  lider.responderPermiso(sid, p.id, { ok: true, respuestas: { [color.question]: "Rojo", [frutas.question]: "Manzana, Pera, kiwi" } });
  assert.equal(lider.pendientes(sid).length, 0);
  await hasta(() => cuantos(sid, "fin") === 1);
  const textos = eventos.filter((x) => x.sid === sid && x.e.tipo === "mensaje").map((x) => (x.e as { texto: string }).texto);
  assert.equal(textos.at(-1), `respuestas: ${JSON.stringify({ [color.question]: "Rojo", [frutas.question]: "Manzana, Pera, kiwi" })}`);
  // El resultado que pinta la llamada contestada.
  const r = eventos.find((x) => x.sid === sid && x.e.tipo === "resultado")?.e as { texto: string } | undefined;
  assert.match(r?.texto ?? "", /^The user answered: "¿Qué color\?"="Rojo"/);
});
