// src/datos/fuente.ts con un `window.hilos` falso: lo que hace con lo que
// contesta `pa --hilos`. Los imports de src/ van sin extensión (los resuelve
// Vite): acá un hook de resolución les busca el `.ts`. `window` y `location`
// van antes del import (puente.ts y modo.ts los leen al cargar).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !path.extname(spec) && ctx.parentURL?.includes("/src/")) {
      const base = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec);
      for (const f of [base + ".ts", base + ".tsx", path.join(base, "index.ts")])
        if (existsSync(f)) return next(path.relative(path.dirname(fileURLToPath(ctx.parentURL)), f).replace(/\\/g, "/").replace(/^(?!\.)/, "./"), ctx);
    }
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    if (!url.endsWith(".tsx")) return next(url, ctx);
    const { code } = transformSync(readFileSync(fileURLToPath(url), "utf8"), { loader: "tsx", format: "esm", jsx: "automatic", sourcefile: url });
    return { format: "module", source: code, shortCircuit: true };
  },
});

// `pa --hilos` contesta un JSON sin `version`.
const leer = async () => ({ n: 1, datos: { hilos: [] } });
const sinSoltar = () => () => {};
const trama: { avisoVuelta?: () => Promise<unknown> } = {};
Object.assign(globalThis, {
  location: { search: "?fixtures=0" },
  window: { hilos: { hilos: { leer, guardados: async () => null, alCambiar: sinSoltar, alEvento: sinSoltar }, trama } },
});

const { fuente, planDiaValido, reporteValido } = await import("../src/datos/fuente.ts");
const { recargarProyectos } = await import("../src/datos/proyectos.ts");
const { aplicarUso } = await import("../src/barra/useUso.ts");
const { altoFila, olvidarAlto, ponerLista } = await import("../src/barra/ventana.ts");
const { t } = await import("../src/i18n/index.ts");

test("pa --hilos sin version: el error previsto, también al volver a pedir", async () => {
  await assert.rejects(fuente.hilos(), { message: t("error.sinVersion") });
  await assert.rejects(fuente.hilos(), { message: t("error.sinVersion") });
});

test("AvisoVuelta vuelve a pedir el aviso al remontar tras un rechazo del puente", async (t) => {
  const { leerAvisoVuelta } = await import("../src/barra/AvisoVuelta.tsx");
  const aviso = { de: "0.2.26", a: "0.2.25", motivo: "lento" };
  let llamadas = 0;
  trama.avisoVuelta = async () => {
    if (++llamadas === 1) throw new Error("fallo transitorio");
    return aviso;
  };
  t.after(() => {
    delete trama.avisoVuelta;
  });

  assert.equal(await leerAvisoVuelta(), null);
  assert.deepEqual(await leerAvisoVuelta(), aviso);
  assert.deepEqual(await leerAvisoVuelta(), aviso);
  assert.equal(llamadas, 2);
});

test("planDiaValido: conserva fechas ISO YYYY-MM-DD en ausente y descarta formatos inválidos", () => {
  assert.deepEqual(planDiaValido({ modo: "ahorrar", ausente: ["2026-11-22", "2026-11-23", "mal", "2026-1-2", 123] }), {
    modo: "ahorrar",
    ausente: ["2026-11-22", "2026-11-23"],
  });
  assert.deepEqual(planDiaValido(null), { modo: "normal", ausente: [] });
});

test("aplicarUso: preserva el uso válido previo cuando llega null o error por suscripción o releer", () => {
  const valido = { version: 1 as const, ts: 100, five_hour: { pct: 40, resets_at: 200 }, seven_day: null };
  const s1 = aplicarUso({ uso: undefined, fallo: false }, valido);
  assert.deepEqual(s1, { uso: valido, fallo: false });
  // Si después llega error o null por suscripción, no borra los números previos y marca fallo.
  assert.deepEqual(aplicarUso(s1, { error: "timeout" }, false), { uso: valido, fallo: true });
  assert.deepEqual(aplicarUso(s1, null, false), { uso: valido, fallo: true });
  // Una lectura buena limpia el fallo.
  const nuevo = { ...valido, ts: 150 };
  assert.deepEqual(aplicarUso({ uso: valido, fallo: true }, nuevo, false), { uso: nuevo, fallo: false });
});

test("recargarProyectos: no borra la lista ante un fallo IPC y descarta respuestas viejas fuera de orden", async () => {
  const p1 = [{ slug: "atlas", nombre: "atlas", titulo: "Atlas", ruta: "/p/atlas", existe: true, estado: null, retiradoEl: null, reemplazo: null, logo: false }];
  const p2 = [{ slug: "brote", nombre: "brote", titulo: "Brote", ruta: "/p/brote", existe: true, estado: null, retiradoEl: null, reemplazo: null, logo: false }];
  await recargarProyectos({ lista: async () => p1 });
  // Si el canal falla, conserva p1 en vez de vaciar a [].
  const trasFallo = await recargarProyectos({
    lista: async () => {
      throw new Error("ipc fallo");
    },
  });
  assert.deepEqual(trasFallo, p1);

  // Dos recargas concurrentes: la primera termina después de la segunda y no debe pisarla.
  let resolverLenta!: (v: typeof p1) => void;
  const lenta = recargarProyectos({
    lista: () =>
      new Promise((r) => {
        resolverLenta = r;
      }),
  });
  const rapida = await recargarProyectos({ lista: async () => p2 });
  assert.deepEqual(rapida, p2);
  resolverLenta(p1);
  assert.deepEqual(await lenta, p2);
});

test("altoFila: consulta .w:not(.sub):not(.pliegue) para no cachear el alto de un subagente o pliegue", () => {
  const prevGetComputedStyle = (globalThis as { getComputedStyle?: unknown }).getComputedStyle;
  (globalThis as { getComputedStyle?: unknown }).getComputedStyle = (el: { height: string }) => ({ height: el.height });
  try {
    olvidarAlto();
    const selectores: string[] = [];
    ponerLista({
      querySelector: (sel: string) => {
        selectores.push(sel);
        return sel === ".w:not(.sub):not(.pliegue)" ? { height: "28px", offsetHeight: 28 } : { height: "120px", offsetHeight: 120 };
      },
    } as unknown as HTMLElement);
    assert.equal(altoFila(), 28);
    assert.deepEqual(selectores, [".w:not(.sub):not(.pliegue)"]);
    ponerLista(null);
    olvidarAlto();
  } finally {
    (globalThis as { getComputedStyle?: unknown }).getComputedStyle = prevGetComputedStyle;
  }
});

test("reporteValido: una respuesta rara no muestra el error de «cuentas» (con su {rc} sin reemplazar)", () => {
  for (const raro of [null, undefined, {}, { ok: false }, { ok: true, carpeta: 3 }, "x"]) assert.deepEqual(reporteValido(raro), { ok: false, error: "main.reporteFallo" });
  assert.deepEqual(reporteValido({ ok: false, error: "EACCES" }), { ok: false, error: "EACCES" });
  assert.doesNotMatch(t("main.reporteFallo"), /\{/);
});
