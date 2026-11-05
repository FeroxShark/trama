// La tarjeta de un líder trabajando (src/hilo/Actividad.tsx), estado por estado sobre su render, con datos inventados: el título con la acción, un solo
// estado (punto y tiempo), el comando plegado, «Sin novedades», el pie con modelo y esfuerzo, el error abierto y un solo Parar (el de la caja).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import type { HaceLider } from "../src/datos/contrato.ts";

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
  requestAnimationFrame: () => 1,
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
const { cambiarIdioma, t } = await import("../src/i18n/index.ts");
const { pintorDura } = await import("../src/tiempo.ts");
const { Actividad } = await import("../src/hilo/Actividad.tsx");
const { clasificar, clasificarPedido } = await import("../src/hilo/actividad-logica.ts");

const AHORA = Math.floor(Date.now() / 1000);
const bash = (detalle: string, desc?: string): HaceLider => ({ que: "herramienta", nombre: "Bash", detalle, ...(desc ? { desc } : {}) });
const leyo = (f: string, seg: number) => ({ hace: { que: "herramienta" as const, nombre: "Read", detalle: f }, seg });

type Props = Parameters<typeof Actividad>[0];
function tarjeta(extra: Partial<Props> & { hace: HaceLider | null }) {
  const props: Props = {
    act: extra.hace ? clasificar(extra.hace) : clasificar({ que: "pidiendo", nombre: null, detalle: null }),
    pasos: [],
    pasosN: 0,
    desde: AHORA - 6,
    tokens: "1.280 tokens",
    modelo: "Opus 5.5",
    effort: "high",
    salida: null,
    crudo: null,
    abierto: false,
    alAbrir: noop,
    ...extra,
  };
  return renderToStaticMarkup(h(Actividad, props));
}
/** El texto de la primera clase pedida, sin marcas. */
const de = (html: string, clase: string) => {
  const m = new RegExp(`class="${clase}"[^>]*>(.*?)</span>`).exec(html);
  return m ? m[1].replace(/<[^>]+>/g, "") : null;
};
const sinMarcas = (html: string) => html.replace(/<[^>]+>/g, " ");

test("corriendo: título con la descripción, Corriendo con el comando, Ver todo y el modelo", () => {
  cambiarIdioma("es");
  const html = tarjeta({ hace: bash("tablero lista --abiertas", "Revisando workers y tablero") });
  assert.equal(de(html, "tv-v"), "Revisando workers y tablero");
  assert.equal(de(html, "tv-verbo"), "Corriendo");
  assert.match(html, /data-estado="corre"/);
  assert.match(html, /tv-punto late/);
  assert.ok(sinMarcas(html).includes("Ver todo"));
  assert.match(html, /aria-expanded="false"/);
  assert.match(sinMarcas(html), /Opus 5\.5\s+high/);
});

test("un solo estado: sin «En curso» ni «Trabajando» escritos, y sin Parar en la tarjeta", () => {
  for (const idioma of ["es", "en"] as const) {
    cambiarIdioma(idioma);
    const texto = sinMarcas(tarjeta({ hace: bash("npm test", "Probando") }));
    assert.doesNotMatch(texto, /En curso|Trabajando|In progress|Working|Parar|Stop\b/);
  }
  cambiarIdioma("es");
});

test("sin descripción: «Corriendo Bash» y el comando sin repetir el verbo", () => {
  cambiarIdioma("es");
  const html = tarjeta({ hace: bash("npm test") });
  assert.equal(de(html, "tv-v"), "Corriendo Bash");
  assert.equal(de(html, "tv-verbo"), null);
});

test("con salida: Corrió y su última línea", () => {
  cambiarIdioma("es");
  const html = tarjeta({ hace: bash("npm test", "Probando"), salida: { linea: "12 passing", error: false } });
  assert.equal(de(html, "tv-verbo"), "Corrió");
  assert.ok(html.includes("12 passing"));
});

test("tokens y pasos van en el tooltip del pie, no a la vista", () => {
  cambiarIdioma("es");
  const html = tarjeta({ hace: bash("npm test", "Probando"), pasosN: 4, pasos: [leyo("a.ts", 3)] });
  assert.match(html, /tv-modelo"[^>]*data-tip="1\.280 tokens · 4 pasos"/);
  const fila = /class="tv-2">(.*?)class="tv-plieg"/.exec(html)?.[1] ?? "";
  assert.doesNotMatch(fila.replace(/data-tip="[^"]*"|aria-label="[^"]*"/g, ""), /1\.280 tokens/);
});

test("plegada no se llega con el teclado; abierta muestra el comando entero, los pasos y dice Ver menos", () => {
  cambiarIdioma("es");
  const hace = bash("npm test --reporter dot", "Probando");
  const crudo = "npm test \\\n  --reporter dot";
  const plegada = tarjeta({ hace, crudo, pasos: [leyo("a.ts", 3)], pasosN: 1 });
  assert.match(plegada, /class="tv-cuerpo" inert=""/);
  const abierta = tarjeta({ hace, crudo, pasos: [leyo("a.ts", 3)], pasosN: 1, abierto: true });
  assert.doesNotMatch(abierta, /class="tv-cuerpo" inert/);
  assert.match(abierta, /data-abierto=""/);
  assert.match(abierta, /aria-expanded="true"/);
  assert.ok(abierta.includes("--reporter dot"));
  assert.ok(abierta.includes("a.ts"));
});

test("varias herramientas: lo de antes como miga y «+N pasos» cuando no entran", () => {
  cambiarIdioma("es");
  const pasos = ["f.ts", "e.ts", "d.ts", "c.ts", "b.ts", "a.ts"].map((f, i) => leyo(f, i));
  const html = tarjeta({ hace: bash("npm test", "Probando"), pasos, pasosN: 6, abierto: true });
  assert.match(html, /class="tv-ant"/);
  assert.match(html, /class="tv-mas"/);
});

test("sin novedades: ámbar con la palabra, sin punto que late", () => {
  cambiarIdioma("es");
  const html = tarjeta({ hace: bash("sleep 900", "Esperando"), quieto: Date.now() - 125_000 });
  assert.match(html, /data-estado="quieto"/);
  assert.doesNotMatch(html, /tv-punto late/);
  // El texto lo pinta el reloj (el render estático no lo trae): lo mismo que le pasa la tarjeta.
  const texto = () => pintorDura(AHORA - 125, () => `${t("hz.quieto")} `)(AHORA).texto;
  assert.equal(texto(), "Sin novedades hace 2 m");
  cambiarIdioma("en");
  assert.equal(texto(), "No updates for 2 m");
  cambiarIdioma("es");
});

test("un comando largo y callado no es un cuelgue: sigue como trabajando, con el punto que late y hace cuánto no sale nada", () => {
  cambiarIdioma("es");
  const html = tarjeta({ hace: bash("make build", "Compilando"), callado: Date.now() - 360_000 });
  assert.match(html, /data-estado="corre"/);
  assert.match(html, /tv-punto late/);
  assert.doesNotMatch(html, /data-estado="quieto"/);
  assert.equal(pintorDura(AHORA - 360, () => `${t("hz.callado")} `)(AHORA).texto, "sin salida hace 6 m");
  cambiarIdioma("en");
  assert.equal(pintorDura(AHORA - 360, () => `${t("hz.callado")} `)(AHORA).texto, "no output for 6 m");
  cambiarIdioma("es");
});

test("un permiso: Te necesita, con qué", () => {
  cambiarIdioma("es");
  const pide = { id: "p1", nombre: "Bash", detalle: "git push origin main", tipo: "permiso" };
  const html = tarjeta({ act: clasificarPedido(pide as never), hace: bash("git push origin main") });
  assert.equal(de(html, "tv-v"), "Te necesita");
  assert.match(html, /data-t="permiso"/);
});

test("falló: queda abierta con el error en palabras y su ícono, sin reloj corriendo", () => {
  cambiarIdioma("es");
  const hace = bash("tablero lista", "Revisando el tablero");
  const error = h("div", { className: "avisos" }, "database is locked");
  const html = tarjeta({ hace, desde: null, salida: { linea: "salió con código 1", error: true }, fallo: { dura: 95, error } });
  assert.equal(de(html, "tv-v"), "No pudo terminar: Revisando el tablero");
  assert.match(html, /data-error=""/);
  assert.match(html, /data-estado="fallo"/);
  assert.match(sinMarcas(html), /Falló\s*· 2 m/);
  assert.ok(html.includes("database is locked"));
  assert.ok(html.includes("salió con código 1"));
  assert.doesNotMatch(html, /tv-punto late/);
});

test("el pliegue: al irse deja de latir y lo marca para animar", () => {
  cambiarIdioma("es");
  const html = tarjeta({ hace: bash("npm test", "Probando"), saliendo: true });
  assert.match(html, /data-saliendo=""/);
  assert.doesNotMatch(html, /tv-punto late/);
});
