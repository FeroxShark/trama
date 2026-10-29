// Un turno con textos entre las herramientas: cada texto queda en la conversación, en orden, con sus herramientas plegadas en medio
// (src/hilo/Turno.tsx, Intercalado; src/hilo/turnos.ts, `orden`). Sin DOM: se renderiza a texto con react-dom/server.
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
const { turnos } = await import("../src/hilo/turnos.ts");
const { Turno } = await import("../src/hilo/Turno.tsx");
type Mensaje = import("../src/datos/contrato.ts").Mensaje;

const ts = (s: number) => new Date(s * 1000).toISOString();
const el = (i: number, texto: string, herramientas: string[], s: number): Mensaje => ({ i, rol: "assistant", texto, herramientas, ts: ts(s), modelo: "claude-opus-5-5" });
const yo = (i: number, texto: string, s: number): Mensaje => ({ i, rol: "user", texto, herramientas: [], ts: ts(s), modelo: null });

/** El primer turno de la charla, pintado como lo pinta la vista (`enCurso`: el modelo todavía responde). */
function pintar(ms: Mensaje[], enCurso = false) {
  const t = turnos(ms).find((x) => x.tipo === "turno");
  assert.ok(t && t.tipo === "turno");
  return renderToStaticMarkup(h("div", null, h(Turno, { t, vivo: false, enCurso })));
}

const dos = [
  yo(0, "mirá el índice", 100),
  el(1, "Primero miro el log.", ["Bash: tail log"], 110),
  el(2, "Se cae el test de migración, ahora miro la migración.", ["Read: migracion.sql", "Grep: version"], 120),
  el(3, "Listo: el test esperaba la versión 7.", [], 130),
];

test("dos textos intermedios con herramientas en medio: los dos se ven, en orden", () => {
  cambiarIdioma("es");
  for (const html of [pintar(dos), pintar(dos.slice(0, 3), true)]) {
    const a = html.indexOf("Primero miro el log.");
    const b = html.indexOf("Se cae el test de migración, ahora miro la migración.");
    assert.ok(a >= 0 && b > a, "los dos textos intermedios están y en orden");
    // Cada grupo de herramientas va entre su texto y el que sigue.
    const g1 = html.indexOf("Corrió un comando");
    const g2 = html.indexOf("Leyó un archivo, buscó una vez");
    assert.ok(g1 > a && g1 < b, "el primer grupo va entre los dos textos");
    assert.ok(g2 > b, "el segundo grupo va después del segundo texto");
  }
  const fin = pintar(dos);
  assert.ok(fin.indexOf("Listo: el test esperaba la versión 7.") > fin.indexOf("Leyó un archivo"), "la respuesta va al final");
});

test("el trabajo sigue plegado: sin la lista de llamadas hasta abrirlo", () => {
  const html = pintar(dos);
  assert.equal((html.match(/<details/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<details[^>]* open/);
  assert.doesNotMatch(html, /<ul/);
});

test("un solo texto (la respuesta): sigue siendo el trabajo en una línea y la respuesta", () => {
  const html = pintar([yo(0, "x", 1), el(1, "", ["Read: a"], 2), el(2, "Listo.", [], 3)]);
  assert.equal((html.match(/<details/g) ?? []).length, 1);
  assert.match(html, /Listo\./);
});

test("turnos(): `orden` lleva cada texto con las herramientas que usó después, el que contesta incluido", () => {
  const t = turnos(dos).find((x) => x.tipo === "turno");
  assert.ok(t?.tipo === "turno");
  assert.deepEqual(
    t.orden?.map((p) => ({ texto: p.texto, usos: p.usos.length })),
    [
      { texto: "Primero miro el log.", usos: 1 },
      { texto: "Se cae el test de migración, ahora miro la migración.", usos: 2 },
      { texto: "Listo: el test esperaba la versión 7.", usos: 0 },
    ],
  );
});
