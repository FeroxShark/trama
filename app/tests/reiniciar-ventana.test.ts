// "Reiniciar la ventana" (electron/reiniciar-ventana.ts): va por el camino del build nuevo, así que abre la corrida de
// reinicio y la ventana que vuelve carga con `?actualizando=1` (la tarjeta «Actualizando Trama…»), no a secas.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

// Los .js de electron/ se resuelven a su .ts (como en reinicio-marcas.test.ts).
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const tmp = mkdtempSync(path.join(tmpdir(), "trama-reiniciar-ventana-"));
process.env.HILOS_STATE = path.join(tmp, "estado");
after(() => rmSync(tmp, { recursive: true, force: true }));
const { reiniciarVentana } = await import("../electron/reiniciar-ventana.ts");
const { empezar, enMarcha, marcar } = await import("../electron/reinicio-marcas.ts");

function deps(residente: boolean, orden: string[], marcas?: string) {
  return {
    residente,
    empezar: () => {
      orden.push("empezar");
      if (marcas) empezar("ventana", "ventana", marcas);
    },
    marcar: (p: string) => void orden.push(`marcar:${p}`),
    anotar: async () => void orden.push("anotar"),
    relanzar: () => void orden.push("relanzar"),
    recargar: () => void orden.push("recargar"),
  };
}

test("reiniciarVentana: abre la corrida (la del cartel) antes de anotar y relanzar", async () => {
  const orden: string[] = [];
  await reiniciarVentana(deps(true, orden));
  assert.deepEqual(orden, ["empezar", "marcar:ventana-aviso", "anotar", "marcar:ventana-guardo", "relanzar"]);
});

test("reiniciarVentana: el proceso que vuelve ve una corrida en marcha por la ventana (=> ?actualizando=1)", async () => {
  const archivo = path.join(tmp, "marcas");
  await reiniciarVentana(deps(true, [], archivo));
  const c = enMarcha(archivo);
  assert.ok(c, "sin corrida en marcha el proceso nuevo arrancaría sin cartel");
  assert.equal(c.via, "ventana");
  assert.equal(marcar("ventana", "x", archivo) !== null, true);
});

test("reiniciarVentana: sin proceso que relanzar (bench, captura, dev) sólo recarga la página", async () => {
  const orden: string[] = [];
  await reiniciarVentana(deps(false, orden));
  assert.deepEqual(orden, ["recargar"]);
});
