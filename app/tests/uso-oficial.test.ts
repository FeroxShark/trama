// "Actualizar límites" (lider.pedirUsoOficial) con el claude falso: el uso como lo dice claude.ai
// (`get_usage`), por un líder de la app vivo o por un `claude` de un rato. Mismo arreglo que
// tests/lider-proceso.test.ts: hook de `.js` a `.ts` y el entorno antes del import.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
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

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-uso-"));
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
process.env.TRAMA_FALSO_MS = "5";
const LOG = path.join(tmp, "falso.log");
process.env.TRAMA_FALSO_LOG = LOG;
// Inventada: no tiene que llegarle a `claude` (el uso es el de la suscripción).
process.env.ANTHROPIC_API_KEY = "inventada";

const lider = await import("../electron/lider.ts");
after(() => lider.cerrarTodos(true));

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function hasta(f: () => boolean, ms = 10_000) {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error("no pasó a tiempo");
    await espera(20);
  }
}
type Linea = { args?: string[]; env?: string[]; cwd?: string; control?: string };
const lineas = (): Linea[] =>
  existsSync(LOG)
    ? readFileSync(LOG, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
const arranques = () => lineas().filter((l) => l.args);
const pedidos = () => lineas().filter((l) => l.control === "get_usage").length;

test("sin líder vivo: un claude de un rato, sin transcript, hooks ni claves, contesta y queda anotado", { timeout: 30_000 }, async () => {
  process.env.TRAMA_FALSO_USO_OFICIAL = "61,7";
  assert.equal(await lider.pedirUsoOficial(), true);
  const u = await lider.usoVisto();
  assert.equal(u?.five_hour?.pct, 61);
  assert.equal(u?.five_hour?.oficial, true);
  assert.equal(u?.seven_day?.pct, 7);
  const [a] = arranques();
  assert.equal(arranques().length, 1);
  for (const f of ["-p", "--no-session-persistence", "--strict-mcp-config"]) assert.ok(a.args!.includes(f), f);
  assert.equal(JSON.parse(a.args![a.args!.indexOf("--settings") + 1]).disableAllHooks, true);
  assert.ok(!a.args!.includes("--bare") && !a.args!.includes("--session-id") && !a.args!.includes("--resume"));
  assert.equal(a.cwd, os.homedir());
  assert.ok(!a.env!.some((k) => k.startsWith("ANTHROPIC_")));
  // Queda en uso.json, como oficial: sobrevive a un reinicio.
  const archivo = path.join(process.env.HILOS_STATE!, "uso.json");
  await hasta(() => existsSync(archivo));
  assert.equal(JSON.parse(readFileSync(archivo, "utf8")).five_hour.oficial, true);
});

test("dos clics seguidos: un solo pedido", { timeout: 30_000 }, async () => {
  const antes = arranques().length;
  assert.deepEqual(await Promise.all([lider.pedirUsoOficial(), lider.pedirUsoOficial()]), [true, true]);
  assert.equal(arranques().length, antes + 1);
});

test("un claude que no conoce get_usage: false y queda lo que había", { timeout: 30_000 }, async () => {
  process.env.TRAMA_FALSO_USO_OFICIAL = "no";
  assert.equal(await lider.pedirUsoOficial(), false);
  assert.equal((await lider.usoVisto())?.five_hour?.pct, 61);
});

test("con un líder vivo se le pregunta a él (sin lanzar otro) y lo oficial le gana al stream", { timeout: 30_000 }, async () => {
  // El stream del turno dice 70 %; claude.ai, 64 %: manda claude.ai.
  process.env.TRAMA_FALSO_USO = "70,8";
  process.env.TRAMA_FALSO_USO_OFICIAL = "64,8";
  const sid = await lider.nuevo({ modelo: "claude-opus-5-5", effort: "high", texto: "hola" });
  // El turno dijo su 70 % y terminó.
  let cinco = 0;
  await hasta(() => {
    void lider.usoVisto().then((u) => (cinco = Math.round(u?.five_hour?.pct ?? 0)));
    return cinco === 70 && lider.procDe(sid)?.ocupado === false;
  });
  const n = arranques().length;
  const g = pedidos();
  assert.equal(await lider.pedirUsoOficial(), true);
  assert.equal(arranques().length, n);
  assert.equal(pedidos(), g + 1);
  assert.equal((await lider.usoVisto())?.five_hour?.pct, 64);
});
