// El acceso desde el celular editado desde Ajustes (electron/remoto-config.ts): agregar y quitar dispositivos, apagar sin
// perder la lista, y rechazar lo que no es un dispositivo (una dirección como 0.0.0.0, un campo de más) sin tocar el
// archivo. Siempre sobre un `remoto.json` en una carpeta temporal: nunca el de la trama de Ana.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-remoto-config-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
process.env.HILOS_STATE = tmp;

const { guardarConfig, leerEditable, validarConfig } = await import("../electron/remoto-config.ts");
const { leerConfig } = await import("../electron/remoto.ts");
const { cambiarIdioma, textoMain } = await import("../src/i18n/index.ts");

const archivo = path.join(tmp, "remoto.json");
const leer = () => readFileSync(archivo, "utf8");
const nuevo = () => rmSync(archivo, { force: true });

/** Los errores del main vienen como clave: se leen como los vería Ana en español. */
const enEs = (s: string) => {
  cambiarIdioma("es");
  try {
    return textoMain(s);
  } finally {
    cambiarIdioma("en");
  }
};
const lanza = (re: RegExp) => (e: unknown) => re.test(enEs((e as Error).message));

test("sin archivo: apagado, con el puerto de siempre para proponer", async () => {
  nuevo();
  assert.deepEqual(await leerEditable(archivo), { activo: false, puerto: 8791, dispositivos: [] });
  assert.equal(leerConfig(archivo), null);
});

test("agregar un dispositivo escribe el archivo de siempre y el servidor lo lee", async () => {
  nuevo();
  await guardarConfig({ activo: true, puerto: 8791, dispositivos: ["celu"] }, archivo);
  const c = await leerEditable(archivo);
  await guardarConfig({ ...c, dispositivos: [...c.dispositivos, "Tablet-Sala"] }, archivo);
  assert.deepEqual(JSON.parse(leer()), { version: 1, puerto: 8791, dispositivos: ["celu", "tablet-sala"] });
  assert.deepEqual(leerConfig(archivo), { puerto: 8791, dispositivos: ["celu", "tablet-sala"] });
  assert.ok(leer().endsWith("\n"));
});

test("quitar un dispositivo lo saca de lo que se lee (y no queda ninguno de más)", async () => {
  nuevo();
  await guardarConfig({ activo: true, puerto: 8800, dispositivos: ["celu", "tablet"] }, archivo);
  await guardarConfig({ activo: true, puerto: 8800, dispositivos: ["tablet"] }, archivo);
  assert.deepEqual(leerConfig(archivo), { puerto: 8800, dispositivos: ["tablet"] });
  assert.deepEqual((await leerEditable(archivo)).dispositivos, ["tablet"]);
});

test("un mismo dispositivo dos veces (o en otras mayúsculas) queda una", () => {
  assert.deepEqual(validarConfig({ activo: true, puerto: 9000, dispositivos: ["Celu", "celu", "otro"] }).dispositivos, ["celu", "otro"]);
});

test("apagar conserva el puerto y la lista, y el servidor no escucha", async () => {
  nuevo();
  await guardarConfig({ activo: false, puerto: 8801, dispositivos: ["celu"] }, archivo);
  assert.deepEqual(JSON.parse(leer()), { version: 1, puerto: 8801, dispositivos: ["celu"], activo: false });
  assert.equal(leerConfig(archivo), null);
  assert.deepEqual(await leerEditable(archivo), { activo: false, puerto: 8801, dispositivos: ["celu"] });
  // Prenderlo de nuevo borra la marca.
  await guardarConfig({ activo: true, puerto: 8801, dispositivos: ["celu"] }, archivo);
  assert.equal("activo" in JSON.parse(leer()), false);
  assert.deepEqual(leerConfig(archivo), { puerto: 8801, dispositivos: ["celu"] });
});

test("un remoto.json escrito a mano, sin `activo`, sigue valiendo prendido", async () => {
  writeFileSync(archivo, JSON.stringify({ version: 1, puerto: 8791, dispositivos: ["celu"] }));
  assert.deepEqual(await leerEditable(archivo), { activo: true, puerto: 8791, dispositivos: ["celu"] });
});

test("rechaza 0.0.0.0 y cualquier dirección como dispositivo, sin tocar el archivo", async () => {
  nuevo();
  await guardarConfig({ activo: true, puerto: 8791, dispositivos: ["celu"] }, archivo);
  const antes = leer();
  for (const malo of ["0.0.0.0", "192.0.2.1", "::1", "[fd7a::1]", "10", "mi.celu", "celu/../x", "", "  ", "-celu", "ce lu"]) {
    await assert.rejects(guardarConfig({ activo: true, puerto: 8791, dispositivos: ["celu", malo] }, archivo), lanza(/dispositivo/i), JSON.stringify(malo));
  }
  assert.equal(leer(), antes);
});

test("rechaza decirle dónde escuchar: un campo `host` (o cualquiera que no sea de la lista) no se guarda", async () => {
  nuevo();
  await guardarConfig({ activo: true, puerto: 8791, dispositivos: ["celu"] }, archivo);
  const antes = leer();
  for (const extra of [{ host: "0.0.0.0" }, { bind: "0.0.0.0" }, { funnel: true }, { version: 2 }]) {
    await assert.rejects(guardarConfig({ activo: true, puerto: 8791, dispositivos: ["celu"], ...extra }, archivo), lanza(/desconocido/i), JSON.stringify(extra));
  }
  assert.equal(leer(), antes);
});

test("rechaza un puerto que no se puede abrir, una lista de otra forma y prender sin dispositivos", async () => {
  nuevo();
  for (const puerto of [80, 1023, 65536, 8791.5, "8791", null, NaN]) {
    await assert.rejects(guardarConfig({ activo: true, puerto, dispositivos: ["celu"] }, archivo), lanza(/puerto/i), String(puerto));
  }
  await assert.rejects(guardarConfig({ activo: true, puerto: 8791, dispositivos: "celu" }, archivo), lanza(/inválido/i));
  await assert.rejects(guardarConfig({ activo: "si", puerto: 8791, dispositivos: ["celu"] }, archivo), lanza(/inválido/i));
  await assert.rejects(guardarConfig(["celu"], archivo), lanza(/inválido/i));
  await assert.rejects(guardarConfig(null, archivo), lanza(/inválido/i));
  await assert.rejects(guardarConfig({ activo: true, puerto: 8791, dispositivos: [] }, archivo), lanza(/al menos un dispositivo/i));
  await assert.rejects(guardarConfig({ activo: true, puerto: 8791, dispositivos: Array.from({ length: 21 }, (_, i) => `d${i}`) }, archivo), lanza(/demasiados/i));
  assert.equal(existsSync(archivo), false, "nada de lo rechazado dejó un archivo");
  // Apagado sí puede quedar sin dispositivos (no hay nada que abrir).
  await guardarConfig({ activo: false, puerto: 8791, dispositivos: [] }, archivo);
  assert.equal(leerConfig(archivo), null);
});
