// src/hilo/worker-datos.ts: lo que la vista de worker saca de los pasos (frases, grupos, tira, cambios, rutas, resumen, tests, diff).
// Puro; los módulos de src/ se importan sin extensión.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
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

const D = await import("../src/hilo/worker-datos.ts");
const { pasosFijos, pasosHiloFijos } = await import("../src/datos/pasos-fixture.ts");
const { cambiarIdioma } = await import("../src/i18n/index.ts");
cambiarIdioma("es");

const corto = (t: string) => ({ t, total: t.length, recortado: false });
const T0 = 1_000_000;
let n = 0;
function paso(tipo: string, detalle: object, mas: object = {}) {
  const i = n++;
  return { n: i, v: i + 1, id: `p${i}`, tipo, titulo: "", t: T0 + i * 1000, dur: 1000, estado: "ok", error: null, detalle, ...mas } as never;
}
const leer = (ruta: string) => paso("leer", { clase: "leer", ruta, desde: 1, lineas: 1, total: 1, imagen: false, texto: corto("x") });
const buscar = (patron: string) => paso("buscar", { clase: "buscar", herramienta: "Grep", patron, ruta: null, resultados: 1, texto: corto("a") });
const correr = (cmd: string, codigo: number, salida: string, extra: object = {}) =>
  paso("correr", { clase: "correr", comando: corto(cmd), descripcion: null, salida: corto(salida), codigo, interrumpido: false, fondo: false }, extra);

const conDesc = (cmd: string, descripcion: string | null, extra: object = {}, salida = "") =>
  paso("correr", { clase: "correr", comando: corto(cmd), descripcion, salida: corto(salida), codigo: 0, interrumpido: false, fondo: false }, extra);
const pensar = (dur: number, texto?: string) => paso("pensar", texto ? { clase: "pensar", texto: corto(texto) } : { clase: "pensar" }, { dur });
const editar = (ruta: string) => paso("editar", { clase: "editar", ruta, masCambios: 0, mas: 1, menos: 0, cambios: [] });

// ---- Punto 3: los pasos en palabras, nunca el comando cortado --------------------------------------------------------------

test("punto 3: la frase de un comando es su descripción tal cual; sin descripción, una genérica por tipo, nunca el comando", () => {
  assert.equal(D.frasePaso(conDesc("psql -c 'EXPLAIN SELECT 1'", "mide el plan de la consulta")), "Mide el plan de la consulta");
  // La descripción larga va entera: no se corta por largo.
  const larga = "Corre todos los tests de integración contra la base de prueba con la migración nueva ya aplicada";
  assert.equal(D.frasePaso(conDesc("npm test", larga)), larga);
  assert.equal(D.frasePaso(conDesc("npm test", null)), "Corrió los tests");
  assert.equal(D.frasePaso(conDesc("npm test", null, { estado: "corriendo" })), "Corriendo los tests");
  assert.equal(D.frasePaso(conDesc('cd /tmp/x && git commit -m "algo"', null)), "Guardó un commit");
  assert.equal(D.frasePaso(conDesc("git -C /tmp/x commit -m algo", null)), "Guardó un commit");
  const cmd = "cd /tmp/x && FOO=1 npx tsc --noEmit && node scripts/raro.mjs";
  assert.equal(D.frasePaso(conDesc(cmd, null)), "Corrió un comando");
  for (const pedazo of ["npx", "tsc", "cd /tmp", "FOO"]) assert.ok(!D.frasePaso(conDesc(cmd, null)).includes(pedazo));
});

test("punto 3: leer, editar, buscar y lo demás tienen su frase, en pasado o en curso", () => {
  assert.equal(D.frasePaso(leer("src/hilo/Vista.tsx")), "Leyó Vista.tsx");
  assert.equal(D.frasePaso(leer("C:\\proy\\src\\a.ts")), "Leyó a.ts");
  assert.equal(D.frasePaso(leer("")), "Leyó un archivo");
  assert.equal(D.frasePaso(editar("src/a.ts")), "Editó a.ts");
  assert.equal(D.frasePaso(buscar("usarCuenta")), "Buscó «usarCuenta»");
  assert.equal(D.frasePaso(buscar("")), "Buscó en el código");
  assert.equal(D.frasePaso(paso("buscar", { clase: "buscar", herramienta: "Glob", patron: "**/*.ts", ruta: null, resultados: 1, texto: null })), "Buscó archivos «**/*.ts»");
  assert.equal(D.frasePaso(paso("otro", { clase: "otro" }, { titulo: "TodoWrite" })), "Usó TodoWrite");
  assert.equal(D.frasePaso(paso("delegar", { clase: "delegar", descripcion: "Revisar los tests", agente: "Explore" })), "Delegó «Revisar los tests»");
  assert.equal(D.frasePaso(pensar(48_000)), "Pensó 48 s");
  assert.equal(D.frasePaso(pensar(6000, "conviene un índice")), "Pensó: conviene un índice");
});

test("punto 3: un paso sin terminar de un worker que ya no corre no se dice en gerundio", () => {
  const p = conDesc("npm test", null, { estado: "corriendo", dur: null });
  assert.equal(D.frasePaso(p, true), "Corriendo los tests");
  assert.equal(D.frasePaso(p, false), "Corrió los tests");
});

// ---- Punto 4: los pensamientos -------------------------------------------------------------------------------------------

test("punto 4: un pensamiento lleva fila sólo con texto o con más de 30 s; los demás son el nudo de la fila que sigue", () => {
  assert.equal(D.pensarConFila(pensar(30_000)), false);
  assert.equal(D.pensarConFila(pensar(30_001)), true);
  assert.equal(D.pensarConFila(pensar(2000, "algo")), true);
  const a = pensar(9000);
  const b = pensar(5000);
  const r = leer("a.ts");
  const largo = pensar(48_000);
  const conTexto = pensar(6000, "conviene");
  const c = editar("c.ts");
  const fin = pensar(4000);
  const f = D.filas([a, b, r, largo, conTexto, c, fin]);
  assert.deepEqual(f.map((x) => (x.grupo ? "g" : x.p.n)), [r, largo, conTexto, c].map((p) => (p as { n: number }).n));
  const primera = f[0] as { nudo: { ms: number; ns: number[] } };
  assert.equal(primera.nudo.ms, 14_000);
  assert.deepEqual(primera.nudo.ns, [(a as { n: number }).n, (b as { n: number }).n]);
  assert.equal((f[1] as { nudo: unknown }).nudo, null);
});

// ---- Punto 5: los repetidos agrupados ------------------------------------------------------------------------------------

test("punto 5: las búsquedas y lecturas seguidas se agrupan por tipo; un pensamiento corto no corta el grupo, un fallo sí", () => {
  const f = D.filas([buscar("a"), buscar("b"), pensar(5000), buscar("c"), leer("x"), leer("y"), correr("npm test", 1, "", { estado: "fallo" }), leer("z"), pensar(50_000), leer("w"), leer("v")]);
  assert.deepEqual(f.map((x) => (x.grupo ? `${x.clase}:${x.ps.length}` : x.p.tipo)), ["buscar:3", "leer:2", "correr", "leer", "pensar", "leer:2"]);
  assert.equal(D.fraseGrupo((f[0] as { ps: never[] }).ps, "buscar"), "Buscó en el código · 3 veces");
  assert.equal(D.fraseGrupo((f[1] as { ps: never[] }).ps, "leer"), "Leyó 2 archivos");
});

test("punto 5: si se alternan de a uno, va un solo grupo mezclado que cuenta los dos; uno suelto al lado de un grupo queda suelto", () => {
  const f = D.filas([leer("a"), buscar("x"), leer("b"), buscar("y"), buscar("z")]);
  assert.deepEqual(f.map((x) => (x.grupo ? `${x.clase}:${x.ps.length}` : x.p.tipo)), ["mezcla:3", "buscar:2"]);
  const g = f[0] as { grupo: true; ps: never[]; clase: "mezcla" };
  assert.equal(D.fraseGrupo(g.ps, g.clase), "Buscó 1 vez y leyó 2 archivos");
  assert.deepEqual(D.filas([leer("a"), buscar("x"), buscar("y")]).map((x) => (x.grupo ? x.clase : x.p.tipo)), ["leer", "buscar"]);
  assert.deepEqual(D.cuenta([leer("a"), buscar("x")]), { leer: 1, buscar: 1 });
});

test("punto 5: el mismo comando repetido se agrupa; si uno falla o es un commit, no", () => {
  const f = D.filas([conDesc("npm test", "Corre los tests"), conDesc("npm test", "Corre los tests"), conDesc("npm test", "Corre los tests")]);
  assert.equal(f.length, 1);
  const g = f[0] as { ps: never[]; clase: "repetido" };
  assert.equal(g.clase, "repetido");
  assert.equal(D.fraseGrupo(g.ps, g.clase), "Corre los tests · 3 veces");
  assert.equal(D.durGrupo(g.ps), 3000);
  assert.equal(D.filas([conDesc("npm test", null), correr("npm test", 1, "", { estado: "fallo" }), conDesc("npm test", null)]).length, 3);
  assert.equal(D.filas([conDesc("git commit -m a", null), conDesc("git commit -m a", null)]).length, 2);
  assert.equal(D.filas([conDesc("npm test", null), conDesc("npm run build", null)]).length, 2);
});

test("punto 5: un grupo guarda los nudos de adentro para cuando se abre", () => {
  const a = leer("a");
  const p = pensar(3000);
  const b = leer("b");
  const f = D.filas([a, p, b]);
  const g = f[0] as { nudos: Record<number, { ms: number }> };
  assert.equal(g.nudos[(b as { n: number }).n].ms, 3000);
});

// ---- Punto 6: la tira en tiempo real -------------------------------------------------------------------------------------

test("punto 6: cada paso va donde pasó y mide lo que tardó; lo que no fue ningún paso queda como hueco", () => {
  const cero = 1_000_000;
  const ps = [leer("a"), pensar(8000), correr("x", 0, "")].map((p) => p as { t: number; dur: number });
  ps[0].t = cero;
  ps[0].dur = 2000;
  ps[1].t = cero + 12_000; // terminó de pensar acá: pensó de los 4 s a los 12 s.
  ps[2].t = cero + 13_000;
  ps[2].dur = 7000;
  const ts = D.tramos(ps as never, cero, cero + 20_000);
  assert.deepEqual(ts.map((x) => [x.t0, x.seg]), [[0, 2000], [4000, 8000], [13_000, 7000]]);
  assert.ok(ts.every((x) => !x.abierto));
});

test("punto 6: el que sigue corriendo queda abierto hasta el ahora; un paso sin duración llega hasta el siguiente o hasta el fin", () => {
  const vivo = correr("x", 0, "", { estado: "corriendo", dur: null, t: 5000 });
  const [t] = D.tramos([vivo], 0, null);
  assert.deepEqual([t.t0, t.seg, t.abierto], [5000, 0, true]);
  const sin = correr("x", 0, "", { dur: null, t: 0 });
  const sig = correr("y", 0, "", { dur: 1000, t: 4000 });
  assert.equal(D.tramos([sin, sig], 0, 9000)[0].seg, 4000);
  assert.equal(D.tramos([sin], 0, 9000)[0].seg, 9000);
  // Sin hora: se apoya en el anterior.
  const sinHora = correr("z", 0, "", { dur: 500, t: null });
  assert.equal(D.tramos([sig, sinHora], 0, 9000)[1].t0, 5000);
  assert.deepEqual(D.tramos([], 0, null), []);
});

test("punto 6: el cero de la tira es el arranque, salvo que haya pasos que no se muestran", () => {
  const p = correr("x", 0, "", { t: 5000 });
  assert.equal(D.baseTira([p], 1000, 0), 1000);
  assert.equal(D.baseTira([p], 1000, 3), 5000);
  assert.equal(D.baseTira([p], 9000, 0), 5000);
  assert.equal(D.baseTira([], null, 0), null);
});

test("punto 6: la regla pone pocas marcas redondas y no las pega al total; el reloj y la leyenda", () => {
  assert.deepEqual(D.marcasRegla(246_000), [60_000, 120_000, 180_000]);
  assert.deepEqual(D.marcasRegla(958_000), [300_000, 600_000]);
  assert.deepEqual(D.marcasRegla(20_000), []);
  assert.ok(D.marcasRegla(7 * 3_600_000).length <= 6);
  assert.equal(D.marcaCorta(60_000), "1 m");
  assert.equal(D.marcaCorta(5_400_000), "1 h 30 m");
  assert.equal(D.relojDe(38_000), "0:38");
  assert.equal(D.relojDe(760_000), "12:40");
  assert.equal(D.relojDe(3_900_000), "1:05:00");
  assert.deepEqual(D.leyendaDe([buscar("a"), editar("b"), pensar(1)]), ["leer", "editar", "pensar"]);
});

// ---- Punto 7: los cambios ------------------------------------------------------------------------------------------------

test("punto 7: las ediciones, los commits y los errores son cambios; lo demás no", () => {
  assert.ok(D.esCambio(editar("a.ts")));
  assert.ok(D.esCambio(paso("escribir", { clase: "escribir", ruta: "b.ts" })));
  assert.ok(D.esCambio(correr("npm test", 1, "", { estado: "fallo" })));
  assert.ok(D.esCambio(correr("npm test", 2, "")), "un exit distinto de 0 es un fallo");
  assert.ok(D.esCambio(conDesc("git add . && git commit -m x", null, {}, "[rama/x a41f9c2] x\n 1 file changed")));
  assert.ok(!D.esCambio(leer("a.ts")));
  assert.ok(!D.esCambio(conDesc("npm test", null)));
  assert.ok(!D.esCambio(conDesc('echo "git commit"', null)));
  assert.ok(!D.esCambio(pensar(1000)));
});

test("punto 7: el commit trae su hash si git lo imprimió, y uno que falló no es commit", () => {
  assert.deepEqual(D.commitDe(conDesc("git commit -m x", null, {}, "[pa/atlas/rutas a41f9c2] x")), { hash: "a41f9c2" });
  assert.deepEqual(D.commitDe(conDesc("git commit -m x", null, {}, "[main (root-commit) 00ab123] x")), { hash: "00ab123" });
  assert.deepEqual(D.commitDe(conDesc("git commit -m x", null)), { hash: null });
  assert.equal(D.commitDe(correr("git commit -m x", 1, "nothing to commit", { estado: "fallo" })), null);
  assert.equal(D.commitDe(conDesc("git log", null)), null);
});

test("punto 7: «Sólo cambios» deja cada cambio suelto, sin grupos ni nudos", () => {
  const e = editar("a");
  const m = correr("x", 1, "", { estado: "fallo" });
  const f = D.filasCambios([leer("a"), leer("b"), pensar(1000), e, conDesc("ls", null), m]);
  assert.deepEqual(f.map((x) => (x as { p: unknown }).p), [e, m]);
  assert.ok(f.every((x) => !x.grupo && x.nudo === null));
});

// ---- Punto 8: la salida ---------------------------------------------------------------------------------------------------

test("punto 8: un grep se parte por archivo, con rutas de Linux y de Windows y sus líneas", () => {
  const g = D.partirGrep("src/a.ts:12:const x = 1;\nsrc/a.ts:30:const y: number = 2;\nsrc/b.ts:7:hola");
  assert.deepEqual(g, [
    { ruta: "src/a.ts", cuenta: null, lineas: [{ n: 12, texto: "const x = 1;" }, { n: 30, texto: "const y: number = 2;" }] },
    { ruta: "src/b.ts", cuenta: null, lineas: [{ n: 7, texto: "hola" }] },
  ]);
  assert.deepEqual(D.partirGrep("C:\\proy\\src\\a.ts:12:hola")?.[0], { ruta: "C:\\proy\\src\\a.ts", cuenta: null, lineas: [{ n: 12, texto: "hola" }] });
  assert.deepEqual(D.partirGrep("Found 2 files\nsrc/a.ts\nsrc/b.ts")?.map((x) => x.ruta), ["src/a.ts", "src/b.ts"]);
  assert.deepEqual(D.partirGrep("src/a.ts:3\nsrc/b.ts:1")?.map((x) => [x.ruta, x.cuenta]), [["src/a.ts", 3], ["src/b.ts", 1]]);
  assert.deepEqual(D.partirGrep("src/a.ts:12:uno\n--\nsrc/a.ts:30:dos")?.[0].lineas.length, 2);
  assert.equal(D.partirGrep("No files found"), null);
  assert.equal(D.partirGrep("Esto no es un grep\nni esto tampoco\nsrc/a.ts:1:x"), null);
});

test("punto 8: sólo un grep sin tuberías se parte; lo demás queda como salida", () => {
  assert.ok(D.comandoEsGrep('grep -rn "x|y" src/'));
  assert.ok(D.comandoEsGrep("cd /tmp/x && rg foo"));
  assert.ok(!D.comandoEsGrep("grep foo a | wc -l"));
  assert.ok(!D.comandoEsGrep("npm test"));
});

test("punto 8: en cualquier salida, `ruta:línea` se vuelve enlace y el resto queda igual", () => {
  const z = D.trozosConRutas("      at listarRutas (src/db/rutas-repo.ts:52:11)");
  assert.deepEqual(z, [{ t: "      at listarRutas (" }, { t: "src/db/rutas-repo.ts:52:11", ruta: "src/db/rutas-repo.ts", linea: 52 }, { t: ")" }]);
  assert.deepEqual(D.trozosConRutas("nada acá: 12:30 es una hora"), [{ t: "nada acá: 12:30 es una hora" }]);
  assert.deepEqual(D.trozosConRutas("C:\\proy\\a.ts:3:1 falló")[0], { t: "C:\\proy\\a.ts:3:1", ruta: "C:\\proy\\a.ts", linea: 3 });
  assert.equal(D.trozosConRutas("").length, 1);
});

test("punto 8: una ruta relativa se abre desde la carpeta del worker, en Linux y en Windows", () => {
  assert.equal(D.rutaEnCwd("src/a.ts", "/home/usuario/proy"), "/home/usuario/proy/src/a.ts");
  assert.equal(D.rutaEnCwd("./src/a.ts", "/home/usuario/proy/"), "/home/usuario/proy/src/a.ts");
  assert.equal(D.rutaEnCwd("src/a.ts", "C:\\Users\\usuario\\proy"), "C:\\Users\\usuario\\proy\\src\\a.ts");
  assert.equal(D.rutaEnCwd("/etc/x", "/home"), "/etc/x");
  assert.equal(D.rutaEnCwd("C:\\x\\a.ts", "/home"), "C:\\x\\a.ts");
  assert.equal(D.rutaEnCwd("src/a.ts", null), null);
  assert.equal(D.rutaRelativa("/home/usuario/proy/src/a.ts", "/home/usuario/proy"), "src/a.ts");
  assert.equal(D.rutaRelativa("C:\\proy\\src\\a.ts", "C:\\proy"), "src\\a.ts");
  assert.equal(D.rutaRelativa("/home/usuario/proyecto/a.ts", "/home/usuario/proy"), "/home/usuario/proyecto/a.ts");
});

test("punto 8: el tono de cada línea de salida sale de su signo, no sólo del color", () => {
  assert.equal(D.tonoDeLinea("  ✔ pasa (38 ms)"), "ok");
  assert.equal(D.tonoDeLinea("  ✖ no pasa"), "mal");
  assert.equal(D.tonoDeLinea("not ok 1 - algo"), "mal");
  assert.equal(D.tonoDeLinea("    AssertionError [ERR_ASSERTION]: no"), "mal");
  assert.equal(D.tonoDeLinea("exit 1"), "mal");
  assert.equal(D.tonoDeLinea("▶ rutas"), "grupo");
  assert.equal(D.tonoDeLinea("> atlas@2.8.1 test"), "tenue");
  assert.equal(D.tonoDeLinea("ℹ tests 214"), "tenue");
  assert.equal(D.tonoDeLinea("  ⏵ sigue"), "espera");
  assert.equal(D.tonoDeLinea("una línea común"), null);
});

test("punto 8: la salida de la vista no tiene barra horizontal", () => {
  const css = readFileSync(new URL("../src/hilo/worker-logica.css", import.meta.url), "utf8");
  assert.ok(!/white-space:\s*pre\s*;/.test(css.slice(css.indexOf(".wk-term"))), "la salida se ajusta al ancho");
  assert.match(css, /\.wk-cuerpo \{[^}]*overflow-x: hidden/);
  assert.match(css, /\.wk-cuerpo \.df-x \{[^}]*white-space: pre-wrap/);
});

// ---- La corrida de las capturas, entera -------------------------------------------------------------------------------------

test("la corrida de ejemplo: cuenta lo que dice y no muestra comandos en la lista", () => {
  const termino = pasosHiloFijos("w", "termino");
  const ps = D.visibles(termino.pasos);
  const f = D.filas(ps);
  const grupos = f.filter((x) => x.grupo) as { clase: string; ps: unknown[] }[];
  assert.deepEqual(grupos.map((g) => [g.clase, g.ps.length]), [["buscar", 6], ["leer", 4]]);
  assert.deepEqual(ps.filter(D.esCambio).map((p) => p.tipo), ["escribir", "editar", "correr"]);
  assert.equal(D.commitDe(ps.find((p) => D.commitDe(p))!)?.hash, "a41f9c2");
  for (const p of ps) if (p.detalle.clase === "correr") assert.ok(!D.frasePaso(p).includes(p.detalle.comando.t), p.detalle.comando.t);
  assert.equal(D.testsDe(ps)?.n, 214);
  // Sus tiempos cierran: el último tramo llega al final de la corrida.
  const ts = D.tramos(ps, termino.encabezado.inicio!, termino.encabezado.fin);
  assert.ok(Math.max(...ts.map((x) => x.t0 + x.seg)) <= termino.encabezado.dur!);
  const fallo = D.visibles(pasosHiloFijos("w", "fallo").pasos);
  assert.equal(fallo.filter(D.falla).length, 2);
  const vivo = D.visibles(pasosHiloFijos("w", "trabajando").pasos);
  assert.equal(vivo[vivo.length - 1].estado, "corriendo");
  assert.equal(pasosHiloFijos("w", "trabado").encabezado.cwd, "/home/usuario/proy/atlas");
});

test("el resumen: la sección RESULTADO en una o dos frases y los supuestos aparte", () => {
  const r = D.resumenDe("RESULTADO: arreglé la cuenta. Ahora cuenta bien. Tercera frase que sobra. Supuestos: empieza en 1; no toqué los viejos.\nARCHIVOS: a.ts\nSIGUE: nada");
  assert.equal(r.resultado, "Arreglé la cuenta. Ahora cuenta bien.");
  assert.deepEqual(r.supuestos, ["Empieza en 1", "No toqué los viejos"]);
  assert.deepEqual(D.resumenDe(null), { resultado: null, supuestos: [] });
  assert.equal(D.resumenDe("Hice todo.\n\nOtro párrafo.").resultado, "Hice todo.");
  assert.equal(D.resumenDe("RESULTADO: uno\ndos\nDECISION: nada").resultado, "Uno dos");
  // Sin «…»: lo largo llega entero (la vista lo pliega desde 200 caracteres).
  const largo = D.resumenDe(`RESULTADO: ${"palabra ".repeat(100)}.`).resultado!;
  assert.ok(largo.startsWith("Palabra palabra") && largo.length > 320, largo.length);
  assert.ok(!largo.includes("…"));
});

test("lo que pasa de 200 caracteres se pliega", () => {
  assert.equal(D.muyLargo("a".repeat(200)), false);
  assert.equal(D.muyLargo("a".repeat(201)), true);
});

test("ninguna pieza de la vista de worker corta con «…» (el texto va entero o se pliega)", () => {
  const dir = new URL("../src/hilo/", import.meta.url);
  for (const f of ["worker-logica.css", "entero-logica.css"]) assert.ok(!/text-overflow:\s*ellipsis/.test(readFileSync(new URL(f, dir), "utf8")), f);
});

test("el chip de tests: el último corredor que terminó, verde o rojo, con la cuenta si se la lee", () => {
  assert.equal(D.testsDe([leer("a")]), null);
  const rojo = D.testsDe([correr("npm test", 1, "1 fail", { estado: "fallo" })])!;
  assert.equal(rojo.ok, false);
  assert.equal(rojo.n, null);
  const verde = D.testsDe([correr("npm test", 1, "", { estado: "fallo" }), correr("node --test tests/", 0, "# tests 943\n# pass 943\n# fail 0")])!;
  assert.deepEqual([verde.ok, verde.n], [true, 943]);
  assert.equal(D.testsDe([correr("npm test", 0, "", { estado: "corriendo" })]), null);
  assert.equal(D.cuantosTests("Tests: 2 failed, 5 passed, 7 total"), 5);
  assert.equal(D.cuantosTests("22 pass\n0 fail"), 22);
  assert.equal(D.cuantosTests("nada"), null);
  assert.equal(D.testsDe([correr("ls -la", 0, "")]), null);
});

test("el diff pone lo común como contexto y numera desde la línea del cambio", () => {
  const f = D.diffDe({ viejo: corto("a\nb\nc"), nuevo: corto("a\nB\nB2\nc"), todo: false, desde: 10 });
  assert.deepEqual(f.map((x) => x.t), [" ", "-", "+", "+", " "]);
  assert.deepEqual(f.map((x) => x.a), [10, 11, null, null, 12]);
  assert.deepEqual(f.map((x) => x.b), [10, null, 11, 12, 13]);
  const sin = D.diffDe({ viejo: corto("x"), nuevo: corto("y"), todo: false, desde: null });
  assert.deepEqual(sin.map((x) => [x.t, x.a, x.b]), [["-", null, null], ["+", null, null]]);
});

test("el diff de dos textos enormes no se cuelga: cae a sacar todo y poner todo", () => {
  const v = Array.from({ length: 3000 }, (_, i) => `v${i}`).join("\n");
  const w = Array.from({ length: 3000 }, (_, i) => `w${i}`).join("\n");
  const t0 = Date.now();
  const f = D.diffDe({ viejo: corto(v), nuevo: corto(w), todo: false, desde: 1 });
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(f.length, 6000);
});

test("lo leído pierde el cat -n si todas las líneas lo traen y toma su número de la primera", () => {
  const f = D.filasLeidas("     5→uno\n     6→dos", 5);
  assert.deepEqual(f.map((x) => [x.b, x.x]), [[5, "uno"], [6, "dos"]]);
  assert.deepEqual(D.filasLeidas("a\nb", null).map((x) => x.b), [null, null]);
  assert.deepEqual(D.filasEscritas("a\nb\n").map((x) => [x.t, x.b]), [["+", 1], ["+", 2]]);
});

test("con el fixture: el resultado sale del mensaje final y los chips de los archivos tocados", () => {
  const v = pasosFijos("w");
  const r = D.resumenDe(D.textoFinal(v.pasos));
  assert.ok(r.resultado);
  assert.ok(D.testsDe(v.pasos)?.ok);
  assert.deepEqual(D.chipsDe(v.encabezado).map((c) => c.nombre), ["cuenta.ts", "contar.ts"]);
  assert.ok(!D.visibles(v.pasos).some((p) => p.detalle.clase === "texto" && p.detalle.final));
  assert.equal(D.extension("src/a/B.tsx"), "tsx");
  // Rutas de Windows: el nombre es lo último después de la barra invertida, no la ruta entera.
  assert.equal(D.nombreDeArchivo("C:\\Users\\usuario\\Temp\\c4\\t10.py"), "t10.py");
});
