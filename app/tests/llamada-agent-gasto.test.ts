// La burbuja de una llamada Agent en la conversación de un líder (src/hilo/Llamada.tsx): lo que gastó su subagente y el enlace a su desglose.
// Sin DOM: se renderiza a texto con react-dom/server. Subagentes inventados (src/datos/fixtures-contexto.ts).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !path.extname(spec) && ctx.parentURL?.includes("/src/")) {
      const base = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec);
      for (const f of [base + ".ts", base + ".tsx", path.join(base, "index.ts")])
        if (existsSync(f)) return next(path.relative(path.dirname(fileURLToPath(ctx.parentURL)), f).replace(/\\/g, "/").replace(/^(?!\.)/, "./"), ctx);
    }
    return next(spec, ctx);
  },
  // Node no lee .tsx: se lo pasa por esbuild (viene con vite), con el JSX automático de React.
  load(url, ctx, next) {
    if (!url.endsWith(".tsx")) return next(url, ctx);
    const { code } = transformSync(readFileSync(fileURLToPath(url), "utf8"), { loader: "tsx", format: "esm", jsx: "automatic", sourcefile: url });
    return { format: "module", source: code, shortCircuit: true };
  },
});

// Lo mínimo de navegador que tocan los módulos al cargarse (el reloj escucha la visibilidad de la pestaña).
Object.assign(globalThis, { window: globalThis, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), location: { search: "", hash: "" }, document: { documentElement: {}, addEventListener() {}, removeEventListener() {}, getElementsByClassName: () => [], hidden: false, visibilityState: "visible" } });

// El render a texto no trae `getServerSnapshot` (los hooks de idioma y de frases tiernas no lo pasan): se lee el valor de ahora.
createRequire(import.meta.url)("react").useSyncExternalStore = (_suscribir: unknown, leer: () => unknown) => leer();

const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement: h } = await import("react");
const { cambiarIdioma } = await import("../src/i18n/index.ts");
const { Llamada } = await import("../src/hilo/Llamada.tsx");
const { GastoSubagentesCtx, contextoGasto } = await import("../src/hilo/gasto-sub.ts");
const { subagentesFalsos } = await import("../src/datos/fixtures-contexto.ts");

const agent = (id: string | null) => {
  const uso = { nombre: "Agent", resumen: "Auditar los índices de la base de atlas", det: { nombre: "Agent", entrada: { description: "Auditar los índices de la base de atlas", prompt: "Revisá los índices." }, id } };
  return { uso, todos: [uso] };
};
const pinta = (g: ReturnType<typeof agent>, ctx: ReturnType<typeof contextoGasto>) => renderToStaticMarkup(h(GastoSubagentesCtx.Provider, { value: ctx }, h(Llamada, { g })));

test("la llamada Agent muestra lo que gastó su subagente y un enlace a su desglose", () => {
  cambiarIdioma("es");
  const html = pinta(agent("toolu_auditar"), contextoGasto("s1", subagentesFalsos("s1")));
  assert.match(html, /1,3 M tokens · Haiku 5\.5/);
  assert.match(html, /Ver desglose/);
});

test("sin gasto leído, o con otra llamada, la burbuja queda como era", () => {
  cambiarIdioma("es");
  assert.doesNotMatch(pinta(agent("toolu_auditar"), null), /tokens|Ver desglose/);
  assert.doesNotMatch(pinta(agent("toolu_otra"), contextoGasto("s1", subagentesFalsos("s1"))), /tokens|Ver desglose/);
  assert.doesNotMatch(pinta(agent(null), contextoGasto("s1", subagentesFalsos("s1"))), /tokens|Ver desglose/);
});

test("en inglés dice lo mismo con sus palabras", () => {
  cambiarIdioma("en");
  const html = pinta(agent("toolu_mapear"), contextoGasto("s1", subagentesFalsos("s1")));
  assert.match(html, /234 k tokens · Sonnet 5\.5/);
  assert.match(html, /See breakdown/);
  cambiarIdioma("es");
});
