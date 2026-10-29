// Lo que se escribe en Ajustes antes de Guardar (src/paneles/ajustes-borrador.ts): qué se manda, cuándo vale y que
// Cancelar es volver a lo guardado. Puro: sin React ni puente.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// En src/ los imports no llevan extensión (los resuelve Vite): acá se los lleva al .ts.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !/\.\w+$/.test(spec) && ctx.parentURL?.startsWith("file:")) {
      const ts = path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec + ".ts");
      if (existsSync(ts)) return next(spec + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const { agregarDispositivo, alternarAcceso, numDesde, numPara, quitarAplicando, quitarDispositivo, remotoDesde, remotoPara } = await import("../src/paneles/ajustes-borrador.ts");
const { validarDispositivo, validarPuerto, validarRed } = await import("../electron/valida-ajustes.ts");

const G = { plan: "max", red_seguridad: 300_000 };
const R = { activo: true, puerto: 8791, dispositivos: ["celu", "tablet"] };

test("sin tocar nada no hay nada que guardar", () => {
  const r = numPara(G, numDesde(G));
  assert.deepEqual(r, { cambio: {}, error: null, sucio: false });
  const q = remotoPara(R, remotoDesde(R));
  assert.equal(q.sucio, false);
  assert.deepEqual(q.errores, {});
});

test("guardar manda sólo lo que cambió", () => {
  const b = { ...numDesde(G), plan: "pro" as const };
  assert.deepEqual(numPara(G, b).cambio, { plan: "pro" });
  assert.deepEqual(numPara(G, { ...numDesde(G), red: "250 000" }).cambio, { red_seguridad: 250_000 });
  assert.deepEqual(numPara(G, { plan: "pro", red: "" }).cambio, { plan: "pro", red_seguridad: null });
  assert.equal(numPara(G, { ...numDesde(G), red: "250000" }).sucio, true);
});

test("la red vacía es 'sin definir' y vale; con letras o fuera de rango, no", () => {
  assert.deepEqual(validarRed(""), { valor: null, error: null });
  assert.deepEqual(validarRed(" 250.000 "), { valor: 250_000, error: null });
  assert.equal(validarRed("doscientos").error, "ajustes.errRedNumero");
  assert.equal(validarRed("-5").error, "ajustes.errRedNumero");
  assert.equal(validarRed("99999").error, "ajustes.errRedRango");
  assert.equal(validarRed("1000001").error, "ajustes.errRedRango");
  const mal = numPara(G, { plan: "max", red: "50" });
  assert.equal(mal.error, "ajustes.errRedRango");
  assert.equal(mal.sucio, true);
  assert.deepEqual(mal.cambio, {}, "lo que no vale no se manda");
});

test("Cancelar es volver a nacer de lo guardado", () => {
  const editado = { plan: "pro" as const, red: "50" };
  const vuelto = numDesde(G);
  assert.notDeepEqual(editado, vuelto);
  assert.deepEqual(numPara(G, vuelto), { cambio: {}, error: null, sucio: false });
  let b = remotoDesde(R);
  b = { ...quitarDispositivo(b, "celu"), activo: false, puerto: "9000", nuevo: "otro" };
  assert.equal(remotoPara(R, b).sucio, true);
  assert.deepEqual(remotoDesde(R), { activo: true, puerto: "8791", dispositivos: ["celu", "tablet"], nuevo: "" });
  assert.equal(remotoPara(R, remotoDesde(R)).sucio, false);
});

test("agregar y quitar dispositivos trabajan sobre el borrador, no sobre lo guardado", () => {
  const b0 = remotoDesde(R);
  const a = agregarDispositivo({ ...b0, nuevo: "  Mi-Celu " });
  assert.equal(a.error, null);
  assert.deepEqual(a.borrador.dispositivos, ["celu", "tablet", "mi-celu"]);
  assert.equal(a.borrador.nuevo, "");
  assert.deepEqual(R.dispositivos, ["celu", "tablet"]);
  assert.deepEqual(remotoPara(R, a.borrador).config, { activo: true, puerto: 8791, dispositivos: ["celu", "tablet", "mi-celu"] });
  const q = quitarDispositivo(a.borrador, "tablet");
  assert.deepEqual(q.dispositivos, ["celu", "mi-celu"]);
});

test("no se agrega 0.0.0.0, una dirección, un nombre vacío ni uno repetido", () => {
  const b = remotoDesde(R);
  for (const [nuevo, clave] of [
    ["0.0.0.0", "ajustes.errDispIp"],
    ["192.0.2.1", "ajustes.errDispIp"],
    ["mi.celu", "ajustes.errDispIp"],
    ["12345", "ajustes.errDispIp"],
    ["", "ajustes.errDispVacio"],
    ["mi celu", "ajustes.errDispNombre"],
    ["-celu", "ajustes.errDispNombre"],
    ["CELU", "ajustes.errDispRepetido"],
  ] as const) {
    const a = agregarDispositivo({ ...b, nuevo });
    assert.equal(a.error, clave, nuevo);
    assert.deepEqual(a.borrador, { ...b, nuevo }, "el borrador queda como estaba");
  }
  assert.equal(validarDispositivo("mi-celu", ["otro"]), null);
});

test("el borrador del celular no se puede guardar con un puerto malo, un nombre a medio escribir o prendido sin dispositivos", () => {
  const b = remotoDesde(R);
  assert.equal(validarPuerto("80"), "ajustes.errPuertoRango");
  assert.equal(validarPuerto("abc"), "ajustes.errPuertoNumero");
  assert.equal(validarPuerto("8792"), null);
  const p = remotoPara(R, { ...b, puerto: "80" });
  assert.equal(p.config, null);
  assert.equal(p.errores.puerto, "ajustes.errPuertoRango");
  const n = remotoPara(R, { ...b, nuevo: "192.168.0.7" });
  assert.equal(n.config, null);
  assert.equal(n.errores.nuevo, "ajustes.errDispIp");
  const medio = remotoPara(R, { ...b, nuevo: "mi-tablet" });
  assert.equal(medio.config, null);
  assert.equal(medio.errores.nuevo, "ajustes.errDispPendiente");
  const vacio = remotoPara(R, { ...b, dispositivos: [] });
  assert.equal(vacio.config, null);
  assert.equal(vacio.errores.general, "ajustes.errSinDispositivos");
  // Apagado puede quedar sin dispositivos.
  assert.deepEqual(remotoPara(R, { ...b, activo: false, dispositivos: [] }).config, { activo: false, puerto: 8791, dispositivos: [] });
});

test("al instante: prender con un nombre escrito lo agrega antes; si no vale, no prende", () => {
  const b = { ...remotoDesde(R), activo: false, nuevo: "Mi-Tablet" };
  const on = alternarAcceso(b, true);
  assert.equal(on.error, null);
  assert.deepEqual(on.borrador, { activo: true, puerto: "8791", dispositivos: ["celu", "tablet", "mi-tablet"], nuevo: "" });
  assert.deepEqual(remotoPara(R, on.borrador).config, { activo: true, puerto: 8791, dispositivos: ["celu", "tablet", "mi-tablet"] });
  const malo = alternarAcceso({ ...b, nuevo: "192.168.0.7" }, true);
  assert.equal(malo.error, "ajustes.errDispIp");
  assert.equal(malo.borrador.activo, false);
  // Apagar no mira el nombre escrito.
  assert.equal(alternarAcceso({ ...b, activo: true, nuevo: "x y" }, false).borrador.activo, false);
});

test("al instante: quitar el último dispositivo deja el acceso apagado", () => {
  const b = remotoDesde(R);
  assert.deepEqual(quitarAplicando(b, "celu"), { activo: true, puerto: "8791", dispositivos: ["tablet"], nuevo: "" });
  assert.deepEqual(quitarAplicando(quitarAplicando(b, "celu"), "tablet"), { activo: false, puerto: "8791", dispositivos: [], nuevo: "" });
});
