// El ErrorBoundary de la raíz (src/ErrorBoundary.ts): ante un error de render pinta el cartel (qué pasó en una
// línea, Recargar y Copiar detalle) en vez de dejar la ventana en blanco. Sin DOM: se renderiza a texto con
// react-dom/server. Los imports de src/ van sin extensión: un hook les busca el `.ts`.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { test } from "node:test";
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
});

const enviados: { donde: string; detalle: string }[] = [];
Object.assign(globalThis, {
  location: { search: "?fixtures=0&idioma=es" },
  window: { hilos: { bitacora: async (x: { donde: string; detalle: string }) => void enviados.push(x) } },
});

const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement: h } = await import("react");
const { Cartel, ErrorBoundary } = await import("../src/ErrorBoundary.ts");
const { detalleDe, lineaDe, reportar } = await import("../src/errores.ts");

test("sin error, el ErrorBoundary deja pasar lo suyo", () => {
  const html = renderToStaticMarkup(h(ErrorBoundary, null, h("p", null, "todo bien")));
  assert.equal(html, "<p>todo bien</p>");
});

test("con un error de render pinta el cartel: una línea, Recargar y Copiar detalle", () => {
  const b = new ErrorBoundary({});
  b.state = ErrorBoundary.getDerivedStateFromError(new TypeError("no se puede leer 'x' de undefined\nsegunda línea"));
  const html = renderToStaticMarkup(b.render() as never);
  assert.match(html, /role="alert"/);
  assert.match(html, /Algo salió mal/);
  assert.match(html, /no se puede leer &#x27;x&#x27; de undefined/);
  assert.ok(!html.includes("segunda línea"), "una sola línea; el resto va en Copiar detalle");
  assert.match(html, />Recargar</);
  assert.match(html, />Copiar detalle</);
});

test("el cartel que deja el main (el renderer murió varias veces) lleva su texto y el detalle va a Copiar", () => {
  const html = renderToStaticMarkup(h(Cartel, { linea: "La ventana se cayó varias veces seguidas y dejó de recargarse sola.", detalle: "crashed, exit 133" }));
  assert.match(html, /La ventana se cayó varias veces seguidas/);
  assert.match(html, /Recargar/);
});

test("el detalle trae el stack; la línea, sólo el mensaje acotado", () => {
  const e = new Error("falló " + "x".repeat(400));
  assert.match(detalleDe(e), /^Error: falló/);
  assert.match(detalleDe(e), /\n\s+at /);
  assert.ok(lineaDe(e).length <= 201);
  assert.equal(lineaDe("cadena suelta"), "cadena suelta");
  assert.equal(detalleDe({ a: 1 }), '{"a":1}');
});

test("lo que se reporta al log del main: sin repetirse en bucle", () => {
  enviados.length = 0;
  reportar("onerror", "Error: boom", 1_000_000);
  reportar("onerror", "Error: boom", 1_001_000);
  reportar("onerror", "Error: otro", 1_001_500);
  reportar("onerror", "Error: boom", 1_007_000);
  assert.deepEqual(
    enviados.map((x) => x.detalle),
    ["Error: boom", "Error: otro", "Error: boom"],
  );
});
