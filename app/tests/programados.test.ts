// Mensajes programados y conversaciones pospuestas (electron/programados.ts): persisten en disco, sobreviven a un reinicio,
// salen por la cola del líder a su hora y no se repiten. Reloj y timer de mentira: ningún test espera por reloj.
import assert from "node:assert/strict";
import { test } from "node:test";
import { crearProgramados, leerFoto, MENSAJES_MAX, REVISAR_MS, type Aviso, type Programado } from "../electron/programados.ts";
import { RAPIDOS, resolverCuando } from "../electron/programados-hora.ts";

const MIN = 60_000;
const T0 = new Date(2026, 10, 1, 10, 0, 0, 0).getTime(); // 1/11/2026 10:00 hora local

/** Un disco, un reloj y un timer de mentira; `abrir()` es abrir la app de nuevo sobre el mismo disco. */
function mundo(opc: { falla?: (m: Programado) => boolean } = {}) {
  const w = { json: null as string | null, t: T0, enviados: [] as Programado[], avisos: [] as Aviso[], timers: [] as { ms: number; fn: () => void; vivo: boolean }[] };
  const abrir = () =>
    crearProgramados({
      leer: async () => w.json,
      escribir: async (j) => void (w.json = j),
      ahora: () => w.t,
      poner: (ms, fn) => {
        const t = { ms, fn, vivo: true };
        w.timers.push(t);
        return t;
      },
      cancelar: (t) => void ((t as { vivo: boolean }).vivo = false),
      encolar: async (m) => {
        if (opc.falla?.(m)) throw new Error("no arranca");
        w.enviados.push(m);
      },
      avisar: (a) => void w.avisos.push(a),
    });
  /** El timer vivo y disparado (como si se cumpliera su espera). */
  const disparar = async (p: ReturnType<typeof abrir>) => {
    const t = w.timers.filter((x) => x.vivo).at(-1);
    assert.ok(t, "hay un timer armado");
    t.vivo = false;
    t.fn();
    await p.vencer();
  };
  return { w, abrir, disparar };
}

const pedido = (cuando: number, texto = "seguí con el paso 2") => ({ sid: "sid-a", texto, cuando, modelo: "modelo-x", effort: "med", nombre: "Ana" });

test("un mensaje programado sale a su hora, una sola vez, y deja la lista vacía", async () => {
  const { w, abrir, disparar } = mundo();
  const p = abrir();
  await p.arrancar();
  const m = await p.programar(pedido(T0 + 30 * MIN));
  assert.equal(m.id, 1);
  assert.equal(w.enviados.length, 0);
  // El timer mira cada tanto: a las 10:00 todavía no es hora y se vuelve a armar.
  assert.equal(w.timers.at(-1)!.ms, REVISAR_MS);
  await disparar(p);
  assert.equal(w.enviados.length, 0);
  w.t = T0 + 30 * MIN;
  await disparar(p);
  assert.equal(w.enviados.length, 1);
  assert.equal(w.enviados[0].texto, "seguí con el paso 2");
  assert.equal(w.enviados[0].sid, "sid-a");
  assert.deepEqual((await p.estado()).mensajes, []);
  assert.deepEqual(w.avisos.at(-1)?.salio, { id: 1, sid: "sid-a" });
  assert.equal(w.timers.filter((x) => x.vivo).length, 0, "sin nada pendiente no queda timer");
});

test("sobrevive a un reinicio: lo programado se relee del disco y sale a su hora; lo vencido mientras estaba cerrada sale al arrancar", async () => {
  const { w, abrir, disparar } = mundo();
  const a = abrir();
  await a.arrancar();
  await a.programar(pedido(T0 + 10 * MIN, "uno"));
  await a.programar(pedido(T0 + 120 * MIN, "dos"));
  await a.posponer("sid-b", T0 + 60 * MIN, "Beto");
  a.parar();

  // Trama estuvo cerrada 30 min: "uno" venció y sale al abrir; "dos" y el pospuesto siguen.
  w.t = T0 + 30 * MIN;
  const b = abrir();
  await b.arrancar();
  assert.deepEqual(w.enviados.map((m) => m.texto), ["uno"]);
  const e = await b.estado();
  assert.deepEqual(e.mensajes.map((m) => m.texto), ["dos"]);
  assert.equal(e.pospuestos[0].sid, "sid-b");
  assert.equal(e.pospuestos[0].nombre, "Beto");

  // Otro reinicio: lo que ya salió no vuelve a salir.
  b.parar();
  const c = abrir();
  await c.arrancar();
  assert.deepEqual(w.enviados.map((m) => m.texto), ["uno"]);
  w.t = T0 + 120 * MIN;
  await disparar(c);
  assert.deepEqual(w.enviados.map((m) => m.texto), ["uno", "dos"]);
});

test("posponer: reaparece a su hora con un aviso, y 'volver ya' lo saca sin aviso", async () => {
  const { w, abrir, disparar } = mundo();
  const p = abrir();
  await p.arrancar();
  await p.posponer("sid-a", T0 + 45 * MIN, "Ana");
  await p.posponer("sid-b", T0 + 90 * MIN);
  // Posponer de nuevo cambia la hora y conserva desde cuándo está pospuesta.
  w.t = T0 + 5 * MIN;
  await p.posponer("sid-a", T0 + 50 * MIN, "Ana");
  const e1 = await p.estado();
  assert.equal(e1.pospuestos.length, 2);
  assert.equal(e1.pospuestos.find((x) => x.sid === "sid-a")!.desde, T0);
  await p.despertar("sid-b");
  assert.deepEqual((await p.estado()).pospuestos.map((x) => x.sid), ["sid-a"]);
  assert.equal(w.avisos.some((a) => a.desperto?.sid === "sid-b"), false);
  w.t = T0 + 50 * MIN;
  await disparar(p);
  assert.equal(w.avisos.find((a) => a.desperto)?.desperto?.sid, "sid-a");
  assert.deepEqual((await p.estado()).pospuestos, []);
});

test("un envío que falla queda con su error, no se reintenta solo y se puede reprogramar o sacar", async () => {
  const { w, abrir, disparar } = mundo({ falla: (m) => m.texto === "roto" });
  const p = abrir();
  await p.arrancar();
  await p.programar(pedido(T0 + MIN, "roto"));
  await p.programar(pedido(T0 + 2 * MIN, "sano"));
  w.t = T0 + 5 * MIN;
  await disparar(p);
  assert.deepEqual(w.enviados.map((m) => m.texto), ["sano"]);
  const e = await p.estado();
  assert.equal(e.mensajes.length, 1);
  assert.match(e.mensajes[0].error ?? "", /no arranca/);
  assert.equal(p.proximo(), null, "el que falló no arma el timer");
  // Reprogramado, vuelve a estar en pie sin el error.
  await p.reprogramar(e.mensajes[0].id, T0 + 20 * MIN);
  assert.equal((await p.estado()).mensajes[0].error, undefined);
  await p.quitar(e.mensajes[0].id);
  assert.deepEqual((await p.estado()).mensajes, []);
});

test("se rechaza lo que no sirve: hora pasada, a más de un año, sin texto, demasiados", async () => {
  const { abrir } = mundo();
  const p = abrir();
  await p.arrancar();
  await assert.rejects(p.programar(pedido(T0 - MIN)), /ya pasó/);
  await assert.rejects(p.programar(pedido(T0 + 400 * 24 * 60 * MIN)), /lejos/);
  await assert.rejects(p.programar(pedido(T0 + MIN, "   ")), /inválido/);
  await assert.rejects(p.programar({ ...pedido(T0 + MIN), sid: 7 }), /inválido/);
  await assert.rejects(p.posponer("sid-a", T0 - 1), /inválido/);
  for (let i = 0; i < MENSAJES_MAX; i++) await p.programar(pedido(T0 + MIN + i));
  await assert.rejects(p.programar(pedido(T0 + 5 * MIN)), /demasiados/);
});

test("el archivo roto o de otra versión se lee como vacío, y los ids no se repiten tras un reinicio", async () => {
  assert.deepEqual(leerFoto("{no es json").mensajes, []);
  assert.deepEqual(leerFoto(JSON.stringify({ version: 2, mensajes: [{ id: 1 }] })).mensajes, []);
  const { w, abrir } = mundo();
  const a = abrir();
  await a.arrancar();
  await a.programar(pedido(T0 + MIN));
  const m2 = await a.programar(pedido(T0 + 2 * MIN));
  await a.quitar(m2.id);
  a.parar();
  const b = abrir();
  await b.arrancar();
  const m3 = await b.programar(pedido(T0 + 3 * MIN));
  assert.ok(m3.id > m2.id, "el id nuevo no reutiliza uno que ya se usó");
  assert.ok(w.json);
});

test("resolverCuando entiende duraciones, horas y días en español y en inglés", () => {
  const dur = (s: string) => resolverCuando(s, T0);
  assert.equal(dur("en 30 min"), T0 + 30 * MIN);
  assert.equal(dur("30m"), T0 + 30 * MIN);
  assert.equal(dur("+2h"), T0 + 120 * MIN);
  assert.equal(dur("en 1h30"), T0 + 90 * MIN);
  assert.equal(dur("in 45 minutes"), T0 + 45 * MIN);
  assert.equal(dur("en 2 días"), T0 + 2 * 24 * 60 * MIN);
  assert.equal(dur("en 1 h"), T0 + 60 * MIN);
  // Una hora del día: hoy si falta, si no mañana.
  assert.equal(dur("18:30"), new Date(2026, 10, 1, 18, 30).getTime());
  assert.equal(dur("9:00"), new Date(2026, 10, 2, 9, 0).getTime());
  assert.equal(dur("6pm"), new Date(2026, 10, 1, 18, 0).getTime());
  assert.equal(dur("mañana 9:00"), new Date(2026, 10, 2, 9, 0).getTime());
  assert.equal(dur("tomorrow 8am"), new Date(2026, 10, 2, 8, 0).getTime());
  assert.equal(dur("hoy 23:00"), new Date(2026, 10, 1, 23, 0).getTime());
  assert.equal(dur("2026-11-05 14:15"), new Date(2026, 10, 5, 14, 15).getTime());
  // Lo que no se entiende o ya pasó.
  for (const malo of ["", "pronto", "en 0 min", "25:00", "hoy 9:00", "2026-10-01", "en 99999 d", "30", "13pm"]) assert.equal(dur(malo), null, malo);
  // Las opciones rápidas siempre se entienden.
  for (const r of RAPIDOS) assert.ok(dur(r)! > T0, r);
});
