import { test } from "node:test";
import assert from "node:assert/strict";
import { COLGADO_MS, crearAvisosWorker, esDeCupo, motivoDe, proveedorDe, tareaCorta, textoParaLider, vuelveDe, type AvisoWorker, type FilaWorker } from "../electron/avisos-worker.ts";

const fila = (id: string, estado: string, extra: Partial<FilaWorker> = {}): FilaWorker => ({ id, proyecto: "trama", estado, tarea: `Objetivo: tarea de ${id}`, modelo: "claude-a", jefe_id: "jefe-1", jefe: "ana", ...extra });

function armar(rastros: Record<string, string> = {}, cupos: Parameters<typeof crearAvisosWorker>[0]["cupos"] = undefined) {
  const avisos: AvisoWorker[] = [];
  let t = 1_000_000_000_000;
  const av = crearAvisosWorker({ leerRastro: async (h) => rastros[h.id] ?? "", cupos, emitir: (a) => avisos.push(a), ahora: () => t });
  return { av, avisos, avanzar: (ms: number) => (t += ms) };
}

test("terminó: avisa 'fin' al pasar de trabajando a entregado; la primera lectura no avisa nada", async () => {
  const { av, avisos } = armar();
  await av.hilos([fila("a", "trabajando"), fila("viejo", "entregado")]);
  assert.deepEqual(avisos, [], "lo que ya estaba terminado no avisa");
  await av.hilos([fila("a", "entregado"), fila("viejo", "entregado")]);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].tipo, "fin");
  assert.equal(avisos[0].jefe_id, "jefe-1");
  assert.equal(avisos[0].tarea, "tarea de a");
  await av.hilos([fila("a", "entregado")]);
  assert.equal(avisos.length, 1, "una sola vez");
});

test("terminó pidiendo una decisión", async () => {
  const { av, avisos } = armar();
  await av.hilos([fila("a", "trabajando")]);
  await av.hilos([fila("a", "decision")]);
  assert.equal(avisos[0].decision, true);
  assert.match(textoParaLider(avisos[0]), /terminó pidiendo una decisión/);
});

test("falló por cupo (el caso real: un proveedor dice quota reached al arrancar): proveedor, cuándo vuelve", async () => {
  const ahoraS = 1_000_000_000;
  const { av, avisos } = armar(
    { g: "Error: RESOURCE_EXHAUSTED\nIndividual quota reached for gemini" },
    () => ({ suscripciones: [{ proveedor: "google", grupos: [{ agotado: ahoraS + 3 * 3600, ventanas: [] }] }] }),
  );
  await av.hilos([]);
  // Nació y murió entre dos lecturas: el evento `inicio` lo anticipa.
  av.eventos([{ tipo: "inicio", id: "g" }]);
  await av.hilos([fila("g", "murio", { modelo: "gemini-b" })]);
  assert.equal(avisos.length, 1);
  const a = avisos[0];
  assert.equal(a.tipo, "cupo");
  assert.equal(a.proveedor, "Google");
  assert.equal(a.vuelve, ahoraS + 3 * 3600);
  assert.match(a.motivo, /RESOURCE_EXHAUSTED|quota/);
  assert.match(textoParaLider(a), /Google sin cupo \(vuelve a las \d\d:\d\d\)/);
});

test("falló por cupo sin saber cuándo vuelve", async () => {
  const { av, avisos } = armar({ x: "429 Too Many Requests" });
  await av.hilos([fila("x", "trabajando", { modelo: "codex:gpt" })]);
  await av.hilos([fila("x", "murio", { modelo: "codex:gpt" })]);
  assert.equal(avisos[0].tipo, "cupo");
  assert.equal(avisos[0].vuelve, null);
  assert.match(textoParaLider(avisos[0]), /no sé cuándo vuelve/);
});

test("murió sin motivo: falla con el texto genérico; el rc del evento fin se cuenta", async () => {
  const { av, avisos } = armar();
  await av.hilos([fila("m", "trabajando"), fila("n", "trabajando")]);
  av.eventos([{ tipo: "fin", id: "n", rc: 3 }]);
  await av.hilos([fila("m", "murio"), fila("n", "entregado")]);
  const por = Object.fromEntries(avisos.filter((a) => a.tipo === "falla").map((a) => [a.id, a]));
  assert.match(textoParaLider(por.m), /falló: el proceso se cortó sin dejar mensaje/);
  assert.equal(por.n.rc, 3);
  assert.match(textoParaLider(por.n), /salió con código 3/);
});

test("lo que frenó 'pa --parar' a propósito no es un fallo", async () => {
  const { av, avisos } = armar();
  await av.hilos([fila("p", "trabajando")]);
  await av.hilos([fila("p", "murio", { frenado_en: 5 })]);
  assert.deepEqual(avisos, []);
});

test("lo que una persona integró o archivó no avisa", async () => {
  const { av, avisos } = armar();
  await av.hilos([fila("i", "trabajando")]);
  await av.hilos([fila("i", "integrado")]);
  assert.deepEqual(avisos, []);
});

test("colgado: 'pa' lo da por colgado a los 10 min; a los 15 sin eventos ni nada en vuelo es una falla", async () => {
  const { av, avisos, avanzar } = armar();
  await av.hilos([fila("c", "trabajando")]);
  await av.hilos([fila("c", "colgado")]);
  av.revisar();
  assert.deepEqual(avisos, [], "recién colgado: 10 min");
  avanzar(COLGADO_MS - 10 * 60_000 - 1000);
  av.revisar();
  assert.deepEqual(avisos, [], "todavía no llegó a 15");
  avanzar(2000);
  av.revisar();
  av.revisar();
  assert.equal(avisos.length, 1, "una vez");
  assert.equal(avisos[0].tipo, "colgado");
  assert.ok((avisos[0].minutos ?? 0) >= 15);
  assert.match(textoParaLider(avisos[0]), /falló: parece colgado/);
});

test("colgado que se mueve (un evento suyo, o vuelve a trabajar) no avisa", async () => {
  const { av, avisos, avanzar } = armar();
  await av.hilos([fila("c", "colgado"), fila("d", "colgado")]);
  av.eventos([{ tipo: "parar", id: "c" }]);
  await av.hilos([fila("c", "colgado"), fila("d", "trabajando")]);
  avanzar(20 * 60_000);
  av.revisar();
  assert.deepEqual(avisos.map((a) => a.id), ["c"], "c volvió a estar colgado después del evento; d volvió a trabajar");
  assert.equal(av.vigilando(), true, "c sigue colgado");
});

test("tanda: avisa cuando terminan todos los de un líder (con dos o más), contando las fallas", async () => {
  const { av, avisos } = armar();
  await av.hilos([fila("1", "trabajando"), fila("2", "trabajando"), fila("3", "trabajando")]);
  await av.hilos([fila("1", "entregado"), fila("2", "murio"), fila("3", "trabajando")]);
  assert.ok(!avisos.some((a) => a.tipo === "tanda"));
  await av.hilos([fila("1", "entregado"), fila("2", "murio"), fila("3", "listo")]);
  const tanda = avisos.find((a) => a.tipo === "tanda");
  assert.equal(tanda?.n, 3);
  assert.equal(tanda?.fallas, 1);
  assert.equal(textoParaLider(tanda!), "");
});

test("un worker solo no arma tanda", async () => {
  const { av, avisos } = armar();
  await av.hilos([fila("1", "trabajando")]);
  await av.hilos([fila("1", "entregado")]);
  assert.deepEqual(avisos.map((a) => a.tipo), ["fin"]);
});

// Lo que va al líder (`alLider`): aparte de lo del dueño (`emitir`).
function armarLider(modo: "tanda" | "worker" = "tanda", rastros: Record<string, string> = {}, cupos: Parameters<typeof crearAvisosWorker>[0]["cupos"] = undefined) {
  const alDueno: AvisoWorker[] = [];
  const alLider: AvisoWorker[] = [];
  let t = 1_000_000_000_000;
  const av = crearAvisosWorker({ leerRastro: async (h) => rastros[h.id] ?? "", cupos, emitir: (a) => alDueno.push(a), alLider: (a) => alLider.push(a), avisoLider: () => modo, ahora: () => t });
  return { av, alDueno, alLider, avanzar: (ms: number) => (t += ms) };
}

test("por defecto, el líder recibe un solo mensaje al terminar la tanda, con una línea por worker", async () => {
  const { av, alDueno, alLider } = armarLider();
  await av.hilos([fila("1", "trabajando"), fila("2", "trabajando"), fila("3", "trabajando")]);
  await av.hilos([fila("1", "entregado"), fila("2", "murio"), fila("3", "trabajando")]);
  assert.deepEqual(alLider, [], "todavía hay uno vivo: nada");
  await av.hilos([fila("1", "entregado"), fila("2", "murio"), fila("3", "listo")]);
  assert.deepEqual(alLider.map((a) => a.tipo), ["tanda"]);
  const texto = textoParaLider(alLider[0]);
  assert.match(texto, /^\[Aviso automático de Trama\] Terminaron los 3 workers que lanzaste, 1 con falla:\n/);
  assert.match(texto, /^- «tarea de 1» \(1\): terminó\.$/m);
  assert.match(texto, /^- «tarea de 2» \(2\): falló: el proceso se cortó sin dejar mensaje\.$/m);
  assert.match(texto, /^- «tarea de 3» \(3\): terminó\.$/m);
  assert.equal(alDueno.filter((a) => a.tipo === "tanda").length, 1, "el dueño sigue viendo el resumen de la tanda");
});

test("por defecto, un cupo o un colgado van al líder al momento, y la tanda los repite al cerrar", async () => {
  const { av, alLider } = armarLider("tanda", { a: "Individual quota reached for gemini" }, () => ({ suscripciones: [] }));
  await av.hilos([fila("a", "trabajando"), fila("b", "trabajando")]);
  await av.hilos([fila("a", "murio"), fila("b", "trabajando")]);
  assert.deepEqual(alLider.map((a) => a.tipo), ["cupo"], "el cupo no espera a la tanda");
  await av.hilos([fila("a", "murio"), fila("b", "entregado")]);
  assert.deepEqual(alLider.map((a) => a.tipo), ["cupo", "tanda"]);
  assert.deepEqual(alLider[1].lineas?.map((l) => [l.id, l.tipo]), [["a", "cupo"], ["b", "fin"]]);
});

test("por defecto, un colgado va al líder al momento", async () => {
  const { av, alLider, avanzar } = armarLider();
  await av.hilos([fila("c", "colgado")]);
  avanzar(20 * 60_000);
  av.revisar();
  assert.deepEqual(alLider.map((a) => a.tipo), ["colgado"]);
});

test("por worker, cada fin o falla va al líder al momento y no sale tanda", async () => {
  const { av, alLider } = armarLider("worker");
  await av.hilos([fila("1", "trabajando"), fila("2", "trabajando")]);
  await av.hilos([fila("1", "entregado"), fila("2", "trabajando")]);
  assert.deepEqual(alLider.map((a) => [a.tipo, a.id]), [["fin", "1"]]);
  await av.hilos([fila("1", "entregado"), fila("2", "murio")]);
  assert.deepEqual(alLider.map((a) => a.tipo), ["fin", "falla"]);
  assert.equal(textoParaLider(alLider[1]), "[Aviso automático de Trama] Worker «tarea de 2» falló: el proceso se cortó sin dejar mensaje. Id: 2. Revisalo con `pa --hilo 2`.");
});

test("un worker solo: el líder recibe lo de siempre, con su id", async () => {
  const { av, alLider } = armarLider();
  await av.hilos([fila("1", "trabajando")]);
  await av.hilos([fila("1", "entregado")]);
  assert.equal(alLider.length, 1);
  assert.equal(textoParaLider(alLider[0]), "[Aviso automático de Trama] Worker «tarea de 1» terminó. Id: 1. Revisalo con `pa --hilo 1`.");
});

test("utilidades: cupo, proveedor, motivo en una línea, tarea corta, cuándo vuelve", () => {
  assert.ok(esDeCupo("Individual quota reached") && esDeCupo("HTTP 429") && esDeCupo("You've hit your limit"));
  assert.ok(!esDeCupo("error 4290 de compilación") && !esDeCupo("ENOENT"));
  assert.deepEqual(proveedorDe("agy:gemini-d"), { id: "google", nombre: "Google" });
  assert.equal(proveedorDe("claude-c").id, "claude");
  assert.equal(motivoDe("a\n\x1b[31mIndividual quota reached\x1b[0m\nultima línea"), "Individual quota reached");
  assert.equal(motivoDe("uno\ndos"), "dos");
  assert.equal(motivoDe(""), "");
  assert.equal(tareaCorta("\n[x] Objetivo: " + "a".repeat(100)).length, 60);
  assert.equal(vuelveDe({ claude: { cincoH: 100, sieteD: 10, reseteaCincoH: 5_000_000 }, suscripciones: [] }, "claude", 1000), 5000);
  assert.equal(vuelveDe({ suscripciones: [{ proveedor: "google", ventanas: [{ pct: 100, vuelve: 900 }] }] }, "google", 1000), null, "ya pasó");
});
