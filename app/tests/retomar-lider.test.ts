// Retomar un líder sin proceso (electron/lider.ts, con el claude falso): pasa a ser de la
// app y la relanza ya con `--resume` en su carpeta, ociosa (sin mandarle nada).
// Y lo que no se puede retomar dice por qué. Mismo armado que tests/lider-proceso.test.ts.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-retomar-")));
const log = path.join(tmp, "claude.log");
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
process.env.TRAMA_FALSO_LOG = log;
process.env.TRAMA_FALSO_MS = "20";

const lider = await import("../electron/lider.ts");
type Ev = { sid: string; e: { tipo: string } };
const eventos: Ev[] = [];
lider.alEvento((sid, e) => eventos.push({ sid, e }));
let cambios = 0;
lider.alCambiar(() => cambios++);
after(() => lider.cerrarTodos(true));

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function hasta(f: () => boolean, ms = 10_000) {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error("no pasó a tiempo");
    await espera(20);
  }
}

const M = { modelo: "claude-opus-5-5", effort: "high" };
/** El transcript de una sesión nacida en una terminal, en la carpeta `cwd`. */
function transcript(sid: string, cwd: string) {
  const d = path.join(tmp, "claude", "projects", "-una-carpeta");
  mkdirSync(d, { recursive: true });
  const f = path.join(d, `${sid}.jsonl`);
  writeFileSync(f, [{ type: "summary", summary: "x" }, { type: "user", cwd, sessionId: sid, message: { role: "user", content: "hola" } }].map((x) => JSON.stringify(x)).join("\n") + "\n");
  return f;
}
const lanzados = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((x) => x.args) : []);

test("retomar: pasa a ser de la app y lo relanza ya con --resume en su carpeta, sin mandarle nada; el primer mensaje sigue ahí", { timeout: 20_000 }, async () => {
  const sid = "11111111-1111-4111-8111-111111111111";
  const carpeta = path.join(tmp, "proyecto");
  mkdirSync(carpeta);
  transcript(sid, carpeta);
  const antes = cambios;
  assert.deepEqual(await lider.retomar({ sid, ...M, nombre: "ana-d2" }), { ok: true });
  await hasta(() => lanzados().length > 0);
  assert.notEqual(lider.procDe(sid), null, "la relanza ya");
  const [uno, ...mas] = lanzados();
  assert.equal(mas.length, 0, "lo lanza una sola vez");
  assert.equal(uno.args[uno.args.indexOf("--resume") + 1], sid);
  assert.equal(uno.cwd, carpeta, "corre donde vivía la sesión: ahí está su transcript");
  assert.equal(lider.procDe(sid)!.ocupado, false, "ocioso: no le mandó nada");
  assert.ok(cambios > antes, "la barra se entera");
  const g = (await lider.lideresApp()).find((l) => l.sid === sid)!;
  assert.deepEqual([g.nombre, g.cwd, g.ultimo], ["ana-d2", carpeta, 0]);
  assert.ok(g.retomado! > 0);
  // Queda en disco: al reabrir trama sigue siendo de la app.
  const disco = JSON.parse(readFileSync(path.join(tmp, "estado", "lideres.json"), "utf8"));
  assert.equal(disco.lideres.find((l: { sid: string }) => l.sid === sid).cwd, carpeta);

  await lider.mandar({ sid, texto: "seguimos", ...M });
  await hasta(() => eventos.some((x) => x.sid === sid && x.e.tipo === "fin"));
  assert.equal(lanzados().length, 1, "el primer mensaje entra al mismo proceso, no lanza otro");
  // Otra vez Retomar sobre el mismo: nada que hacer, no se duplica.
  assert.deepEqual(await lider.retomar({ sid, ...M }), { ok: true });
  assert.equal(lanzados().length, 1);
  assert.equal((await lider.lideresApp()).filter((l) => l.sid === sid).length, 1);
});

test("retomar: sin conversación en el disco, sin su carpeta o abierto en otro lado, dice por qué y no guarda nada", async () => {
  const sinSesion = "22222222-2222-4222-8222-222222222222";
  assert.deepEqual(await lider.retomar({ sid: sinSesion, ...M }), { ok: false, motivo: "sinSesion" });

  const sinCarpeta = "33333333-3333-4333-8333-333333333333";
  transcript(sinCarpeta, path.join(tmp, "borrada"));
  assert.deepEqual(await lider.retomar({ sid: sinCarpeta, ...M }), { ok: false, motivo: "sinCarpeta" });

  // Abierto en otro lado: una sesión con ese id y un proceso vivo que no es de la app (acá, este test).
  const abierto = "44444444-4444-4444-8444-444444444444";
  transcript(abierto, tmp);
  mkdirSync(path.join(tmp, "sesiones"), { recursive: true });
  const s = path.join(tmp, "sesiones", `${process.pid}.json`);
  writeFileSync(s, JSON.stringify({ sessionId: abierto, pid: process.pid, name: "ana-d3", cwd: tmp, entrypoint: "cli" }));
  assert.deepEqual(await lider.retomar({ sid: abierto, ...M }), { ok: false, motivo: "abierto" });
  const ids = (await lider.lideresApp()).map((l) => l.sid);
  for (const x of [sinSesion, sinCarpeta, abierto]) assert.equal(ids.includes(x), false);
  // La cerró allá: ahora sí.
  rmSync(s);
  assert.deepEqual(await lider.retomar({ sid: abierto, ...M }), { ok: true });

  await assert.rejects(lider.retomar({ sid: "no-es-un-id", ...M }));
});
