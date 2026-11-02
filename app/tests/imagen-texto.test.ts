// Las rutas de imagen en el texto de un líder (src/hilo/Texto.tsx): un patrón con comodines (`ciclo_*.png`) queda como
// código normal, sin botón de vista ni aviso; una ruta real de Windows con espacios sigue ofreciendo su vista; y una
// imagen que no está sale como un aviso chico dentro del párrafo, sin cortar el texto. Sin DOM: se renderiza a texto
// con react-dom/server. Rutas inventadas.
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
  // Node no lee .tsx: se lo pasa por esbuild (viene con vite), con el JSX automático de React.
  load(url, ctx, next) {
    if (!url.endsWith(".tsx")) return next(url, ctx);
    const { code } = transformSync(readFileSync(fileURLToPath(url), "utf8"), { loader: "tsx", format: "esm", jsx: "automatic", sourcefile: url });
    return { format: "module", source: code, shortCircuit: true };
  },
});

// Lo mínimo de navegador que tocan los módulos al cargarse (el reloj escucha la visibilidad de la pestaña).
Object.assign(globalThis, { window: globalThis, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), location: { search: "", hash: "" }, document: { documentElement: {}, addEventListener() {}, removeEventListener() {}, getElementsByClassName: () => [], hidden: false, visibilityState: "visible" } });

// El render a texto no trae `getServerSnapshot` (los hooks de idioma no lo pasan): se lee el valor de ahora.
createRequire(import.meta.url)("react").useSyncExternalStore = (_suscribir: unknown, leer: () => unknown) => leer();

const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement: h } = await import("react");
const { cambiarIdioma } = await import("../src/i18n/index.ts");
const { Texto } = await import("../src/hilo/Texto.tsx");
const { Figura } = await import("../src/hilo/Imagenes.tsx");

const PATRON = "D:\\Vr Proyects\\Tienda Rexouium\\Pruebas\\Outfit Offline\\ciclo11f1b_*.png";
const REAL = "D:\\Vr Proyects\\Tienda Rexouium\\Pruebas\\Outfit Offline\\ciclo11f1b 1.png";
const FALTA = "D:\\Vr Proyects\\Tienda Rexouium\\Pruebas\\Outfit Offline\\captura 9.png";
const pinta = (texto: string) => {
  cambiarIdioma("es");
  return renderToStaticMarkup(h(Texto, { texto }));
};

test("un patrón con comodines entre comillas invertidas queda como código: sin botón de vista ni aviso", () => {
  const html = pinta(`Revisá \`${PATRON}\` ahora.`);
  assert.ok(html.includes(`<code>${PATRON}</code>`), html);
  assert.doesNotMatch(html, /img-ver|img-local|no disponible/);
});

test("un `![](patrón)` con comodines es texto, sin aviso de imagen no disponible", () => {
  const html = pinta(`Mirá ![captura](${PATRON}) ahora.`);
  assert.ok(html.includes(`![captura](${PATRON})`), html);
  assert.doesNotMatch(html, /img-local|no disponible/);
});

test("una ruta real de Windows con espacios y barras sigue ofreciendo su vista", () => {
  const html = pinta(`Mirá \`${REAL}\` ahora.`);
  assert.ok(html.includes(`<code>${REAL}</code><button type="button" class="img-ver"`), html);
  assert.doesNotMatch(html, /no disponible/);
});

test("un `![](ruta real)` de Windows con espacios se pide: mientras llega, se ve como cargando", () => {
  const html = pinta(`![captura](${REAL})`);
  assert.match(html, /<span class="img-local" data-estado="cargando"/);
});

test("una imagen que no está: un aviso chico dentro del párrafo, con el texto alrededor", () => {
  const html = renderToStaticMarkup(h("p", null, "Antes ", h(Figura, { img: null, nombre: "captura 9.png", ruta: FALTA }), " después."));
  assert.match(html, /^<p>Antes <span class="img-local" data-estado="falta"[^>]*><svg[\s\S]*<span>Imagen no disponible: captura 9\.png<\/span><\/span> después\.<\/p>$/, html);
});
