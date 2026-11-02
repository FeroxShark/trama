// El aviso automático de Trama con ocho workers, pintado como lo pinta el chat: una fila por worker, las que piden decisión
// primero, las terminadas plegadas en «N terminados», y el id de cada uno sólo en el tooltip de «Abrir».
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
  // Node no lee .tsx (se lo pasa por esbuild, con el JSX automático) ni .css (los hilos lo importan: no hace falta en el render).
  load(url, ctx, next) {
    if (url.endsWith(".css")) return { format: "module", source: "export default {};", shortCircuit: true };
    if (!url.endsWith(".tsx")) return next(url, ctx);
    const { code } = transformSync(readFileSync(fileURLToPath(url), "utf8"), { loader: "tsx", format: "esm", jsx: "automatic", sourcefile: url });
    return { format: "module", source: code, shortCircuit: true };
  },
});

// Lo mínimo de navegador que tocan los módulos al cargarse (como en turno-intermedios.test.ts).
Object.assign(globalThis, { window: globalThis, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), location: { search: "", hash: "" }, document: { documentElement: {}, addEventListener() {}, removeEventListener() {}, getElementsByClassName: () => [], hidden: false, visibilityState: "visible" } });
createRequire(import.meta.url)("react").useSyncExternalStore = (_suscribir: unknown, leer: () => unknown) => leer();

const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement: h } = await import("react");
const { cambiarIdioma } = await import("../src/i18n/index.ts");
const { lineaAviso } = await import("../src/hilo/sistema-logica.ts");
const { Sistema } = await import("../src/hilo/Sistema.tsx");

const OCHO =
  "[Aviso automático de Trama] Terminaron los 8 workers que lanzaste, 1 con falla:\n" +
  "- «migración del índice» (8): terminó.\n" +
  "- «tests del cauce» (9): falló: el proceso se cortó sin dejar mensaje.\n" +
  "- «revisar el contrato» (10): terminó pidiendo una decisión.\n" +
  "- «docs del cauce» (11): terminó sin resumen.\n" +
  "- «integrar atlas» (12): terminó.\n" +
  "- «decidir la cuota» (13): terminó pidiendo una decisión.\n" +
  "- «humo del cauce» (14): terminó.\n" +
  "- «limpiar ramas viejas» (15): terminó.\n" +
  "Revisá cada uno con `pa --hilo <id>`.";

function pintar(texto: string) {
  return renderToStaticMarkup(h(Sistema, { s: lineaAviso(texto), alAbrirHilo: () => {} }));
}

test("ocho workers: tres filas visibles (decisiones primero, después la falla) y las cinco terminadas plegadas", () => {
  cambiarIdioma("es");
  const html = pintar(OCHO);
  const [visible, plegado] = html.split("<details");
  assert.ok(plegado, "las terminadas van en un desplegable");
  assert.equal((visible.match(/class="sis-aviso-fila"/g) ?? []).length, 3, "en la lista de arriba, sólo lo que pide atención");
  assert.equal((plegado.match(/class="sis-aviso-fila"/g) ?? []).length, 5, "las cinco terminadas, dentro del desplegable");
  assert.match(html, />5 terminados</, "el resumen del desplegable dice cuántas");
  const filas = visible.split('class="sis-aviso-fila"').slice(1);
  assert.match(filas[0], /pide decisión/);
  assert.match(filas[0], /revisar el contrato/);
  assert.match(filas[1], /decidir la cuota/);
  assert.match(filas[2], /falló/);
  assert.match(filas[2], />Relanzar</, "la falla conserva su relanzar, en la misma fila");
});

test("cada fila: el id sólo en el tooltip de «Abrir»; el texto visible no muestra el id", () => {
  cambiarIdioma("es");
  const html = pintar(OCHO);
  assert.match(html, /data-tip="Ver hilo #10"/);
  assert.match(html, /aria-label="Abrir el hilo del worker 10"/, "el nombre accesible sigue llevando el id");
  assert.match(html, />Abrir</);
  assert.doesNotMatch(html, />#\d+</, "ningún botón ni texto muestra el id a la vista");
});

test("pocos workers (cinco o menos): todos en la lista, sin desplegable", () => {
  cambiarIdioma("es");
  const html = pintar("[Aviso automático de Trama] Terminaron los 3 workers que lanzaste, 0 con falla:\n- «a» (1): terminó.\n- «b» (2): terminó pidiendo una decisión.\n- «c» (3): terminó.\nRevisá cada uno con `pa --hilo <id>`.");
  assert.equal((html.match(/class="sis-aviso-fila"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /<details/);
});
