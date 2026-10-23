import { test } from "node:test";
import assert from "node:assert/strict";
import { tableroFijo } from "../src/datos/fixtures-tablero.ts";
import { armarAviso, candidatos, elegirAviso, workerDe, type LiderAviso } from "../src/datos/avisar.ts";
import { armarProyectos, tocadas, vacias } from "../src/datos/pendientes.ts";
import { validar } from "../src/datos/tablero.ts";

const AHORA = Date.UTC(2026, 9, 14, 12, 0, 0);
const atlas = armarProyectos(validar(tableroFijo(AHORA, true)), AHORA).find((p) => p.nombre === "atlas")!;
const q = atlas.preguntas[0];

const lid = (id: string, carpeta: string, actividad: number, extra: Partial<LiderAviso> = {}): LiderAviso => ({
  id,
  nombre: id,
  carpeta,
  origen: "app",
  ocupado: false,
  actividad,
  ...extra,
});
const carpetas = { atlas: "atlas", baliza: "baliza" };
const sinJefe = () => null;

test("sin ningún líder de la carpeta no hay a quién avisar", () => {
  assert.deepEqual(candidatos(q.item, carpetas, [lid("x", "cauce", 5)], sinJefe), []);
  assert.deepEqual(candidatos(q.item, carpetas, [], sinJefe), []);
  assert.equal(elegirAviso([]), null);
});

test("con uno en la carpeta: ese, de la app o de una terminal", () => {
  const t = lid("t", "atlas", 5, { origen: "terminal" });
  assert.deepEqual(candidatos(q.item, carpetas, [t, lid("x", "cauce", 9)], sinJefe).map((l) => l.id), ["t"]);
});

test("con varios: el más reciente primero, y se elige otro por su id", () => {
  const ls = [lid("viejo", "atlas", 1), lid("nuevo", "atlas", 9, { origen: "terminal" }), lid("medio", "atlas", 5)];
  const c = candidatos(q.item, carpetas, ls, sinJefe);
  assert.deepEqual(c.map((l) => l.id), ["nuevo", "medio", "viejo"]);
  assert.equal(elegirAviso(c)?.id, "nuevo");
  assert.equal(elegirAviso(c, "viejo")?.id, "viejo");
  // Un elegido que ya no está (se cerró el líder): vuelve al primero.
  assert.equal(elegirAviso(c, "se-fue")?.id, "nuevo");
});

test("el líder que originó la DECISION (pa:<id> → su jefe) va primero aunque esté en otra carpeta", () => {
  const item = { ...q.item, clave: "pa:20261014-090112-61001" };
  const ls = [lid("de-carpeta", "atlas", 9), lid("jefe", "general", 1)];
  const c = candidatos(item, carpetas, ls, (w) => (w === "20261014-090112-61001" ? "jefe" : null));
  assert.deepEqual(c.map((l) => l.id), ["jefe", "de-carpeta"]);
  // Si el jefe también está en la carpeta no se repite.
  const dos = candidatos(item, carpetas, [lid("jefe", "atlas", 1), lid("otro", "atlas", 9)], () => "jefe");
  assert.deepEqual(dos.map((l) => l.id), ["jefe", "otro"]);
  // Si el jefe ya no está vivo (no figura entre los líderes), quedan los de la carpeta.
  assert.deepEqual(candidatos(item, carpetas, [lid("otro", "atlas", 9)], () => "muerto").map((l) => l.id), ["otro"]);
});

test("las claves de pa: pa:<id>, pa:<id>:<n> y pa:<id>:p<n>", () => {
  assert.equal(workerDe("pa:2026-1"), "2026-1");
  assert.equal(workerDe("pa:2026-1:3"), "2026-1");
  assert.equal(workerDe("pa:2026-1:p2"), "2026-1");
  assert.equal(workerDe("doctor:atlas:x"), null);
  assert.equal(workerDe(""), null);
});

test("las máquinas no se mezclan: un item de otra sólo avisa a los líderes de esa", () => {
  const dell = { ...q.item, maquina: "dell", proyecto: "atlas" };
  const ls = [lid("local", "atlas", 9), lid("dell:abc", "atlas", 1, { maquina: "dell" })];
  assert.deepEqual(candidatos(dell, carpetas, ls, sinJefe).map((l) => l.id), ["dell:abc"]);
  assert.deepEqual(candidatos(q.item, carpetas, ls, sinJefe).map((l) => l.id), ["local"]);
});

test("el aviso es corto: el item, lo que eligió y cómo cerrarlo", () => {
  const r = vacias();
  r.q[q.id] = { op: q.opciones[1].id, otra: "" };
  const [x] = tocadas(atlas, r);
  const m = armarAviso("atlas", x);
  assert.equal(m.split("\n").length, 2);
  assert.match(m, new RegExp(`#${q.id} ${q.titulo.replace(/[?¿]/g, ".")}`));
  assert.ok(m.includes(`→ ${q.opciones[1].texto}`));
  assert.ok(m.includes(`tablero cerrar ${q.id}`));
  // El item de otra máquina se nombra con su número de allá.
  const d = armarAviso("atlas", { ...x, pend: { ...x.pend, id: "dell:12" } });
  assert.ok(d.includes("#12 ") && d.includes("tablero cerrar 12"));
  assert.ok(!d.includes("dell:12"));
});
