import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Los imports de src/ van sin extensión (los resuelve Vite): acá se les busca el `.ts`.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !path.extname(spec) && ctx.parentURL?.includes("/src/")) {
      const base = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec);
      for (const f of [base + ".ts", base + ".tsx", path.join(base, "index.ts")])
        if (existsSync(f)) return next(path.relative(path.dirname(fileURLToPath(ctx.parentURL)), f).replace(/^(?!\.)/, "./"), ctx);
    }
    return next(spec, ctx);
  },
});

const { effortPara, filtrarProyectos, plano, recientesDe } = await import("../src/hilo/elegir.ts");

const P = [
  { nombre: "orquestador", slug: "orquestador" },
  { nombre: "Atlas Web", slug: "atlas" },
  { nombre: "Diseño Gráfico", slug: "diseno" },
  { nombre: "Libro", slug: "libro" },
  { nombre: "brote", slug: "brote" },
];
const nombres = (ps: { nombre: string }[]) => ps.map((p) => p.nombre);

test("plano saca acentos y mayúsculas", () => {
  assert.equal(plano("Diseño GRÁFICO"), "diseno grafico");
});

test("filtra por nombre y por slug, sin acentos ni mayúsculas", () => {
  assert.deepEqual(nombres(filtrarProyectos(P, "orq")), ["orquestador"]);
  assert.deepEqual(nombres(filtrarProyectos(P, "ATL")), ["Atlas Web"]);
  assert.deepEqual(nombres(filtrarProyectos(P, "diseño")), ["Diseño Gráfico"]);
  assert.deepEqual(nombres(filtrarProyectos(P, "grafico")), ["Diseño Gráfico"]);
  assert.deepEqual(nombres(filtrarProyectos(P, "  web ")), ["Atlas Web"]);
  assert.deepEqual(filtrarProyectos(P, "zzz"), []);
});

test("sin búsqueda: los usados hace poco primero, después por nombre", () => {
  const r = { brote: 300, libro: 200 };
  assert.deepEqual(nombres(filtrarProyectos(P, "", r)), ["brote", "Libro", "Atlas Web", "Diseño Gráfico", "orquestador"]);
});

test("con búsqueda: el que empieza con lo escrito gana a uno reciente que sólo lo contiene", () => {
  const ps = [...P, { nombre: "hilos", slug: "hilos" }];
  assert.deepEqual(nombres(filtrarProyectos(ps, "li", { hilos: 999 })), ["Libro"]);
  assert.deepEqual(nombres(filtrarProyectos(ps, "o", { hilos: 999 })), ["orquestador", "hilos", "brote", "Diseño Gráfico", "Libro"]);
});

test("recientesDe se queda con el hilo más nuevo de cada proyecto", () => {
  assert.deepEqual(
    recientesDe([
      { proyecto: "atlas", inicio: 10 },
      { proyecto: "atlas", inicio: 30 },
      { proyecto: "brote", inicio: 20 },
    ]),
    { atlas: 30, brote: 20 },
  );
});

test("el esfuerzo se recuerda por modelo; sin preferencia, la tabla de routing", () => {
  assert.equal(effortPara("claude-opus-5-5", {}), "high");
  assert.equal(effortPara("claude-sonnet-5-5", {}), "high");
  assert.equal(effortPara("claude-fable-5-1", {}), "high");
  const prefs = { "claude-opus-5-5": "high", "claude-sonnet-5-5": "medium" };
  assert.equal(effortPara("claude-sonnet-5-5", prefs), "medium");
  assert.equal(effortPara("claude-opus-5-5", prefs), "high");
  assert.equal(effortPara("claude-opus-5-5", { "claude-opus-5-5": "xhigh" }), "xhigh");
});
