// La tarjeta de actividad del chat: de qué evento del stream sale cada tipo y su detalle (src/hilo/actividad-logica.ts), lo concreto que
// saca el main (detalleHace) y los pasos de atrás. Sin React ni i18n: el módulo devuelve claves, y acá se comprueba que existan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { detalleHace, parsearLinea } from "../electron/lider-arma.ts";
import { avanzar, clasificar, clasificarPedido, cuentaMas, cuentaPasos, cuentaTokens, delegaPa, dominio, estadoDe, fraseDe, iconoDe, limpiarComando, muyLargo, PLIEGUE, rutaLegible, sinNovedades, SIN_NOVEDADES_MS, sinPasos, textoPaso, ultimaLinea, unaLinea, MAX_PASOS, PASOS, type Actividad } from "../src/hilo/actividad-logica.ts";
import { cambiarIdioma } from "../src/i18n/index.ts";
import { en } from "../src/i18n/en.ts";
import { es } from "../src/i18n/es.ts";
import type { HaceLider } from "../src/datos/contrato.ts";

const herr = (nombre: string, detalle: string | null, extra?: string): HaceLider => ({ que: "herramienta", nombre, detalle, ...(extra ? { extra } : {}) });
const sola = (que: "pidiendo" | "pensando" | "escribiendo" | "compactando"): HaceLider => ({ que, nombre: null, detalle: null });

test("cada evento cae en su tipo", () => {
  const caso = (h: HaceLider) => clasificar(h).tipo;
  assert.equal(caso(sola("pidiendo")), "pensando");
  assert.equal(caso(sola("pensando")), "pensando");
  assert.equal(caso(sola("escribiendo")), "escribiendo");
  assert.equal(caso(herr("WebSearch", "css grid")), "web");
  assert.equal(caso(herr("WebFetch", "https://developer.mozilla.org/es/docs")), "web");
  for (const n of ["Read", "Grep", "Glob"]) assert.equal(caso(herr(n, "x")), "codigo", n);
  for (const n of ["Edit", "Write", "MultiEdit"]) assert.equal(caso(herr(n, "/a/b.ts")), "editando", n);
  assert.equal(caso(herr("Bash", "git status")), "comando");
  assert.equal(caso(herr("Agent", "revisar", "Explore")), "delegando");
  assert.equal(caso(herr("Task", "revisar")), "delegando");
  assert.equal(caso(herr("ExitPlanMode", null)), "permiso");
  assert.equal(caso(herr("AskUserQuestion", null)), "permiso");
  assert.equal(caso(herr("TodoWrite", null)), "comando");
});

test("el detalle es lo concreto: dominio, patrón con carpeta, ruta, agente", () => {
  assert.equal(clasificar(herr("WebFetch", "https://www.developer.mozilla.org/es/docs/Web?x=1")).detalle, "developer.mozilla.org");
  assert.equal(clasificar(herr("WebSearch", "css grid")).detalle, "«css grid»");
  // La preposición sigue el idioma de la interfaz (antes quedaba «en» fijo aun en inglés).
  cambiarIdioma("es");
  assert.equal(clasificar(herr("Grep", "useEffect", "src/hilo")).detalle, "«useEffect» en src/hilo");
  cambiarIdioma("en");
  assert.equal(clasificar(herr("Grep", "useEffect", "src/hilo")).detalle, "«useEffect» in src/hilo");
  assert.equal(clasificar(herr("Glob", "**/*.tsx")).detalle, "«**/*.tsx»");
  assert.equal(clasificar(herr("Read", "/home/ana/Proyectos/hilos/src/a.ts")).detalle, "~/Proyectos/hilos/src/a.ts");
  assert.equal(clasificar(herr("Agent", "mapear el código", "Explore")).detalle, "Explore · mapear el código");
  // Sin detalle todavía (el stream anuncia la herramienta antes de completarla): al menos el nombre.
  assert.equal(clasificar(herr("Read", null)).detalle, "Read");
});

test("el comando se limpia del cd … && y lo concreto se lee entero (nunca con …)", () => {
  assert.equal(limpiarComando("cd /home/ana/Proyectos/hilos && npm test"), "npm test");
  assert.equal(limpiarComando('cd "/a b/c" && cd sub; npm run build'), "npm run build");
  assert.equal(limpiarComando("cd /solo"), "cd /solo");
  assert.equal(clasificar(herr("Bash", "cd ~/x && git status --short")).detalle, "git status --short");
  const largo = "echo " + "x".repeat(300);
  assert.equal(clasificar(herr("Bash", largo)).detalle, largo);
  assert.equal(unaLinea("a   b\n c"), "a b c");
  const ruta = rutaLegible("/home/ana/Proyectos/hilos/src/hilo/componentes/mucho/más/profundo/Archivo.tsx");
  assert.equal(ruta, "~/Proyectos/hilos/src/hilo/componentes/mucho/más/profundo/Archivo.tsx");
  assert.equal(dominio("no es una url"), "no");
});

test("lo largo se pliega (no se corta): sólo pasa de PLIEGUE", () => {
  assert.equal(PLIEGUE, 200);
  assert.equal(muyLargo("x".repeat(PLIEGUE)), false);
  assert.equal(muyLargo("x".repeat(PLIEGUE + 1)), true);
});

test("el detalle del chat llega entero del main (sin cortar la primera línea ni a 80)", () => {
  const cmd = "npm run build && node scripts/prueba-actividad.mjs\nFOTOS=/tmp/x " + "y".repeat(500);
  const d = detalleHace("Bash", { command: cmd }).detalle ?? "";
  assert.equal(d, unaLinea(cmd));
  assert.ok(!d.includes("…"));
  const prompt = "Revisar el módulo\n" + "z".repeat(3000);
  const ag = detalleHace("Agent", { subagent_type: "Explore", description: "mapear", prompt }).detalle ?? "";
  assert.equal(ag, "mapear");
  assert.ok(detalleHace("Grep", { pattern: "p".repeat(150) }).detalle?.length === 150);
});

test("un pa que lanza un worker es delegar; los demás pa son un comando", () => {
  assert.equal(delegaPa('pa hilos --tipo mecanico "arreglar el índice"'), "hilos · arreglar el índice");
  assert.equal(clasificar(herr("Bash", 'cd ~ && pa hilos "hacer algo"')).tipo, "delegando");
  assert.equal(delegaPa("pa --integrar hilos"), null);
  assert.equal(delegaPa("pa --hilos"), null);
  assert.equal(delegaPa("pa --esperar"), null);
  assert.equal(clasificar(herr("Bash", "pa --hilos")).tipo, "comando");
  assert.equal(delegaPa("pass this"), null);
});

test("un permiso sin contestar manda: Te necesita, con qué", () => {
  const base = { herramienta: "Bash", detalle: "cd /x && make clean", plan: null, preguntas: null };
  assert.deepEqual(clasificarPedido(base), { tipo: "permiso", verbo: "hz.permiso", detalle: "Bash: make clean", detalleClave: "hz.d.permiso", icono: "permiso" });
  assert.equal(clasificarPedido({ ...base, herramienta: "ExitPlanMode", detalle: null, plan: "# plan" }).detalleClave, "hz.d.plan");
  const p = clasificarPedido({ ...base, herramienta: "AskUserQuestion", detalle: null, preguntas: [{ question: "¿Cuál?" }] });
  assert.equal(p.detalleClave, "hz.d.pregunta");
  assert.equal(p.detalle, "¿Cuál?");
});

test("los pasos: lo que ya corría no cuenta y un razonamiento corto tampoco", () => {
  let s = sinPasos;
  s = avanzar(s, sola("pidiendo"), 0);
  s = avanzar(s, sola("pensando"), 1000); // pidiendo: no es un paso
  s = avanzar(s, herr("Read", null), 6000); // pensó 5 s
  s = avanzar(s, herr("Read", "/x/a.ts"), 6100); // se completó: el mismo paso
  assert.equal(s.pasos.length, 1);
  assert.equal(s.inicio, 6000);
  s = avanzar(s, herr("Grep", "foo"), 7000);
  s = avanzar(s, sola("pensando"), 8000);
  s = avanzar(s, sola("escribiendo"), 8300); // pensó 0,3 s: no cuenta
  assert.equal(s.pasos.length, 3);
  assert.equal(s.n, 3);
  assert.deepEqual(s.pasos.map((p) => textoPaso(p)?.clave), ["hz.p.busco", "hz.p.leyo", "hz.p.penso"]);
  assert.deepEqual(textoPaso(s.pasos[1]), { clave: "hz.p.leyo", d: "/x/a.ts" });
  assert.equal(avanzar(s, null, 9000), sinPasos);
  assert.equal(avanzar(sinPasos, null, 1), sinPasos);
});

test("se guardan los últimos MAX_PASOS y n sigue contando", () => {
  let s = sinPasos;
  for (let i = 0; i < MAX_PASOS + 5; i++) s = avanzar(s, herr("Read", `/x/${i}.ts`), i * 1000);
  assert.equal(s.pasos.length, MAX_PASOS);
  assert.equal(s.n, MAX_PASOS + 4); // el último todavía corre
  assert.ok(PASOS < MAX_PASOS);
  assert.equal(textoPaso(s.pasos[0])?.d, `/x/${MAX_PASOS + 3}.ts`);
});

test("el estado y el icono de lo que hace", () => {
  const e = (h: HaceLider) => estadoDe(clasificar(h));
  assert.equal(e(sola("pidiendo")), "espera");
  assert.equal(e(sola("pensando")), "piensa");
  assert.equal(e(sola("escribiendo")), "escribe");
  assert.equal(e(herr("Bash", "ls")), "herramienta");
  assert.equal(e(herr("AskUserQuestion", null)), "permiso");
  const i = (n: string, d = "x") => iconoDe(herr(n, d));
  assert.deepEqual([i("Bash"), i("Read"), i("Grep"), i("Edit"), i("Write"), i("WebFetch"), i("Agent"), i("TodoWrite"), i("Bash", "pa hilos arreglar")], ["correr", "leer", "buscar", "editar", "escribir", "web", "delegar", "otro", "delegar"]);
  assert.equal(iconoDe(sola("pensando")), "pensar");
});

test("el main saca el patrón de Grep/Glob y a quién delega Agent", () => {
  assert.deepEqual(detalleHace("Grep", { pattern: "foo", path: "src" }), { detalle: "foo", extra: "src" });
  assert.deepEqual(detalleHace("Glob", { pattern: "**/*.ts" }), { detalle: "**/*.ts" });
  assert.equal(detalleHace("Agent", { subagent_type: "Explore", description: "mapear" }).extra, "Explore");
  assert.deepEqual(detalleHace("Bash", { command: "ls" }), { detalle: "ls" });
  const l = JSON.stringify({ type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "t1", name: "Grep", input: { pattern: "foo", path: "src" } }] } });
  const hace = parsearLinea(l).find((e) => e.tipo === "hace");
  assert.deepEqual(hace && "hace" in hace ? hace.hace : null, { que: "herramienta", nombre: "Grep", detalle: "foo", extra: "src" });
});

test("toda clave que usa la clasificación existe en los dos idiomas", () => {
  const hs: HaceLider[] = [sola("pidiendo"), sola("pensando"), sola("escribiendo"), sola("compactando"), herr("WebSearch", "a"), herr("WebFetch", "https://a.b"), herr("Read", "a"), herr("Grep", "a"), herr("Glob", "a"), herr("Edit", "a"), herr("Write", "a"), herr("Agent", "a"), herr("Bash", "ls"), herr("Bash", "pa x y"), herr("ExitPlanMode", null), herr("AskUserQuestion", null), herr("Otra", "a")];
  const acts: Actividad[] = hs.map(clasificar);
  acts.push(clasificarPedido({ herramienta: "Bash", detalle: "ls", plan: null, preguntas: null }));
  const claves = new Set<string>();
  for (const a of acts) {
    claves.add(a.verbo);
    if (a.detalleClave) claves.add(a.detalleClave);
  }
  for (const h of hs) {
    const p = textoPaso({ hace: h, seg: 3 });
    if (p) claves.add(p.clave);
  }
  assert.ok(claves.size > 15);
  for (const k of claves) {
    assert.ok(k in en, `en: ${k}`);
    assert.ok(k in es, `es: ${k}`);
  }
});

test("los contadores del pie de la tarjeta: 1 va en singular, el resto en plural (no \"1 steps\")", () => {
  cambiarIdioma("en");
  try {
    assert.equal(cuentaPasos(1), "1 step");
    assert.equal(cuentaPasos(2), "2 steps");
    assert.equal(cuentaMas(1), "+1 step");
    assert.equal(cuentaMas(3), "+3 steps");
    assert.equal(cuentaTokens(1, "1"), "1 token");
    assert.equal(cuentaTokens(12, "12"), "12 tokens");
    assert.equal(cuentaTokens(1200, "1,2k"), "1,2k tokens");
  } finally {
    cambiarIdioma("en");
  }
  cambiarIdioma("es");
  try {
    assert.equal(cuentaPasos(1), "1 paso");
    assert.equal(cuentaPasos(2), "2 pasos");
    assert.equal(cuentaMas(1), "+1 paso");
    assert.equal(cuentaMas(3), "+3 pasos");
    assert.equal(cuentaTokens(1, "1"), "1 token");
    assert.equal(cuentaTokens(12, "12"), "12 tokens");
    assert.equal(cuentaTokens(1200, "1,2k"), "1,2k tokens");
  } finally {
    cambiarIdioma("en");
  }
});

const bash = (detalle: string, desc?: string): HaceLider => ({ que: "herramienta", nombre: "Bash", detalle, ...(desc ? { desc } : {}) });
const fraseBash = (detalle: string, desc?: string, salida: { linea: string; error: boolean } | null = null) => {
  const hace = bash(detalle, desc);
  return fraseDe({ act: clasificar(hace), hace, pasos: [], salida });
};

test("frase: el título es la descripción del comando, y abajo Corriendo con el comando", () => {
  cambiarIdioma("es");
  const f = fraseBash("tablero lista --abiertas", "Revisando workers y tablero");
  assert.equal(f.titulo, "Revisando workers y tablero");
  assert.equal(f.verbo, "Corriendo");
  assert.equal(f.linea, "tablero lista --abiertas");
  assert.equal(f.mono, true);
});

test("frase: sin descripción el título es «Corriendo Bash» y no repite el verbo", () => {
  cambiarIdioma("es");
  const f = fraseBash("npm test");
  assert.equal(f.titulo, "Corriendo Bash");
  assert.equal(f.verbo, null);
  assert.equal(f.linea, "npm test");
  cambiarIdioma("en");
  assert.equal(fraseBash("npm test").titulo, "Running Bash");
  cambiarIdioma("es");
});

test("frase: con lo que devolvió el comando, Corrió y su última línea; con error, lo dice en palabras", () => {
  cambiarIdioma("es");
  const f = fraseBash("npm test", "Probando", { linea: "12 passing", error: false });
  assert.equal(f.verbo, "Corrió");
  assert.equal(f.linea, "12 passing");
  assert.equal(fraseBash("npm test", "Probando", { linea: "1 failing", error: true }).verbo, es["hz.t.error"]);
  cambiarIdioma("en");
  assert.equal(fraseBash("npm test", "Testing", { linea: "12 passing", error: false }).verbo, "Ran");
  cambiarIdioma("es");
});

test("frase: un permiso sin contestar manda; un turno fallado lo dice en el título", () => {
  cambiarIdioma("es");
  const pedido = clasificarPedido({ id: "p1", nombre: "Bash", detalle: "git push origin main", tipo: "permiso" } as never);
  assert.equal(fraseDe({ act: pedido, hace: bash("git push origin main"), pasos: [] }).titulo, "Te necesita");
  const hace = bash("tablero lista", "Revisando el tablero");
  assert.equal(fraseDe({ act: clasificar(hace), hace, pasos: [], fallo: true }).titulo, "No pudo terminar: Revisando el tablero");
});

test("frase: lo de antes queda como miga, de lo más viejo a lo más nuevo y sólo tres", () => {
  cambiarIdioma("es");
  const hace = bash("npm test", "Probando");
  const pasos = ["d.ts", "c.ts", "b.ts", "a.ts"].map((f, i) => ({ hace: herr("Read", f), seg: i }));
  const { antes } = fraseDe({ act: clasificar(hace), hace, pasos });
  assert.equal(antes.length, 3);
  assert.ok(antes[2].includes("d.ts"), antes.join(" | "));
});

test("la última línea: sin colores, con barras de progreso y salteando los renglones vacíos", () => {
  assert.equal(ultimaLinea("uno\ndos\n\n"), "dos");
  assert.equal(ultimaLinea("\u001b[32m12 passing\u001b[0m\n"), "12 passing");
  assert.equal(ultimaLinea("10%\r50%\r100%"), "100%");
  assert.equal(ultimaLinea("  \n"), "");
  assert.equal(ultimaLinea("x".repeat(1000)).length, 400);
});

test("sin novedades: recién a los 2 minutos, y sin dato no avisa", () => {
  assert.equal(SIN_NOVEDADES_MS, 120_000);
  assert.equal(sinNovedades(1000, 1000 + SIN_NOVEDADES_MS - 1), false);
  assert.equal(sinNovedades(1000, 1000 + SIN_NOVEDADES_MS), true);
  assert.equal(sinNovedades(0, 10 * SIN_NOVEDADES_MS), false);
});

test("el main pasa la descripción del comando, salvo que sea lo mismo que el detalle", () => {
  assert.deepEqual(detalleHace("Bash", { command: "ls", description: "Mirar la carpeta" }), { detalle: "ls", desc: "Mirar la carpeta" });
  assert.deepEqual(detalleHace("Bash", { command: "ls" }), { detalle: "ls" });
  assert.deepEqual(detalleHace("Bash", { description: "Mirar" }), { detalle: "Mirar" });
});

test("los textos de la tarjeta están en los dos idiomas", () => {
  for (const k of ["hz.corrio", "hz.quieto", "hz.f.noTermino", "hz.f.noTerminoSolo", "hz.f.parado", "hz.todo", "hz.menos"] as const) {
    assert.ok(es[k], `falta ${k} en es`);
    assert.ok(en[k], `falta ${k} en en`);
  }
  assert.equal(es["hz.quieto"], "Sin novedades hace");
  assert.equal(en["hz.corrio"], "Ran");
});
