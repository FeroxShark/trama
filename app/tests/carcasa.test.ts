// src/carcasa.ts: Ajustes > Cuentas sólo existe donde el preload de la carcasa de Windows deja `window.carcasa`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !path.extname(spec) && ctx.parentURL?.includes("/src/")) {
      const base = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec);
      for (const f of [base + ".ts", base + ".tsx", path.join(base, "index.ts")])
        if (existsSync(f)) return next(path.relative(path.dirname(fileURLToPath(ctx.parentURL)), f).replace(/\\/g, "/").replace(/^(?!\.)/, "./"), ctx);
    }
    return next(spec, ctx);
  },
});

const g = globalThis as unknown as { window: Record<string, unknown> };
Object.assign(globalThis, { location: { search: "?fixtures=0" }, window: {} });
const { carcasa } = await import("../src/carcasa.ts");

test("sin carcasa (Linux, el celular) no hay sección de cuentas", () => {
  assert.equal(carcasa(), null);
  g.window.carcasa = { pasos: () => {} }; // un preload viejo sin cuentas
  assert.equal(carcasa(), null);
});

test("con la carcasa del .exe se usa la de verdad", async () => {
  const real = { cuentas: async () => ({ claude: { instalado: true, logueado: false }, agy: { instalado: true, logueado: true } }), conectar: async () => ({}) };
  g.window.carcasa = real;
  assert.equal(carcasa(), real);
  assert.deepEqual(await carcasa()!.cuentas(), { claude: { instalado: true, logueado: false }, agy: { instalado: true, logueado: true } });
});

// La carcasa de Windows pregunta al motor (`lider:ocupados`, por /rpc) cuántos líderes responden, igual que Linux (nucleo.salir).
const req = createRequire(import.meta.url);
const { crearCanalesVentana } = req("../../windows/src/ventana.js");
const { llamarRpc } = req("../../windows/src/nativo.js");

/** Un motor falso: contesta `valor` a `lider:ocupados` (y anota los canales que le pidieron). */
async function motorFalso(valor: unknown) {
  const pedidos: string[] = [];
  const srv = http.createServer((rq, rs) => {
    let cuerpo = "";
    rq.on("data", (b) => (cuerpo += b));
    rq.on("end", () => {
      pedidos.push(JSON.parse(cuerpo).canal);
      rs.setHeader("content-type", "application/json");
      rs.end(JSON.stringify({ ok: true, valor }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const puerto = (srv.address() as AddressInfo).port;
  return { puerto, pedidos, cerrar: () => new Promise<void>((r) => srv.close(() => r())) };
}

/** La tabla de la carcasa con una app falsa: cuenta los `quit` y las ventanas escondidas. */
function carcasaFalsa(ocupados: (() => Promise<unknown>) | undefined) {
  const hecho = { quit: 0, ocultas: 0 };
  const tabla = crearCanalesVentana({
    electron: { app: { quit: () => void hecho.quit++ }, BrowserWindow: { getAllWindows: () => [{ hide: () => void hecho.ocultas++ }] } },
    ocupados,
    log: () => {},
  });
  return { tabla, hecho };
}

test("app:salir devuelve cuántos líderes responden (el RPC dice 2) y no sale; con forzar sale", async () => {
  const motor = await motorFalso(2);
  try {
    const consulta = llamarRpc({ canal: "lider:ocupados", puerto: motor.puerto });
    const { tabla, hecho } = carcasaFalsa(async () => {
      const r = await consulta();
      return r.ok ? r.valor : null;
    });
    assert.equal(await tabla["app:salir"]({}, { modo: "parar", forzar: false }), 2);
    assert.equal(await tabla["app:salir"]({}, { modo: "seguir", forzar: false }), 2);
    assert.equal(await tabla["app:pararTodo"]({}, false), 2);
    assert.deepEqual(hecho, { quit: 0, ocultas: 0 });
    assert.deepEqual(motor.pedidos, ["lider:ocupados", "lider:ocupados", "lider:ocupados"]);
    assert.equal(await tabla["app:salir"]({}, { modo: "parar", forzar: true }), 0);
    assert.equal(hecho.quit, 1);
    assert.equal(motor.pedidos.length, 3, "con forzar ni pregunta");
  } finally {
    await motor.cerrar();
  }
});

test("app:salir con el motor caído (o sin nadie ocupado) hace lo de siempre: devuelve 0 y sale o esconde", async () => {
  // Un puerto que acaba de cerrarse: nadie escucha.
  const caido = await motorFalso(0);
  await caido.cerrar();
  const consulta = llamarRpc({ canal: "lider:ocupados", puerto: caido.puerto });
  const mudo = carcasaFalsa(async () => {
    const r = await consulta();
    return r.ok ? r.valor : null;
  });
  assert.equal(await mudo.tabla["app:salir"]({}, { modo: "parar", forzar: false }), 0);
  assert.equal(await mudo.tabla["app:salir"]({}, { modo: "seguir", forzar: false }), 0);
  assert.equal(await mudo.tabla["app:pararTodo"]({}, false), 0);
  assert.deepEqual(mudo.hecho, { quit: 2, ocultas: 1 });
  // Un RPC que revienta o una carcasa sin la pregunta tampoco bloquean.
  for (const o of [async () => Promise.reject(new Error("no")), undefined, async () => 0]) {
    const c = carcasaFalsa(o);
    assert.equal(await c.tabla["app:salir"]({}, { modo: "parar", forzar: false }), 0);
    assert.equal(c.hecho.quit, 1);
  }
});
