import { test } from "node:test";
import assert from "node:assert/strict";
import { crearVigia, verCaidos, verMuertes, vivoEnPa, type Proc } from "../electron/vigia.ts";

const AHORA = 2_000_000_000;
const p = (pid: number): Proc => ({ pid, procStart: String(pid) });

test("vigía: avisa una vez cuando un proceso mirado deja de vivir y lo deja de mirar", async () => {
  const vivos = new Set([1, 2, 3]);
  let avisos = 0;
  const preguntados: number[] = [];
  const v = crearVigia(
    (x) => (preguntados.push(x.pid), vivos.has(x.pid)),
    () => avisos++,
    3_600_000,
  );
  v.mirar([p(1), p(2), p(3)]);
  await v.tic();
  assert.equal(avisos, 0, "todos vivos: nadie relee nada");
  vivos.delete(2);
  vivos.delete(3);
  await v.tic();
  assert.equal(avisos, 1, "dos muertos en la misma vuelta: un solo aviso");
  preguntados.length = 0;
  await v.tic();
  assert.equal(avisos, 1, "el muerto no vuelve a avisar");
  assert.deepEqual(preguntados, [1]);
  v.parar();
});

test("vigía: sin nada que mirar no pregunta ni avisa", async () => {
  let avisos = 0;
  const v = crearVigia(
    () => false,
    () => avisos++,
    3_600_000,
  );
  await v.tic();
  v.mirar([]);
  await v.tic();
  assert.equal(avisos, 0);
  v.parar();
});

test("vigía: si llega otro juego de procesos mientras pregunta, manda el nuevo", async () => {
  let soltar = () => {};
  let avisos = 0;
  const preguntados: number[] = [];
  const v = crearVigia(
    (x) => (preguntados.push(x.pid), x.pid === 1 ? new Promise<boolean>((ok) => (soltar = () => ok(false))) : true),
    () => avisos++,
    3_600_000,
  );
  v.mirar([p(1)]);
  const vuelta = v.tic();
  v.mirar([p(7)]);
  soltar();
  await vuelta;
  assert.equal(avisos, 1);
  preguntados.length = 0;
  await v.tic();
  assert.deepEqual(preguntados, [7]);
  v.parar();
});

test("vivoEnPa: trabajando, trabado o en cola", () => {
  assert.equal(vivoEnPa({ estado: "trabajando", en_cola: false }), true);
  assert.equal(vivoEnPa({ estado: "colgado" }), true);
  assert.equal(vivoEnPa({ estado: "listo", en_cola: true }), true);
  assert.equal(vivoEnPa({ estado: "murio", en_cola: false }), false);
  assert.equal(vivoEnPa({ estado: "integrado" }), false);
});

test("verMuertes: la hora es la de la lectura en que pasó de vivo a murió", () => {
  const antes = new Map([
    ["a", "trabajando"],
    ["b", "colgado"],
    ["c", "listo"],
    ["d", "trabajando"],
  ]);
  const hilos = [
    { id: "a", estado: "murio" },
    { id: "b", estado: "murio" },
    { id: "c", estado: "murio" },
    { id: "d", estado: "trabajando" },
    { id: "e", estado: "murio" },
  ];
  assert.deepEqual(verMuertes(antes, hilos, {}, AHORA), { a: AHORA, b: AHORA });
});

test("verMuertes: lo que la app no vio morir no lleva hora; la primera lectura no inventa ninguna", () => {
  const hilos = [{ id: "a", estado: "murio" }];
  assert.equal(verMuertes(null, hilos, {}, AHORA), null);
  assert.equal(verMuertes(new Map(), hilos, {}, AHORA), null);
  assert.equal(verMuertes(new Map([["a", "murio"]]), hilos, {}, AHORA), null);
});

test("verMuertes: la hora guardada se conserva mientras siga muerto y se suelta cuando ya no", () => {
  const guardadas = { a: AHORA - 500, viejo: AHORA - 9000 };
  assert.deepEqual(verMuertes(null, [{ id: "a", estado: "murio" }], guardadas, AHORA), { a: AHORA - 500 }, "poda lo que ya no está");
  assert.equal(verMuertes(new Map([["a", "murio"]]), [{ id: "a", estado: "murio" }], { a: AHORA - 500 }, AHORA), null, "sin cambios no se escribe");
  assert.deepEqual(verMuertes(null, [{ id: "a", estado: "descartado" }], { a: AHORA - 500 }, AHORA), {}, "quitado: fuera");
});

test("verCaidos: una sesión sin proceso es un líder caído, con la hora en que se lo vio", () => {
  const r = verCaidos([], [{ id: "s1", nombre: "jefe-uno" }], new Set(), AHORA);
  assert.deepEqual(r, { caidos: [{ id: "s1", nombre: "jefe-uno", ts: AHORA }], cambio: true });
  // La sesión sigue ahí (o ya la barrió Claude Code): se lo recuerda igual, sin reescribir.
  assert.deepEqual(verCaidos(r.caidos, [{ id: "s1", nombre: "jefe-uno" }], new Set(), AHORA + 60), { caidos: r.caidos, cambio: false });
  assert.deepEqual(verCaidos(r.caidos, [], new Set(), AHORA + 3600), { caidos: r.caidos, cambio: false });
});

test("verCaidos: guarda dónde vivía y su última actividad (la fila del líder muerto, y retomarlo)", () => {
  const r = verCaidos([], [{ id: "s1", nombre: "jefe-uno", cwd: "/home/ana/Proyectos/atlas", actividad: AHORA - 90 }], new Set(), AHORA);
  assert.deepEqual(r.caidos, [{ id: "s1", nombre: "jefe-uno", ts: AHORA, cwd: "/home/ana/Proyectos/atlas", actividad: AHORA - 90 }]);
});

test("verCaidos: el que volvió a vivir (retomado) deja de estar caído; los viejos no se olvidan", () => {
  const guardados = [
    { id: "s1", nombre: "jefe-uno", ts: AHORA - 100 },
    { id: "s2", nombre: "jefe-dos", ts: AHORA - 90 * 24 * 3600 },
  ];
  // s1 tiene otro proceso vivo aunque su archivo viejo siga sin proceso; s2 sigue por viejo que sea.
  const r = verCaidos(guardados, [{ id: "s1", nombre: "jefe-uno" }], new Set(["s1"]), AHORA);
  assert.deepEqual(r, { caidos: [guardados[1]], cambio: true });
});
