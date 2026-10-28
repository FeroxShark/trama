// Paridad de lanzar (etapa 6): cada caso de casos-lanzar.ts corre entero con el `pa` bash (A) y, desde la foto que sacó el
// claude con guion justo antes de lanzar, con `lanzarClaude` de app/electron/cli/pa/lanzar.ts (B), en el MISMO sandbox (la foto
// se restaura). Se compara lo que hace lanzar: stdout, stderr, código, argv de cada llamada a claude y el estado que queda
// (.hilo, .corrida, .sid, .json, .ultimo, .session, eventos, limite.hasta…). medicion.tsv no: `medir` todavía no está portado.
import assert from "node:assert/strict";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { testPosix as test } from "../plataforma.ts";
import { comandoOriginal, correr, diferencias, type Contexto, type Resultado } from "./arnes.ts";
import { casosLanzar, type CasoLanzar } from "./casos-lanzar.ts";
import { normalizar, normalizarArgv, type Raices } from "./normalizar.ts";
import { prologo, type Env } from "../../electron/cli/pa/entorno.ts";
import { lanzarClaude, type Corrida } from "../../electron/cli/pa/lanzar.ts";
import { suciosDe } from "../../electron/cli/pa/sucios.ts";

const filtro = process.env.TRAMA_PARIDAD_SOLO;
const SOLO_BASH = [/^medicion\.tsv$/];
const IGNORAR = [/^lock(\/|$)/, /^worktrees(\/|$)/, /\.log$/, /\.lock$/];

function recolectar(dir: string, r: Raices): Record<string, string> {
  const salida: Record<string, string> = {};
  const caminar = (d: string, rel: string) => {
    for (const nombre of readdirSync(d).sort()) {
      const abs = path.join(d, nombre);
      const rr = rel ? `${rel}/${nombre}` : nombre;
      if ([...IGNORAR, ...SOLO_BASH].some((re) => re.test(rr))) continue;
      const st = statSync(abs);
      if (st.isDirectory()) caminar(abs, rr);
      else if (/\.pid$/.test(nombre)) salida[normalizar(rr, r)] = "<PID>";
      else if (st.size <= 256 * 1024) salida[normalizar(rr, r)] = normalizar(readFileSync(abs, "utf8"), r);
    }
  };
  if (existsSync(dir)) caminar(dir, "");
  return salida;
}

const campos = (f: string): Record<string, string> => {
  const o: Record<string, string> = {};
  for (const l of readFileSync(f, "utf8").split("\n")) {
    const i = l.indexOf("=");
    if (i > 0 && !(l.slice(0, i) in o)) o[l.slice(0, i)] = l.slice(i + 1);
  }
  return o;
};

/** B: restaura la foto de antes de lanzar, borra lo que escribe lanzar y corre lanzarClaude con lo que pa había decidido. */
async function correrB(caso: CasoLanzar, c: Contexto): Promise<Resultado> {
  const antes = path.join(c.aux, "antes");
  assert.ok(existsSync(antes), "el bash no llegó a lanzar al claude (no hay foto)");
  const logA = path.join(c.raiz, "claude-argv.jsonl");
  const argvA = JSON.parse(readFileSync(logA, "utf8").split("\n")[0]!) as { args: string[] };
  for (const [de, a] of [[path.join(antes, "estado"), c.estado], [path.join(antes, "proy"), c.proyecto]] as const) {
    rmSync(a, { recursive: true, force: true });
    cpSync(de, a, { recursive: true, verbatimSymlinks: true });
  }
  rmSync(logA, { force: true });
  rmSync(path.join(c.aux, "guion.n"), { force: true });

  const run = readdirSync(c.estado).find((f) => f.endsWith(".running"));
  assert.ok(run, "la foto no tiene .running");
  const R = campos(path.join(c.estado, run));
  const dir = path.join(c.estado, R.proyecto!);
  const H = campos(path.join(dir, `${R.id}.hilo`));
  const K = campos(path.join(dir, `${R.id}.corrida`));
  for (const ext of ["hilo", "sid", "corrida", "json", "err"]) rmSync(path.join(dir, `${R.id}.${ext}`), { force: true });
  rmSync(path.join(c.estado, run), { force: true });
  const ev = path.join(c.estado, "eventos.jsonl");
  if (existsSync(ev)) {
    const quedan = readFileSync(ev, "utf8").split("\n").filter((l) => l && !(l.includes('"tipo":"inicio"') && l.includes(R.id!)));
    if (quedan.length) writeFileSync(ev, quedan.map((l) => l + "\n").join(""));
    else rmSync(ev);
  }

  const env: Env = JSON.parse(readFileSync(path.join(antes, "env.json"), "utf8"));
  for (const k of ["PA_WORKER", "GIT_EDITOR", "GIT_SEQUENCE_EDITOR", "PA_RECORTE", "PA_MAX_TURNS", "PA_CIERRE", "GUION_DIR", "GUION_PROY"]) delete env[k];
  const out: string[] = [];
  const err: string[] = [];
  const pa = prologo([], env, { out: (s) => out.push(s), err: (s) => err.push(s) });
  const leer = R.leer === "1";
  const usaWorktree = R.ruta_trabajo!.startsWith(path.join(c.estado, "worktrees") + "/");
  const corrida: Corrida = {
    proyecto: K.proyecto!,
    slug: R.proyecto!,
    ts: R.id!,
    ruta: R.ruta!,
    rutaTrabajo: R.ruta_trabajo!,
    rama: R.rama!,
    base: K.base!,
    origen: K.origen!,
    puesto: R.puesto!,
    leer,
    usaWorktree,
    tengoLock: !leer,
    modelo: R.modelo!,
    esfuerzo: H.effort === "settings" ? "" : H.effort!,
    cuenta: R.cuenta!,
    tarea: argvA.args[1]!,
    tareaJefe: H.tarea!,
    lanzo: H.lanzo!,
    tipo: H.tipo,
    fase: H.fase,
    tareaId: H.tarea_id,
    rubrica: H.rubrica,
    subtarea: H.subtarea,
    sid: R.sid!,
    resume: false,
    conMcp: caso.lanzar.conMcp ?? false,
    maxTurns: caso.lanzar.maxTurns,
    maxBudget: caso.lanzar.maxBudget ?? "",
    autocompact: "",
    baseDelta: usaWorktree || leer ? [] : await suciosDe(R.ruta!, c.estado, env),
    jefe: R.jefe!,
    jefeId: R.jefe_id!,
    async: Boolean(env.PA_ASYNC),
  };
  const rc = await lanzarClaude(pa, corrida, { senalesProceso: false });

  const r: Raices = { tmp: [c.raiz] };
  const res: Resultado = { pasos: [{ rc, stdout: normalizar(out.join(""), r), stderr: normalizar(err.join(""), r) }], argvClaude: [], estado: {} };
  if (existsSync(logA)) for (const l of readFileSync(logA, "utf8").split("\n").filter(Boolean)) res.argvClaude.push(normalizarArgv((JSON.parse(l) as { args: string[] }).args, r));
  res.estado = recolectar(c.estado, r);
  return res;
}

for (const caso of casosLanzar) {
  if (filtro && !caso.nombre.includes(filtro)) continue;
  test(`paridad lanzar.ts: ${caso.nombre}`, { timeout: 300_000 }, async () => {
    let ctx: Contexto | undefined;
    const conCtx: CasoLanzar = { ...caso, preparar: (c) => ((ctx = c), caso.preparar?.(c)) };
    const a = correr(conCtx, comandoOriginal());
    if (caso.rc !== undefined) assert.equal(a.pasos[0]?.rc, caso.rc, `el bash dio otro código: ${a.pasos[0]?.stderr}`);
    for (const k of Object.keys(a.estado)) if (SOLO_BASH.some((re) => re.test(k))) delete a.estado[k];
    const b = await correrB(caso, ctx!);
    const dif = diferencias(a, b);
    assert.equal(dif, "", `bash y lanzar.ts difieren:\n${dif}`);
  });
}
