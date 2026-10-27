// La cola de mensajes de un líder (electron/cola.ts): lo que se manda a mitad de un turno
// espera y sale solo, TODO JUNTO en un solo mensaje: a mitad del turno (sin interrumpir) si el motor tiene canal,
// y si no, cuando el líder queda libre; se puede sacar; no se pierde en un reinicio.
import { test } from "node:test";
import assert from "node:assert/strict";
import { crearCola, juntar, loteDe, type AvisoCola, type Disponible, type Encolado } from "../electron/cola.ts";

const SID = "5a1f0c1d-0000-4000-8000-00000000c01a";
// La cola espera a que `mandar` conteste: acá no se la espera (queda en curso hasta `contestar`), se le da un tic.
const tic = () => new Promise((r) => setImmediate(r));

/** Una cola con un líder de mentira: su estado a mano, y lo que se trae, manda, guarda y avisa queda anotado. */
function armar({ disp = "ocupado" as Disponible, falla = false, canal = false, fallaTurno = false } = {}) {
  const e = { disp, falla, canal, fallaTurno, motivo: null as string | null };
  const mandados: string[] = [];
  /** Lo que entró a mitad de un turno (sin interrumpir). */
  const enTurnos: Encolado[] = [];
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
    puedeEnTurno: () => e.canal && e.disp === "ocupado",
    enTurno: async (_sid, x) => {
      if (e.fallaTurno) throw new Error("sin canal");
      enTurnos.push(x);
    },
    agrupar: 5,
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
  /** Pasa el rato de agrupar a mitad de un turno. */
  const pausa = () => new Promise((r) => setTimeout(r, 30));
  return { e, cola, mandados, enTurnos, traidos, avisos, contestar, finDeTurno, pausa, guardado: () => guardado };
}

const x = (texto: string): Omit<Encolado, "id"> => ({ texto, modelo: "claude-opus-5-5", effort: "high" });
const textos = (c: readonly Encolado[]) => c.map((y) => y.texto);

const JUNTOS = (...t: string[]) => t.map((s, k) => `Mensaje ${k + 1} de ${t.length}:\n${s}`).join("\n\n---\n\n");

test("ocupado + enviar = en cola; sin canal a mitad de turno, todo sale junto al terminar el turno, en orden", async () => {
  const a = armar();
  a.cola.encolar(SID, x("uno"));
  a.cola.encolar(SID, x("dos"));
  await tic();
  assert.deepEqual(a.mandados, [], "mientras responde no sale nada");
  assert.deepEqual(textos(a.cola.lista(SID)), ["uno", "dos"]);
  assert.deepEqual(textos(a.avisos.at(-1)!.lista), ["uno", "dos"], "la vista los ve en cola");

  await a.pausa();
  assert.deepEqual([a.mandados, a.enTurnos], [[], []], "sin canal no se manda a mitad del turno, ni pasado el rato de agrupar");

  await a.finDeTurno();
  assert.deepEqual(a.mandados, [JUNTOS("uno", "dos")], "un solo mensaje con los dos, no uno por turno");
  assert.deepEqual(a.cola.lista(SID), []);
  const salio = a.avisos.find((v) => v.salio)!.salio!;
  assert.deepEqual([salio.item.texto, salio.total, salio.traido, salio.enTurno], [JUNTOS("uno", "dos"), 7, false, undefined], "avisa qué salió y con qué base");

  // El turno sigue: otro fin de turno falso (un aviso de las sesiones) no manda nada de nuevo.
  void a.cola.revisar();
  await tic();
  assert.equal(a.mandados.length, 1);
  await a.contestar();
  assert.deepEqual(a.cola.todas(), []);
});

test("con canal a mitad de turno: dos encolados salen en UN solo mensaje, sin interrumpir ni esperar al fin del turno", async () => {
  const a = armar({ canal: true });
  a.cola.encolar(SID, x("uno"));
  a.cola.encolar(SID, x("dos"));
  await tic();
  assert.deepEqual(a.enTurnos, [], "se espera un ratito para juntar lo que se escribe enseguida");
  assert.deepEqual(textos(a.cola.lista(SID)), ["uno", "dos"], "mientras, se ve en cola");
  await a.pausa();
  assert.deepEqual(a.enTurnos.map((y) => y.texto), [JUNTOS("uno", "dos")], "entran juntos");
  assert.deepEqual(a.mandados, [], "no es un turno nuevo ni se interrumpe: no pasa por `mandar`");
  assert.deepEqual(a.cola.lista(SID), []);
  const v = a.avisos.find((z) => z.salio)!.salio!;
  assert.deepEqual([v.enTurno, v.item.texto], [true, JUNTOS("uno", "dos")], "la vista lo suma al turno en curso");

  // Otro mensaje, más tarde, en la misma herramienta larga: sale solo (uno).
  a.cola.encolar(SID, x("tres"));
  await a.pausa();
  assert.deepEqual(a.enTurnos.map((y) => y.texto), [JUNTOS("uno", "dos"), "tres"], "uno solo sale tal cual");
});

test("a mitad de turno falla el envío: vuelve a la cola, se saca de la conversación y espera al fin del turno", async () => {
  const a = armar({ canal: true, fallaTurno: true });
  a.cola.encolar(SID, x("uno"));
  a.cola.encolar(SID, x("dos"));
  await a.pausa();
  assert.deepEqual(textos(a.cola.lista(SID)), ["uno", "dos"], "los dos vuelven, en orden");
  assert.equal(a.cola.error(SID), "sin canal");
  const v = a.avisos.at(-1)!;
  assert.deepEqual([v.volvio, v.enTurno], [true, true]);
  await a.pausa();
  assert.deepEqual(a.enTurnos, [], "no se reintenta solo");
  // Reintentar al terminar el turno: sale por el camino de siempre, junto.
  a.e.disp = "app";
  void a.cola.ya(SID, false);
  await tic();
  assert.deepEqual(a.mandados, [JUNTOS("uno", "dos")]);
});

test("lo que se saca de la cola antes de que pase el rato no sale", async () => {
  const a = armar({ canal: true });
  const uno = a.cola.encolar(SID, x("uno"));
  a.cola.encolar(SID, x("dos"));
  a.cola.quitar(SID, uno.id);
  await a.pausa();
  assert.deepEqual(a.enTurnos.map((y) => y.texto), ["dos"]);
});

test("juntar: el orden, el separador y las imágenes de cada uno; lote: parte lo que no entra en un mensaje", () => {
  const img = (n: number) => Array.from({ length: n }, (_, i) => ({ tipo: "image/png", datos: `AAAA${i}` }));
  const m = juntar([
    { id: 1, texto: "a", modelo: "m1", effort: "e1" },
    { id: 2, texto: "b", modelo: "m2", effort: "e2", imagenes: img(2), modo: "plan", nombre: "ana" },
    { id: 3, texto: "c", modelo: "m3", effort: "e3", imagenes: img(1) },
  ]);
  assert.equal(m.texto, "Mensaje 1 de 3:\na\n\n---\n\nMensaje 2 de 3 (imágenes 1 a 2 de las adjuntas):\nb\n\n---\n\nMensaje 3 de 3 (imagen 3 de las adjuntas):\nc");
  assert.equal(m.imagenes?.length, 3);
  assert.deepEqual([m.modelo, m.effort, m.modo, m.nombre, m.id], ["m3", "e3", "plan", "ana", 3]);
  const uno = { id: 1, texto: "x", modelo: "m", effort: "e" };
  assert.equal(juntar([uno]), uno, "uno solo sale tal cual");
  const grande = (id: number, n: number): Encolado => ({ id, texto: String(id), modelo: "m", effort: "e", imagenes: img(n) });
  assert.deepEqual(loteDe([grande(1, 12), grande(2, 9), grande(3, 1)]).map((y) => y.id), [1], "con 20 imágenes de tope");
  assert.deepEqual(loteDe([grande(1, 12), grande(2, 8), grande(3, 1)]).map((y) => y.id), [1, 2]);
  assert.deepEqual(loteDe([grande(1, 25)]).map((y) => y.id), [1], "siempre sale al menos uno");
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
  assert.deepEqual(a.mandados, [JUNTOS("uno", "dos")], "uno solo, con los dos");
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
  assert.deepEqual(a.mandados, ["uno", JUNTOS("uno", "dos")], "reintentar manda lo que volvió junto con lo nuevo");
  assert.deepEqual(a.cola.lista(SID), []);
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
  assert.deepEqual(b.mandados, [JUNTOS("quedó", "y esto")], "lo guardado sale junto");
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

test("mensaje encolado + cambio de modelo o esfuerzo: sale con lo elegido al desencolarse, no con lo que había al encolar", async () => {
  const a = armar();
  const vistos: { modelo: string; effort: string }[] = [];
  const dep = crearCola({
    disponible: async () => a.e.disp,
    traer: async () => ({ ok: true }),
    mandar: async (_s, it) => void vistos.push({ modelo: it.modelo, effort: it.effort }),
    total: async () => 1,
    textoError: () => "",
    guardar: async () => {},
    avisar: () => {},
  });
  dep.encolar(SID, x("uno")); // opus high, ocupado
  dep.encolar(SID, x("dos"));
  await tic();
  assert.equal(vistos.length, 0);
  dep.elegir(SID, { modelo: "claude-sonnet-5-5", effort: "low" });
  assert.deepEqual(dep.seleccion(SID), { modelo: "claude-sonnet-5-5", effort: "low" });
  a.e.disp = "app";
  await dep.libre(SID);
  await tic();
  assert.deepEqual(vistos, [{ modelo: "claude-sonnet-5-5", effort: "low" }], "un solo mensaje con la selección vigente");
  // Vacía: no queda selección vieja para la próxima vez.
  assert.equal(dep.seleccion(SID), null);
  dep.encolar(SID, { ...x("tres"), modelo: "claude-haiku-5-5", effort: "high" });
  await tic();
  assert.deepEqual(vistos.at(-1), { modelo: "claude-haiku-5-5", effort: "high" });
});

test("el aviso de lo que salió lleva lo vigente, y si falla vuelve a la cola con eso (el reintento no pierde la elección)", async () => {
  const a = armar();
  a.cola.encolar(SID, x("uno"));
  a.cola.elegir(SID, { modelo: "claude-sonnet-5-5", effort: "medium" });
  await a.finDeTurno();
  assert.equal(a.avisos.find((v) => v.salio)?.salio?.item.modelo, "claude-sonnet-5-5");
  assert.equal(a.cola.lista(SID).length, 0);
  a.e.falla = true;
  await a.contestar();
  assert.equal(a.cola.lista(SID)[0]?.modelo, "claude-sonnet-5-5");
  assert.equal(a.cola.lista(SID)[0]?.effort, "medium");
});

test("elegir sin cola no guarda nada (no queda una selección vieja pisando a un mensaje futuro)", () => {
  const a = armar();
  a.cola.elegir(SID, { modelo: "claude-sonnet-5-5", effort: "low" });
  assert.equal(a.cola.seleccion(SID), null);
});
