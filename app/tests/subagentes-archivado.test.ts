import { test } from "node:test";
import assert from "node:assert/strict";
import type { Subagente } from "../electron/subagentes.ts";
import {
  activo,
  pintaSub,
  archivarSub,
  archivarTodosSubs,
  esSubArchivado,
  limpiarArchivadosSubs,
} from "../src/barra/subagentes-archivado.ts";

test("los subagentes terminados se identifican como no activos y se pueden archivar", () => {
  limpiarArchivadosSubs();
  const ahora = 10000;
  const corriendo: Subagente = {
    id: "sub-1",
    sid: "lider-a",
    descripcion: "Corriendo algo",
    modelo: "Haiku 5.5",
    tipo: "general-purpose",
    estado: "corriendo",
    inicio: ahora - 50,
    ultimo_en: ahora - 10,
    ultimo: "Bash: git status",
    tokens: 1000,
    resultado: null,
    hay_mas: false,
  };
  const terminado1: Subagente = {
    id: "sub-2",
    sid: "lider-a",
    descripcion: "Terminado 1",
    modelo: "Haiku 5.5",
    tipo: "general-purpose",
    estado: "terminado",
    inicio: ahora - 200,
    ultimo_en: ahora - 100,
    ultimo: "Listo",
    tokens: 2000,
    resultado: "Reporte 1",
    hay_mas: false,
  };
  const terminado2: Subagente = {
    id: "sub-3",
    sid: "lider-a",
    descripcion: "Terminado 2",
    modelo: "Haiku 5.5",
    tipo: "general-purpose",
    estado: "terminado",
    inicio: ahora - 300,
    ultimo_en: ahora - 150,
    ultimo: "Listo",
    tokens: 3000,
    resultado: "Reporte 2",
    hay_mas: false,
  };

  assert.equal(activo(corriendo, ahora), true);
  assert.equal(activo(terminado1, ahora), false);
  assert.equal(activo(terminado2, ahora), false);

  assert.equal(esSubArchivado("lider-a", "sub-2"), false);
  archivarSub("lider-a", "sub-2");
  assert.equal(esSubArchivado("lider-a", "sub-2"), true);
  assert.equal(esSubArchivado("lider-a", "sub-3"), false);

  archivarTodosSubs("lider-a", ahora, [corriendo, terminado1, terminado2]);
  assert.equal(esSubArchivado("lider-a", "sub-1"), false);
  assert.equal(esSubArchivado("lider-a", "sub-2"), true);
  assert.equal(esSubArchivado("lider-a", "sub-3"), true);

  limpiarArchivadosSubs();
  assert.equal(esSubArchivado("lider-a", "sub-2"), false);
  assert.equal(esSubArchivado("lider-a", "sub-3"), false);
});

test("silencio: pasados 15 min sin eventos y sin herramienta en vuelo ya no está activo; con una herramienta en vuelo sigue", () => {
  const ahora = 100000;
  const base: Subagente = { id: "s", sid: "l", descripcion: "x", modelo: null, tipo: null, estado: "corriendo", inicio: ahora - 7000, ultimo_en: ahora - 14 * 60, ultimo: null, tokens: 0, resultado: null, hay_mas: false };
  assert.equal(activo(base, ahora), true, "14 min: todavía");
  const callado = { ...base, ultimo_en: ahora - 16 * 60 };
  assert.equal(activo(callado, ahora), false, "16 min sin nada");
  assert.equal(activo({ ...callado, en_vuelo: true }, ahora), true, "esperando una herramienta");
  assert.deepEqual(pintaSub(callado, false), { tipo: "frenado", clave: "sub.parado" }, "se ve con palabra: Parado");
  assert.deepEqual(pintaSub({ ...base, estado: "parado" }, false), { tipo: "frenado", clave: "sub.parado" });
  assert.deepEqual(pintaSub(base, true), { tipo: "trab", clave: "sub.corriendo" });
  assert.deepEqual(pintaSub({ ...base, estado: "terminado" }, false), { tipo: "term", clave: "sub.terminado" }, "el fin normal sigue como hoy");
  assert.equal(activo({ ...base, estado: "parado" }, ahora), false);
});
