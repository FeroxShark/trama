// Las guías de pantalla (src/guia): qué pasos tocan según lo ya visto y el interruptor global, las novedades por versión, que cada
// paso tenga su texto en los dos idiomas, dónde cae el globo, y que el estado viaje por preferencias.json sin que una corrida de prueba
// vea un globo encima.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    if (spec.startsWith(".") && !/\.\w+$/.test(spec) && ctx.parentURL?.startsWith("file:")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec + ".ts");
      if (existsSync(ts)) return next(spec + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-guia-"));
process.env.HILOS_STATE = path.join(tmp, "estado");
for (const k of ["HILOS_BENCH", "HILOS_CAPTURA", "HILOS_CAPTURA_PNG", "HILOS_PRUEBA", "HILOS_GUION", "HILOS_FIXTURES"]) delete process.env[k];
after(() => rmSync(tmp, { recursive: true, force: true }));

const reg = await import("../src/guia/registro.ts");
const pos = await import("../src/guia/posicion.ts");
const est = await import("../electron/guias-estado.ts");
const prefs = await import("../electron/preferencias.ts");
const { en } = await import("../src/i18n/en.ts");
const { es } = await import("../src/i18n/es.ts");

const VACIO = { off: false, vistas: {} };
const todos = () => true;
const guiaDe = (pasos: { id: string; desde?: number }[], version = 1) =>
  ({ id: "prueba", version, nombre: "tour.g.principal", pasos: pasos.map((p) => ({ ancla: "x", titulo: "tour.nuevo", cuerpo: "tour.nuevo", ...p })) }) as unknown as import("../src/guia/registro.ts").Guia;

test("el estado: lo inválido se descarta y las versiones nunca retroceden", () => {
  assert.deepEqual(est.normalizarGuias(null), VACIO);
  assert.deepEqual(est.normalizarGuias({ off: "sí", vistas: { "ok-1": 2, "Mal Id": 1, x: 0, y: 1.5, z: "1" } }), { off: false, vistas: { "ok-1": 2 } });
  let e = est.aplicarOpGuias(VACIO, { vista: { id: "principal", version: 2 } });
  assert.deepEqual(e.vistas, { principal: 2 });
  assert.equal(est.aplicarOpGuias(e, { vista: { id: "principal", version: 1 } }), e);
  assert.equal(est.aplicarOpGuias(e, { vista: { id: "Principal!", version: 1 } }), e);
  assert.equal(est.aplicarOpGuias(e, { cualquier: 1 }), e);
  e = est.aplicarOpGuias(e, { off: true });
  assert.deepEqual(e, { off: true, vistas: { principal: 2 } });
  assert.deepEqual(est.aplicarOpGuias(e, { reiniciar: true }), { off: true, vistas: {} });
});

test("pendientes: la primera vez van todos los pasos, sin marca de novedad", () => {
  const g = guiaDe([{ id: "a" }, { id: "b" }]);
  const p = reg.pendientes(g, VACIO, todos);
  assert.deepEqual(p?.pasos.map((x) => x.id), ["a", "b"]);
  assert.equal(p?.novedad, false);
});

test("pendientes: vista la versión, no vuelve; apagadas, tampoco", () => {
  const g = guiaDe([{ id: "a" }]);
  assert.equal(reg.pendientes(g, reg.marcarVista(VACIO, g), todos), null);
  assert.equal(reg.pendientes(g, { off: true, vistas: {} }, todos), null);
});

test("pendientes: al subir la versión sólo se muestran los pasos nuevos, marcados como novedad", () => {
  const v1 = guiaDe([{ id: "a" }, { id: "b" }], 1);
  const visto = reg.marcarVista(VACIO, v1);
  const v2 = guiaDe([{ id: "a" }, { id: "b" }, { id: "c", desde: 2 }], 2);
  const p = reg.pendientes(v2, visto, todos);
  assert.deepEqual(p?.pasos.map((x) => x.id), ["c"]);
  assert.equal(p?.novedad, true);
  // Quien nunca la vio ve los tres, sin marca.
  assert.deepEqual(reg.pendientes(v2, VACIO, todos)?.pasos.map((x) => x.id), ["a", "b", "c"]);
  // Una versión nueva sin pasos nuevos no molesta.
  assert.equal(reg.pendientes(guiaDe([{ id: "a" }], 2), visto, todos), null);
  // Apagadas, ni las novedades.
  assert.equal(reg.pendientes(v2, { off: true, vistas: visto.vistas }, todos), null);
  // Tras verla, la v2 queda vista.
  assert.equal(reg.pendientes(v2, reg.marcarVista(visto, v2), todos), null);
});

test("pendientes: un paso cuya ancla no está en pantalla se saltea; sin ninguno, no hay guía", () => {
  const g = guiaDe([{ id: "a" }, { id: "b" }, { id: "c" }]);
  assert.deepEqual(reg.pendientes(g, VACIO, (p) => p.id !== "b")?.pasos.map((x) => x.id), ["a", "c"]);
  assert.equal(reg.pendientes(g, VACIO, () => false), null);
});

test("reiniciar vuelve a mostrar todo", () => {
  const g = guiaDe([{ id: "a" }]);
  const visto = reg.marcarVista(VACIO, g);
  assert.equal(reg.pendientes(g, visto, todos), null);
  assert.ok(reg.pendientes(g, est.aplicarOpGuias(visto, { reiniciar: true }), todos));
});

test("simularNovedad: sube la versión y deja como nuevos sólo los dos últimos pasos", () => {
  const base = reg.guiaPorId("principal")!;
  const { guia, estado } = reg.simularNovedad(base);
  assert.equal(guia.version, base.version + 1);
  const p = reg.pendientes(guia, estado, todos);
  assert.equal(p?.novedad, true);
  assert.deepEqual(p?.pasos.map((x) => x.id), base.pasos.slice(-2).map((x) => x.id));
});

test("candidatas: el selector abierto manda, un panel trae el suyo y Ajustes suma su categoría", () => {
  assert.deepEqual(reg.candidatas({ panel: null, categoria: null, menuModelo: true }), ["modelo"]);
  assert.deepEqual(reg.candidatas({ panel: "ajustes", categoria: "cupos", menuModelo: false }), ["ajustes", "ajustes-cupos"]);
  assert.deepEqual(reg.candidatas({ panel: "ajustes", categoria: "locales", menuModelo: false }), ["ajustes"]);
  assert.deepEqual(reg.candidatas({ panel: "ramas", categoria: null, menuModelo: false }), ["ramas", "ramas-analisis"]);
  assert.deepEqual(reg.candidatas({ panel: "tablero", categoria: null, menuModelo: false }), ["tablero"]);
  assert.deepEqual(reg.candidatas({ panel: null, categoria: null, menuModelo: false }), ["principal", "lider", "caja", "worker"]);
  for (const c of ["general", "modelos", "cupos", "proyectos", "guia"] as const) assert.ok(reg.guiaPorId(`ajustes-${c}`), c);
});

test("el registro: ids únicos, versiones coherentes y cada paso con su texto en español e inglés", () => {
  const ids = new Set<string>();
  for (const g of reg.GUIAS) {
    assert.ok(!ids.has(g.id), g.id);
    ids.add(g.id);
    assert.ok(Number.isInteger(g.version) && g.version >= 1, g.id);
    assert.ok(g.nombre in en && g.nombre in es, g.nombre);
    assert.ok(g.pasos.length > 0, g.id);
    assert.ok(est.esIdGuia(g.id), g.id);
    const pasos = new Set<string>();
    for (const p of g.pasos) {
      assert.ok(!pasos.has(p.id), `${g.id}.${p.id}`);
      pasos.add(p.id);
      assert.ok((p.desde ?? 1) >= 1 && (p.desde ?? 1) <= g.version, `${g.id}.${p.id}: desde`);
      assert.ok(p.ancla.trim(), `${g.id}.${p.id}: ancla`);
      for (const [k, min] of [[p.titulo, 3], [p.cuerpo, 20]] as const) {
        assert.ok(k in en && k in es, `${g.id}.${p.id}: falta ${k}`);
        assert.ok(en[k as keyof typeof en].length >= min && es[k as keyof typeof es].length >= min, k);
      }
    }
  }
});

test("las anclas data-guia del registro existen en el código", () => {
  const src = ["src/barra/Barra.tsx", "src/barra/Cabecera.tsx"].map((f) => readFileSync(path.join(import.meta.dirname, "..", f), "utf8")).join("\n");
  const usadas = reg.GUIAS.flatMap((g) => g.pasos.map((p) => /^\[data-guia="([\w-]+)"\]$/.exec(p.ancla)?.[1])).filter(Boolean);
  assert.ok(usadas.length >= 4);
  for (const a of usadas) assert.match(src, new RegExp(`data-guia="${a}"`), a);
});

test("guiaDeCaptura y panelDeCaptura", () => {
  assert.equal(reg.guiaDeCaptura("guia-principal")?.id, "principal");
  assert.equal(reg.guiaDeCaptura("guia-nada"), null);
  assert.equal(reg.guiaDeCaptura("ajustes"), null);
  assert.equal(reg.guiaDeCaptura(null), null);
  assert.deepEqual(reg.panelDeCaptura("ajustes-cupos"), { panel: "ajustes", categoria: "cupos" });
  assert.deepEqual(reg.panelDeCaptura("tablero"), { panel: "tablero", categoria: null });
  assert.equal(reg.panelDeCaptura("principal"), null);
});

test("el globo: del lado pedido, al contrario si no entra, siempre dentro de la ventana", () => {
  const v = { w: 1000, h: 700 };
  const g = { w: 300, h: 160 };
  const abajo = pos.colocar({ x: 400, y: 100, w: 100, h: 40 }, g, v, "abajo");
  assert.equal(abajo.lado, "abajo");
  assert.equal(abajo.y, 100 + 40 + pos.HUECO);
  const contrario = pos.colocar({ x: 400, y: 600, w: 100, h: 40 }, g, v, "abajo");
  assert.equal(contrario.lado, "arriba");
  const derecha = pos.colocar({ x: 20, y: 300, w: 200, h: 40 }, g, v, "derecha");
  assert.equal(derecha.lado, "derecha");
  // En el borde se corre, no se sale.
  const borde = pos.colocar({ x: 980, y: 100, w: 18, h: 30 }, g, v, "abajo");
  assert.ok(borde.x + g.w <= v.w - pos.MARGEN && borde.x >= pos.MARGEN);
  // Un ancla que ocupa todo: el globo queda adentro de la ventana.
  const todo = pos.colocar({ x: 0, y: 0, w: 1000, h: 700 }, g, v, "abajo");
  assert.ok(todo.x >= pos.MARGEN && todo.y >= pos.MARGEN && todo.x + g.w <= v.w && todo.y + g.h <= v.h);
});

test("en preferencias.json: se guarda por id y versión, se reinicia y se apaga, sin tocar lo demás", async () => {
  assert.deepEqual(await prefs.guiasEstado(), VACIO);
  await prefs.guardarEffort("opus", "high");
  await prefs.guardarGuias({ vista: { id: "principal", version: 1 } });
  await prefs.guardarGuias({ off: true });
  await prefs.guardarGuias({ vista: { id: "x".repeat(41), version: 1 } });
  const j = JSON.parse(readFileSync(path.join(process.env.HILOS_STATE!, "preferencias.json"), "utf8"));
  assert.deepEqual(j.guias, { off: true, vistas: { principal: 1 } });
  assert.equal(j.effort.opus, "high");
  assert.deepEqual(await prefs.guiasEstado(), { off: true, vistas: { principal: 1 } });
  assert.deepEqual(await prefs.guardarGuias({ reiniciar: true }), { off: true, vistas: {} });
  assert.deepEqual(await prefs.guardarGuias({ off: false }), VACIO);
});

test("una corrida de prueba trae las guías apagadas", async () => {
  await prefs.guardarGuias({ vista: { id: "principal", version: 1 } });
  for (const k of ["HILOS_BENCH", "HILOS_CAPTURA", "HILOS_CAPTURA_PNG", "HILOS_PRUEBA", "HILOS_GUION"]) {
    process.env[k] = "1";
    assert.equal((await prefs.guiasEstado()).off, true, k);
    delete process.env[k];
  }
  process.env.HILOS_FIXTURES = "1";
  assert.equal((await prefs.guiasEstado()).off, true);
  delete process.env.HILOS_FIXTURES;
  assert.equal((await prefs.guiasEstado()).off, false);
});
