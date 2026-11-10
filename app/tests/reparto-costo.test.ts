// El costo REAL de reparto: lo medido en las corridas (medicion.tsv) en vez de los pesos fijos de la tabla.
// La lógica pura está en electron/cli/reparto-costo.ts; el reparto de TypeScript (electron/cli/reparto.ts) la usa para
// poner `costo_real` y `usd_por_exito` en cada candidato y para ordenar a los del perfil agresivo por el US$ por éxito.
// El python de motor/bin/reparto queda congelado: estos casos son sólo del TS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { costoMedio, DIAS_COSTO, leerMedicion, MIN_N_COSTO, MIN_N_EXITO, muestra, muestraModelo, PESOS, pesoDe, tasaOk, usdPorExito } from "../electron/cli/reparto-costo.ts";

const BIN = path.join(import.meta.dirname, "..", "..", "motor", "bin");
const tmp = mkdtempSync(path.join(os.tmpdir(), "reparto-costo-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));

const AHORA = "2026-10-26T12:00:00Z";
let n = 0;
const arch = (j: object) => {
  const f = path.join(tmp, `a${n++}.json`);
  writeFileSync(f, JSON.stringify(j));
  return f;
};
const vent = (u5: number, u7: number) => [{ id: "5h", usado: u5, vuelve: "2026-10-26T15:00:00Z" }, { id: "7d", usado: u7, vuelve: "2026-10-30T00:00:00Z" }];
const cuposFijos = () =>
  arch({
    version: 1,
    leido: AHORA,
    suscripciones: [
      { id: "claude", nombre: "Claude", proveedor: "claude", cuenta: "claude", ventanas: vent(0.1, 0.3) },
      { id: "google", nombre: "Google AI Pro", grupos: [{ id: "gemini", nombre: "Gemini", ventanas: vent(0.1, 0.2) }] },
    ],
  });
const modelos = (j: object = {}) => arch({ version: 1, ...j });

// --- el archivo de medición de prueba -------------------------------------------------------------------
type Fila = { fecha?: string; modelo: string; effort?: string; leer?: boolean; tipo: string; integrada?: string; retrabajo?: string; costo?: string };
const HEADER = "fecha\tid\tproyecto\tmodelo\teffort\tleer\tseguir\tis_error\tnum_turns\tduration_s\ttokens\tcosto_usd\tbien\tplan\tcompactaciones\tautocompact\torigen\tcache_read\tcache_creation\tephemeral_1h\tephemeral_5m\ttipo\tintegrada\tretrabajo\tcuenta\n";
/** Un medicion.tsv de prueba: cada fila es una corrida (con dato: integrada=1 y retrabajo 0/1; sin dato: integrada=0). */
function medicion(filas: Fila[]): string {
  let t = HEADER;
  let i = 0;
  for (const f of filas) {
    const c = [
      f.fecha ?? "2026-10-20T10:00:00+00:00",
      `r${i++}`,
      "proy",
      f.modelo,
      f.effort ?? "medium",
      f.leer ? "1" : "0",
      "0",
      "false",
      "10",
      "5",
      "1000",
      f.costo ?? "",
      "",
      "",
      "0",
      "",
      "",
      "",
      "",
      "",
      "",
      f.tipo,
      f.integrada ?? "",
      f.retrabajo ?? "",
      "",
    ];
    t += c.join("\t") + "\n";
  }
  const p = path.join(tmp, `med${n++}.tsv`);
  writeFileSync(p, t);
  return p;
}
/** N corridas del mismo modelo en un tipo: `ok` de ellas integradas sin retrabajo (las otras, integradas=0: tienen dato pero no salieron bien). */
const corridas = (modelo: string, tipo: string, n: number, ok: number, costo: string, extra: Partial<Fila> = {}): Fila[] =>
  Array.from({ length: n }, (_, i) => ({ modelo, tipo, costo, integrada: i < ok ? "1" : "0", retrabajo: i < ok ? "0" : "", ...extra }));

// --- la lógica pura -------------------------------------------------------------------------------------
test("leerMedicion: lee por nombre de columna y las filas sin tipo no rompen", () => {
  const filas = leerMedicion(HEADER + "2026-10-20T10:00:00+00:00\tr1\tproy\tclaude-sonnet-5-5\thigh\t0\t0\tfalse\t3\t5\t100\t0.25\t\t\t0\t\t\t\t\t\t\tfrontend\t1\t0\t\n" + "2026-10-21T10:00:00+00:00\tr2\tproy\tclaude-sonnet-5-5\thigh\t0\t0\tfalse\t3\t5\t100\t0.50\t\t\t0\t\t\t\t\t\t\t\t\n");
  assert.equal(filas.length, 2);
  assert.equal(filas[0]!.modelo, "claude-sonnet-5-5");
  assert.equal(filas[0]!.effort, "high");
  assert.equal(filas[0]!.tipo, "frontend");
  assert.equal(filas[0]!.costo, 0.25);
  assert.equal(filas[0]!.leer, false);
  assert.equal(filas[0]!.integrada, "1");
  assert.equal(filas[1]!.tipo, "");
  assert.equal(filas[1]!.costo, 0.5);
  // el effort "-" es el mismo que no Effort
  assert.equal(leerMedicion(HEADER + "2026-10-20T10:00:00+00:00\tr1\tproy\topencode:x\t-\t0\t0\tfalse\t3\t5\t100\t0\t\t\t0\t\t\t\t\t\t\tmecanico\t1\t0\t\n")[0]!.effort, "");
});

test("muestra: filtra por tipo x modelo x effort, por los 60 días y saca las de sólo lectura (menos en lectura)", () => {
  const desde = "2026-08-27";
  const filas = leerMedicion(
    readFileSync(
      medicion([
        ...corridas("claude-sonnet-5-5", "frontend", 3, 3, "1.00", { effort: "high" }),
        ...corridas("claude-sonnet-5-5", "frontend", 2, 2, "9.00", { effort: "low" }),
        ...corridas("claude-sonnet-5-5", "frontend", 2, 2, "8.00", { effort: "high", leer: true }),
        ...corridas("claude-sonnet-5-5", "lectura", 2, 2, "7.00", { effort: "high", leer: true }),
        ...corridas("claude-sonnet-5-5", "frontend", 2, 2, "6.00", { effort: "high", fecha: "2026-07-01T10:00:00+00:00" }),
        ...corridas("claude-haiku-5-5", "frontend", 2, 2, "5.00", { effort: "high" }),
      ]),
      "utf8",
    ),
  );
  const m = muestra(filas, { tipo: "frontend", modelo: "claude-sonnet-5-5", effort: "high" }, desde);
  assert.equal(m.n, 3, "sólo las de frontend, effort high y sin --leer");
  assert.equal(m.usd, 3);
  assert.equal(m.dato, 3);
  assert.equal(m.ok, 3);
  // en lectura entra la de sólo lectura
  const l = muestra(filas, { tipo: "lectura", modelo: "claude-sonnet-5-5", effort: "high" }, desde);
  assert.equal(l.n, 2);
  // sin effort: cuenta el modelo entero
  const s = muestra(filas, { tipo: "frontend", modelo: "claude-sonnet-5-5" }, desde);
  assert.equal(s.n, 5);
});

test("costoMedio y usdPorExito: hacen falta 5 corridas con costo y 10 con dato", () => {
  const m = { n: 4, usd: 4, ok: 4, dato: 4 };
  assert.equal(costoMedio(m), null, "con 4 corridas no se cree el costo medio");
  assert.equal(costoMedio({ n: 5, usd: 5, ok: 5, dato: 5 }), 1);
  assert.equal(tasaOk(m), 1);
  assert.equal(usdPorExito(m), null, "con 4 corridas con dato no se cree el US$ por éxito");
  const diez = { n: 10, usd: 20, ok: 5, dato: 10 };
  assert.equal(tasaOk(diez), 0.5);
  assert.equal(usdPorExito(diez), 4, "2 US$ por corrida ÷ 50 % de acierto");
  // sin acierto no hay US$ por éxito (no se divide por cero)
  assert.equal(usdPorExito({ n: 10, usd: 20, ok: 0, dato: 10 }), null);
  assert.equal(MIN_N_COSTO, 5);
  assert.equal(MIN_N_EXITO, 10);
  assert.equal(DIAS_COSTO, 60);
});

test("los pesos corregidos: Opus 1, Sonnet 0,29 y Haiku 0,054 (relativos a Opus)", () => {
  assert.equal(PESOS.opus, 1);
  assert.equal(PESOS.sonnet, 0.29);
  assert.equal(PESOS.haiku, 0.054);
  assert.equal(pesoDe("sonnet"), 0.29);
  assert.equal(pesoDe("haiku"), 0.054);
  assert.equal(pesoDe("desconocida"), 0.3);
});

test("muestraModelo: el ancla (Opus) con su costo medio y su tasa de acierto", () => {
  const filas = leerMedicion(
    readFileSync(
      medicion([
        ...corridas("claude-opus-5-5", "frontend", 10, 5, "4.00"),
        ...corridas("claude-sonnet-5-5", "frontend", 10, 10, "1.00"),
        ...corridas("claude-sonnet-5-5", "debug", 10, 0, "1.00"),
      ]),
      "utf8",
    ),
  );
  const desde = "2026-08-27";
  const ancla = muestraModelo(filas, ["claude-opus-5-5", "opus"], desde);
  assert.equal(costoMedio(ancla), 4);
  assert.equal(tasaOk(ancla), 0.5);
  assert.equal(usdPorExito(ancla), 8, "4 US$ por corrida ÷ la mitad de acierto");
});

// --- el reparto de verdad ---------------------------------------------------------------------------------
type Cand = { modelo: string; descartado_por: string | null; costo?: number; costo_real?: number; usd_por_exito?: number; historial?: { n: number; ok_pct: number | null } };
type Sal = { modelo: string; motivo: string; perfil: string; candidatos: Cand[] };

function correr(tipo: string, mod: string, med: string) {
  const r = spawnSync(path.join(BIN, "reparto"), ["--tipo", tipo, "--json"], {
    encoding: "utf8",
    env: {
      ...process.env,
      TZ: "UTC",
      TRAMA_REPARTO: "ts",
      REPARTO_CUPOS_FIJOS: cuposFijos(),
      REPARTO_AGY: "0",
      REPARTO_AHORA: AHORA,
      REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}',
      REPARTO_OPENCODE_FIJO: '["opencode/big-pickle"]',
      REPARTO_STATE: path.join(tmp, `estado${n++}`),
      REPARTO_CARGA_FIJA: "{}",
      REPARTO_MEDICION: med,
      TRAMA_MODELOS: mod,
    },
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return JSON.parse(r.stdout) as Sal;
}
const cand = (s: Sal, m: string) => s.candidatos.find((c) => c.modelo === m)!;

/** La medición del caso: Opus de ancla (4 US$ por corrida, 50 % de acierto), Sonnet barato y con acierto, Haiku barato y flojo. */
const MEDICION = medicion([
  ...corridas("claude-opus-5-5", "codigo-acotado", 12, 6, "4.00"),
  ...corridas("claude-sonnet-5-5", "codigo-acotado", 12, 12, "1.00"),
  ...corridas("claude-haiku-5-5", "codigo-acotado", 12, 1, "0.20"),
]);

test("reparto --tipo --json: cada candidato lleva su costo real y su US$ por éxito", () => {
  const s = correr("codigo-acotado", modelos({ perfil: "agresivo" }), MEDICION);
  const sonnet = cand(s, "claude-sonnet-5-5");
  assert.equal(sonnet.costo_real, 1);
  assert.equal(sonnet.usd_por_exito, 1, "1 US$ por corrida y 100 % de acierto");
  const haiku = cand(s, "claude-haiku-5-5");
  assert.ok(Math.abs((haiku.costo_real ?? 0) - 0.2) < 1e-9);
  assert.ok(Math.abs((haiku.usd_por_exito ?? 0) - 2.4) < 1e-9, "0,20 US$ por corrida ÷ 1 de 12 corridas sin retrabajo");
  const opus = cand(s, "claude-opus-5-5");
  assert.equal(opus.costo_real, 4);
  assert.equal(opus.usd_por_exito, 8, "4 US$ por corrida ÷ la mitad de acierto");
});

test("perfil agresivo: ordena por el US$ por éxito medido (Sonnet le gana a Haiku, que sale más barato por corrida)", () => {
  const s = correr("codigo-acotado", modelos({ perfil: "agresivo" }), MEDICION);
  assert.equal(s.modelo, "claude-sonnet-5-5", s.motivo);
  // con los pesos fijos ganaba Haiku (0,12 contra 0,35): el que gana es el más barato por éxito
  assert.ok((cand(s, "claude-sonnet-5-5").usd_por_exito ?? Infinity) < (cand(s, "claude-haiku-5-5").usd_por_exito ?? Infinity));
  // el motivo lo dice
  assert.match(s.motivo, /Perfil agresivo: de los que pasan el piso de codigo-acotado, el más barato \(costo relativo [^)]+, medido, US\$ [^ ]+ por éxito\)/);
});

test("sin dato suficiente: el costo real es la estimación con los pesos corregidos y no hay US$ por éxito", () => {
  // sólo 4 corridas de Sonnet: no hay costo medio medido (hacen falta 5) → se estima con el peso (0,29) por el Opus medido
  const med = medicion([...corridas("claude-opus-5-5", "codigo-acotado", 12, 6, "4.00"), ...corridas("claude-sonnet-5-5", "codigo-acotado", 4, 4, "1.00")]);
  const s = correr("codigo-acotado", modelos({ perfil: "agresivo" }), med);
  const sonnet = cand(s, "claude-sonnet-5-5");
  assert.ok(Math.abs((sonnet.costo_real ?? 0) - 0.29 * 4) < 1e-9, "el peso corregido de Sonnet por el costo medido de Opus");
  assert.equal(sonnet.usd_por_exito, undefined, "sin 10 corridas con dato no hay US$ por éxito");
  assert.equal(cand(s, "claude-opus-5-5").usd_por_exito, 8, "Opus sí tiene dato suficiente");
  // sin US$ por éxito, el reparto ordena como siempre (el más barato por los pesos)
  assert.equal(s.modelo, "claude-haiku-5-5", s.motivo);
});

test("sin medición no hay costo real: el reparto queda como siempre", () => {
  const s = correr("codigo-acotado", modelos({ perfil: "agresivo" }), medicion([]));
  assert.equal(s.candidatos.every((c) => c.costo_real === undefined && c.usd_por_exito === undefined), true);
  assert.equal(s.modelo, "claude-haiku-5-5", "sin dato, gana el más barato por los pesos de siempre");
});
