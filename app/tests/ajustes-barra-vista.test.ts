// La barra de Guardar de Ajustes (src/paneles/AjustesEditar.tsx, BarraGuardar):
// Aparece solo cuando hay cambios sin guardar, y desaparece al guardar o cancelar.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { test, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import type { Bloque } from "../src/paneles/ajustes-barra.ts";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !path.extname(spec) && ctx.parentURL?.includes("src")) {
      const base = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec);
      for (const f of [base + ".ts", base + ".tsx", path.join(base, "index.ts")])
        if (existsSync(f)) return next(path.relative(path.dirname(fileURLToPath(ctx.parentURL)), f).replace(new RegExp("\\\\", "g"), "/").replace(new RegExp("^(?!\\.)"), "./"), ctx);
    }
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    if (url.endsWith(".css")) return { format: "module", source: "export default {};", shortCircuit: true };
    if (!url.endsWith(".tsx")) return next(url, ctx);
    const { code } = transformSync(readFileSync(fileURLToPath(url), "utf8"), { loader: "tsx", format: "esm", jsx: "automatic", sourcefile: url });
    return { format: "module", source: code, shortCircuit: true };
  },
});

const noop = () => {};
Object.assign(globalThis, {
  window: globalThis,
  addEventListener: noop,
  removeEventListener: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
  location: { search: "", hash: "" },
  document: {
    documentElement: { addEventListener: noop, removeEventListener: noop },
    addEventListener: noop,
    removeEventListener: noop,
    getElementsByClassName: () => [],
    hidden: false,
    visibilityState: "visible",
  },
});

createRequire(import.meta.url)("react").useSyncExternalStore = (_suscribir: unknown, leer: () => unknown) => leer();

const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement: h } = await import("react");
const { cambiarIdioma } = await import("../src/i18n/index.ts");
const { publicar, vaciar, cancelarTodo, guardarTodo } = await import("../src/paneles/ajustes-barra.ts");
const { BarraGuardar } = await import("../src/paneles/AjustesEditar.tsx");

beforeEach(() => {
  vaciar();
  cambiarIdioma("es");
});

const bloque = (mas: Partial<Bloque> = {}): Bloque => ({
  sucio: false,
  valido: true,
  guardando: false,
  ok: false,
  error: null,
  guardar: () => {},
  cancelar: () => {},
  ...mas,
});

const html = () => renderToStaticMarkup(h(BarraGuardar));

test("sin cambios: no se muestra nada (cadena vacia, sin elemento .pn-barra)", () => {
  publicar("plan", bloque());
  assert.equal(html(), "");
});

test("con cambios: aparece la barra con Cambios sin guardar, Cancelar y Guardar", () => {
  publicar("plan", bloque({ sucio: true }));
  const salida = html();
  assert.match(salida, new RegExp("class=\"pn-barra\""));
  assert.match(salida, new RegExp("Cambios sin guardar"));
  assert.match(salida, new RegExp("Cancelar"));
  assert.match(salida, new RegExp("Guardar"));
});

test("al cancelar: la barra desaparece y vuelve a no mostrar nada", () => {
  let cancelado = false;
  publicar("plan", bloque({
    sucio: true,
    cancelar: () => {
      cancelado = true;
      publicar("plan", bloque({ sucio: false }));
    },
  }));
  assert.match(html(), new RegExp("class=\"pn-barra\""));
  cancelarTodo();
  assert.equal(cancelado, true);
  assert.equal(html(), "");
});

test("al guardar: mientras guarda muestra Guardando y al terminar desaparece", async () => {
  let guardado = false;
  publicar("plan", bloque({
    sucio: true,
    guardar: async () => {
      publicar("plan", bloque({ sucio: true, guardando: true }));
      guardado = true;
      publicar("plan", bloque({ sucio: false, guardando: false, ok: true }));
    },
  }));
  assert.match(html(), new RegExp("class=\"pn-barra\""));
  await guardarTodo();
  assert.equal(guardado, true);
  assert.equal(html(), "");
});

test("con error al guardar: la barra sigue visible mostrando el motivo", () => {
  publicar("plan", bloque({
    sucio: true,
    valido: false,
    error: "no se pudo guardar",
  }));
  const salida = html();
  assert.match(salida, new RegExp("class=\"pn-barra\""));
  assert.match(salida, new RegExp("role=\"alert\">no se pudo guardar"));
});

test("en ingles: sin cambios nada, con cambios Unsaved changes", () => {
  cambiarIdioma("en");
  assert.equal(html(), "");
  publicar("plan", bloque({ sucio: true }));
  const salida = html();
  assert.match(salida, new RegExp("class=\"pn-barra\""));
  assert.match(salida, new RegExp("Unsaved changes"));
  assert.match(salida, new RegExp("Cancel"));
  assert.match(salida, new RegExp("Save"));
});
