// "Mandar ya": un mensaje a mitad de un turno de un líder de Claude, con el claude falso de scripts/
// (que absorbe lo que llega con una herramienta en vuelo, como el real, y lo repite con isReplay).
// Fija: la guarda aflojada de `mandarDirecto`, el `entregado` por el eco, y `ocupado` que vuelve a subir en la carrera.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
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

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-directo-"));
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
process.env.TRAMA_FALSO_LARGO_MS = "1500";

const lider = await import("../electron/lider.ts");
type Ev = { sid: string; e: { tipo: string; texto?: string; ocupado?: boolean } };
const eventos: Ev[] = [];
lider.alEvento((sid, e) => eventos.push({ sid, e: e as Ev["e"] }));
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
// El falso emite el mensaje del assistant con el tool_use y en el mismo tick queda "con una herramienta en vuelo".
const enHerramienta = (sid: string) => hasta(() => cuantos(sid, "mensaje") >= 1 && lider.procDe(sid)?.ocupado === true);
const M = { modelo: "claude-opus-5-5", effort: "high" };

test("con un turno en curso, `mandar` rechaza y `mandarDirecto` entrega el mensaje dentro del turno (un solo fin)", { timeout: 20_000 }, async () => {
  const sid = await lider.nuevo({ ...M, texto: "comando largo" });
  await enHerramienta(sid);
  await assert.rejects(lider.mandar({ sid, texto: "no", ...M }), /respondiendo/);
  await lider.mandarDirecto({ sid, texto: "YA-1", ...M });
  await lider.mandarDirecto({ sid, texto: "YA-2", ...M });
  assert.equal(lider.procDe(sid)?.directos, 2, "los dos esperan su eco");
  await hasta(() => cuantos(sid, "fin") === 1);
  const entregados = eventos.filter((x) => x.sid === sid && x.e.tipo === "entregado").map((x) => x.e.texto);
  assert.deepEqual(entregados, ["YA-1", "YA-2"]);
  assert.equal(lider.procDe(sid)?.directos, 0);
  await espera(300);
  assert.equal(cuantos(sid, "fin"), 1, "no hubo un segundo turno: entró en el primero");
  assert.equal(lider.procDe(sid)?.ocupado, false);
  const dicho = eventos.filter((x) => x.sid === sid && x.e.tipo === "mensaje").map((x) => x.e.texto);
  assert.match(String(dicho.at(-1)), /YA-1 \+ YA-2/, "el modelo contestó con los dos");
});

test("el eco se compara sin los espacios de las puntas, y lo que no esperaba un directo no cuenta", { timeout: 20_000 }, async () => {
  const sid = await lider.nuevo({ ...M, texto: "comando largo" });
  await enHerramienta(sid);
  await lider.mandarDirecto({ sid, texto: "  YA-3\n", ...M });
  await hasta(() => cuantos(sid, "fin") === 1);
  assert.deepEqual(eventos.filter((x) => x.sid === sid && x.e.tipo === "entregado").map((x) => x.e.texto?.trim()), ["YA-3"]);
  assert.equal(lider.procDe(sid)?.directos, 0);
  // El texto inicial ("comando largo") también tuvo eco en un claude real: no es un entregado de nadie.
  assert.equal(cuantos(sid, "entregado"), 1);
});

test("otro modelo o esfuerzo elegido en pleno turno: el mensaje directo entra con el del turno y el cambio se aplica al próximo mensaje", { timeout: 20_000 }, async () => {
  const sid = await lider.nuevo({ ...M, texto: "comando largo" });
  await enHerramienta(sid);
  // No se rechaza ni se cambia nada en vivo: entra en el turno que corre.
  await lider.mandarDirecto({ sid, texto: "YA-X", modelo: "claude-sonnet-5-5", effort: "low" });
  assert.equal(lider.procDe(sid)?.directos, 1);
  await hasta(() => cuantos(sid, "fin") === 1);
  const guardado = async () => (await lider.lideresApp()).find((l) => l.sid === sid);
  assert.equal((await guardado())?.modelo, M.modelo, "el turno siguió con el modelo con que arrancó");
  assert.equal((await guardado())?.effort, M.effort);
  // El próximo mensaje sí lleva lo elegido.
  await lider.mandar({ sid, texto: "siguiente", modelo: "claude-sonnet-5-5", effort: "low" });
  assert.equal((await guardado())?.modelo, "claude-sonnet-5-5");
  assert.equal((await guardado())?.effort, "low");
  await hasta(() => cuantos(sid, "fin") === 2);
  // Un valor roto sigue siendo un error (no se manda nada).
  await assert.rejects(lider.mandarDirecto({ sid, texto: "x", modelo: "--malo", effort: "low" }), /./);
});

test("sin turno en curso, mandarDirecto es un mandar normal (sin esperar eco)", { timeout: 20_000 }, async () => {
  const sid = await lider.nuevo({ ...M, texto: "hola" });
  await hasta(() => cuantos(sid, "fin") === 1);
  assert.equal(lider.procDe(sid)?.ocupado, false);
  await lider.mandarDirecto({ sid, texto: "otra", ...M });
  assert.equal(lider.procDe(sid)?.directos, 0);
  await hasta(() => cuantos(sid, "fin") === 2);
});

test("la carrera: el mensaje llega sin herramienta; el CLI lo corre como turno propio y `ocupado` vuelve a subir tras el primer result", { timeout: 20_000 }, async () => {
  const sid = await lider.nuevo({ ...M, texto: "despacio" });
  await hasta(() => lider.procDe(sid)?.ocupado === true);
  await lider.mandarDirecto({ sid, texto: "carrera", ...M });
  await hasta(() => cuantos(sid, "fin") === 1);
  // El segundo turno arranca con system/init + status requesting: la app lo ve trabajando otra vez.
  await hasta(() => lider.procDe(sid)?.ocupado === true, 3000);
  const estados = eventos.filter((x) => x.sid === sid && x.e.tipo === "estado").map((x) => x.e.ocupado);
  assert.ok(estados.lastIndexOf(true) > estados.indexOf(false), "ocupado: true, false (primer result) y true de nuevo");
  await hasta(() => cuantos(sid, "fin") === 2);
  assert.equal(lider.procDe(sid)?.ocupado, false);
  assert.equal(cuantos(sid, "entregado"), 0, "sin absorber no hay entrega dentro del turno");
});
