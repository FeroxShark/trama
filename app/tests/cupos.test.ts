import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const { CACHE_QUOTA_FONDO_S, entornoCupos, parsearCuposReparto } = await import("../electron/cupos.ts");

const AHORA = Date.parse("2026-10-24T18:00:00Z");
const s = (iso: string) => Math.round(Date.parse(iso) / 1000);

/** El ejemplo del contrato (docs del orquestador, "reparto --cupos --json"). */
const CONTRATO = {
  version: 1,
  leido: "2026-10-24T17:55:00Z",
  suscripciones: [
    {
      id: "claude",
      nombre: "Claude",
      ventanas: [
        { id: "5h", usado: 0.14, vuelve: "2026-10-24T21:40:00Z" },
        { id: "7d", usado: 0.92, vuelve: "2026-10-25T15:00:00Z" },
      ],
    },
    {
      id: "google",
      nombre: "Google AI Pro",
      grupos: [
        {
          id: "gemini",
          nombre: "Gemini",
          modelos: ["gemini-3.8-flash-low"],
          ventanas: [
            { id: "5h", usado: 0.1414, vuelve: "2026-10-24T19:02:54Z" },
            { id: "7d", usado: 0.0872, vuelve: null },
          ],
        },
        {
          id: "claude-gpt",
          nombre: "Claude y GPT por Google",
          ventanas: [
            { id: "5h", usado: 0, vuelve: "2026-10-24T22:55:04Z" },
            { id: "7d", usado: null, vuelve: null },
          ],
          hasta: "2026-11-02",
        },
        { id: "gemini-4-argon", nombre: "Gemini 4 Argon", ventanas: [{ id: "7d", usado: 1, vuelve: "2026-10-25T23:38:40Z" }], agotado: "2026-10-25T23:38:40Z" },
      ],
    },
  ],
};

describe("parsearCuposReparto", () => {
  it("lee el contrato: Claude aparte y Google con sus grupos, usado 0..1 a porcentaje", () => {
    const res = parsearCuposReparto(JSON.stringify(CONTRATO), AHORA);
    assert.ok(res);
    assert.equal(res.ts, Date.parse("2026-10-24T17:55:00Z"));
    assert.deepEqual(res.claude, {
      cincoH: 14,
      sieteD: 92,
      reseteaCincoH: Date.parse("2026-10-24T21:40:00Z"),
      reseteaSieteD: Date.parse("2026-10-25T15:00:00Z"),
    });
    assert.equal(res.suscripciones.length, 1);
    const g = res.suscripciones[0];
    assert.equal(g.id, "google");
    assert.equal(g.nombre, "Google AI Pro");
    assert.equal(g.ts, s("2026-10-24T17:55:00Z"));
    assert.deepEqual(g.grupos?.map((x) => x.id), ["gemini", "claude-gpt", "gemini-4-argon"]);
    assert.deepEqual(g.grupos?.[0].ventanas, [
      { id: "5h", pct: 14, vuelve: s("2026-10-24T19:02:54Z") },
      { id: "7d", pct: 9, vuelve: null },
    ]);
    assert.equal(g.grupos?.[1].hasta, "2026-11-02");
    assert.equal(g.grupos?.[2].ventanas[0].pct, 100);
  });

  it("un usado null es sin dato (null), no 0", () => {
    const res = parsearCuposReparto(JSON.stringify(CONTRATO), AHORA);
    assert.deepEqual(res?.suscripciones[0].grupos?.[1].ventanas, [
      { id: "5h", pct: 0, vuelve: s("2026-10-24T22:55:04Z") },
      { id: "7d", pct: null, vuelve: null },
    ]);
  });

  it("`agotado` (la marca de reparto tras un 429) pasa a epoch s; vencida o ausente, no sale", () => {
    const res = parsearCuposReparto(JSON.stringify(CONTRATO), AHORA);
    assert.equal(res?.suscripciones[0].grupos?.[2].agotado, s("2026-10-25T23:38:40Z"));
    assert.equal(res?.suscripciones[0].grupos?.[0].agotado, undefined);
    const despues = Date.parse("2026-10-26T00:00:00Z");
    assert.equal(parsearCuposReparto(JSON.stringify(CONTRATO), despues)?.suscripciones[0].grupos?.[2].agotado, undefined);
    const susc = JSON.stringify({ version: 1, suscripciones: [{ id: "chatgpt", nombre: "ChatGPT", ventanas: [{ id: "5h", usado: 1, vuelve: null }], agotado: "2026-10-25T00:00:00Z" }] });
    assert.equal(parsearCuposReparto(susc, AHORA)?.suscripciones[0].agotado, s("2026-10-25T00:00:00Z"));
  });

  it("la 5 h que no aplica: `disabled` explícito, o el 0 sin hora de un grupo con la semana al 100 %, queda deshabilitada", () => {
    const json = JSON.stringify({
      version: 1,
      suscripciones: [
        {
          id: "google",
          nombre: "Google AI Pro",
          grupos: [
            // hoy reparto lo manda así (usado 0, sin hora) con la semana agotada
            { id: "claude-gpt", nombre: "Claude y GPT por Google", ventanas: [{ id: "5h", usado: 0, vuelve: null }, { id: "7d", usado: 1, vuelve: "2026-10-30T04:01:00Z" }] },
            // explícito
            { id: "otro", nombre: "Otro", ventanas: [{ id: "5h", usado: 0.2, vuelve: null, disabled: true }, { id: "7d", usado: 0.3, vuelve: null }] },
            // un 0 real (semana con lugar) NO se toca
            { id: "gemini", nombre: "Gemini", ventanas: [{ id: "5h", usado: 0, vuelve: null }, { id: "7d", usado: 0.05, vuelve: null }] },
          ],
        },
      ],
    });
    const gs = parsearCuposReparto(json, AHORA)?.suscripciones[0].grupos;
    assert.equal(gs?.[0].ventanas[0].deshabilitada, true);
    assert.equal(gs?.[0].ventanas[1].deshabilitada, undefined);
    assert.equal(gs?.[1].ventanas[0].deshabilitada, true);
    assert.equal(gs?.[2].ventanas[0].deshabilitada, undefined);
  });

  it("un grupo con `hasta` vencido no sale; el día de `hasta` todavía vale", () => {
    const hoy = Date.parse("2026-11-02T23:00:00Z");
    assert.equal(parsearCuposReparto(JSON.stringify(CONTRATO), hoy)?.suscripciones[0].grupos?.length, 3);
    const manana = Date.parse("2026-11-03T00:30:00Z");
    assert.deepEqual(parsearCuposReparto(JSON.stringify(CONTRATO), manana)?.suscripciones[0].grupos?.map((x) => x.id), ["gemini", "gemini-4-argon"]);
  });

  it("varias cuentas: la de siempre de Claude da el cupo y su nombre; las agregadas cuelgan con su proveedor y cuenta", () => {
    const json = JSON.stringify({
      version: 1,
      suscripciones: [
        { id: "claude", nombre: "Personal", proveedor: "claude", cuenta: "claude", ventanas: [{ id: "5h", usado: 0.2, vuelve: null }, { id: "7d", usado: 0.3, vuelve: null }] },
        { id: "trabajo", nombre: "Trabajo", proveedor: "claude", cuenta: "trabajo", ventanas: [{ id: "5h", usado: 0.5, vuelve: null }, { id: "7d", usado: 0.6, vuelve: null }] },
      ],
    });
    const res = parsearCuposReparto(json, AHORA);
    assert.equal(res?.claudeNombre, "Personal");
    assert.equal(res?.claude?.cincoH, 20);
    assert.deepEqual(res?.suscripciones.map((x) => [x.id, x.proveedor, x.cuenta]), [["trabajo", "claude", "trabajo"]]);
  });

  it("un proveedor nuevo con ventanas propias aparece solo, y uno vacío no", () => {
    const json = JSON.stringify({
      version: 1,
      suscripciones: [
        { id: "chatgpt", nombre: "ChatGPT Plus", ventanas: [{ id: "5h", usado: 0.5, vuelve: null }] },
        { id: "nada", nombre: "Nada", ventanas: [] },
        { id: "otra", nombre: "Otra", grupos: [{ id: "x", nombre: "X", ventanas: [], hasta: "2026-01-01" }] },
      ],
    });
    const res = parsearCuposReparto(json, AHORA);
    assert.equal(res?.claude, undefined);
    assert.deepEqual(res?.suscripciones.map((x) => x.id), ["chatgpt"]);
    assert.deepEqual(res?.suscripciones[0].ventanas, [{ id: "5h", pct: 50, vuelve: null }]);
    assert.equal(res?.suscripciones[0].grupos, undefined);
  });

  it("Claude sin las dos ventanas no se usa como fuente (no se inventa la que falta)", () => {
    const json = JSON.stringify({
      version: 1,
      suscripciones: [
        { id: "claude", nombre: "Claude", ventanas: [{ id: "5h", usado: 0.2, vuelve: null }, { id: "7d", usado: null, vuelve: null }] },
        { id: "google", nombre: "Google AI Pro", grupos: [{ id: "g", nombre: "G", ventanas: [{ id: "7d", usado: 0.1, vuelve: null }] }] },
      ],
    });
    assert.equal(parsearCuposReparto(json, AHORA)?.claude, undefined);
  });

  it("otra versión, JSON roto o nada que mostrar dan null", () => {
    assert.equal(parsearCuposReparto("no es json", AHORA), null);
    assert.equal(parsearCuposReparto(JSON.stringify({ ...CONTRATO, version: 2 }), AHORA), null);
    assert.equal(parsearCuposReparto(JSON.stringify({ version: 1, suscripciones: [] }), AHORA), null);
  });
});

describe("entornoCupos: la lectura de fondo no relanza `agy -p /quota` a cada rato", () => {
  it("de fondo pone la caché larga de /quota; a pedido de la persona, no toca nada", () => {
    assert.equal(entornoCupos({ A: "1" }, true).REPARTO_CACHE_S, String(CACHE_QUOTA_FONDO_S));
    assert.ok(CACHE_QUOTA_FONDO_S >= 300);
    const base = { A: "1" };
    assert.equal(entornoCupos(base, false), base);
    assert.equal("REPARTO_CACHE_S" in base, false);
  });
  it("si la persona ya fijó REPARTO_CACHE_S, gana la suya", () => {
    assert.equal(entornoCupos({ REPARTO_CACHE_S: "5" }, true).REPARTO_CACHE_S, "5");
  });
});
