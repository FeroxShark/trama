// Los errores de `pa` en una frase simple y el aviso de "Copiado". Los imports de src/ van sin
// extensión (los resuelve Vite): acá un hook les busca el `.ts`. `document` y `window` van antes
// del import (copiar.ts los toca sólo al llamarlo, pero modo.ts lee `location` al cargar).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !path.extname(spec) && ctx.parentURL?.includes("/src/")) {
      const base = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec);
      for (const f of [base + ".ts", base + ".tsx", path.join(base, "index.ts")])
        if (existsSync(f)) return next(path.relative(path.dirname(fileURLToPath(ctx.parentURL)), f).replace(/^(?!\.)/, "./"), ctx);
    }
    return next(spec, ctx);
  },
});

Object.assign(globalThis, { location: { search: "" } });
const { es } = await import("../src/i18n/es.ts");
const { cambiarIdioma, fraseConocida, fraseError, textoError } = await import("../src/i18n/index.ts");
const { errorCorto } = await import("../src/barra/arbol.ts");
const { avisarCopia, copiarConAviso } = await import("../src/copiar.ts");

cambiarIdioma("es");

test("cada código de salida de pa conocido dice su frase, sin mirar el texto", () => {
  const casos: [number, keyof typeof es][] = [
    [75, "error.ocupado"],
    [76, "error.limite"],
    [78, "error.sinResultado"],
    [79, "error.sucio"],
    [80, "error.conflicto"],
    [92, "error.vivo"],
  ];
  for (const [rc, clave] of casos) assert.equal(fraseError("algo raro que no se reconoce", rc), es[clave], String(rc));
});

test("sin código, la frase sale de lo que dijo pa", () => {
  assert.equal(fraseConocida("pa: tope global de workers alcanzado"), es["error.ocupado"]);
  assert.equal(fraseConocida("Reached your usage limit"), es["error.limite"]);
  assert.equal(fraseConocida("Commitealos, movelos o tiralos"), es["error.sucio"]);
  assert.equal(fraseConocida("el worker sigue viva (corriendo o en cola)"), es["error.vivo"]);
});

test("sin conexión, por red: ECONNREFUSED, fetch failed…", () => {
  for (const s of ["connect ECONNREFUSED 127.0.0.1:1", "fetch failed", "getaddrinfo ENOTFOUND api.x", "Sin conexión"])
    assert.equal(fraseError(s), es["error.sinConexion"], s);
});

test("lo desconocido queda crudo, y un código que no es de los conocidos no inventa nada", () => {
  assert.equal(fraseError("boom: algo nunca visto", 1), "boom: algo nunca visto");
  assert.equal(fraseConocida("boom", 1), null);
  assert.equal(fraseConocida(null), null);
  assert.equal(textoError("boom"), "boom");
});

test("errorCorto: el corto de la fila gana; el resto, frase o crudo", () => {
  assert.equal(errorCorto("zzz nunca visto"), "zzz nunca visto");
  assert.equal(errorCorto("fetch failed"), es["error.sinConexion"]);
});

// --- El aviso de Copiado, con un document de mentira ---

type Div = { className: string; textContent: string; dataset: Record<string, string>; attrs: Set<string>; isConnected: boolean; offsetWidth: number } & Record<string, unknown>;
function documentoFalso() {
  const creados: Div[] = [];
  const doc = {
    body: { appendChild: (el: Div) => ((el.isConnected = true), creados.push(el)) },
    createElement: () => {
      const attrs = new Set<string>();
      const el: Div = {
        className: "",
        textContent: "",
        dataset: {},
        attrs,
        isConnected: false,
        offsetWidth: 0,
        setAttribute: (k: string) => attrs.add(k),
        removeAttribute: (k: string) => attrs.delete(k),
      };
      return el;
    },
  };
  return { doc, creados };
}

test("copiarConAviso dice Copiado cuando copia y avisa cuando no pudo; un solo elemento", async () => {
  const { doc, creados } = documentoFalso();
  let copiado = "";
  Object.assign(globalThis, {
    document: doc,
    window: { isSecureContext: true, setTimeout: (f: () => void) => (void f, 0) },
  });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (s: string) => void (copiado = s) } } });
  assert.equal(await copiarConAviso("abc"), true);
  assert.equal(copiado, "abc");
  assert.equal(creados.length, 1);
  assert.equal(creados[0].textContent, es["codigo.copiado"]);
  assert.equal(creados[0].dataset.ok, "");

  // Sin portapapeles y sin execCommand: no se pudo, y lo dice en vez de callar.
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
  (doc as Record<string, unknown>).execCommand = () => false;
  doc.body.appendChild = () => 0; // el campo escondido del camino viejo no cuenta como cartel
  (doc as Record<string, unknown>).createElement = () => ({ style: {}, setAttribute() {}, focus() {}, setSelectionRange() {}, remove() {} });
  assert.equal(await copiarConAviso("abc"), false);
  assert.equal(creados.length, 1, "reusa el mismo cartel");
  assert.equal(creados[0].textContent, es["codigo.noCopio"]);
  assert.equal(creados[0].dataset.ok, "no");
  avisarCopia(true);
  assert.equal(creados[0].dataset.ok, "");
});
