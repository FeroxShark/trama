// El plan de días ausentes: una ausencia pasada se sigue contando mientras pueda caer dentro de la ventana semanal vigente (168 h),
// no se olvida a la medianoche; recién a los 7 días sale.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { planLeer } from "../electron/cli/reparto.ts";

const dir = mkdtempSync(path.join(os.tmpdir(), "reparto-plan-"));
const ruta = path.join(dir, "plan.json");
writeFileSync(ruta, JSON.stringify({ version: 1, actualizado: "2026-11-20T12:00:00Z", ausente: ["2026-11-14", "2026-11-21", "2026-11-23"] }));
// Mediodía local: no depende de la zona horaria de la máquina.
const al = (d: number) => new Date(2026, 10, d, 12, 0, 0);

test("la ausencia de ayer sigue en el plan después de la medianoche", () => {
  assert.deepEqual(planLeer(al(21), ruta).ausente, ["2026-11-14", "2026-11-21", "2026-11-23"], "justo 7 días atrás todavía cuenta");
  assert.deepEqual(planLeer(al(22), ruta).ausente, ["2026-11-21", "2026-11-23"], "pasada la medianoche no se olvida");
  assert.deepEqual(planLeer(al(27), ruta).ausente, ["2026-11-21", "2026-11-23"]);
});

test("a los 7 días ya no puede pertenecer a una ventana vigente y se descarta", () => {
  assert.deepEqual(planLeer(al(29), ruta).ausente, ["2026-11-23"]);
  assert.deepEqual(planLeer(al(31), ruta).ausente, []);
});
