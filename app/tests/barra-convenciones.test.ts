// Las señales de la barra que no se pueden volver a perder (src/barra/CONVENCIONES.md): el rayito con su tiempo en un hilo caliente, las
// coronas del líder, ningún ✓ en un líder y el punto que late en lo que corre. Se prueban sobre el render de las filas, con datos inventados.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import type { Estado, Hilo, Lider } from "../src/datos/contrato.ts";

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
const { cambiarIdioma } = await import("../src/i18n/index.ts");
const { es } = await import("../src/i18n/es.ts");
const { en } = await import("../src/i18n/en.ts");
const { Fila, FilaLider, PliegueTerminados } = await import("../src/barra/Fila.tsx");
const { pintorCache, pintorDura, pintorHace } = await import("../src/tiempo.ts");
cambiarIdioma("es");

const AHORA = Math.floor(Date.now() / 1000);
const CALIENTE = { cache_ttl_s: 3600, cache_vence: AHORA + 21 * 60 + 10 };

const lider = (extra: Partial<Lider> = {}): Lider => ({
  id: "s-inventado",
  nombre: "lider-inventado",
  proyecto: "atlas",
  titulo: "Opus 5.5",
  actividad: AHORA - 300,
  creado: AHORA - 3600,
  cache_ttl_s: null,
  cache_vence: null,
  origen: "terminal",
  pid: 4242,
  vivo: true,
  ocupado: false,
  modelo: "claude-opus-5-5",
  effort: "high",
  ...extra,
});

const hilo = (estado: Estado, extra: Partial<Hilo> = {}): Hilo => ({
  id: "20261003-100000-10000",
  tarea: "Tarea inventada",
  proyecto: "atlas",
  estado,
  modelo: "claude-opus-5-5",
  effort: "medium",
  origen: "jefe",
  jefe: null,
  jefe_id: null,
  sigue_de: null,
  en_cola: false,
  inicio: AHORA - 600,
  duracion_s: estado === "trabajando" ? null : 300,
  puesto: "1",
  rama: null,
  commits: 0,
  decision: null,
  decision_nada: null,
  resultado: null,
  archivado: false,
  leer: false,
  cache_ttl_s: null,
  cache_vence: null,
  cache_frio: null,
  cache_modelo: null,
  ...extra,
});

const pintaLider = (l: Lider, vivos = 0, atencion: "fallo" | "decision" | null = null) =>
  renderToStaticMarkup(h(FilaLider, { l, activa: false, settle: null, atencion, vivos, alAbrir: noop, alCerrar: noop, alSettle: noop }));
const pintaFila = (x: Hilo, resto: Partial<Parameters<typeof Fila>[0]> = {}) =>
  renderToStaticMarkup(h(Fila, { h: x, estado: x.estado, cursor: false, activa: false, nuevo: false, error: null, settle: null, alAbrir: noop, alCerrar: noop, quieta: true, ...resto }));

const leer = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** Las marcas de una palomita en el HTML: el glifo, su trazo y el carácter. */
const conPalomita = (html: string) => /data-g="termino"|M5 12\.5l4\.5 4\.5L19 7\.5|✓|lucide-check/.test(html);

test("el rayito: un líder caliente lleva su tiempo a la vista, también sin el mouse encima", () => {
  const html = pintaLider(lider(CALIENTE));
  assert.match(html, /class="cache"/, "la fila no pinta el reloj del caché");
  assert.equal(pintorCache("t", CALIENTE.cache_vence, 3600, false)(AHORA).texto, "21m");
  // El rayo es el ::before de .cache, y nada lo esconde en la lista.
  const base = leer("../src/index.css");
  assert.match(base, /\.cache::before \{[^}]*mask: url\("data:image\/svg/);
  const riel = leer("../src/barra/riel-estilos.css");
  const regla = riel.match(/\n\.lista \.fila \.cache \{[^}]*\}/)?.[0] ?? "";
  assert.ok(regla, "falta la regla del caché en la lista");
  assert.doesNotMatch(regla, /display: none/);
  assert.doesNotMatch(riel, /\.lista \.lw:hover \.fila \.cache/, "el caché no puede ser sólo del hover");
});

test("el rayito: vencido dice Uncached y apaga, sin rayo; sin caché (otro motor) no hay nada", () => {
  const frio = pintorCache("f", AHORA - 60, 3600, false)(AHORA);
  assert.equal(frio.texto, "Uncached");
  assert.equal(frio.attrs?.["data-frio"], "");
  assert.doesNotMatch(pintaLider(lider({ cache_vence: null })), /class="cache"/);
  assert.doesNotMatch(pintaLider(lider({ ...CALIENTE, modelo: "gemini-3.8-flash" })), /class="cache"/);
});

test("el chip de modelo y esfuerzo va en cada worker y en el líder, con la forma larga y la corta", () => {
  const w = pintaFila(hilo("trabajando", { modelo: "claude-sonnet-5-5", effort: "high" }));
  assert.match(w, /data-chip-mod[^>]*data-tip="Modelo: Sonnet 5\.5\. Esfuerzo: high\."/);
  assert.match(w, /<span class="mc-l">Sonnet high<\/span><span class="mc-c" aria-hidden="true">S high<\/span>/);
  assert.match(pintaFila(hilo("listo")), /data-chip-mod/);
  assert.match(pintaLider(lider()), /<span class="mc-l">Opus high<\/span>/);
  assert.doesNotMatch(pintaLider(lider({ modelo: null })), /data-chip-mod/);
  assert.doesNotMatch(pintaLider(lider({ caido: "murio" })), /data-chip-mod/, "un líder sin proceso ya dice Murió");
  // La barra angosta abrevia con el CSS: la larga queda para el lector de pantalla, no se saca con display:none.
  const riel = leer("../src/barra/riel-estilos.css");
  assert.match(riel, /\.lista\[data-estrecha\] \.fila \.chip-mod \.mc-l \{[^}]*clip-path/);
  assert.match(leer("../src/barra/CONVENCIONES.md"), /Sonnet high/);
});

test("lo que corre dice «corre hace 4 m» y desde cuándo en el tooltip; Uncached pasa al tooltip y a la vista queda un anillo", () => {
  const corre = pintaFila(hilo("trabajando", { inicio: AHORA - 240 }));
  assert.match(corre, /class="cuando" data-tip="Empezó \d/);
  assert.equal(pintorDura(AHORA - 240, () => "corre hace ")(AHORA).texto, "corre hace 4 m");
  assert.doesNotMatch(pintaFila(hilo("listo")), /Empezó/);
  const frio = pintorCache("f2", AHORA - 60, 3600, false)(AHORA);
  assert.match(String(frio.attrs?.["data-tip"]), /próximo mensaje.*más cupo/);
  const riel = leer("../src/barra/riel-estilos.css");
  assert.match(riel, /\.lista \.fila \.cache\[data-frio\] \{\s*font-size: 0;/, "la palabra no se ve (queda para el lector de pantalla)");
});

test("las coronas: cada estado del líder la lleva, con el suyo", () => {
  const casos: [string, string][] = [
    [pintaLider(lider()), "quieto"],
    [pintaLider(lider({ ocupado: true })), "responde"],
    [pintaLider(lider(), 2), "dirige"],
    [pintaLider(lider({ caido: "murio", vivo: false })), "murio"],
    [pintaLider(lider({ caido: "cerro", vivo: false })), "cerrado"],
  ];
  for (const [html, estado] of casos) {
    assert.match(html, new RegExp(`class="corona" data-estado="${estado}"`), estado);
    assert.match(html, /lucide-crown/, estado);
  }
  assert.match(pintaLider(lider({ ocupado: true })), /class="fulgor"/);
  assert.match(pintaLider(lider({ caido: "murio", vivo: false })), />Murió</);
  assert.match(pintaLider(lider({ caido: "cerro", vivo: false })), />Cerrado</);
});

test("el líder que te espera: corona en ámbar y la palabra, aunque pida permiso o haya terminado el turno", () => {
  for (const motivo of ["listo", "pide"] as const) {
    const html = pintaLider(lider({ ...CALIENTE, espera: { motivo, desde: AHORA - 60 } }), 0, "decision");
    assert.match(html, /lucide-crown/);
    assert.match(html, /class="corona"[^>]*data-at="decision"/);
    assert.match(html, />te espera</);
    assert.match(html, /class="cache"/, "te espera y le queda caché: es cuando más importa");
  }
});

test("ningún ✓ en un líder, en ningún estado, ni en su pliegue de terminados", () => {
  const estados = [
    pintaLider(lider()),
    pintaLider(lider(CALIENTE)),
    pintaLider(lider({ ocupado: true })),
    pintaLider(lider(), 3),
    pintaLider(lider({ caido: "murio", vivo: false })),
    pintaLider(lider({ caido: "cerro", vivo: false })),
    pintaLider(lider({ espera: { motivo: "listo", desde: AHORA - 60 } }), 0, "decision"),
    pintaLider(lider({ subagentes: 2 })),
  ];
  for (const html of estados) assert.ok(!conPalomita(html), html);
  const pliegue = renderToStaticMarkup(h(PliegueTerminados, { n: 10, lider: true, plegada: true, alPlegar: noop }));
  assert.ok(!conPalomita(pliegue), pliegue);
  assert.doesNotMatch(pliegue, /class="g"/, "el pliegue no lleva glifo: dice su palabra");
  assert.match(pliegue, /10 terminados/);
  assert.match(renderToStaticMarkup(h(PliegueTerminados, { n: 37, lider: false, plegada: true, alPlegar: noop })), /37 terminadas/);
});

test("la palomita dice terminó: sólo en el worker que terminó, y con la palabra en su tooltip", () => {
  const html = pintaFila(hilo("listo", { commits: 2 }));
  assert.ok(conPalomita(html));
  assert.match(html, /Terminó · 2 commits/);
  for (const e of ["trabajando", "murio", "colgado", "integrado"] as const) assert.ok(!conPalomita(pintaFila(hilo(e))), e);
});

test("le falta info: chip con ícono y palabra (es y en), en ámbar de aviso, sin palomita y sin el coral del fallo", () => {
  const html = pintaFila(hilo("falta-info", { commits: 1 }));
  assert.match(html, /class="chip-at"[^>]*data-at="falta"/);
  assert.match(html, /lucide-info/, "el chip lleva su ícono");
  assert.match(html, />le falta info</, "y su palabra: nunca sólo el color");
  assert.ok(!conPalomita(html), "no terminó: no lleva palomita");
  assert.doesNotMatch(html, /data-atencion=/, "no es un fallo ni una decisión: no tiñe la fila");
  assert.match(html, /data-g="falta"/);
  const atencion = leer("../src/barra-atencion.css");
  const regla = atencion.match(/\.chip-at\[data-at="falta"\] \{[^}]*\}/)?.[0] ?? "";
  assert.match(regla, /var\(--decision-/, "color de aviso (ámbar)");
  assert.doesNotMatch(regla, /fallo/, "nunca el coral del fallo");
  assert.match(leer("../src/barra/CONVENCIONES.md"), /`le falta info`/, "la convención del chip está escrita");
  assert.equal(es["fila.chipFalta"], "le falta info");
  assert.equal(en["fila.chipFalta"], "needs info");
});

test("lo que corre late (el punto, no un triángulo que se confunde con una flecha); lo trabado gira y lo dice", () => {
  const corre = pintaFila(hilo("trabajando"));
  assert.match(corre, /pt-trab/);
  assert.match(corre, /class="onda"/);
  assert.match(corre, /hilo-vivo/);
  assert.doesNotMatch(corre, /M8 5\.5v13/);
  const trabado = pintaFila(hilo("colgado"));
  assert.match(trabado, /pt-trabado/);
  assert.match(trabado, />Trabado</);
  assert.match(pintaFila(hilo("trabajando", { en_cola: true })), />En cola</);
  assert.match(pintaFila(hilo("murio", { frenado_en: AHORA - 60 })), />Frenado</);
});

test("lo que pide atención va con ícono y palabra; lo que decide no dice tiempo", () => {
  const falla = pintaFila(hilo("murio"));
  assert.match(falla, /data-g="falla"/);
  assert.match(falla, />falló</);
  assert.match(falla, /class="cuando"/);
  const decide = pintaFila(hilo("decision", { decision: "¿Cuál?" }));
  assert.match(decide, /data-g="pide"/);
  assert.match(decide, />decidir</);
  assert.doesNotMatch(decide, /class="cuando"/);
  // Ya resuelto (relanzado, visto): se calma.
  assert.doesNotMatch(pintaFila(hilo("murio"), { resuelto: true }), /data-atencion/);
});

test("el tiempo: lo que corre dice cuánto lleva; lo demás, hace cuánto, y desde la semana la fecha", () => {
  assert.equal(pintorDura(AHORA - 38)(AHORA).texto, "38 s");
  assert.equal(pintorDura(AHORA - 3900)(AHORA).texto, "1 h 05 m");
  assert.equal(pintorDura(AHORA - 26 * 3600)(AHORA).texto, "26 h 00 m", "una corrida larga no dice 'ayer'");
  assert.equal(pintorHace(AHORA - 25 * 60)(AHORA).texto, "hace 25 m");
  assert.equal(pintorHace(AHORA - 30 * 3600)(AHORA).texto, "ayer");
  assert.equal(pintorHace(AHORA - 3 * 86400)(AHORA).texto, "hace 3 d");
  assert.doesNotMatch(pintorHace(AHORA - 9 * 86400)(AHORA).texto, /hace/);
});

test("subagentes en la fila del líder: dice qué son, no un número suelto", () => {
  assert.match(pintaLider(lider({ subagentes: 2 })), /2 sub\./);
});

test("la regla está escrita: hay que leer las convenciones antes de rediseñar la barra", () => {
  // La regla vive en docs/reglas/barra.md (la movió el recorte de AGENTS.md) y AGENTS.md manda a leerla.
  assert.match(leer("../../docs/reglas/barra.md"), /Antes de rediseñar la barra, leer app\/src\/barra\/CONVENCIONES\.md/);
  assert.match(leer("../../AGENTS.md"), /docs\/reglas\/barra\.md/);
  assert.ok(existsSync(fileURLToPath(new URL("../src/barra/CONVENCIONES.md", import.meta.url))));
});

test("el detalle de cupos (#1924): anillos con tooltip, ámbar a los 80, rojo sólo sin cupo, un bloque por suscripción y el enlace a Plan y cupos", () => {
  const riel = leer("../src/barra/CuposRiel.tsx");
  assert.match(riel, /pintorAnilloTip/, "cada anillo dice su ventana, el % usado y cuándo vuelve");
  assert.match(riel, /bloquesMotores/, "agrupado por suscripción");
  assert.match(riel, /abrirAjustes\("cupos"\)/, "el pie lleva a Plan y cupos");
  assert.match(riel, /hayCuentas \? <p className="v-pie">/, "«no cambia de cuenta sola» sólo con varias cuentas");
  assert.match(leer("../src/barra/cupos-riel-logica.ts"), /AMBAR_DESDE = 80/);
  const es = leer("../src/i18n/es.ts");
  for (const clave of ["riel.actualizado", "riel.noActualizo", "riel.sinLimiteConocido", "riel.verPlan", "cu.gp.claude-gpt"]) assert.match(es, new RegExp(`"${clave}"`));
  const conv = leer("../src/barra/CONVENCIONES.md");
  for (const frase of ["5 horas: 5 % usado", "Gratis · sin límite conocido", "Actualizado hace 2 m", "Ver Plan y cupos"]) assert.ok(conv.includes(frase), frase);
});

test("el encabezado de cada carpeta tiene el + de chat nuevo, con su nombre accesible y su foco, y está escrito en las convenciones", () => {
  const barra = leer("../src/barra/Barra.tsx");
  const boton = barra.match(/<button[^>]*className="proy-nueva"[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.ok(boton, "el botón .proy-nueva está en el encabezado de Carpeta");
  assert.match(boton, /aria-label=\{tr\("barra\.nuevaEn", \{ p: nombre \}\)\}/, "aria-label con barra.nuevaEn");
  assert.match(boton, /onClick=\{\(\) => alNueva\(g\.proyecto\)\}/, "abre el chat nuevo de ese proyecto");
  assert.match(barra, /alNueva && !otras/, "no sale en «Otras carpetas»");
  assert.match(leer("../src/i18n/es.ts"), /"barra\.nuevaEn": "Chat nuevo en \{p\}"/);
  assert.match(leer("../src/i18n/en.ts"), /"barra\.nuevaEn": "New chat in \{p\}"/);
  assert.match(leer("../src/barra/riel-estilos.css"), /\.proy-nueva:focus-visible \{[^}]*outline:/, "foco visible con teclado");
  assert.ok(leer("../src/barra/CONVENCIONES.md").includes("Chat nuevo en <proyecto>"), "documentado en CONVENCIONES.md");
});


test("anillos del riel: 3rem, insignia por estado, marquita semanal y tokens", () => {
  const css = leer("../src/barra/riel-estilos.css");
  assert.match(css, /\.an-c \{[^}]*width:\s*3rem[^}]*height:\s*3rem/);
  assert.match(css, /\.an-c > svg \{[^}]*stroke-width:\s*0\.3125rem/);
  assert.match(css, /tabular-nums/);
  assert.match(css, /\.an-uso \{[^}]*stroke:\s*var\(--ok\)/);
  assert.match(css, /\.an-insig/);
  assert.match(css, /\.an-marca/);
  const riel = leer("../src/barra/CuposRiel.tsx");
  assert.match(riel, /<Insignia nivel=\{estado\.nivel\}/);
  assert.match(riel, /semanal/);
});
