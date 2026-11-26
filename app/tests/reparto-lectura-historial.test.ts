// `lectura` ya tiene historial: las lecturas cuentan por `bien` o, sin él, por `is_error` (electron/cli/pa/dato-medicion.ts). Un modelo de
// suscripción (Claude, agy, codex) con 5 corridas o más con dato y menos de 50 % ok en `lectura` recibe la misma penalización que en los
// otros tipos (`PESO_HISTORIAL` en electron/cli/reparto.ts: baja el puntaje y no gana por inteligencia). Sólo el TS (el python congelado
// ignora `is_error`). Lo que no gasta cupo (opencode, dsh, local) no pasa por esa penalización: con mal historial se descarta (abajo).
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const BIN = path.join(import.meta.dirname, "..", "..", "motor", "bin");
const tmp = mkdtempSync(path.join(os.tmpdir(), "reparto-lectura-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const AHORA = "2026-10-26T12:00:00Z";
const en = (h: number) => new Date(Date.parse(AHORA) + h * 3600_000).toISOString().replace(".000", "");
let n = 0;
const arch = (txt: string) => {
  const f = path.join(tmp, `a${n++}`);
  writeFileSync(f, txt);
  return f;
};
const vent = [{ id: "5h", usado: 0.1, vuelve: en(3) }, { id: "7d", usado: 0.3, vuelve: en(96) }];
const cupos = arch(JSON.stringify({ version: 1, leido: AHORA, suscripciones: [{ id: "claude", nombre: "Claude", proveedor: "claude", cuenta: "claude", ventanas: vent }] }));
const modelos = arch(JSON.stringify({ version: 1 }));
const HAIKU = "claude-haiku-5-5";
/** medicion.tsv con `n` lecturas de Haiku: `fallas` con is_error=true y el resto con false, sin `bien`. */
const medicion = (total: number, fallas: number) => {
  let t = "fecha\tid\tproyecto\tmodelo\teffort\tleer\tis_error\ttipo\tbien\tintegrada\tretrabajo\n";
  for (let i = 0; i < total; i++) t += `2026-10-20T10:00:00+00:00\tl${i}\tp\t${HAIKU}\tsettings\t1\t${i < fallas ? "true" : "false"}\tlectura\t\t\t\n`;
  return arch(t);
};
type Cand = { modelo: string; descartado_por: string | null; puntaje: number | null; historial?: { n: number; ok_pct: number | null } };
type Sal = { modelo: string; motivo: string; candidatos: Cand[] };
function reparto(med: string, extra: Record<string, string> = {}, tipo = "lectura"): Sal {
  const r = spawnSync(path.join(BIN, "reparto"), ["--tipo", tipo, "--json"], {
    encoding: "utf8",
    env: {
      ...process.env, TZ: "UTC", TRAMA_REPARTO: "ts", REPARTO_CUPOS_FIJOS: cupos, REPARTO_AGY: "1", REPARTO_AHORA: AHORA,
      REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}',
      REPARTO_OPENCODE_FIJO: "[]", // sin esto reparto corre el `opencode models` real y deja su refresco en segundo plano
      REPARTO_STATE: path.join(tmp, `estado${n++}`), REPARTO_CARGA_FIJA: "{}", REPARTO_MEDICION: med, TRAMA_MODELOS: modelos, ...extra,
    },
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return JSON.parse(r.stdout) as Sal;
}
const candidato = (med: string): Cand => reparto(med).candidatos.find((c) => c.modelo === HAIKU)!;

test("lectura con historial malo (is_error) resta puntaje; sin historial o con buen historial no resta, y no se descarta", () => {
  const sin = candidato(medicion(0, 0));
  const malo = candidato(medicion(6, 5)); // 6 con dato, 1 ok (17 %)
  const bueno = candidato(medicion(6, 0)); // 6 con dato, todas ok
  const poco = candidato(medicion(4, 4)); // 4 con dato: no alcanza para creerlo
  assert.deepEqual(malo.historial, { n: 6, ok_pct: 17 });
  assert.deepEqual(bueno.historial, { n: 6, ok_pct: 100 });
  assert.equal(malo.descartado_por, null); // resta puntaje, no descarta
  assert.ok(sin.puntaje !== null && malo.puntaje !== null && bueno.puntaje !== null && poco.puntaje !== null);
  assert.ok(malo.puntaje < sin.puntaje, `malo ${malo.puntaje} debería estar por debajo de sin historial ${sin.puntaje}`);
  assert.equal(bueno.puntaje, sin.puntaje);
  assert.equal(poco.puntaje, sin.puntaje);
});

// Lo que no gasta cupo (OpenCode gratis, local) entra en lectura y mecanico SIN datos, pero no con datos malos (perfiles ahorro y agresivo).
const BIG = "opencode:opencode/big-pickle";
const conGratis = (perfil: string) => ({ REPARTO_OPENCODE_FIJO: '["opencode/big-pickle"]', TRAMA_MODELOS: arch(JSON.stringify({ version: 1, perfil })) });
/** medicion.tsv con lecturas del gratis: `fallas` con is_error=true y el resto con false. */
const medicionGratis = (total: number, fallas: number, tipo = "lectura") => {
  let t = "fecha\tid\tproyecto\tmodelo\teffort\tleer\tis_error\ttipo\tbien\tintegrada\tretrabajo\n";
  for (let i = 0; i < total; i++) t += `2026-10-20T10:00:00+00:00\tg${i}\tp\t${BIG}\tsettings\t1\t${i < fallas ? "true" : "false"}\t${tipo}\t\t\t\n`;
  return arch(t);
};

test("un gratis con mal historial en lectura deja de elegirse (ahorro y agresivo); sin datos o con buen historial sigue entrando", () => {
  for (const perfil of ["ahorro", "agresivo"]) {
    const g = (s: Sal) => s.candidatos.find((c) => c.modelo === BIG)!;
    const sin = reparto(medicionGratis(0, 0), conGratis(perfil));
    assert.equal(g(sin).descartado_por, null, perfil);
    const bueno = reparto(medicionGratis(14, 3), conGratis(perfil)); // 79 % ok
    assert.equal(g(bueno).descartado_por, null, perfil);
    const pocas = reparto(medicionGratis(4, 4), conGratis(perfil)); // 4 con dato: no alcanza para creerlo
    assert.equal(g(pocas).descartado_por, null, perfil);
    const malo = reparto(medicionGratis(14, 11), conGratis(perfil)); // 21 % ok: el caso medido
    assert.deepEqual(g(malo).historial, { n: 14, ok_pct: 21 });
    assert.match(g(malo).descartado_por ?? "", new RegExp(`^mal historial en lectura: .* de 14 corridas con dato sólo 21 % salió bien, y el perfil ${perfil} pide 50 % o más`));
    assert.notEqual(malo.modelo, BIG, perfil);
    // el mal historial de lectura no lo saca de mecanico
    assert.equal(g(reparto(medicionGratis(14, 11), conGratis(perfil), "mecanico")).descartado_por, null, perfil);
  }
});

test("si no queda ningún otro modelo, el gratis con mal historial vuelve a entrar y el motivo lo dice", () => {
  const solo = { ...conGratis("ahorro"), TRAMA_MODELOS: arch(JSON.stringify({ version: 1, perfil: "ahorro", excluir: ["claude-*", "gemini-*", "agy:*"] })) };
  const s = reparto(medicionGratis(14, 11), solo);
  assert.equal(s.modelo, BIG, s.motivo);
  assert.match(s.motivo, /entra .* aunque tiene mal historial en lectura \(perfil ahorro\)/);
});
