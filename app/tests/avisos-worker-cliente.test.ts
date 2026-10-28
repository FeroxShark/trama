// Lo del renderer y de la acción de relanzar: qué se guarda, qué se notifica, cómo se dice (en los dos idiomas) y la línea de `pa`
// de "Relanzar con otro modelo". La detección está en tests/avisos-worker.test.ts.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
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

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-avisos-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
process.env.PA_STATE = path.join(tmp, "pa");
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.PROYECTOS_REGISTRY = path.join(tmp, "sin-registry.json");
process.env.HILOS_PA = path.join(import.meta.dirname, "..", "scripts", "pa-falso.sh");

const { argvRelanzar } = await import("../electron/paneles.ts");
const { debeNotificar, descartarAviso, avisosPendientes, recibirAviso, reiniciarAvisos, terminadosSinVer, textoAviso, textoMotivo, verTerminados } = await import("../src/avisos-worker.ts");
const { cambiarIdioma } = await import("../src/i18n/index.ts");
const { rastroDeWorker } = await import("../electron/avisos-worker-disco.ts");

const AHORA = 1_900_000_000_000;
const aviso = (tipo: string, extra: object = {}) =>
  ({ tipo, clave: `x:${tipo}`, id: "20261027-232930-2191095", proyecto: "trama", tarea: "arreglar la barra", modelo: "m", jefe_id: "j1", jefe: "ana", motivo: "", ts: AHORA, ...extra }) as never;

test("lo que se guarda: fallas y colgados quedan hasta el ✕; los terminados bien sólo cuentan hasta mirar la ventana", () => {
  reiniciarAvisos();
  assert.ok(recibirAviso(aviso("fin", { clave: "a:fin" }), AHORA));
  assert.ok(recibirAviso(aviso("cupo", { clave: "b:cupo", proveedor: "Google", vuelve: null }), AHORA));
  assert.ok(recibirAviso(aviso("tanda", { clave: "c:tanda", n: 3 }), AHORA));
  assert.equal(terminadosSinVer(), 1);
  assert.deepEqual(avisosPendientes().map((a) => a.clave), ["b:cupo"]);
  assert.ok(!recibirAviso(aviso("cupo", { clave: "b:cupo" }), AHORA), "el mismo aviso dos veces no cuenta");
  verTerminados();
  assert.equal(terminadosSinVer(), 0);
  descartarAviso("b:cupo");
  assert.deepEqual(avisosPendientes(), []);
});

test("un reenvío viejo (un celular que se reconecta) no vuelve a avisar", () => {
  reiniciarAvisos();
  assert.ok(!recibirAviso(aviso("falla", { ts: AHORA - 11 * 60_000 }), AHORA));
  assert.equal(avisosPendientes().length, 0);
});

test("se notifica lo que falla y la tanda, con el ajuste prendido y la ventana sin el foco; un terminado normal nunca", () => {
  const o = { avisar: true, enfocada: false };
  for (const tipo of ["falla", "cupo", "colgado", "tanda"]) assert.ok(debeNotificar(aviso(tipo), o), tipo);
  assert.ok(!debeNotificar(aviso("fin"), o));
  assert.ok(!debeNotificar(aviso("falla"), { avisar: false, enfocada: false }));
  assert.ok(!debeNotificar(aviso("falla"), { avisar: true, enfocada: true }));
});

test("el aviso por cupo dice el proveedor y cuándo vuelve, en español e inglés", () => {
  const ahoraS = AHORA / 1000;
  const a = aviso("cupo", { proveedor: "Google", vuelve: ahoraS + 7200 });
  cambiarIdioma("es");
  assert.match(textoMotivo(a, ahoraS), /^Google sin cupo\. Vuelve /);
  assert.equal(textoAviso(a, ahoraS).titulo, "Un worker se quedó sin cupo");
  assert.match(textoAviso(a, ahoraS).cuerpo, /^arreglar la barra: Google sin cupo/);
  assert.match(textoMotivo(aviso("cupo", { proveedor: "Google", vuelve: null })), /No se sabe cuándo vuelve/);
  cambiarIdioma("en");
  assert.match(textoMotivo(a, ahoraS), /^Google is out of quota\. Back /);
  assert.equal(textoAviso(aviso("tanda", { n: 3, fallas: 1 })).cuerpo, "All 3 workers of the batch finished; 1 failed.");
  cambiarIdioma("es");
  assert.equal(textoAviso(aviso("colgado", { minutos: 17 })).cuerpo, "arreglar la barra: Sin actividad hace 17 min.");
  assert.equal(textoMotivo(aviso("falla", { motivo: "boom" })), "boom");
  assert.equal(textoMotivo(aviso("falla", { rc: 3 })), "Salió con código 3.");
  assert.equal(textoMotivo(aviso("falla", { sinArrancar: true })), "Murió en la cola, sin llegar a arrancar.");
});

test("relanzar: la misma tarea, sin -m, colgada del mismo líder; sin tarea o con ids raros no sale", async () => {
  const ID = "20261027-232930-2191095";
  const { args, env } = await argvRelanzar({ id: ID, proyecto: "trama", tarea: "  hacé X  ", jefe_id: "j1", jefe: "ana" });
  assert.deepEqual(args, ["trama", "--async", "--tipo", "codigo-acotado", "--", "hacé X"]);
  assert.equal(env.PA_JEFE_ID, "j1");
  assert.equal(env.PA_JEFE, "ana");
  await assert.rejects(argvRelanzar({ id: ID, proyecto: "trama", tarea: "  " }));
  await assert.rejects(argvRelanzar({ id: "../x", proyecto: "trama", tarea: "x" }));
  await assert.rejects(argvRelanzar({ id: ID, proyecto: "-rm", tarea: "x" }));
});

test("el rastro de un worker caído sale del final de su .err y del result de su .json; sin archivos, vacío", async () => {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const id = "20261027-111111-1";
  mkdirSync(path.join(tmp, "pa", "trama"), { recursive: true });
  writeFileSync(path.join(tmp, "pa", "trama", `${id}.err`), "x".repeat(10_000) + "\nIndividual quota reached\n");
  writeFileSync(path.join(tmp, "pa", "trama", `${id}.json`), JSON.stringify({ result: "RESULTADO: rate limit" }));
  const r = await rastroDeWorker(path.join(tmp, "pa"), { id, proyecto: "trama" });
  assert.match(r, /Individual quota reached/);
  assert.match(r, /rate limit/);
  assert.ok(r.length < 5000, "acotado");
  assert.equal(await rastroDeWorker(path.join(tmp, "pa"), { id: "20261027-222222-2", proyecto: "trama" }), "");
  assert.equal(await rastroDeWorker(path.join(tmp, "pa"), { id: "../../etc", proyecto: "trama" }), "");
});
