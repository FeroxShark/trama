// Modelo y esfuerzo elegidos con el líder trabajando (src/hilo/pendiente.ts): nunca se bloquean, no tocan el turno en curso
// y lo que difiere de lo que usa el turno se marca como pendiente.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !path.extname(spec) && ctx.parentURL?.includes("/src/")) {
      const base = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec);
      for (const f of [base + ".ts", base + ".tsx", path.join(base, "index.ts")])
        if (existsSync(f)) return next(path.relative(path.dirname(fileURLToPath(ctx.parentURL)), f).replace(/\\/g, "/").replace(/^(?!\.)/, "./"), ctx);
    }
    return next(spec, ctx);
  },
});

const { opcionesEnTurno, pendienteDe, seguirServidor } = await import("../src/hilo/pendiente.ts");

const turno = { modelo: "claude-opus-5-5", effort: "high" };

test("un cambio del servidor conserva el modelo y el esfuerzo que la persona ya eligió", () => {
  assert.equal(seguirServidor("modelo-caja", "modelo-anterior", "modelo-nuevo"), "modelo-caja");
  assert.equal(seguirServidor("low", "high", "medium"), "low");
});

test("la caja sigue el cambio del servidor si todavía tiene sus valores anteriores", () => {
  assert.equal(seguirServidor("modelo-anterior", "modelo-anterior", "modelo-nuevo"), "modelo-nuevo");
  assert.equal(seguirServidor("high", "high", "medium"), "medium");
});

test("un cambio de esfuerzo con el mismo modelo llega a la caja y el eco conserva la elección local", async () => {
  const { llegaServidor } = await import("../src/hilo/pendiente.ts");
  const opus = (effort: string) => ({ modelo: "claude-opus-5-5", effort });
  // Sin nada elegido acá: el esfuerzo nuevo del servidor llega a la caja.
  const sigue = llegaServidor(opus("high"), { visto: opus("high"), propio: null }, opus("medium"));
  assert.deepEqual(sigue.caja, opus("medium"));
  // Con otro esfuerzo elegido acá: el eco no lo pisa.
  const queda = llegaServidor(opus("low"), { visto: opus("high"), propio: opus("low") }, opus("medium"));
  assert.deepEqual(queda.caja, opus("low"));
  // Con otro modelo en la caja, el esfuerzo del servidor no se mezcla.
  const otro = llegaServidor({ modelo: "claude-sonnet-5-5", effort: "low" }, { visto: opus("high"), propio: null }, opus("medium"));
  assert.deepEqual(otro.caja, { modelo: "claude-sonnet-5-5", effort: "low" });
  assert.equal(seguirServidor("high", "high", "medium"), "medium");
  assert.equal(seguirServidor("low", "high", "medium"), "low");
});

test("sin turno en curso no hay nada pendiente (el próximo mensaje sale con lo elegido y ya)", () => {
  assert.deepEqual(pendienteDe({ ocupado: false, modelo: "claude-sonnet-5-5", effort: "low", turno }), { modelo: false, effort: false });
});

test("con un turno en curso: lo igual a lo del turno no se marca", () => {
  assert.deepEqual(pendienteDe({ ocupado: true, modelo: "claude-opus-5-5", effort: "high", turno }), { modelo: false, effort: false });
});

test("con un turno en curso: otro esfuerzo se marca como pendiente, y el modelo no", () => {
  assert.deepEqual(pendienteDe({ ocupado: true, modelo: "claude-opus-5-5", effort: "low", turno }), { modelo: false, effort: true });
});

test("con un turno en curso: otro modelo se marca como pendiente (su esfuerzo viaja con él, no se marca aparte)", () => {
  assert.deepEqual(pendienteDe({ ocupado: true, modelo: "claude-sonnet-5-5", effort: "low", turno }), { modelo: true, effort: false });
});

test("sin datos del turno (líder todavía sin lista) no marca nada", () => {
  assert.deepEqual(pendienteDe({ ocupado: true, modelo: "claude-sonnet-5-5", effort: "low", turno: null }), { modelo: false, effort: false });
  assert.deepEqual(pendienteDe({ ocupado: true, modelo: "claude-sonnet-5-5", effort: "low", turno: { modelo: undefined, effort: "high" } }), { modelo: false, effort: false });
});

test("un modelo sin niveles de esfuerzo nunca marca esfuerzo", () => {
  const sin = { modelo: "opencode:opencode/big-pickle", effort: "high" };
  assert.deepEqual(pendienteDe({ ocupado: true, modelo: sin.modelo, effort: "low", turno: { modelo: sin.modelo, effort: "high" } }), { modelo: false, effort: false });
});

const ops = ["claude-opus-5-5", "claude-sonnet-5-5", "gemini-4-argon", "agy:claude-opus-5-5", "opencode:opencode/big-pickle"].map((id) => ({ id, desc: "d" }));

test("con un turno en curso, los modelos del mismo motor se eligen y los de otro motor se ven apagados con el porqué", () => {
  const r = opcionesEnTurno(ops, true, "claude-opus-5-5", "otro motor");
  assert.deepEqual(r.filter((o) => !o.deshabilitada).map((o) => o.id), ["claude-opus-5-5", "claude-sonnet-5-5"]);
  assert.ok(r.filter((o) => o.deshabilitada).every((o) => o.desc === "otro motor"));
});

test("sin turno en curso las opciones quedan como están (cambiar de motor sigue con su confirmación)", () => {
  assert.equal(opcionesEnTurno(ops, false, "claude-opus-5-5", "x"), ops);
});

test("la caja no bloquea los selectores por un turno en curso", () => {
  const lider = readFileSync(path.join(import.meta.dirname, "..", "src", "hilo", "Lider.tsx"), "utf8");
  assert.doesNotMatch(lider, /disabled=\{app && ocupado\}/, "ni el de modelo ni el de esfuerzo llevan disabled por el turno");
  assert.match(lider, /pendiente=\{pend\.effort/);
  assert.match(lider, /pendiente=\{pend\.modelo/);
});

// El bug del selector que iba y volvía sin parar (Compactar con Haiku y seguir con Fable, 2026-11-24: 241 `set_model` en 9 s):
// la caja seguía cada eco del servidor y le devolvía lo seguido. Simulación: la caja manda sólo lo elegido acá y los ecos llegan tarde.
const { elegidoAca, llegaServidor } = await import("../src/hilo/pendiente.ts");
type Sel = { modelo: string; effort: string };
const H: Sel = { modelo: "claude-haiku-5-5", effort: "max" };
const F: Sel = { modelo: "claude-fable-5-2", effort: "high" };

/** Una caja con su seguimiento; `mandados` es lo que le mandó al main (`cola.elegir`). */
function caja(inicial: Sel) {
  let sel = inicial;
  let s = { visto: inicial as Sel | null, propio: null as Sel | null };
  const mandados: Sel[] = [];
  return {
    elegir(x: Sel) {
      s = elegidoAca(s, x);
      sel = x;
      mandados.push(x);
    },
    eco(x: Sel) {
      const r = llegaServidor(sel, s, x);
      s = r.s;
      sel = r.caja;
    },
    get sel() {
      return sel;
    },
    get s() {
      return s;
    },
    mandados,
  };
}

test("un eco tardío de lo que la caja mandó antes no la deja yendo y viniendo: F→H→F termina en F y no manda nada más", () => {
  const c = caja(F);
  c.elegir(H);
  c.elegir(F);
  // Volvió a lo que dice el servidor: el eco tardío de H puede moverla una vez (no se le devuelve) y el de F la deja en F.
  c.eco(H);
  c.eco(F);
  assert.deepEqual(c.sel, F);
  assert.deepEqual(c.mandados, [H, F]);
  assert.equal(c.s.propio, null);
});

test("el eco que confirma lo elegido deja la caja siguiendo al servidor otra vez", () => {
  const c = caja(F);
  c.elegir(H);
  c.eco(H);
  assert.equal(c.s.propio, null);
  const opus = { modelo: "claude-opus-5-5", effort: "medium" };
  c.eco(opus);
  assert.deepEqual(c.sel, opus);
});

test("sin nada propio en camino, la caja sigue al servidor y elegir lo mismo que dice no deja nada pendiente", () => {
  const c = caja(F);
  c.elegir(F);
  assert.equal(c.s.propio, null);
  c.eco(H);
  assert.deepEqual(c.sel, H);
});

test("elegir algo y volver a lo que dice el servidor sin eco de por medio (líder dormido) no deja la caja sin seguirlo", () => {
  const c = caja(F);
  c.elegir(H);
  c.elegir(F);
  assert.equal(c.s.propio, null);
  const opus = { modelo: "claude-opus-5-5", effort: "medium" };
  c.eco(opus);
  assert.deepEqual(c.sel, opus);
});

test("lo elegido acá que el servidor todavía no dice se conserva aunque cambie otra cosa del servidor", () => {
  const c = caja(F);
  c.elegir(H);
  const opus = { modelo: "claude-opus-5-5", effort: "medium" };
  c.eco(opus);
  assert.deepEqual(c.sel, H);
});

test("un esfuerzo elegido después del modelo no lo pisa la confirmación del modelo con el esfuerzo de antes", () => {
  const c = caja(F);
  const opusMedio = { modelo: "claude-opus-5-5", effort: "medium" };
  const opusAlto = { modelo: "claude-opus-5-5", effort: "high" };
  c.elegir(opusMedio);
  c.elegir(opusAlto);
  c.eco(opusMedio);
  assert.deepEqual(c.sel, opusAlto);
  c.eco(opusAlto);
  assert.equal(c.s.propio, null);
});

test("la caja no le devuelve al main lo que tomó del servidor (Lider.tsx: sólo manda lo elegido acá)", () => {
  const fuente = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/hilo/Lider.tsx"), "utf8");
  const efecto = fuente.slice(fuente.indexOf("const selVista"), fuente.indexOf("cola.elegir(l.id"));
  assert.match(efecto, /elegidaAca\.current/);
});
