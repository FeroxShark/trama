// La carga de Ajustes > Modelos en pedazos: la tabla de «Modelos para workers» sale enseguida de la caché de Artificial Analysis
// (el refresco corre de fondo y avisa al terminar) y la config de modelos.json no espera a `pa --modelos` (que corre `reparto` por tipo).
// Los tiempos se miden y se imprimen sólo acá (en los tests); en producción no hay logs de tiempo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { crearLectorTabla, type TablaReparto } from "../electron/reparto-tabla.ts";
import { efectivoDePa, leerModelos, type CorrerPa } from "../electron/modelos-config.ts";

const TABLA: TablaReparto = { version: 1, leido: 0, modelos: [] };
const dormir = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));
const medir = async <T,>(f: () => Promise<T>): Promise<[T, number]> => {
  const t0 = performance.now();
  const r = await f();
  return [r, performance.now() - t0];
};

test("tabla: devuelve la caché enseguida aunque el refresco de Artificial Analysis tarde, y avisa cuando termina", async () => {
  let fin!: (r: { ok: boolean; vigente: boolean }) => void;
  let avisos = 0;
  const lector = crearLectorTabla({ leer: async () => TABLA, refrescar: () => new Promise((ok) => (fin = ok)), alRefrescar: () => void avisos++ });
  const [t, ms] = await medir(lector);
  console.log(`[tiempo] reparto:tabla con el refresco de AA colgado: ${ms.toFixed(1)} ms`);
  assert.equal(t, TABLA);
  assert.ok(ms < 100, `no debe esperar al refresco (${ms} ms)`);
  assert.equal(avisos, 0, "todavía no bajó nada");
  fin({ ok: true, vigente: false });
  await dormir(5);
  assert.equal(avisos, 1, "terminó con datos nuevos: avisa una vez");
});

test("tabla: un solo refresco a la vez; vigente o con fallo no avisa ni rompe", async () => {
  let llamadas = 0;
  let avisos = 0;
  const res: ({ ok: boolean; vigente?: boolean } | Error)[] = [{ ok: true, vigente: true }, new Error("sin red"), { ok: false }];
  const gate: (() => void)[] = [];
  const lector = crearLectorTabla({
    leer: async () => TABLA,
    refrescar: () => {
      const r = res[llamadas++]!;
      return new Promise((ok, mal) => gate.push(() => (r instanceof Error ? mal(r) : ok(r))));
    },
    alRefrescar: () => void avisos++,
  });
  await Promise.all([lector(), lector(), lector()]);
  assert.equal(llamadas, 1, "tres aperturas seguidas, un solo refresco en curso");
  gate[0]!();
  await dormir(5);
  await lector();
  assert.equal(llamadas, 2);
  gate[1]!();
  await dormir(5);
  await lector();
  gate[2]!();
  await dormir(5);
  assert.equal(avisos, 0);
  assert.equal(llamadas, 3);
});

test("modelos: leerModelos sin `pa` no espera a la tabla efectiva; efectivoDePa va aparte", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "carga-"));
  try {
    const ruta = path.join(dir, "modelos.json");
    writeFileSync(ruta, JSON.stringify({ version: 1, excluir: ["fable"] }));
    const lento: CorrerPa = async () => {
      await dormir(300);
      return { rc: 0, out: JSON.stringify({ lider: { modelo: "claude-opus-5-5" }, workers: {} }), dijo: "" };
    };
    const [rapido, msRapido] = await medir(() => leerModelos(undefined, ruta));
    const [ef, msEf] = await medir(() => efectivoDePa(lento));
    console.log(`[tiempo] modelos:leer ${msRapido.toFixed(1)} ms; modelos:efectivo (pa de 300 ms) ${msEf.toFixed(1)} ms`);
    assert.equal(rapido.efectivo, null);
    assert.equal(rapido.existe, true);
    assert.deepEqual(rapido.config.excluir, ["fable"]);
    assert.ok(msRapido < 150, `la config no espera a pa (${msRapido} ms)`);
    assert.equal(ef?.lider?.modelo, "claude-opus-5-5");
    assert.ok(msEf >= 250);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cableado: leer y guardar no corren pa; el efectivo y el aviso de tabla nueva tienen su canal", async () => {
  const { readFileSync } = await import("node:fs");
  const nucleo = readFileSync(path.join(import.meta.dirname, "..", "electron", "nucleo.ts"), "utf8");
  assert.match(nucleo, /manejar\("modelos:leer", \(\) => leerModelos\(\)\)/);
  assert.match(nucleo, /manejar\("modelos:efectivo", \(\) => efectivoDePa\(ejecutar\)\)/);
  assert.match(nucleo, /return guardarModelos\(config\);/);
  assert.match(nucleo, /manejar\("reparto:tabla", \(\) => tablaReparto\(\)\)/);
  assert.doesNotMatch(nucleo, /await refrescarAA\(await claveAA\(\), \{ baseUrl: process\.env\.AA_URL \}\)\.catch/);
  const contrato = readFileSync(path.join(import.meta.dirname, "..", "electron", "maquinas-contrato.ts"), "utf8");
  assert.match(contrato, /"modelos:efectivo": "local"/);
  assert.match(contrato, /"reparto:tablaNueva": "local"/);
});
