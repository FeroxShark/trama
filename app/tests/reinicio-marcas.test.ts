// Las marcas del reinicio (electron/reinicio-marcas.ts): una línea por paso con el id de su corrida (su `inicio`),
// cada etapa medida desde el inicio de SU corrida, y se guardan las últimas CORRIDAS. Todo en una carpeta temporal;
// el estado va antes del import.
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
const { CORRIDAS, analizar, empezar, enMarcha, marcar, resumen } = await import("../electron/reinicio-marcas.ts");

test("analizar toma la corrida más reciente y marca `lista`", () => {
  const texto = ["100 100 motor 1 inicio motor", "150 100 motor 1 listo", "900 900 ventana 2 inicio ventana", "950 900 ventana 2 abierta", "1000 900 pagina 3 lista", ""].join("\n");
  const c = analizar(texto);
  assert.equal(c?.t0, 900);
  assert.equal(c?.via, "ventana");
  assert.equal(c?.lista, true);
  assert.deepEqual(c?.marcas.map((m) => m.paso), ["inicio", "abierta", "lista"]);
  assert.equal(analizar("basura\n\n"), null);
});

test("el formato de antes (sin id) se lee como una sola corrida", () => {
  const c = analizar(["100 motor 1 inicio motor", "150 motor 1 lista", ""].join("\n"));
  assert.equal(c?.t0, 100);
  assert.equal(c?.lista, true);
});

test("dos corridas intercaladas: cada una da sus marcas y sus duraciones desde su inicio", () => {
  const texto = [
    "1000 1000 motor 1 inicio motor",
    "1200 1000 motor 1 lideres-cerrados",
    "1500 1500 ventana 2 inicio ventana",
    "1600 1500 pagina 3 abierta",
    "1700 1000 ventana 2 abierta",
    "1900 1500 pagina 3 lista",
    "2300 1000 pagina 3 lista",
    "",
  ].join("\n");
  const a = analizar(texto, 1000)!;
  assert.deepEqual(a.marcas.map((m) => m.paso), ["inicio", "lideres-cerrados", "abierta", "lista"]);
  assert.equal(resumen(a), "reinicio completo en 1300 ms: inicio +0, lideres-cerrados +200, abierta +700, lista +1300");
  const b = analizar(texto, 1500)!;
  assert.equal(resumen(b), "reinicio completo en 400 ms: inicio +0, abierta +100, lista +400");
  assert.equal(analizar(texto)?.t0, 1500, "sin id, la más reciente");
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
  assert.equal(resumen(c), "reinicio completo en 1500 ms: inicio +0, lideres-cerrados +200, abierta +700, lista +1500");
});

test("un reinicio viejo no cuenta, y empezar otro deja la corrida anterior en el archivo", () => {
  const f = path.join(tmp, "c", "marcas");
  empezar("ventana", "ventana", f, 1000);
  assert.equal(enMarcha(f, 1000 + 119_000)?.via, "ventana");
  assert.equal(enMarcha(f, 1000 + 121_000), null);
  empezar("motor", "motor", f, 5000);
  assert.equal(analizar(readFileSync(f, "utf8"))?.marcas.length, 1);
  assert.equal(analizar(readFileSync(f, "utf8"), 1000)?.marcas.length, 1);
});

test(`se guardan las últimas ${CORRIDAS} corridas: con 35, quedan 30`, () => {
  const f = path.join(tmp, "d", "marcas");
  for (let i = 1; i <= 35; i++) {
    empezar("motor", "motor", f, i * 1000);
    marcar("motor", "lideres-cerrados", f, i * 1000 + 100);
  }
  const texto = readFileSync(f, "utf8");
  assert.equal(texto.split("\n").filter((l) => / inicio /.test(l)).length, CORRIDAS);
  assert.equal(analizar(texto, 5000), null, "la 5ª (la más vieja) se tiró");
  assert.equal(analizar(texto, 6000)?.marcas.length, 2, "la 6ª quedó, con su marca");
  assert.equal(analizar(texto)?.t0, 35_000);
  assert.equal(resumen(analizar(texto, 6000)!), "reinicio completo en 100 ms: inicio +0, lideres-cerrados +100");
});
