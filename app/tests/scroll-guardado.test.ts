// El punto de cada conversación que vuelve tras un reinicio (src/hilo/scrollGuardado.ts): se anota la distancia
// al final, pegado al final no se anota nada, y lo de la vez anterior se aplica una sola vez.
// Los imports de src/ van sin extensión: un hook de resolución les busca el `.ts` (como tests/fuente.test.ts).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !path.extname(spec) && ctx.parentURL?.includes("/src/")) {
      const dir = path.dirname(fileURLToPath(ctx.parentURL));
      for (const f of [path.join(dir, spec) + ".ts", path.join(dir, spec) + ".tsx"])
        if (existsSync(f)) return next(path.relative(dir, f).replace(/\\/g, "/").replace(/^(?!\.)/, "./"), ctx);
    }
    return next(spec, ctx);
  },
});

const { anotarScroll, faltaLlegar, fotoScrolls, guardarAncla, ponerScrolls, restaurarScroll, retomarScroll, soltarScroll } = await import("../src/hilo/scrollGuardado.ts");
const { alHaberCambios } = await import("../src/hilo/cambios.ts");
const { seguidor } = await import("../src/hilo/seguir.ts");
type Zona = import("../src/hilo/seguir.ts").Zona;

const zona = (scrollTop: number, scrollHeight = 3000, clientHeight = 600): Zona => ({ scrollTop, scrollHeight, clientHeight }) as Zona;

test("se anota lo que falta para el final; al fondo no se anota nada", () => {
  let avisos = 0;
  const soltar = alHaberCambios(() => avisos++);
  anotarScroll("a", zona(1000)); // faltan 3000-600-1000 = 1400
  assert.deepEqual(fotoScrolls(), { a: 1400 });
  anotarScroll("a", zona(1000));
  assert.equal(avisos, 1, "lo mismo no avisa dos veces");
  anotarScroll("a", zona(2400)); // al fondo
  assert.deepEqual(fotoScrolls(), {});
  anotarScroll("b", zona(0, 3000, 0)); // escondida (un panel encima): no mide
  assert.deepEqual(fotoScrolls(), {});
  soltar();
});

test("lo de la vez anterior se aplica una sola vez, y no pisa lo que Ana ya movió", () => {
  ponerScrolls({ c: 900, d: 3, e: "x", f: -4 });
  assert.deepEqual(fotoScrolls(), { c: 900 }, "lo que no se entiende o es 'al fondo' se ignora");
  const z = zona(0, 5000, 600);
  const s = seguidor();
  assert.equal(restaurarScroll(z, s, "c"), true);
  assert.equal(z.scrollTop, 5000 - 600 - 900, "a la misma distancia del final, aunque la conversación creció");
  assert.equal(s.pegado, false);
  assert.equal(restaurarScroll(zona(0), s, "c"), false, "una vez");
  ponerScrolls({ g: 700 });
  anotarScroll("g", zona(100)); // ya tocó esa conversación antes de que llegara lo guardado
  assert.notEqual(fotoScrolls().g, 700);
  assert.equal(restaurarScroll(zona(0), seguidor(), "g"), false);
});

test("escondida al abrir: lo guardado espera a que se vea", () => {
  ponerScrolls({ h: 500 });
  assert.equal(restaurarScroll(zona(0, 3000, 0), seguidor(), "h"), false);
  assert.equal(fotoScrolls().h, 500, "sigue pendiente");
  assert.equal(restaurarScroll(zona(0, 3000, 600), seguidor(), "h"), true);
});

test("se recuerdan 50 conversaciones: la que se tocó hace más tiempo se olvida", () => {
  for (let i = 0; i < 60; i++) anotarScroll(`m${i}`, zona(100));
  const f = fotoScrolls();
  assert.ok(Object.keys(f).filter((k) => k.startsWith("m")).length <= 50);
  assert.ok("m59" in f);
  assert.ok(!("m0" in f));
});

test("al volver a una conversación de esta sesión: subida vuelve a su punto, abajo del todo no se toca", () => {
  anotarScroll("v1", zona(1000)); // faltan 1400
  anotarScroll("v2", zona(2400)); // abajo del todo: no se anota
  retomarScroll("v1");
  retomarScroll("v2");
  const z = zona(0, 4000, 600);
  const s = seguidor();
  assert.equal(restaurarScroll(z, s, "v1"), true);
  assert.equal(z.scrollTop, 4000 - 600 - 1400);
  assert.equal(s.pegado, false);
  assert.equal(restaurarScroll(zona(0), seguidor(), "v2"), false, "abajo del todo: abre al fondo y sigue pegada");
  assert.equal(fotoScrolls().v1, 1400, "y se sigue recordando donde quedó");
});

test("su punto está en páginas que todavía no se cargaron: va al comienzo de lo cargado y sigue hasta llegar", () => {
  anotarScroll("p1", zona(100, 10000, 600)); // faltan 9300
  retomarScroll("p1");
  const z = zona(5000, 3000, 600); // sólo hay 3000 px cargados
  const s = seguidor();
  assert.equal(restaurarScroll(z, s, "p1", true), true);
  assert.equal(z.scrollTop, 0, "al comienzo de lo cargado, que pide la página anterior");
  assert.equal(faltaLlegar("p1"), true);
  anotarScroll("p1", z); // el scroll que provocó él mismo no pisa lo que se busca
  assert.equal(fotoScrolls().p1, 9300);
  const z2 = zona(0, 6000, 600); // llegó otra página y todavía no alcanza
  assert.equal(restaurarScroll(z2, s, "p1", true), true);
  assert.equal(z2.scrollTop, 0);
  const z3 = zona(0, 12000, 600); // ahora sí
  assert.equal(restaurarScroll(z3, s, "p1", true), true);
  assert.equal(z3.scrollTop, 12000 - 600 - 9300);
  assert.equal(faltaLlegar("p1"), false);
  // Sin más páginas que cargar, va al comienzo y listo.
  anotarScroll("p2", zona(100, 10000, 600));
  retomarScroll("p2");
  const z4 = zona(2000, 3000, 600);
  assert.equal(restaurarScroll(z4, s, "p2", false), true);
  assert.equal(z4.scrollTop, 0);
  assert.equal(faltaLlegar("p2"), false);
});

test("si Ana toca la conversación mientras busca su punto, deja de buscar", () => {
  anotarScroll("t1", zona(100, 10000, 600));
  retomarScroll("t1");
  assert.equal(restaurarScroll(zona(0, 3000, 600), seguidor(), "t1", true), true);
  soltarScroll("t1");
  assert.equal(faltaLlegar("t1"), false);
  assert.equal(restaurarScroll(zona(0, 12000, 600), seguidor(), "t1", true), false, "ya no hay nada que aplicar");
});

test("al irse pegado al fondo (aunque algo creciendo abajo lo deje a un renglón) no se anota un punto: vuelve al fondo", () => {
  anotarScroll("w", zona(1000)); // antes lo había dejado más arriba
  assert.equal(fotoScrolls().w, 1400);
  // Hoy lo dejó pegado (el seguidor lo sabe), con 31 px de texto nuevo que todavía no lo arrastraron.
  guardarAncla("w", zona(2369) as unknown as HTMLElement, true);
  assert.equal(fotoScrolls().w, undefined, "no queda un punto a un renglón del final");
  retomarScroll("w");
  assert.equal(fotoScrolls().w, undefined, "y al volver no hay nada que aplicar: va al fondo");
});
