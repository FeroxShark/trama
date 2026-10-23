import { test } from "node:test";
import assert from "node:assert/strict";
import { tableroFijo } from "../src/datos/fixtures-tablero.ts";
import {
  OTRA,
  PARADO_H,
  armarMensaje,
  armarProyectos,
  corto,
  cuenta,
  ordenar,
  podar,
  sumarAlBorrador,
  tocadas,
  totalEsperan,
  vacias,
  type ProyectoPend,
  type Respuestas,
} from "../src/datos/pendientes.ts";
import { validar } from "../src/datos/tablero.ts";

const AHORA = Date.UTC(2026, 9, 14, 12, 0, 0);
const tablero = validar(tableroFijo(AHORA, true));
const proyectos = armarProyectos(tablero, AHORA);
const de = (n: string) => proyectos.find((p) => p.nombre === n)!;
const atlas = de("atlas");

test("espera-dueno se agrupa por proyecto y nunca se mezclan", () => {
  assert.deepEqual(
    proyectos.map((p) => p.nombre).sort(),
    ["atlas", "baliza", "brote", "cauce", "ocaso", "tinta"],
  );
  for (const p of proyectos) for (const x of [...p.preguntas, ...p.pruebas, ...p.mandadas]) assert.equal(x.item.proyecto, p.nombre);
  assert.equal(atlas.preguntas.length, 6);
  assert.equal(atlas.pruebas.length, 3);
});

test("lo que ya tiene respuesta no cuenta en 'te esperan' y va a mandadas", () => {
  assert.deepEqual(atlas.mandadas.map((m) => m.id), [9007]);
  assert.ok(!atlas.preguntas.some((q) => q.id === 9007));
  assert.equal(totalEsperan(proyectos), 6 + 3 + 1 + 2 + 2 + 1 + 2 + 1 + 0);
  assert.equal(de("brote").mandadas.length, 1);
  assert.equal(de("brote").preguntas.length + de("brote").pruebas.length, 0);
});

test("un item viejo (sin palabras simples ni opciones) sale con título y detalle cortos y sólo el campo libre", () => {
  const v = de("cauce").preguntas.find((q) => q.id === 9032)!;
  assert.ok(v.titulo.length <= 111 && v.titulo.endsWith("…"));
  assert.ok(v.contexto.length <= 221 && v.contexto.length > 0);
  assert.deepEqual(v.opciones, []);
  assert.equal(v.porDefecto, null);
});

test("las opciones y la sugerida vienen del item; una prueba no tiene opciones y trae qué probar", () => {
  const q = atlas.preguntas.find((x) => x.id === 9001)!;
  assert.deepEqual(q.opciones.map((o) => o.id), ["a", "b", "c"]);
  assert.equal(q.porDefecto, "a");
  const u = atlas.pruebas.find((x) => x.id === 9011)!;
  assert.deepEqual(u.opciones, []);
  assert.equal(u.que, "npm run dev -- --mapa grande");
});

test("parado = 7 días sin movimiento; los activos van primero por lo que esperan", () => {
  const { activos, parados } = ordenar(proyectos);
  assert.deepEqual(parados.map((p) => p.nombre), ["tinta", "ocaso"]);
  assert.ok(parados.every((p) => p.hace >= PARADO_H));
  assert.equal(activos[0]!.nombre, "atlas");
  assert.ok(activos.every((p) => p.hace < PARADO_H));
  // Un proyecto con sólo mandadas no espera nada: queda último entre los activos.
  assert.equal(activos.at(-1)!.nombre, "brote");
});

test("la sugerida no cuenta hasta que se la toca", () => {
  assert.deepEqual(cuenta(atlas, vacias()), { preguntas: 0, pruebas: 0, total: 0 });
  assert.deepEqual(tocadas(atlas, vacias()), []);
});

test("una 'otra' vacía no cuenta; una prueba cuenta con su resultado", () => {
  const r: Respuestas = vacias();
  r.q[9001] = { op: "a", otra: "" };
  r.q[9002] = { op: OTRA, otra: "  " };
  r.q[9003] = { op: null, otra: "" };
  r.p[9011] = { res: "no-anda", nota: "" };
  assert.deepEqual(cuenta(atlas, r), { preguntas: 1, pruebas: 1, total: 2 });
});

const tocadoAtlas = (): Respuestas => ({
  q: { 9002: { op: "c", otra: "" }, 9004: { op: OTRA, otra: "atlas-mapas, sin la fecha" } },
  p: { 9011: { res: "anda", nota: "" }, 9012: { res: "no-anda", nota: "Importa pero pierde los colores" } },
});

test("tocadas arma lo que se le pasa a tablero responder: la opción por su id, lo libre por su texto", () => {
  const ts = tocadas(atlas, tocadoAtlas());
  assert.deepEqual(
    ts.map((x) => [x.pend.id, x.cli]),
    [
      [9002, { tipo: "pregunta", opcion: "c" }],
      [9004, { tipo: "pregunta", texto: "atlas-mapas, sin la fecha" }],
      [9011, { tipo: "prueba", anda: true }],
      [9012, { tipo: "prueba", anda: false, nota: "Importa pero pierde los colores" }],
    ],
  );
});

test("el mensaje lleva el id de cada item tocado y, al final, la orden de cerrarlos", () => {
  const m = armarMensaje("atlas", tocadas(atlas, tocadoAtlas()));
  assert.match(m, /#9002 .* → Reintentar solo/);
  assert.match(m, /#9004 .* → atlas-mapas, sin la fecha/);
  assert.match(m, /#9011 .*\(npm run dev -- --mapa grande\) → anda\n/);
  assert.match(m, /#9012 .* → NO anda\. Nota: Importa pero pierde los colores/);
  assert.doesNotMatch(m, /#9001|#9003|#9005|#9006|#9013|#9007/);
  const ultima = m.trimEnd().split("\n").at(-1)!;
  assert.match(ultima, /tablero cerrar <id>/);
  assert.match(ultima, /#9002, #9004, #9011, #9012/);
});

test("podar suelta lo que ya no espera (se cerró, ya se mandó) y lo que quedó sin contestar; si no cambia nada, devuelve la misma", () => {
  const r = tocadoAtlas();
  assert.equal(podar(r, proyectos), r);
  const sin = podar({ ...r, q: { ...r.q, 9007: { op: "a", otra: "" }, 777: { op: "x", otra: "" }, 9003: { op: null, otra: "" } } }, proyectos);
  assert.deepEqual(Object.keys(sin.q).sort(), ["9002", "9004"]);
  assert.deepEqual(Object.keys(sin.p).sort(), ["9011", "9012"]);
});

test("mandar a una caja que ya tenía texto suma debajo, sin pisar", () => {
  assert.equal(sumarAlBorrador("", "nuevo"), "nuevo");
  assert.equal(sumarAlBorrador("  \n", "nuevo"), "nuevo");
  assert.equal(sumarAlBorrador("lo mío\n", "nuevo"), "lo mío\n\nnuevo");
});

test("corto corta en borde de palabra y deja una sola línea", () => {
  assert.equal(corto("  una   frase\ncorta ", 50), "una frase corta");
  const c = corto("palabra ".repeat(40), 30);
  assert.ok(c.length <= 31 && c.endsWith("…") && !c.includes("  "));
});

test("un proyecto sin ningún dato de movimiento cuenta como parado", () => {
  const sinDatos: ProyectoPend = { ...atlas, nombre: "x", hace: PARADO_H };
  assert.equal(ordenar([sinDatos]).parados.length, 1);
});
