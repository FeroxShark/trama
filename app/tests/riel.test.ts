// La barra con riel (rediseño 0.4, dirección B): marcas del riel, filtros, "Ver N más", resaltado, tiempos y cupos. Datos inventados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { armarArbol, type Arbol, type Carpeta, type Item, type Rama } from "../src/barra/arbol.ts";
import { aRiel, atencionCarpeta, carpetaViva, enMarcha, filtrarArbol, hilosArbol, hilosCarpeta, itemsRiel, ordenAtencion, partirResalte, QUIETOS_VISTA, quietosDe, segunLista } from "../src/barra/riel-logica.ts";
import { bloquesMotores, cuentasClaude, lineasCuentas, nivelCupo, vueltaDe } from "../src/barra/cupos-riel-logica.ts";
import { PALETA_RIEL, tonoRiel } from "../src/barra/logo-logica.ts";
import { pintorHace } from "../src/tiempo.ts";
import { cambiarIdioma } from "../src/i18n/index.ts";
import type { Estado, Hilo, Lider } from "../src/datos/contrato.ts";
import type { FilaSusc } from "../src/datos/cuentas.ts";

const AHORA = 2_000_000_000;
let n = 0;

const hilo = (p: Partial<Hilo> & { proyecto: string; estado: Estado }): Hilo => ({
  id: `20261003-100000-${10000 + n++}`,
  tarea: "Tarea inventada",
  modelo: "claude-opus-5-5",
  effort: "medium",
  origen: "jefe",
  jefe: null,
  jefe_id: null,
  sigue_de: null,
  en_cola: false,
  inicio: AHORA - 600,
  duracion_s: p.estado === "trabajando" ? null : 300,
  puesto: "1",
  rama: null,
  commits: 0,
  decision: null,
  decision_nada: null,
  resultado: null,
  archivado: null,
  leer: false,
  cache_ttl_s: null,
  cache_vence: null,
  cache_frio: null,
  cache_modelo: null,
  ...p,
});

const lider = (id: string, proyecto: string, extra: Partial<Lider> = {}): Lider => ({
  id,
  nombre: `lider-${id}`,
  proyecto,
  titulo: "",
  actividad: AHORA - 60,
  creado: AHORA - 3600,
  cache_ttl_s: 3600,
  cache_vence: AHORA + 1800,
  origen: "app",
  pid: 4242,
  vivo: true,
  ocupado: false,
  modelo: "claude-opus-5-5",
  effort: "high",
  ...extra,
});

const item = (h: Hilo): Item => ({ h, estado: h.estado }) as Item;
const rama = (clave: string, l: Lider | null, vivas: Item[] = [], viejas: Item[] = []): Rama => ({ clave, tipo: l ? "lider" : "sueltas", lider: l, vivas, viejas }) as Rama;
const carpeta = (proyecto: string, ramas: Rama[], espera: Rama[] = [], dormidos: Rama[] = []): Carpeta => ({ proyecto, ramas, espera, dormidos, cuenta: ramas.length }) as Carpeta;
const arbol = (carpetas: Carpeta[], cerrados: Item[] = []): Arbol => ({ activas: [], carpetas, cerrados, lideres: new Map(), aCargo: new Set() }) as unknown as Arbol;

test("aRiel: lo que falló o pide algo no se pliega bajo su líder; lo terminado sigue plegado", () => {
  const fallo = item(hilo({ proyecto: "atlas", estado: "murio" }));
  const listo = item(hilo({ proyecto: "atlas", estado: "listo" }));
  const a = aRiel(arbol([carpeta("atlas", [rama("l", lider("l", "atlas"), [], [fallo, listo])])]));
  const r = a.carpetas[0].ramas[0];
  assert.deepEqual(r.vivas.map((x) => x.h.id), [fallo.h.id]);
  assert.deepEqual(r.viejas.map((x) => x.h.id), [listo.h.id]);
});

test("aRiel: lo ya resuelto se queda plegado", () => {
  const fallo = item(hilo({ proyecto: "atlas", estado: "murio" }));
  const a = aRiel(arbol([carpeta("atlas", [rama("l", lider("l", "atlas"), [], [fallo])])]), new Set([fallo.h.id]));
  assert.equal(a.carpetas[0].ramas[0].vivas.length, 0);
});

test("atencionCarpeta: falló gana a pide; un líder que espera pide; nada, null", () => {
  const fallo = item(hilo({ proyecto: "p", estado: "murio" }));
  const pide = item(hilo({ proyecto: "p", estado: "decision" }));
  assert.equal(atencionCarpeta(carpeta("p", [rama("a", null, [pide, fallo])])), "fallo");
  assert.equal(atencionCarpeta(carpeta("p", [rama("a", null, [pide])])), "decision");
  assert.equal(atencionCarpeta(carpeta("p", [rama("a", lider("a", "p", { espera: { motivo: "listo", desde: AHORA } } as Partial<Lider>))])), "decision");
  assert.equal(atencionCarpeta(carpeta("p", [rama("a", lider("a", "p"))])), null);
});

test("carpetaViva: un líder respondiendo o un worker en marcha", () => {
  assert.equal(carpetaViva(carpeta("p", [rama("a", lider("a", "p", { ocupado: true }))])), true);
  assert.equal(carpetaViva(carpeta("p", [rama("a", null, [item(hilo({ proyecto: "p", estado: "trabajando" }))])])), true);
  assert.equal(carpetaViva(carpeta("p", [rama("a", lider("a", "p"))])), false);
});

test("itemsRiel: buscando se apagan los que no traen resultados, no se van", () => {
  const base = [carpeta("atlas", []), carpeta("cauce", [])];
  assert.deepEqual(itemsRiel(base, null).map((x) => x.apagado), [false, false]);
  const r = itemsRiel(base, new Set(["cauce"]), undefined, ["faro"]);
  assert.deepEqual(r.map((x) => [x.proyecto, x.apagado]), [["atlas", true], ["cauce", false], ["faro", true]]);
});

test("filtrarArbol: por proyecto deja el suyo y sus cerrados", () => {
  const cerrado = item(hilo({ proyecto: "cauce", estado: "archivado" }));
  const otro = item(hilo({ proyecto: "atlas", estado: "archivado" }));
  const a = arbol([carpeta("atlas", []), carpeta("cauce", [])], [cerrado, otro]);
  const f = filtrarArbol(a, { proyecto: "cauce", ver: null });
  assert.deepEqual(f.carpetas.map((c) => c.proyecto), ["cauce"]);
  assert.deepEqual(f.cerrados.map((x) => x.h.id), [cerrado.h.id]);
  assert.equal(filtrarArbol(a, { proyecto: null, ver: null }), a);
});

test("filtrarArbol: por atención deja sólo lo que la pide, y su líder", () => {
  const fallo = item(hilo({ proyecto: "p", estado: "murio" }));
  const corre = item(hilo({ proyecto: "p", estado: "trabajando" }));
  const a = arbol([carpeta("p", [rama("a", lider("a", "p"), [corre, fallo])]), carpeta("q", [rama("b", lider("b", "q"), [corre])])]);
  const f = filtrarArbol(a, { proyecto: null, ver: "fallo" });
  assert.deepEqual(f.carpetas.map((c) => c.proyecto), ["p"]);
  assert.deepEqual(f.carpetas[0].ramas[0].vivas.map((x) => x.h.id), [fallo.h.id]);
  assert.equal(f.cerrados.length, 0);
  // Un líder que espera vale por "decision" aunque no traiga workers que la pidan.
  const b = arbol([carpeta("p", [rama("a", lider("a", "p", { espera: { motivo: "listo", desde: AHORA } } as Partial<Lider>))])]);
  assert.equal(filtrarArbol(b, { proyecto: null, ver: "decision" }).carpetas.length, 1);
  assert.equal(filtrarArbol(b, { proyecto: null, ver: "fallo" }).carpetas.length, 0);
});

test("hilos: cuenta líderes y workers, plegados o no", () => {
  const c = carpeta("p", [rama("a", lider("a", "p"), [item(hilo({ proyecto: "p", estado: "trabajando" }))], [item(hilo({ proyecto: "p", estado: "listo" }))])], [rama("b", lider("b", "p"))]);
  assert.equal(hilosCarpeta(c), 4);
  assert.equal(hilosArbol(arbol([c, carpeta("q", [])])), 4);
});

test("quietosDe: de a dos y el resto detrás de Ver N más", () => {
  const quietos = ["a", "b", "c", "d"].map((k) => rama(k, lider(k, "p")));
  const c = carpeta("p", [], quietos.slice(0, 3), quietos.slice(3));
  const plegado = quietosDe(c, false);
  assert.equal(plegado.ver.length, QUIETOS_VISTA);
  assert.equal(plegado.resto, 2);
  assert.deepEqual(plegado.ver.map((x) => x.tipo), ["espera", "espera"]);
  const abierto = quietosDe(c, true);
  assert.equal(abierto.resto, 0);
  assert.deepEqual(abierto.ver.map((x) => x.tipo), ["espera", "espera", "espera", "dormidos"]);
});

test("ordenAtencion y segunLista: lo que pide atención primero; lo nuevo, al final como venía", () => {
  const nada = carpeta("nada", []);
  const pide = carpeta("pide", [rama("a", null, [item(hilo({ proyecto: "pide", estado: "decision" }))])]);
  const lista = ordenAtencion([nada, pide]);
  assert.deepEqual(lista, ["pide", "nada"]);
  const nueva = carpeta("nueva", []);
  assert.deepEqual(segunLista([nueva, nada, pide], lista).map((c) => c.proyecto), ["pide", "nada", "nueva"]);
});

test("partirResalte: sin mayúsculas ni tildes, y varias veces", () => {
  assert.deepEqual(partirResalte("Sin nada", ""), [{ t: "Sin nada", m: false }]);
  assert.deepEqual(partirResalte("Medios de PÁGO", "pago"), [
    { t: "Medios de ", m: false },
    { t: "PÁGO", m: true },
  ]);
  assert.deepEqual(partirResalte("pago, repago", "pago").filter((x) => x.m).map((x) => x.t), ["pago", "pago"]);
  assert.deepEqual(partirResalte("Nada de eso", "pago"), [{ t: "Nada de eso", m: false }]);
});

test("armarArbol sinActivas: los líderes calientes se quedan en su carpeta, sin grupo aparte", () => {
  const l = lider("l", "atlas", { ocupado: true });
  const a = armarArbol([], { lideres: [l], prioridad: { lideres: new Map([["l", 0]]), carpetas: new Set(["atlas"]) }, sinActivas: true, ahora: AHORA } as unknown as Parameters<typeof armarArbol>[1]);
  assert.equal(a.activas.length, 0);
  assert.ok(a.carpetas.some((c) => c.ramas.some((r) => r.lider?.id === "l")));
});

test("pintorHace: la columna del tiempo dice hace cuánto, y desde la semana la fecha", () => {
  cambiarIdioma("es");
  const t = (d: number) => pintorHace(AHORA - d)(AHORA).texto;
  assert.equal(t(10), "hace <1 m");
  assert.equal(t(4 * 60), "hace 4 m");
  assert.equal(t(3 * 3600), "hace 3 h");
  assert.equal(t(30 * 3600), "ayer");
  assert.equal(t(4 * 86400), "hace 4 d");
  assert.doesNotMatch(t(9 * 86400), /hace/);
  cambiarIdioma("en");
  assert.equal(t(30 * 3600), "yesterday");
  cambiarIdioma("es");
});

test("tonoRiel: siempre el mismo tono para un nombre, de la paleta", () => {
  assert.equal(tonoRiel("Atlas"), tonoRiel("atlas"));
  assert.ok((PALETA_RIEL as readonly string[]).includes(tonoRiel("cauce")));
});

const fila = (id: string, proveedor: string, extra: Partial<FilaSusc["s"]> = {}, corto = id): FilaSusc => ({ s: { id, nombre: id, proveedor, cuenta: id, ts: AHORA, ...extra }, nombre: id, corto, proveedor, primera: true, cuenta: true });

test("cuentasClaude: la que está en uso primero; sin preferida, la de siempre", () => {
  const uso = { ts: AHORA, five_hour: { pct: 42, resets_at: AHORA + 60 }, seven_day: { pct: 81, resets_at: AHORA + 600 } };
  const otra = fila("trabajo", "claude", { ventanas: [{ id: "5h", etiqueta: "5 h", pct: 5, vuelve: AHORA + 100 }, { id: "7d", etiqueta: "semana", pct: 40, vuelve: AHORA + 900 }] } as unknown as Partial<FilaSusc["s"]>, "Trabajo");
  const sin = cuentasClaude(uso, [otra], "Personal", null);
  assert.deepEqual(sin.map((c) => [c.nombre, c.enUso]), [["Personal", true], ["Trabajo", false]]);
  assert.equal(sin[0].h5.pct, 42);
  const lista = { version: 1, cuentas: [{ id: "trabajo", proveedor: "claude", preferida: true }] } as unknown as Parameters<typeof cuentasClaude>[3];
  assert.equal(cuentasClaude(uso, [otra], "Personal", lista)[0].nombre, "Trabajo");
});

test("lineasCuentas: las otras, con lo más lleno; lo agotado dice cuándo vuelve", () => {
  const base = { ts: AHORA, id: "x" };
  const ls = lineasCuentas([
    { ...base, id: "a", nombre: "Personal", enUso: true, h5: { pct: 1, hasta: 0 }, sem: { pct: 1, hasta: 0 } },
    { ...base, id: "b", nombre: "Trabajo", enUso: false, h5: { pct: 5, hasta: 0 }, sem: { pct: 40, hasta: 0 } },
    { ...base, id: "c", nombre: "Estudio", enUso: false, h5: { pct: 100, hasta: AHORA + 60 }, sem: { pct: 58, hasta: 0 } },
    { ...base, id: "d", nombre: "Nueva", enUso: false, h5: { pct: null, hasta: 0 }, sem: { pct: null, hasta: 0 } },
  ]);
  assert.deepEqual(ls.map((l) => [l.nombre, l.pct, l.estado]), [["Trabajo", 40, "ok"], ["Estudio", 100, "lleno"], ["Nueva", null, "sin"]]);
  assert.equal(ls[1].vuelve, AHORA + 60);
  assert.deepEqual(ls[0].cuenta, { proveedor: "claude", id: "b" });
});

test("bloquesMotores: sin Claude, un bloque por suscripción y una línea por cuenta sin grupos", () => {
  const bs = bloquesMotores([fila("trabajo", "claude"), fila("sub-x", "chatgpt", { ventanas: [] }, "ChatGPT")], AHORA);
  assert.deepEqual(bs.map((b) => [b.proveedor, b.titulo, b.lineas.map((l) => l.nombre)]), [["chatgpt", "sub-x", ["ChatGPT"]]]);
  assert.deepEqual(bs[0].lineas[0].cuenta, { proveedor: "chatgpt", id: "sub-x" });
});

test("bloquesMotores: Google agrupa sus modelos; «Claude y GPT por Google» agotado vuelve y los demás dicen cuándo vuelven", () => {
  cambiarIdioma("es");
  const google = fila("google", "google", {
    grupos: [
      { id: "gemini", nombre: "Gemini", ventanas: [{ id: "5h", pct: 6, vuelve: AHORA + 600 }, { id: "7d", pct: 5, vuelve: AHORA + 9000 }] },
      { id: "claude-gpt", nombre: "x", ventanas: [{ id: "5h", pct: 0, vuelve: null, deshabilitada: true }, { id: "7d", pct: 100, vuelve: AHORA + 7200 }] },
      { id: "gemini-4-argon", nombre: "x", ventanas: [{ id: "7d", pct: 0, vuelve: AHORA + 9000 }] },
    ],
  });
  const [b] = bloquesMotores([{ ...google, nombre: "Google AI Pro" }], AHORA);
  assert.equal(b.titulo, "Google AI Pro");
  assert.deepEqual(b.lineas.map((l) => l.nombre), ["Gemini", "Claude y GPT por Google", "Argon"]);
  assert.deepEqual(b.lineas.map((l) => l.estado), ["ok", "lleno", "ok"]);
  assert.equal(b.lineas[1].vuelve, AHORA + 7200);
  // Cuándo vuelve: lo de la ventana más usada; con 0 % usado no se dice nada.
  assert.equal(b.lineas[0].cuando, AHORA + 600);
  assert.equal(b.lineas[2].cuando, null);
});

test("bloquesMotores: los gratis de OpenCode (pedidos sin tope) son «gratis, sin límite conocido»; con tope, un porcentaje", () => {
  const libre = fila("casa", "opencode", { ventanas: [{ id: "5h", pct: null, vuelve: null, pedidos: 37 }] }, "Casa");
  const go = fila("go", "opencode", { ventanas: [{ id: "5h", pct: 24, vuelve: AHORA + 600, pedidos: 290, tope: 1200 }] }, "Go");
  const [b] = bloquesMotores([libre, go], AHORA);
  assert.equal(b.titulo, "OpenCode");
  assert.equal(b.lineas[0].gratis, true);
  assert.equal(b.lineas[0].pedidos, 37);
  assert.equal(b.lineas[1].gratis, undefined);
  assert.equal(b.lineas[1].pct, 24);
});

test("nivelCupo: ámbar desde 80 %, rojo sólo sin cupo", () => {
  assert.deepEqual([null, 0, 79, 80, 99, 100].map(nivelCupo), [undefined, undefined, undefined, "ambar", "ambar", "rojo"]);
});

test("vueltaDe: la ventana más usada; sin uso o sin hora, nada", () => {
  assert.equal(vueltaDe([{ id: "5h", pct: 10, vuelve: 100 }, { id: "7d", pct: 40, vuelve: 900 }]), 900);
  assert.equal(vueltaDe([{ id: "5h", pct: 0, vuelve: 100 }]), null);
  assert.equal(vueltaDe([{ id: "5h", pct: 30, vuelve: null }]), null);
  assert.equal(vueltaDe([{ id: "5h", pct: 90, vuelve: 100, deshabilitada: true }, { id: "7d", pct: 5, vuelve: 700 }]), 700);
});

test("enMarcha: cuenta líderes que responden y workers corriendo; lo que está en cola, trabado o terminado, no", () => {
  const trab = item(hilo({ proyecto: "atlas", estado: "trabajando" }));
  const cola = item(hilo({ proyecto: "atlas", estado: "trabajando", en_cola: true }));
  const trabado = item(hilo({ proyecto: "atlas", estado: "colgado" }));
  const listo = item(hilo({ proyecto: "atlas", estado: "listo" }));
  const responde = { ...lider("l", "atlas"), ocupado: true };
  assert.equal(enMarcha(carpeta("atlas", [rama("l", responde, [trab, cola, trabado], [listo])])), 2);
  assert.equal(enMarcha(carpeta("atlas", [rama("l", lider("l", "atlas"), [cola], [listo])])), 0);
  assert.equal(enMarcha(carpeta("atlas", [rama("l", { ...responde, caido: "murio" }, [])])), 0);
});

test("retirados: el riel no tiene entrada del retirado con reemplazo, y filtrar por el reemplazo trae también sus cerrados", () => {
  const reemplazos = new Map([["hilos", "trama"]]);
  const viejo = hilo({ proyecto: "hilos", estado: "trabajando", origen: "app" });
  const cerrado = hilo({ proyecto: "hilos", estado: "integrado", origen: "app" });
  const a = armarArbol([viejo, cerrado], { lideres: [], reemplazos, ahora: AHORA });
  assert.deepEqual(itemsRiel(a.carpetas, null).map((x) => x.proyecto), ["trama"]);
  assert.equal(filtrarArbol(a, { proyecto: "trama", ver: null }).cerrados.length, a.cerrados.length);
  assert.equal(filtrarArbol(a, { proyecto: "trama", ver: null }).cerrados.length, 1);
});
