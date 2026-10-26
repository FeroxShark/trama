// «Modelos para workers» (Ajustes > Modelos): el parseo de `reparto --tabla --json` (electron/reparto-tabla.ts), la lógica de la tabla
// (src/paneles/modelos-workers.ts: interruptor → `excluir` por id, inteligencia → `calidad`, búsqueda, grupos) y que `calidad` va y vuelve
// por modelos.json sin perder lo que el panel no conoce. Puro: sin React ni puente.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FilaTabla } from "../electron/reparto-tabla.ts";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !/\.\w+$/.test(spec) && ctx.parentURL?.startsWith("file:")) {
      const ts = path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec + ".ts");
      if (existsSync(ts)) return next(spec + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const { parsearTabla } = await import("../electron/reparto-tabla.ts");
const { fechaCorta, nombreVisible, origenDe, agrupar, calidadEscrita, claveCalidad, estadoDe, filasUnicas, filtrar, inteligenciaDe, ponerInteligencia, ponerPermitido, reglasSueltas } = await import("../src/paneles/modelos-workers.ts");
const { borradorDe, configDe, sucio } = await import("../src/paneles/modelos-borrador.ts");
const { guardarModelos, leerModelos } = await import("../electron/modelos-config.ts");
const { validarConfig, leerConfig } = await import("../electron/modelos-tipos.ts");
const { MAQUINAS_CONTRATO } = await import("../electron/maquinas-contrato.ts").catch(() => ({ MAQUINAS_CONTRATO: null as unknown as Record<string, string> }));

const tmp = mkdtempSync(path.join(os.tmpdir(), "mdl-workers-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const SALIDA = JSON.stringify({
  version: 1,
  leido: "2026-10-26T12:00:00Z",
  modelos: [
    { id: "claude-opus-5-5", nombre: "Claude Opus 5.5", proveedor: "claude", familia: "opus", familia_excluir: "opus", cuenta: "claude", calidad: 100, estimada: false, gratis: false, cupo_libre: 0.7, vuelve: "2026-10-30T12:00:00Z", ventanas: [{ id: "5h", libre: 0.8, vuelve: "2026-10-26T14:00:00Z" }], urgencia: 0.5, permitido: true, excluido_por: null, agotado: false },
    { id: "claude-sonnet-5-5", nombre: "Claude Sonnet 5.5", proveedor: "claude", familia: "sonnet", familia_excluir: "sonnet", cuenta: "claude", calidad: 88, estimada: false, gratis: false, cupo_libre: 0.7, vuelve: null, ventanas: [], urgencia: 0, permitido: true, excluido_por: null, agotado: false },
    { id: "claude-sonnet-5-5", nombre: "Claude Sonnet 5.5", proveedor: "claude", familia: "sonnet", familia_excluir: "sonnet", cuenta: "segunda", calidad: 88, estimada: false, gratis: false, cupo_libre: 0.9, vuelve: null, ventanas: [], urgencia: 0, permitido: true, excluido_por: null, agotado: false },
    { id: "opencode:opencode/zeta-ultra-free", nombre: "zeta-ultra-free (OpenCode, gratis)", proveedor: "opencode", familia: "dsh", familia_excluir: "opencode", cuenta: null, calidad: 60, estimada: true, gratis: true, cupo_libre: 1, vuelve: null, ventanas: [], urgencia: 0, permitido: true, excluido_por: null, agotado: false },
    { id: "opencode:opencode/beam-free", nombre: "beam-free", proveedor: "opencode", familia: "dsh", familia_excluir: "opencode", cuenta: null, calidad: 40, estimada: false, gratis: true, cupo_libre: 1, vuelve: null, ventanas: [], urgencia: 0, permitido: true, excluido_por: null, agotado: false },
    { calidad: 3 },
  ],
});
const filas = (): FilaTabla[] => parsearTabla(SALIDA)!.modelos;
const borrador = (c: object = {}) => borradorDe({ version: 1, ruta: "/x", existe: true, error: null, efectivo: null, config: { workers: {}, locales: [], excluir: [], calidad: {}, permitir_max: false, gemini: {}, claude: {}, destrabar: {}, ...c } });

test("parsearTabla: pasa fracciones a %, fechas a ms, ignora lo que no es una fila y rechaza otra versión o JSON roto", () => {
  const t = parsearTabla(SALIDA)!;
  assert.equal(t.modelos.length, 5);
  const o = t.modelos[0]!;
  assert.equal(o.libre, 70);
  assert.equal(o.vuelve, Date.parse("2026-10-30T12:00:00Z"));
  assert.deepEqual(o.ventanas, [{ id: "5h", libre: 80, vuelve: Date.parse("2026-10-26T14:00:00Z") }]);
  assert.equal(t.modelos[3]!.estimada, true);
  assert.equal(t.modelos[3]!.familiaExcluir, "opencode");
  assert.equal(parsearTabla("no es json"), null);
  assert.equal(parsearTabla(JSON.stringify({ version: 2, modelos: [] })), null);
  assert.equal(parsearTabla(JSON.stringify({ version: 1 })), null);
});

test("filasUnicas: un modelo en varias cuentas es una fila (la de más cupo libre)", () => {
  const u = filasUnicas(filas());
  assert.equal(u.length, 4);
  assert.equal(u.find((f) => f.id === "claude-sonnet-5-5")!.libre, 90);
});

test("interruptor: apagar anota el id exacto en excluir, prender lo saca; una regla de familia deja el interruptor sin poder prenderse", () => {
  const f = filas()[3]!;
  const apagado = ponerPermitido(borrador(), f, false);
  assert.deepEqual(apagado.excluir, ["opencode:opencode/zeta-ultra-free"]);
  assert.equal(estadoDe(f, apagado).permitido, false);
  assert.equal(estadoDe(f, apagado).regla, null);
  assert.deepEqual(ponerPermitido(apagado, f, true).excluir, []);
  assert.deepEqual(ponerPermitido(apagado, f, false).excluir, apagado.excluir, "no se repite");
  const fam = borrador({ excluir: ["opus"] });
  const o = filas()[0]!;
  assert.deepEqual(estadoDe(o, fam), { permitido: false, regla: "opus" });
  assert.deepEqual(ponerPermitido(fam, o, true).excluir, ["opus"], "la familia sigue: se saca en Reglas");
  // una regla con * y una de prefijo
  assert.equal(estadoDe(f, borrador({ excluir: ["opencode:*"] })).permitido, false);
});

test("inteligencia: se fija en calidad por familia (Claude) o por id (OpenCode), 'estimada' hasta que se fija, y vaciar la devuelve a la estimada", () => {
  const [opus, , , zeta] = filas() as [FilaTabla, FilaTabla, FilaTabla, FilaTabla];
  assert.equal(claveCalidad(opus), "opus");
  assert.equal(claveCalidad(zeta), "opencode:opencode/zeta-ultra-free");
  assert.deepEqual(inteligenciaDe(zeta, borrador()), { valor: 60, estimada: true, fijada: false });
  const b = ponerInteligencia(borrador(), zeta, 72);
  assert.deepEqual(b.calidad, { "opencode:opencode/zeta-ultra-free": 72 });
  assert.deepEqual(inteligenciaDe(zeta, b), { valor: 72, estimada: false, fijada: true });
  assert.deepEqual(ponerInteligencia(b, zeta, null).calidad, {});
  assert.deepEqual(ponerInteligencia(borrador(), opus, 90).calidad, { opus: 90 });
  assert.equal(calidadEscrita("100"), 100);
  assert.equal(calidadEscrita(" 0 "), 0);
  for (const mal of ["", "101", "-1", "7.5", "abc", "1000"]) assert.equal(calidadEscrita(mal), null, mal);
});

test("agrupar y filtrar: por empresa en orden fijo, sin grupos vacíos; la búsqueda mira nombre, id y proveedor sin tildes", () => {
  const u = filasUnicas(filas());
  const g = agrupar(u, borrador({ excluir: ["opencode:opencode/beam-free"] }));
  assert.deepEqual(g.map((x) => [x.grupo, x.filas.length, x.permitidos]), [["anthropic", 2, 2], ["opencode", 2, 1]]);
  assert.deepEqual(g[1]!.filas.map((f) => f.id), ["opencode:opencode/zeta-ultra-free", "opencode:opencode/beam-free"], "de más a menos inteligente");
  assert.deepEqual(filtrar(u, "ZETA ultra").map((f) => f.id), ["opencode:opencode/zeta-ultra-free"]);
  assert.deepEqual(filtrar(u, "opencode").length, 2);
  assert.equal(filtrar(u, "nada de nada").length, 0);
  assert.equal(filtrar(u, "  ").length, u.length);
});

test("reglasSueltas: las familias y los patrones siguen a la vista; los ids de la tabla no", () => {
  assert.deepEqual(reglasSueltas(["fable", "opencode:opencode/beam-free", "agy:*"], filas()), ["fable", "agy:*"]);
});

test("calidad viaja por modelos.json: se valida, se escribe sin perder lo demás y el borrador la ve sucia hasta guardar", async () => {
  assert.throws(() => validarConfig({ calidad: { opus: 101 } }));
  assert.throws(() => validarConfig({ calidad: { opus: 7.5 } }));
  assert.throws(() => validarConfig({ calidad: { "con espacio": 5 } }));
  assert.throws(() => validarConfig({ calidad: [] }));
  assert.deepEqual(leerConfig({ calidad: { opus: 90, malo: "x", fuera: 300 } }).calidad, { opus: 90 });

  const ruta = path.join(tmp, "modelos.json");
  writeFileSync(ruta, JSON.stringify({ version: 1, excluir: ["fable"], calidad: { "dsh:deepseek/*pro*": 85 }, peso_costo: 9 }));
  const e0 = await leerModelos(undefined, ruta);
  let b = borradorDe(e0);
  assert.equal(sucio(e0, b), false);
  b = ponerInteligencia(b, filas()[3]!, 72);
  b = ponerPermitido(b, filas()[3]!, false);
  assert.equal(sucio(e0, b), true);
  const e1 = await guardarModelos(configDe(b), undefined, ruta);
  const j = JSON.parse(readFileSync(ruta, "utf8"));
  assert.deepEqual(j.calidad, { "dsh:deepseek/*pro*": 85, "opencode:opencode/zeta-ultra-free": 72 });
  assert.deepEqual(j.excluir, ["fable", "opencode:opencode/zeta-ultra-free"]);
  assert.equal(j.peso_costo, 9, "las claves que el panel no conoce se conservan");
  assert.equal(sucio(e1, borradorDe(e1)), false);
  // sin entradas la clave sale
  const vacio = ponerInteligencia(ponerInteligencia(borradorDe(e1), filas()[3]!, null), { ...filas()[0]!, id: "x", familia: "dsh", proveedor: "opencode" } as FilaTabla, null);
  await guardarModelos({ ...configDe({ ...vacio, calidad: { "dsh:deepseek/*pro*": 85 } })!, calidad: {} }, undefined, ruta);
  assert.equal("calidad" in JSON.parse(readFileSync(ruta, "utf8")), false);
});

test("el canal reparto:tabla existe en el contrato de máquinas y es local (sólo lee)", () => {
  if (MAQUINAS_CONTRATO) assert.equal(MAQUINAS_CONTRATO["reparto:tabla"], "local");
  const src = readFileSync(path.join(import.meta.dirname, "..", "electron", "maquinas-contrato.ts"), "utf8");
  assert.match(src, /"reparto:tabla": "local"/);
  const nucleo = readFileSync(path.join(import.meta.dirname, "..", "electron", "nucleo.ts"), "utf8");
  assert.match(nucleo, /manejar\("reparto:tabla"/);
});

const fila = (o: Partial<FilaTabla>): FilaTabla => ({ ...(JSON.parse(SALIDA) as { modelos: never[] }).modelos[0], ...o }) as unknown as FilaTabla;

test("parsearTabla lee origen y fecha de Artificial Analysis; un reparto sin ellos da defecto o estimada", () => {
  const t = parsearTabla(JSON.stringify({ version: 1, modelos: [
    { id: "a", calidad: 70, origen: "artificial-analysis", aa_fecha: "2026-10-25", estimada: false },
    { id: "b", calidad: 50, estimada: true },
    { id: "c", calidad: 60 },
    { id: "d", calidad: 60, origen: "raro", aa_fecha: "ayer" },
  ] }))!;
  assert.deepEqual(t.modelos.map((m) => [m.origen, m.aaFecha]), [["artificial-analysis", "2026-10-25"], ["estimada", null], ["defecto", null], ["defecto", null]]);
});

test("origenDe: lo fijado en el borrador es tuyo; AA lleva su fecha; estimada y defecto", () => {
  const b0 = borrador();
  const aa = fila({ id: "claude-haiku-5-5", familia: "haiku", proveedor: "claude", origen: "artificial-analysis", aaFecha: "2026-10-25", estimada: false });
  assert.deepEqual(origenDe(aa, b0), { tipo: "aa", fecha: "25/10" });
  assert.deepEqual(origenDe(aa, ponerInteligencia(b0, aa, 70)), { tipo: "usuario", fecha: null });
  assert.equal(origenDe(fila({ origen: "usuario" }), b0).tipo, "usuario");
  assert.equal(origenDe(fila({ origen: "estimada", estimada: true }), b0).tipo, "estimada");
  assert.equal(origenDe(fila({ origen: "defecto", estimada: false }), b0).tipo, "defecto");
  assert.equal(fechaCorta("2026-01-05T10:00:00Z"), "05/01");
  assert.equal(fechaCorta(null), null);
  assert.equal(fechaCorta("ayer"), null);
});

test("nombreVisible: en inglés se traduce lo que va entre paréntesis; en español no se toca", () => {
  assert.equal(nombreVisible("glm-5.3-flash-free (OpenCode, gratis)", "en"), "glm-5.3-flash-free (OpenCode, free)");
  assert.equal(nombreVisible("glm-5.3-flash-free (OpenCode, gratis)", "es"), "glm-5.3-flash-free (OpenCode, gratis)");
  assert.equal(nombreVisible("deepseek-v4.1-pro (DeepSeek, de pago)", "en"), "deepseek-v4.1-pro (DeepSeek, paid)");
  assert.equal(nombreVisible("Claude Opus 5.5 (por Google)", "en"), "Claude Opus 5.5 (via Google)");
  assert.equal(nombreVisible("gratis-model-x", "en"), "gratis-model-x", "el nombre del modelo no se traduce");
  assert.equal(nombreVisible("GPT-6.1 Sol (Codex)", "en"), "GPT-6.1 Sol (Codex)");
});

test("los canales de Artificial Analysis son locales y la refrescada es sólo de la PC", () => {
  const src = readFileSync(path.join(import.meta.dirname, "..", "electron", "maquinas-contrato.ts"), "utf8");
  assert.match(src, /"aa:estado": "local"/);
  assert.match(src, /"aa:refrescar": "local"/);
  const nucleo = readFileSync(path.join(import.meta.dirname, "..", "electron", "nucleo.ts"), "utf8");
  assert.match(nucleo, /SOLO_PC_TAILNET[^\n]*"aa:refrescar"/);
});
