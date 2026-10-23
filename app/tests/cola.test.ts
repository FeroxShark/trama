// La cola de mensajes de un líder (electron/cola.ts): lo que se manda a mitad de un turno
// espera y sale solo cuando el líder queda libre; se puede sacar; no se pierde en un reinicio.
import { test } from "node:test";
import assert from "node:assert/strict";
import { crearCola, type AvisoCola, type Disponible, type Encolado } from "../electron/cola.ts";

const SID = "5a1f0c1d-0000-4000-8000-00000000c01a";
// La cola espera a que `mandar` conteste: acá no se la espera (queda en curso hasta `contestar`), se le da un tic.
const tic = () => new Promise((r) => setImmediate(r));

/** Una cola con un líder de mentira: su estado a mano, y lo que se trae, manda, guarda y avisa queda anotado. */
function armar({ disp = "ocupado" as Disponible, falla = false } = {}) {
  const e = { disp, falla, motivo: null as string | null };
  const mandados: string[] = [];
  const traidos: { texto: string; cortar: boolean }[] = [];
  const avisos: AvisoCola[] = [];
  const pendientes: { ok: () => void; mal: (x: Error) => void }[] = [];
  let guardado: string | null = null;
  const cola = crearCola({
    disponible: async () => e.disp,
    traer: async (_sid, x, cortar) => {
      // Como `lider.traer`: a mitad de algo no lo toca sin permiso.
      if (e.disp === "terminalOcupada" && !cortar) return { ok: false, motivo: "trabajando" };
      if (e.motivo) return { ok: false, motivo: e.motivo };
      traidos.push({ texto: x.texto, cortar });
      e.disp = "app";
      return { ok: true };
    },
    mandar: (_sid, x) => {
      mandados.push(x.texto);
      // Como el main: al mandar queda ocupado; contesta cuando se lo suelta.
      e.disp = "ocupado";
      return new Promise((ok, mal) => pendientes.push({ ok, mal }));
    },
    total: async () => 7,
    textoError: (x) => ("motivo" in x ? `motivo:${x.motivo}` : (x.error as Error).message),
    guardar: async (json) => void (guardado = json),
    avisar: (a) => avisos.push(a),
  });
  /** El `mandar` en curso contesta (o falla). */
  const contestar = async () => {
    for (const p of pendientes.splice(0)) e.falla ? p.mal(new Error("se cayó")) : p.ok();
    await tic();
  };
  /** Termina el turno: el líder queda libre y la cola se entera (el evento `estado` del main). */
  const finDeTurno = async () => {
    e.disp = "app";
    void cola.libre(SID);
    await tic();
  };
  return { e, cola, mandados, traidos, avisos, contestar, finDeTurno, guardado: () => guardado };
}

const x = (texto: string): Omit<Encolado, "id"> => ({ texto, modelo: "claude-opus-5-5", effort: "high" });
const textos = (c: readonly Encolado[]) => c.map((y) => y.texto);

test("ocupado + enviar = en cola; se entrega solo al terminar el turno, de a uno y en orden", async () => {
  const a = armar();
  a.cola.encolar(SID, x("uno"));
  a.cola.encolar(SID, x("dos"));
  await tic();
  assert.deepEqual(a.mandados, [], "mientras responde no sale nada");
  assert.deepEqual(textos(a.cola.lista(SID)), ["uno", "dos"]);
  assert.deepEqual(textos(a.avisos.at(-1)!.lista), ["uno", "dos"], "la vista los ve en cola");

  await a.finDeTurno();
  assert.deepEqual(a.mandados, ["uno"], "uno por turno");
  assert.deepEqual(textos(a.cola.lista(SID)), ["dos"]);
  const salio = a.avisos.find((v) => v.salio)!.salio!;
  assert.deepEqual([salio.item.texto, salio.total, salio.traido], ["uno", 7, false], "avisa qué salió y con qué base");

  // El turno de "uno" sigue: otro fin de turno falso (un aviso de las sesiones) no adelanta nada.
  void a.cola.revisar();
  await tic();
  assert.deepEqual(a.mandados, ["uno"]);
  await a.contestar();
  await a.finDeTurno();
  assert.deepEqual(a.mandados, ["uno", "dos"]);
  assert.deepEqual(a.cola.lista(SID), []);
  assert.deepEqual(a.cola.todas(), []);
});

test("si ya estaba libre (la vista lo vio ocupado un instante tarde), sale al encolar", async () => {
  const a = armar({ disp: "app" });
  a.cola.encolar(SID, x("ya"));
  await tic();
  assert.deepEqual(a.mandados, ["ya"]);
  assert.deepEqual(a.cola.lista(SID), []);
});

test("cancelar: lo que se saca de la cola no sale", async () => {
  const a = armar();
  const uno = a.cola.encolar(SID, x("uno"));
  const dos = a.cola.encolar(SID, x("dos"));
  a.cola.quitar(SID, uno.id);
  assert.deepEqual(textos(a.cola.lista(SID)), ["dos"]);
  assert.deepEqual(textos(a.avisos.at(-1)!.lista), ["dos"], "la vista se entera");
  a.cola.quitar(SID, 999);
  a.cola.quitar(SID, dos.id);
  assert.deepEqual(a.cola.lista(SID), []);
  await a.finDeTurno();
  assert.deepEqual(a.mandados, []);
  assert.deepEqual(JSON.parse(a.guardado()!).colas, {}, "y tampoco queda en disco");
});

test("dos fines de turno seguidos no mandan dos", async () => {
  const a = armar();
  a.cola.encolar(SID, x("uno"));
  a.cola.encolar(SID, x("dos"));
  a.e.disp = "app";
  void a.cola.libre(SID);
  void a.cola.libre(SID);
  void a.cola.revisar();
  await tic();
  assert.deepEqual(a.mandados, ["uno"]);
});

test("abierto en una terminal a mitad de un turno: espera; cuando termina, lo trae y manda", async () => {
  const a = armar({ disp: "terminalOcupada" });
  a.cola.encolar(SID, { ...x("seguimos"), modo: "bypassPermissions", nombre: "ana-t1" });
  await tic();
  void a.cola.revisar();
  await tic();
  assert.deepEqual([a.traidos, a.mandados], [[], []], "no se lo corta: no se toca nada");
  assert.equal(a.cola.error(SID), null, "esperar no es un error");

  // Terminó su turno allá (`status: idle`): las sesiones cambian y la cola revisa.
  a.e.disp = "terminal";
  void a.cola.revisar();
  await tic();
  assert.deepEqual(a.traidos, [{ texto: "seguimos", cortar: false }]);
  assert.deepEqual(a.mandados, ["seguimos"]);
  assert.equal(a.avisos.find((v) => v.salio)!.salio!.traido, true, "la vista sabe que ahora es de la app");
});

test("cortar y enviar ahora: sólo si Ana lo pide", async () => {
  const a = armar({ disp: "terminalOcupada" });
  a.cola.encolar(SID, x("urgente"));
  await tic();
  assert.deepEqual(a.mandados, []);
  void a.cola.ya(SID, true);
  await tic();
  assert.deepEqual(a.traidos, [{ texto: "urgente", cortar: true }]);
  assert.deepEqual(a.mandados, ["urgente"]);
});

test("sin proceso en ningún lado (trama volvió y la terminal ya no está): se lo retoma y sale", async () => {
  const a = armar({ disp: "nadie" });
  a.cola.encolar(SID, x("sigo"));
  await tic();
  assert.deepEqual(a.traidos, [{ texto: "sigo", cortar: false }]);
  assert.deepEqual(a.mandados, ["sigo"]);
});

test("no se pudo traer: queda en la cola con el porqué, y no se reintenta solo", async () => {
  const a = armar({ disp: "terminal" });
  a.e.motivo = "abierto";
  a.cola.encolar(SID, x("uno"));
  await tic();
  assert.equal(a.cola.error(SID), "motivo:abierto");
  assert.deepEqual(textos(a.cola.lista(SID)), ["uno"], "no se pierde");
  assert.equal(a.avisos.at(-1)!.error, "motivo:abierto");
  void a.cola.revisar();
  await tic();
  void a.cola.libre(SID);
  await tic();
  assert.deepEqual(a.traidos, [], "sin bucle");

  // Reintentar: ahora sí.
  a.e.motivo = null;
  void a.cola.ya(SID, false);
  await tic();
  assert.equal(a.cola.error(SID), null);
  assert.deepEqual(a.mandados, ["uno"]);
});

test("el mandar falló: vuelve a la cola, adelante, con el error; Reintentar lo saca", async () => {
  const a = armar({ disp: "app", falla: true });
  a.cola.encolar(SID, x("uno"));
  await tic();
  a.cola.encolar(SID, x("dos"));
  assert.deepEqual(a.mandados, ["uno"]);
  await a.contestar();
  assert.deepEqual(textos(a.cola.lista(SID)), ["uno", "dos"]);
  assert.equal(a.cola.error(SID), "se cayó");
  const v = a.avisos.at(-1)!;
  assert.deepEqual([v.volvio, v.error, textos(v.lista)], [true, "se cayó", ["uno", "dos"]], "la vista lo saca de la conversación");
  await a.finDeTurno();
  assert.deepEqual(a.mandados, ["uno"], "no se reintenta solo");

  a.e.falla = false;
  a.e.disp = "app";
  void a.cola.ya(SID, false);
  await tic();
  assert.deepEqual(a.mandados, ["uno", "uno"]);
  assert.deepEqual(textos(a.cola.lista(SID)), ["dos"]);
});

test("un reinicio no la pierde: lo guardado vuelve, se ve pendiente y sale cuando se puede", async () => {
  const a = armar();
  a.cola.encolar(SID, { ...x("quedó"), modo: "plan", nombre: "ana-t1" });
  a.cola.encolar(SID, x("y esto"));
  await tic();
  const disco = a.guardado()!;
  assert.equal(JSON.parse(disco).version, 1);

  // Otra trama, con el mismo archivo. El líder no tiene proceso todavía.
  const b = armar({ disp: "nadie" });
  b.cola.cargar(disco);
  assert.deepEqual(b.cola.todas().map((c) => [c.sid, textos(c.lista), c.error]), [[SID, ["quedó", "y esto"], null]], "una vista que abre lo ve pendiente");
  assert.equal(b.cola.lista(SID)[0].modo, "plan");
  void b.cola.revisar();
  await tic();
  assert.deepEqual(b.mandados, ["quedó"]);
  // Los ids nuevos no pisan a los guardados.
  const nuevo = b.cola.encolar(SID, x("otro"));
  assert.ok(nuevo.id > Math.max(...JSON.parse(disco).colas[SID].map((y: Encolado) => y.id)));
});

test("un archivo roto o de otra versión: cola vacía, sin romper", () => {
  for (const json of [null, "", "{", JSON.stringify({ version: 2, colas: { [SID]: [{ id: 1, ...x("a") }] } }), JSON.stringify({ version: 1, colas: { [SID]: [{ id: "1" }, 3] } })]) {
    const a = armar();
    a.cola.cargar(json);
    assert.deepEqual(a.cola.todas(), []);
  }
});

test("cerrar el líder adrede vacía su cola", async () => {
  const a = armar();
  a.cola.encolar(SID, x("uno"));
  a.cola.vaciar(SID);
  assert.deepEqual(a.cola.lista(SID), []);
  await a.finDeTurno();
  assert.deepEqual(a.mandados, []);
});

test("mientras uno sale, la cola lo dice: trama no se relanza en el medio", async () => {
  const a = armar();
  a.cola.encolar(SID, x("uno"));
  await tic();
  assert.equal(a.cola.enCamino(), 0, "esperando el fin del turno no hay nada saliendo");
  await a.finDeTurno();
  assert.deepEqual(a.mandados, ["uno"]);
  assert.equal(a.cola.enCamino(), 1, "`mandar` todavía no contestó");
  await a.contestar();
  assert.equal(a.cola.enCamino(), 0);
});

test("a disco: las imágenes pasan de un tope y los mensajes siguientes se guardan sin ellas (el texto sí)", async () => {
  const { paraDisco, COLA_IMAGENES_MAX } = await import("../electron/cola.ts");
  assert.equal(COLA_IMAGENES_MAX, 20 * 1024 * 1024);
  const img = (n: number) => [{ tipo: "image/png", datos: "A".repeat(n) }];
  const e = (id: number, n?: number) => ({ id, texto: `m${id}`, modelo: "m", effort: "e", ...(n ? { imagenes: img(n) } : {}) });
  const colas = new Map([
    ["s1", [e(1, 60), e(2), e(3, 60)]],
    ["s2", [e(4, 30)]],
  ]);
  const r = paraDisco(colas, 100);
  assert.equal(r.s1[0].imagenes?.length, 1, "entra entera");
  assert.equal(r.s1[2].imagenes, undefined, "la que ya no entra se guarda sin imágenes");
  assert.equal(r.s1[2].texto, "m3", "pero con su texto");
  assert.equal(r.s2[0].imagenes?.length, 1, "una más chica que sí entra en lo que queda");
  assert.equal(colas.get("s1")![2].imagenes?.length, 1, "en memoria siguen completas");
  assert.equal(Object.keys(paraDisco(new Map())).length, 0);
});
