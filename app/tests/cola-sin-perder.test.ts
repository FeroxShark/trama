// Punto 6 de la bandeja: nunca se pierde un mensaje. Los cuatro huecos que tenía la cola (electron/cola.ts): el error sólo en memoria, las imágenes que
// no entraban en `cola.json`, un mensaje en camino cuando la app se cae y el que ya salió y espera entrar. Más lo que los cierra de verdad: si el
// transcript ya lo tiene no se manda dos veces, y si no se puede saber se pregunta. Y el punto 3: editar, ordenar, frenar la salida y cortar el turno.
import { test } from "node:test";
import assert from "node:assert/strict";
import { crearCola, entroEn, type AvisoCola, type Deps, type Disponible, type Encolado } from "../electron/cola.ts";

const SID = "5a1f0c1d-0000-4000-8000-00000000c01a";
const tic = () => new Promise((r) => setImmediate(r));
const x = (texto: string, imagenes?: Encolado["imagenes"]): Omit<Encolado, "id"> => ({ texto, modelo: "m", effort: "high", ...(imagenes ? { imagenes } : {}) });
const textos = (c: readonly Encolado[]) => c.map((y) => y.texto);

/** Un disco que sobrevive a la app: `cola.json` y las imágenes aparte. */
function disco() {
  return { json: null as string | null, imagenes: new Map<string, string>(), borradas: [] as string[] };
}
type Disco = ReturnType<typeof disco>;

function armar(dd: Disco, o: { disp?: Disponible; verificar?: Deps["verificar"]; canal?: boolean; gracia?: number } = {}) {
  const e = { disp: o.disp ?? ("ocupado" as Disponible), canal: o.canal ?? false };
  const mandados: Encolado[] = [];
  const enTurnos: Encolado[] = [];
  const cortes: string[] = [];
  const avisos: AvisoCola[] = [];
  const colgados: { ok: () => void; mal: (x: Error) => void }[] = [];
  const cola = crearCola({
    disponible: async () => e.disp,
    traer: async () => ({ ok: true }),
    mandar: (_s, y) => {
      mandados.push(y);
      e.disp = "ocupado";
      return new Promise((ok, mal) => colgados.push({ ok, mal }));
    },
    total: async () => 7,
    textoError: (y) => ("motivo" in y ? `motivo:${y.motivo}` : (y.error as Error).message),
    guardar: async (j) => void (dd.json = j),
    adjuntos: {
      guardar: async (a, datos) => void dd.imagenes.set(a, datos),
      leer: async (a) => dd.imagenes.get(a) ?? null,
      borrar: async (a) => void (dd.imagenes.delete(a), dd.borradas.push(a)),
      listar: async () => [...dd.imagenes.keys()],
    },
    avisar: (a) => void avisos.push(a),
    puedeEnTurno: () => e.canal && e.disp === "ocupado",
    enTurno: async (_s, y) => void enTurnos.push(y),
    agrupar: 5,
    gracia: o.gracia ?? 5,
    cortar: (sid) => void cortes.push(sid),
    ...(o.verificar ? { verificar: o.verificar } : {}),
  });
  const contestar = async () => {
    for (const p of colgados.splice(0)) p.ok();
    await tic();
  };
  const pausa = () => new Promise((r) => setTimeout(r, 30));
  return { e, cola, mandados, enTurnos, cortes, avisos, colgados, contestar, pausa };
}

test("hueco 1, el error: sobrevive al reinicio, con su Reintentar, y sigue frenando la cola", async () => {
  const dd = disco();
  const a = armar(dd, { disp: "app" });
  a.cola.encolar(SID, x("uno"));
  a.cola.encolar(SID, x("dos"));
  await tic();
  a.colgados.shift()!.mal(new Error("el motor no arrancó"));
  await tic();
  assert.equal(a.cola.error(SID), "el motor no arrancó");

  const b = armar(dd, { disp: "app" });
  await b.cola.cargar(dd.json);
  assert.equal(b.cola.error(SID), "el motor no arrancó", "el error volvió de disco");
  assert.equal(b.cola.todas()[0].errorId, b.cola.lista(SID)[0].id, "y sabe de quién es");
  await b.cola.revisar();
  assert.deepEqual(b.mandados, [], "no se reintenta solo");
  void b.cola.ya(SID, false);
  await tic();
  assert.equal(b.mandados.length, 1, "Reintentar lo manda");
});

test("hueco 1: borrar el que falló se lleva su error y lo demás sigue", async () => {
  const dd = disco();
  const a = armar(dd, { disp: "app" });
  a.cola.encolar(SID, x("uno"));
  await tic();
  a.colgados.shift()!.mal(new Error("no"));
  await tic();
  a.e.disp = "ocupado";
  const dos = a.cola.encolar(SID, x("dos"));
  const id = a.cola.lista(SID)[0].id;
  assert.notEqual(id, dos.id);
  a.cola.quitar(SID, dos.id);
  assert.equal(a.cola.error(SID), "no", "borrar a otro no lo limpia");
  a.cola.encolar(SID, x("tres"));
  a.e.disp = "app";
  a.cola.quitar(SID, id);
  await tic();
  assert.equal(a.cola.error(SID), null);
  assert.equal(a.mandados.at(-1)!.texto, "tres", "lo demás sigue, sin el que se borró");
});

test("hueco 2, las imágenes: más de 20 MB juntos se guardan y vuelven enteras; el JSON no las lleva", async () => {
  const dd = disco();
  const a = armar(dd);
  const grande = () => [{ tipo: "image/png", datos: "A".repeat(15 * 1024 * 1024) }];
  a.cola.encolar(SID, x("uno", grande()));
  a.cola.encolar(SID, x("dos", grande()));
  a.cola.encolar(SID, x("tres", grande()));
  await tic();
  assert.ok(dd.json!.length < 10_000, `cola.json queda chico: ${dd.json!.length}`);
  assert.equal(dd.imagenes.size, 3);

  const b = armar(dd);
  await b.cola.cargar(dd.json);
  assert.deepEqual(b.cola.lista(SID).map((e) => e.imagenes?.[0].datos.length), [15728640, 15728640, 15728640], "las tres imágenes volvieron enteras");
  assert.equal(b.cola.error(SID), null);
});

test("hueco 2: el archivo de una imagen se borra sólo cuando el mensaje ya no está; uno suelto de otra vez, al arrancar", async () => {
  const dd = disco();
  const a = armar(dd);
  const e = a.cola.encolar(SID, x("uno", [{ tipo: "image/png", datos: "AAA" }]));
  await tic();
  const [archivo] = dd.imagenes.keys();
  assert.ok(archivo);
  a.cola.encolar(SID, x("dos"));
  await tic();
  assert.ok(dd.imagenes.has(archivo), "reescribir no lo toca");
  a.cola.quitar(SID, e.id);
  await tic();
  assert.ok(!dd.imagenes.has(archivo), "se fue con su mensaje");

  dd.imagenes.set("99-99", "huérfana");
  const b = armar(dd);
  await b.cola.cargar(dd.json);
  await tic();
  assert.ok(!dd.imagenes.has("99-99"));
});

test("hueco 2: una imagen sin su archivo no tira el mensaje: queda el texto y lo dice", async () => {
  const dd = disco();
  const a = armar(dd);
  a.cola.encolar(SID, x("uno", [{ tipo: "image/png", datos: "AAA" }]));
  await tic();
  dd.imagenes.clear();
  const b = armar(dd);
  await b.cola.cargar(dd.json);
  assert.deepEqual(textos(b.cola.lista(SID)), ["uno"]);
  assert.equal(b.cola.lista(SID)[0].imagenes, undefined);
  assert.equal(b.cola.error(SID), "motivo:sinImagen");
});

test("hueco 2: si el archivo no se puede escribir, la imagen va adentro del JSON; y un cola.json viejo (imágenes adentro) se sigue leyendo", async () => {
  const dd = disco();
  const a = crearCola({
    disponible: async () => "ocupado",
    traer: async () => ({ ok: true }),
    mandar: async () => {},
    total: async () => 7,
    textoError: () => "x",
    guardar: async (j) => void (dd.json = j),
    adjuntos: { guardar: () => Promise.reject(new Error("disco lleno")), leer: async () => null, borrar: async () => {}, listar: async () => [] },
    avisar: () => {},
  });
  a.encolar(SID, x("uno", [{ tipo: "image/png", datos: "AAA" }]));
  await tic();
  assert.equal(JSON.parse(dd.json!).colas[SID][0].imagenes[0].datos, "AAA");
  const b = armar(dd);
  await b.cola.cargar(dd.json);
  assert.equal(b.cola.lista(SID)[0].imagenes?.[0].datos, "AAA");
});

test("hueco 3, cierre de la app con un mensaje en camino: `mandar` a medias, la app se cae, y al volver sale de nuevo (el motor nunca lo tomó)", async () => {
  const dd = disco();
  const a = armar(dd, { disp: "app" });
  a.cola.encolar(SID, x("uno", [{ tipo: "image/png", datos: "IMG" }]));
  await tic();
  assert.equal(a.mandados.length, 1, "`mandar` en curso");
  assert.deepEqual(a.cola.lista(SID), [], "ya dejó la cola");
  assert.ok(dd.json!.includes('"camino"'), "pero sigue en disco, antes de que `mandar` conteste");
  assert.ok(dd.json!.includes('"uno"'));

  // La app se cae acá: `mandar` nunca contesta. Otra Trama, con el mismo disco.
  const b = armar(dd, { disp: "app", verificar: async () => false });
  await b.cola.cargar(dd.json);
  assert.deepEqual(textos(b.cola.lista(SID)), ["uno"], "volvió a la cola");
  assert.equal(b.cola.lista(SID)[0].imagenes?.[0].datos, "IMG", "con su imagen");
  assert.equal(b.cola.error(SID), null);
  void b.cola.revisar();
  await tic();
  assert.deepEqual(textos(b.mandados), ["uno"], "y sale solo al arrancar");
});

test("hueco 3: si el transcript ya lo tiene, no se manda dos veces", async () => {
  const dd = disco();
  const a = armar(dd, { disp: "app" });
  a.cola.encolar(SID, x("uno"));
  await tic();
  const b = armar(dd, { disp: "app", verificar: async (_s, t, desde) => (assert.deepEqual([t, desde], ["uno", 7]), true) });
  await b.cola.cargar(dd.json);
  assert.deepEqual(b.cola.todas(), []);
  await b.cola.revisar();
  assert.deepEqual(b.mandados, []);
});

test("hueco 3: si no se puede saber si entró, queda con su error y Reintentar: mejor preguntar que mandarlo dos veces", async () => {
  const dd = disco();
  const a = armar(dd, { disp: "app" });
  a.cola.encolar(SID, x("uno"));
  await tic();
  const b = armar(dd, { disp: "app", verificar: async () => null });
  await b.cola.cargar(dd.json);
  assert.deepEqual(textos(b.cola.lista(SID)), ["uno"]);
  assert.equal(b.cola.error(SID), "motivo:cortado");
  await b.cola.revisar();
  assert.deepEqual(b.mandados, [], "no sale solo");
});

test("hueco 4, el que ya salió a mitad de turno y espera entrar: sigue en disco, en la bandeja, y si la app se cae vuelve adelante de lo demás", async () => {
  const dd = disco();
  const a = armar(dd, { canal: true });
  a.cola.encolar(SID, x("primero"));
  await a.pausa();
  assert.equal(a.enTurnos.length, 1, "ya está en el stdin del motor");
  assert.deepEqual(textos(a.cola.camino(SID)), ["primero"], "sigue en la bandeja");
  assert.deepEqual(textos(a.cola.todas()[0].camino!), ["primero"], "una vista que abre lo ve");
  assert.ok(dd.json!.includes('"camino"'), "y en disco");
  a.e.canal = false;
  a.cola.encolar(SID, x("segundo"));
  await tic();

  const b = armar(dd, { disp: "app", verificar: async () => false });
  await b.cola.cargar(dd.json);
  assert.deepEqual(textos(b.cola.lista(SID)), ["primero", "segundo"], "lo que estaba en camino va primero");
});

test("hueco 4: con el eco deja el disco y va a la conversación; un texto que no es de él no lo toca", async () => {
  const dd = disco();
  const a = armar(dd, { canal: true });
  a.cola.encolar(SID, x("primero"));
  await a.pausa();
  a.cola.entro(SID, "otra cosa");
  assert.equal(a.cola.camino(SID).length, 1);
  a.cola.entro(SID, "  primero\n");
  assert.equal(a.cola.camino(SID).length, 0);
  assert.equal(a.avisos.at(-1)!.entro!.item.texto, "primero");
  await tic();
  assert.ok(!dd.json!.includes("primero"), "ya no está en disco");
});

test("hueco 4: el turno terminó y el CLI no lo tomó (se cortó el turno, el proceso se cayó): lo mira en el transcript y vuelve a salir, sin perderse ni pasar a los que esperan", async () => {
  const dd = disco();
  const a = armar(dd, { canal: true, verificar: async () => false });
  a.cola.encolar(SID, x("primero"));
  await a.pausa();
  a.e.canal = false;
  a.cola.encolar(SID, x("segundo"));
  a.e.disp = "app";
  void a.cola.libre(SID);
  await tic();
  assert.deepEqual(a.mandados, [], "todavía no: el primero puede estar por entrar");
  await a.pausa();
  assert.deepEqual(textos(a.mandados), ["Mensaje 1 de 2:\nprimero\n\n---\n\nMensaje 2 de 2:\nsegundo"], "salen juntos, en orden");
});

test("hueco 4: el eco que llega durante la gracia lo da por entrado y no se manda dos veces", async () => {
  const dd = disco();
  const a = armar(dd, { canal: true, verificar: async () => false, gracia: 20 });
  a.cola.encolar(SID, x("primero"));
  await a.pausa();
  a.e.disp = "app";
  void a.cola.libre(SID);
  await tic();
  a.cola.entro(SID, "primero");
  await a.pausa();
  assert.deepEqual(a.mandados, []);
  assert.deepEqual(a.cola.lista(SID), []);
});

test("un turno propio que el motor no tomó y se cayó vuelve con su error: no se relanza solo (sería un bucle)", async () => {
  const dd = disco();
  const a = armar(dd, { disp: "app", verificar: async () => false });
  a.cola.encolar(SID, x("uno"));
  await tic();
  await a.contestar();
  // Se cayó sin terminar el turno: nadie llamó a `finTurno`.
  a.e.disp = "app";
  void a.cola.libre(SID);
  await a.pausa();
  assert.deepEqual(textos(a.cola.lista(SID)), ["uno"]);
  assert.equal(a.cola.error(SID), "motivo:noEntro");
  assert.equal(a.avisos.at(-1)!.volvio ?? a.avisos.findLast((v) => v.volvio)?.volvio, true, "se saca de la conversación");
  assert.equal(a.mandados.length, 1);
});

test("un turno propio que termina bien deja el disco sin mirar el transcript", async () => {
  const dd = disco();
  let miro = 0;
  const a = armar(dd, { disp: "app", verificar: async () => (miro++, false) });
  a.cola.encolar(SID, x("uno"));
  await tic();
  await a.contestar();
  assert.ok(dd.json!.includes('"camino"'), "hasta el fin del turno sigue en disco");
  a.cola.finTurno(SID);
  a.e.disp = "app";
  void a.cola.libre(SID);
  await a.pausa();
  assert.equal(miro, 0);
  assert.ok(!dd.json!.includes("uno"));
});

test("entroEn: sólo cuenta de `desde` en adelante (el mismo texto de antes no es este), y admite lo que el motor antepone", () => {
  const m = [{ rol: "user", texto: "dale" }, { rol: "assistant", texto: "dale" }, { rol: "user", texto: "(aviso) otro" }];
  assert.equal(entroEn(m, 10, "dale", 8), false, "el «dale» de la posición 7 es anterior");
  assert.equal(entroEn(m, 10, "dale", 7), true);
  assert.equal(entroEn(m, 10, "otro", 7), true, "el aviso de traído va adelante");
  assert.equal(entroEn(m, 10, "dale", null), null);
  assert.equal(entroEn(m, 10, "  ", 0), null, "sólo imágenes: no se puede saber");
});

test("punto 3, editar: cambia el texto del que espera, saca una imagen; no toca lo que ya salió, los avisos ni lo deja vacío", async () => {
  const dd = disco();
  const a = armar(dd, { canal: true });
  const e = a.cola.encolar(SID, x("uno", [{ tipo: "image/png", datos: "A" }, { tipo: "image/png", datos: "B" }]));
  assert.equal(a.cola.editar(SID, e.id, "uno bien", [0]), true);
  assert.equal(a.cola.lista(SID)[0].texto, "uno bien");
  assert.deepEqual(a.cola.lista(SID)[0].imagenes?.map((i) => i.datos), ["B"]);
  assert.equal(a.cola.editar(SID, e.id, "  ", [0]), false, "sin texto ni imágenes quedaría vacío");
  assert.equal(a.cola.editar(SID, e.id, "  "), true, "sólo la imagen sirve");
  const av = a.cola.encolar(SID, { ...x("aviso"), aviso: true });
  assert.equal(a.cola.editar(SID, av.id, "otro"), false, "un aviso de Trama no lo escribió el usuario");
  await a.pausa();
  assert.equal(a.cola.editar(SID, e.id, "tarde"), false, "ya salió");
});

test("punto 3, editar y arrastrar frenan la salida, también a mitad de turno y al terminarlo; soltar la deja seguir con lo nuevo", async () => {
  const dd = disco();
  const a = armar(dd, { canal: true });
  const e = a.cola.encolar(SID, x("uno"));
  a.cola.retener(SID, true);
  await a.pausa();
  assert.deepEqual(a.enTurnos, [], "a mitad de turno espera");
  await tic();
  a.e.disp = "app";
  await a.cola.libre(SID);
  assert.deepEqual(a.mandados, [], "al terminar el turno, también");
  a.cola.editar(SID, e.id, "uno bien");
  a.cola.retener(SID, false);
  await tic();
  assert.deepEqual(textos(a.mandados), ["uno bien"]);
});

test("punto 3, «Cortar y enviar ahora» en un líder de la app: para el turno, no escribe a mitad, y al terminar sale todo junto", async () => {
  const dd = disco();
  const a = armar(dd, { canal: true });
  a.cola.encolar(SID, x("uno"));
  a.cola.encolar(SID, x("dos"));
  await a.cola.ya(SID, true);
  assert.deepEqual(a.cortes, [SID], "cortó el turno");
  await a.pausa();
  assert.deepEqual(a.enTurnos, [], "ya no se lo pasa a mitad: va a entrar ahora");
  a.e.disp = "app";
  void a.cola.libre(SID);
  await tic();
  assert.equal(a.mandados.length, 1);
  assert.match(a.mandados[0].texto, /Mensaje 1 de 2:\nuno[\s\S]*Mensaje 2 de 2:\ndos/);
});

test("punto 3: «Enviar ahora» sobre uno que estaba frenado por la confirmación suelta el freno", async () => {
  const dd = disco();
  const a = armar(dd);
  a.cola.encolar(SID, x("uno"));
  a.cola.retener(SID, true);
  await tic();
  await a.cola.ya(SID, true);
  a.e.disp = "app";
  void a.cola.libre(SID);
  await tic();
  assert.equal(a.mandados.length, 1);
});

test("punto 4, el orden: se guarda, sale en ese orden, ignora lo que ya no está y deja al final lo que llegó mientras tanto", async () => {
  const dd = disco();
  const a = armar(dd);
  const [u, d2, t] = [a.cola.encolar(SID, x("uno")), a.cola.encolar(SID, x("dos")), a.cola.encolar(SID, x("tres"))];
  a.cola.ordenar(SID, [t.id, u.id, d2.id]);
  assert.deepEqual(textos(a.cola.lista(SID)), ["tres", "uno", "dos"]);
  await tic();
  assert.deepEqual(JSON.parse(dd.json!).colas[SID].map((e: Encolado) => e.texto), ["tres", "uno", "dos"], "en disco");
  a.cola.quitar(SID, u.id);
  const c = a.cola.encolar(SID, x("cuatro"));
  a.cola.ordenar(SID, [d2.id, u.id, t.id]);
  assert.deepEqual(textos(a.cola.lista(SID)), ["dos", "tres", "cuatro"]);
  assert.ok(c.id > t.id);
  await tic();
  a.e.disp = "app";
  void a.cola.libre(SID);
  await tic();
  assert.match(a.mandados[0].texto, /Mensaje 1 de 3:\ndos[\s\S]*Mensaje 2 de 3:\ntres[\s\S]*Mensaje 3 de 3:\ncuatro/);
});

test("el orden con un error: el error sigue en su mensaje aunque deje de ser el primero", async () => {
  const dd = disco();
  const a = armar(dd, { disp: "app" });
  const u = a.cola.encolar(SID, x("uno"));
  await tic();
  a.colgados.shift()!.mal(new Error("no"));
  await tic();
  a.e.disp = "ocupado";
  const d2 = a.cola.encolar(SID, x("dos"));
  a.cola.ordenar(SID, [d2.id, u.id]);
  assert.equal(a.avisos.at(-1)!.errorId, u.id);
});

test("cerrar el líder adrede también suelta lo que estaba en camino (no vuelve al reiniciar)", async () => {
  const dd = disco();
  const a = armar(dd, { canal: true });
  a.cola.encolar(SID, x("uno"));
  await a.pausa();
  a.cola.vaciar(SID);
  await tic();
  assert.ok(!dd.json!.includes("uno"));
  assert.deepEqual(a.cola.todas(), []);
});
