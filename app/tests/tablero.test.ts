// El tablero de pendientes: la lógica pura del panel (src/datos/tablero.ts), los argumentos que se
// le pasan al CLI (electron/tablero.ts) y, si el CLI `tablero` está instalado, la vuelta entera
// (agregar, mover, cerrar, reabrir, posponer, tirar, leer, enterarse del cambio) contra un tablero
// TEMPORAL: `TABLERO_DIR`, `PA_STATE` y `PROYECTOS_REGISTRY` apuntan a una carpeta que se borra al
// terminar. El tablero real no se toca nunca. El entorno va antes de los `await import`:
// electron/tablero.ts resuelve el binario y la vista al cargar.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
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

const TMP = mkdtempSync(path.join(os.tmpdir(), "hilos-tablero-"));
after(() => rmSync(TMP, { recursive: true, force: true }));
Object.assign(process.env, { TABLERO_DIR: path.join(TMP, "tablero"), PA_STATE: path.join(TMP, "pa"), PROYECTOS_REGISTRY: path.join(TMP, "registry.json") });
delete process.env.TABLERO_VISTA;

const cli = await import("../electron/tablero.ts");
// El frontend, con un `window.hilos.tablero` que llama derecho a lo del main (sin IPC de por medio).
Object.assign(globalThis, {
  location: { search: "?fixtures=0" },
  window: { hilos: { tablero: { leer: cli.leerTablero, mover: cli.mover, cerrar: cli.cerrar, tirar: cli.tirar, posponer: cli.posponer, agregar: cli.agregar, responder: cli.responder, esperan: cli.contarEsperan, alCambiar: cli.mirarTablero } } },
});
const { fuenteTablero } = await import("../src/datos/fuenteTablero.ts");
const { tableroFijo } = await import("../src/datos/fixtures-tablero.ts");
const { t } = await import("../src/i18n/index.ts");
const { ABIERTAS, ALTO, ErrorTablero, aplicar, buscar, edad, filasProyectos, filtrar, nombres, plano, rango, retirado, tono, tramos, validar } = await import(
  "../src/datos/tablero.ts"
);

const AHORA = Date.parse("2026-03-04T12:00:00Z");
const fijo = () => validar(tableroFijo(AHORA));

// --- Lógica pura ---------------------------------------------------------------------

test("validar: version desconocida o vista sin columnas es un error; lo raro de adentro se saltea", () => {
  assert.throws(() => validar(null), ErrorTablero);
  assert.throws(() => validar({ version: 2, vista: { columnas: {} } }), ErrorTablero);
  assert.throws(() => validar({ version: 1, vista: {} }), ErrorTablero);
  const v = validar({
    version: 1,
    vista: { columnas: { bandeja: [{ id: 3, titulo: "uno" }, { id: "x" }, null], inventada: [{ id: 9 }] }, contadores: { pospuestos: 2 } },
    hecho: "no es lista",
    proyectos: [{ proyecto: "atlas", dias: 4 }, { etapa: "activo" }],
    aviso: "",
  });
  assert.deepEqual(v.columnas.bandeja.map((i) => i.id), [3]);
  assert.equal(v.columnas.bandeja[0].prueba, "");
  assert.equal(v.columnas.bandeja[0].head, null);
  assert.deepEqual(Object.keys(v.columnas), [...ABIERTAS]);
  assert.deepEqual(v.hecho, []);
  assert.deepEqual(v.proyectos, [{ proyecto: "atlas", etapa: "?", dias: 4, abiertos: 0, sigue: null }]);
  assert.equal(v.pospuestos, 2);
  assert.equal(v.aviso, null);
});

test("los fixtures: unos 500 items, bandeja de más de 200, todo con la forma que se espera", () => {
  const v = fijo();
  assert.ok(v.columnas.bandeja.length > 200);
  assert.ok(ABIERTAS.reduce((s, k) => s + v.columnas[k].length, 0) > 450);
  assert.equal(v.hecho.length, 14);
  assert.ok(v.hecho.every((i) => i.cerrado));
  assert.ok(v.proyectos.some((p) => p.etapa === "pausado"));
});

test("tono: el mismo proyecto da siempre el mismo color, y dos distintos no caen juntos", () => {
  assert.equal(tono("hilos"), tono("hilos"));
  for (const p of ["hilos", "atlas", "a", ""]) assert.ok(tono(p) >= 0 && tono(p) < 360 && Number.isInteger(tono(p)));
  assert.equal(new Set(["atlas", "brote", "cauce", "duna", "eco", "faro"].map(tono)).size, 6);
});

test("edad: minutos, horas y días; vacía si la fecha no se entiende", () => {
  const hace = (min: number) => new Date(AHORA - min * 60_000).toISOString();
  assert.equal(edad(hace(0), AHORA), "0m");
  assert.equal(edad(hace(59), AHORA), "59m");
  assert.equal(edad(hace(60), AHORA), "1h");
  assert.equal(edad(hace(1439), AHORA), "23h");
  assert.equal(edad(hace(1440 * 9 + 5), AHORA), "9d");
  assert.equal(edad(hace(-30), AHORA), "0m");
  assert.equal(edad("", AHORA), "");
});

test("filtrar: por proyecto y por todas las palabras, sin tildes ni mayúsculas, y por #id", () => {
  const v = validar({
    version: 1,
    vista: {
      columnas: {
        bandeja: [
          { id: 1, proyecto: "atlas", titulo: "Probar la Píldora nueva" },
          { id: 2, proyecto: "brote", titulo: "Regar", detalle: "la pildora de siempre" },
          { id: 12, proyecto: "atlas", titulo: "Otra", prueba: "npm test" },
        ],
      },
    },
  });
  const b = v.columnas.bandeja;
  const ids = (proyecto: string | null, texto: string) => filtrar(b, { proyecto, texto }).map((i) => i.id);
  assert.equal(filtrar(b, { proyecto: null, texto: "  " }), b);
  assert.deepEqual(ids("atlas", ""), [1, 12]);
  assert.deepEqual(ids(null, "PILDORA"), [1, 2]);
  assert.deepEqual(ids(null, "pildora nueva"), [1]);
  assert.deepEqual(ids("brote", "pildora"), [2]);
  assert.deepEqual(ids(null, "npm"), [12]);
  assert.deepEqual(ids(null, "#12"), [12]);
  assert.deepEqual(ids(null, "brote"), [2]);
  assert.equal(plano("Ñandú Ágil"), "nandu agil");
});

test("aplicar: lo movido ya está arriba de su columna nueva; lo tirado o pospuesto desaparece", () => {
  const v = fijo();
  assert.equal(aplicar(v, new Map()), v);
  const [a, b, c] = v.columnas.bandeja;
  const h = v.hecho[0];
  const q = aplicar(v, new Map([[a.id, "sigue"], [b.id, null], [c.id, "hecho"], [h.id, "ideas"], [v.columnas.sigue[0].id, "sigue"]]));
  assert.equal(q.columnas.sigue[0].id, a.id);
  assert.equal(q.columnas.sigue[0].columna, "sigue");
  assert.equal(q.columnas.sigue.length, v.columnas.sigue.length + 1);
  assert.equal(q.columnas.bandeja.length, v.columnas.bandeja.length - 3);
  assert.equal(buscar(q, b.id), null);
  assert.equal(q.hecho[0].id, c.id);
  assert.equal(q.columnas.ideas[0].id, h.id);
  assert.equal(q.hecho.length, v.hecho.length);
  // El original no se toca.
  assert.equal(v.columnas.bandeja[0].id, a.id);
  assert.equal(buscar(v, a.id)?.columna, "bandeja");
});

test("filasProyectos: por días sin tocar (los más quietos primero, o al revés), sin repo al final, con lo que espera", () => {
  const v = fijo();
  const { activos: parados } = filasProyectos(v, true);
  const conDias = parados.filter((p) => p.dias !== null).map((p) => p.dias);
  assert.deepEqual(conDias, [...conDias].sort((x, y) => y! - x!));
  assert.ok(parados.slice(conDias.length).every((p) => p.dias === null));
  assert.deepEqual(
    filasProyectos(v, false).activos.filter((p) => p.dias !== null).map((p) => p.dias),
    [...conDias].reverse(),
  );
  assert.ok(parados.some((p) => p.etapa === "pausado"));
  assert.equal(parados.reduce((s, p) => s + p.esperan.length, 0), v.columnas["espera-dueno"].length);
  assert.deepEqual(nombres(v), [...nombres(v)].sort((x, y) => x.localeCompare(y)));
});

test("filasProyectos: los retirados van aparte de los activos, no se mezclan ni se ofrecen en el filtro", () => {
  const v = fijo();
  const { activos, retirados } = filasProyectos(v, true);
  assert.deepEqual(retirados.map((p) => p.proyecto), ["viejo", "ensayo"], "los que más abiertos tienen primero");
  assert.ok(retirados.every(retirado) && activos.every((p) => !retirado(p)));
  assert.equal(activos.length + retirados.length, v.proyectos.length);
  // El orden de los activos no cambia a los retirados.
  assert.deepEqual(filasProyectos(v, false).retirados, retirados);
  assert.ok(!nombres(v).includes("viejo") && !nombres(v).includes("ensayo"));
  // Un retirado con algo abierto sí aparece (el filtro lo ve en un item).
  const conItem = { ...v, columnas: { ...v.columnas, bandeja: [{ ...v.columnas.bandeja[0], proyecto: "viejo" }, ...v.columnas.bandeja] } };
  assert.ok(nombres(conItem).includes("viejo"));
});

test("pospuestos: validar trae la lista (lo raro se saltea) y traer uno de vuelta lo pone arriba de su columna y deja de contar", () => {
  const v = fijo();
  assert.deepEqual(v.pospuestosLista.map((i) => i.id), [8001, 8002, 8003]);
  assert.ok(v.pospuestosLista.every((i) => i.hasta));
  assert.equal(v.pospuestos, 3);
  const sin = validar({ version: 1, vista: { columnas: {} }, pospuestosLista: [{ id: 1, columna: "sigue", hasta: "2026-12-01" }, { id: "x" }, null] });
  assert.deepEqual(sin.pospuestosLista.map((i) => [i.id, i.hasta]), [[1, "2026-12-01"]]);
  assert.deepEqual(validar({ version: 1, vista: { columnas: {} } }).pospuestosLista, []);

  const [a, b] = v.pospuestosLista;
  const q = aplicar(v, new Map([[a.id, a.columna as "sigue"]]));
  assert.equal(q.columnas.sigue[0].id, a.id);
  assert.equal(q.columnas.sigue[0].hasta, null);
  assert.equal(q.columnas.sigue.length, v.columnas.sigue.length + 1);
  assert.deepEqual(q.pospuestosLista.map((i) => i.id), [b.id, v.pospuestosLista[2].id]);
  assert.equal(q.pospuestos, 2);
  // Lo pospuesto que Ana no tocó queda como estaba; el original, intacto.
  assert.equal(aplicar(v, new Map([[999, "sigue"]])).pospuestosLista.length, 3);
  assert.equal(v.pospuestosLista.length, 3);
  assert.equal(v.columnas.sigue.some((i) => i.id === a.id), false);
});

test("columnas largas: de 224 tarjetas se pintan las de alrededor de lo visible, y el relleno cierra", () => {
  const b = fijo().columnas.bandeja;
  const tr = tramos(b);
  assert.equal(tr.length, b.length + 1);
  assert.equal(tr[1] - tr[0], b[0].prueba ? ALTO.prueba : ALTO.simple);
  assert.deepEqual(rango([0], 0, 40, 30), [0, 0]);
  const [d0, h0] = rango(tr, 0, 40, 30);
  assert.equal(d0, 0);
  assert.ok(h0 < 30, `arriba de todo se pintan ${h0}`);
  const medio = tr[120];
  const [d, h] = rango(tr, medio, 40, 30);
  assert.ok(d % 4 === 0 && d < 120 && h > 120 && h - d < 40, `en el medio: ${d}–${h}`);
  // Todo lo que toca la ventana (con su margen) está adentro.
  assert.ok(tr[d + 1] > medio - 30 - 4 * ALTO.prueba && tr[d] <= medio - 30 + ALTO.prueba);
  assert.ok(tr[h] >= medio + 40 + 30 || h === b.length);
  const [, hf] = rango(tr, tr[b.length] - 40, 40, 30);
  assert.equal(hf, b.length);
  assert.deepEqual(rango(tr, tr[b.length] + 500, 40, 30), [b.length, b.length]);
});

// --- Argumentos del CLI --------------------------------------------------------------

test("argumentos: ids, columnas y fechas validados; el título va después de `--`", () => {
  assert.deepEqual(cli.argvMover(12, "espera-dueno"), ["mover", "12", "--columna=espera-dueno"]);
  assert.deepEqual(cli.argvCerrar("7"), ["cerrar", "7"]);
  assert.deepEqual(cli.argvTirar(7), ["tirar", "7"]);
  assert.deepEqual(cli.argvPosponer(7, " +3D "), ["mover", "7", "--hasta=+3d"]);
  assert.deepEqual(cli.argvPosponer(7, "2026-12-31"), ["mover", "7", "--hasta=2026-12-31"]);
  assert.deepEqual(cli.argvPosponer(7, "mañana"), ["mover", "7", "--hasta=mañana"]);
  assert.deepEqual(cli.argvAgregar("  --columna=hecho\nmirá esto ", null), ["agregar", "--origen=trama", "--", "--columna=hecho mirá esto"]);
  assert.deepEqual(cli.argvAgregar("x", " atlas "), ["agregar", "--origen=trama", "--proyecto=atlas", "--", "x"]);
  assert.equal(cli.argvAgregar("x".repeat(900), "").at(-1)!.length, 500);
  // `hecho` y `tirado` no se mueven: van por cerrar y tirar.
  for (const mala of ["hecho", "tirado", "", "--hasta=ya", undefined]) assert.throws(() => cli.argvMover(1, mala), /main\.tableroColumnaRara/);
  for (const malo of [0, -1, 1.5, "1;ls", "", null, "--todo"]) assert.throws(() => cli.argvCerrar(malo), /main\.tableroIdRaro/);
  for (const mala of ["", "pronto", "+3", "3d", "2026-1-1", "--columna=hecho"]) assert.throws(() => cli.argvPosponer(1, mala), /main\.tableroHastaRaro/);
  for (const vacio of ["", "  \n ", null]) assert.throws(() => cli.argvAgregar(vacio, null), /main\.tableroTextoVacio/);
});

test("responder: la opción por su id, lo libre por su texto, la prueba con su nota y --borrar; lo raro ni sale", () => {
  assert.deepEqual(cli.argvResponder(4, { tipo: "pregunta", opcion: "b" }), ["responder", "4", "--opcion=b"]);
  assert.deepEqual(cli.argvResponder(4, { tipo: "pregunta", texto: "  otra\ncosa " }), ["responder", "4", "--respuesta=otra cosa"]);
  assert.deepEqual(cli.argvResponder("4", { tipo: "prueba", anda: true }), ["responder", "4", "--anda"]);
  assert.deepEqual(cli.argvResponder(4, { tipo: "prueba", anda: false, nota: "pierde\ncolores" }), ["responder", "4", "--no-anda", "--nota=pierde colores"]);
  assert.deepEqual(cli.argvResponder(4, null), ["responder", "4", "--borrar"]);
  for (const mala of [{ tipo: "pregunta" }, { tipo: "pregunta", opcion: "--x" }, { tipo: "pregunta", opcion: "abcd" }, { tipo: "prueba" }, { tipo: "rara" }, undefined, "anda"])
    assert.throws(() => cli.argvResponder(4, mala), /main\.tableroRespuestaRara/);
  assert.throws(() => cli.argvResponder("4;ls", null), /main\.tableroIdRaro/);
});

test("esperanEnVista: lo de espera-dueno que todavía no tiene respuesta", () => {
  const vista = { columnas: { "espera-dueno": [{ id: 1 }, { id: 2, respuesta: { texto: "x" } }, { id: 3, respuesta: null }, null], bandeja: [{ id: 9 }] } };
  assert.equal(cli.esperanEnVista(vista), 2);
  for (const rara of [null, {}, { columnas: {} }, { columnas: { "espera-dueno": "no" } }]) assert.equal(cli.esperanEnVista(rara), 0);
});

test("validar trae lo nuevo del item (tipo, palabras simples, opciones, respuesta) y deriva el tipo si falta", () => {
  const v = validar({
    version: 1,
    vista: {
      columnas: {
        "espera-dueno": [
          { id: 1, titulo: "viejo", prueba: "npm test" },
          { id: 2, titulo: "viejo", detalle: "d" },
          {
            id: 3,
            tipo: "pregunta",
            titulo: "t",
            titulo_simple: "simple",
            contexto: "ctx",
            opciones: [{ id: "a", texto: "Uno" }, { id: 5 }, { texto: "sin id" }],
            por_defecto: "a",
            respuesta: { texto: "", opcion: "a", opcion_texto: "Uno", fecha: "2026-03-04T12:00:00Z" },
          },
          { id: 4, tipo: "prueba", titulo: "t", respuesta: { anda: false, texto: "mal", fecha: "f" } },
        ],
      },
    },
    hecho: [],
    proyectos: [],
  });
  const [a, b, c, d] = v.columnas["espera-dueno"];
  assert.deepEqual([a.tipo, b.tipo, c.tipo, d.tipo], ["prueba", "pregunta", "pregunta", "prueba"]);
  assert.deepEqual([a.tituloSimple, a.contexto, a.opciones, a.porDefecto, a.respuesta], ["", "", [], null, null]);
  assert.deepEqual([c.tituloSimple, c.contexto, c.opciones, c.porDefecto], ["simple", "ctx", [{ id: "a", texto: "Uno" }], "a"]);
  assert.deepEqual(c.respuesta, { texto: "", opcion: "a", opcionTexto: "Uno", anda: null, fecha: "2026-03-04T12:00:00Z" });
  assert.deepEqual(d.respuesta, { texto: "mal", opcion: null, opcionTexto: null, anda: false, fecha: "f" });
});

test("la vista se busca donde la deja el CLI", () => {
  assert.equal(cli.rutaVista({ TABLERO_VISTA: "/x/v.json", TABLERO_DIR: "/t" }, "/home/ana"), "/x/v.json");
  assert.equal(cli.rutaVista({ TABLERO_DIR: "/t" }, "/home/ana"), "/t/vista.json");
  assert.equal(cli.rutaVista({}, "/home/ana"), "/home/ana/.local/state/tablero/vista.json");
  assert.equal(cli.VISTA, path.join(TMP, "tablero", "vista.json"));
});

test("recientes: de lo hecho, lo cerrado en los últimos días, lo más nuevo primero", () => {
  const dia = 86_400_000;
  const hecho = [1, 9, 3, 6.9].map((d, id) => ({ id, cerrado: new Date(AHORA - d * dia).toISOString() }));
  assert.deepEqual(cli.recientes([...hecho, { id: 99 }], AHORA, 7).map((x) => (x as { id: number }).id), [0, 2, 3]);
  assert.deepEqual(cli.recientes(null, AHORA), []);
});

// --- Contra el CLI de verdad, en un tablero temporal ---------------------------------

const hayCli = path.isAbsolute(cli.TABLERO) && existsSync(cli.TABLERO);
const tablero = (...args: string[]) => execFileSync(cli.TABLERO, args, { env: process.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const enDisco = () => JSON.parse(tablero("listar", "--todo", "--json")) as { id: number; columna: string; titulo: string; proyecto: string; origen: string; hasta: string | null }[];
const columnaDe = (id: number) => enDisco().find((i) => i.id === id)?.columna;

test("sin vista no hay tablero: el error dice dónde la buscó", { skip: !hayCli }, async () => {
  await assert.rejects(fuenteTablero.leer(), { message: t("main.tableroSinVista", { ruta: cli.VISTA }) });
  assert.equal(fuenteTablero.guardado(), null);
});

test("agregar, mover, cerrar, reabrir, posponer y tirar: lo hace el CLI y la app lo vuelve a leer", { skip: !hayCli }, async () => {
  tablero("init");
  assert.ok(cli.VISTA.startsWith(TMP), "la vista es la del tablero temporal");

  // Alta rápida: cae en bandeja, con el origen de la app; un título que empieza con "-" no pasa por flag.
  const uno = await cli.agregar("Probar el tablero desde Trama", null);
  const dos = await cli.agregar("--columna=hecho no es una opción", "atlas");
  assert.equal(uno, 1);
  assert.equal(dos, 2);
  let disco = enDisco();
  assert.deepEqual(disco.map((i) => [i.id, i.columna, i.proyecto, i.origen]), [[1, "bandeja", "", "trama"], [2, "bandeja", "atlas", "trama"]]);
  assert.equal(disco[1].titulo, "--columna=hecho no es una opción");

  let v = await fuenteTablero.leer();
  assert.deepEqual(v.columnas.bandeja.map((i) => i.id).sort(), [1, 2]);
  assert.equal(fuenteTablero.guardado(), v);
  assert.ok(v.proyectos.some((p) => p.proyecto === "atlas" && p.abiertos === 1));
  assert.equal(v.aviso, null);

  // Arrastrar a otra columna.
  await fuenteTablero.mover(1, "espera-dueno");
  assert.equal(columnaDe(1), "espera-dueno");
  v = await fuenteTablero.leer();
  assert.deepEqual(v.columnas["espera-dueno"].map((i) => i.id), [1]);
  assert.deepEqual(v.columnas.bandeja.map((i) => i.id), [2]);

  // Cerrar: pasa a hecho y aparece en lo hecho de estos días.
  await fuenteTablero.cerrar(1);
  assert.equal(columnaDe(1), "hecho");
  v = await fuenteTablero.leer();
  assert.deepEqual(v.hecho.map((i) => i.id), [1]);
  assert.ok(v.hecho[0].cerrado);
  assert.deepEqual(v.columnas["espera-dueno"], []);

  // De hecho a una columna abierta: se reabre.
  await fuenteTablero.mover(1, "sigue");
  assert.equal(columnaDe(1), "sigue");
  v = await fuenteTablero.leer();
  assert.deepEqual(v.hecho, []);
  assert.deepEqual(v.columnas.sigue.map((i) => i.id), [1]);

  // Posponer: sale de la vista y cuenta como pospuesto.
  await fuenteTablero.posponer(1, "+3d");
  assert.ok(enDisco().find((i) => i.id === 1)?.hasta);
  v = await fuenteTablero.leer();
  assert.deepEqual(v.columnas.sigue, []);
  assert.equal(v.pospuestos, 1);

  // Tirar: no se muestra más.
  await fuenteTablero.tirar(2);
  assert.equal(columnaDe(2), "tirado");
  v = await fuenteTablero.leer();
  assert.equal(ABIERTAS.reduce((s, k) => s + v.columnas[k].length, 0), 0);
  assert.deepEqual(v.hecho, []);
});

test("despostergar: un pospuesto sale en la lista con su día y `ya` lo trae de vuelta a su columna", { skip: !hayCli }, async () => {
  const id = (await cli.agregar("Una cosa para más adelante", "atlas")) as number;
  const antes = (await fuenteTablero.leer()).pospuestos;
  await fuenteTablero.mover(id, "sigue");
  await fuenteTablero.posponer(id, "+3d");
  let v = await fuenteTablero.leer();
  assert.deepEqual(v.columnas.sigue, []);
  assert.equal(v.pospuestos, antes + 1);
  const suyo = v.pospuestosLista.find((i) => i.id === id);
  assert.deepEqual(suyo && [suyo.columna, suyo.proyecto], ["sigue", "atlas"]);
  assert.match(suyo?.hasta ?? "", /^\d{4}-\d{2}-\d{2}$/);
  // Traerlo de vuelta: el mismo canal de posponer, con `ya`.
  await fuenteTablero.posponer(id, "ya");
  assert.equal(enDisco().find((i) => i.id === id)?.hasta ?? null, null);
  v = await fuenteTablero.leer();
  assert.deepEqual(v.columnas.sigue.map((i) => i.id), [id]);
  assert.equal(v.pospuestos, antes);
  assert.ok(!v.pospuestosLista.some((i) => i.id === id));
  await fuenteTablero.tirar(id);
});

test("los proyectos retirados del registry llegan al final de la lista, sin días", { skip: !hayCli }, async () => {
  writeFileSync(
    process.env.PROYECTOS_REGISTRY!,
    JSON.stringify({ projects: [{ name: "vivo", path: TMP, estado: "activo" }, { name: "apagado", path: path.join(TMP, "x"), estado: "retirado" }] }),
  );
  const v = await fuenteTablero.leer();
  const ap = v.proyectos.find((p) => p.proyecto === "apagado");
  assert.deepEqual(ap && [ap.etapa, ap.dias], ["retirado", null]);
  assert.ok(retirado(ap!));
  const { activos, retirados } = filasProyectos(v, true);
  assert.ok(retirados.some((p) => p.proyecto === "apagado") && !activos.some((p) => p.proyecto === "apagado"));
  assert.ok(!nombres(v).includes("apagado"));
});

test("lo que el CLI rechaza llega con lo que dijo; lo mal pedido ni sale", { skip: !hayCli }, async () => {
  await assert.rejects(fuenteTablero.mover(999, "sigue"), /no hay item 999/);
  await assert.rejects(fuenteTablero.posponer(1, "pronto"), { message: t("main.tableroHastaRaro", { v: "pronto" }) });
  await assert.rejects(fuenteTablero.agregar("   ", null), { message: t("main.tableroTextoVacio") });
});

test("un item cargado por afuera (la voz) avisa solo: sin polling", { skip: !hayCli }, async () => {
  let soltar = () => {};
  const aviso = new Promise<boolean>((ok) => {
    soltar = fuenteTablero.alCambiar(() => ok(true));
    setTimeout(() => ok(false), 5000).unref();
  });
  tablero("agregar", "Cargado por voz");
  assert.equal(await aviso, true);
  soltar();
  const v = await fuenteTablero.leer();
  assert.ok(v.columnas.bandeja.some((i) => i.titulo === "Cargado por voz"));
  // Y lo que escribió quedó en el tablero temporal, no en el real.
  assert.ok(readFileSync(path.join(TMP, "tablero", "items.jsonl"), "utf8").includes("Cargado por voz"));
});

test("responder: el CLI guarda la respuesta en el item sin cerrarlo ni moverlo; la app la lee y la cuenta aparte; --borrar la saca", { skip: !hayCli }, async () => {
  const q = Number(tablero("agregar", "--columna", "espera-dueno", "--tipo", "pregunta", "--simple", "¿Archivo o base?", "--contexto", "ctx", "--opcion", "Un archivo", "--opcion", "Una base", "--defecto", "1", "--proyecto", "atlas", "--origen", "trama", "Decidir").trim().split("\n").at(-1));
  const u = Number(tablero("agregar", "--columna", "espera-dueno", "--tipo", "prueba", "--prueba", "npm test", "--proyecto", "atlas", "--origen", "trama", "Que pasen").trim().split("\n").at(-1));
  const esperan = async () => (await cli.contarEsperan()) as number;
  const antes = await esperan();

  await fuenteTablero.responder(q, { tipo: "pregunta", opcion: "b" });
  await fuenteTablero.responder(u, { tipo: "prueba", anda: false, nota: "falla el 3" });
  assert.equal(columnaDe(q), "espera-dueno");
  assert.equal(columnaDe(u), "espera-dueno");
  const v = await fuenteTablero.leer();
  const pq = v.columnas["espera-dueno"].find((i) => i.id === q)!;
  const pu = v.columnas["espera-dueno"].find((i) => i.id === u)!;
  assert.equal(pq.tipo, "pregunta");
  assert.deepEqual(pq.opciones.map((o) => o.id), ["a", "b"]);
  assert.equal(pq.porDefecto, "a");
  assert.equal(pq.respuesta?.opcion, "b");
  assert.equal(pq.respuesta?.opcionTexto, "Una base");
  assert.equal(pu.respuesta?.anda, false);
  assert.equal(pu.respuesta?.texto, "falla el 3");
  // Con respuesta ya no esperan; el número del pie baja de a dos.
  assert.equal(await esperan(), antes - 2);

  // Texto libre en una pregunta, y volver a contestar.
  await fuenteTablero.responder(q, { tipo: "pregunta", texto: "ninguna de las dos" });
  assert.equal((await fuenteTablero.leer()).columnas["espera-dueno"].find((i) => i.id === q)!.respuesta?.texto, "ninguna de las dos");
  await fuenteTablero.responder(q, null);
  assert.equal((await fuenteTablero.leer()).columnas["espera-dueno"].find((i) => i.id === q)!.respuesta, null);
  assert.equal(await esperan(), antes - 1);
  await assert.rejects(fuenteTablero.responder(q, { tipo: "pregunta", opcion: "z" }), /./);
});
