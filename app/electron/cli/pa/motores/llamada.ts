// La llamada a un worker de otro motor: programa, argv, entorno y a dónde va su salida. Copia del armado de agy, codex y dsh
// (armar_llamada) y de `correr` (los `exec` de cada motor) de motor/bin/pa. dsh y opencode corren por su runner node, que ya es
// node (motor/dsh/correr.mjs, motor/opencode/correr.mjs): se lanza ese mismo archivo, no hay copia en TS.
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { delimitadorDe, homeDe, plataformaActual, type Plataforma } from "../../../rutas.ts";
import { CONTRATO, CONTRATO_AGY, CONTRATO_CODEX, SIN_JEFE, conJefe } from "../contrato.ts";
import type { Env, Io } from "../entorno.ts";
import { codexShims, dshBin, dshClave, dshCorrer, localDe, opencodeBin, opencodeCorrer, type Local } from "./chequeo.ts";
import { dshModeloDe, dshProveedor, esOpencode, type Motor } from "./modelos.ts";
import { claudeMdDueno, promptOtroMotor } from "./prompt.ts";

/** El contrato de un motor antes de `conDueno`: agy y codex/dsh tienen el suyo y corren sin jefe (no tienen SendMessage). */
export function contratoBase(motor: Motor, jefe: string): string {
  if (motor === "agy") return `${CONTRATO_AGY}\n${SIN_JEFE}`;
  if (motor === "codex" || motor === "dsh") return `${CONTRATO_CODEX}\n${SIN_JEFE}`;
  return jefe ? `${CONTRATO}\n${conJefe(jefe)}` : `${CONTRATO}\n${SIN_JEFE}`;
}

/** El entorno de la cuenta (`cuentas env <id> --json`: `sacar` y `poner`), sólo para el proceso del worker. */
export interface EntornoCuenta {
  sacar?: string[];
  poner?: Record<string, string>;
}
export function conCuenta(env: Env, c?: EntornoCuenta): Env {
  if (!c) return env;
  const r: Env = { ...env };
  for (const k of c.sacar ?? []) delete r[k];
  return { ...r, ...(c.poner ?? {}) };
}

export interface DatosLlamada {
  motor: Exclude<Motor, "claude" | "ollama">;
  modelo: string;
  /** El contrato ya armado (contratoBase + agregados + conDueno). */
  contrato: string;
  /** La tarea (con la ficha, si va). */
  prompt: string;
  /** El worktree (o el tree principal) donde corre, y el tree principal. */
  rutaTrabajo: string;
  ruta: string;
  rama: string;
  /** `$STATE/<slug>` y el id de la corrida: de ahí salen el stream, el .json, el .err y los auxiliares. */
  dir: string;
  ts: string;
  /** El archivo de latido (`$hb`) y el del mapa del proyecto. */
  hb: string;
  mapaProy: string;
  leer?: boolean;
  /** --actualizar (rebase). */
  actualizar?: boolean;
  maxTurns?: string;
  /** opencode: el effort pedido (su `--variant`). */
  ocEffort?: string;
  /** `locales` de modelos.json (dsh:ollama sale de ahí, o del Ollama de siempre). */
  locales?: Local[] | null;
  cuenta?: EntornoCuenta;
  env: Env;
  io: Pick<Io, "err">;
  plat?: Plataforma;
  /** `git rev-parse --git-common-dir` (codex): para los tests; default, el git de verdad. */
  gitComun?: (rutaTrabajo: string) => string;
}

export interface Llamada {
  cmd: string;
  args: string[];
  cwd: string;
  /** El entorno completo del proceso del worker. */
  env: Env;
  /** Lo que pa exporta en su propio entorno (lo heredan también los que lance después). */
  exporta: Env;
  /** A dónde va su stdout (agy y codex: el stream) o null (dsh: el runner escribe el stream y el .json). */
  stdout: string | null;
  stderr: string;
  transcript: string;
  /** El .json de estado de la corrida. */
  out: string;
  /** dsh: la tarea va por archivo (cabe cualquier largo y no se ve en `ps`); se escribe con 0600 y se borra al terminar. */
  tareaArchivo?: { ruta: string; texto: string };
  /** Archivos a borrar antes de lanzar (codex: el último mensaje de una corrida anterior). */
  borrarAntes: string[];
  /** codex y dsh no tienen hooks: pa escribe el latido cada `cadaS` segundos. */
  latido?: { tool: "codex" | "dsh" | "opencode"; cadaS: number };
  /** Cómo se arma el .json al terminar: agy y codex lo convierte pa; dsh lo deja su runner. */
  json: "agy" | "codex" | "runner";
}

const BASE_WORKER: Env = { PA_WORKER: "1", GIT_EDITOR: "true", GIT_SEQUENCE_EDITOR: "true" };

function gitComunReal(rutaTrabajo: string): string {
  const r = spawnSync("git", ["-C", rutaTrabajo, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" });
  return r.status === 0 ? (r.stdout ?? "").replace(/\n+$/, "") : "";
}
const segundos = (x: string | undefined, d: number) => (x && /^[0-9]+$/.test(x) && Number(x) > 0 ? Number(x) : d);

/** Los shims de codex/bin primeros en el PATH (las guardias de git y cargo de codex y dsh). En Windows no van: son sh. */
function conShims(env: Env, plat: Plataforma): Env {
  if (plat === "win32") return env;
  return { ...env, PATH: `${codexShims(env)}${delimitadorDe(plat)}${env.PATH ?? ""}` };
}

/** Arma la llamada de agy, codex o dsh/opencode. */
export function armarLlamada(d: DatosLlamada): Llamada {
  const plat = d.plat ?? plataformaActual();
  const home = homeDe(d.env, plat);
  const transcript = path.join(d.dir, `${d.ts}.stream.jsonl`);
  const out = path.join(d.dir, `${d.ts}.json`);
  const stderr = path.join(d.dir, `${d.ts}.err`);
  const carpetas = [d.rutaTrabajo, d.ruta];
  const promptCon = (mds: string[]) => promptOtroMotor({ contrato: d.contrato, mds, carpetas, tarea: d.prompt, env: d.env, io: d.io });

  if (d.motor === "agy") {
    // agy no tiene system prompt por flag ni lee CLAUDE.md (sí AGENTS.md/GEMINI.md). Los hooks y las skills los pone el plugin
    // pa-worker (hooks/agy-pa.mjs); por entorno van los datos que necesita para atar al worker a su worktree.
    const p = promptCon([claudeMdDueno(d.env, home)]);
    const args = ["-p", p, "--model", d.modelo.startsWith("agy:") ? d.modelo.slice(4) : d.modelo, "--output-format", "stream-json", "--dangerously-skip-permissions", "--print-timeout", `${d.env.PA_AGY_TIMEOUT || "3600"}s`];
    const exporta: Env = {
      PA_AGY_HB: d.hb,
      PA_AGY_RAIZ: d.rutaTrabajo,
      PA_AGY_PPAL: d.ruta,
      PA_AGY_RAMA: d.rama,
      PA_AGY_MAPA: d.mapaProy,
      PA_AGY_MODO: d.leer ? "leer" : "",
      PA_AGY_REBASE: d.actualizar ? "1" : "0",
    };
    return {
      cmd: "agy",
      args,
      cwd: d.rutaTrabajo,
      env: conCuenta({ ...d.env, ...exporta, ...BASE_WORKER }, d.cuenta),
      exporta,
      stdout: transcript,
      stderr,
      transcript,
      out,
      borrarAntes: [],
      json: "agy",
    };
  }

  if (d.motor === "codex") {
    // Sandbox de codex: workspace-write (el worktree y el .git común, donde commitea un worktree; sin red) o read-only en --leer.
    const p = promptCon([claudeMdDueno(d.env, home)]);
    const base = d.modelo.startsWith("codex:") ? d.modelo.slice(6) : d.modelo;
    const ultimo = path.join(d.dir, `${d.ts}.codex-ultimo`);
    const args = [
      "exec",
      "--json",
      "-m",
      base.includes("-") ? base.slice(0, base.lastIndexOf("-")) : base,
      "-c",
      `model_reasoning_effort="${d.modelo.slice(d.modelo.lastIndexOf("-") + 1)}"`,
      "-c",
      'approval_policy="never"',
      "--sandbox",
      d.leer ? "read-only" : "workspace-write",
      "-C",
      d.rutaTrabajo,
      "--output-last-message",
      ultimo,
    ];
    if (!d.leer) {
      const g = (d.gitComun ?? gitComunReal)(d.rutaTrabajo);
      if (g) args.push("--add-dir", g);
      if (d.env.CARGO_TARGET_DIR) args.push("--add-dir", d.env.CARGO_TARGET_DIR);
      if (existeArchivo(d.mapaProy)) args.push("--add-dir", path.dirname(d.mapaProy));
    }
    args.push(p);
    return {
      cmd: "codex",
      args,
      cwd: d.rutaTrabajo,
      env: conCuenta(conShims({ ...d.env, ...BASE_WORKER }, plat), d.cuenta),
      exporta: {},
      stdout: transcript,
      stderr,
      transcript,
      out,
      borrarAntes: [ultimo],
      latido: { tool: "codex", cadaS: segundos(d.env.PA_CODEX_LATIDO_S, 15) },
      json: "codex",
    };
  }

  // dsh y opencode: el CLAUDE.md del dueño sólo va a Ollama (con opencode y deepseek la tarea sale a otra empresa).
  const prov = dshProveedor(d.modelo);
  const p = promptCon(prov === "ollama" ? [claudeMdDueno(d.env, home)] : []);
  const oc = esOpencode(d.modelo);
  const args = ["--modelo", d.modelo, "--cwd", d.rutaTrabajo, "--stream", transcript, "--salida", out];
  if (oc && d.ocEffort) args.push("--effort", d.ocEffort);
  if (prov === "ollama") args.push("--url", `${localDe(`ollama:${dshModeloDe(d.modelo)}`, d.locales ?? null, d.env).url.replace(/\/$/, "")}/v1`);
  const exporta: Env = {};
  if (d.maxTurns) {
    args.push("--max-pasos", d.maxTurns);
    exporta.PA_MAX_TURNS = d.maxTurns;
  }
  const tarea = path.join(d.dir, `${d.ts}.dsh-tarea`);
  args.push("--tarea-archivo", tarea);
  let env = conShims({ ...d.env, ...exporta, ...BASE_WORKER }, plat);
  if (oc) {
    // opencode usa el login de la persona (su HOME/XDG): ninguna key de pa viaja. Una cuenta agregada va sólo en este proceso.
    env = conCuenta({ ...env, HILOS_OPENCODE: opencodeBin(d.env, plat) }, d.cuenta);
  } else {
    env = { ...env, HILOS_DSH: dshBin(d.env, plat) };
    const k = prov === "opencode" ? "OPENCODE_API_KEY" : prov === "deepseek" ? "DEEPSEEK_API_KEY" : "";
    const v = k ? dshClave(k, d.env, plat) : "";
    if (v) env[k] = v;
  }
  return {
    cmd: "node",
    args: [oc ? opencodeCorrer(d.env) : dshCorrer(d.env), ...args],
    cwd: d.rutaTrabajo,
    env,
    exporta,
    stdout: null,
    stderr,
    transcript,
    out,
    tareaArchivo: { ruta: tarea, texto: p },
    borrarAntes: [],
    latido: { tool: oc ? "opencode" : "dsh", cadaS: segundos(d.env.PA_DSH_LATIDO_S, 10) },
    json: "runner",
  };
}

function existeArchivo(f: string): boolean {
  try {
    return statSync(f).isFile();
  } catch {
    return false;
  }
}

/**
 * El entorno de un worker local (ollama:*): el MISMO claude CLI contra el servidor local. Las ANTHROPIC_* van SÓLO en este proceso
 * (regla de facturación: nunca en otro, nunca en settings.json), y los modelos por defecto y el de subagentes también apuntan al
 * local: nada de lo que lance pide un claude-* a un servidor que no lo tiene. El argv es el de claude (con `--model <modelo local>`).
 */
export function entornoOllama(env: Env, url: string, modeloLocal: string): Env {
  return {
    ...env,
    ...BASE_WORKER,
    ANTHROPIC_BASE_URL: url,
    ANTHROPIC_AUTH_TOKEN: "ollama",
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_DEFAULT_OPUS_MODEL: modeloLocal,
    ANTHROPIC_DEFAULT_SONNET_MODEL: modeloLocal,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: modeloLocal,
    CLAUDE_CODE_SUBAGENT_MODEL: modeloLocal,
  };
}
