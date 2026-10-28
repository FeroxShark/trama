// src/carcasa.ts: Ajustes > Cuentas sólo existe donde el preload de la carcasa de Windows deja `window.carcasa`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
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
