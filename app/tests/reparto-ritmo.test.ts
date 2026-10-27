// Ritmo semanal, reserva del líder, perfiles y plan de `reparto` (motor/bin/reparto): una suscripción que va por encima del ritmo que
// termina la semana en ~100 % cede a los gratis/Google; por debajo y cerca del reinicio, se usa más. Todo con cupos, hora y modelos
// fijos por entorno (REPARTO_CUPOS_FIJOS / REPARTO_AHORA / TZ=UTC): no mira nada real.
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ritmoSemanal, reservaDePerfil } from "../src/paneles/cupos-ritmo.ts";

const BIN = path.join(import.meta.dirname, "..", "..", "motor", "bin");
const tmp = mkdtempSync(path.join(os.tmpdir(), "reparto-ritmo-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const AHORA = "2026-10-26T12:00:00Z"; // lunes
const en = (h: number, desde = AHORA) => new Date(Date.parse(desde) + h * 3600_000).toISOString().replace(".000", "");
let n = 0;
const arch = (j: object) => {
  const f = path.join(tmp, `a${n++}.json`);
  writeFileSync(f, JSON.stringify(j));
  return f;
};

type Cupo = { c5?: number; c7: number; vuelve7: number; google?: boolean; g5?: number; g7?: number };
/** Claude con su ventana de 5 h casi vacía y la semanal en `c7`, que vuelve dentro de `vuelve7` horas; Google (agy) opcional. */
const conGoogle = new Set<string>();
const cupos = (c: Cupo) => {
  const f = cuposArch(c);
  if (c.google) conGoogle.add(f);
  return f;
};
const cuposArch = (c: Cupo) =>
  arch({
    version: 1,
    leido: AHORA,
    suscripciones: [
      { id: "claude", nombre: "Claude", proveedor: "claude", cuenta: "claude", ventanas: [{ id: "5h", usado: c.c5 ?? 0.1, vuelve: en(3) }, { id: "7d", usado: c.c7, vuelve: en(c.vuelve7) }] },
      ...(c.google
        ? [{ id: "google", nombre: "Google AI Pro", grupos: [{ id: "claude-gpt", nombre: "Claude y GPT por Google", ventanas: [{ id: "5h", usado: c.g5 ?? 0.1, vuelve: en(3) }, { id: "7d", usado: c.g7 ?? 0.2, vuelve: en(c.vuelve7) }] }] }]
        : []),
    ],
  });
const modelos = (j: object = {}) => arch({ version: 1, ...j });

let estado = "";
beforeEach(() => void (estado = path.join(tmp, `estado${n++}`)));
function reparto(args: string[], fijos: string, mod: string, extra: Record<string, string> = {}) {
  const r = spawnSync(path.join(BIN, "reparto"), args, {
    encoding: "utf8",
    env: {
      ...process.env,
      TZ: "UTC",
      REPARTO_CUPOS_FIJOS: fijos,
      REPARTO_AGY: conGoogle.has(fijos) ? "1" : "0", // sin Google en el archivo, ningún modelo de agy es candidato
      REPARTO_AHORA: AHORA,
      REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}',
      REPARTO_OPENCODE_FIJO: '["opencode/big-pickle","opencode/glm-5.3-flash-free"]',
      REPARTO_STATE: estado,
      REPARTO_CARGA_FIJA: "{}",
      TRAMA_MODELOS: mod,
      ...extra,
    },
  });
  return { rc: r.status, out: r.stdout, err: r.stderr };
}
type Cand = { modelo: string; nombre: string; puntaje: number | null; descartado_por: string | null; ritmo?: { ratio: number; esperado: number; h: number; h_activas: number; nivel: string }; ritmo_pts?: number };
type Sal = { modelo: string; motivo: string; perfil: string; candidatos: Cand[]; ritmo: { ratio: number; esperado: number; usado: number; nivel: string; h_activas: number; h: number; ventana: string }[] };
const tipo = (t: string, fijos: string, mod: string, extra: Record<string, string> = {}, ahora = AHORA) => {
  const r = reparto(["--tipo", t, "--json"], fijos, mod, { REPARTO_AHORA: ahora, ...extra });
  assert.equal(r.rc, 0, r.err + r.out);
  return JSON.parse(r.out) as Sal;
};
const esClaude = (m: string) => m.startsWith("claude-");
const cand = (s: Sal, m: string) => s.candidatos.find((c) => c.modelo === m)!;

test("por encima del ritmo semanal: Google gana a Claude en codigo-acotado, y el motivo lo dice", () => {
  // 3 de 7 días pasados (esperado 43 %) y 50 % usado = 1,2× el ritmo. Sin ritmo Claude gana por poco (urgencia de su semanal).
  const f = cupos({ c7: 0.5, vuelve7: 96, google: true, g5: 0.7, g7: 0.4 });
  const sin = tipo("codigo-acotado", f, modelos({ peso_ritmo: 0, peso_bono_ritmo: 0 }));
  assert.ok(esClaude(sin.modelo), `sin ritmo gana Claude: ${sin.modelo}`);
  assert.doesNotMatch(sin.motivo, /ritmo/);
  const con = tipo("codigo-acotado", f, modelos());
  assert.ok(con.modelo.startsWith("agy:"), con.modelo);
  const rt = con.ritmo.find((r) => r.ventana === "7d" && r.nivel === "encima");
  assert.ok(rt && Math.abs(rt.ratio - 1.17) < 0.03, JSON.stringify(con.ritmo));
  assert.match(con.motivo, /Claude va 1,2× por encima del ritmo semanal: uso .* en lugar de Claude Sonnet 5\.5\./);
  assert.ok(cand(con, "claude-sonnet-5-5").ritmo_pts! < 0);
  // Más arriba todavía, más puntos menos.
  const mas = tipo("codigo-acotado", cupos({ c7: 0.62, vuelve7: 96, google: true, g5: 0.7, g7: 0.4 }), modelos());
  assert.ok(cand(mas, "claude-sonnet-5-5").ritmo_pts! < cand(con, "claude-sonnet-5-5").ritmo_pts!);
});

test("por encima del ritmo, sin Google: lectura va a un gratis de OpenCode", () => {
  const f = cupos({ c7: 0.62, vuelve7: 96 });
  const cargado = { REPARTO_CARGA_FIJA: '{"opencode-free": 1}' }; // el gratis ya tiene un worker: sin ritmo, Claude gana
  const sin = tipo("lectura", f, modelos({ peso_ritmo: 0, peso_bono_ritmo: 0 }), cargado);
  const con = tipo("lectura", f, modelos(), cargado);
  assert.ok(esClaude(sin.modelo), sin.modelo);
  assert.ok(con.modelo.startsWith("opencode:"), con.modelo);
  assert.match(con.motivo, /por encima del ritmo semanal: uso big-pickle.* en lugar de Claude Haiku/);
});

test("por debajo del ritmo y cerca del reinicio: Claude gana (aunque sea perfil ahorro)", () => {
  // Queda 1 día, 20 % usado: va a 0,23× el ritmo y el cupo se perdería.
  const f = cupos({ c7: 0.2, vuelve7: 24, google: true, g7: 0.2 });
  for (const perfil of ["equilibrado", "ahorro"]) {
    const r = tipo("codigo-acotado", f, modelos({ perfil }));
    assert.ok(esClaude(r.modelo), `${perfil}: ${r.modelo}`);
    assert.equal(r.ritmo.find((x) => x.ventana === "7d")!.nivel, "debajo");
  }
  // Y sin el atraso (mismo uso a mitad de semana) el ahorro se va a Google o a un gratis.
  const mitad = tipo("codigo-acotado", cupos({ c7: 0.5, vuelve7: 84, google: true, g7: 0.2 }), modelos({ perfil: "ahorro" }));
  assert.ok(!esClaude(mitad.modelo), mitad.modelo);
});

test("ausente mañana y reinicio pasado mañana: hoy se gasta más (el presupuesto se reparte en los días que quedan)", () => {
  // Lunes 12:00 UTC; reinicia el miércoles 00:00 (36 h). Martes ausente: sólo quedan 12 h de trabajo.
  const f = cupos({ c7: 0.6, vuelve7: 36 });
  const m = modelos();
  const sinPlan = tipo("lectura", f, m);
  const base = cand(sinPlan, "claude-haiku-5-5");
  assert.ok(sinPlan.modelo.startsWith("opencode:"), sinPlan.modelo);
  const r = reparto(["--plan", "ausente", "2026-10-27"], f, m);
  assert.equal(r.rc, 0, r.err);
  assert.match(r.out, /Ausente: 2026-10-27/);
  assert.match(r.out, /Ritmo Claude semanal: 0,8× -> 0,7×/);
  const conPlan = tipo("lectura", f, m);
  const c = cand(conPlan, "claude-haiku-5-5");
  assert.equal(c.ritmo!.h, 36);
  assert.equal(c.ritmo!.h_activas, 12);
  assert.ok(c.puntaje! > base.puntaje! + 2, `${c.puntaje} contra ${base.puntaje}`);
  assert.ok(esClaude(conPlan.modelo), conPlan.modelo);
  assert.match(conPlan.motivo, /días ausentes antes del reinicio.*uso Claude Haiku/);
  // Mañana ausente pero el reinicio es lejano: sube algo el puntaje de Claude, pero no cambia la elección.
  const lejos = cupos({ c7: 0.5, vuelve7: 120 });
  assert.equal(reparto(["--plan", "borrar"], lejos, m).rc, 0);
  const antes = cand(tipo("lectura", lejos, m), "claude-haiku-5-5").puntaje!;
  assert.equal(reparto(["--plan", "ausente", "2026-10-27"], lejos, m).rc, 0);
  const luego = tipo("lectura", lejos, m);
  assert.ok(luego.modelo.startsWith("opencode:"), luego.modelo);
  // (el día libre también reparte la semana entre menos días: Claude sube algo, pero lejos del reinicio no alcanza a un gratis)
  assert.ok(cand(luego, "claude-haiku-5-5").puntaje! > antes);
});

test("perfil ahorro con uso de Pro: workers a gratis/Google; Claude sólo donde nada más llega", () => {
  // Dos días y medio después del reinicio ya va en 50 % (con la reserva del líder: 0,77 de lo que le toca a los workers contra 0,29 esperado).
  const f = cupos({ c7: 0.5, vuelve7: 120 });
  const ahorro = modelos({ perfil: "ahorro" });
  assert.ok(tipo("lectura", f, ahorro).modelo.startsWith("opencode:"));
  assert.ok(tipo("mecanico", f, ahorro).modelo.startsWith("opencode:"));
  // codigo-acotado: el mínimo baja una banda (Haiku): el gratis de 43 (60 en la escala vieja) alcanza. El equilibrado sigue pidiendo Sonnet.
  const ca = tipo("codigo-acotado", f, ahorro);
  assert.ok(ca.modelo.startsWith("opencode:"), ca.modelo);
  assert.match(ca.motivo, /codigo-acotado pide calidad 43 o más/);
  assert.ok(esClaude(tipo("codigo-acotado", f, modelos()).modelo));
  assert.match(tipo("codigo-acotado", f, ahorro).motivo, /perfil ahorro: uso big-pickle.* en lugar de Claude/);
  // debug pide Argon-88: ningún gratis llega, queda Claude (con un 50 % usado de 65 % disponibles todavía hay cupo para workers).
  const dbg = tipo("debug", f, ahorro);
  assert.ok(esClaude(dbg.modelo), dbg.modelo);
  assert.equal(dbg.perfil, "ahorro");
  // rendimiento: el ritmo pesa una décima parte y el costo la mitad.
  const eq = cand(tipo("lectura", f, modelos()), "claude-haiku-5-5");
  const rend = cand(tipo("lectura", f, modelos({ perfil: "rendimiento" })), "claude-haiku-5-5");
  assert.ok(rend.ritmo_pts! < 0 && rend.ritmo_pts! > eq.ritmo_pts! * 0.3, `${rend.ritmo_pts} contra ${eq.ritmo_pts}`);
  assert.ok(rend.puntaje! > eq.puntaje!);
});

test("reserva_lider: con sólo la reserva libre, los workers ven la semana de Claude llena", () => {
  const f = cupos({ c7: 0.7, vuelve7: 24 }); // queda 30 % y se guarda 35 %
  const m = modelos({ reserva_lider: 0.35 });
  const r = tipo("lectura", f, m);
  assert.ok(!esClaude(r.modelo), r.modelo);
  const c = cand(r, "claude-haiku-5-5");
  assert.match(c.descartado_por!, /reserva del líder.*35 %/);
  // sin reserva_lider (equilibrado) Claude sigue disponible; la reserva_lider también ordena en `ahorro` por defecto (0,35)
  assert.equal(cand(tipo("lectura", f, modelos()), "claude-haiku-5-5").descartado_por, null);
  assert.match(cand(tipo("lectura", f, modelos({ perfil: "ahorro" })), "claude-haiku-5-5").descartado_por!, /reserva del líder/);
  assert.equal(cand(tipo("lectura", f, modelos({ perfil: "ahorro", reserva_lider: 0 })), "claude-haiku-5-5").descartado_por, null);
  // la `reserva` de siempre sigue valiendo y se junta con la del líder: gana la mayor
  assert.match(cand(tipo("lectura", f, modelos({ reserva: { "7d": 0.5 }, reserva_lider: 0.2 })), "claude-haiku-5-5").descartado_por!, /50 %/);
});

test("--plan: gastar-hoy / ahorrar-hoy pisan el ritmo, ver lo muestra, y todo vence solo", () => {
  const f = cupos({ c7: 0.5, vuelve7: 96 });
  const m = modelos();
  const cargado = { REPARTO_CARGA_FIJA: '{"opencode-free": 1}' };
  assert.ok(esClaude(tipo("lectura", f, m, cargado).modelo));
  assert.equal(reparto(["--plan", "ver"], f, m).rc, 0);
  const a = reparto(["--plan", "ahorrar-hoy"], f, m);
  assert.equal(a.rc, 0, a.err);
  assert.match(a.out, /Hoy: ahorrar/);
  assert.match(a.out, /Ritmo Claude semanal: 1,2× -> 2,5×/);
  assert.equal(JSON.parse(reparto(["--plan", "ver", "--json"], f, m).out).plan.hoy, "ahorrar");
  const ahorrando = tipo("lectura", f, m, cargado);
  assert.ok(ahorrando.modelo.startsWith("opencode:"), ahorrando.modelo);
  assert.match(ahorrando.motivo, /dice ahorrar hoy: uso big-pickle/i);
  const g = reparto(["--plan", "gastar-hoy"], f, m);
  assert.match(g.out, /Ritmo Claude semanal: 2,5× -> 0,2×/);
  assert.equal(JSON.parse(reparto(["--plan", "ver", "--json"], f, m).out).plan.hoy, "gastar");
  assert.ok(esClaude(tipo("lectura", f, m, cargado).modelo));
  // Un día suma, otro vence: ausente mañana y el 29; pasado mañana el de hoy ya no está y ausente sigue.
  assert.equal(reparto(["--plan", "ausente", "manana,2026-10-29"], f, m).rc, 0);
  const archivo = JSON.parse(readFileSync(path.join(estado, "plan.json"), "utf8"));
  assert.deepEqual(archivo.ausente, ["2026-10-27", "2026-10-29"]);
  const dia2 = JSON.parse(reparto(["--plan", "ver", "--json"], f, m, { REPARTO_AHORA: "2026-10-28T09:00:00Z" }).out);
  assert.equal(dia2.plan.hoy, null);
  assert.deepEqual(dia2.plan.ausente, ["2026-10-29"]);
  const dia4 = JSON.parse(reparto(["--plan", "ver", "--json"], f, m, { REPARTO_AHORA: "2026-10-30T09:00:00Z" }).out);
  assert.deepEqual([dia4.plan.ausente, dia4.plan.hoy], [[], null]);
  // Una orden nueva poda lo vencido del archivo; borrar lo deja sin archivo.
  assert.equal(reparto(["--plan", "ausente", "2026-11-02"], f, m, { REPARTO_AHORA: "2026-10-30T09:00:00Z" }).rc, 0);
  assert.deepEqual(JSON.parse(readFileSync(path.join(estado, "plan.json"), "utf8")).ausente, ["2026-11-02"]);
  assert.equal(reparto(["--plan", "borrar"], f, m).rc, 0);
  assert.equal(existsSync(path.join(estado, "plan.json")), false);
});

test("--plan rechaza fechas que no van", () => {
  const f = cupos({ c7: 0.3, vuelve7: 96 });
  const m = modelos();
  for (const mal of ["ayer", "2026-10-25", "2026-13-01", "2027-03-01", ""]) {
    const r = reparto(["--plan", "ausente", mal], f, m);
    assert.equal(r.rc, 2, `${mal}: ${r.out}`);
  }
  assert.equal(reparto(["--plan", "nada"], f, m).rc, 2);
  assert.equal(existsSync(path.join(estado, "plan.json")), false);
});

test("perfil y reserva_lider inválidos: reparto avisa y usa los defaults", () => {
  const r = reparto(["--tipo", "lectura", "--json"], cupos({ c7: 0.3, vuelve7: 96 }), modelos({ perfil: "loco" }));
  assert.equal(r.rc, 0);
  assert.match(r.err, /perfil "loco"/);
  const s = reparto(["--tipo", "lectura", "--json"], cupos({ c7: 0.3, vuelve7: 96 }), modelos({ reserva_lider: 1.5 }));
  assert.match(s.err, /reserva_lider/);
});

test("pa --plan pasa las órdenes de ritmo a reparto (y sigue aceptando pro|max)", () => {
  const f = cupos({ c7: 0.5, vuelve7: 96 });
  const pa = (args: string[]) =>
    spawnSync(path.join(BIN, "pa"), args, {
      encoding: "utf8",
      env: { ...process.env, TZ: "UTC", PA_STATE: path.join(tmp, "pa-estado"), REPARTO_STATE: estado, REPARTO_CUPOS_FIJOS: f, REPARTO_AHORA: AHORA, TRAMA_MODELOS: modelos(), REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}', REPARTO_OPENCODE_FIJO: "[]" },
    });
  const a = pa(["--plan", "ausente", "2026-10-28"]);
  assert.equal(a.status, 0, a.stderr);
  assert.match(a.stdout, /Ausente: 2026-10-28/);
  assert.match(pa(["--plan", "ver"]).stdout, /Días ausentes: 2026-10-28/);
  assert.equal(pa(["--plan", "borrar"]).status, 0);
  assert.match(pa(["--plan", "ver"]).stdout, /Días ausentes: ninguno/);
  assert.equal(pa(["--plan", "raro"]).status, 2);
});

test("la app calcula el mismo ritmo que reparto (src/paneles/cupos-ritmo.ts)", () => {
  const ahora = Date.parse(AHORA) / 1000;
  const vuelve = ahora + 96 * 3600;
  // Los mismos números del primer test: 50 % usado a 3 de 7 días = 1,17×, por encima.
  const r = ritmoSemanal(50, vuelve, ahora)!;
  assert.equal(r.nivel, "encima");
  assert.ok(Math.abs(r.ratio - 1.1667) < 0.001);
  assert.equal(r.pct, 17);
  const f = cupos({ c7: 0.5, vuelve7: 96 });
  const py = tipo("lectura", f, modelos()).ritmo[0]!;
  assert.ok(Math.abs(py.ratio - r.ratio) < 0.001);
  // La reserva del líder (perfil ahorro) se mide sobre lo que les toca a los workers.
  const ah = ritmoSemanal(50, vuelve, ahora, reservaDePerfil("ahorro"))!;
  assert.equal(reservaDePerfil("equilibrado"), 0);
  assert.ok(Math.abs(ah.ratio - 0.5 / 0.65 / (72 / 168)) < 0.001);
  const pyAh = tipo("lectura", f, modelos({ perfil: "ahorro" })).ritmo[0]!;
  assert.ok(Math.abs(pyAh.ratio - ah.ratio) < 0.001);
  // Por debajo, al ritmo y sin dato.
  assert.equal(ritmoSemanal(10, ahora + 24 * 3600, ahora)!.nivel, "debajo");
  assert.equal(ritmoSemanal(43, vuelve, ahora)!.nivel, "al-ritmo");
  assert.equal(ritmoSemanal(null, vuelve, ahora), null);
  assert.equal(ritmoSemanal(40, null, ahora), null);
  // Al empezar la semana no se divide por casi cero.
  assert.ok(ritmoSemanal(5, ahora + 167.9 * 3600, ahora)!.ratio <= 0.5);
});
