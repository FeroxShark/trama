// La cola persistente de avisos de workers por líder (electron/avisos-pendientes.ts) con la cola de mensajes real (cola.ts) y la
// detección real (avisos-worker.ts), con un líder y un disco de mentira: nada se pierde si el líder está muerto, si Trama se reinicia
// o si dos workers terminan juntos, y un aviso sólo cuenta como entregado cuando se le mandó de verdad.
import { test } from "node:test";
import assert from "node:assert/strict";
import { crearAvisosWorker, MARCA_AVISO_TRAMA, type AvisoWorker } from "../electron/avisos-worker.ts";
import { crearAvisosPendientes, type FilaHilo } from "../electron/avisos-pendientes.ts";
import { crearCola } from "../electron/cola.ts";

const JEFE = "5a1f0c1d-0000-4000-8000-00000000c01a";
const T0 = 1_800_000_000; // epoch s
const asentar = () => new Promise((r) => setTimeout(r, 8));

type Disco = { cola: string | null; avisos: string | null };
type Lider = { proc: boolean; enTurno: boolean; mandarFalla: boolean };

const fila = (id: string, estado: string, extra: Partial<FilaHilo> = {}): FilaHilo => ({
  id,
  proyecto: "trama",
  estado,
  tarea: `Objetivo: tarea de ${id}`,
  modelo: "claude-a",
  jefe_id: JEFE,
  jefe: "ana",
  ...extra,
});
/** Una fila terminada: arrancó en `ini` (epoch s) y duró `dur`. */
const lista = (id: string, estado: string, ini: number, dur = 60, extra: Partial<FilaHilo> = {}) => fila(id, estado, { inicio: ini, duracion_s: dur, ...extra });

/** Trama arrancando: lo que haya en `disco` se carga, como hace el main. `lider` es el estado (compartido) del líder de mentira. */
function arrancar(disco: Disco, lider: Lider, reloj: { ms: number }, modo: "tanda" | "worker" = "tanda") {
  const e = { filas: [] as FilaHilo[] };
  const mandados: string[] = [];
  // Reloj falso: los temporizadores sólo corren cuando el test hace `pasar`.
  const timers: { en: number; f: () => void; vivo: boolean }[] = [];
  const enTurnos: string[] = [];
  const avisos = crearAvisosPendientes({
    guardar: async (j) => void (disco.avisos = j),
    proceso: (sid) => (lider.proc && sid === JEFE ? { modelo: "claude-a", effort: "alto" } : null),
    puedeEnTurno: (sid) => lider.proc && lider.enTurno && sid === JEFE,
    encolar: (sid, x) => void cola.encolar(sid, x),
    filas: () => e.filas,
    ahora: () => reloj.ms,
    temporizar: (f, ms) => {
      const x = { en: reloj.ms + ms, f, vivo: true };
      timers.push(x);
      return () => void (x.vivo = false);
    },
  });
  const cola = crearCola({
    disponible: async () => (!lider.proc ? "nadie" : lider.enTurno ? "ocupado" : "app"),
    traer: async () => ({ ok: false, motivo: "sinSesion" }),
    mandar: async (_sid, x) => {
      if (lider.mandarFalla) throw new Error("no arrancó");
      mandados.push(x.texto);
      lider.enTurno = true;
    },
    total: async () => 1,
    textoError: (x) => ("motivo" in x ? x.motivo : String((x.error as Error).message)),
    guardar: async (j) => void (disco.cola = j),
    avisar: () => {},
    puedeEnTurno: () => lider.proc && lider.enTurno,
    enTurno: async (_sid, x) => {
      if (lider.mandarFalla) throw new Error("sin canal");
      enTurnos.push(x.texto);
    },
    salida: (sid, claves, que) => avisos.salida(sid, claves, que),
    agrupar: 0,
  });
  avisos.cargar(disco.avisos);
  cola.cargar(disco.cola);
  avisos.reconciliar(avisos.clavesDe(cola.todas()));
  const w = crearAvisosWorker({
    leerRastro: async () => "",
    emitir: () => {},
    registrar: (a: AvisoWorker) => avisos.registrar(a),
    alLider: (a) => {
      avisos.liberar(a);
      avisos.soltarHuerfanos();
      avisos.entregar(a.jefe_id ?? "");
    },
    avisoLider: () => modo,
    ahora: () => reloj.ms,
  });
  return {
    avisos,
    cola,
    mandados,
    enTurnos,
    /** Todo lo que le llegó al líder, de cualquier forma. */
    llegado: () => [...mandados, ...enTurnos],
    /** Una lectura nueva de `pa --hilos`, como la procesa el main. */
    async leer(filas: FilaHilo[]) {
      e.filas = filas;
      await w.hilos(filas);
      await avisos.descubrir(filas);
      avisos.soltarHuerfanos();
      avisos.entregar();
      await asentar();
    },
    /** Corre el reloj `ms` y dispara los temporizadores que se cumplen. */
    async pasar(ms: number) {
      reloj.ms += ms;
      for (const x of timers) if (x.vivo && x.en <= reloj.ms) ((x.vivo = false), x.f());
      await asentar();
    },
    /** Temporizadores de agrupación todavía esperando. */
    esperando: () => timers.filter((x) => x.vivo).length,
    /** El líder cambió (volvió, empezó un turno…): se mira a quién se le puede entregar. */
    async cambio(sid?: string) {
      avisos.entregar(sid);
      await asentar();
    },
    estados: () => Object.fromEntries(avisos.entradas().map((x) => [x.clave, x.estado])),
  };
}
const nuevoDisco = (): Disco => ({ cola: null, avisos: null });

test("líder muerto al terminar el worker: el aviso espera y, al volver, llega un solo resumen (y recién ahí queda entregado)", async () => {
  const disco = nuevoDisco();
  const lider: Lider = { proc: false, enTurno: false, mandarFalla: false };
  const reloj = { ms: (T0 + 1000) * 1000 };
  const t = arrancar(disco, lider, reloj);
  await t.leer([fila("20261030-143122-72903", "trabajando"), fila("20261030-143129-77420", "trabajando")]);
  reloj.ms += 5000;
  await t.leer([lista("20261030-143122-72903", "entregado", T0), fila("20261030-143129-77420", "trabajando")]);
  assert.deepEqual(t.llegado(), [], "sin proceso del líder no se manda nada");
  assert.equal(t.estados()["20261030-143122-72903:fin"], "retenido", "su tanda sigue abierta (el otro corre): anotado en disco, no perdido");
  await t.leer([lista("20261030-143122-72903", "entregado", T0), lista("20261030-143129-77420", "murio", T0, 30)]);
  assert.deepEqual(t.llegado(), []);
  assert.deepEqual(Object.values(t.estados()).sort(), ["pendiente", "pendiente"], "quedan anotados, no perdidos");

  // El líder vuelve (su proceso arranca, ocioso): un único resumen, con los dos.
  lider.proc = true;
  await t.cambio();
  assert.equal(t.llegado().length, 1);
  const texto = t.llegado()[0];
  assert.ok(texto.startsWith(MARCA_AVISO_TRAMA));
  assert.match(texto, /Mientras no estabas terminaron 2 workers/);
  assert.match(texto, /20261030-143122-72903/);
  assert.match(texto, /20261030-143129-77420\): falló/);
  assert.deepEqual(Object.values(t.estados()), ["entregado", "entregado"]);
  await t.cambio();
  assert.equal(t.llegado().length, 1, "no se repite");
});

test("no se marca entregado si el envío falla: queda en la cola con su error y sigue anotado", async () => {
  const disco = nuevoDisco();
  const lider: Lider = { proc: true, enTurno: false, mandarFalla: true };
  const reloj = { ms: (T0 + 1000) * 1000 };
  const t = arrancar(disco, lider, reloj);
  await t.leer([fila("w1", "trabajando")]);
  await t.leer([lista("w1", "murio", T0, 10)]);
  assert.deepEqual(t.llegado(), []);
  assert.equal(t.estados()["w1:falla"], "encolado", "salió de pendiente pero no se confirmó");
  assert.equal(t.cola.lista(JEFE).length, 1, "sigue en la cola de mensajes");
  assert.equal(t.cola.error(JEFE), "no arrancó");
  // Trama se reinicia: el mismo aviso sigue ahí (cola.json y avisos-lider.json); el usuario reintenta y llega.
  const lider2: Lider = { proc: true, enTurno: false, mandarFalla: false };
  const t2 = arrancar(disco, lider2, reloj);
  assert.equal(t2.estados()["w1:falla"], "encolado");
  await t2.cola.ya(JEFE, false);
  await asentar();
  assert.equal(t2.mandados.length, 1);
  assert.equal(t2.estados()["w1:falla"], "entregado");
});

test("lo encolado que se perdió a mitad de camino (no está en la cola al arrancar) vuelve a pendiente y se entrega", async () => {
  const disco = nuevoDisco();
  const lider: Lider = { proc: true, enTurno: true, mandarFalla: false };
  const reloj = { ms: (T0 + 1000) * 1000 };
  const t = arrancar(disco, lider, reloj);
  await t.leer([fila("w1", "trabajando")]);
  // El proceso se cortó justo entre sacarlo de la cola y confirmarlo: el disco dice `encolado` y la cola está vacía.
  const guardado = JSON.parse(disco.avisos as string);
  await t.leer([lista("w1", "decision", T0, 10)]);
  await asentar();
  assert.equal(t.llegado().length, 1);
  const roto = JSON.parse(disco.avisos as string);
  roto.entradas[0].estado = "encolado";
  assert.ok(guardado);
  const disco2: Disco = { cola: JSON.stringify({ version: 1, colas: {} }), avisos: JSON.stringify(roto) };
  const lider2: Lider = { proc: true, enTurno: true, mandarFalla: false };
  const t2 = arrancar(disco2, lider2, reloj);
  assert.equal(t2.estados()["w1:fin"], "pendiente", "reconciliado");
  await t2.cambio();
  assert.equal(t2.llegado().length, 1);
  assert.match(t2.llegado()[0], /Mientras no estabas/);
});

test("Trama reiniciada con el worker corriendo: termina después y el aviso llega al líder cuando vuelve", async () => {
  const disco = nuevoDisco();
  const lider: Lider = { proc: true, enTurno: true, mandarFalla: false };
  const reloj = { ms: (T0 + 100) * 1000 };
  const antes = arrancar(disco, lider, reloj);
  await antes.leer([lista("w1", "trabajando", T0, 0, { duracion_s: null })]);
  // Trama se cierra (y el líder con ella); vuelve con el líder sin proceso.
  lider.proc = false;
  lider.enTurno = false;
  reloj.ms += 60_000;
  const t = arrancar(disco, lider, reloj);
  await t.leer([fila("w1", "trabajando", { inicio: T0, duracion_s: null })]);
  reloj.ms += 60_000;
  await t.leer([lista("w1", "entregado", T0, 150)]);
  assert.deepEqual(t.llegado(), []);
  assert.equal(t.estados()["w1:fin"], "pendiente");
  // Segundo reinicio, con el aviso todavía sin entregar: sigue ahí.
  const t2 = arrancar(disco, lider, reloj);
  assert.equal(t2.estados()["w1:fin"], "pendiente");
  lider.proc = true;
  await t2.cambio();
  assert.equal(t2.llegado().length, 1);
  assert.match(t2.llegado()[0], /w1\): terminó/);
  assert.equal(t2.estados()["w1:fin"], "entregado");
});

test("Trama apagada cuando el worker terminó: al arrancar se descubre y el líder lo recibe en el resumen", async () => {
  const disco = nuevoDisco();
  const lider: Lider = { proc: true, enTurno: true, mandarFalla: false };
  const reloj = { ms: (T0 + 100) * 1000 };
  const antes = arrancar(disco, lider, reloj);
  await antes.leer([fila("w1", "trabajando", { inicio: T0 }), fila("w2", "trabajando", { inicio: T0 })]);
  // Apagada: nadie ve terminar a w1 (listo, sin revisar); w2 lo integraron a mano (revisado) y no cuenta.
  lider.proc = false;
  lider.enTurno = false;
  reloj.ms += 3_600_000;
  const t = arrancar(disco, lider, reloj);
  await t.leer([lista("w1", "listo", T0, 300), lista("w2", "integrado", T0, 300), lista("viejo", "listo", T0 - 99999, 60)]);
  assert.deepEqual(Object.keys(t.estados()), ["w1:fin"], "ni el integrado ni el viejo (anterior a la última vez) cuentan");
  lider.proc = true;
  await t.cambio();
  assert.equal(t.llegado().length, 1);
  assert.match(t.llegado()[0], /w1\)/);
  assert.doesNotMatch(t.llegado()[0], /w2/);
  assert.equal(t.estados()["w1:fin"], "entregado");
});

test("dos workers terminando juntos con el líder a mitad de un turno: un solo mensaje con los dos", async () => {
  const disco = nuevoDisco();
  const lider: Lider = { proc: true, enTurno: true, mandarFalla: false };
  const reloj = { ms: (T0 + 100) * 1000 };
  const t = arrancar(disco, lider, reloj);
  await t.leer([fila("a", "trabajando"), fila("b", "trabajando")]);
  await t.leer([lista("a", "entregado", T0), lista("b", "murio", T0, 30)]);
  assert.equal(t.llegado().length, 1);
  assert.match(t.llegado()[0], /Terminaron los 2 workers/);
  assert.match(t.llegado()[0], /\(a\): terminó/);
  assert.match(t.llegado()[0], /\(b\): falló/);
  assert.deepEqual(Object.values(t.estados()), ["entregado", "entregado"]);
});

test("dos workers terminando juntos con el líder ocioso: una falla sale ya y lleva también el fin; nada queda atrás", async () => {
  const disco = nuevoDisco();
  const lider: Lider = { proc: true, enTurno: false, mandarFalla: false };
  const reloj = { ms: (T0 + 100) * 1000 };
  const t = arrancar(disco, lider, reloj);
  await t.leer([fila("a", "trabajando"), fila("b", "trabajando")]);
  await t.leer([lista("a", "entregado", T0), lista("b", "murio", T0, 30)]);
  assert.equal(t.llegado().length, 1);
  assert.match(t.llegado()[0], /\(a\): terminó/);
  assert.match(t.llegado()[0], /\(b\): falló/);
});

test("un simple 'terminó' con el líder ocioso lo despierta a los 20 s con un turno nuevo, sin esperar al usuario", async () => {
  const disco = nuevoDisco();
  const lider: Lider = { proc: true, enTurno: false, mandarFalla: false };
  const reloj = { ms: (T0 + 100) * 1000 };
  const t = arrancar(disco, lider, reloj);
  await t.leer([fila("a", "trabajando")]);
  await t.leer([lista("a", "entregado", T0)]);
  assert.deepEqual(t.llegado(), [], "todavía se espera por si terminan más");
  assert.equal(t.estados()["a:fin"], "pendiente");
  await t.pasar(19_000);
  assert.deepEqual(t.llegado(), []);
  await t.pasar(1_500);
  assert.equal(t.mandados.length, 1, "turno nuevo (mandar), no a mitad de uno");
  assert.match(t.llegado()[0], /Worker «tarea de a» terminó/);
  assert.equal(t.estados()["a:fin"], "entregado");
  await t.pasar(60_000);
  assert.equal(t.llegado().length, 1, "no se repite");
});

test("ráfaga de 8 workers que terminan con el líder ocioso: un solo mensaje, 20 s después del primero", async () => {
  const disco = nuevoDisco();
  const lider: Lider = { proc: true, enTurno: false, mandarFalla: false };
  const reloj = { ms: (T0 + 100) * 1000 };
  const t = arrancar(disco, lider, reloj);
  const ids = Array.from({ length: 8 }, (_, i) => `w${i}`);
  await t.leer(ids.map((i) => fila(i, "trabajando")));
  // Terminan de a uno, con la tanda abierta hasta el último; el modo "worker" los suelta ni bien terminan.
  const t2 = arrancar(nuevoDisco(), { ...lider }, { ms: reloj.ms }, "worker");
  await t2.leer(ids.map((i) => fila(i, "trabajando")));
  for (let k = 1; k <= 8; k++) {
    await t2.leer(ids.map((i, j) => (j < k ? lista(i, "entregado", T0) : fila(i, "trabajando"))));
    await t2.pasar(2_000);
  }
  assert.deepEqual(t2.llegado(), [], "a los 16 s de terminar el primero todavía se agrupa");
  assert.equal(t2.esperando(), 1, "un solo reloj para el líder");
  await t2.pasar(5_000);
  assert.equal(t2.llegado().length, 1, "uno solo, con los 8");
  assert.match(t2.llegado()[0], /Terminaron los 8 workers/);
  assert.deepEqual(new Set(Object.values(t2.estados())), new Set(["entregado"]));
  // Lo mismo con la tanda: se cierra con el último y también espera sus 20 s.
  for (let k = 1; k <= 8; k++) await t.leer(ids.map((i, j) => (j < k ? lista(i, "entregado", T0) : fila(i, "trabajando"))));
  assert.deepEqual(t.llegado(), []);
  await t.pasar(21_000);
  assert.equal(t.llegado().length, 1);
  assert.match(t.llegado()[0], /Terminaron los 8 workers/);
});

test("el líder empieza un turno antes de los 20 s: sale a mitad de ese turno, una sola vez (sin duplicar con el reloj)", async () => {
  const disco = nuevoDisco();
  const lider: Lider = { proc: true, enTurno: false, mandarFalla: false };
  const reloj = { ms: (T0 + 100) * 1000 };
  const t = arrancar(disco, lider, reloj);
  await t.leer([fila("a", "trabajando")]);
  await t.leer([lista("a", "entregado", T0)]);
  lider.enTurno = true; // el usuario escribió
  await t.cambio(JEFE);
  assert.equal(t.enTurnos.length, 1);
  assert.equal(t.estados()["a:fin"], "entregado");
  assert.equal(t.esperando(), 0, "el reloj se cancela");
  await t.pasar(60_000);
  assert.equal(t.llegado().length, 1);
});

test("worker que termina con el líder en un turno: sale apenas la cola puede, sin esperar los 20 s ni al usuario", async () => {
  const disco = nuevoDisco();
  const lider: Lider = { proc: true, enTurno: true, mandarFalla: false };
  const reloj = { ms: (T0 + 100) * 1000 };
  const t = arrancar(disco, lider, reloj);
  await t.leer([fila("a", "trabajando")]);
  await t.leer([lista("a", "entregado", T0)]);
  assert.equal(t.llegado().length, 1);
  assert.equal(t.esperando(), 0);
});

test("líder muerto a los 20 s: no se manda nada y queda en cola; al retomarlo llega un resumen", async () => {
  const disco = nuevoDisco();
  const lider: Lider = { proc: true, enTurno: false, mandarFalla: false };
  const reloj = { ms: (T0 + 100) * 1000 };
  const t = arrancar(disco, lider, reloj);
  await t.leer([fila("a", "trabajando")]);
  await t.leer([lista("a", "entregado", T0)]);
  lider.proc = false; // lo cerraron mientras esperaba el rato
  await t.pasar(21_000);
  assert.deepEqual(t.llegado(), []);
  assert.equal(t.estados()["a:fin"], "pendiente");
  lider.proc = true;
  await t.cambio();
  assert.equal(t.llegado().length, 1);
  assert.match(t.llegado()[0], /Mientras no estabas terminaron 1 worker/);
  assert.equal(t.estados()["a:fin"], "entregado");
});

test("lo retenido de una tanda que Trama no pudo cerrar sale cuando el líder ya no tiene workers vivos", async () => {
  const disco = nuevoDisco();
  const lider: Lider = { proc: true, enTurno: true, mandarFalla: false };
  const reloj = { ms: (T0 + 100) * 1000 };
  const antes = arrancar(disco, lider, reloj);
  await antes.leer([fila("a", "trabajando"), fila("b", "trabajando")]);
  await antes.leer([lista("a", "entregado", T0), fila("b", "trabajando")]);
  assert.deepEqual(antes.llegado(), [], "la tanda sigue abierta: nada sale todavía");
  assert.equal(antes.estados()["a:fin"], "retenido");
  // Reinicio con b todavía corriendo: la tanda en memoria se perdió, pero a sigue anotado.
  const t = arrancar(disco, lider, reloj);
  assert.equal(t.estados()["a:fin"], "retenido");
  await t.leer([lista("a", "entregado", T0), fila("b", "trabajando")]);
  assert.deepEqual(t.llegado(), []);
  await t.leer([lista("a", "entregado", T0), lista("b", "entregado", T0)]);
  assert.equal(t.llegado().length, 1, "un solo mensaje");
  assert.match(t.llegado()[0], /\(a\): terminó/);
  assert.match(t.llegado()[0], /\(b\): terminó/);
});

test("workers de otro líder o sin líder no se mezclan ni se anotan", async () => {
  const disco = nuevoDisco();
  const lider: Lider = { proc: true, enTurno: true, mandarFalla: false };
  const reloj = { ms: (T0 + 100) * 1000 };
  const t = arrancar(disco, lider, reloj);
  await t.leer([fila("a", "trabajando"), fila("suelto", "trabajando", { jefe_id: null }), fila("otro", "trabajando", { jefe_id: "otro-jefe" })]);
  await t.leer([lista("a", "entregado", T0), lista("suelto", "entregado", T0, 60, { jefe_id: null }), lista("otro", "entregado", T0, 60, { jefe_id: "otro-jefe" })]);
  assert.equal(t.llegado().length, 1, "sólo lo del líder con proceso");
  assert.doesNotMatch(t.llegado()[0], /otro|suelto/);
  assert.equal(t.avisos.entradas().some((x) => x.worker === "suelto"), false);
  assert.equal(t.estados()["a:fin"], "entregado");
  assert.equal(t.estados()["otro:fin"], "pendiente", "el de otro líder espera a su líder");
});

test("quitar el mensaje de la cola (lo decidió el usuario) descarta el aviso; cerrar el líder adrede lo devuelve a pendiente", async () => {
  const disco = nuevoDisco();
  const lider: Lider = { proc: true, enTurno: false, mandarFalla: true };
  const reloj = { ms: (T0 + 100) * 1000 };
  const t = arrancar(disco, lider, reloj, "worker");
  await t.leer([fila("a", "trabajando"), fila("b", "trabajando")]);
  await t.leer([lista("a", "murio", T0, 5), fila("b", "trabajando")]);
  assert.equal(t.estados()["a:falla"], "encolado");
  t.cola.vaciar(JEFE);
  assert.equal(t.estados()["a:falla"], "pendiente");
  assert.equal(t.avisos.entradas(JEFE)[0].ausente, true, "al volver sale como resumen");
  lider.mandarFalla = true;
  await t.cambio(JEFE);
  assert.equal(t.estados()["a:falla"], "encolado");
  const [x] = t.cola.lista(JEFE);
  t.cola.quitar(JEFE, x.id);
  assert.equal(t.estados()["a:falla"], "descartado");
});

test("un worker que volvió a andar (--seguir) o que se integró antes de entregar no se avisa", async () => {
  const disco = nuevoDisco();
  const lider: Lider = { proc: false, enTurno: false, mandarFalla: false };
  const reloj = { ms: (T0 + 100) * 1000 };
  const t = arrancar(disco, lider, reloj);
  await t.leer([fila("a", "trabajando"), fila("b", "trabajando")]);
  await t.leer([lista("a", "entregado", T0), lista("b", "entregado", T0)]);
  await t.leer([fila("a", "trabajando"), lista("b", "integrado", T0)]);
  lider.proc = true;
  await t.cambio();
  assert.deepEqual(t.llegado(), []);
  assert.deepEqual(t.estados(), { "a:fin": "descartado", "b:fin": "descartado" });
});
