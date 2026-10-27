// Salir de trama nunca se cuelga (electron/lider.ts, `cerrarTodos`): con un líder falso que no contesta ni cierra,
// la salida termina dentro del tope, lo corta y lo deja en el log. Estado, sesiones y claude en un tmp.
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

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-salida-"));
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");

const lider = await import("../electron/lider.ts");
after(() => lider.cerrarTodos(true, 1000));

const fines: string[] = [];
lider.alEvento((sid, e) => void (e.tipo === "fin" && fines.push(sid)));

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function hasta(f: () => boolean, ms = 10_000) {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error("no pasó a tiempo");
    await espera(20);
  }
}
const vivo = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("un líder que no contesta: la salida termina dentro del tope, lo corta y queda en el log", { timeout: 20_000 }, async () => {
  const sid = await lider.nuevo({ modelo: "claude-opus-5-5", effort: "high", texto: "colgate" });
  await hasta(() => lider.procDe(sid)?.ocupado === true);
  const pid = lider.procDe(sid)!.pid!;
  assert.equal(lider.respondiendoSids().includes(sid), true);

  const t0 = Date.now();
  const sin = await lider.cerrarTodos(false, 400);
  const tardo = Date.now() - t0;
  assert.ok(tardo >= 380, `no esperó el tope: ${tardo} ms`);
  assert.ok(tardo < 3000, `tardó ${tardo} ms con tope de 400`);
  assert.equal(sin.length, 1);

  // Lo que no cerró se cortó: el proceso se va solo, sin que la salida lo espere.
  await hasta(() => !vivo(pid), 5000);
  const log = readFileSync(path.join(process.env.HILOS_STATE!, "trama.log"), "utf8");
  assert.match(log, /salida/);
  assert.match(log, /no cerraron en/);
});

test("sin nadie colgado, la salida no espera el tope", { timeout: 20_000 }, async () => {
  const sid = await lider.nuevo({ modelo: "claude-opus-5-5", effort: "high", texto: "hola" });
  await hasta(() => fines.includes(sid) && lider.procDe(sid)?.ocupado === false);
  const t0 = Date.now();
  const sin = await lider.cerrarTodos(false, 5000);
  assert.deepEqual(sin, []);
  assert.ok(Date.now() - t0 < 2000);
});
