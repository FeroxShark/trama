// Tests de la lógica pura del mapa de flujo B3 (src/hilo/flujo/flujo-logica.ts):
// estados semánticos, grafo con subagentes y cadenas sigue_de, curvas ancladas, resalte y encuadre.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Estado, Hilo, Lider } from "../src/datos/contrato.ts";
import type { Subagente } from "../electron/subagentes.ts";
import type { EncargoOrquestador } from "../electron/orquestador-texto.ts";
import {
  armarGrafo,
  cadenaRelacionada,
  calcularEncuadre,
  curvaPuertos,
  estadoDeLider,
  estadoDeOrquestador,
  estadoDeSubagente,
  estadoDeWorker,
  type ParamsGrafo,
} from "../src/hilo/flujo/flujo-logica.ts";

const TEXTOS: ParamsGrafo["textos"] = {
  liderNuevo: "Nuevo líder",
  liderSub: "En escucha",
  liderEscucha: "En escucha",
  liderPensando: "Trabajando",
  liderPide: "Pide decisión",
  liderDormido: "Dormido",
  liderCaido: "Falló",
  subMarca: "Subagente",
  subCorriendo: "Corriendo",
  subListo: "Listo",
  subFallo: "Falló",
  workerCola: "En cola",
  workerDecision: "Esperando decisión",
  workerFalta: "Falta información",
  workerFallo: "Falló la corrida",
  workerFrenado: "Frenado",
  workerTrabaja: "Trabajando",
  workerListo: "Listo",
  commits: (n) => `${n} commits`,
};

const hilo = (id: string, extra: Partial<Hilo> = {}): Hilo => ({
  id,
  proyecto: "trama",
  tarea: `Tarea ${id}`,
  modelo: "claude-haiku-4-5",
  effort: "med",
  origen: "app",
  jefe: "trama-eb",
  jefe_id: "sid-1",
  sigue_de: null,
  estado: "trabajando",
  en_cola: false,
  inicio: 1700000000,
  duracion_s: null,
  puesto: "1",
  rama: `pa/trama/${id}`,
  commits: 0,
  decision: null,
  decision_nada: null,
  resultado: null,
  archivado: null,
  leer: false,
  cache_ttl_s: null,
  cache_vence: null,
  cache_frio: null,
  cache_modelo: null,
  ...extra,
});

const lider = (extra: Partial<Lider> = {}): Lider => ({
  id: "sid-1",
  nombre: "trama-eb",
  proyecto: "trama",
  titulo: "Sonnet",
  actividad: 1700000000,
  creado: 1700000000,
  cache_ttl_s: 300,
  cache_vence: 1700000300,
  origen: "app",
  pid: 123,
  vivo: true,
  ocupado: false,
  modelo: "claude-sonnet-4-6",
  effort: "high",
  ...extra,
});

test("estadoDeWorker clasifica cada estado semántico sin ambigüedad", () => {
  assert.equal(estadoDeWorker(hilo("1", { frenado_en: 10 }), "murio"), "pausa");
  assert.equal(estadoDeWorker(hilo("2", { en_cola: true }), "trabajando"), "queue");
  assert.equal(estadoDeWorker(hilo("3"), "decision"), "decision");
  assert.equal(estadoDeWorker(hilo("4"), "falta-info"), "decision");
  assert.equal(estadoDeWorker(hilo("5"), "murio"), "error");
  assert.equal(estadoDeWorker(hilo("6"), "colgado"), "error");
  assert.equal(estadoDeWorker(hilo("7", { fallo: true }), "entregado"), "error");
  assert.equal(estadoDeWorker(hilo("8"), "trabajando"), "run");
  assert.equal(estadoDeWorker(hilo("9"), "listo"), "ok");
  assert.equal(estadoDeWorker(hilo("10"), "integrado"), "ok");
});

test("estadoDeLider y estadoDeSubagente reflejan actividad, decisión y fallos", () => {
  assert.equal(estadoDeLider(null), "lider");
  assert.equal(estadoDeLider(lider()), "lider");
  assert.equal(estadoDeLider(lider({ ocupado: true })), "run");
  assert.equal(estadoDeLider(lider({ pide: true })), "decision");
  assert.equal(estadoDeLider(lider({ caido: "murio" })), "error");

  const sub = (estado: Subagente["estado"]): Subagente => ({
    id: "s1",
    sid: "sid-1",
    descripcion: "Explorar",
    tipo: "Explore",
    modelo: "haiku",
    estado,
    inicio: 1,
    ultimo_en: 2,
    ultimo: null,
    tokens: 0,
    resultado: null,
    hay_mas: false,
    esfuerzo: null,
  });
  assert.equal(estadoDeSubagente(sub("corriendo")), "orq");
  assert.equal(estadoDeSubagente(sub("error")), "error");
  assert.equal(estadoDeSubagente(sub("parado")), "pausa");
  assert.equal(estadoDeSubagente(sub("terminado")), "ok");
});

test("armarGrafo conecta líder, subagentes, workers paralelos y dependencias sigue_de con flecha inversa en decisión", () => {
  const w1 = hilo("w1", { estado: "trabajando" });
  const w2 = hilo("w2", { estado: "decision", decision: "¿Dónde va el botón?" });
  const w3 = hilo("w3", { estado: "murio", resultado: "EPERM" });
  const w4 = hilo("w4", { estado: "listo", commits: 2, sigue_de: "w1" });
  const sub: Subagente = {
    id: "sub1",
    sid: "sid-1",
    descripcion: "Analizar contexto",
    tipo: "Explore",
    modelo: "sonnet",
    estado: "corriendo",
    inicio: 1,
    ultimo_en: 2,
    ultimo: "Leyendo contexto.ts",
    tokens: 12000,
    resultado: null,
    hay_mas: false,
    esfuerzo: null,
  };

  const g = armarGrafo({
    lider: lider(),
    contextoLider: "19k · 18%",
    cacheLider: "4m",
    workers: [w1, w2, w3, w4],
    estadoWorker: (h) => h.estado as Estado,
    subagentes: [sub],
    tituloWorker: (h) => h.tarea,
    tiempoWorker: () => "12 s",
    modeloCorto: (m) => m ?? "",
    textos: TEXTOS,
  });

  assert.equal(g.nodos.length, 6); // líder + 1 subagente + 4 workers
  assert.equal(g.resumen.corriendo, 2); // subagente + w1
  assert.equal(g.resumen.decision, 1);
  assert.equal(g.resumen.error, 1);
  assert.equal(g.resumen.listo, 1);

  const arDec = g.aristas.find((a) => a.a === "w:w2");
  assert.equal(arDec?.tipo, "decision");
  assert.equal(arDec?.inversa, true, "una consulta/decisión corre de vuelta hacia el líder");
  assert.equal(arDec?.particula, true);

  const arCadena = g.aristas.find((a) => a.a === "w:w4");
  assert.equal(arCadena?.de, "w:w1", "sigue_de se engancha al worker padre visible");
  assert.ok(g.nodos.find((n) => n.id === "w:w4")!.x > g.nodos.find((n) => n.id === "w:w1")!.x);

  const rel = cadenaRelacionada(g.aristas, "w:w4")!;
  assert.ok(rel.has("lider:sid-1") && rel.has("w:w1") && rel.has("w:w4"));
  assert.ok(!rel.has("w:w3"), "ramas ajenas se atenúan");
});

test("curvaPuertos ancla exactamente en borde derecho de origen e izquierdo de destino y calcularEncuadre centra el grafo", () => {
  const c = curvaPuertos({ x: 40, y: 100, w: 200 }, { x: 340, y: 200, w: 240 }, 100, 100);
  assert.ok(c.d.startsWith("M 245 150 C "));
  assert.ok(c.d.endsWith("335 250"));
  assert.equal(c.my, 200);

  const cam = calcularEncuadre(
    [
      { id: "a", x: 40, y: 100, w: 240 },
      { id: "b", x: 420, y: 240, w: 260 },
    ],
    new Map([
      ["a", 100],
      ["b", 120],
    ]),
    900,
    600,
  );
  assert.ok(cam.z >= 0.35 && cam.z <= 1.04);
  assert.ok(Number.isFinite(cam.x) && Number.isFinite(cam.y));
});

const encargo = (id: string, extra: Partial<EncargoOrquestador> = {}): EncargoOrquestador => ({
  id,
  lider_sid: "sid-1",
  proyecto: "trama",
  modelo: "claude-sonnet-5-5",
  effort: "high",
  preset_contexto: "equilibrado",
  objetivo: `Objetivo ${id}`,
  restricciones: [],
  verificacion: "",
  estado: "ejecutando",
  workers: [],
  creado: 1700000000,
  actualizado: 1700000000,
  ...extra,
});

const grafoCon = (orquestadores: EncargoOrquestador[], workers: Hilo[] = []) =>
  armarGrafo({
    lider: lider(),
    workers,
    estadoWorker: (h) => h.estado as Estado,
    subagentes: [],
    orquestadores,
    tituloWorker: (h) => h.tarea,
    tiempoWorker: () => "12 s",
    modeloCorto: (m) => m ?? "",
    textos: TEXTOS,
  });

test("estadoDeOrquestador cubre los cinco estados del encargo", () => {
  assert.equal(estadoDeOrquestador(encargo("a", { estado: "revisando" })), "orq");
  assert.equal(estadoDeOrquestador(encargo("b", { estado: "consulta" })), "decision");
  assert.equal(estadoDeOrquestador(encargo("c", { estado: "ejecutando" })), "orq");
  assert.equal(estadoDeOrquestador(encargo("d", { estado: "listo" })), "ok");
  assert.equal(estadoDeOrquestador(encargo("e", { estado: "error" })), "error");
});

test("un orquestador en consulta pide decisión con la flecha de vuelta hacia el líder", () => {
  const o = encargo("o1", {
    estado: "consulta",
    propuesta: { resumen: "Hay dos caminos", opciones: [], recomendacion: "" },
  });
  const g = grafoCon([o]);
  const n = g.nodos.find((x) => x.id === "orq:o1")!;
  assert.equal(n.tipo, "orquestador");
  assert.equal(n.estado, "decision");
  assert.equal(n.subtitulo, "Hay dos caminos");
  assert.equal(n.encargo, o);
  const a = g.aristas.find((x) => x.a === "orq:o1")!;
  assert.equal(a.de, "lider:sid-1");
  assert.equal(a.inversa, true);
  assert.equal(a.etiquetaClave, "consulta");
  assert.equal(a.particula, true);
  assert.equal(g.resumen.decision, 1);
});

test("los workers de un orquestador cuelgan de su nodo y las cadenas pasan a la columna siguiente", () => {
  const g = grafoCon(
    [encargo("o1", { workers: ["w1", "w2"] })],
    // w3 es más nuevo y w4 sigue a w3: el orden de llegada no tiene que cambiar las columnas.
    [hilo("w1"), hilo("w2"), hilo("w3", { sigue_de: "w1", inicio: 1700000100 }), hilo("w4", { sigue_de: "w3", inicio: 1700000200 })],
  );
  const nodo = (id: string) => g.nodos.find((x) => x.id === id)!;
  const orq = nodo("orq:o1");
  for (const id of ["w:w1", "w:w2"]) {
    assert.ok(nodo(id).x > orq.x);
    assert.equal(g.aristas.find((a) => a.a === id)?.de, "orq:o1");
  }
  assert.equal(nodo("w:w1").y, orq.y);
  assert.ok(nodo("w:w3").x > nodo("w:w1").x);
  assert.equal(nodo("w:w4").x, nodo("w:w3").x);
  assert.notEqual(nodo("w:w4").y, nodo("w:w3").y);
  assert.equal(g.resumen.corriendo, 5);

  const rel = cadenaRelacionada(g.aristas, "w:w3")!;
  assert.ok(["lider:sid-1", "orq:o1", "w:w1", "w:w3"].every((id) => rel.has(id)));
  assert.ok(!rel.has("w:w2"));
});
