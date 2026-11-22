// CTX-23: la urgencia por cupo de Claude es el MÍNIMO entre sus ventanas, así que saltarse la de 5 h sólo podía subirla. Antes, con Claude
// por agy disponible, el Claude oficial no contaba su 5 h: con la 5 h al 90 % y la semana por reiniciar ganaba ~12 puntos de más justo sobre la
// ventana de las sesiones de la persona. Ahora el puntaje del Claude oficial no depende de que haya Claude por agy. Sólo el TS (el python congelado sigue saltándola).
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const REPARTO = path.join(import.meta.dirname, "..", "..", "motor", "bin", "reparto");
const tmp = mkdtempSync(path.join(os.tmpdir(), "reparto-urg5h-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const AHORA = "2026-10-26T12:00:00Z";
const en = (h: number) => new Date(Date.parse(AHORA) + h * 3600_000).toISOString().replace(".000", "");
let n = 0;
const arch = (j: unknown) => {
  const f = path.join(tmp, `a${n++}`);
  writeFileSync(f, typeof j === "string" ? j : JSON.stringify(j));
  return f;
};
const ventanas = (u5: number, u7: number, h7: number) => [{ id: "5h", usado: u5, vuelve: en(3) }, { id: "7d", usado: u7, vuelve: en(h7) }];
const google = { id: "google", nombre: "Google AI Pro", grupos: [{ id: "claude-gpt", nombre: "Claude y GPT por Google", ventanas: ventanas(0.1, 0.2, 96) }] };

/** El puntaje de Claude Sonnet (el oficial) para un tipo, con o sin Claude por Google. */
function puntaje(u5: number, u7: number, h7: number, conAgy: boolean): number {
  const cupos = arch({
    version: 1,
    leido: AHORA,
    suscripciones: [{ id: "claude", nombre: "Claude", proveedor: "claude", cuenta: "claude", ventanas: ventanas(u5, u7, h7) }, ...(conAgy ? [google] : [])],
  });
  const r = spawnSync(REPARTO, ["--tipo", "codigo-acotado", "--json"], {
    encoding: "utf8",
    env: {
      ...process.env,
      TZ: "UTC",
      TRAMA_REPARTO: "ts",
      REPARTO_CUPOS_FIJOS: cupos,
      REPARTO_AGY: "1",
      REPARTO_AHORA: AHORA,
      REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}',
      REPARTO_OPENCODE_FIJO: "[]",
      REPARTO_STATE: path.join(tmp, `estado${n++}`),
      REPARTO_CARGA_FIJA: "{}",
      REPARTO_MEDICION: arch(""),
      TRAMA_MODELOS: arch({ version: 1 }),
    },
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const c = (JSON.parse(r.stdout).candidatos as { modelo: string; puntaje: number | null }[]).find((x) => x.modelo === "claude-sonnet-5-5");
  assert.ok(c && typeof c.puntaje === "number", "Claude Sonnet es candidato");
  return c.puntaje;
}

test("5 h al 90 % y semana por reiniciar: el puntaje de Claude es el mismo con y sin Claude por agy", () => {
  const sin = puntaje(0.9, 0.3, 6, false);
  const con = puntaje(0.9, 0.3, 6, true);
  assert.equal(con, sin, `con agy ${con} vs sin agy ${sin}`);
});

test("5 h libre: tampoco cambia con Claude por agy", () => {
  assert.equal(puntaje(0.1, 0.3, 6, true), puntaje(0.1, 0.3, 6, false));
});

test("la 5 h casi usada baja la urgencia: puntaje menor que con la 5 h libre", () => {
  assert.ok(puntaje(0.9, 0.3, 6, true) < puntaje(0.1, 0.3, 6, true));
});
