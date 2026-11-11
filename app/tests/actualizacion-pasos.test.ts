// El paso real de la instalación (`pasoDesdeLog` y `trama-actualizacion.json`): bajando → compilando → motor → ventana, con `desde`.
// Log de ejemplo inline, como lo escribe motor/scripts/instalar-producto.sh; nunca corre el instalador real.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { esperarHasta } from "./esperar.ts";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const tmp = mkdtempSync(path.join(os.tmpdir(), "trama-pasos-"));
process.env.HILOS_STATE = path.join(tmp, "estado");
const m = await import("../electron/actualizacion-trama.ts");

const LOG = {
  bajando: "ok     /usr/bin/node\nhecho  enlace /home/u/.local/bin/pa -> /fuente/motor/bin/pa\n",
  compilando: "hecho  app: instalando dependencias y compilando en /home/u/.local/share/trama/app (unos minutos)\n",
  motor: "ok     app compilada\npaso   motor\nhecho  unit /home/u/.config/systemd/user/trama-motor.service\n",
  ventana: "paso   ventana\nhecho  app de escritorio: bajando el binario de Electron (unos minutos)\n",
};

test("pasoDesdeLog: recorre los 4 pasos y devuelve el correcto en cada corte", () => {
  assert.equal(m.pasoDesdeLog(""), null, "sin marcas todavía es «bajando» (lo decide quien llama)");
  assert.equal(m.pasoDesdeLog(LOG.bajando), null);
  const c = LOG.bajando + LOG.compilando;
  const mo = c + LOG.motor;
  const v = mo + LOG.ventana;
  assert.equal(m.pasoDesdeLog(c, undefined, 10)?.paso, "compilando");
  assert.equal(m.pasoDesdeLog(mo, undefined, 10)?.paso, "motor");
  assert.equal(m.pasoDesdeLog(v, undefined, 10)?.paso, "ventana");
});

test("pasoDesdeLog: `desde` es la hora en que se vio el paso, y no se mueve mientras el paso sigue", () => {
  const log = LOG.bajando + LOG.compilando;
  assert.deepEqual(m.pasoDesdeLog(log, undefined, 500), { paso: "compilando", desde: 500 });
  assert.deepEqual(m.pasoDesdeLog(log + "mas salida\n", { paso: "compilando", desde: 500 }, 900), { paso: "compilando", desde: 500 });
  assert.deepEqual(m.pasoDesdeLog(log + LOG.motor, { paso: "compilando", desde: 500 }, 900), { paso: "motor", desde: 900 });
});

test("pasoActValido: sólo los cuatro pasos", () => {
  for (const p of m.PASOS_ACT) assert.equal(m.pasoActValido(p), true);
  for (const x of ["", "listo", null, 3]) assert.equal(m.pasoActValido(x), false);
});

test("actualizar: trama-actualizacion.json lleva `paso` y `desde` y avanza con el log; un JSON viejo sin ellos se lee igual", async () => {
  const dir = mkdtempSync(path.join(tmp, "e2e-"));
  const archivoAct = path.join(dir, "trama-actualizacion.json");
  const registro = path.join(dir, "trama-actualizacion.log");
  const co = path.join(dir, "co");
  const escribir = (t: string) => writeFileSync(registro, t);
  const leer = () => JSON.parse(readFileSync(archivoAct, "utf8")) as Record<string, unknown>;
  let soltar: () => void = () => {};
  const termina = new Promise<void>((r) => (soltar = r));
  const act = m.crearActualizacionTrama({
    archivo: path.join(dir, "trama-version.json"),
    archivoAct,
    registro,
    checkout: () => co,
    instalada: () => "0.1.0",
    repo: () => "dueno/proyecto",
    pasoMs: 5,
    traer: async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ tag_name: "v0.1.4" }) }),
    correr: async (p) => {
      if (!p.registro) return { code: 0, salida: "" };
      p.alPid?.(4242);
      escribir(LOG.bajando);
      await esperarHasta(() => leer().pid === 4242);
      assert.equal(leer().paso, "bajando");
      assert.equal(typeof leer().desde, "number");
      for (const [paso, texto] of [["compilando", LOG.compilando], ["motor", LOG.motor], ["ventana", LOG.ventana]] as const) {
        escribir(readFileSync(registro, "utf8") + texto);
        await esperarHasta(() => leer().paso === paso);
      }
      await termina;
      return { code: 0, salida: readFileSync(registro, "utf8") };
    },
  });
  await act.leerAviso();
  const fin = act.actualizar();
  await esperarHasta(() => existsSync(archivoAct) && leer().fase === "instalando" && leer().paso === "ventana");
  const j = leer();
  assert.equal(j.fase, "instalando");
  assert.equal(j.version, "0.1.4");
  assert.equal(m.pasoActValido(j.paso), true);
  assert.ok(Number.isFinite(j.desde as number));
  // `ultima` (la última línea nueva del log) y `registro` (su ruta, para «Ver registro») viajan con el estado.
  assert.ok(Number.isFinite(j.ultima as number));
  assert.equal(j.registro, registro);
  assert.deepEqual(await act.estadoActual(), { fase: "instalando", version: "0.1.4", paso: "ventana", desde: j.desde, ultima: j.ultima, registro });
  soltar();
  assert.deepEqual(await fin, { ok: true, version: "0.1.4" });

  // JSON viejo (sin paso ni desde): se lee igual.
  const viejo = path.join(dir, "viejo.json");
  writeFileSync(viejo, '{"fase":"instalando","version":"0.1.4","pid":7}');
  const b = m.crearActualizacionTrama({ archivo: path.join(dir, "v2.json"), archivoAct: viejo, registro, instalada: () => "0.1.0", vivo: () => true });
  assert.deepEqual(await b.estadoActual(), { fase: "instalando", version: "0.1.4" });
});
