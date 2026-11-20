// La tarjeta de un líder trabajando (src/hilo/Actividad.tsx, dirección C · Anillo), estado por estado sobre su render, con datos inventados: el anillo con su
// arco, un verbo y el detalle, varias herramientas a la vez, «Sin novedades», modelo y esfuerzo, el error abierto y un solo Parar (el de la caja).
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

test("corriendo: un verbo, «en Bash», el comando en mono, Ver todo y el modelo con su familia", () => {
  cambiarIdioma("es");
  const html = tarjeta({ hace: bash("tablero lista --abiertas", "Revisando workers y tablero") });
  assert.equal(de(html, "tv-v"), "Corriendo un comando");
  assert.equal(de(html, "tv-sub"), "en Bash");
  assert.match(html, /class="tv-out" data-mono="">tablero lista --abiertas</);
  assert.match(html, /data-estado="corre"/);
  assert.ok(sinMarcas(html).includes("Ver todo"));
  assert.match(html, /class="tv-ver" aria-expanded="false"/);
  assert.match(sinMarcas(html), /Opus 5\.5\s+high/);
  assert.match(html, /class="tv-fam" data-familia="opus"/);
});

test("el verbo no se repite y no queda un «Ran» suelto mientras sigue corriendo", () => {
  for (const idioma of ["es", "en"] as const) {
    cambiarIdioma(idioma);
    const texto = sinMarcas(tarjeta({ hace: bash("grep -rn x src/", "Buscando"), pasos: [leyo("a.ts", 3)], pasosN: 1 }));
    assert.doesNotMatch(texto, /\bRan\b|Corrió/);
    assert.doesNotMatch(texto, /Running Bash|Corriendo Bash/);
  }
  cambiarIdioma("es");
});

test("el anillo: el arco gira con vida, con el color de la clase del ícono; quieto no gira", () => {
  cambiarIdioma("es");
  const vivo = tarjeta({ hace: bash("npm test", "Probando") });
  assert.match(vivo, /class="tv-an" data-clase="comando"[^>]*><i class="tv-arco gira-arco"/);
  const lee = tarjeta({ hace: { que: "herramienta", nombre: "Read", detalle: "/a/b.ts" } });
  assert.match(lee, /data-clase="leer"/);
  const quieto = tarjeta({ hace: bash("sleep 900", "Esperando"), quieto: Date.now() - 125_000 });
  assert.match(quieto, /<i class="tv-arco"/);
  assert.doesNotMatch(quieto, /gira-arco/);
});

test("pensando: un verbo y lo que piensa; nunca la salida cruda de un comando", () => {
  cambiarIdioma("es");
  const pensando = { que: "pensando" as const, nombre: null, detalle: null };
  const html = tarjeta({ hace: pensando, salida: { linea: "cauce-f2  corriendo  4 m", error: false }, razon: { lineas: [], pensando: "Miro el parser. Lo leo al cerrar el turno." } });
  assert.equal(de(html, "tv-v"), "Pensando");
  assert.ok(html.includes("Lo leo al cerrar el turno."));
  assert.ok(!html.includes("cauce-f2"));
  const mudo = tarjeta({ hace: pensando, salida: { linea: "cauce-f2  corriendo  4 m", error: false } });
  assert.ok(!mudo.includes("cauce-f2"));
  assert.doesNotMatch(mudo, /class="tv-out"/);
});

test("varias herramientas a la vez: el círculo muestra el número, un resumen y una ficha con palabra por herramienta", () => {
  cambiarIdioma("es");
  const paralelas = [
    { nombre: "Task", icono: "delegar" as const, estado: "espera" as const, detalle: "explorar" },
    { nombre: "Bash", icono: "correr" as const, estado: "corriendo" as const, detalle: "npm test" },
    { nombre: "Grep", icono: "buscar" as const, estado: "listo" as const, detalle: "«x»" },
  ];
  const html = tarjeta({ hace: bash("npm test"), paralelas });
  assert.equal(de(html, "tv-v"), "Esperando 3 cosas en paralelo");
  assert.equal(de(html, "tv-sub"), "1 lista · 1 corriendo · 1 en espera");
  assert.match(html, /<span class="tv-n">3<\/span>/);
  assert.match(html, /data-clase="paralelo"/);
  const texto = sinMarcas(html);
  assert.ok(texto.includes("Subagente · en espera"));
  assert.ok(texto.includes("Bash · corriendo"));
  assert.ok(texto.includes("Grep · listo"));
  assert.match(html, /class="tv-chips" aria-label="Herramientas en paralelo"/);
});

test("un solo estado: sin «En curso» ni «Trabajando» escritos, y sin Parar en la tarjeta", () => {
  for (const idioma of ["es", "en"] as const) {
    cambiarIdioma(idioma);
    const texto = sinMarcas(tarjeta({ hace: bash("npm test", "Probando") }));
    assert.doesNotMatch(texto, /En curso|Trabajando|In progress|Working|Parar|Stop\b/);
  }
  cambiarIdioma("es");
});

test("sin descripción: el mismo verbo, y la descripción va en «Ver todo»", () => {
  cambiarIdioma("es");
  const html = tarjeta({ hace: bash("npm test") });
  assert.equal(de(html, "tv-v"), "Corriendo un comando");
  const con = tarjeta({ hace: bash("npm test", "Probando la barra"), abierto: true });
  assert.ok(con.includes("Probando la barra"));
});

test("con lo que devolvió el comando: Corrió un comando, el comando abajo y la salida sólo en «Ver todo»", () => {
  cambiarIdioma("es");
  const html = tarjeta({ hace: bash("npm test", "Probando"), salida: { linea: "12 passing", error: false } });
  assert.equal(de(html, "tv-v"), "Corrió un comando");
  const fila = /class="tv-2"[^>]*>(.*?)<\/div>/.exec(html)?.[1] ?? "";
  assert.ok(!fila.includes("12 passing"));
  assert.ok(html.includes("Salida: 12 passing"));
});

test("tokens y pasos van en el tooltip del pie, no a la vista", () => {
  cambiarIdioma("es");
  const html = tarjeta({ hace: bash("npm test", "Probando"), pasosN: 4, pasos: [leyo("a.ts", 3)] });
  assert.match(html, /tv-modelo"[^>]*data-tip="1\.280 tokens · 4 pasos"/);
  const fila = /class="tv-der">(.*?)class="tv-ver"/.exec(html)?.[1] ?? "";
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
  assert.ok(sinMarcas(abierta).includes("Ver menos"));
});

test("varias herramientas: «+N pasos» cuando los de atrás no entran", () => {
  cambiarIdioma("es");
  const pasos = ["f.ts", "e.ts", "d.ts", "c.ts", "b.ts", "a.ts"].map((f, i) => leyo(f, i));
  const html = tarjeta({ hace: bash("npm test", "Probando"), pasos, pasosN: 6, abierto: true });
  assert.match(html, /class="tv-mas"/);
});

test("sin novedades: ámbar con la palabra, el arco quieto", () => {
  cambiarIdioma("es");
  const html = tarjeta({ hace: bash("sleep 900", "Esperando"), quieto: Date.now() - 125_000 });
  assert.match(html, /data-estado="quieto"/);
  assert.doesNotMatch(html, /gira-arco/);
  // El texto lo pinta el reloj (el render estático no lo trae): lo mismo que le pasa la tarjeta.
  const texto = () => pintorDura(AHORA - 125, () => `${t("hz.quieto")} `)(AHORA).texto;
  assert.equal(texto(), "Sin novedades hace 2 m");
  cambiarIdioma("en");
  assert.equal(texto(), "No updates for 2 m");
  cambiarIdioma("es");
});

test("un comando largo y callado no es un cuelgue: sigue como trabajando, con el arco girando y hace cuánto no sale nada", () => {
  cambiarIdioma("es");
  const html = tarjeta({ hace: bash("make build", "Compilando"), callado: Date.now() - 360_000 });
  assert.match(html, /data-estado="corre"/);
  assert.match(html, /gira-arco/);
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
  assert.doesNotMatch(html, /gira-arco/);
});

test("falló: queda abierta con el error en palabras y su ícono, sin arco que gire", () => {
  cambiarIdioma("es");
  const hace = bash("tablero lista", "Revisando el tablero");
  const error = h("div", { className: "avisos" }, "database is locked");
  const html = tarjeta({ hace, desde: null, salida: { linea: "salió con código 1", error: true }, fallo: { dura: 95, error } });
  assert.equal(de(html, "tv-v"), "No pudo terminar: corriendo un comando");
  assert.match(html, /data-error=""/);
  assert.match(html, /data-estado="fallo"/);
  assert.match(sinMarcas(html), /Falló\s*· 2 m/);
  assert.ok(html.includes("database is locked"));
  assert.ok(html.includes("salió con código 1"));
  assert.doesNotMatch(html, /gira-arco/);
});

test("el pliegue: al irse deja de girar y lo marca para animar", () => {
  cambiarIdioma("es");
  const html = tarjeta({ hace: bash("npm test", "Probando"), saliendo: true });
  assert.match(html, /data-saliendo=""/);
  assert.doesNotMatch(html, /gira-arco/);
});
