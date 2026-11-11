// Cierre de líderes al salir de trama (electron/lider.ts, `terminar`; electron/pa.ts, `esperarEscrituras`): un ocioso recibe
// SIGTERM a los 2 s de cerrarle el stdin, uno ocupado a los 8 s de siempre, y una escritura colgada no frena la salida más
// de su tope. Todo con `mock.timers` y procesos falsos: nada espera por reloj.
import { after, mock } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-gracia-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.PA_STATE = path.join(tmp, "pa");

const lider = await import("../electron/lider.ts");
const pa = await import("../electron/pa.ts");

/** Un proceso falso: anota stdin cerrado y señales; no sale solo. */
function falso() {
  const p = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    signalCode: null as string | null,
    senales: [] as string[],
    stdinCerrado: 0,
    stdin: { end: () => void p.stdinCerrado++ },
    kill: (s: string) => void p.senales.push(s),
  });
  return { p } as unknown as { p: typeof p };
}

test("las gracias: el ocioso espera menos que el ocupado, con nombre", () => {
  assert.equal(lider.GRACIA_EOF_OCIOSO_MS, 2000);
  assert.equal(lider.GRACIA_EOF_MS, 8000);
  assert.equal(lider.TOPE_ESCRITURAS_MS, 3000);
});

test("ocioso: stdin cerrado y SIGTERM a los 2 s, no antes", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const x = falso();
    const fin = lider.terminar(x as never, lider.GRACIA_EOF_OCIOSO_MS);
    assert.equal(x.p.stdinCerrado, 1);
    mock.timers.tick(lider.GRACIA_EOF_OCIOSO_MS - 1);
    assert.deepEqual(x.p.senales, []);
    mock.timers.tick(1);
    assert.deepEqual(x.p.senales, ["SIGTERM"]);
    x.p.emit("exit", 0);
    await fin;
  } finally {
    mock.timers.reset();
  }
});

test("ocupado (la gracia de siempre): sigue sin señal a los 2 s y SIGTERM a los 8 s", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const x = falso();
    const fin = lider.terminar(x as never);
    mock.timers.tick(lider.GRACIA_EOF_OCIOSO_MS);
    assert.deepEqual(x.p.senales, []);
    mock.timers.tick(lider.GRACIA_EOF_MS - lider.GRACIA_EOF_OCIOSO_MS);
    assert.deepEqual(x.p.senales, ["SIGTERM"]);
    x.p.emit("exit", 0);
    await fin;
  } finally {
    mock.timers.reset();
  }
});

test("si sale solo antes de la gracia no hay SIGTERM", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const x = falso();
    const fin = lider.terminar(x as never, lider.GRACIA_EOF_OCIOSO_MS);
    x.p.emit("exit", 0);
    await fin;
    mock.timers.tick(lider.GRACIA_EOF_MS);
    assert.deepEqual(x.p.senales, []);
  } finally {
    mock.timers.reset();
  }
});

test("esperarEscrituras colgada: sigue al tope y devuelve false; sin colgarse devuelve true", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const colgada = new Map<string, Promise<void>>([["a", new Promise<void>(() => {})]]);
    let r: boolean | undefined;
    const espera = pa.esperarEscrituras(lider.TOPE_ESCRITURAS_MS, colgada).then((v) => (r = v));
    mock.timers.tick(lider.TOPE_ESCRITURAS_MS - 1);
    await Promise.resolve();
    assert.equal(r, undefined);
    mock.timers.tick(1);
    await espera;
    assert.equal(r, false);
    assert.equal(await pa.esperarEscrituras(lider.TOPE_ESCRITURAS_MS, new Map([["b", Promise.resolve()]])), true);
  } finally {
    mock.timers.reset();
  }
});
