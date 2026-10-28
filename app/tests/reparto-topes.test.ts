// Dónde `reparto` (motor/bin/reparto) deja de usar cada proveedor: lo que el dueño fija en modelos.json (`reserva` para Claude, `topes_uso`
// para Google y ChatGPT, `agy_min_libre_5h` para código en la ventana de 5 h de Google) cambia la elección. Cupos y hora fijos por entorno.
import { after, beforeEach } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const BIN = path.join(import.meta.dirname, "..", "..", "motor", "bin");
const tmp = mkdtempSync(path.join(os.tmpdir(), "reparto-topes-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const AHORA = "2026-10-26T12:00:00Z";
const en = (h: number) => new Date(Date.parse(AHORA) + h * 3600_000).toISOString().replace(".000", "");
let n = 0;
const arch = (j: object) => {
  const f = path.join(tmp, `a${n++}.json`);
  writeFileSync(f, JSON.stringify(j));
  return f;
};
const ventanas = (u5: number, u7: number) => [{ id: "5h", usado: u5, vuelve: en(3) }, { id: "7d", usado: u7, vuelve: en(96) }];
/** Claude (5h, semanal) y Google (grupo claude-gpt: 5h, semanal) con el uso dado. */
const cupos = (c: { c5: number; c7?: number; g5: number; g7?: number }) =>
  arch({
    version: 1,
    leido: AHORA,
    suscripciones: [
      { id: "claude", nombre: "Claude", proveedor: "claude", cuenta: "claude", ventanas: ventanas(c.c5, c.c7 ?? 0.1) },
      { id: "google", nombre: "Google AI Pro", grupos: [{ id: "claude-gpt", nombre: "Claude y GPT por Google", ventanas: ventanas(c.g5, c.g7 ?? 0.1) }] },
    ],
  });
const modelos = (j: object = {}) => arch({ version: 1, ...j });

let estado = "";
beforeEach(() => void (estado = path.join(tmp, `estado${n++}`)));
type Cand = { modelo: string; descartado_por: string | null };
type Sal = { modelo: string; candidatos: Cand[] };
function tipo(t: string, fijos: string, mod: string, extra: Record<string, string> = {}) {
  const r = spawnSync(path.join(BIN, "reparto"), ["--tipo", t, "--json"], {
    encoding: "utf8",
    env: {
      ...process.env,
      TZ: "UTC",
      REPARTO_CUPOS_FIJOS: fijos,
      REPARTO_AGY: "1",
      REPARTO_AHORA: AHORA,
      REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}',
      REPARTO_OPENCODE_FIJO: "[]",
      REPARTO_STATE: estado,
      REPARTO_CARGA_FIJA: "{}",
      TRAMA_MODELOS: mod,
      ...extra,
    },
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return { sal: JSON.parse(r.stdout) as Sal, err: r.stderr };
}
/** Los de agy que la calidad no descartó (gpt-oss no llega al mínimo de ningún tipo de acá): lo que queda lo decide el cupo. */
const deAgy = (s: Sal) => s.candidatos.filter((c) => c.modelo.startsWith("agy:") && !/^calidad/.test(c.descartado_por ?? ""));
const deClaude = (s: Sal) => s.candidatos.filter((c) => c.modelo.startsWith("claude-"));

test("Google: de fábrica una ventana al 80 % se usa; con topes_uso.google en 75 ya no", () => {
  const f = cupos({ c5: 0.1, g5: 0.8 });
  const base = tipo("lectura", f, modelos()).sal;
  assert.ok(deAgy(base).some((c) => c.descartado_por === null), JSON.stringify(deAgy(base)));
  const con = tipo("lectura", f, modelos({ topes_uso: { google: 75 } })).sal;
  assert.ok(deAgy(con).length > 0 && deAgy(con).every((c) => /ventana 5h llena \(80 % usado\)/.test(c.descartado_por ?? "")), JSON.stringify(deAgy(con)));
});

test("Google: de fábrica una ventana al 98 % está llena; subir el tope a 99 la deja usar", () => {
  const f = cupos({ c5: 0.1, g5: 0.98 });
  assert.ok(deAgy(tipo("lectura", f, modelos()).sal).every((c) => c.descartado_por !== null));
  const sube = tipo("lectura", f, modelos({ topes_uso: { google: 99 } })).sal;
  assert.ok(deAgy(sube).some((c) => c.descartado_por === null), JSON.stringify(deAgy(sube)));
});

test("Google: el tope del grupo gana al del proveedor", () => {
  const f = cupos({ c5: 0.1, g5: 0.8 });
  const r = tipo("lectura", f, modelos({ topes_uso: { google: 50, "google:claude-gpt": 90 } })).sal;
  assert.ok(deAgy(r).some((c) => c.descartado_por === null));
});

test("Google, código en la ventana de 5 h: agy_min_libre_5h (de fábrica 30 % libre = 70 % usado) cambia a quién se elige", () => {
  const f = cupos({ c5: 0.1, g5: 0.6 });
  assert.ok(deAgy(tipo("codigo-multi", f, modelos()).sal).some((c) => c.descartado_por === null));
  const estricto = tipo("codigo-multi", f, modelos({ agy_min_libre_5h: 0.5 })).sal;
  assert.ok(deAgy(estricto).every((c) => /poco cupo en agy/.test(c.descartado_por ?? "")), JSON.stringify(deAgy(estricto)));
  assert.ok(!estricto.modelo.startsWith("agy:"), estricto.modelo);
  const sinTope = tipo("codigo-multi", cupos({ c5: 0.1, g5: 0.75 }), modelos({ agy_min_libre_5h: 0.2 })).sal;
  assert.ok(deAgy(sinTope).some((c) => c.descartado_por === null), JSON.stringify(deAgy(sinTope)));
});

test("Claude: la reserva del dueño cambia la elección; sin ella Claude se usa hasta llenarse (97 %)", () => {
  const f = cupos({ c5: 0.6, g5: 0.1 });
  assert.ok(deClaude(tipo("lectura", f, modelos()).sal).some((c) => c.descartado_por === null));
  const con = tipo("lectura", f, modelos({ reserva: { "5h": 0.5 } })).sal;
  assert.ok(deClaude(con).length > 0 && deClaude(con).every((c) => /reserva comprometida: Claude .* al 60 %/.test(c.descartado_por ?? "")), JSON.stringify(deClaude(con)));
  assert.ok(!con.modelo.startsWith("claude-"), con.modelo);
  const llena = tipo("lectura", cupos({ c5: 0.98, g5: 0.1 }), modelos()).sal;
  assert.ok(deClaude(llena).every((c) => /llena \(98 % usado\)/.test(c.descartado_por ?? "")));
  const sube = tipo("lectura", cupos({ c5: 0.98, g5: 0.1 }), modelos({ reserva: { "5h": 0.01 } })).sal;
  assert.ok(deClaude(sube).some((c) => c.descartado_por === null), JSON.stringify(deClaude(sube)));
});

test("un topes_uso mal escrito se ignora con una línea y valen los de fábrica", () => {
  const f = cupos({ c5: 0.1, g5: 0.8 });
  for (const malo of [{ google: 0 }, { google: 120 }, { google: "90" }, { chatgpt: 50 }]) {
    const r = tipo("lectura", f, modelos({ topes_uso: malo }));
    assert.match(r.err, /topes_uso/);
    assert.ok(deAgy(r.sal).some((c) => c.descartado_por === null));
  }
});
