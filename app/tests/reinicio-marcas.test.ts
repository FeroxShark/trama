// Las marcas del reinicio (electron/reinicio-marcas.ts): una línea por paso en un archivo, la corrida más reciente,
// cuándo vale y cuándo termina. Todo en una carpeta temporal; el estado va antes del import.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
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

const tmp = mkdtempSync(path.join(tmpdir(), "trama-marcas-"));
process.env.HILOS_STATE = path.join(tmp, "estado");
after(() => rmSync(tmp, { recursive: true, force: true }));
const { analizar, empezar, enMarcha, marcar, resumen } = await import("../electron/reinicio-marcas.ts");

test("analizar toma la corrida más reciente y marca `lista`", () => {
  const texto = ["100 motor 1 inicio motor", "150 motor 1 listo", "900 ventana 2 inicio ventana", "950 ventana 2 abierta", "1000 pagina 3 lista", ""].join("\n");
  const c = analizar(texto);
  assert.equal(c?.t0, 900);
  assert.equal(c?.via, "ventana");
  assert.equal(c?.lista, true);
  assert.deepEqual(c?.marcas.map((m) => m.paso), ["inicio", "abierta", "lista"]);
  assert.equal(analizar("basura\n\n"), null);
});

test("sin reinicio en marcha, marcar no escribe nada", () => {
  const f = path.join(tmp, "a", "marcas");
  assert.equal(marcar("ventana", "abierta", f), null);
  assert.equal(existsSync(f), false);
});

test("una corrida: empieza, suma pasos con su tiempo y termina en `lista`", () => {
  const f = path.join(tmp, "b", "marcas");
  empezar("motor", "motor", f, 1000);
  assert.equal(enMarcha(f, 1500)?.via, "motor");
  assert.equal(marcar("motor", "lideres-cerrados", f, 1200), 200);
  assert.equal(marcar("ventana", "abierta", f, 1700), 700);
  assert.equal(enMarcha(f, 1800)?.marcas.length, 3);
  assert.equal(marcar("pagina", "lista", f, 2500), 1500);
  assert.equal(enMarcha(f, 2600), null, "con `lista` ya no hay reinicio en marcha");
  assert.equal(marcar("pagina", "otra", f, 2700), null);
  const c = analizar(readFileSync(f, "utf8"))!;
  assert.match(resumen(c), /reinicio completo en 1500 ms: inicio \+0, lideres-cerrados \+200, abierta \+500, lista \+800/);
});

test("un reinicio viejo no cuenta, y empezar otro borra el anterior", () => {
  const f = path.join(tmp, "c", "marcas");
  empezar("ventana", "ventana", f, 1000);
  assert.equal(enMarcha(f, 1000 + 119_000)?.via, "ventana");
  assert.equal(enMarcha(f, 1000 + 121_000), null);
  empezar("motor", "motor", f, 5000);
  assert.equal(analizar(readFileSync(f, "utf8"))?.marcas.length, 1);
});
