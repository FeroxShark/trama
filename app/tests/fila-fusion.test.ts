// Ajustes > Proyectos, aviso de arriba: cada proyecto que hay que fusionar lleva su botón "Fusionar con IA" (src/paneles/FilaFusion.ts).
// Sin DOM: se renderiza a texto con react-dom/server. Los imports de src/ van sin extensión: un hook les busca el `.ts`.
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

const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement: h } = await import("react");
const { cambiarIdioma, t } = await import("../src/i18n/index.ts");
const { FilaFusion } = await import("../src/paneles/FilaFusion.ts");

const fila = (p: Partial<Parameters<typeof FilaFusion>[0]> = {}) =>
  renderToStaticMarkup(h("ul", null, h(FilaFusion, { nombre: "Local AI", slug: "local-ai", tarea: null, lanzando: false, error: null, alFusionar: () => {}, alIrRamas: () => {}, ...p })));

test("sin agente: el nombre con su ícono y el botón Fusionar con IA, sin 'fusionar a mano'", () => {
  cambiarIdioma("en");
  const html = fila();
  assert.match(html, /<b>Local AI<\/b>/);
  assert.match(html, /data-fusionar-fila[^>]*>.*Merge with AI/);
  assert.doesNotMatch(html, /disabled/);
  assert.doesNotMatch(html, /manual merge|data-agente-fusionando/);
  assert.doesNotMatch(t("pry.todos.fusionQue"), /manual|automatically/);
});

test("lanzando: el botón queda deshabilitado y lo dice con palabras", () => {
  cambiarIdioma("en");
  const html = fila({ lanzando: true });
  assert.match(html, /data-fusionar-fila[^>]*disabled[^>]*>.*Launching agent/);
});

test("con una tarea en curso no ofrece relanzar: dice que un agente lo fusiona y lleva a Ramas", () => {
  cambiarIdioma("en");
  const html = fila({ tarea: "fusionar" });
  assert.doesNotMatch(html, /data-fusionar-fila/);
  assert.match(html, /data-agente-fusionando[^>]*>An agent is merging it: review it in Branches/);
  assert.match(html, /data-ir-ramas[^>]*>.*Branches/);
});

test("otra tarea (acortar) en curso: el botón se ve pero deshabilitado", () => {
  cambiarIdioma("en");
  assert.match(fila({ tarea: "acortar" }), /data-fusionar-fila[^>]*disabled/);
});

test("el error al lanzar se muestra como alerta, y en español sale 'Fusionar con IA'", () => {
  cambiarIdioma("es");
  const html = fila({ error: "no se pudo" });
  assert.match(html, /role="alert">no se pudo/);
  assert.match(html, /Fusionar con IA/);
  cambiarIdioma("en");
});
