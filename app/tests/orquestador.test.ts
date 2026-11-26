// Pruebas del motor del Orquestador de fondo (orquestador-texto.ts y orquestador.ts): presets de contexto por rol,
// parser de respuestas (CONSULTA / EJECUTAR), flujo completo con revisión previa y retoma (caliente y vencida),
// flujo directo, manejo de errores, persistencia atómica y armado de argumentos para `pa --async`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CACHE_ORQ_MS,
  MAX_ENCARGOS,
  PRESETS_CONTEXTO_ORQ,
  construirArgsWorkerPa,
  crearOrquestador,
  esPresetContextoOrq,
  extraerIdPa,
  parsearRespuestaOrquestador,
  promptConDecision,
  promptRevisionPrevia,
  topeOrquestadorDePreset,
  topeWorkerDePreset,
  type EncargoOrquestador,
  type PedidoModeloOrq,
  type PedidoWorkerOrq,
} from "../electron/orquestador.ts";

function conDirTemp(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "trama-orq-test-"));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => rmSync(dir, { recursive: true, force: true }));
}

test("presets de contexto: topes del orquestador y workers en ahorro, equilibrado, profundo y manual", () => {
  assert.deepEqual(PRESETS_CONTEXTO_ORQ, ["ahorro", "equilibrado", "profundo", "manual"]);
  assert.equal(esPresetContextoOrq("equilibrado"), true);
  assert.equal(esPresetContextoOrq("otro"), false);
  assert.equal(esPresetContextoOrq(null), false);

  // ahorro
  assert.equal(topeOrquestadorDePreset("ahorro"), 200_000);
  assert.equal(topeWorkerDePreset("ahorro", "mecanico"), 150_000);
  assert.equal(topeWorkerDePreset("ahorro", "lectura"), 150_000);
  assert.equal(topeWorkerDePreset("ahorro", "codigo-acotado"), 200_000);
  assert.equal(topeWorkerDePreset("ahorro", "codigo-multi"), 200_000);
  assert.equal(topeWorkerDePreset("ahorro", "diseno"), 200_000);
  assert.equal(topeWorkerDePreset("ahorro"), 200_000);

  // equilibrado
  assert.equal(topeOrquestadorDePreset("equilibrado"), 300_000);
  assert.equal(topeWorkerDePreset("equilibrado", "mecanico"), 200_000);
  assert.equal(topeWorkerDePreset("equilibrado", "lectura"), 200_000);
  assert.equal(topeWorkerDePreset("equilibrado", "codigo-acotado"), 300_000);
  assert.equal(topeWorkerDePreset("equilibrado", "frontend"), 300_000);
  assert.equal(topeWorkerDePreset("equilibrado", "default"), 300_000);
  assert.equal(topeWorkerDePreset("equilibrado", null), 300_000);
  assert.equal(topeWorkerDePreset("equilibrado", "codigo-multi"), 400_000);
  assert.equal(topeWorkerDePreset("equilibrado", "diseno"), 400_000);
  assert.equal(topeWorkerDePreset("equilibrado", "diseño"), 400_000);
  assert.equal(topeWorkerDePreset("equilibrado", "debug"), 400_000);

  // profundo
  assert.equal(topeOrquestadorDePreset("profundo"), 500_000);
  assert.equal(topeWorkerDePreset("profundo", "mecanico"), 300_000);
  assert.equal(topeWorkerDePreset("profundo", "lectura"), 300_000);
  assert.equal(topeWorkerDePreset("profundo", "codigo-acotado"), 500_000);
  assert.equal(topeWorkerDePreset("profundo", "debug"), 500_000);

  // manual
  assert.equal(topeOrquestadorDePreset("manual"), null);
  assert.equal(topeWorkerDePreset("manual", "mecanico"), null);
  assert.equal(topeWorkerDePreset("manual", "codigo-multi"), null);
});

test("parsearRespuestaOrquestador: CONSULTA estándar y tolerancia a markdown/acentos", () => {
  const salida = [
    "VEREDICTO: CONSULTA",
    "RESUMEN: El módulo ya tiene dos rutas de configuración y cambiar la clave rompe compatibilidad.",
    "OPCIONES:",
    "- Mantener la clave vieja como alias de lectura",
    "- Migrar el archivo al arrancar con respaldo",
    "RECOMENDACION: Mantener el alias evita tocar instalaciones existentes.",
  ].join("\n");

  const r = parsearRespuestaOrquestador(salida);
  assert.equal(r.veredicto, "consulta");
  assert.equal(r.workers.length, 0);
  assert.equal(r.propuesta?.resumen, "El módulo ya tiene dos rutas de configuración y cambiar la clave rompe compatibilidad.");
  assert.deepEqual(r.propuesta?.opciones, [
    "Mantener la clave vieja como alias de lectura",
    "Migrar el archivo al arrancar con respaldo",
  ]);
  assert.equal(r.propuesta?.recomendacion, "Mantener el alias evita tocar instalaciones existentes.");

  const conMarkdown = [
    "## **VEREDICTO:** consulta",
    "**RESUMEN:** Falta definir el alcance.",
    "**OPCIONES:**",
    "1. Sólo backend",
    "2. Backend y pantalla",
    "**RECOMENDACIÓN:** Arrancar sólo por backend.",
  ].join("\n");
  const r2 = parsearRespuestaOrquestador(conMarkdown);
  assert.equal(r2.veredicto, "consulta");
  assert.deepEqual(r2.propuesta?.opciones, ["Sólo backend", "Backend y pantalla"]);
  assert.equal(r2.propuesta?.recomendacion, "Arrancar sólo por backend.");
});

test("parsearRespuestaOrquestador: EJECUTAR con bloque JSON, tope de 6 workers y tolerancia a formatos", () => {
  const salida = [
    "VEREDICTO: EJECUTAR",
    "RESUMEN: Dos workers en paralelo sobre archivos disjuntos.",
    "```json",
    JSON.stringify({
      workers: [
        { tarea: "Crear parser puro", tipo: "codigo-acotado", preset: "codigo", titulo: "Parser", advisor: "opus" },
        { tarea: "Revisar logs", tipo: "lectura", preset: "minimo", leer: true, advisor: "ninguno" },
        { tarea: "   " }, // inválida: se descarta
      ],
    }),
    "```",
  ].join("\n");

  const r = parsearRespuestaOrquestador(salida);
  assert.equal(r.veredicto, "ejecutar");
  assert.equal(r.resumen, "Dos workers en paralelo sobre archivos disjuntos.");
  assert.equal(r.propuesta, undefined);
  assert.deepEqual(r.workers, [
    { tarea: "Crear parser puro", tipo: "codigo-acotado", preset: "codigo", titulo: "Parser", advisor: "opus" },
    { tarea: "Revisar logs", tipo: "lectura", preset: "minimo", leer: true },
  ]);

  // JSON sin cercar + más de 6 workers -> recorta a 6
  const ocho = Array.from({ length: 8 }, (_, i) => ({ tarea: `Tarea ${i + 1}`, tipo: "mecanico" }));
  const sinCercar = `VEREDICTO: EJECUTAR\nRESUMEN: Tanda grande.\n${JSON.stringify({ workers: ocho })}`;
  const r3 = parsearRespuestaOrquestador(sinCercar);
  assert.equal(r3.veredicto, "ejecutar");
  assert.equal(r3.workers.length, 6);

  // Texto vacío o roto nunca tira excepción
  assert.equal(parsearRespuestaOrquestador("").veredicto, "consulta");
  assert.equal(parsearRespuestaOrquestador("texto libre sin formato").veredicto, "consulta");
});

test("builders de prompts: incluyen encargo, restricciones, formato y decisión previa", () => {
  const p1 = promptRevisionPrevia({
    proyecto: "trama",
    objetivo: "Agregar presets de contexto",
    restricciones: ["No tocar Windows todavía"],
    verificacion: "npm test",
  });
  assert.match(p1, /trama/);
  assert.match(p1, /No tocar Windows todavía/);
  assert.match(p1, /VEREDICTO: CONSULTA/);
  assert.match(p1, /VEREDICTO: EJECUTAR/);

  const p2 = promptConDecision({
    proyecto: "trama",
    objetivo: "Agregar presets de contexto",
    restricciones: [],
    verificacion: "npm test",
    propuesta: { resumen: "Dos opciones", opciones: ["Opción A", "Opción B"], recomendacion: "Opción A" },
    decision: "Ir por la opción A",
    cacheVencida: true,
  });
  assert.match(p2, /Ir por la opción A/);
  assert.match(p2, /Dos opciones/);
  assert.match(p2, /arrancás limpio/i);
});

test("flujo completo con revisión previa: revisando -> consulta (0 workers) -> retomar con decisión -> ejecutando -> listo", () =>
  conDirTemp(async (dir) => {
    let reloj = 1_700_000_000_000;
    const llamadasModelo: PedidoModeloOrq[] = [];
    const llamadasWorker: PedidoWorkerOrq[] = [];
    const estadosVistos: string[] = [];
    let turno = 0;

    const orq = crearOrquestador({
      estadoDir: dir,
      ahora: () => reloj,
      nuevoId: () => "orq-1",
      carpetaProyecto: async () => dir,
      correrModelo: async (p) => {
        llamadasModelo.push(p);
        turno++;
        if (turno === 1) {
          return [
            "VEREDICTO: CONSULTA",
            "RESUMEN: Hay un conflicto con el esquema actual.",
            "OPCIONES:",
            "- Mantener compatibilidad",
            "- Romper y migrar",
            "RECOMENDACION: Mantener compatibilidad.",
          ].join("\n");
        }
        return [
          "VEREDICTO: EJECUTAR",
          "RESUMEN: Lanzamos dos workers compatibles.",
          "```json",
          JSON.stringify({
            workers: [
              { tarea: "Ajustar lógica principal", tipo: "codigo-multi", preset: "codigo", titulo: "Lógica", advisor: "fable" },
              { tarea: "Agregar tests unitarios", tipo: "mecanico", preset: "minimo", titulo: "Tests" },
            ],
          }),
          "```",
        ].join("\n");
      },
      lanzarWorker: async (p) => {
        llamadasWorker.push(p);
        return `20261126-19000${llamadasWorker.length}-100`;
      },
    });

    const quitar = orq.alCambiar((lista) => {
      const e = lista.find((x) => x.id === "orq-1");
      if (e) estadosVistos.push(e.estado);
    });

    const r1 = await orq.encargar({
      proyecto: "trama",
      objetivo: "Refactorizar contexto",
      restricciones: ["Sin romper contratos"],
      verificacion: "node scripts/test.mjs",
      lider_sid: "sid-lider-1",
      modelo: "claude-opus-5-5",
      effort: "high",
      preset_contexto: "equilibrado",
      advisor: "fable",
    });

    assert.equal(r1.id, "orq-1");
    assert.equal(r1.estado, "consulta");
    assert.equal(r1.workers.length, 0);
    assert.equal(llamadasWorker.length, 0);
    assert.equal(llamadasModelo[0]?.autocompact, 300_000);
    assert.equal(llamadasModelo[0]?.advisor, "fable");
    assert.equal(r1.propuesta?.recomendacion, "Mantener compatibilidad.");
    assert.equal(r1.encargo.cache_vence, reloj + CACHE_ORQ_MS);

    // Persistencia en disco: una instancia nueva lo lee igual
    const recargado = crearOrquestador({ estadoDir: dir });
    assert.equal(recargado.obtener("orq-1")?.estado, "consulta");
    assert.equal(recargado.listar("sid-lider-1").length, 1);
    assert.equal(recargado.listar("otro-sid").length, 0);

    // Retoma 10 minutos después (caché caliente < 50 min)
    reloj += 10 * 60_000;
    const r2 = await orq.encargar({
      id: "orq-1",
      proyecto: "trama",
      objetivo: "Refactorizar contexto",
      decision: "Mantener compatibilidad",
    });

    quitar();
    assert.equal(r2.estado, "listo");
    assert.equal(r2.retomo, "caliente");
    assert.deepEqual(r2.workers, ["20261126-190001-100", "20261126-190002-100"]);
    assert.deepEqual(estadosVistos, ["revisando", "consulta", "ejecutando", "listo"]);

    // Topes de contexto por tipo de worker en `equilibrado` y advisor SIN herencia automática
    assert.equal(llamadasWorker[0]?.tipo, "codigo-multi");
    assert.equal(llamadasWorker[0]?.preset, "codigo");
    assert.equal(llamadasWorker[0]?.autocompact, 400_000);
    assert.equal(llamadasWorker[0]?.advisor, "fable");
    assert.equal(llamadasWorker[0]?.liderSid, "sid-lider-1");

    assert.equal(llamadasWorker[1]?.tipo, "mecanico");
    assert.equal(llamadasWorker[1]?.preset, "minimo");
    assert.equal(llamadasWorker[1]?.autocompact, 200_000);
    assert.equal(llamadasWorker[1]?.advisor, undefined);

    // Persistido en disco en estado listo
    const disco = JSON.parse(readFileSync(path.join(dir, "orquestadores.json"), "utf8")) as { encargos: EncargoOrquestador[] };
    assert.equal(disco.encargos[0]?.estado, "listo");
    assert.deepEqual(disco.encargos[0]?.workers, ["20261126-190001-100", "20261126-190002-100"]);
  }));

test("retoma tras vencer la caché (>= 50 min): arranca limpio con resumen corto + decisión", () =>
  conDirTemp(async (dir) => {
    let reloj = 1_700_000_000_000;
    const prompts: string[] = [];
    let n = 0;

    const orq = crearOrquestador({
      estadoDir: dir,
      ahora: () => reloj,
      nuevoId: () => "orq-vencido",
      carpetaProyecto: async () => dir,
      correrModelo: async (p) => {
        prompts.push(p.prompt);
        n++;
        if (n === 1) {
          return "VEREDICTO: CONSULTA\nRESUMEN: Resumen corto previo.\nOPCIONES:\n- A\n- B\nRECOMENDACION: A";
        }
        return 'VEREDICTO: EJECUTAR\nRESUMEN: Hecho.\n```json\n{"workers":[{"tarea":"Hacer A","tipo":"codigo-acotado"}]}\n```';
      },
      lanzarWorker: async () => "20261126-191000-1",
    });

    await orq.encargar({ proyecto: "trama", objetivo: "Probar caché vencida" });
    reloj += CACHE_ORQ_MS + 1_000;

    const r = await orq.encargar({ id: "orq-vencido", proyecto: "trama", objetivo: "Probar caché vencida", decision: "Elegimos A" });
    assert.equal(r.estado, "listo");
    assert.equal(r.retomo, "limpio");
    assert.match(prompts[1]!, /arrancás limpio/i);
    assert.match(prompts[1]!, /Resumen corto previo/);
    assert.match(prompts[1]!, /Elegimos A/);
  }));

test("flujo directo (EJECUTAR de una) y revision_previa: false", () =>
  conDirTemp(async (dir) => {
    const estadosA: string[] = [];
    const estadosB: string[] = [];
    const workersLanzados: PedidoWorkerOrq[] = [];
    let seq = 0;

    const orq = crearOrquestador({
      estadoDir: dir,
      nuevoId: () => `orq-dir-${++seq}`,
      carpetaProyecto: async () => dir,
      correrModelo: async () =>
        'VEREDICTO: EJECUTAR\nRESUMEN: Directo.\n```json\n{"workers":[{"tarea":"Aplicar cambio","tipo":"codigo-acotado","preset":"codigo"}]}\n```',
      lanzarWorker: async (p) => {
        workersLanzados.push(p);
        return `20261126-192000-${workersLanzados.length}`;
      },
    });

    orq.alCambiar((lista) => {
      const a = lista.find((x) => x.id === "orq-dir-1");
      if (a) estadosA.push(a.estado);
      const b = lista.find((x) => x.id === "orq-dir-2");
      if (b) estadosB.push(b.estado);
    });

    // Con revisión previa pero veredicto EJECUTAR de una
    const rA = await orq.encargar({ proyecto: "trama", objetivo: "Cambio directo", preset_contexto: "ahorro" });
    assert.equal(rA.estado, "listo");
    assert.deepEqual(estadosA, ["revisando", "ejecutando", "listo"]);
    assert.equal(workersLanzados[0]?.autocompact, 200_000);

    // Con revision_previa: false salta directo a ejecutando
    const rB = await orq.encargar({
      proyecto: "trama",
      objetivo: "Sin revisión",
      revision_previa: false,
      preset_contexto: "manual",
    });
    assert.equal(rB.estado, "listo");
    assert.deepEqual(estadosB, ["ejecutando", "listo"]);
    assert.equal(workersLanzados[1]?.autocompact, null);
  }));

test("manejo de error limpio: fallo del modelo o de lanzarWorker deja estado error", () =>
  conDirTemp(async (dir) => {
    let falla = "modelo";
    let seq = 0;
    const orq = crearOrquestador({
      estadoDir: dir,
      nuevoId: () => `orq-err-${++seq}`,
      carpetaProyecto: async () => dir,
      correrModelo: async () => {
        if (falla === "modelo") throw new Error("Sin sesión de Claude");
        return 'VEREDICTO: EJECUTAR\nRESUMEN: Va.\n```json\n{"workers":[{"tarea":"Algo","tipo":"mecanico"}]}\n```';
      },
      lanzarWorker: async () => {
        throw new Error("pa no respondió");
      },
    });

    const r1 = await orq.encargar({ proyecto: "trama", objetivo: "Falla el modelo" });
    assert.equal(r1.estado, "error");
    assert.equal(r1.error, "Sin sesión de Claude");
    assert.equal(r1.workers.length, 0);
    assert.equal(orq.obtener("orq-err-1")?.estado, "error");

    falla = "worker";
    const r2 = await orq.encargar({ proyecto: "trama", objetivo: "Falla el worker" });
    assert.equal(r2.estado, "error");
    assert.equal(r2.error, "pa no respondió");
    assert.equal(orq.obtener("orq-err-2")?.estado, "error");
  }));

test("tope de persistencia: guarda como máximo 40 encargos recientes", () =>
  conDirTemp(async (dir) => {
    let reloj = 1_700_000_000_000;
    let seq = 0;
    const orq = crearOrquestador({
      estadoDir: dir,
      ahora: () => ++reloj,
      nuevoId: () => `orq-${++seq}`,
      carpetaProyecto: async () => dir,
      correrModelo: async () => "VEREDICTO: CONSULTA\nRESUMEN: Ok.\nOPCIONES:\n- A\nRECOMENDACION: A",
      lanzarWorker: async () => "20261126-193000-1",
    });

    for (let i = 0; i < MAX_ENCARGOS + 5; i++) {
      await orq.encargar({ proyecto: "trama", objetivo: `Encargo ${i}` });
    }
    assert.equal(orq.listar().length, MAX_ENCARGOS);
    assert.equal(orq.obtener("orq-1"), null);
    assert.ok(orq.obtener(`orq-${MAX_ENCARGOS + 5}`));
  }));

test("helpers de pa: construirArgsWorkerPa y extraerIdPa", () => {
  const args = construirArgsWorkerPa({
    proyecto: "trama",
    tarea: "Implementar módulo",
    tipo: "codigo-acotado",
    preset: "codigo",
    autocompact: 300_000,
    advisor: "opus",
    titulo: "Módulo orquestador",
    leer: true,
  });
  assert.deepEqual(args, [
    "trama",
    "--async",
    "--tipo",
    "codigo-acotado",
    "--preset",
    "codigo",
    "--autocompact",
    "300000",
    "--advisor",
    "opus",
    "--titulo",
    "Módulo orquestador",
    "--leer",
    "--",
    "Implementar módulo",
  ]);

  assert.equal(
    extraerIdPa("pa: 'trama' lanzado en background en el puesto 1 (id: 20261126-190009-292987, log: /x).\n"),
    "20261126-190009-292987",
  );
  assert.equal(extraerIdPa("pa: para esperarlo: pa --esperar 'trama' --id 20261126-190010-99\n"), "20261126-190010-99");
  assert.equal(extraerIdPa("sin id"), null);
});
