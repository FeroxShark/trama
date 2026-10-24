// Los estados vacíos de Estadísticas: sin `medicion.tsv` (ningún worker corrió todavía) no es un error,
// viene `vacia`; un `medicion.tsv` que no se puede leer sí es error, con su código. El tablero sin vista
// está en tests/tablero.test.ts. Los imports de electron/ van con `.js`: un hook los lleva al `.ts`.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
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

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-vacios-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
process.env.PA_STATE = path.join(tmp, "pa");
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.PROYECTOS_REGISTRY = path.join(tmp, "sin-registry.json");
mkdirSync(process.env.PA_STATE);

const { leerMedicion } = await import("../electron/paneles.ts");
const { textoT } = await import("../electron/errores.ts");

test("sin medicion.tsv (ningún worker corrió todavía) no es un error: viene `vacia`", async () => {
  assert.deepEqual(await leerMedicion(), { version: 1, vacia: true });
});

test("un medicion.tsv que no se puede leer sí es error, con el código de la causa", async () => {
  const archivo = path.join(process.env.PA_STATE, "medicion.tsv");
  mkdirSync(archivo); // leer una carpeta como archivo da EISDIR
  const m = await leerMedicion();
  assert.equal(m.error, textoT("main.medicionNoLee", { que: "EISDIR" }));
  assert.equal("vacia" in m, false);
  rmSync(archivo, { recursive: true });
});
