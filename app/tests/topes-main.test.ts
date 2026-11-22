// Los topes del main que un cliente de la tailnet podría forzar (preferencias.json y leidos.json no crecen sin límite) y el
// mensaje de un error del main sin su prefijo técnico («TypeError: …»).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    // Los imports de src/ van sin extensión (y a veces apuntan a una carpeta con index.ts).
    if (spec.startsWith(".") && !path.extname(spec) && ctx.parentURL?.includes("/src/")) {
      const base = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec);
      for (const f of [base + ".ts", base + ".tsx", path.join(base, "index.ts")])
        if (existsSync(f)) return next(path.relative(path.dirname(fileURLToPath(ctx.parentURL)), f).replace(/\\/g, "/").replace(/^(?!\.)/, "./"), ctx);
    }
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    if (!url.endsWith(".tsx")) return next(url, ctx);
    const { code } = transformSync(readFileSync(fileURLToPath(url), "utf8"), { loader: "tsx", format: "esm", jsx: "automatic", sourcefile: url });
    return { format: "module", source: code, shortCircuit: true };
  },
});

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-topes-"));
process.env.HILOS_STATE = path.join(tmp, "estado");
after(() => rmSync(tmp, { recursive: true, force: true }));
Object.assign(globalThis, { location: { search: "?fixtures=0" }, window: {} });

const { guardarEffort, leerPreferencias } = await import("../electron/preferencias.ts");
const { marcarLeido, leerLeidos } = await import("../electron/leidos.ts");
const { mensaje } = await import("../src/puente.ts");

test("guardarEffort: guarda un modelo normal y descarta claves o valores enormes", async () => {
  await guardarEffort("opus", "high");
  await guardarEffort("x".repeat(101), "high");
  await guardarEffort("sonnet", "y".repeat(101));
  const e = (await leerPreferencias()).effort;
  assert.equal(e["opus"], "high");
  assert.deepEqual(Object.keys(e).filter((k) => k !== "opus"), []);
});

test("marcarLeido: un id enorme no se guarda", async () => {
  await marcarLeido("hilo-1", Date.now() / 1000);
  await marcarLeido("h".repeat(201), Date.now() / 1000);
  assert.deepEqual(Object.keys(await leerLeidos()), ["hilo-1"]);
});

test("mensaje: quita el envoltorio de Electron y el prefijo de cualquier tipo de error", () => {
  assert.equal(mensaje(new Error("Error invoking remote method 'x': Error: algo falló")), "algo falló");
  assert.equal(mensaje(new Error("Error invoking remote method 'x': TypeError: algo falló")), "algo falló");
  assert.equal(mensaje(new Error("Error invoking remote method 'x': RangeError: otro")), "otro");
  assert.equal(mensaje(new Error("sin envoltorio")), "sin envoltorio");
});
