// Ajustes > Plan y cupos: la tarjeta de Google AI Pro lee la suscripción igual que la barra (por proveedor), con sus 3 grupos y 5 h + semana.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { test } from "node:test";
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

const { suscripcionDe, filasDeCupos } = await import("../src/datos/cuentas.ts");
const { renglonesDeGrupos } = await import("../src/barra/cuposVista.ts");

const v = (id: string, pct: number) => ({ id, pct, vuelve: null });
/** Lo que llega de `reparto --cupos` (Gemini con 5 h y semana, Claude y GPT, Argon sólo semana). */
const subs = [
  {
    id: "google",
    nombre: "Google AI Pro",
    proveedor: "google",
    cuenta: "google",
    ts: 0,
    grupos: [
      { id: "gemini", nombre: "Gemini", ventanas: [v("5h", 51), v("7d", 19)] },
      { id: "claude-gpt", nombre: "Claude y GPT por Google", ventanas: [v("5h", 0), v("7d", 100)] },
      { id: "gemini-4-argon", nombre: "Gemini 4 Argon", ventanas: [v("7d", 100)] },
    ],
  },
];

test("la tarjeta recibe los 3 grupos de Google, cada uno con sus ventanas", () => {
  const g = suscripcionDe(subs, "google");
  assert.ok(g?.grupos);
  const filas = renglonesDeGrupos(g.grupos, 0);
  assert.deepEqual(filas.map((f) => f.g.id), ["gemini", "claude-gpt", "gemini-4-argon"]);
  assert.deepEqual(filas[0].cols.map((c) => c?.id), ["5h", "7d"]);
});

test("encuentra la misma suscripción que la barra aunque el id no sea «google»", () => {
  const otra = [{ ...subs[0], id: "google-pro", proveedor: "google", cuenta: "google" }];
  assert.equal(suscripcionDe(otra, "google")?.id, "google-pro");
  assert.equal(filasDeCupos(otra, undefined, "principal").filas[0].s, suscripcionDe(otra, "google"));
});

test("con una cuenta agregada gana la de siempre; sin Google, nada", () => {
  const extra = { ...subs[0], id: "google-casa", proveedor: "google", cuenta: "casa" };
  assert.equal(suscripcionDe([extra, ...subs], "google")?.id, "google");
  assert.equal(suscripcionDe([], "google"), undefined);
  assert.equal(suscripcionDe(undefined, "google"), undefined);
});
