// La espera de cada corrida (`espera_s` de medicion.tsv): el panel de Estadísticas la lee por nombre de columna, y las
// filas de antes de que existiera la columna quedan en `null` (no en 0: no hay dato). Lo que pa anota lo prueba
// tests/paridad (lanzar y puestos, contra el bash). Los imports de electron/ van con `.js`: un hook los lleva al `.ts`.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

const tmp = mkdtempSync(path.join(os.tmpdir(), "espera-cola-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
process.env.PA_STATE = path.join(tmp, "pa");
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.PROYECTOS_REGISTRY = path.join(tmp, "sin-registry.json");
mkdirSync(process.env.PA_STATE);

const { leerMedicion } = await import("../electron/paneles.ts");

test("medicion.tsv: espera_s de cada corrida; las filas de antes de la columna dan null", async () => {
  const ahora = Date.now() / 1000;
  const hoy = new Date(ahora * 1000).toISOString();
  const cab = "fecha\tid\tproyecto\tmodelo\tduration_s\ttokens\tbien\tcompactaciones\tcache_read\tespera_s";
  writeFileSync(
    path.join(process.env.PA_STATE!, "medicion.tsv"),
    [
      cab,
      `${hoy}\tx1\tatlas\tclaude-opus-5-5\t60\t1000\t\t\t\t0`,
      `${hoy}\tx2\tatlas\tclaude-opus-5-5\t60\t1000\t\t\t\t185`,
      `${hoy}\tx3\tatlas\tclaude-opus-5-5\t60\t1000`,
      "",
    ].join("\n"),
  );
  const r = await leerMedicion(ahora);
  assert.ok("corridas" in r);
  assert.deepEqual(
    r.corridas.map((c) => c.espera_s),
    [0, 185, null],
  );
});
