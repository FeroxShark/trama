// El acceso a la limpieza de worktrees y ramas viejos desde el panel de Ramas (el ícono de Ramas del riel): existe, abre el mismo bloque
// que Ajustes > Proyectos (LimpiezaPa, sin duplicar lógica) y tirar sigue pidiendo confirmar (primero «Ver qué se borraría»).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !path.extname(spec) && ctx.parentURL?.includes("/src/")) {
      const base = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec);
      for (const f of [base + ".ts", base + ".tsx", path.join(base, "index.ts")])
        if (existsSync(f)) return next(path.relative(path.dirname(fileURLToPath(ctx.parentURL)), f).replace(/\\/g, "/").replace(/^(?!\.)/, "./"), ctx);
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

Object.assign(globalThis, { window: globalThis, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), location: { search: "", hash: "" }, document: { documentElement: { style: { setProperty() {}, removeProperty() {} }, dataset: {}, setAttribute() {}, classList: { toggle() {}, add() {}, remove() {} } }, addEventListener() {}, removeEventListener() {}, getElementsByClassName: () => [], hidden: false, visibilityState: "visible" } });
createRequire(import.meta.url)("react").useSyncExternalStore = (_suscribir: unknown, leer: () => unknown) => leer();

const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement: h } = await import("react");
const { cambiarIdioma } = await import("../src/i18n/index.ts");
const { Ramas } = await import("../src/paneles/Ramas.tsx");

const props = {
  hilos: [],
  optimista: new Map(),
  errores: new Map(),
  enCurso: new Set<string>(),
  alActuar() {},
  alAbrir() {},
  alRetomar: async () => {},
  alArreglar: async () => {},
  alActualizar: async () => {},
  conflictos: new Set<string>(),
  analista: null,
};

test("Ramas ofrece «Limpiar ramas y puestos viejos» (cerrado, con aria-expanded) en es y en", () => {
  for (const [idioma, texto] of [["es", "Limpiar ramas y puestos viejos"], ["en", "Clean up old branches and stations"]] as const) {
    cambiarIdioma(idioma);
    const html = renderToStaticMarkup(h(Ramas, props));
    assert.match(html, /data-limpiar-ramas/);
    assert.match(html, /aria-expanded="false"/);
    assert.ok(html.includes(texto), idioma);
    assert.doesNotMatch(html, /data-limpieza-ramas/, "cerrado: la limpieza no se pinta hasta abrirla");
  }
});

test("el acceso abre LimpiezaPa (la misma de Ajustes) y no hay otra lógica de borrado en Ramas", () => {
  const src = readFileSync(new URL("../src/paneles/Ramas.tsx", import.meta.url), "utf8");
  assert.match(src, /import \{ LimpiezaPa \} from "\.\/AjustesLimpieza"/);
  assert.match(src, /limpiando \? \([\s\S]{0,200}<LimpiezaPa \/>/);
  assert.doesNotMatch(src, /fuenteLimpieza/, "Ramas no toca la fuente: borra LimpiezaPa");
  const aj = readFileSync(new URL("../src/paneles/AjustesLimpieza.tsx", import.meta.url), "utf8");
  // Tirar pide confirmar: «Borrar» sólo aparece con la lista a la vista (plan && hay) y con «No borrar» al lado.
  assert.match(aj, /plan && hay \? \([\s\S]*data-borrar-limpieza[\s\S]*lmp\.noBorrar/);
});
