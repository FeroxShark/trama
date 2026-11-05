// Perfil `agresivo` de `reparto` (motor/bin/reparto y su port electron/cli/reparto.ts): el modelo más barato que supere el piso del tipo
// (`minimo_por_tipo`, duro), con la reserva del líder del ahorro; un gratis sin historial en `pa --rinde` (medicion.tsv) sólo entra en
// lectura/mecanico hasta tener 5 corridas con dato y 50 % o más sin retrabajo; Flash nunca escribe. Cupos, hora, modelos.json y medición
// fijos por entorno (REPARTO_CUPOS_FIJOS / REPARTO_AHORA / TRAMA_MODELOS / REPARTO_MEDICION): no mira nada real. Cada caso corre en los dos
// motores (el TS por defecto y TRAMA_REPARTO=py) y exige la misma salida.
import { after, beforeEach } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const BIN = path.join(import.meta.dirname, "..", "..", "motor", "bin");
const tmp = mkdtempSync(path.join(os.tmpdir(), "reparto-agresivo-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const AHORA = "2026-10-26T12:00:00Z";
const en = (h: number) => new Date(Date.parse(AHORA) + h * 3600_000).toISOString().replace(".000", "");
let n = 0;
const arch = (j: object) => {
  const f = path.join(tmp, `a${n++}.json`);
  writeFileSync(f, JSON.stringify(j));
  return f;
};
const vent = (u5: number, u7: number) => [{ id: "5h", usado: u5, vuelve: en(3) }, { id: "7d", usado: u7, vuelve: en(96) }];
/** Las cuentas fijas de la tabla: Claude (semana al 30 %) y Google con sus tres grupos (Gemini/Flash, Claude y GPT, Argon). */
const cuposFijos = (c7 = 0.3) =>
  arch({
    version: 1,
    leido: AHORA,
    suscripciones: [
      { id: "claude", nombre: "Claude", proveedor: "claude", cuenta: "claude", ventanas: vent(0.1, c7) },
      {
        id: "google", nombre: "Google AI Pro",
        grupos: [
          { id: "gemini", nombre: "Gemini", ventanas: vent(0.1, 0.2) },
          { id: "claude-gpt", nombre: "Claude y GPT por Google", ventanas: vent(0.1, 0.2) },
          { id: "gemini-4-argon", nombre: "Gemini 4 Argon", ventanas: [{ id: "7d", usado: 0.2, vuelve: en(96) }] },
        ],
      },
    ],
  });
const modelos = (j: object = {}) => arch({ version: 1, ...j });

const BIG = "opencode:opencode/big-pickle";
/** medicion.tsv con `n` corridas de big-pickle en `tipo`, `ok` integradas sin retrabajo (el resto con retrabajo). */
const medicion = (filas: { tipo: string; modelo: string; n: number; ok: number }[]) => {
  let t = "fecha\tid\tproyecto\tmodelo\teffort\ttipo\tintegrada\tretrabajo\n";
  for (const f of filas) for (let i = 0; i < f.n; i++) t += `2026-10-20T10:00:00+00:00\t${f.tipo}${i}\tp\t${f.modelo}\tsettings\t${f.tipo}\t1\t${i < f.ok ? 0 : 1}\n`;
  const f = path.join(tmp, `med${n++}.tsv`);
  writeFileSync(f, t);
  return f;
};
const SIN_HISTORIAL = medicion([]);

let estado = "";
beforeEach(() => void (estado = path.join(tmp, `estado${n++}`)));
type Cand = { modelo: string; descartado_por: string | null; costo?: number; historial?: { n: number; ok_pct: number | null } };
type Sal = { modelo: string; effort: string | null; motivo: string; perfil: string; candidatos: Cand[]; perfil_info: { id: string; costo_primero: boolean; reserva_lider_pct: number; relaja: boolean } };
function correr(motor: "ts" | "py", t: string, fijos: string, mod: string, med: string) {
  const r = spawnSync(path.join(BIN, "reparto"), ["--tipo", t, "--json"], {
    encoding: "utf8",
    env: {
      ...process.env,
      TZ: "UTC",
      TRAMA_REPARTO: motor,
      REPARTO_CUPOS_FIJOS: fijos,
      REPARTO_AGY: "1",
      REPARTO_AHORA: AHORA,
      REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}',
      REPARTO_OPENCODE_FIJO: '["opencode/big-pickle"]',
      REPARTO_STATE: estado,
      REPARTO_CARGA_FIJA: "{}",
      REPARTO_MEDICION: med,
      TRAMA_MODELOS: mod,
    },
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return { sal: JSON.parse(r.stdout) as Sal, crudo: r.stdout, err: r.stderr };
}
/** Corre en TS y en python, exige la misma salida y devuelve una. */
function tipo(t: string, fijos: string, mod: string, med = SIN_HISTORIAL) {
  const ts = correr("ts", t, fijos, mod, med);
  const py = correr("py", t, fijos, mod, med);
  assert.equal(ts.crudo, py.crudo, `ts y python difieren en ${t}`);
  return { ...ts, py };
}
const cand = (s: Sal, m: string) => s.candidatos.find((c) => c.modelo === m)!;
const corto = (m: string) => m.replace("claude-", "").replace("-5-5", "").replace("opencode:opencode/", "").replace("agy:", "agy ");

const PERFILES = ["equilibrado", "ahorro", "agresivo", "rendimiento"];
const TIPOS = ["lectura", "mecanico", "codigo-acotado", "codigo-multi", "frontend", "debug", "diseno", "final"];

test("tabla perfil × tipo con las mismas cuentas: agresivo difiere de ahorro donde escribe código sin historial de los gratis", () => {
  const f = cuposFijos();
  const filas: Record<string, Record<string, Sal>> = {};
  for (const p of PERFILES) {
    const mod = modelos({ perfil: p });
    filas[p] = {};
    for (const t of TIPOS) filas[p]![t] = tipo(t, f, mod).sal;
  }
  const linea = (t: string) => t.padEnd(15) + PERFILES.map((p) => `${corto(filas[p]![t]!.modelo)} ${filas[p]![t]!.effort ?? ""}`.trim().padEnd(26)).join("");
  console.log("\n" + "tipo".padEnd(15) + PERFILES.map((p) => p.padEnd(26)).join("") + "\n" + TIPOS.map(linea).join("\n"));
  for (const p of PERFILES) for (const t of TIPOS) assert.equal(filas[p]![t]!.perfil, p);
  // Sin el perfil, reparto lo rechazaría y caería al equilibrado: acá es el suyo.
  assert.deepEqual(filas.agresivo!.lectura!.perfil_info, { id: "agresivo", costo_primero: true, reserva_lider_pct: 35, relaja: false });
  // Donde escribe: ahorro y equilibrado dejan que el gratis sin historial (big-pickle) haga código-acotado; agresivo no, y elige el más barato que queda.
  assert.equal(filas.ahorro!["codigo-acotado"]!.modelo, BIG);
  assert.equal(filas.equilibrado!["codigo-acotado"]!.modelo, BIG);
  assert.equal(filas.agresivo!["codigo-acotado"]!.modelo, "claude-haiku-5-5");
  assert.match(cand(filas.agresivo!["codigo-acotado"]!, BIG).descartado_por ?? "", /^sin historial en codigo-acotado: .* 0 corridas con dato \(sin dato\)/);
  // En lo que no escribe el gratis sigue entrando sin historial.
  for (const t of ["lectura", "mecanico"]) assert.equal(filas.agresivo![t]!.modelo, BIG, t);
  // Piso duro y costo primero: el ganador de cada tipo vive y ningún candidato vivo cuesta menos.
  for (const t of TIPOS) {
    const s = filas.agresivo![t]!;
    const vivos = s.candidatos.filter((c) => c.descartado_por === null);
    const g = vivos.find((c) => c.modelo === s.modelo)!;
    assert.ok(g, `${t}: el ganador está entre los vivos`);
    assert.ok(vivos.every((c) => (c.costo ?? 0) >= (g.costo ?? 0)), `${t}: algún vivo cuesta menos que ${s.modelo}`);
  }
});

test("historial: el gratis entra en un tipo que escribe con 5 o más corridas con dato y 50 % o más sin retrabajo en ESE tipo, y no antes", () => {
  const f = cuposFijos();
  const mod = modelos({ perfil: "agresivo" });
  const con = (n: number, ok: number, t = "codigo-acotado") => tipo("codigo-acotado", f, mod, medicion([{ tipo: t, modelo: BIG, n, ok }])).sal;
  const bien = con(6, 4); // 67 %
  assert.equal(bien.modelo, BIG, bien.motivo);
  assert.deepEqual(cand(bien, BIG).historial, { n: 6, ok_pct: 67 });
  const justo = con(5, 3); // 60 %, el mínimo de corridas
  assert.equal(justo.modelo, BIG);
  const pocas = con(4, 4); // 100 %, pero 4 corridas
  assert.equal(pocas.modelo, "claude-haiku-5-5");
  assert.match(cand(pocas, BIG).descartado_por!, /4 corridas con dato \(100 % ok\)/);
  const malas = con(8, 3); // 38 %
  assert.equal(malas.modelo, "claude-haiku-5-5");
  assert.match(cand(malas, BIG).descartado_por!, /8 corridas con dato \(38 % ok\)/);
  assert.equal(con(10, 8, "debug").modelo, "claude-haiku-5-5", "las corridas de otro tipo no cuentan");
  // Una corrida sin dato (integrada vacía) no cuenta como corrida con dato.
  const f2 = path.join(tmp, `med${n++}.tsv`);
  writeFileSync(f2, "fecha\tid\tproyecto\tmodelo\teffort\ttipo\tintegrada\tretrabajo\n" + Array.from({ length: 9 }, (_, i) => `2026-10-20T10:00:00+00:00\tx${i}\tp\t${BIG}\ts\tcodigo-acotado\t\t\n`).join(""));
  assert.equal(tipo("codigo-acotado", f, mod, f2).sal.modelo, "claude-haiku-5-5");
  // Las de hace más de 60 días no cuentan.
  const f3 = path.join(tmp, `med${n++}.tsv`);
  writeFileSync(f3, "fecha\tid\tproyecto\tmodelo\teffort\ttipo\tintegrada\tretrabajo\n" + Array.from({ length: 9 }, (_, i) => `2026-07-01T10:00:00+00:00\tx${i}\tp\t${BIG}\ts\tcodigo-acotado\t1\t0\n`).join(""));
  assert.equal(tipo("codigo-acotado", f, mod, f3).sal.modelo, "claude-haiku-5-5");
  // Con el archivo de medición ausente: sin historial, sin romper.
  assert.equal(tipo("codigo-acotado", f, mod, path.join(tmp, "no-existe.tsv")).sal.modelo, "claude-haiku-5-5");
});

test("el piso es duro: minimo_por_tipo no se relaja en agresivo (ahorro baja lectura/mecanico, agresivo no)", () => {
  const f = cuposFijos();
  // Un piso alto para lectura (calidad de Argon): el gratis no llega y, con un piso duro, el ganador es el más barato que sí llega.
  const piso = { minimo_por_tipo: { lectura: "argon" } };
  const ag = tipo("lectura", f, modelos({ perfil: "agresivo", ...piso })).sal;
  assert.notEqual(ag.modelo, BIG);
  assert.match(cand(ag, BIG).descartado_por ?? "", /^calidad .* menor que la .* que pide lectura/);
  const vivos = ag.candidatos.filter((c) => c.descartado_por === null);
  assert.ok(vivos.length > 0 && vivos.every((c) => (c.costo ?? 0) >= (vivos.find((v) => v.modelo === ag.modelo)!.costo ?? 0)));
  // El ahorro SÍ lo relaja (50 de la escala vieja): ahí el gratis vuelve a entrar.
  const ah = tipo("lectura", f, modelos({ perfil: "ahorro", ...piso })).sal;
  assert.equal(ah.modelo, BIG);
});

test("Flash nunca escribe en agresivo, aunque modelos.json lo deje libre; los otros perfiles sí lo dejan", () => {
  const f = cuposFijos();
  const libre = { uso_por_modelo: { "gemini-3.8-flash": "libre" } };
  const flash = (s: Sal) => s.candidatos.find((c) => c.modelo.startsWith("gemini-3.8-flash"))!;
  for (const t of ["codigo-acotado", "mecanico", "debug"]) {
    const ag = tipo(t, f, modelos({ perfil: "agresivo", ...libre })).sal;
    assert.ok(/^Flash no escribe en el perfil agresivo|^calidad/.test(flash(ag).descartado_por ?? ""), `${t}: ${flash(ag).descartado_por}`);
    assert.notEqual(ag.modelo, flash(ag).modelo);
  }
  assert.match(flash(tipo("mecanico", f, modelos({ perfil: "agresivo", ...libre })).sal).descartado_por ?? "", /^Flash no escribe/);
  assert.equal(flash(tipo("mecanico", f, modelos({ perfil: "ahorro", ...libre })).sal).descartado_por, null, "con ahorro y uso libre, Flash puede hacer mecanico");
  assert.equal(flash(tipo("lectura", f, modelos({ perfil: "agresivo" })).sal).descartado_por, null, "lectura sí");
});

test("conserva la reserva del líder: con la semana de Claude al 70 % (le queda el 30 %, menos que la reserva de 35 %) los workers no gastan Claude", () => {
  const f = cuposFijos(0.7);
  for (const t of ["lectura", "codigo-acotado", "codigo-multi"]) {
    const s = tipo(t, f, modelos({ perfil: "agresivo", reserva_lider: 0.35 })).sal;
    const claudes = s.candidatos.filter((c) => c.modelo.startsWith("claude-"));
    // (un Claude que no llega al piso del tipo se descarta antes por calidad: esa razón gana, pero ninguno queda vivo)
    assert.ok(claudes.some((c) => /reserva del líder/.test(c.descartado_por ?? "")), `${t}: ${JSON.stringify(claudes.map((c) => c.descartado_por))}`);
    assert.ok(claudes.every((c) => c.descartado_por !== null) && !s.modelo.startsWith("claude-"), `${t}: ${s.modelo}`);
  }
  assert.equal(tipo("lectura", f, modelos({ perfil: "agresivo" })).sal.perfil_info.reserva_lider_pct, 35);
});

test("sin ningún otro modelo que sirva, el gratis sin historial vuelve a entrar (mejor eso que nada) y el motivo lo dice", () => {
  const solo = arch({ version: 1, leido: AHORA, suscripciones: [] });
  const r = correr("ts", "codigo-acotado", solo, modelos({ perfil: "agresivo", excluir: ["claude-*", "gemini-*", "agy:*"] }), SIN_HISTORIAL);
  const py = correr("py", "codigo-acotado", solo, modelos({ perfil: "agresivo", excluir: ["claude-*", "gemini-*", "agy:*"] }), SIN_HISTORIAL);
  assert.equal(r.crudo, py.crudo);
  assert.equal(r.sal.modelo, BIG, r.sal.motivo);
  assert.match(r.sal.motivo, /No queda ningún otro modelo que sirva: entra .* aunque no tiene historial en codigo-acotado \(perfil agresivo\)/);
});

test("validación: modelos.json acepta perfil agresivo y rechaza uno que no existe, nombrándolo en el mensaje", () => {
  const ok = correr("ts", "lectura", cuposFijos(), modelos({ perfil: "agresivo" }), SIN_HISTORIAL);
  assert.doesNotMatch(ok.err, /no va/);
  assert.equal(ok.sal.perfil, "agresivo");
  for (const motor of ["ts", "py"] as const) {
    const mal = correr(motor, "lectura", cuposFijos(), modelos({ perfil: "feroz" }), SIN_HISTORIAL);
    assert.match(mal.err, /perfil "feroz" \(equilibrado, ahorro, agresivo o rendimiento\)/, motor);
    assert.equal(mal.sal.perfil, "equilibrado");
  }
});
