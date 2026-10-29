// Arnés de paridad: corre un caso con el `pa` bash (motor/bin/pa) y con otro `pa` (TRAMA_PA_B), cada uno en su propio
// sandbox (HOME, estado, registry y proyecto git en un tmp) con el claude falso headless (app/scripts/claude-falso.mjs),
// y junta lo observable: stdout, stderr, código de salida, argv que recibió claude y archivos de estado escritos.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizar, normalizarArgv, type Raices } from "./normalizar.ts";

const APP = path.join(import.meta.dirname, "..", "..");
export const MOTOR = path.join(APP, "..", "motor");
export const PA_BASH = path.join(MOTOR, "bin", "pa");
const CLI_TS = path.join(APP, "electron", "cli");

/** Los hooks de motor/hooks: el original es el `.sh` (A) y la versión Node es el `.mjs` de al lado (B). */
export const HOOKS = ["latido", "destructive-guard", "statusline-espejo", "agy-pa"] as const;
export type Hook = (typeof HOOKS)[number];
export const esHook = (h: string): h is Hook => (HOOKS as readonly string[]).includes(h);

/** Herramientas del motor que tienen versión bash/python (A) y versión TS (B), y los hooks (`.sh` contra `.mjs`). */
export type Herramienta = "pa" | "proyecto-ruta" | "trama-estado" | "workers" | "tablero" | "cuentas" | Hook | "pa-async" | "pa-cli" | "reparto" | "motores";
const VARIABLE_B: Record<Herramienta, string> = {
  pa: "TRAMA_PA_B",
  "proyecto-ruta": "TRAMA_PROYECTO_RUTA_B",
  "trama-estado": "TRAMA_ESTADO_B",
  workers: "TRAMA_WORKERS_B",
  tablero: "TRAMA_TABLERO_B",
  cuentas: "TRAMA_CUENTAS_B",
  latido: "TRAMA_LATIDO_B",
  "destructive-guard": "TRAMA_GUARD_B",
  "statusline-espejo": "TRAMA_ESPEJO_B",
  "agy-pa": "TRAMA_AGY_PA_B",
  "pa-async": "TRAMA_PA_ASYNC_B",
  // el pa bash contra el pa de TS (electron/cli/pa.ts) en lo que ya está portado (etapa 5: CLI y política)
  "pa-cli": "TRAMA_PA_CLI_B",
  reparto: "TRAMA_REPARTO_B",
  motores: "TRAMA_MOTORES_B",
};

/** El original (bash o python) de la herramienta. */
export const originalDe = (h: Herramienta = "pa"): string =>
  esHook(h) ? path.join(MOTOR, "hooks", `${h}.sh`) : h === "pa-async" || h === "pa-cli" ? PA_BASH : path.join(MOTOR, "bin", h);
/** El comando que corre el original: los hooks `.sh` no son ejecutables sueltos en todos lados, se llaman con bash. */
export const comandoOriginal = (h: Herramienta = "pa"): string[] =>
  h === "motores" ? ["bash", path.join(import.meta.dirname, "motores-bash.sh")] : esHook(h) ? ["bash", originalDe(h)] : [originalDe(h)];
/** La versión TS de las herramientas chicas, corrida directo desde el fuente (Node saca los tipos); para los hooks, el `.mjs`. */
export const tsDe = (h: Exclude<Herramienta, "pa">): string[] =>
  h === "motores"
    ? [process.execPath, path.join(import.meta.dirname, "motores-ts.ts")]
    : esHook(h)
      ? [process.execPath, path.join(MOTOR, "hooks", `${h}.mjs`)]
      : h === "pa-async"
        ? [process.execPath, path.join(CLI_TS, "pa", "async.ts")]
        : [process.execPath, path.join(CLI_TS, `${h === "pa-cli" ? "pa" : h}.ts`)];
const FALSO = path.join(APP, "scripts", "claude-falso.mjs");

/** Contexto que ven `preparar` y los argumentos dinámicos de un caso. */
export interface Contexto {
  raiz: string;
  home: string;
  proyecto: string;
  estado: string;
  /** Lugar para archivos auxiliares del caso (briefs, etc.). */
  aux: string;
}

export interface Paso {
  /** Argumentos de `pa` (o una función si dependen de rutas del sandbox). */
  args: string[] | ((c: Contexto) => string[]);
  /** Variables de entorno extra (o una función si dependen de rutas del sandbox). */
  env?: Record<string, string> | ((c: Contexto) => Record<string, string>);
  stdin?: string | ((c: Contexto) => string);
  /** Código de salida esperado (se comprueba contra el bash; la paridad se compara siempre). */
  rc?: number;
  /** Espera (ms) después del paso: da tiempo a un hijo --async que sigue corriendo (una cola de cupo) antes del paso que lo lee. */
  pausaMs?: number;
}

export interface Caso {
  nombre: string;
  /** Qué herramienta se prueba (default: `pa`). Las demás comparan el original contra su versión TS (app/electron/cli). */
  herramienta?: Herramienta;
  /** Un solo paso (atajo) o varios, en orden, en el mismo sandbox. */
  args?: Paso["args"];
  env?: Paso["env"];
  stdin?: Paso["stdin"];
  rc?: number;
  pasos?: Paso[];
  /** Prepara el sandbox antes de correr (archivos, ramas…). */
  preparar?: (c: Contexto) => void;
  /** Subárboles del estado a comparar (default: todo salvo lock/, worktrees/ y *.log). */
  estadoIgnorar?: RegExp[];
}

export interface Resultado {
  pasos: { rc: number | null; stdout: string; stderr: string }[];
  argvClaude: string[];
  estado: Record<string, string>;
}

const PREFIJOS_LIMPIOS = ["PA_", "TRAMA_", "HILOS_", "REPARTO_", "PROYECTOS_", "FALSO_", "CLAUDE"];

/** Comando de la segunda implementación (TRAMA_PA_B para `pa`, TRAMA_PROYECTO_RUTA_B…): lista JSON o palabras separadas por espacios. null si no está. */
export function comandoB(env = process.env, h: Herramienta = "pa"): string[] | null {
  const v = env[VARIABLE_B[h]]?.trim();
  if (!v) return null;
  if (v.startsWith("[")) return JSON.parse(v) as string[];
  return v.split(/\s+/);
}

/** Hora fija y cupos falsos para los casos que muestran el ritmo de cada suscripción (`pa --plan ver`). Sin esto reparto
 *  lee `agy -p /quota` de la máquina, y ese % cambia entre la corrida de bash y la de TS. */
const AHORA_FALSO = "2026-10-26T12:00:00Z";
const ventana = (id: string, usado: number, vuelve: string) => ({ id, usado, vuelve });
const CUPO_FALSO = {
  version: 1,
  leido: AHORA_FALSO,
  suscripciones: [
    { id: "claude", nombre: "Claude", proveedor: "claude", cuenta: "claude", ventanas: [ventana("5h", 0.2, "2026-10-26T14:00:00Z"), ventana("7d", 0.5, "2026-10-30T00:00:00Z")] },
    {
      id: "google",
      nombre: "Google AI Pro",
      grupos: [
        { id: "gemini", nombre: "Gemini", ventanas: [ventana("5h", 0.1, "2026-10-26T15:00:00Z"), ventana("7d", 0.26, "2026-10-29T00:00:00Z")] },
        { id: "claude-gpt", nombre: "Claude y GPT por Google", ventanas: [ventana("5h", 0, "2026-10-26T15:00:00Z"), ventana("7d", 0.6, "2026-10-29T00:00:00Z")] },
        { id: "gemini-4-argon", nombre: "Gemini 4 Argon", ventanas: [ventana("7d", 0.9, "2026-10-28T00:00:00Z")] },
      ],
    },
  ],
};
/** El `env` de un paso que lee el ritmo: el cupo falso va a `aux` del sandbox y reparto usa esa hora fija. */
export function cupoFalso(c: Contexto): Record<string, string> {
  const f = path.join(c.aux, "cupos-falsos.json");
  writeFileSync(f, JSON.stringify(CUPO_FALSO));
  return { REPARTO_CUPOS_FIJOS: f, REPARTO_AHORA: AHORA_FALSO };
}

function crearSandbox(): Contexto {
  const raiz = realpathSync(mkdtempSync(path.join(os.tmpdir(), "paridad-")));
  const c: Contexto = {
    raiz,
    home: path.join(raiz, "home"),
    proyecto: path.join(raiz, "proy"),
    estado: path.join(raiz, "estado"),
    aux: path.join(raiz, "aux"),
  };
  for (const d of [path.join(c.home, ".config", "proyectos"), c.proyecto, c.estado, c.aux, path.join(raiz, "shim")]) mkdirSync(d, { recursive: true });
  const git = (...a: string[]) => spawnSync("git", ["-C", c.proyecto, "-c", "user.email=a@b", "-c", "user.name=x", ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("commit", "-q", "--allow-empty", "-m", "init");
  writeFileSync(path.join(c.home, ".config", "proyectos", "registry.json"), JSON.stringify({ projects: [{ name: "demo", path: c.proyecto }] }));
  // `claude` en el PATH: el falso headless.
  const shim = path.join(raiz, "shim", "claude");
  writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${FALSO}" "$@"\n`);
  chmodSync(shim, 0o755);
  return c;
}

function entorno(c: Contexto, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!PREFIJOS_LIMPIOS.some((p) => k.startsWith(p))) base[k] = v;
  return {
    ...base,
    HOME: c.home,
    XDG_CONFIG_HOME: path.join(c.home, ".config"),
    TZ: "UTC",
    // la locale de la máquina cambia el orden de `sort` y si `wc -m`/`cut -c` cuentan bytes o caracteres: fija una UTF-8
    // neutra (orden por código, caracteres) como la TZ; el `cut` de latido.sh pide bytes por su cuenta
    LC_ALL: "C.UTF-8",
    PA_STATE: c.estado,
    STATE: c.estado,
    PA_PROJ: path.join(c.home, "claude-proyectos"),
    PROYECTOS_REGISTRY: path.join(c.home, ".config", "proyectos", "registry.json"),
    TRAMA_MODELOS: path.join(c.home, "no-hay.json"),
    TRAMA_CLAVES: path.join(c.home, "no-hay.env"),
    REPARTO_STATE: path.join(c.raiz, "rep"),
    REPARTO_CLAUDE: "0",
    PA_REPARTO: "0",
    PA_CLAUDE_SETTINGS: path.join(c.home, "no-hay-settings.json"),
    TRAMA_FALSO_LOG: path.join(c.raiz, "claude-argv.jsonl"),
    PATH: `${path.join(c.raiz, "shim")}${path.delimiter}${MOTOR}/bin${path.delimiter}${process.env.PATH}`,
    ...extra,
  };
}

function recolectarEstado(dir: string, ignorar: RegExp[], r: Raices): Record<string, string> {
  const salida: Record<string, string> = {};
  const caminar = (d: string, rel: string) => {
    for (const nombre of readdirSync(d).sort()) {
      const abs = path.join(d, nombre);
      const rr = rel ? `${rel}/${nombre}` : nombre;
      if (ignorar.some((re) => re.test(rr))) continue;
      const st = statSync(abs);
      if (st.isDirectory()) caminar(abs, rr);
      else if (/\.pid$/.test(nombre)) salida[normalizar(rr, r)] = "<PID>";
      else if (st.size <= 256 * 1024) salida[normalizar(rr, r)] = normalizar(readFileSync(abs, "utf8"), r);
    }
  };
  if (existsSync(dir)) caminar(dir, "");
  return salida;
}

const IGNORAR_ESTADO = [/^lock(\/|$)/, /^worktrees(\/|$)/, /\.log$/, /\.lock$/];

/** Corre el caso completo con el `pa` dado (comando + argumentos previos) y devuelve lo observable, ya normalizado. */
export function correr(caso: Caso, pa: string[]): Resultado {
  const c = crearSandbox();
  const r: Raices = { tmp: [c.raiz] };
  caso.preparar?.(c);
  const pasos = caso.pasos ?? [{ args: caso.args ?? [], env: caso.env, stdin: caso.stdin, rc: caso.rc }];
  const res: Resultado = { pasos: [], argvClaude: [], estado: {} };
  for (const p of pasos) {
    const args = typeof p.args === "function" ? p.args(c) : p.args;
    const dinamico = (e: Paso["env"]) => (typeof e === "function" ? e(c) : e);
    const s = spawnSync(pa[0]!, [...pa.slice(1), ...args], { encoding: "utf8", timeout: 120_000, input: (typeof p.stdin === "function" ? p.stdin(c) : p.stdin) ?? "", env: entorno(c, { ...dinamico(caso.env), ...dinamico(p.env) }) });
    res.pasos.push({ rc: s.status, stdout: normalizar(s.stdout ?? "", r), stderr: normalizar(s.stderr ?? "", r) });
    if (p.pausaMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, p.pausaMs);
  }
  const log = path.join(c.raiz, "claude-argv.jsonl");
  if (existsSync(log)) {
    for (const l of readFileSync(log, "utf8").split("\n").filter(Boolean)) {
      const j = JSON.parse(l) as { args: string[]; cwd?: string };
      res.argvClaude.push(normalizarArgv(j.args, r));
    }
  }
  res.estado = recolectarEstado(c.estado, [...IGNORAR_ESTADO, ...(caso.estadoIgnorar ?? [])], r);
  return res;
}

/** Las diferencias entre dos resultados, en texto legible; "" si son iguales. */
export function diferencias(a: Resultado, b: Resultado): string {
  const out: string[] = [];
  const n = Math.max(a.pasos.length, b.pasos.length);
  for (let i = 0; i < n; i++) {
    const x = a.pasos[i];
    const y = b.pasos[i];
    if (!x || !y) { out.push(`paso ${i + 1}: falta en uno de los dos`); continue; }
    if (x.rc !== y.rc) out.push(`paso ${i + 1}: código de salida ${x.rc} vs ${y.rc}`);
    if (x.stdout !== y.stdout) out.push(`paso ${i + 1}: stdout\n--- A\n${x.stdout}\n--- B\n${y.stdout}`);
    if (x.stderr !== y.stderr) out.push(`paso ${i + 1}: stderr\n--- A\n${x.stderr}\n--- B\n${y.stderr}`);
  }
  if (JSON.stringify(a.argvClaude) !== JSON.stringify(b.argvClaude)) out.push(`argv de claude\n--- A\n${a.argvClaude.join("\n==\n")}\n--- B\n${b.argvClaude.join("\n==\n")}`);
  const ks = new Set([...Object.keys(a.estado), ...Object.keys(b.estado)]);
  for (const k of [...ks].sort()) {
    if (a.estado[k] === undefined) out.push(`estado: ${k} sólo en B`);
    else if (b.estado[k] === undefined) out.push(`estado: ${k} sólo en A`);
    else if (a.estado[k] !== b.estado[k]) out.push(`estado: ${k} difiere\n--- A\n${a.estado[k]}\n--- B\n${b.estado[k]}`);
  }
  return out.join("\n");
}
