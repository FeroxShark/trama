// Reparto (electron/cli/reparto.ts), 2026-11-19: Fable no entra donde alcanza uno barato y Argon se usa cuando le sobra cupo.
// Pasaba: dos workers de frontend sin -m salieron en Fable 5.2 high con Neon con cupo, perfil ahorro y el ritmo semanal de Claude bajo
// (Fable no estaba en los pesos corregidos y valía 0,3, menos que Neon; y el bono del ritmo le llegaba entero). Cupos, hora y modelos fijos.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const BIN = path.join(import.meta.dirname, "..", "..", "motor", "bin");
const tmp = mkdtempSync(path.join(os.tmpdir(), "reparto-fable-argon-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const AHORA = "2026-10-26T12:00:00Z";
const en = (h: number) => new Date(Date.parse(AHORA) + h * 3600_000).toISOString().replace(".000", "");
let n = 0;
const arch = (j: object | string, ext = "json") => {
  const f = path.join(tmp, `a${n++}.${ext}`);
  writeFileSync(f, typeof j === "string" ? j : JSON.stringify(j));
  return f;
};
type Cupos = { claude7?: number; claudeVuelve7?: number; claude5?: number; gemini?: number; argon?: number; argonVuelve?: number };
/** Claude recién reiniciado (5 h casi vacía, vuelve pronto) y con la semana muy por debajo del ritmo: lo que inflaba a todo Claude. */
const cupos = ({ claude7 = 0.1, claudeVuelve7 = 30, claude5 = 0.02, gemini = 0.3, argon = 0.2, argonVuelve = 96 }: Cupos = {}) =>
  arch({
    version: 1,
    leido: AHORA,
    suscripciones: [
      { id: "claude", nombre: "Claude", proveedor: "claude", cuenta: "claude", ventanas: [{ id: "5h", usado: claude5, vuelve: en(4.5) }, { id: "7d", usado: claude7, vuelve: en(claudeVuelve7) }] },
      {
        id: "google", nombre: "Google AI Pro",
        grupos: [
          { id: "gemini", nombre: "Gemini", ventanas: [{ id: "5h", usado: gemini, vuelve: en(3) }, { id: "7d", usado: gemini, vuelve: en(96) }] },
          // el Claude por Google sin cupo: que no tape la elección entre Neon, Sonnet y Fable
          { id: "claude-gpt", nombre: "Claude y GPT por Google", agotado: true, ventanas: [{ id: "5h", usado: 1, vuelve: en(3) }, { id: "7d", usado: 1, vuelve: en(96) }] },
          { id: "gemini-4-argon", nombre: "Gemini 4 Argon", ventanas: [{ id: "7d", usado: argon, vuelve: en(argonVuelve) }] },
        ],
      },
    ],
  });

type Cand = { modelo: string; puntaje: number; descartado_por: string | null; ritmo_pts?: number };
type Sal = { modelo: string; motivo: string; candidatos: Cand[] };
const SIN_MEDICION = path.join(tmp, "sin-medicion.tsv");
function elegir(tipo: string, fijos: string, modelos: object = {}, medicion = SIN_MEDICION): Sal {
  const r = spawnSync(path.join(BIN, "reparto"), ["--tipo", tipo, "--json"], {
    encoding: "utf8",
    env: {
      ...process.env,
      TZ: "UTC",
      TRAMA_REPARTO: "ts",
      REPARTO_CUPOS_FIJOS: fijos,
      REPARTO_AGY: "1",
      REPARTO_AHORA: AHORA,
      REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}',
      REPARTO_OPENCODE_FIJO: "[]",
      REPARTO_STATE: path.join(tmp, `estado${n++}`),
      REPARTO_CARGA_FIJA: "{}",
      REPARTO_MEDICION: medicion,
      TRAMA_MODELOS: arch({ version: 1, perfil: "ahorro", ...modelos }),
    },
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout) as Sal;
}
const cand = (s: Sal, m: string) => s.candidatos.find((c) => c.modelo === m || c.modelo.startsWith(m))!;
const ver = (s: Sal) => `${s.modelo}: ${s.motivo}\n${s.candidatos.filter((c) => !c.descartado_por).map((c) => `${c.modelo} ${c.puntaje} ritmo ${c.ritmo_pts}`).join("\n")}`;

test("frontend con Neon con cupo, ritmo de Claude bajo y perfil ahorro: no elige Fable", () => {
  for (const perfil of ["ahorro", "equilibrado", "rendimiento"]) {
    const r = elegir("frontend", cupos(), { perfil });
    assert.ok(!r.modelo.startsWith("claude-fable"), `${perfil}: ${ver(r)}`);
  }
  const r = elegir("frontend", cupos());
  // el ritmo de Claude puede empujar a gastar Claude, pero hacia el más barato que alcanza (Sonnet), nunca hacia Fable
  assert.ok(["gemini-4-neon-high", "claude-sonnet-5-5"].includes(r.modelo), ver(r));
  assert.ok(cand(r, "claude-fable-5-2").puntaje < cand(r, "gemini-4-neon").puntaje, ver(r));
});

test("Fable no entra en la banda de Neon: es más caro aunque su calidad caiga en la banda", () => {
  // sin ritmo que empuje (Claude a mitad de semana, al ritmo): la banda manda y no la pisa Fable
  const r = elegir("frontend", cupos({ claude7: 0.45, claudeVuelve7: 96, claude5: 0.3 }));
  assert.equal(r.modelo, "gemini-4-neon-high", ver(r));
  assert.match(r.motivo, /se prefiere la calidad de neon/);
});

test("con Neon agotado y Sonnet con cupo: Sonnet, no Fable", () => {
  for (const perfil of ["ahorro", "equilibrado"]) {
    const r = elegir("frontend", cupos({ gemini: 1 }), { perfil });
    assert.equal(r.modelo, "claude-sonnet-5-5", `${perfil}: ${ver(r)}`);
  }
});

test("un mal historial (pa --rinde) resta y no gana por inteligencia", () => {
  const filas = ["fecha\tid\tproyecto\tmodelo\teffort\tleer\tseguir\tis_error\tnum_turns\tduration_s\ttokens\tcosto_usd\tbien\tplan\tcompactaciones\tautocompact\torigen\tcache_read\tcache_creation\tephemeral_1h\tephemeral_5m\ttipo\tintegrada\tretrabajo"];
  for (let i = 0; i < 9; i++) filas.push(`2026-10-2${i % 5}T10:00:00Z\tid${i}\tp\tclaude-fable-5-2\thigh\t0\t0\tfalse\t10\t100\t1000\t8.9\t\tmax\t0\tnativo\tjefe\t0\t0\t0\t0\tfrontend\t1\t${i === 0 ? 0 : 1}`);
  const med = arch(filas.join("\n") + "\n", "tsv");
  const con = elegir("frontend", cupos({ gemini: 1 }), { perfil: "equilibrado", excluir: ["sonnet"] }, med);
  const sin = elegir("frontend", cupos({ gemini: 1 }), { perfil: "equilibrado", excluir: ["sonnet"] });
  assert.ok(cand(con, "claude-fable-5-2").puntaje < cand(sin, "claude-fable-5-2").puntaje - 10, `${ver(con)}\n---\n${ver(sin)}`);
});

test("Argon con cupo de sobra cerca de su reinicio gana donde pasa el piso; lejos del reinicio, no", () => {
  // lectura: piso haiku y sin preferido. A 12 h del reinicio con 90 % libre, ese cupo se pierde
  const cerca = elegir("lectura", cupos({ argon: 0.1, argonVuelve: 12 }));
  assert.match(cerca.modelo, /^gemini-4-argon/, ver(cerca));
  assert.match(cerca.motivo, /Perfil ahorro: de los que pasan el piso de lectura, el más barato \(costo relativo [\d.]+, 0\.6 menos el cupo que se pierde si no se usa\)/, ver(cerca));
  const lejos = elegir("lectura", cupos({ argon: 0.1, argonVuelve: 150 }));
  assert.doesNotMatch(lejos.modelo, /^gemini-4-argon/, ver(lejos));
  // en equilibrado, el empuje también lo sube por puntaje
  const eq = elegir("lectura", cupos({ argon: 0.1, argonVuelve: 12 }), { perfil: "equilibrado" });
  assert.match(eq.modelo, /^gemini-4-argon/, ver(eq));
});

test("Argon agotado no se elige", () => {
  const r = elegir("lectura", cupos({ argon: 1, argonVuelve: 12 }));
  assert.doesNotMatch(r.modelo, /^gemini-4-argon/, ver(r));
  assert.ok(cand(r, "gemini-4-argon").descartado_por, ver(r));
});

test("Argon ya no es sólo para tareas finales", () => {
  const r = elegir("codigo-acotado", cupos());
  assert.doesNotMatch(cand(r, "gemini-4-argon").descartado_por ?? "", /tareas finales/);
});
