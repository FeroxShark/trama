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

const { parsearCupoGemini, parsearCuposReparto } = await import("../electron/cupos.ts");

const AHORA = Date.parse("2026-10-23T04:00:00Z");

describe("parsearCuposReparto", () => {
  it("arma los 3 grupos de Google desde modelos (forma transicional de reparto)", () => {
    const json = JSON.stringify({
      ts: "2026-10-23T04:00:00Z",
      suscripciones: {
        claude: {
          ok: true,
          cinco_h: { usado_pct: 12, vuelve_en_s: 3600, vuelve_iso: "2026-10-23T05:00:00Z" },
          semanal: { usado_pct: 45, vuelve_en_s: 86400, vuelve_iso: "2026-10-24T04:00:00Z" },
        },
        google: {
          ok: true,
          modelos: {
            "gemini-3.8-flash": {
              usado_pct: 8,
              semanal: { usado_pct: 8, vuelve_en_s: 172800, vuelve_iso: "2026-10-25T04:00:00Z" },
              cinco_h: { usado_pct: 3, vuelve_en_s: 7200, vuelve_iso: "2026-10-23T06:00:00Z" },
            },
            "claude-opus-5-5": {
              usado_pct: 24,
              semanal: { usado_pct: 24, vuelve_en_s: 200000, vuelve_iso: "2026-10-25T11:33:20Z" },
              cinco_h: { usado_pct: 15, vuelve_en_s: 10800, vuelve_iso: "2026-10-23T07:00:00Z" },
            },
            "gpt-oss-120b": {
              usado_pct: 24,
              semanal: { usado_pct: 24, vuelve_en_s: 200000, vuelve_iso: "2026-10-25T11:33:20Z" },
              cinco_h: { usado_pct: 15, vuelve_en_s: 10800, vuelve_iso: "2026-10-23T07:00:00Z" },
            },
            "gemini-4-argon": {
              usado_pct: 41,
              semanal: { usado_pct: 41, vuelve_en_s: 243480, vuelve_iso: "2026-10-25T23:38:00Z" },
              cinco_h: { usado_pct: 0, vuelve_en_s: 18000, vuelve_iso: "2026-10-23T09:00:00Z" },
            },
          },
        },
      },
    });
    const res = parsearCuposReparto(json, AHORA);
    assert.ok(res);
    assert.deepEqual(res.claude, {
      cincoH: 12,
      sieteD: 45,
      reseteaCincoH: Date.parse("2026-10-23T05:00:00Z"),
      reseteaSieteD: Date.parse("2026-10-24T04:00:00Z"),
    });
    assert.equal(res.google.length, 3);
    assert.equal(res.google[0].id, "gemini");
    assert.equal(res.google[0].semanal.pct, 8);
    assert.equal(res.google[0].cincoH?.pct, 3);
    assert.equal(res.google[1].id, "claude-gpt");
    assert.equal(res.google[1].semanal.pct, 24);
    assert.equal(res.google[1].cincoH?.pct, 15);
    assert.equal(res.google[1].hasta, "2026-11-02");
    assert.equal(res.google[2].id, "argon");
    assert.equal(res.google[2].semanal.pct, 41);
    assert.equal(res.google[2].cincoH, undefined);
  });

  it("acepta grupos explícitos en suscripciones.google.grupos", () => {
    const json = JSON.stringify({
      suscripciones: {
        google: {
          ok: true,
          grupos: {
            gemini: {
              semanal: { usado_pct: 10, vuelve_en_s: 3600 },
              cinco_h: { usado_pct: 5, vuelve_en_s: 1800 },
            },
            "claude-gpt": {
              semanal: { usado_pct: 33, vuelve_en_s: 7200 },
              cinco_h: { usado_pct: 20, vuelve_en_s: 900 },
              hasta: "2026-11-15",
            },
            argon: {
              semanal: { usado_pct: 60, vuelve_en_s: 14400 },
            },
          },
        },
      },
    });
    const res = parsearCuposReparto(json, AHORA);
    assert.ok(res);
    assert.equal(res.google.length, 3);
    assert.equal(res.google[1].hasta, "2026-11-15");
    assert.equal(res.google[2].semanal.pct, 60);
    assert.equal(res.google[2].cincoH, undefined);
  });
});

describe("parsearCupoGemini", () => {
  it("parsea la salida de texto de pa --cupo-gemini", () => {
    const txt = [
      "gemini-4-argon-high        14%  weekly 14% (vuelve 2026-10-25 23:38Z), 5h 0% (vuelve 2026-10-23 09:00Z)",
      "gemini-3.8-flash-high       5%  weekly 5% (vuelve 2026-10-25 18:00Z), 5h 2% (vuelve 2026-10-23 06:00Z)",
      "claude-opus-5-5-high       28%  weekly 28% (vuelve 2026-10-26 12:00Z), 5h 11% (vuelve 2026-10-23 07:30Z)",
      "gpt-oss-120b-medium        28%  weekly 28% (vuelve 2026-10-26 12:00Z), 5h 11% (vuelve 2026-10-23 07:30Z)",
    ].join("\n");
    const res = parsearCupoGemini(txt, AHORA);
    assert.ok(res);
    assert.equal(res.google.length, 3);
    assert.equal(res.google[0].id, "gemini");
    assert.equal(res.google[0].semanal.pct, 5);
    assert.equal(res.google[0].cincoH?.pct, 2);
    assert.equal(res.google[1].id, "claude-gpt");
    assert.equal(res.google[1].semanal.pct, 28);
    assert.equal(res.google[1].cincoH?.pct, 11);
    assert.equal(res.google[1].hasta, "2026-11-02");
    assert.equal(res.google[2].id, "argon");
    assert.equal(res.google[2].semanal.pct, 14);
    assert.equal(res.google[2].cincoH, undefined);
  });
});
