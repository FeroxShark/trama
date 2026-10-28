// reparto — qué modelo conviene para un tipo de tarea según la calidad que pide y el cupo que sobra. Port a TypeScript de
// motor/bin/reparto (python): misma CLI, misma salida, mismos archivos de estado (la ayuda entera es AYUDA, al final). Las
// funciones llevan el nombre del original en camelCase y siguen su orden; los comentarios de criterio están en el python.
//
// Diferencias con el python, a propósito:
// - Los locks (agotado.json, enfriado.json, asignaciones.json) son los de base/lock.ts (socket/named pipe) en vez de flock
//   sobre `<archivo>.lock`; el archivo de datos y su reemplazo atómico son los mismos.
// - bin/cuentas no se importa: `listaCuentas` repite su `cargar()` (cuentas.json) y `entornoCuenta` su `entorno()`.
// - Un float entero que el dueño escribe en modelos.json con "calidad_unidades": "aa" (p. ej. 50.0) sale como 50 en el JSON.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { enPath, esEjecutable } from "./base/buscar.ts";
import { tomar } from "./base/lock.ts";
import { esPrincipal } from "./base/principal.ts";
import { lanzarSuelto } from "./base/proc.ts";
import { carpetaMotor } from "./pa/entorno.ts";
import {
  conFloat,
  copiarMarcas,
  diasEntre,
  esFloat,
  esNum,
  fechaDe,
  fechaLocal,
  fmtF,
  fmtG,
  fnmatchcase,
  isoPy as iso,
  jsonPy,
  leerJson,
  lineasTexto,
  marcarSi,
  maxPor,
  minPor,
  ordenarPor,
  pared,
  parseIsoPy as parseIso,
  pyFloat,
  pyInt,
  pyRound,
  pyStr,
  splitlines,
  sumarDias,
  verdad,
} from "./reparto-py.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;
const E = process.env;

const VERSION = 1;

// --- unidades de la inteligencia ----------------------------------------------------------------------
const AA_REF_VIEJA: [number, number][] = [[60.0, 43.0], [88.0, 51.0], [100.0, 58.0]];

/** Un decimal; entero si es redondo (43.0 -> 43). */
const _n = (x: number) => pyRound(x, 1);

/** Una cifra de inteligencia para mostrar: un decimal sin ceros de sobra (43.0 -> 43, 47.9 -> 47.9). */
export const fn = (x: unknown) => (typeof x === "number" ? fmtF(x, 1).replace(/0+$/, "").replace(/\.$/, "") : pyStr(x));

/** Una inteligencia de la escala vieja 0-100 -> unidades de AA. */
export function viejaAAa(q: number): number {
  const pts = AA_REF_VIEJA;
  const i = q <= pts[1]![0] ? 0 : 1;
  const [x0, y0] = pts[i]!;
  const [x1, y1] = pts[i + 1]!;
  return _n(Math.max(0.0, y0 + ((y1 - y0) * (q - x0)) / (x1 - x0)));
}

// --- defaults ----------------------------------------------------------------------------------------
const CALIDAD: Obj = {
  opus: 100, sonnet: 88, argon: 85, haiku: 60, "gpt-oss": 45, flash: 60,
  astra: 85, sol: 88, luna: 60,
  "dsh:opencode/big-pickle": 60, "dsh:opencode/deepseek-v4.1-flash-free": 60, "dsh:opencode/glm-5.3-flash-free": 55,
  "dsh:opencode/longcat-2.5-preview-free": 45, "dsh:opencode/flint-40b-free": 40,
  "dsh:ollama/*": 35, "dsh:deepseek/*pro*": 85, "dsh:deepseek/*": 70,
  "opencode:opencode/big-pickle": 60, "opencode:opencode/deepseek-v4.1-flash-free": 60, "opencode:opencode/glm-5.3-flash-free": 55,
  "opencode:opencode/nemotron-3-ultra-free": 55, "opencode:opencode/minimax-m3.1-flash-free": 50, "opencode:opencode/mimo-v2.6-flash-free": 50,
  "opencode:opencode/nemotron-3.5-super-vl-free": 50, "opencode:opencode/flint-40b-free": 40, "opencode:opencode/beam-free": 40,
  "opencode:opencode/nemotron-3.5-lightning-free": 40,
};
const MINIMO_POR_TIPO: Obj = {
  debug: "argon", diseno: "argon",
  "codigo-multi": "sonnet", frontend: "sonnet",
  final: "argon",
  "codigo-acotado": "haiku",
  lectura: "haiku", mecanico: "haiku",
};
const PREFERIDO_POR_TIPO: Obj = { frontend: "sonnet", "codigo-multi": "sonnet", "codigo-acotado": "haiku" };
const SOLO_EN: Obj = {};
const USO_POR_MODELO: Obj = { "gemini-3.8-flash": "poco_importante", "gemini-4-argon": "solo_final" };
const USOS = ["libre", "poco_importante", "solo_final"];
const TIPOS_POCO_IMPORTANTES = ["lectura", "mecanico"];
const TIPOS_FINALES = ["final"];
const EFFORT_POR_TIPO: Obj = {
  debug: "high", diseno: "high", "codigo-multi": "high", frontend: "high", final: "high",
  "codigo-acotado": "medium", lectura: "medium", mecanico: "high",
};
const COSTO: Obj = { opus: 1.0, argon: 0.6, sonnet: 0.35, "gpt-oss": 0.15, haiku: 0.12, flash: 0.2, astra: 1.0, sol: 0.6, luna: 0.08 };
const COSTO_FLOAT = ["opus", "astra"]; // los 1.0 de COSTO (en JS no se distinguen de un 1)
const RESERVA = null;
const AVISO_USO = 0.85;
const SIN_CUPO = ["otro", "esperar", "fallar"];
const FAMILIAS_EXCLUIBLES = ["fable", "opus", "sonnet", "haiku", "argon", "flash", "gpt-oss", "astra", "sol", "luna"];
const LLENA = 0.03;
const MARGEN = 3.0;
const PESO_SOBRA = 0.5;
const PTS_POR_AA = 3.0;
const PESO_URGENCIA = 20.0;
const PESO_COSTO = 15.0;
const PESO_CARGA = 12.0;
type Perfil = { ritmo: number; sesgo: number; costo: number; reserva_lider: number; relaja: boolean };
const PERFILES: Record<string, Perfil> = {
  equilibrado: { ritmo: 1.0, sesgo: 0.0, costo: 1.0, reserva_lider: 0.0, relaja: false },
  ahorro: { ritmo: 2.5, sesgo: 25.0, costo: 1.0, reserva_lider: 0.35, relaja: true },
  rendimiento: { ritmo: 0.25, sesgo: 0.0, costo: 0.5, reserva_lider: 0.0, relaja: false },
};
const PERFIL_DEFECTO = "equilibrado";
const RELAJA_AHORRO: Obj = { "codigo-acotado": "haiku", lectura: 50, mecanico: 50 };
const PESO_RITMO = 18.0;
const PESO_BONO_RITMO = 10.0;
const TOPE_EXCESO = 1.5;
const RITMO_MIN_ESPERADO = 0.1;
const RATIO_GASTAR_HOY = 0.2;
const RATIO_AHORRAR_HOY = 2.5;
const PLAN_MAX_DIAS = 21;
const ASIGNACION_S = 20.0;
const HORIZONTE_H = 72.0;
const AGY_MIN_LIBRE_5H = 0.3;
const AGY_MIN_LIBRE_TIPOS = ["codigo-*", "frontend", "debug", "diseno"];
const CACHE_S = 120.0;
const CACHE_CORTA_S = 30.0;
const GRUPOS_HASTA: Obj = { "claude-gpt": "2026-11-02" };

type Grupo = [string, string, string[], string[]];
const GRUPOS_GOOGLE: Grupo[] = [
  ["gemini", "Gemini", ["5h", "7d"], ["gemini-3.8-flash"]],
  ["claude-gpt", "Claude y GPT por Google", ["5h", "7d"], ["agy:claude-opus-5-5", "agy:claude-sonnet-5-5", "agy:gpt-oss-120b"]],
  ["gemini-4-argon", "Gemini 4 Argon", ["7d"], ["gemini-4-argon"]],
];
const EFFORTS_AGY = ["low", "medium", "high"];
const GRUPOS_OPENAI: Grupo[] = [["codex", "Codex (ChatGPT)", ["5h", "7d"], ["codex:gpt-6.1-sol", "codex:gpt-6-luna", "codex:gpt-6-astra"]]];
const EFFORTS_CODEX = ["low", "medium", "high"];
const DSH_OPENCODE_GRATIS = ["big-pickle", "deepseek-v4.1-flash-free", "glm-5.3-flash-free", "flint-40b-free", "longcat-2.5-preview-free"];
const DSH_DEEPSEEK = ["deepseek-v4-flash"];
const DSH_GRUPOS: Obj = { ollama: "dsh-ollama", opencode: "dsh-opencode", deepseek: "dsh-deepseek", "opencode-prog": "opencode-free", "opencode-go": "opencode-go" };
const PLANES_OPENCODE = ["gratis", "go", "go-plus"];
const COSTO_GO = 0.02;
const ENFRIAR_H = 5;
const VENCE_GO_H = 5;
const OC_GO_PREFIJO = "opencode:opencode-go/";
const OC_GRATIS_CONOCIDOS = ["big-pickle", "beam-free", "deepseek-v4.1-flash-free", "flint-40b-free", "glm-5.3-flash-free", "mimo-v2.6-flash-free",
  "minimax-m3.1-flash-free", "nemotron-3-ultra-free", "nemotron-3.5-lightning-free", "nemotron-3.5-super-vl-free"];
const COSTO_DSH_PAGO = 1.5;

type Familia = [string, string, string, string, string | null, string | null, string[] | null];
const FAMILIAS: Familia[] = [
  ["claude-opus-5-5", "opus", "Claude Opus 5.5", "claude", null, null, null],
  ["claude-sonnet-5-5", "sonnet", "Claude Sonnet 5.5", "claude", null, null, null],
  ["claude-haiku-5-5", "haiku", "Claude Haiku 5.5", "claude", null, null, null],
  ["agy:claude-opus-5-5", "opus", "Claude Opus 5.5 (por Google)", "google", "claude-gpt", "claude-opus-5-5", EFFORTS_AGY],
  ["agy:claude-sonnet-5-5", "sonnet", "Claude Sonnet 5.5 (por Google)", "google", "claude-gpt", "claude-sonnet-5-5", EFFORTS_AGY],
  ["agy:gpt-oss-120b", "gpt-oss", "GPT-OSS 120B", "google", "claude-gpt", "gpt-oss-120b", ["medium"]],
  ["gemini-4-argon", "argon", "Gemini 4 Argon", "google", "gemini-4-argon", "gemini-4-argon", EFFORTS_AGY],
  ["gemini-3.8-flash", "flash", "Gemini 3.8 Flash", "google", "gemini", "gemini-3.8-flash", EFFORTS_AGY],
  ["codex:gpt-6.1-sol", "sol", "GPT-6.1 Sol (Codex)", "openai", "codex", "gpt-6.1-sol", EFFORTS_CODEX],
  ["codex:gpt-6-astra", "astra", "GPT-6 Astra (Codex)", "openai", "codex", "gpt-6-astra", EFFORTS_CODEX],
  ["codex:gpt-6-luna", "luna", "GPT-6 Luna (Codex)", "openai", "codex", "gpt-6-luna", EFFORTS_CODEX],
];

// --- utilidades de Python ----------------------------------------------------------------------------
const esDict = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const get = (o: unknown, k: string, d: unknown = null): any => (esDict(o) && k in o ? o[k] : d);
const home = () => os.homedir();
const expandir = (p: string) => (p === "~" ? home() : p.startsWith("~/") ? path.join(home(), p.slice(2)) : p);
const esArchivo = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};
const mtime = (p: string) => statSync(p).mtimeMs / 1000;
const ahoraS = () => Date.now() / 1000;
const pct = (f: number) => `${pyRound(f * 100)} %`;
/** `os.path.realpath` (no estricto: lo que no existe queda como está). */
function realpath(p: string): string {
  let a = path.resolve(p);
  const resto: string[] = [];
  for (;;) {
    try {
      return path.join(realpathSync(a), ...resto);
    } catch {
      const d = path.dirname(a);
      if (d === a) return path.join(a, ...resto);
      resto.unshift(path.basename(a));
      a = d;
    }
  }
}
/** Escribe JSON como `json.dump` (a un .pid temporal y rename). */
function grabarJson(f: string, v: unknown, ascii = true) {
  const tmp = `${f}.${process.pid}`;
  writeFileSync(tmp, jsonPy(v, { ascii }));
  renameSync(tmp, f);
}
/** `str(e)` de una excepción de Python (las de archivo, con su forma). */
function textoError(e: unknown): string {
  const x = e as NodeJS.ErrnoException;
  if (x?.code === "ENOENT" && x.path) return `[Errno 2] No such file or directory: '${x.path}'`;
  if (x?.code === "EACCES" && x.path) return `[Errno 13] Permission denied: '${x.path}'`;
  if (x?.code === "EISDIR" && x.path) return `[Errno 21] Is a directory: '${x.path}'`;
  return x?.message ?? String(e);
}
/** `repr(str)` de Python (para los mensajes con %r). */
const reprTexto = (s: string) => (s.includes("'") && !s.includes('"') ? `"${s.replace(/\\/g, "\\\\")}"` : `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`);
/** `sum()` de floats de Python 3.12+ (suma compensada de Neumaier). */
function sumaPy(xs: number[]): number {
  let f = 0.0;
  let c = 0.0;
  for (const x of xs) {
    const t = f + x;
    if (Math.abs(f) >= Math.abs(x)) c += f - t + x;
    else c += x - t + f;
    f = t;
  }
  if (c && Number.isFinite(c)) f += c;
  return f;
}
/** `os.kill(pid, 0)` sin excepción. */
function existePid(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
/** `subprocess.run(..., capture_output=True, text=True, timeout=s)`: la salida, o null si no se pudo o venció. */
function correrSync(cmd: string, args: string[], o: { timeoutS: number; cwd?: string; env?: NodeJS.ProcessEnv }): string | null {
  let ejecutable = cmd;
  let argv = args;
  let extra = {};
  if (process.platform === "win32") {
    const r = enPath(cmd) ?? cmd;
    if (/\.(cmd|bat)$/i.test(r)) {
      ejecutable = E.ComSpec || "cmd.exe";
      argv = ["/d", "/s", "/c", `"${[r, ...args].map((x) => `"${x}"`).join(" ")}"`];
      extra = { windowsVerbatimArguments: true };
    } else ejecutable = r;
  }
  const r = spawnSync(ejecutable, argv, { encoding: "utf8", timeout: o.timeoutS * 1000, cwd: o.cwd, env: o.env ?? E, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...extra });
  if (r.error) return null;
  return r.stdout ?? "";
}

function err(m: string) {
  process.stderr.write(`reparto: ${m}\n`);
}

/** Lock exclusivo mientras se lee-modifica-reemplaza `f` (el python usa flock sobre `<f>.lock`). Sin poder bloquear, sigue sin lock. */
async function bloqueo<T>(f: string, cuerpo: () => T): Promise<T> {
  let lock: Awaited<ReturnType<typeof tomar>> = null;
  try {
    lock = await tomar(f, { esperarMs: 30_000 });
  } catch {
    lock = null;
  }
  try {
    return cuerpo();
  } finally {
    await lock?.liberar();
  }
}

// --- cuentas (bin/cuentas) ---------------------------------------------------------------------------
const PROVEEDORES_CUENTAS: Record<string, [string, string]> = {
  claude: ["Claude", "claude"],
  google: ["Google AI Pro", "agy"],
  chatgpt: ["ChatGPT", "codex"],
  opencode: ["OpenCode", "opencode"],
};
const ID_OK = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DBUS_ROTO = "unix:path=/nonexistent/trama-sin-llavero";
const homeReal = () => E.TRAMA_CUENTAS_HOME || home();
const rutaCuentas = () => E.TRAMA_CUENTAS || path.join(homeReal(), ".config", "trama", "cuentas.json");
const errCuentas = (m: string) => process.stderr.write(`cuentas: ${m}\n`);

function leerCuentasArchivo(): Obj[] {
  let d: unknown;
  try {
    d = leerJson(readFileSync(rutaCuentas(), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    errCuentas(`${rutaCuentas()} inválido (${textoError(e)}): uso sólo las cuentas de siempre`);
    return [];
  }
  const out: Obj[] = [];
  const lista = (esDict(d) ? d.cuentas : null) || [];
  for (const c of Array.isArray(lista) ? lista : []) {
    if (!esDict(c) || !(c.proveedor in PROVEEDORES_CUENTAS) || !ID_OK.test(pyStr(get(c, "id", "")))) {
      errCuentas(`entrada inválida en ${rutaCuentas()}: ${jsonPy(c)} (la salteo)`);
      continue;
    }
    out.push(c);
  }
  return out;
}

function opencodeBinCuentas(): string | null {
  const c = enPath("opencode");
  if (c) return c;
  const f = path.join(homeReal(), ".opencode", "bin", "opencode");
  return esEjecutable(f) ? f : null;
}

/** Las cuentas de bin/cuentas (`cargar()`): la de siempre de claude y google (y chatgpt / opencode si hay), más las agregadas. */
function listaCuentas(): Obj[] {
  if (E.REPARTO_CUENTAS_BIN && !existsSync(E.REPARTO_CUENTAS_BIN)) {
    return [
      { id: "claude", proveedor: "claude", motor: "claude", nombre: "Claude", dir: null, defecto: true },
      { id: "google", proveedor: "google", motor: "agy", nombre: "Google AI Pro", dir: null, defecto: true },
    ];
  }
  const ent = leerCuentasArchivo();
  const porId = new Map<string, Obj>();
  for (const c of ent) if (!porId.has(c.id)) porId.set(c.id, c);
  const out: Obj[] = [];
  const provs = ["claude", "google"];
  if (ent.some((c) => c.proveedor === "chatgpt")) provs.push("chatgpt");
  if (opencodeBinCuentas() || ent.some((c) => c.proveedor === "opencode")) provs.push("opencode");
  for (const p of provs) {
    const r = porId.get(p);
    out.push({ id: p, proveedor: p, motor: PROVEEDORES_CUENTAS[p]![1], nombre: get(r, "nombre") || PROVEEDORES_CUENTAS[p]![0], dir: null, defecto: true });
  }
  for (const c of ent) {
    if (c.id in PROVEEDORES_CUENTAS || c !== porId.get(c.id)) continue;
    const d = expandir(c.dir || path.join(path.dirname(path.resolve(rutaCuentas())), "cuentas", c.id));
    const cu: Obj = { id: c.id, proveedor: c.proveedor, motor: PROVEEDORES_CUENTAS[c.proveedor]![1], nombre: c.nombre || c.id, dir: path.resolve(d), defecto: false };
    if (c.proveedor === "opencode") cu.plan = PLANES_OPENCODE.includes(c.plan) ? c.plan : "gratis";
    out.push(cu);
  }
  return out;
}

/** El entorno para correr algo con esa cuenta (`env_de` de bin/cuentas); undefined = el de siempre. */
function envCuenta(c: Obj | null | undefined): NodeJS.ProcessEnv | undefined {
  if (!c || c.defecto) return undefined;
  const e: NodeJS.ProcessEnv = { ...E };
  if (c.proveedor === "claude") {
    for (const v of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"]) delete e[v];
    e.CLAUDE_CONFIG_DIR = c.dir;
  } else if (c.proveedor === "google") {
    e.HOME = c.dir;
    e.DBUS_SESSION_BUS_ADDRESS = DBUS_ROTO;
  } else if (c.proveedor === "opencode") {
    e.XDG_DATA_HOME = path.join(c.dir, "data");
    e.XDG_STATE_HOME = path.join(c.dir, "state");
    e.TRAMA_OPENCODE_CUENTA = c.id;
    e.TRAMA_OPENCODE_PLAN = c.plan || "gratis";
  } else {
    delete e.OPENAI_API_KEY;
    e.CODEX_HOME = c.dir;
  }
  return e;
}

const PROVEEDORES = ["claude", "google", "chatgpt"];
/** Proveedor de una suscripción de --cupos. */
const provDe = (s: Obj) => get(s, "proveedor") || get(s, "id");
const cuentaDe = (s: Obj) => get(s, "cuenta") || get(s, "id") || provDe(s);
/** Sufijo de las claves de grupo: nada para la cuenta de siempre. */
const suf = (cuenta: unknown) => (!cuenta || PROVEEDORES.includes(cuenta as string) || cuenta === "openai" || cuenta === "opencode" ? "" : "@" + cuenta);

// --- configuración -----------------------------------------------------------------------------------
function rutaModelos(): string {
  const xdg = E.XDG_CONFIG_HOME || path.join(home(), ".config");
  return E.TRAMA_MODELOS || path.join(xdg, "trama", "modelos.json");
}

const TOPES_USO_PROVEEDORES = ["google", "openai"];

/** Una entrada de `topes_uso`: `google`, `openai` o `google:<grupo>` → entero de 1 a 100 (`float` = el número era float en el JSON). */
function topeUsoValido(k: unknown, v: unknown, float: boolean): boolean {
  if (typeof k !== "string" || typeof v !== "number" || !Number.isInteger(v) || float || !(v >= 1 && v <= 100)) return false;
  const kk = k.trim().toLowerCase();
  return TOPES_USO_PROVEEDORES.includes(kk) || (kk.startsWith("google:") && kk.length > 7);
}

function invalido(j: Obj): string | null {
  const num = (v: unknown) => typeof v === "number" && v >= 0 && v < 1;
  const dump = (k: string) => jsonPy(j[k], { ascii: true, float: esFloat(j, k) });
  const r = get(j, "reserva");
  if (r !== null && !num(r) && !(esDict(r) && Object.keys(r).length && Object.keys(r).every((k) => k === "5h" || k === "7d") && Object.values(r).every(num)))
    return `reserva ${dump("reserva")} (un número de 0 a 1, {"5h":…,"7d":…} o null)`;
  if (get(j, "perfil") !== null && !(j.perfil in PERFILES)) return `perfil ${dump("perfil")} (equilibrado, ahorro o rendimiento)`;
  const rl = get(j, "reserva_lider");
  if (rl !== null && !num(rl)) return `reserva_lider ${dump("reserva_lider")} (un número de 0 a 1 o null)`;
  const tu = get(j, "topes_uso");
  if (tu !== null && !(esDict(tu) && Object.entries(tu).every(([k, v]) => topeUsoValido(k, v, esFloat(tu, k)))))
    return `topes_uso ${dump("topes_uso")} (un objeto google, openai o google:<grupo> → % usado de 1 a 100)`;
  const e = get(j, "excluir");
  if (e !== null && !(Array.isArray(e) && e.every((x) => typeof x === "string" && x.trim()))) return `excluir ${dump("excluir")} (una lista de ids o familias)`;
  const ep = get(j, "efforts_permitidos");
  if (ep !== null && !(esDict(ep) && Object.entries(ep).every(([k, v]) => k.trim() && Array.isArray(v) && v.every((x) => EFFORTS_AA.includes(x)))))
    return `efforts_permitidos ${dump("efforts_permitidos")} (un objeto familia o id → lista de low, medium, high, xhigh, max)`;
  if ("permitir_max" in j && typeof j.permitir_max !== "boolean") return `permitir_max ${dump("permitir_max")} (true o false)`;
  const u = get(j, "uso_por_modelo");
  if (u !== null && !(esDict(u) && Object.entries(u).every(([k, v]) => k.trim() && USOS.includes(v as string)))) return `uso_por_modelo ${dump("uso_por_modelo")} (un objeto modelo → libre, poco_importante o solo_final)`;
  for (const k of ["tipos_poco_importantes", "tipos_finales"]) {
    const t = get(j, k);
    if (t !== null && !(Array.isArray(t) && t.every((x) => typeof x === "string" && x.trim()))) return `${k} ${dump(k)} (una lista de tipos)`;
  }
  if (get(j, "sin_cupo") !== null && !SIN_CUPO.includes(j.sin_cupo)) return `sin_cupo ${dump("sin_cupo")} (otro, esperar o fallar)`;
  return null;
}

/** Defaults mezclados con las claves de modelos.json. Inválido: una línea y defaults. */
function cargarConfigBase(): Obj {
  const calidad: Obj = {};
  for (const [k, v] of Object.entries(CALIDAD)) calidad[k] = viejaAAa(v);
  const cfg: Obj = {
    calidad_usuario: new Set<string>(),
    calidad, minimo_por_tipo: { ...MINIMO_POR_TIPO }, solo_en: { ...SOLO_EN },
    effort_por_tipo: { ...EFFORT_POR_TIPO }, costo: conFloat({ ...COSTO }, ...COSTO_FLOAT), reserva: RESERVA,
    reparto: "auto", grupos_hasta: { ...GRUPOS_HASTA }, hasta_pisado: {}, workers: {}, locales: [],
    llena: LLENA, peso_urgencia: PESO_URGENCIA, peso_costo: PESO_COSTO, peso_carga: PESO_CARGA,
    preferido_por_tipo: { ...PREFERIDO_POR_TIPO },
    agy_min_libre_5h: AGY_MIN_LIBRE_5H, agy_min_libre_tipos: [...AGY_MIN_LIBRE_TIPOS],
    excluir: [], permitir_max: false, efforts_permitidos: {},
    uso_por_modelo: Object.entries(USO_POR_MODELO), tipos_poco_importantes: [...TIPOS_POCO_IMPORTANTES],
    tipos_finales: [...TIPOS_FINALES], sin_cupo: "otro", sin_cupo_de: "default",
    perfil: PERFIL_DEFECTO, reserva_lider: null, peso_ritmo: PESO_RITMO, peso_bono_ritmo: PESO_BONO_RITMO,
    opencode_plan: "gratis", topes_uso: {},
  };
  conFloat(cfg, "reserva_lider");
  const p = rutaModelos();
  if (!esArchivo(p)) return cfg;
  let j: Obj;
  try {
    j = leerJson(readFileSync(p, "utf8"));
    if (!esDict(j)) throw new Error("no es un objeto");
  } catch (e) {
    err(`${p} no se pudo leer (${textoError(e)}): uso los defaults`);
    return cfg;
  }
  const malo = invalido(j);
  if (malo) {
    err(`${p} no va (${malo}): uso los defaults`);
    return cfg;
  }
  for (const k of ["calidad", "minimo_por_tipo", "solo_en", "effort_por_tipo", "costo", "preferido_por_tipo"]) {
    if (esDict(j[k])) {
      for (const [kk, v] of Object.entries(j[k] as Obj)) {
        cfg[k][kk] = v;
        marcarSi(cfg[k], kk, esFloat(j[k], kk));
      }
    }
  }
  const nuevo = get(j, "calidad_unidades") === "aa";
  const cv = (v: unknown) => (nuevo ? v : esNum(v) ? viejaAAa(v) : v);
  if (esDict(j.calidad)) for (const [k, v] of Object.entries(j.calidad as Obj)) cfg.calidad[k] = cv(v);
  if (esDict(j.minimo_por_tipo)) for (const [k, v] of Object.entries(j.minimo_por_tipo as Obj)) cfg.minimo_por_tipo[k] = cv(v);
  if (esDict(j.calidad)) cfg.calidad_usuario = new Set(Object.keys(j.calidad));
  if (esDict(j.calidad_effort)) {
    const ce: Obj = {};
    for (const [k, d] of Object.entries(j.calidad_effort as Obj)) {
      if (!esDict(d)) continue;
      ce[k] = {};
      for (const [e, v] of Object.entries(d)) if (EFFORTS_AA.includes(e) && esNum(v)) ce[k][e] = cv(v);
    }
    cfg.calidad_effort_usuario = ce;
  }
  if (esNum(j.reserva) || esDict(j.reserva)) cfg.reserva = j.reserva;
  if (j.perfil in PERFILES && typeof j.perfil === "string") cfg.perfil = j.perfil;
  if (PLANES_OPENCODE.includes(j.opencode_plan)) cfg.opencode_plan = j.opencode_plan;
  if (esNum(j.reserva_lider)) {
    cfg.reserva_lider = j.reserva_lider;
    marcarSi(cfg, "reserva_lider", esFloat(j, "reserva_lider"));
  }
  if (esDict(j.topes_uso)) {
    cfg.topes_uso = {};
    for (const [k, v] of Object.entries(j.topes_uso as Obj)) if (topeUsoValido(k, v, esFloat(j.topes_uso, k))) cfg.topes_uso[k.trim().toLowerCase()] = v;
  }
  if (Array.isArray(j.excluir)) cfg.excluir = (j.excluir as string[]).filter((x) => x.trim()).map((x) => x.trim().toLowerCase());
  if (typeof j.permitir_max === "boolean") cfg.permitir_max = j.permitir_max;
  if (esDict(j.efforts_permitidos)) {
    cfg.efforts_permitidos = {};
    for (const [k, v] of Object.entries(j.efforts_permitidos as Obj)) cfg.efforts_permitidos[k.trim().toLowerCase()] = (v as string[]).filter((e) => EFFORTS_AA.includes(e));
  }
  if (esDict(j.uso_por_modelo)) cfg.uso_por_modelo = [...Object.entries(j.uso_por_modelo as Obj).map(([k, v]) => [k.trim().toLowerCase(), v]), ...cfg.uso_por_modelo];
  for (const k of ["tipos_poco_importantes", "tipos_finales"]) if (Array.isArray(j[k])) cfg[k] = (j[k] as string[]).map((x) => x.trim().toLowerCase());
  if (SIN_CUPO.includes(j.sin_cupo)) [cfg.sin_cupo, cfg.sin_cupo_de] = [j.sin_cupo, "sin_cupo"];
  else if (esDict(j.gemini) && ["claude", "esperar", "fallar"].includes(j.gemini.sin_claude)) {
    const v = j.gemini.sin_claude;
    [cfg.sin_cupo, cfg.sin_cupo_de] = [v === "claude" ? "otro" : v, "gemini.sin_claude"];
  }
  if (j.reparto === "auto" || j.reparto === "fijo") cfg.reparto = j.reparto;
  if (esDict(j.grupos_hasta)) {
    for (const [gid, h] of Object.entries(j.grupos_hasta as Obj)) if (h === null || typeof h === "string") cfg.grupos_hasta[gid] = cfg.hasta_pisado[gid] = h;
  }
  if (esDict(j.grupos)) {
    for (const [gid, g] of Object.entries(j.grupos as Obj)) if (esDict(g) && "hasta" in g) cfg.grupos_hasta[gid] = cfg.hasta_pisado[gid] = g.hasta;
  }
  if (esDict(j.workers)) cfg.workers = j.workers;
  if (Array.isArray(j.locales)) cfg.locales = j.locales.filter((x: unknown) => esDict(x) && verdad(x.id));
  for (const k of ["llena", "peso_urgencia", "peso_costo", "peso_carga", "agy_min_libre_5h", "peso_ritmo", "peso_bono_ritmo"]) if (esNum(j[k])) cfg[k] = j[k];
  if (Array.isArray(j.agy_min_libre_tipos)) cfg.agy_min_libre_tipos = j.agy_min_libre_tipos.map((x: unknown) => pyStr(x));
  return cfg;
}

// --- Artificial Analysis (inteligencia medida) ------------------------------------------------------
const AA_PREFIJOS = /^(?:opencode|dsh|agy|codex|ollama):/;
const AA_NIVELES: Obj = { minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" };
const AA_NIVELES_SUFIJO = new Set(Object.keys(AA_NIVELES).filter((k) => k !== "max"));
const AA_CALIFICADORES = new Set(["reasoning", "thinking", "adaptive", "effort", "non", "nonreasoning", "default", "fallback"]);
const EFFORT_TABLA = "high";
const EFFORTS_AA = ["low", "medium", "high", "xhigh", "max"];
const AA_NIVEL_DEFECTO = "high";
const AA_CON_NIVEL_DEFECTO = /claude|gpt|codex|gemini|(?<![a-z])o\d/;
const AA_PRIORIDAD: Obj = { explicito: 3, defecto: 2, sin_razonar: 1, pelado: 0 };
const esNivel = (t: string) => Object.prototype.hasOwnProperty.call(AA_NIVELES, t);

function aaPelar(toks0: string[]): string[] {
  const toks = [...toks0];
  while (toks.length > 1) {
    const t = toks[toks.length - 1]!;
    if (t === "effort") {
      toks.pop();
      if (toks.length > 1 && esNivel(toks[toks.length - 1]!)) toks.pop();
    } else if (AA_CALIFICADORES.has(t) || AA_NIVELES_SUFIJO.has(t)) toks.pop();
    else break;
  }
  return toks;
}

export function aaTokens(nombre: unknown): string[] {
  let s = pyStr(nombre || "").trim().toLowerCase();
  s = s.replace(/\([^)]*\)/g, " ");
  while (AA_PREFIJOS.test(s)) s = s.replace(AA_PREFIJOS, "");
  s = s.split("/").pop()!;
  s = s.replace(/\bx[- ]high\b/g, "xhigh");
  s = s.replace(/\bextra[- ]high\b/g, "xhigh");
  s = s.replace(/\bno[- ]?(?:thinking|reasoning)\b/g, "nonreasoning");
  let toks = s.split(/[^a-z0-9.]+/).map((t) => t.replace(/^\.+|\.+$/g, ""));
  toks = toks.filter((t) => t && t !== "free" && !/^20\d{6}$/.test(t));
  const out: string[] = [];
  for (const t of toks) {
    if (out.length && /^\d{1,2}$/.test(t) && /^(?:[a-z]{1,8})?\d{1,2}$/.test(out[out.length - 1]!)) out[out.length - 1] = `${out[out.length - 1]}.${t}`;
    else out.push(t);
  }
  return aaPelar(out);
}

const _num = (v: unknown): number | null => (typeof v === "number" && v === v ? v : null);
const aaPuntajeM = (m: Obj): [number, string] | null => {
  const i = _num(m.intelligence);
  return i !== null ? [i, "int"] : null;
};

function _aaTexto(s: unknown): string {
  let t = pyStr(s || "").toLowerCase();
  t = t.replace(/\bx[- ]high\b/g, "xhigh");
  return t.replace(/\bextra[- ]high\b/g, "xhigh");
}

function aaEsfuerzoInfo(m: Obj): [string | null, string] {
  const campos = [_aaTexto(m.name), _aaTexto(m.slug)];
  const sin = campos.some((c) => /non[- ]?(?:reasoning|thinking)|no[- ]?(?:reasoning|thinking)/.test(c));
  let nivel: string | null = null;
  for (const c of campos) {
    for (const par of [...c.matchAll(/\(([^)]*)\)/g)].map((x) => x[1]!)) {
      nivel = par.split(/[^a-z0-9]+/).filter(esNivel).map((t) => AA_NIVELES[t])[0] ?? null;
      if (nivel) break;
    }
    if (nivel) break;
  }
  if (nivel === null) {
    for (const c of campos) {
      const mo = /\b(minimal|low|medium|high|xhigh|max)[ -]+(?:reasoning[ -]+)?effort\b/.exec(c) || /\beffort[ :=-]+(minimal|low|medium|high|xhigh|max)\b/.exec(c);
      if (mo) {
        nivel = AA_NIVELES[mo[1]!];
        break;
      }
    }
  }
  if (nivel === null) {
    for (const c of campos) {
      const toks = c.replace(/\([^)]*\)/g, " ").split(/[^a-z0-9]+/).filter(Boolean);
      let i = toks.length;
      while (i > 1 && (AA_CALIFICADORES.has(toks[i - 1]!) || AA_NIVELES_SUFIJO.has(toks[i - 1]!))) {
        if (nivel === null && AA_NIVELES_SUFIJO.has(toks[i - 1]!)) nivel = AA_NIVELES[toks[i - 1]!];
        i -= 1;
      }
      if (nivel) break;
    }
  }
  if (nivel) return [nivel, sin ? "sin_razonar" : "explicito"];
  if (sin) return [null, "sin_razonar"];
  if (/reasoning|thinking|adaptive/.test(campos.join(" "))) return [AA_NIVEL_DEFECTO, "defecto"];
  return [null, "pelado"];
}

type EntradaAA = Record<string, [number, string, string]>;
type EfAA = Record<string, [number, number, Obj]>;
type IndiceAA = { fecha: string | null; exacto: Map<string, EntradaAA>; conjunto: Map<string, EntradaAA>; ex_ef: Map<string, EfAA>; co_ef: Map<string, EfAA>; suplemento: Obj | null };
const claveConjunto = (tk: string[]) => [...new Set(tk)].sort().join(" ");

function aaIndice(modelos: Obj[]): [Map<string, EntradaAA>, Map<string, EntradaAA>, Map<string, EfAA>, Map<string, EfAA>] {
  const ents: [Obj, [number, string], string[][]][] = [];
  for (const m of modelos) {
    const pm = aaPuntajeM(m);
    if (pm === null) continue;
    ents.push([m, pm, [aaTokens(m.name), aaTokens(m.slug)]]);
  }
  const bases = new Set<string>();
  for (const [, , tks] of ents) for (const tk of tks) if (tk.length) bases.add(tk.join(" "));
  const exacto = new Map<string, EntradaAA>();
  const conjunto = new Map<string, EntradaAA>();
  const exEf = new Map<string, EfAA>();
  const coEf = new Map<string, EfAA>();
  for (const [m, [p, met], tks] of ents) {
    let [nivel, tipo] = aaEsfuerzoInfo(m);
    if (nivel === null && tipo !== "sin_razonar" && tks[0]!.slice(-1)[0] !== "max" && tks[1]!.length > 2 && tks[1]![tks[1]!.length - 1] === "max" && bases.has(aaPelar(tks[1]!.slice(0, -1)).join(" "))) {
      [nivel, tipo] = ["max", "explicito"];
      tks[1] = aaPelar(tks[1]!.slice(0, -1));
    }
    if (nivel === null && tipo === "pelado" && AA_CON_NIVEL_DEFECTO.test((pyStr(m.name || "") + " " + pyStr(m.slug || "")).toLowerCase())) nivel = AA_NIVEL_DEFECTO;
    const prio = AA_PRIORIDAD[tipo] as number;
    const extra: Obj = {};
    for (const k of ["coding", "agentic", "cost", "tokens", "time"]) if (_num(m[k]) !== null) extra[k] = _num(m[k]);
    extra.intel = p;
    if (verdad(m._suplemento)) {
      extra.suplemento = true;
      if (verdad(m.aproximado)) extra.aproximado = true;
    }
    for (const tk of tks) {
      if (!tk.length) continue;
      for (const [d, de, k] of [[exacto, exEf, tk.join(" ")], [conjunto, coEf, claveConjunto(tk)]] as [Map<string, EntradaAA>, Map<string, EfAA>, string][]) {
        let e = d.get(k);
        if (!e) d.set(k, (e = {}));
        if (!(met in e) || p > e[met]![0]) e[met] = [p, m.name || m.slug, m.slug || ""];
        if (nivel && EFFORTS_AA.includes(nivel)) {
          let ef = de.get(k);
          if (!ef) de.set(k, (ef = {}));
          const ant = ef[nivel];
          if (!ant || prio > ant[0] || (prio === ant[0] && p > ant[1])) ef[nivel] = [prio, p, extra];
        }
      }
    }
  }
  return [exacto, conjunto, exEf, coEf];
}

function aaEntrada(aa: IndiceAA | null, mid: string): [EntradaAA | null, ["ex" | "co", string] | null] {
  const tk = aaTokens(mid);
  if (!aa || !tk.length) return [null, null];
  const k1 = tk.join(" ");
  if (aa.exacto.has(k1)) return [aa.exacto.get(k1)!, ["ex", k1]];
  const k2 = claveConjunto(tk);
  if (aa.conjunto.has(k2)) return [aa.conjunto.get(k2)!, ["co", k2]];
  return [null, null];
}

function aaBuscar(aa: IndiceAA | null, mid: string): [number, string, string] | null {
  const [e] = aaEntrada(aa, mid);
  if (!e || !("int" in e)) return null;
  return [e.int![0], e.int![1], "int"];
}

function aaBuscarEfforts(aa: IndiceAA | null, mid: string): Obj {
  const [e, clave] = aaEntrada(aa, mid);
  if (!e || !clave) return {};
  const out: Obj = {};
  for (const [nivel, v] of Object.entries((clave[0] === "ex" ? aa!.ex_ef : aa!.co_ef).get(clave[1]) ?? {})) out[nivel] = v[1];
  return out;
}

function aaBuscarExtras(aa: IndiceAA | null, mid: string): Record<string, Obj> {
  const [e, clave] = aaEntrada(aa, mid);
  if (!e || !clave) return {};
  const out: Record<string, Obj> = {};
  for (const [nivel, v] of Object.entries((clave[0] === "ex" ? aa!.ex_ef : aa!.co_ef).get(clave[1]) ?? {})) out[nivel] = { ...v[2] };
  return out;
}

function aaSuplementoRuta(): string | null {
  const env = E.REPARTO_AA_SUPLEMENTO;
  if (env === "0") return null;
  if (env) return env;
  const aqui = path.join(carpetaMotor(), "bin");
  for (const base of [path.join(aqui, ".."), aqui]) {
    const r = path.normalize(path.join(base, "datos", "aa-suplemento.json"));
    if (esArchivo(r)) return r;
  }
  return null;
}

function aaSuplemento(): [string | null, string | null, Obj[]] {
  const ruta = aaSuplementoRuta();
  if (!ruta) return [null, null, []];
  try {
    const j = leerJson(readFileSync(ruta, "utf8"));
    const ms = (j.modelos as unknown[]).filter((m): m is Obj => esDict(m) && aaPuntajeM(m) !== null).map((m) => ({ ...m, _suplemento: true }));
    return [pyStr(j.fecha || "").slice(0, 10) || null, pyStr(j.fuente || "") || null, ms];
  } catch {
    return [null, null, []];
  }
}

function aaCargar(): IndiceAA | null {
  const ruta = E.REPARTO_AA || path.join(stateDir(), "aa-modelos.json");
  if (ruta === "0") return null;
  let j: Obj;
  let modelos: Obj[];
  try {
    j = leerJson(readFileSync(ruta, "utf8"));
    modelos = (j.modelos as unknown[]).filter(esDict);
  } catch {
    return null;
  }
  const [fechaS, fuenteS, supl] = aaSuplemento();
  if (supl.length) {
    const clave = (m: Obj) => `${(aaTokens(m.name).length ? aaTokens(m.name) : aaTokens(m.slug)).join(" ")}\0${aaEsfuerzoInfo(m)[0]}`;
    const api = new Map<string, Obj>();
    for (const m of modelos) if (aaPuntajeM(m)) if (!api.has(clave(m))) api.set(clave(m), m);
    for (const m of supl) {
      const k = clave(m);
      const a = api.get(k);
      if (a) {
        for (const campo of ["cost", "tokens", "time"]) if (_num(a[campo]) === null && _num(m[campo]) !== null) a[campo] = m[campo];
      } else modelos.push(m);
    }
  }
  const [exacto, conjunto, exEf, coEf] = aaIndice(modelos);
  if (!exacto.size) return null;
  return { fecha: pyStr(j.fetched || "").slice(0, 10) || null, exacto, conjunto, ex_ef: exEf, co_ef: coEf, suplemento: supl.length ? { fecha: fechaS, fuente: fuenteS } : null };
}

function aaCalidad(aa: IndiceAA | null, mid: string): [number, string] | null {
  const r = aaBuscar(aa, mid);
  if (!r) return null;
  return [_n(Math.max(0.0, r[0])), r[1]];
}

type Rel = (m: string, e: string) => number | null;
type MapaEf = Record<string, number>;
const relDe = (m: unknown): Rel | null => (m ? (m as { rel?: Rel }).rel : null) ?? null;
/** Un {esfuerzo: calidad} con `rel` (no enumerable: no sale en el JSON). */
function mapaEf(o: MapaEf, rel: Rel | null): MapaEf {
  Object.defineProperty(o, "rel", { value: rel, enumerable: false, writable: true, configurable: true });
  return o;
}

function aaCalidadEfforts(aa: IndiceAA | null, mid: string): MapaEf {
  if (!aa) return {};
  const out: MapaEf = {};
  for (const [e, p] of Object.entries(aaBuscarEfforts(aa, mid))) if (EFFORTS_AA.includes(e)) out[e] = _n(Math.max(0.0, p));
  let tope: number | null = null;
  for (const e of [...EFFORTS_AA].reverse()) {
    if (e in out) tope = out[e] = tope === null ? out[e]! : Math.min(out[e]!, tope);
  }
  return mapaEf(out, aaPendiente(aa, mid));
}

function _curvaLlena(v: Obj): Obj {
  const out: Obj = { ...v };
  const ids = Object.keys(v).map((e) => EFFORTS_AA.indexOf(e)).sort((a, b) => a - b);
  for (let i = ids[0]!; i <= ids[ids.length - 1]!; i++) {
    const e = EFFORTS_AA[i]!;
    if (!(e in out)) {
      const a = Math.max(...ids.filter((j) => j < i));
      const b = Math.min(...ids.filter((j) => j > i));
      out[e] = v[EFFORTS_AA[a]!] + ((v[EFFORTS_AA[b]!] - v[EFFORTS_AA[a]!]) * (i - a)) / (b - a);
    }
  }
  return out;
}

function aaPendiente(aa: IndiceAA | null, mid: string): Rel | null {
  if (!aa) return null;
  const tk = aaTokens(mid);
  if (!tk.length) return null;
  const propio = tk.join(" ");
  const genDe = (t: string[]) => (t.length > 1 && /^v?\d+(?:\.\d+)?$/.test(t[t.length - 1]!) ? t[t.length - 1]! : null);
  const curvas: [string, string | null, Obj][] = [];
  for (const [k, ef] of aa.ex_ef) {
    if (k === propio || Object.keys(ef).length < 2) continue;
    const t = k.split(" ");
    const v: Obj = {};
    for (const [e, x] of Object.entries(ef)) v[e] = x[1];
    curvas.push([t[0]!, genDe(t), _curvaLlena(v)]);
  }
  return (m: string, e: string) => {
    const filtros = [(c: (typeof curvas)[0]) => c[0] === tk[0] && genDe(tk) !== null && c[1] === genDe(tk), (c: (typeof curvas)[0]) => c[0] === tk[0], () => true];
    for (const filtro of filtros) {
      const rs = curvas.filter((c) => filtro(c) && e in c[2] && m in c[2] && c[2][m] > 0).map((c) => c[2][e] / c[2][m]);
      if (rs.length) return sumaPy(rs) / rs.length;
    }
    return null;
  };
}

function calidadEnEffort(mapa: MapaEf | null | undefined, effort: unknown, base: number): number {
  if (!mapa || !Object.keys(mapa).length || !EFFORTS_AA.includes(effort as string)) return base;
  const ef = effort as string;
  if (ef in mapa) return mapa[ef]!;
  const i = EFFORTS_AA.indexOf(ef);
  const ant: [number, number][] = [];
  const sig: [number, number][] = [];
  for (const [e, v] of Object.entries(mapa)) {
    if (!EFFORTS_AA.includes(e)) continue;
    const j = EFFORTS_AA.indexOf(e);
    if (j < i) ant.push([j, v]);
    if (j > i) sig.push([j, v]);
  }
  const maxT = (xs: [number, number][]) => xs.reduce((a, b) => (b[0] > a[0] || (b[0] === a[0] && b[1] > a[1]) ? b : a));
  const minT = (xs: [number, number][]) => xs.reduce((a, b) => (b[0] < a[0] || (b[0] === a[0] && b[1] < a[1]) ? b : a));
  if (ant.length && sig.length) {
    const [i0, v0] = maxT(ant);
    const [i1, v1] = minT(sig);
    return _n(v0 + ((v1 - v0) * (i - i0)) / (i1 - i0));
  }
  const cerca = ant.length ? maxT(ant) : sig.length ? minT(sig) : null;
  if (cerca === null) return base;
  const rel = relDe(mapa);
  const r = rel ? rel(EFFORTS_AA[cerca[0]]!, ef) : null;
  if (r === null) return cerca[1];
  const v = cerca[1] * r;
  return _n(i > cerca[0] ? Math.max(v, cerca[1]) : Math.min(v, cerca[1]));
}

function cargarConfig(): Obj {
  const cfg = cargarConfigBase();
  const aa = (cfg.aa = aaCargar());
  cfg.origen = {};
  for (const k of Object.keys(cfg.calidad)) cfg.origen[k] = cfg.calidad_usuario.has(k) ? "usuario" : "defecto";
  cfg.calidad_effort_usuario ??= {};
  cfg.calidad_ef = {};
  if (aa) {
    for (const [base, fam] of FAMILIAS) {
      if (cfg.calidad_usuario.has(fam) || cfg.origen[fam] === "artificial-analysis") continue;
      const r = aaCalidad(aa, base);
      if (r) {
        cfg.calidad[fam] = r[0];
        cfg.origen[fam] = "artificial-analysis";
        cfg.calidad_ef[fam] = aaCalidadEfforts(aa, base);
      }
    }
  }
  return cfg;
}

function mapaEfforts(cfg: Obj, clave: string, mid: string | null = null): MapaEf {
  const usr: Obj = cfg.calidad_effort_usuario?.[clave] || {};
  let base: MapaEf;
  if (cfg.calidad_usuario?.has(clave) || (mid && clave === mid && calidadOrigen(cfg, mid)[1] === "usuario")) {
    base = {};
    for (const e of EFFORTS_AA) if (verdad(usr) && esNum(cfg.calidad[clave])) base[e] = cfg.calidad[clave];
  } else if (mid) base = aaCalidadEfforts(cfg.aa, mid);
  else base = cfg.calidad_ef?.[clave] ?? {};
  const out: MapaEf = { ...base, ...usr };
  return mapaEf(out, !verdad(usr) ? relDe(base) : null);
}

function ventanaLlena(cfg: Obj, sus: string, gid: string | null, w: Obj): boolean {
  const tu = cfg.topes_uso;
  let p = sus === "google" ? get(tu, `${sus}:${gid === null ? "None" : gid}`) : null;
  p = p !== null ? p : get(tu, sus);
  if (p !== null) return pyRound(w.usado * 100, 6) >= p;
  return 1 - w.usado < cfg.llena;
}

function familiaDe(mid: unknown): string | null {
  const m = pyStr(mid || "").toLowerCase();
  for (const f of FAMILIAS_EXCLUIBLES) if (m.includes(f)) return f;
  return null;
}

/** La regla de `excluir` que saca a ese id, o null. */
export function excluidoPor(mid: unknown, excl: string[] | null | undefined, fam: string | null = null): string | null {
  const m = pyStr(mid || "").toLowerCase();
  const f = fam || familiaDe(m);
  for (const p of excl || []) if (p === f || p === m || m.startsWith(p + "-") || (p.endsWith("*") && m.startsWith(p.slice(0, -1)))) return p;
  return null;
}

function effortsDe(cfg: Obj, mid: string, fam: string | null = null): string[] | null {
  const ep = cfg.efforts_permitidos || {};
  const m = (mid || "").toLowerCase();
  const base = m.replace(/-(low|medium|high|xhigh|max)$/, "");
  for (const k of [m, base, fam]) if (k && k in ep) return ep[k];
  return null;
}

function effortPermitido(cfg: Obj, mid: string, fam: string | null, effort: string, disponibles: string[] = EFFORTS_AA): [string | null, string | null] {
  const perm = effortsDe(cfg, mid, fam);
  if (perm === null) return [effort, null];
  const ok = EFFORTS_AA.filter((e) => perm.includes(e) && disponibles.includes(e));
  if (!ok.length) return [null, `efforts_permitidos deja sin ningún effort a ${fam || mid}`];
  if (ok.includes(effort)) return [effort, null];
  const i = EFFORTS_AA.includes(effort) ? EFFORTS_AA.indexOf(effort) : EFFORTS_AA.indexOf("high");
  const arriba = ok.filter((e) => EFFORTS_AA.indexOf(e) > i);
  const nuevo = arriba.length ? arriba[0]! : ok[ok.length - 1]!;
  return [nuevo, `el effort ${effort} del tipo no está permitido en modelos.json (efforts_permitidos): uso ${nuevo}`];
}

function usoDe(mid: string, uso: [string, string][], fam: string | null = null): [string, string | null] {
  for (const [p, v] of uso || []) if (excluidoPor(mid, [p], fam)) return [v, p];
  return ["libre", null];
}

// --- tiempo ------------------------------------------------------------------------------------------
function ahora(): Date {
  const v = E.REPARTO_AHORA;
  if (v) return parseIso(v) || new Date();
  return new Date();
}

export function humano(horas: number | null): string {
  if (horas === null || horas === undefined) return "?";
  if (horas < 1) return `${Math.max(1, pyRound(horas * 60))} min`;
  const mins = pyRound(horas * 60);
  const resto = ((mins % 60) + 60) % 60;
  const ent = Math.floor(mins / 60);
  if (horas < 10) return resto ? `${ent} h ${resto} min` : `${ent} h`;
  if (horas < 48) return `${pyRound(horas)} h`;
  const h = pyRound(horas);
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

// --- cupos -------------------------------------------------------------------------------------------
function ventana(id: string, usado: unknown, vuelve: unknown): Obj {
  let u: number | null = null;
  if (usado !== null && usado !== undefined) u = Math.max(0.0, Math.min(1.0, pyRound(pyFloat(usado === true ? 1 : usado === false ? 0 : usado), 4)));
  const w: Obj = { id, usado: u, vuelve: vuelve ?? null };
  return u !== null ? conFloat(w, "usado") : w;
}

function mismaCarpeta(a: unknown, b: string): boolean {
  try {
    if (typeof a !== "string") return false;
    return realpath(expandir(a)) === realpath(expandir(b));
  } catch {
    return false;
  }
}

function deLaCuenta(cfgdir: unknown, cuenta: Obj | null | undefined): boolean {
  if (!cuenta || cuenta.defecto) return !verdad(cfgdir) || mismaCarpeta(cfgdir, "~/.claude");
  return verdad(cfgdir) && mismaCarpeta(cfgdir, cuenta.dir);
}

const esNumPy = (v: unknown) => typeof v === "number" || typeof v === "boolean";

function cuposClaude(estado: string | undefined, now: Date, cuenta: Obj | null = null): Obj {
  const paState = estado || path.join(home(), ".local", "state", "pa");
  const mejor: Record<string, [number, number, number] | null> = { "5h": null, "7d": null };
  const claves: Record<string, string> = { "5h": "five_hour", "7d": "seven_day" };
  const tsNow = now.getTime() / 1000;
  const ofrecer = (wid: string, ts: any, pctv: unknown, reset: unknown) => {
    if (!esNumPy(pctv) || !esNumPy(reset) || Number(reset) <= tsNow) return;
    const m = mejor[wid];
    if (m === null || ts > m[0]) mejor[wid] = [ts, Number(pctv) / 100.0, Number(reset)];
  };
  const dirSl = path.join(paState, "statusline");
  let archivos: string[] = [];
  try {
    archivos = readdirSync(dirSl).filter((n) => n.endsWith(".json") && !n.startsWith(".")).map((n) => path.join(dirSl, n));
  } catch {
    archivos = [];
  }
  for (const f of archivos) {
    let d: unknown;
    try {
      d = leerJson(readFileSync(f, "utf8"));
    } catch {
      continue;
    }
    const rl = esDict(d) ? get(d, "rate_limits") : null;
    if (!esDict(rl) || !deLaCuenta(get(d, "config_dir"), cuenta)) continue;
    let ts: any = get(d, "ts");
    if (!verdad(ts)) {
      try {
        ts = mtime(f);
      } catch {
        continue;
      }
    }
    for (const [wid, k] of Object.entries(claves)) {
      const w = get(rl, k);
      if (esDict(w)) ofrecer(wid, ts, get(w, "used_percentage"), get(w, "resets_at"));
    }
  }
  const hist = path.join(paState, "statusline", "historial.jsonl");
  let filas: unknown[];
  try {
    filas = splitlines(readFileSync(hist, "utf8").replace(/\r\n?/g, "\n")).slice(-200).filter((x) => x.trim()).map((x) => leerJson(x));
  } catch {
    filas = [];
  }
  for (const r of filas) {
    if (esDict(r) && deLaCuenta(get(r, "config_dir"), cuenta)) {
      ofrecer("5h", get(r, "ts", 0), get(r, "h5"), get(r, "h5_reset"));
      ofrecer("7d", get(r, "ts", 0), get(r, "sem"), get(r, "sem_reset"));
    }
  }
  let usos = [path.join(paState, "uso.json")];
  if (cuenta && !cuenta.defecto) usos = [path.join(paState, "cuentas", cuenta.id, "uso.json")];
  else if (E.HILOS_STATE) usos.push(path.join(E.HILOS_STATE, "uso.json"));
  else if (path.resolve(paState) === path.resolve(path.join(home(), ".local", "state", "pa"))) usos.push(path.join(home(), ".local", "state", "hilos", "uso.json"));
  else usos.push(path.join(paState, "hilos", "uso.json"));
  for (const f of usos) {
    let d: unknown;
    try {
      d = leerJson(readFileSync(f, "utf8"));
    } catch {
      continue;
    }
    if (!esDict(d)) continue;
    for (const [wid, k] of Object.entries(claves)) {
      const w = get(d, k);
      if (esDict(w)) {
        let ts: any = get(w, "ts");
        if (!verdad(ts)) ts = get(d, "ts");
        if (!verdad(ts)) ts = mtime(f);
        ofrecer(wid, ts, get(w, "pct"), get(w, "resets_at"));
      }
    }
  }
  const vent: Obj[] = [];
  for (const wid of ["5h", "7d"]) {
    const m = mejor[wid];
    vent.push(m ? ventana(wid, m[1], iso(new Date(m[2] * 1000))) : ventana(wid, null, null));
  }
  if (!cuenta) return { id: "claude", nombre: "Claude", ventanas: vent };
  return { id: cuenta.id, nombre: cuenta.nombre, proveedor: "claude", cuenta: cuenta.id, ventanas: vent };
}

function ttlCache(j: unknown): number {
  const v = E.REPARTO_CACHE_S;
  if (v) return pyFloat(v);
  try {
    for (const g of (j as Obj).command.data.groups) {
      for (const b of get(g, "buckets", [])) {
        const rf = get(b, "remaining_fraction");
        if (get(b, "window") === "5h" && esNumPy(rf) && Number(rf) < 0.5) return CACHE_CORTA_S;
      }
    }
  } catch {
    /* sin dato */
  }
  return CACHE_S;
}

function quotaAgy(state: string, _now: Date, cuenta: Obj | null = null): Obj | null {
  const cid = get(cuenta, "id");
  const cache = path.join(state, `quota${suf(cid)}.json`);
  try {
    const c = leerJson(readFileSync(cache, "utf8"));
    if (ahoraS() - c.leido <= ttlCache(c.json) && verdad(c.json)) return c.json;
  } catch {
    /* sin caché */
  }
  let j: Obj;
  try {
    const salida = correrSync("agy", ["-p", "/quota", "--output-format", "json"], { timeoutS: pyFloat(E.REPARTO_AGY_S ?? "40"), cwd: E.TMPDIR || "/tmp", env: envCuenta(cuenta) });
    if (salida === null) return null;
    j = leerJson(salida);
    if (!verdad(get(get(get(j, "command", {}), "data", {}), "groups"))) return null;
  } catch {
    return null;
  }
  try {
    mkdirSync(state, { recursive: true });
    grabarJson(cache, conFloat({ leido: ahoraS(), json: j }, "leido"));
  } catch {
    /* sin caché */
  }
  return j;
}

function idGrupo(nombre: unknown): string {
  const n = pyStr(nombre || "").toLowerCase();
  if (n.includes("argon")) return "gemini-4-argon";
  if (n.includes("claude") || n.includes("gpt")) return "claude-gpt";
  return "gemini";
}

function cuposGoogle(cfg: Obj, state: string, now: Date, cuenta: Obj | null = null): Obj {
  const j = quotaAgy(state, now, cuenta);
  const porId: Obj = {};
  if (j) {
    for (const g of get(get(get(j, "command", {}), "data", {}), "groups", [])) {
      const gid = idGrupo(get(g, "name"));
      const vs: Obj = {};
      for (const b of get(g, "buckets", [])) {
        const w = ({ weekly: "7d", "5h": "5h" } as Obj)[get(b, "window")];
        const rf = get(b, "remaining_fraction");
        if (w && esNumPy(rf)) vs[w] = ventana(w, 1 - Number(rf), get(b, "reset_time"));
      }
      porId[gid] = vs;
    }
  }
  const grupos: Obj[] = [];
  for (const [gid, nombre, wids, baseModelos] of GRUPOS_GOOGLE) {
    const modelos: string[] = [];
    for (const b of baseModelos) for (const e of b.includes("gpt-oss") ? ["medium"] : EFFORTS_AGY) modelos.push(`${b}-${e}`);
    const vs = porId[gid] ?? {};
    const g: Obj = { id: gid, nombre, modelos, ventanas: wids.map((w) => vs[w] || ventana(w, null, null)) };
    const h = cfg.grupos_hasta[gid];
    if (verdad(h)) g.hasta = h;
    grupos.push(g);
  }
  if (!cuenta) return { id: "google", nombre: "Google AI Pro", grupos };
  return { id: cuenta.id, nombre: cuenta.nombre, proveedor: "google", cuenta: cuenta.id, grupos };
}

const codexHome = () => E.CODEX_HOME || path.join(home(), ".codex");

function agyDisponible(): boolean {
  if (E.REPARTO_AGY === "0") return false;
  if (E.REPARTO_CUPOS_FIJOS) return true;
  return !!enPath("agy");
}

function codexDisponible(): boolean {
  if (E.REPARTO_CODEX === "0") return false;
  return !!enPath("codex") && esArchivo(path.join(codexHome(), "auth.json"));
}

// --- dsh (DeepSeek Harness) --------------------------------------------------------------------------
const accesoX = (p: string) => {
  try {
    statSync(p);
    return process.platform === "win32" || esEjecutableODir(p);
  } catch {
    return false;
  }
};
function esEjecutableODir(p: string): boolean {
  try {
    if (statSync(p).isDirectory()) return true;
  } catch {
    return false;
  }
  return esEjecutable(p);
}

function binDe(nombre: string, envVar: string, previos: string[]): string | null {
  const h = E[envVar];
  if (h) return accesoX(h) ? h : null;
  const c = enPath(nombre);
  if (c) return c;
  const dirs = [...previos];
  if (E.npm_config_prefix) dirs.push(path.join(E.npm_config_prefix, "bin"));
  dirs.push(path.join(home(), ".npm-global", "bin"), "/usr/local/bin");
  return dirs.map((d) => path.join(d, nombre)).find(accesoX) ?? null;
}
const dshBin = () => binDe("dsh", "HILOS_DSH", [path.join(home(), ".local", "bin")]);

function dshClave(nombre: string): string | null {
  if (nombre !== "OPENCODE_API_KEY" && nombre !== "DEEPSEEK_API_KEY") return null;
  if (E[nombre]) return E[nombre]!;
  const xdg = E.XDG_CONFIG_HOME || path.join(home(), ".config");
  const f = E.TRAMA_CLAVES || path.join(xdg, "trama", "claves.env");
  let v: string | null = null;
  let texto: string;
  try {
    texto = readFileSync(f, "utf8");
  } catch {
    return null;
  }
  const re = new RegExp(`^\\s*(?:export\\s+)?${nombre}\\s*=\\s*(.*?)\\s*$`);
  for (const ln of lineasTexto(texto)) {
    const m = re.exec(ln);
    if (m) {
      v = m[1]!;
      const q = /^(['"])(.*)\1$/.exec(v);
      if (q) v = q[2]!;
    }
  }
  return v && /^[A-Za-z0-9._~+/=:-]+$/.test(v) ? v : null;
}

function dshOllamaUrl(): string {
  let u = E.OLLAMA_HOST || "http://localhost:11434";
  if (!u.startsWith("http")) u = "http://" + u;
  return u.replace(/\/+$/, "");
}

/** GET sincrónico (un node aparte con fetch): el cuerpo, o null si falló, no fue 2xx o venció. */
function getSync(url: string, timeoutS: number): string | null {
  const ms = Math.max(1, Math.round(timeoutS * 1000));
  const js = "fetch(process.argv[1],{signal:AbortSignal.timeout(Number(process.argv[2]))}).then(r=>r.ok?r.text():Promise.reject()).then(t=>process.stdout.write(t),()=>process.exit(1))";
  const r = spawnSync(process.execPath, ["-e", js, url, String(ms)], { encoding: "utf8", timeout: ms + 5000, env: { ...E, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true });
  return r.status === 0 ? r.stdout : null;
}

function dshOllamaModelos(now: Date): string[] {
  const url = dshOllamaUrl();
  const cache = path.join(stateDir(), "dsh-ollama.json");
  const ttl = pyFloat(E.REPARTO_DSH_CACHE_S ?? 60);
  try {
    const c = leerJson(readFileSync(cache, "utf8"));
    if (get(c, "url") === url && now.getTime() / 1000 - get(c, "t", 0) < ttl) return [...(get(c, "modelos") || [])];
  } catch {
    /* sin caché */
  }
  let modelos: string[];
  try {
    const cuerpo = getSync(url + "/api/tags", pyFloat(E.REPARTO_DSH_CHEQUEO_S ?? 2));
    if (cuerpo === null) throw new Error("sin respuesta");
    modelos = (get(leerJson(cuerpo), "models", []) as unknown[]).filter(esDict).map((m) => m.name || m.model).filter((m) => verdad(m));
  } catch {
    modelos = [];
  }
  try {
    mkdirSync(path.dirname(cache), { recursive: true });
    grabarJson(cache, conFloat({ url, t: now.getTime() / 1000, modelos }, "t"));
  } catch {
    /* sin caché */
  }
  return modelos;
}

function dshEstado(now: Date): Obj {
  const vacio = { ollama: [] as string[], opencode: false, deepseek: false };
  if (E.REPARTO_DSH === "0" || E.REPARTO_SIN_DSH === "1") return vacio;
  const fijo = E.REPARTO_DSH_FIJO;
  if (fijo) {
    try {
      const j = leerJson(fijo);
      return { ollama: [...(get(j, "ollama") || [])], opencode: verdad(get(j, "opencode")), deepseek: verdad(get(j, "deepseek")) };
    } catch {
      return vacio;
    }
  }
  if (!dshBin()) return vacio;
  return { ollama: dshOllamaModelos(now), opencode: verdad(dshClave("OPENCODE_API_KEY")), deepseek: verdad(dshClave("DEEPSEEK_API_KEY")) };
}

const PALABRAS_ALTAS = ["ultra", "super", "pro", "max"];
const PALABRAS_BAJAS = ["flash", "lightning", "mini", "nano"];

function calidadEstimada(mid: string): number {
  const nombre = (mid || "").toLowerCase().split("/").pop()!;
  const palabras = nombre.split(/[^a-z0-9]+/);
  let q = 50;
  if (palabras.some((p) => PALABRAS_ALTAS.includes(p))) q += 10;
  if (palabras.some((p) => PALABRAS_BAJAS.includes(p))) q -= 10;
  return viejaAAa(q);
}

function calidadOrigen(cfg: Obj, mid: string, patrones = true): [number, string] {
  const q = cfg.calidad;
  const usr: Set<string> = cfg.calidad_usuario ?? new Set();
  if (usr.has(mid) && esNum(q[mid])) return [q[mid], "usuario"];
  const pats = Object.keys(q).filter((k) => patrones && (k.startsWith("dsh:") || k.startsWith("opencode:")) && k.includes("*") && esNum(q[k]));
  const ordenados = [...pats].sort((a, b) => b.length - a.length);
  for (const k of ordenados) if (usr.has(k) && fnmatchcase(mid, k)) return [q[k], "usuario"];
  const r = aaCalidad(cfg.aa, mid);
  if (r) return [r[0], "artificial-analysis"];
  if (esNum(q[mid]) && Object.prototype.hasOwnProperty.call(q, mid)) return [q[mid], "defecto"];
  for (const k of ordenados) if (fnmatchcase(mid, k)) return [q[k], "defecto"];
  return [calidadEstimada(mid), "estimada"];
}

const opencodeBin = () => binDe("opencode", "HILOS_OPENCODE", [path.join(home(), ".opencode", "bin"), path.join(home(), ".local", "bin")]);

function opencodeListado(now: Date): { gratis: string[]; go: string[] | null } {
  const vacio = { gratis: [] as string[], go: null };
  if (E.REPARTO_OPENCODE === "0" || E.REPARTO_SIN_DSH === "1") return vacio;
  const fijo = E.REPARTO_OPENCODE_FIJO;
  if (fijo) {
    try {
      const lista = (leerJson(fijo) as unknown[]).filter((m): m is string => typeof m === "string");
      const go = lista.filter((m) => m.startsWith("opencode-go/")).map((m) => m.split("/").slice(1).join("/"));
      return { gratis: lista.filter((m) => !m.startsWith("opencode-go/")).map((m) => (m.startsWith("opencode/") ? m.split("/").slice(1).join("/") : m)), go: go.length ? go : null };
    } catch {
      return vacio;
    }
  }
  const exe = opencodeBin();
  if (!exe) return vacio;
  const cache = path.join(stateDir(), "opencode-modelos.json");
  const ttl = pyFloat(E.REPARTO_OPENCODE_CACHE_S ?? 3600);
  try {
    const c = leerJson(readFileSync(cache, "utf8"));
    if (get(c, "exe") === exe && now.getTime() / 1000 - get(c, "t", 0) < ttl) return { gratis: [...(get(c, "modelos") || [])], go: Array.isArray(get(c, "go")) ? [...c.go] : null };
  } catch {
    /* sin caché */
  }
  let modelos: string[] = [];
  const go: string[] = [];
  try {
    const salida = correrSync(exe, ["models"], { timeoutS: pyFloat(E.REPARTO_OPENCODE_CHEQUEO_S ?? 8) });
    if (salida !== null) {
      for (const ln of splitlines(salida.replace(/\x1b\[[0-9;]*[A-Za-z]/g, ""))) {
        const m = /^opencode\/(big-pickle|\S*-free)$/.exec(ln.trim());
        if (m && !modelos.includes(m[1]!)) modelos.push(m[1]!);
        const g = /^opencode-go\/(\S+)$/.exec(ln.trim());
        if (g && !go.includes(g[1]!)) go.push(g[1]!);
      }
    }
  } catch {
    /* sin listado */
  }
  if (!modelos.length) modelos = [...OC_GRATIS_CONOCIDOS];
  try {
    mkdirSync(path.dirname(cache), { recursive: true });
    grabarJson(cache, conFloat({ exe, t: now.getTime() / 1000, modelos, go }, "t"));
  } catch {
    /* sin caché */
  }
  return { gratis: modelos, go: go.length ? go : null };
}

const opencodeGratis = (now: Date) => opencodeListado(now).gratis;

const goCacheRuta = () => path.join(E.HILOS_STATE || path.join(home(), ".local", "state", "hilos"), "opencode-go-topes.json");

function goLeerTabla(ruta: string): Obj | null {
  try {
    const t = leerJson(readFileSync(ruta, "utf8"));
    const ms = (t.modelos as unknown[]).filter((m): m is Obj => esDict(m) && typeof m.id === "string" && !!m.id);
    return get(t, "version") === 1 && ms.length ? { fuente: get(t, "fuente"), fecha: get(t, "fecha"), leido: get(t, "leido"), modelos: ms } : null;
  } catch {
    return null;
  }
}

function goPedirActualizacion() {
  if (E.TRAMA_GO_SIN_RED === "1") return;
  const cache = goCacheRuta();
  for (const [archivo, vale] of [[cache, 3600 * 24], [cache + ".intento", 3600]] as [string, number][]) {
    try {
      if (ahoraS() - mtime(archivo) < vale) return;
    } catch {
      /* no existe */
    }
  }
  const node = enPath("node");
  const mjs = path.join(carpetaMotor(), "opencode", "go-topes.mjs");
  if (!node || !existsSync(mjs)) return;
  try {
    lanzarSuelto(node, [mjs, "--refrescar", "--si-viejo", "--cache", cache]);
  } catch {
    /* no se pudo */
  }
}

function goTabla(): Obj | null {
  const explicita = E.REPARTO_GO_TABLA;
  if (explicita) {
    const t = goLeerTabla(explicita);
    return t ? { ...t, origen: "respaldo" } : null;
  }
  let t = goLeerTabla(goCacheRuta());
  if (t) return { ...t, origen: "cache" };
  t = goLeerTabla(path.join(carpetaMotor(), "opencode", "go-topes.json"));
  return t ? { ...t, origen: "respaldo" } : null;
}

const slugGo = (s: unknown) => pyStr(s || "").toLowerCase().replace(/^(?:opencode:)?(?:opencode-go\/)?/, "").replace(/[^a-z0-9]/g, "");

function goModelos(cfg: Obj, now: Date): [string, Obj][] {
  if (cfg.opencode_plan !== "go" && cfg.opencode_plan !== "go-plus") return [];
  if (E.REPARTO_OPENCODE === "0" || E.REPARTO_SIN_DSH === "1") return [];
  if (!E.REPARTO_OPENCODE_FIJO && !opencodeBin()) return [];
  if (!E.REPARTO_GO_TABLA) goPedirActualizacion();
  const tabla = goTabla();
  if (!tabla) return [];
  const listados = opencodeListado(now).go;
  const out: [string, Obj][] = [];
  for (const m of tabla.modelos as Obj[]) {
    if (listados && listados.length) {
      const real = listados.find((l) => slugGo(l) === slugGo(m.id));
      if (real) out.push([real, m]);
    } else out.push([m.id, m]);
  }
  return out;
}

function goTopes(cfg: Obj, mid: string): unknown {
  const plan = cfg.opencode_plan;
  const t = plan === "go" || plan === "go-plus" ? goTabla() : null;
  for (const m of (t?.modelos ?? []) as Obj[]) if (slugGo(m.id) === slugGo(mid)) return get(m, plan);
  return null;
}

function dshOfertas(cfg: Obj, now: Date): [string, string, string, boolean][] {
  const st = dshEstado(now);
  const out: [string, string, string, boolean][] = [];
  for (const m of opencodeGratis(now)) out.push([`opencode:opencode/${m}`, `${m} (OpenCode, gratis)`, "opencode-prog", true]);
  for (const [real, m] of goModelos(cfg, now)) out.push([OC_GO_PREFIJO + real, `${m.nombre || real} (OpenCode Go)`, "opencode-go", false]);
  for (const m of st.ollama) out.push([`dsh:ollama/${m}`, `${m} (Ollama, dsh)`, "ollama", true]);
  if (st.opencode && E.REPARTO_DSH_OPENCODE === "1") {
    const ids = [...DSH_OPENCODE_GRATIS];
    for (const k of Object.keys(cfg.calidad)) {
      const m = /^dsh:opencode\/([^*]+-free)$/.exec(k);
      if (m && !ids.includes(m[1]!)) ids.push(m[1]!);
    }
    for (const m of ids) out.push([`dsh:opencode/${m}`, `${m} (OpenCode, gratis)`, "opencode", true]);
  }
  if (st.deepseek) {
    const ids = [...DSH_DEEPSEEK];
    for (const k of Object.keys(cfg.calidad)) {
      const m = /^dsh:deepseek\/([^*]+)$/.exec(k);
      if (m && !ids.includes(m[1]!)) ids.push(m[1]!);
    }
    for (const m of ids) out.push([`dsh:deepseek/${m}`, `${m} (DeepSeek, de pago)`, "deepseek", false]);
  }
  return out;
}

function claudeInstalado(): boolean {
  if (E.REPARTO_CLAUDE === "0") return false;
  if (E.REPARTO_CUPOS_FIJOS) return true;
  return !!enPath("claude") || [path.join(home(), ".local", "bin", "claude"), path.join(home(), ".claude", "local", "claude")].some(accesoX);
}

function rateLimitsCodex(now: Date): Obj {
  const base = path.join(codexHome(), "sessions");
  const archivos: string[] = [];
  const hijos = (d: string) => {
    try {
      return readdirSync(d).filter((n) => !n.startsWith(".")).map((n) => path.join(d, n));
    } catch {
      return [];
    }
  };
  for (const a of hijos(base)) for (const b of hijos(a)) for (const c of hijos(b)) for (const f of hijos(c)) if (/^rollout-.*\.jsonl$/s.test(path.basename(f))) archivos.push(f);
  try {
    const t = new Map(archivos.map((f) => [f, mtime(f)]));
    archivos.sort((x, y) => t.get(y)! - t.get(x)!);
  } catch {
    /* sin orden */
  }
  for (const f of archivos.slice(0, 8)) {
    let filas: string[];
    try {
      filas = splitlines(readFileSync(f, "utf8").replace(/\r\n?/g, "\n")).slice(-400);
    } catch {
      continue;
    }
    for (const linea of [...filas].reverse()) {
      if (!linea.includes("rate_limits")) continue;
      let ev: Obj;
      try {
        ev = leerJson(linea);
      } catch {
        continue;
      }
      if (!esDict(ev)) continue;
      const pl = esDict(ev.payload) ? ev.payload : ev;
      const rl = esDict(pl) ? get(pl, "rate_limits") : null;
      if (!esDict(rl)) continue;
      let tEv = parseIso(get(ev, "timestamp"));
      if (!tEv) {
        try {
          tEv = new Date(mtime(f) * 1000);
        } catch {
          continue;
        }
      }
      const out: Obj = {};
      for (const k of ["primary", "secondary"]) {
        const w = get(rl, k);
        if (!esDict(w) || !esNumPy(w.used_percent)) continue;
        const mins = get(w, "window_minutes");
        const wid = esNumPy(mins) && Number(mins) <= 720 ? "5h" : verdad(mins) ? "7d" : k === "primary" ? "5h" : "7d";
        const ra = get(w, "resets_at");
        let vuelve: Date | null;
        if (esNumPy(ra)) vuelve = new Date(Number(ra) * 1000);
        else if (typeof ra === "string") vuelve = parseIso(ra);
        else if (esNumPy(get(w, "resets_in_seconds"))) vuelve = new Date(tEv.getTime() + Number(w.resets_in_seconds) * 1000);
        else vuelve = null;
        if (vuelve !== null && vuelve <= now) continue;
        out[wid] = ventana(wid, Number(w.used_percent) / 100.0, iso(vuelve));
      }
      if (Object.keys(out).length) return out;
    }
  }
  return {};
}

function cuposOpenai(cfg: Obj, now: Date): Obj {
  const vs = rateLimitsCodex(now);
  const grupos: Obj[] = [];
  for (const [gid, nombre, wids, bases] of GRUPOS_OPENAI) {
    const modelos = bases.flatMap((b) => EFFORTS_CODEX.map((e) => `${b}-${e}`));
    const g: Obj = { id: gid, nombre, modelos, ventanas: wids.map((w) => vs[w] || ventana(w, null, null)) };
    const h = cfg.grupos_hasta[gid];
    if (verdad(h)) g.hasta = h;
    grupos.push(g);
  }
  return { id: "openai", nombre: "ChatGPT", grupos };
}

function stateDir(): string {
  if (E.REPARTO_STATE) return E.REPARTO_STATE;
  return path.join(E.PA_STATE || path.join(home(), ".local", "state", "pa"), "reparto");
}

function ventanaAsignacion(): number {
  try {
    return pyFloat(E.REPARTO_ASIGNACION_S ?? ASIGNACION_S);
  } catch {
    return ASIGNACION_S;
  }
}

function cargaPorGrupo(now: Date): Obj {
  const fija = E.REPARTO_CARGA_FIJA;
  if (fija) {
    try {
      const out: Obj = {};
      for (const [k, v] of Object.entries(leerJson(fija) as Obj)) out[k] = pyInt(v);
      return out;
    } catch {
      return {};
    }
  }
  const out: Obj = {};
  const base = E.PA_STATE || path.join(home(), ".local", "state", "pa");
  const vistos = new Set<string>();
  const sumar = (m: string | null, cu: string | null) => {
    let g = m ? grupoDeModelo(m) : null;
    if (g) {
      g += suf(cu);
      out[g] = (out[g] ?? 0) + 1;
    }
  };
  let subdirs: string[] = [];
  try {
    subdirs = readdirSync(base).filter((n) => !n.startsWith("."));
  } catch {
    subdirs = [];
  }
  for (const sd of subdirs) {
    let pids: string[];
    try {
      pids = readdirSync(path.join(base, sd)).filter((n) => n.endsWith(".pid") && !n.startsWith("."));
    } catch {
      continue;
    }
    for (const n of pids) {
      const pidf = path.join(base, sd, n);
      let m: string | null = null;
      let cu: string | null = null;
      try {
        const pid = pyInt(readFileSync(pidf, "utf8").trim());
        process.kill(pid, 0);
        for (const ln of lineasTexto(readFileSync(pidf.slice(0, -4) + ".hilo", "latin1"))) {
          if (ln.startsWith("modelo=")) m = ln.slice(7).trim();
          else if (ln.startsWith("cuenta=")) cu = ln.slice(7).trim();
        }
      } catch {
        continue;
      }
      vistos.add(`${sd}\0${n.slice(0, -4)}`);
      sumar(m, cu);
    }
  }
  let runs: string[] = [];
  try {
    runs = readdirSync(base).filter((n) => n.endsWith(".running") && !n.startsWith("."));
  } catch {
    runs = [];
  }
  for (const n of runs) {
    const c: Obj = {};
    try {
      for (const ln of lineasTexto(readFileSync(path.join(base, n), "latin1"))) {
        const i = ln.indexOf("=");
        const [k, v] = i < 0 ? [ln, ""] : [ln.slice(0, i), ln.slice(i + 1)];
        if (!(k in c)) c[k] = v;
      }
      const pid = pyInt(c.pid || c.pa_pid || "");
      if (!existePid(pid)) continue;
    } catch {
      continue;
    }
    if (vistos.has(`${c.proyecto}\0${c.id}`)) continue;
    sumar(c.modelo ?? null, c.cuenta ?? null);
  }
  try {
    for (const a of leerJson(readFileSync(path.join(stateDir(), "asignaciones.json"), "utf8"))) {
      if (now.getTime() / 1000 - get(a, "t", 0) < ventanaAsignacion() && verdad(get(a, "grupo"))) out[a.grupo] = (out[a.grupo] ?? 0) + 1;
    }
  } catch {
    /* sin anotaciones */
  }
  return out;
}

async function registrarAsignacion(grupo: string, now: Date) {
  const d = stateDir();
  const f = path.join(d, "asignaciones.json");
  try {
    mkdirSync(d, { recursive: true });
    await bloqueo(f, () => {
      let lst: Obj[];
      try {
        lst = (leerJson(readFileSync(f, "utf8")) as Obj[]).filter((a) => now.getTime() / 1000 - get(a, "t", 0) < ventanaAsignacion());
      } catch {
        lst = [];
      }
      lst.push(conFloat({ grupo, t: now.getTime() / 1000 }, "t"));
      grabarJson(f, lst);
    });
  } catch {
    /* no importa */
  }
}

function leerAgotados(state: string, now: Date): Obj {
  let d: unknown;
  try {
    d = leerJson(readFileSync(path.join(state, "agotado.json"), "utf8"));
  } catch {
    return {};
  }
  const out: Obj = {};
  for (const [gid, v] of esDict(d) ? Object.entries(d) : []) {
    const dt = parseIso(esDict(v) ? get(v, "hasta") : null);
    if (dt && dt > now) out[gid] = iso(dt);
  }
  return out;
}

function grabarAgotados(state: string, d: Obj) {
  mkdirSync(state, { recursive: true });
  const o: Obj = {};
  for (const [k, v] of Object.entries(d)) o[k] = { hasta: v };
  grabarJson(path.join(state, "agotado.json"), o);
}

function aplicarAgotados(d: Obj, state: string, now: Date): Obj {
  const ag = leerAgotados(state, now);
  if (!Object.keys(ag).length) return d;
  for (const s of get(d, "suscripciones", [])) {
    const sf = suf(cuentaDe(s));
    if (provDe(s) === "claude" && CLAUDE_OFICIAL + sf in ag) {
      const hasta = ag[CLAUDE_OFICIAL + sf];
      s.agotado = hasta;
      const vs = verdad(get(s, "ventanas")) ? s.ventanas : [ventana("5h", null, null), ventana("7d", null, null)];
      s.ventanas = vs.map((w: Obj) => ventana(w.id, 1.0, hasta));
    }
    for (const g of get(s, "grupos", []) || []) {
      if (pyStr(get(g, "id", "")) + sf in ag) {
        const hasta = ag[g.id + sf];
        g.agotado = hasta;
        const vs = verdad(get(g, "ventanas")) ? g.ventanas : [ventana("5h", null, null)];
        g.ventanas = vs.map((w: Obj) => ventana(w.id, 1.0, hasta));
      }
    }
  }
  return d;
}

const CLAUDE_OFICIAL = "claude-oficial";

export function grupoDeModelo(mid: unknown): string | null {
  const m = pyStr(mid || "").toLowerCase();
  if (m.startsWith(OC_GO_PREFIJO)) return m;
  if (m === "opencode-free" || m.startsWith("opencode:")) return "opencode-free";
  for (const [prov, gid] of Object.entries(DSH_GRUPOS)) if (prov !== "opencode-prog" && (m === gid || m.startsWith(`dsh:${prov}/`))) return gid;
  if (m.startsWith("codex:gpt-6-sol")) return "codex";
  for (const [gid, , , bases] of [...GRUPOS_GOOGLE, ...GRUPOS_OPENAI]) if (m === gid || bases.some((b) => m === b || m.startsWith(b + "-"))) return gid;
  if (m === CLAUDE_OFICIAL || m.startsWith("claude-")) return CLAUDE_OFICIAL;
  return null;
}

function leerEnfriados(state: string, now: Date): Obj {
  let d: unknown;
  try {
    d = leerJson(readFileSync(path.join(state, "enfriado.json"), "utf8"));
  } catch {
    return {};
  }
  const out: Obj = {};
  for (const [mid, v] of esDict(d) ? Object.entries(d) : []) {
    const dt = parseIso(esDict(v) ? get(v, "hasta") : null);
    if (dt && dt > now) out[mid.toLowerCase()] = iso(dt);
  }
  return out;
}

async function enfriar(mid0: string, horas: number, now: Date): Promise<number> {
  const mid = (mid0 || "").trim().toLowerCase();
  if (!mid) {
    err("--enfriar quiere un id de modelo");
    return 2;
  }
  const hasta = new Date(now.getTime() + horas * 3600_000);
  const state = stateDir();
  try {
    mkdirSync(state, { recursive: true });
    const f = path.join(state, "enfriado.json");
    await bloqueo(f, () => {
      const actuales = leerEnfriados(state, now);
      actuales[mid] = iso(hasta);
      const o: Obj = {};
      for (const [k, v] of Object.entries(actuales)) o[k] = { hasta: v };
      grabarJson(f, o);
    });
  } catch (e) {
    err(`no pude guardar la marca: ${textoError(e)}`);
    return 1;
  }
  console.log(`${mid} enfriado hasta ${iso(hasta)}`);
  return 0;
}

async function agotar(mid: string, hastaArg: string | null, cfg: Obj, now: Date, cuenta: string | null = null): Promise<number> {
  let gid = grupoDeModelo(mid);
  if (!gid) {
    err(`${mid} no es un modelo de agy, de codex, de dsh ni del Claude oficial, ni un grupo: no hay cupo que marcar`);
    return 1;
  }
  const state = stateDir();
  let hasta: Date | null = hastaArg ? parseIso(hastaArg) : null;
  if (hastaArg && !hasta) {
    err("--hasta quiere una fecha ISO (2026-10-23T15:00:00Z)");
    return 2;
  }
  if (!hasta && gid.startsWith(OC_GO_PREFIJO)) hasta = new Date(now.getTime() + VENCE_GO_H * 3600_000);
  if (!hasta) {
    try {
      const cand: Record<string, Date | null> = {};
      for (const sus of get(leerCupos(cfg, now), "suscripciones", [])) {
        if (suf(cuentaDe(sus)) !== suf(cuenta)) continue;
        if (gid === CLAUDE_OFICIAL && provDe(sus) === "claude") {
          const vs = ordenarPor((get(sus, "ventanas", []) as Obj[]).filter((v) => (parseIso(get(v, "vuelve")) || now) > now), (v) => [-(get(v, "usado") || 0)]);
          if (vs.length) cand["5h"] = parseIso(vs[0]!.vuelve);
        }
        for (const g of get(sus, "grupos", []) || []) {
          if (get(g, "id") === gid) {
            for (const v of get(g, "ventanas", [])) {
              const dt = parseIso(get(v, "vuelve"));
              if (dt && dt > now) cand[pyStr(get(v, "id"))] = dt;
            }
          }
        }
      }
      hasta = cand["5h"] || cand["7d"] || null;
    } catch {
      hasta = null;
    }
  }
  if (!hasta) hasta = new Date(now.getTime() + 3600_000);
  gid += suf(cuenta);
  try {
    mkdirSync(state, { recursive: true });
    await bloqueo(path.join(state, "agotado.json"), () => {
      const ag = leerAgotados(state, now);
      ag[gid!] = iso(hasta);
      grabarAgotados(state, ag);
    });
  } catch (e) {
    err(`no pude guardar la marca: ${textoError(e)}`);
    return 1;
  }
  console.log(`${gid} agotado hasta ${iso(hasta)}`);
  return 0;
}

function leerCupos(cfg: Obj, now: Date): Obj {
  const state = stateDir();
  const fijos = E.REPARTO_CUPOS_FIJOS;
  if (fijos) {
    const d = leerJson(readFileSync(fijos, "utf8"));
    if (!esDict(d)) throw new Error(`'${Array.isArray(d) ? "list" : typeof d}' object has no attribute 'setdefault'`);
    if (!("version" in d)) d.version = VERSION;
    return aplicarAgotados(d, state, now);
  }
  const cs = listaCuentas();
  let subs: Obj[];
  if (cs.every((c) => c.defecto) && cs.length === 2) {
    subs = [cuposClaude(E.PA_STATE, now)];
    if (agyDisponible()) subs.push(cuposGoogle(cfg, state, now));
    if (codexDisponible()) subs.push(cuposOpenai(cfg, now));
    const nom: Obj = {};
    for (const c of cs) nom[c.id] = c.nombre;
    for (const x of subs) x.nombre = nom[x.id] ?? x.nombre;
  } else {
    subs = [];
    for (const c of cs) {
      if (c.proveedor === "claude") subs.push(cuposClaude(E.PA_STATE, now, c));
      else if (c.proveedor === "google" && agyDisponible()) subs.push(cuposGoogle(cfg, state, now, c));
      else if (c.proveedor === "chatgpt" && c.defecto && codexDisponible()) subs.push(cuposOpenai(cfg, now));
      else {
        const nota =
          c.proveedor === "chatgpt" && c.defecto
            ? "codex no está instalado o no tiene login (codex login): no se reparte"
            : c.proveedor === "chatgpt"
              ? `el cupo de codex sólo se lee de la cuenta de siempre: esta no se reparte (sí sirve con pa --cuenta ${c.id})`
              : c.proveedor === "google"
                ? "agy no está instalado: no se reparte"
                : "proveedor sin lectura de cupo: no se reparte";
        subs.push({ id: c.id, nombre: c.nombre, proveedor: c.proveedor, cuenta: c.id, ventanas: [ventana("5h", null, null), ventana("7d", null, null)], nota });
      }
    }
  }
  return aplicarAgotados({ version: VERSION, leido: iso(now), suscripciones: subs }, state, now);
}

// --- reparto -----------------------------------------------------------------------------------------
function hastaFin(hasta: unknown): Date | null {
  if (!verdad(hasta)) return null;
  const f = typeof hasta === "string" ? fechaDe(hasta) : null;
  if (!f) return null;
  const d = new Date(f[0], f[1] - 1, f[2] + 1, 0, 0, 0, 0);
  if (f[0] < 100) d.setFullYear(f[0]);
  return d;
}

function hastaDe(cfg: Obj, gid: string, g: Obj | null | undefined): unknown {
  if (gid in cfg.hasta_pisado) return cfg.hasta_pisado[gid];
  return get(g || {}, "hasta") || get(cfg.grupos_hasta, gid);
}

function horasHasta(vuelve: unknown, now: Date): number | null {
  const dt = parseIso(vuelve);
  return dt ? Math.max(0.0, (dt.getTime() - now.getTime()) / 1000 / 3600.0) : null;
}

function urgenciaVentana(v: Obj, now: Date, topeH: number | null = null): number | null {
  if (get(v, "usado") === null) return null;
  const libre = 1 - v.usado;
  let h = horasHasta(get(v, "vuelve"), now);
  if (h === null) h = v.id === "5h" ? 2.5 : 84.0;
  if (topeH !== null) h = Math.min(h, topeH);
  return libre * Math.min(1.0, HORIZONTE_H / Math.max(h, 1.0));
}

// --- plan y ritmo ------------------------------------------------------------------------------------
const diaLocal = (now: Date) => fechaLocal(now);
const rutaPlan = () => path.join(stateDir(), "plan.json");
type Plan = { ausente: string[]; hoy: string | null; actualizado: string | null };

function planLeer(now: Date): Plan {
  const hoy = diaLocal(now);
  const out: Plan = { ausente: [], hoy: null, actualizado: null };
  let d: unknown;
  try {
    d = leerJson(readFileSync(rutaPlan(), "utf8"));
  } catch {
    return out;
  }
  if (!esDict(d)) return out;
  const fechas = get(d, "ausente");
  for (const x of Array.isArray(fechas) ? fechas : []) {
    if (typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) && x >= hoy && !out.ausente.includes(x)) out.ausente.push(x);
  }
  out.ausente.sort();
  const h = get(d, "hoy");
  if (esDict(h) && get(h, "fecha") === hoy && (h.modo === "gastar" || h.modo === "ahorrar")) out.hoy = h.modo;
  out.actualizado = typeof get(d, "actualizado") === "string" ? d.actualizado : null;
  return out;
}

function planGrabar(plan: Plan, now: Date) {
  const f = rutaPlan();
  if (!plan.ausente.length && !plan.hoy) {
    try {
      unlinkSync(f);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    return;
  }
  mkdirSync(path.dirname(f), { recursive: true });
  const d: Obj = { version: 1, actualizado: iso(now), ausente: [...plan.ausente].sort() };
  if (plan.hoy) d.hoy = { fecha: diaLocal(now), modo: plan.hoy };
  grabarJson(f, d, false);
}

function planDe(cfg: Obj, now: Date): Plan {
  if (!("plan" in cfg)) cfg.plan = planLeer(now);
  return cfg.plan;
}

function fechasDe(texto: string, now: Date): string[] {
  const hoy = diaLocal(now);
  const out: string[] = [];
  for (let tok of texto.split(",").filter((x) => x.trim()).map((x) => x.trim().toLowerCase())) {
    tok = tok.replace(/mañana/g, "manana").replace(/pasado manana/g, "pasado");
    if (tok === "hoy") out.push(hoy);
    else if (tok === "manana") out.push(sumarDias(hoy, 1));
    else if (tok === "pasado") out.push(sumarDias(hoy, 2));
    else {
      const i = tok.indexOf("..");
      const [a, z] = i < 0 ? [tok, ""] : [tok.slice(0, i), tok.slice(i + 2)];
      const f0 = fechaDe(a);
      const f1 = z ? fechaDe(z) : f0;
      if (!f0 || !f1) throw new Error(`fecha ${reprTexto(tok)} (quiero AAAA-MM-DD, hoy, manana, pasado o A..B)`);
      const d0 = f0.map((x, k) => String(x).padStart(k ? 2 : 4, "0")).join("-");
      const d1 = f1.map((x, k) => String(x).padStart(k ? 2 : 4, "0")).join("-");
      if (d1 < d0 || diasEntre(d0, d1) > PLAN_MAX_DIAS) throw new Error(`rango ${reprTexto(tok)}`);
      for (let k = 0; k <= diasEntre(d0, d1); k++) out.push(sumarDias(d0, k));
    }
  }
  if (!out.length) throw new Error("falta la fecha");
  for (const d of out) {
    if (d < hoy) throw new Error(`${d} ya pasó`);
    if (diasEntre(hoy, d) > PLAN_MAX_DIAS) throw new Error(`${d} está a más de ${PLAN_MAX_DIAS} días`);
  }
  return [...new Set(out)].sort();
}

function horasActivas(desde: Date, hasta: Date, ausentes: Set<string>): number {
  let cur = pared(desde);
  const fin = pared(hasta);
  let total = 0.0;
  while (cur < fin) {
    const sig = Math.min(Math.floor(cur / 86400000) * 86400000 + 86400000, fin);
    if (!ausentes.has(new Date(cur).toISOString().slice(0, 10))) total += (sig - cur) / 1000 / 3600.0;
    cur = sig;
  }
  return total;
}

function ritmoVentana(v: Obj, now: Date, plan: Plan, reserva = 0.0): Obj | null {
  if (get(v, "id") !== "7d" || get(v, "usado") === null) return null;
  const fin = parseIso(get(v, "vuelve"));
  if (fin === null) return null;
  const ini = new Date(fin.getTime() - 168 * 3600_000);
  let ausentes = new Set(plan.ausente);
  const h = Math.max(0.0, (fin.getTime() - now.getTime()) / 1000 / 3600.0);
  let tot = horasActivas(ini, fin, ausentes);
  if (tot <= 0) [ausentes, tot] = [new Set(), 168.0];
  const pasado = horasActivas(ini, new Date(Math.min(Math.max(now.getTime(), ini.getTime()), fin.getTime())), ausentes);
  const esperado = Math.max(RITMO_MIN_ESPERADO, Math.min(1.0, pasado / tot));
  const usadoW = reserva ? Math.min(1.0, v.usado / (1 - reserva)) : v.usado;
  let ratio = usadoW / esperado;
  if (plan.hoy === "gastar") ratio = Math.min(ratio, RATIO_GASTAR_HOY);
  else if (plan.hoy === "ahorrar") ratio = Math.max(ratio, RATIO_AHORRAR_HOY);
  const ha = horasActivas(now, fin, ausentes);
  const nivel = ratio > 1.1 ? "encima" : ratio < 0.9 ? "debajo" : "al-ritmo";
  const r: Obj = { usado: pyRound(v.usado, 4), usado_w: pyRound(usadoW, 4), esperado: pyRound(esperado, 4), ratio: pyRound(ratio, 3), h: pyRound(h, 2), h_activas: pyRound(ha, 2), nivel, forzado: plan.hoy };
  conFloat(r, "esperado", "ratio", "h", "h_activas");
  marcarSi(r, "usado", esFloat(v, "usado"));
  marcarSi(r, "usado_w", reserva ? true : esFloat(v, "usado"));
  return r;
}

function puntosRitmo(rt: Obj, urg7: number, pesoRitmo: number, pesoBono: number, mult: number): [number, number] {
  const r = rt.ratio;
  if (r > 1) return [-pesoRitmo * mult * Math.min(r - 1, TOPE_EXCESO), 0.0];
  const e = rt.esperado;
  const presion = (1 - r * e) / Math.max(1 - e, 0.02);
  const atras = Math.max(0.0, Math.min(1.0, presion - 1.0));
  const cerca = Math.max(0.25, Math.min(1.0, (96 - rt.h_activas) / 72.0));
  const s = atras * cerca;
  return [pesoBono * Math.max(0.0, s - urg7), s];
}

function reservaLiderDe(cfg: Obj): number {
  const r = cfg.reserva_lider;
  return r !== null && r !== undefined ? r : PERFILES[cfg.perfil]!.reserva_lider;
}
const reservaLiderFloat = (cfg: Obj) => (cfg.reserva_lider !== null && cfg.reserva_lider !== undefined ? esFloat(cfg, "reserva_lider") : true);

function minimoRelajado(cfg: Obj, tipo: string, minimo: number, _minimoFam: unknown, eTipo: string): [number, boolean] {
  if (!PERFILES[cfg.perfil]!.relaja || !(tipo in RELAJA_AHORRO)) return [minimo, false];
  const n = RELAJA_AHORRO[tipo];
  const q = typeof n === "string" && n in cfg.calidad ? calidadEnEffort(mapaEfforts(cfg, n), eTipo, cfg.calidad[n]) : viejaAAa(n);
  return q < minimo ? [q, true] : [minimo, false];
}

const efectivo = (_base: string, cfgEffort: string[], eTipo: string) => (cfgEffort.includes(eTipo) ? eTipo : cfgEffort[cfgEffort.length - 1]!);
const utilDe = (q: number, minimo: number) => PTS_POR_AA * (q <= minimo + MARGEN ? q : minimo + MARGEN - (q - minimo - MARGEN) * PESO_SOBRA);
const tipoEn = (tipo: string, pats: string[]) => pats.some((p) => fnmatchcase(tipo, p));
const nombreVentana = (wid: string) => (({ "5h": "de 5 h", "7d": "semanal" }) as Obj)[wid] ?? wid;

function armarCandidatos(tipo: string, cfg: Obj, cupos: Obj, now: Date, effort: string | null = null): [Obj[], number, unknown] {
  const subs: Obj[] = get(cupos, "suscripciones", []);
  let claudes = subs.filter((s) => provDe(s) === "claude");
  if (!claudes.length) claudes = [{ id: "claude" }];
  let googles = subs.filter((s) => provDe(s) === "google");
  if (!googles.length) googles = [{ id: "google" }];
  if (!agyDisponible()) googles = [];
  const openais = subs.filter((s) => get(s, "id") === "openai");

  const ofertasDsh = dshOfertas(cfg, now);
  if (ofertasDsh.length && !claudeInstalado()) claudes = [];

  const carga = cargaPorGrupo(now);
  let eTipo: string = effort || get(cfg.effort_por_tipo, tipo, "high");
  if (eTipo === "max") eTipo = "xhigh";
  const minimoFam = get(cfg.minimo_por_tipo, tipo, "sonnet");
  let minimo: number = minimoFam in cfg.calidad && typeof minimoFam === "string" ? cfg.calidad[minimoFam] : esNum(minimoFam) ? minimoFam : viejaAAa(70);
  if (typeof minimoFam === "string" && minimoFam in cfg.calidad) minimo = calidadEnEffort(mapaEfforts(cfg, minimoFam), eTipo, minimo);
  [minimo, cfg._relajado] = minimoRelajado(cfg, tipo, minimo, minimoFam, eTipo);
  const out: Obj[] = [];
  const reserva = cfg.reserva;
  const perfil = PERFILES[cfg.perfil]!;
  const plan = planDe(cfg, now);
  const resLider = reservaLiderDe(cfg);
  const sinRitmo = cfg._sin_ritmo;

  const reservaDe = (w: string): number | null => {
    const r = esDict(reserva) ? get(reserva, w) : reserva;
    if (w === "7d" && resLider) return Math.max(r || 0.0, resLider);
    return r;
  };

  const claudeDeGoogleOk = (google: Obj): boolean => {
    const porId = new Map<unknown, Obj>();
    for (const g of get(google, "grupos", []) || []) porId.set(get(g, "id"), g);
    const agyClaude = porId.get("claude-gpt");
    if (!agyClaude || verdad(get(agyClaude, "agotado"))) return false;
    const hf = hastaFin(hastaDe(cfg, "claude-gpt", agyClaude));
    const vigente = hf === null || now < hf;
    const conocidasG = (get(agyClaude, "ventanas", []) as Obj[]).filter((w) => get(w, "usado") !== null);
    let ok = vigente && !conocidasG.some((w) => ventanaLlena(cfg, "google", "claude-gpt", w));
    const w5 = (get(agyClaude, "ventanas", []) as Obj[]).find((w) => get(w, "id") === "5h" && get(w, "usado") !== null);
    if (w5 !== undefined && 1 - w5.usado < cfg.agy_min_libre_5h && tipoEn(tipo, cfg.agy_min_libre_tipos)) ok = false;
    return ok;
  };

  const agyClaudeOk = googles.some((g) => claudeDeGoogleOk(g));

  const hacer = (c: Familia, cuentaS: Obj) => {
    const [base, fam, nombre0, sus, gid, , efs] = c;
    let nombre = nombre0;
    const claude = cuentaS;
    const grupos = new Map<unknown, Obj>();
    for (const g of get(cuentaS, "grupos", []) || []) grupos.set(get(g, "id"), g);
    const clVent: Obj = {};
    for (const w of get(cuentaS, "ventanas", []) || []) clVent[w.id] = w;
    const cuenta = cuentaDe(cuentaS);
    if (suf(cuenta)) nombre = `${nombre} · ${get(cuentaS, "nombre") || cuenta}`;
    const calidadMejor = get(cfg.calidad, fam, 0);
    const mapaEfx = mapaEfforts(cfg, fam);
    let notaEffort: string | null = null;
    let ePerm: string | null;
    let modelo: string;
    let effortC: string | null;
    let eCal: string;
    if (efs === null) {
      [ePerm, notaEffort] = effortPermitido(cfg, base, fam, eTipo);
      [modelo, effortC] = [base, ePerm || eTipo];
      eCal = effortC;
    } else {
      let e = efectivo(base, efs, eTipo);
      [ePerm, notaEffort] = effortPermitido(cfg, base, fam, e, efs.filter((x) => EFFORTS_AA.includes(x)));
      e = ePerm || e;
      [modelo, effortC] = [`${base}-${e}`, null];
      eCal = e;
    }
    const hayMapa = Object.keys(mapaEfx).length > 0;
    const calidad = calidadEnEffort(mapaEfx, eCal, calidadMejor);
    const cand: Obj = {
      modelo, effort: effortC, nombre, familia: fam, calidad,
      calidad_mejor: calidadMejor, calidad_por_effort: mapaEfx, effort_calidad: hayMapa ? eCal : null,
      efforts_posibles: hayMapa ? EFFORTS_AA.filter((x) => efs === null || efs.includes(x)) : [],
      cupo_libre: null, vuelve: null, puntaje: null, descartado_por: null,
      aviso: null, grupo: gid || "claude-oficial", cuenta, proveedor: sus,
      estimada: !(fam in cfg.calidad), origen: get(cfg.origen, fam, "estimada"), nota_effort: notaEffort,
    };
    if (ePerm === null && notaEffort) {
      cand.descartado_por = `excluido en modelos.json (${notaEffort})`;
      cand.duro = true;
    }
    cand.clave = cand.grupo + suf(cuenta);
    let vents: Obj[];
    let topeH: number | null = null;
    if (sus === "claude") {
      vents = ["5h", "7d"].filter((w) => w in clVent).map((w) => clVent[w]);
      if (!vents.length) vents = [ventana("5h", null, null), ventana("7d", null, null)];
    } else {
      const g = grupos.get(gid);
      vents = [...(get(g || {}, "ventanas", []) as Obj[])];
      const hasta = hastaDe(cfg, gid!, g);
      const hf = hastaFin(hasta);
      if (hf !== null) {
        if (now >= hf) {
          cand.descartado_por = `vencido: el grupo "${get(g || {}, "nombre", gid)}" era hasta el ${pyStr(hasta)}`;
          cand.duro = true;
        } else topeH = (hf.getTime() - now.getTime()) / 1000 / 3600.0;
      }
      if (!vents.length) vents = [ventana("7d", null, null)];
    }
    if (calidad < minimo) {
      cand.descartado_por = `calidad ${fn(calidad)} menor que la ${fn(minimo)} que pide ${tipo}`;
      cand.duro = true;
    } else if (fam in cfg.solo_en && !cfg.solo_en[fam].includes(tipo)) {
      cand.descartado_por = `${nombre} sólo sirve para ${cfg.solo_en[fam].join(" y ")}`;
      cand.duro = true;
    }
    const [u, regla] = usoDe(modelo, cfg.uso_por_modelo, fam);
    if (!cand.duro && u === "poco_importante" && !cfg.tipos_poco_importantes.includes(tipo)) {
      cand.descartado_por = `${nombre} sólo sirve para tareas poco importantes (${cfg.tipos_poco_importantes.join(" y ")}); ${tipo} no lo es (modelos.json uso_por_modelo: ${regla})`;
      cand.duro = true;
    } else if (!cand.duro && u === "solo_final" && !cfg.tipos_finales.includes(tipo)) {
      cand.descartado_por = `${nombre} sólo sirve para tareas finales (${cfg.tipos_finales.join(" y ")}) porque su cupo se gasta muy rápido; ${tipo} no lo es (modelos.json uso_por_modelo: ${regla})`;
      cand.duro = true;
    }
    const x = excluidoPor(modelo, cfg.excluir, fam);
    if (x && !cand.duro) {
      cand.descartado_por = `excluido en modelos.json (excluir: ${x})`;
      cand.duro = true;
    }
    if (sus === "google" && !cand.descartado_por && !verdad(get(grupos.get(gid) || {}, "agotado")) && tipoEn(tipo, cfg.agy_min_libre_tipos)) {
      const w5 = vents.find((w) => w.id === "5h" && get(w, "usado") !== null);
      if (w5 !== undefined && 1 - w5.usado < cfg.agy_min_libre_5h) {
        cand.descartado_por = `poco cupo en agy: al grupo "${get(grupos.get(gid) || {}, "nombre", gid)}" le queda ${pyRound((1 - w5.usado) * 100)} % de la ventana de 5 h (para ${tipo} hace falta ${pyRound(cfg.agy_min_libre_5h * 100)} % o más)${verdad(get(w5, "vuelve")) ? `, vuelve en ${humano(horasHasta(w5.vuelve, now))}` : ""}`;
        cand.duro = true;
      }
    }
    const conocidas = vents.filter((w) => get(w, "usado") !== null);
    cand.ventanas = conocidas.map((w) => marcarSi({ id: w.id, libre: pyRound(1 - w.usado, 4), vuelve: get(w, "vuelve") }, "libre", esFloat(w, "usado")));
    if (conocidas.length) {
      const lib = minPor(conocidas, (w) => [1 - w.usado, get(w, "vuelve") || ""]);
      cand.cupo_libre = pyRound(1 - lib.usado, 4);
      marcarSi(cand, "cupo_libre", esFloat(lib, "usado"));
      cand.vuelve = get(lib, "vuelve");
    } else cand.aviso = "sin dato del cupo (no se descarta, pero no se sabe si queda)";
    if (conocidas.length < vents.length && conocidas.length) cand.aviso = `falta el dato de una ventana (${vents.filter((w) => get(w, "usado") === null).map((w) => w.id).join(", ")})`;
    if (!cand.descartado_por) {
      for (const w of conocidas) {
        const libre = 1 - w.usado;
        if (sus === "claude" && verdad(get(claude, "agotado"))) {
          cand.descartado_por = `Claude dijo que se acabó el cupo (límite), vuelve en ${humano(horasHasta(get(w, "vuelve"), now))}`;
          break;
        }
        const rw = reservaDe(w.id);
        if (sus === "claude" && rw !== null && rw !== undefined && libre <= rw) {
          const lider = w.id === "7d" && verdad(resLider) && resLider >= (reservaDe("7d") || 0);
          cand.descartado_por = lider
            ? `reserva del líder: a Claude ${nombreVentana(w.id)} le queda ${pyRound(libre * 100)} % y se guarda el ${pyRound(rw * 100)} % para la conversación (reserva_lider)`
            : `reserva comprometida: Claude ${nombreVentana(w.id)} al ${pyRound(w.usado * 100)} % (modelos.json guarda el ${pyRound(rw * 100)} %)`;
          break;
        }
        const llena = sus !== "claude" ? ventanaLlena(cfg, sus, gid, w) : (rw === null || rw === undefined) && libre < cfg.llena;
        if (llena && sus !== "claude" && verdad(get(grupos.get(gid) || {}, "agotado"))) {
          cand.descartado_por = `ventana ${w.id} llena: ${sus === "openai" ? "codex" : "agy (429)"} dijo que se acabó el cupo, vuelve en ${humano(horasHasta(get(w, "vuelve"), now))}`;
          break;
        }
        if (llena) {
          cand.descartado_por = `ventana ${w.id} llena (${pyRound(w.usado * 100)} % usado)${verdad(get(w, "vuelve")) ? `, vuelve en ${humano(horasHasta(w.vuelve, now))}` : ""}`;
          break;
        }
      }
    }
    const util = utilDe(Number(calidad), minimo);
    const us: number[] = [];
    let rt: Obj | null = null;
    let urg7: number | null = null;
    for (const w of vents) {
      if (sus === "claude" && w.id === "5h" && agyClaudeOk) continue;
      let topeW = topeH;
      if (w.id === "7d" && !sinRitmo) {
        rt = ritmoVentana(w, now, plan, sus === "claude" ? resLider || 0.0 : 0.0);
        if (rt && rt.h_activas < rt.h) topeW = topeH === null ? rt.h_activas : Math.min(topeH, rt.h_activas);
      }
      const uu = urgenciaVentana(w, now, topeW);
      if (uu !== null) {
        us.push(uu);
        if (w.id === "7d") urg7 = uu;
      }
    }
    const urg = us.length ? Math.min(...us) : 0.0;
    cand.urgencia = pyRound(urg, 3);
    cand.carga = get(carga, cand.clave, 0);
    const multCosto = sinRitmo ? 1.0 : perfil.costo;
    let pts = pyRound(util + cfg.peso_urgencia * urg - multCosto * cfg.peso_costo * get(cfg.costo, fam, 0.3) - cfg.peso_carga * cand.carga, 2);
    if (rt) {
      let [pR, sR] = puntosRitmo(rt, urg7 || 0.0, cfg.peso_ritmo, cfg.peso_bono_ritmo, perfil.ritmo);
      pts += pR;
      if (sus === "claude" && perfil.sesgo) {
        pR -= perfil.sesgo * (1 - Math.max(sR, urg7 || 0.0));
        pts -= perfil.sesgo * (1 - Math.max(sR, urg7 || 0.0));
      }
      cand.ritmo = rt;
      cand.ritmo_pts = pyRound(pR, 2);
    } else if (sus === "claude" && perfil.sesgo && !sinRitmo) {
      pts -= perfil.sesgo;
      cand.ritmo_pts = -perfil.sesgo;
    }
    cand.puntaje = pyRound(pts, 2);
    conFloat(cand, "urgencia", "puntaje", "ritmo_pts");
    out.push(cand);
  };
  for (const c of FAMILIAS) for (const cs of c[3] === "claude" ? claudes : c[3] === "openai" ? openais : googles) hacer(c, cs);
  for (const loc of cfg.locales as Obj[]) {
    let [calidad, origen] = calidadOrigen(cfg, loc.id, false);
    if (origen === "estimada") calidad = viejaAAa(35);
    const cand: Obj = {
      estimada: origen === "estimada", origen, modelo: loc.id, effort: null, nombre: get(loc, "nombre", loc.id), familia: "local",
      calidad, cupo_libre: 1.0, vuelve: null, puntaje: null, descartado_por: null,
      aviso: null, grupo: "local", urgencia: 0.0, cuenta: null, proveedor: "local", clave: "local",
    };
    if (calidad < minimo) {
      cand.descartado_por = `calidad ${fn(calidad)} menor que la ${fn(minimo)} que pide ${tipo}`;
      cand.duro = true;
    } else if (excluidoPor(loc.id, cfg.excluir, "local")) {
      cand.descartado_por = `excluido en modelos.json (excluir: ${excluidoPor(loc.id, cfg.excluir, "local")})`;
      cand.duro = true;
    }
    cand.puntaje = pyRound(utilDe(Number(calidad), minimo) + 0.5 * cfg.peso_urgencia, 2);
    conFloat(cand, "cupo_libre", "urgencia", "puntaje");
    out.push(cand);
  }
  const agot = ofertasDsh.length ? leerAgotados(stateDir(), now) : {};
  const enfr = ofertasDsh.length ? leerEnfriados(stateDir(), now) : {};
  for (const [mid, nombre, prov, gratis] of ofertasDsh) {
    let [calidad, origen] = calidadOrigen(cfg, mid);
    const estimada = origen === "estimada";
    const esGo = prov === "opencode-go";
    const gid: string = esGo ? mid.toLowerCase() : DSH_GRUPOS[prov];
    const mapaEfx = origen === "artificial-analysis" ? mapaEfforts(cfg, mid, mid) : mapaEf({}, null);
    const hayMapa = Object.keys(mapaEfx).length > 0;
    const calidadMejor = calidad;
    let notaEffort: string | null = null;
    let eDsh: string | null = null;
    if (hayMapa) {
      [eDsh, notaEffort] = effortPermitido(cfg, mid, "dsh", eTipo, EFFORTS_AA.filter((e) => e in mapaEfx));
      calidad = calidadEnEffort(mapaEfx, eDsh || eTipo, calidad);
    }
    const cand: Obj = {
      calidad_mejor: calidadMejor, nota_effort: notaEffort, calidad_por_effort: mapaEfx, effort_calidad: hayMapa ? eDsh || eTipo : null, estimada, origen, modelo: mid, effort: null, nombre, familia: "dsh", calidad,
      cupo_libre: gratis ? 1.0 : null, vuelve: null, puntaje: null, descartado_por: null,
      aviso: gratis || esGo ? null : "se paga con tu key de DeepSeek (no se sabe el precio)", grupo: gid, urgencia: 0.0,
      cuenta: null, proveedor: "dsh", clave: gid, gratis, ...(esGo ? { plan_go: cfg.opencode_plan } : {}),
    };
    const x = excluidoPor(mid, cfg.excluir, mid.startsWith("opencode:") ? "opencode" : "dsh");
    if (hayMapa && eDsh === null) {
      cand.descartado_por = `excluido en modelos.json (${notaEffort})`;
      cand.duro = true;
    } else if (calidad < minimo) {
      cand.descartado_por = `calidad ${fn(calidad)} menor que la ${fn(minimo)} que pide ${tipo}`;
      cand.duro = cand.duro_calidad = true;
    } else if (x) {
      cand.descartado_por = `excluido en modelos.json (excluir: ${x})`;
      cand.duro = true;
    } else if (mid.toLowerCase() in enfr) {
      cand.descartado_por = `cortó por límite de uso (pa salió 97): enfriándose hasta ${enfr[mid.toLowerCase()]}`;
      cand.vuelve = enfr[mid.toLowerCase()];
    } else if (gid in agot) {
      cand.descartado_por = `dijo sin cupo (429): vuelve ${agot[gid]}`;
      cand.vuelve = agot[gid];
    }
    const util = utilDe(Number(calidad), minimo);
    cand.carga = get(carga, gid, 0);
    const costo = -cfg.peso_costo * (esGo ? get(cfg.costo, "opencode-go", COSTO_GO) : get(cfg.costo, "dsh-pago", COSTO_DSH_PAGO));
    cand.puntaje = pyRound(util + (gratis ? 0.5 * cfg.peso_urgencia : costo) - cfg.peso_carga * cand.carga, 2);
    conFloat(cand, "urgencia", "puntaje");
    if (gratis) conFloat(cand, "cupo_libre");
    out.push(cand);
  }
  return [out, minimo, minimoFam];
}

/** El candidato limpio para el JSON (con sus marcas de float). */
function limpio(c: Obj): Obj {
  const o: Obj = {};
  for (const k of ["modelo", "effort", "nombre", "calidad", "cupo_libre", "vuelve", "puntaje", "descartado_por", "aviso", "grupo", "carga", "cuenta", "estimada", "ritmo", "ritmo_pts", "calidad_mejor", "calidad_por_effort", "effort_calidad"]) if (k in c) o[k] = c[k];
  return copiarMarcas(c, o);
}

type Eleccion = Obj & { _reservar?: string };

function elegir(tipo0: string, cfg: Obj, cupos: Obj, now: Date, mismoProveedor: string | null = null, soloCuenta: string | null = null, contra = false): Eleccion {
  const tipo = (tipo0 || "").toLowerCase().replace(/ñ/g, "n");
  const avisos: string[] = [];
  if (!(tipo in cfg.minimo_por_tipo)) avisos.push(`tipo "${tipo}" desconocido: pido calidad de Sonnet`);
  if (cfg.reparto === "fijo") {
    const w = get(cfg.workers, tipo) || get(cfg.workers, "default") || { modelo: "claude-sonnet-5-5", effort: "high" };
    let ef = get(w, "effort");
    if (ef === "max" && !pyStr(get(w, "modelo", "")).toLowerCase().includes("haiku")) ef = "xhigh";
    return {
      version: VERSION, modelo: get(w, "modelo", "claude-sonnet-5-5"), effort: ef, cuenta: null,
      motivo: `El reparto está en "fijo" en modelos.json: uso el modelo que ese archivo asigna al tipo ${tipo}.`,
      candidatos: [], avisos: [...avisos, ...avisosDeUso(cupos, now)], tipo,
      todo_lleno: false, sin_cupo: cfg.sin_cupo, vuelve_antes: null,
    };
  }
  let [cands, minimo, minimoFam] = armarCandidatos(tipo, cfg, cupos, now);
  let relajado = false;
  if (!cands.some((c) => !c.duro)) {
    for (const c of cands) {
      if (c.duro_calidad) {
        c.descartado_por = null;
        delete c.duro;
        c.relajado = true;
        relajado = true;
      }
    }
  }
  if (soloCuenta) cands = cands.filter((c) => get(c, "cuenta") === soloCuenta);
  let vivos = cands.filter((c) => !c.descartado_por);
  let todoLleno = false;
  let banda: string | null = null;
  let pool: Obj[];
  if (vivos.length && mismoProveedor) {
    const mp = vivos.filter((c) => get(c, "proveedor") === (mismoProveedor === "chatgpt" ? "openai" : mismoProveedor));
    if (mp.length) vivos = mp;
  }
  if (vivos.length) {
    pool = vivos;
    let pref: string | null = null;
    for (const [p, v] of Object.entries(cfg.preferido_por_tipo as Obj)) {
      if (fnmatchcase(tipo, p)) {
        pref = v;
        break;
      }
    }
    if (cfg._relajado) pref = null;
    if (pref !== null && typeof pref === "string" && pref in cfg.calidad) {
      const ePref = get(cfg.effort_por_tipo, tipo, "high");
      const q0 = calidadEnEffort(mapaEfforts(cfg, pref), ePref === "max" ? "xhigh" : ePref, cfg.calidad[pref]);
      const en = vivos.filter((c) => q0 <= c.calidad && c.calidad <= q0 + MARGEN);
      if (en.length && en.length < vivos.length) [pool, banda] = [en, pref];
    }
  } else {
    pool = cands.filter((c) => !c.duro);
    todoLleno = true;
  }
  avisos.push(...avisosDeUso(cupos, now));
  const extra: Obj = { todo_lleno: todoLleno, sin_cupo: cfg.sin_cupo, vuelve_antes: null };
  if (!pool.length) {
    return { version: VERSION, modelo: null, effort: null, motivo: `Ningún modelo sirve para el tipo ${tipo} con la configuración actual.`, candidatos: cands.map(limpio), avisos, tipo, ...extra };
  }
  let gana: Obj;
  if (todoLleno) {
    gana = minPor(pool, (c) => [c.familia !== "local" ? get(cfg.costo, c.familia, 0.3) : 0.0, verdad(c.vuelve) ? horasHasta(c.vuelve, now) : 1e9, -c.calidad]);
    const vs = pool.filter((c) => parseIso(get(c, "vuelve"))).map((c) => parseIso(c.vuelve)!);
    extra.vuelve_antes = vs.length ? iso(new Date(Math.min(...vs.map((d) => d.getTime())))) : null;
  } else {
    gana = maxPor(pool, (c) => [c.puntaje, c.calidad]);
    const g0 = gana;
    gana = maxPor(pool.filter((c) => c.modelo === g0.modelo), (c) => [c.cupo_libre !== null ? c.cupo_libre : -1.0, !suf(get(c, "cuenta")), c.puntaje]);
  }
  let motivo = motivoDe(gana, pool, tipo, minimo, minimoFam, todoLleno, now, cands);
  if (gana.nota_effort) motivo += ` Effort ${gana.effort || gana.modelo.split("-").pop()}: ${gana.nota_effort} (calidad ${fn(gana.calidad)}).`;
  if (relajado && gana.relajado) motivo += ` Ningún modelo llega a la calidad ${fn(minimo)} que pide ${tipo}: uso el mejor que hay (calidad ${fn(gana.calidad)}, ajustable con "calidad" en modelos.json).`;
  if (banda) motivo += ` Para ${tipo} se prefiere la calidad de ${banda}: los modelos más caros o menos parejos sólo entran si no queda cupo de esa banda.`;
  const ritmoInfo = !contra ? resumenRitmo(cfg, cupos, now) : [];
  if (!contra && !todoLleno) motivo += cambioPorRitmo(tipo, cfg, cupos, now, gana, cands, mismoProveedor, soloCuenta);
  for (const c of cands) if (c.aviso && !c.descartado_por) avisos.push(`${c.modelo}: ${c.aviso}`);
  const r: Eleccion = {
    version: VERSION, modelo: gana.modelo, effort: gana.effort, cuenta: get(gana, "cuenta"), motivo,
    candidatos: ordenarPor(cands, (c) => [c.descartado_por !== null, -(c.puntaje || 0)]).map(limpio),
    avisos, tipo, perfil: cfg.perfil, ritmo: ritmoInfo, ...extra,
  };
  if (E.REPARTO_RESERVAR === "1" && !contra) Object.defineProperty(r, "_reservar", { value: get(gana, "clave", gana.grupo), enumerable: false });
  return r;
}

function resumenRitmo(cfg: Obj, cupos: Obj, now: Date): Obj[] {
  const plan = planDe(cfg, now);
  const res = reservaLiderDe(cfg);
  const out: Obj[] = [];
  for (const s of get(cupos, "suscripciones", [])) {
    const filas: [unknown, unknown, Obj[]][] =
      provDe(s) !== "google" ? [[get(s, "nombre", get(s, "id")), null, get(s, "ventanas", [])]] : (get(s, "grupos", []) || []).map((g: Obj) => [get(s, "nombre", get(s, "id")), get(g, "id"), get(g, "ventanas", [])]);
    for (const [nombre, gid, vs] of filas) {
      for (const w of vs) {
        const r = provDe(s) === "claude" ? res : 0.0;
        const rt = ritmoVentana(w, now, plan, r);
        if (rt) {
          const fila = copiarMarcas(rt, { ...rt, suscripcion: get(s, "id"), cuenta: get(s, "cuenta"), proveedor: provDe(s), nombre, grupo: gid, ventana: "7d", reserva_lider: r || null });
          if (r) marcarSi(fila, "reserva_lider", provDe(s) === "claude" ? reservaLiderFloat(cfg) : true);
          out.push(fila);
        }
      }
    }
  }
  return out;
}

const veces = (x: number) => fmtF(x, 1).replace(".", ",") + "×";

function cambioPorRitmo(tipo: string, cfg: Obj, cupos: Obj, now: Date, gana: Obj, cands: Obj[], mismoProveedor: string | null, soloCuenta: string | null): string {
  const plan = planDe(cfg, now);
  if (cfg.perfil === "equilibrado" && !plan.ausente.length && !plan.hoy && !cands.some((c) => verdad(c.ritmo_pts))) return "";
  const base: Obj = { ...cfg, perfil: "equilibrado", _sin_ritmo: true, plan: { ausente: [], hoy: null, actualizado: null } };
  copiarMarcas(cfg, base);
  const r0 = elegir(tipo, base, cupos, now, mismoProveedor, soloCuenta, true);
  if (!r0.modelo || (r0.modelo === gana.modelo && get(r0, "cuenta") === get(gana, "cuenta"))) return "";
  const antes = (r0.candidatos as Obj[]).find((c) => c.modelo === r0.modelo && get(c, "cuenta") === get(r0, "cuenta")) ?? {};
  const causas: string[] = [];
  const rtc = cands.find((c) => get(c, "proveedor") === "claude" && c.ritmo && !c.descartado_por)?.ritmo || cands.find((c) => get(c, "proveedor") === "claude" && c.ritmo)?.ritmo || null;
  if (plan.hoy) causas.push(`el plan dice ${plan.hoy === "gastar" ? "gastar" : "ahorrar"} hoy`);
  else if (rtc && rtc.ratio > 1.1) causas.push(`Claude va ${veces(rtc.ratio)} por encima del ritmo semanal`);
  else if (rtc && rtc.ratio < 0.9) causas.push(`Claude va ${veces(rtc.ratio)} del ritmo semanal (sobra cupo antes del reinicio)`);
  if (plan.ausente.length && rtc && rtc.h_activas < rtc.h) causas.push(`hay días ausentes antes del reinicio (quedan ${humano(rtc.h_activas)} de trabajo)`);
  if (cfg.perfil !== "equilibrado") causas.push(`perfil ${cfg.perfil}`);
  if (!causas.length) causas.push("el ritmo semanal");
  const gratis = (gana.gratis || get(gana, "proveedor") === "local") && !gana.nombre.includes("gratis") ? " gratis" : "";
  const txt = causas.join(", ");
  return ` ${txt[0]!.toUpperCase() + txt.slice(1)}: uso ${gana.nombre}${gratis} en lugar de ${get(antes, "nombre", r0.modelo)}.`;
}

function avisosDeUso(cupos: Obj, now: Date): string[] {
  const out: string[] = [];
  for (const s of get(cupos, "suscripciones", [])) {
    const filas: [unknown, Obj[]][] = provDe(s) !== "google" ? [[get(s, "nombre", get(s, "id")), get(s, "ventanas", [])]] : (get(s, "grupos", []) || []).map((g: Obj) => [get(g, "nombre", get(g, "id")), get(g, "ventanas", [])]);
    for (const [nombre, vs] of filas) {
      for (const w of vs) {
        if (get(w, "usado") !== null && w.usado >= AVISO_USO) {
          const h = horasHasta(get(w, "vuelve"), now);
          out.push(`${pyStr(nombre)} ${nombreVentana(w.id)} al ${pct(w.usado)}${h !== null ? `, vuelve en ${humano(h)}` : ""}`);
        }
      }
    }
  }
  return out;
}

function motivoDe(gana: Obj, pool: Obj[], tipo: string, minimo: number, _minimoFam: unknown, todoLleno: boolean, now: Date, _cands: Obj[]): string {
  const pide = `${tipo} pide calidad ${fn(minimo)} o más`;
  if (todoLleno) {
    return `Todos los cupos que sirven para ${tipo} están llenos o en reserva; el más barato que alcanza la calidad (${tipo} pide ${fn(minimo)}) es ${gana.nombre}, que ${verdad(gana.vuelve) ? `vuelve en ${humano(horasHasta(gana.vuelve, now))}` : "no dice cuándo vuelve"}. Va a toparse con el límite.`;
  }
  const partes = [`${gana.nombre} alcanza para ${tipo} (calidad ${fn(gana.calidad)}; ${pide})`];
  if (get(gana, "proveedor") === "dsh") {
    partes.push(gana.gratis ? "Es gratis y no gasta ningún cupo" : gana.plan_go ? `Va por tu plan ${gana.plan_go === "go-plus" ? "Go Plus" : "Go"} de OpenCode (cupo propio por modelo, costo marginal ~0)` : "Se paga con tu key de DeepSeek");
  } else if (gana.cupo_libre !== null) {
    const h = horasHasta(gana.vuelve, now);
    partes.push(`Le queda ${pct(gana.cupo_libre)} libre y vuelve en ${humano(h)}`);
  } else partes.push("No hay dato de su cupo, así que no se lo puede descartar");
  const otros = pool.filter((c) => c !== gana);
  if (otros.length) {
    const sig = maxPor(otros, (c) => [c.puntaje, c.calidad]);
    partes.push(`Le gana a ${sig.nombre} (${fmtF(gana.puntaje, 1)} contra ${fmtF(sig.puntaje, 1)} puntos)`);
  }
  if (gana.grupo === "claude-gpt" && (gana.familia === "opus" || gana.familia === "sonnet")) partes.push("El Claude de Google se gasta antes que la ventana de 5 h del Claude oficial");
  return partes.join(". ") + ".";
}

// --- explicación en castellano llano -----------------------------------------------------------------
function explicar(r: Obj, now: Date, cupos: Obj, cfg: Obj): string {
  const L = [`Tipo de tarea: ${pyStr(get(r, "tipo"))}`];
  for (const a of get(r, "avisos", [])) L.push(`Ojo: ${a}.`);
  const res = cfg.reserva;
  let resT: string;
  if (res === null || res === undefined) resT = "ninguna";
  else if (esDict(res)) resT = Object.entries(res).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${nombreVentana(k)} ${pct(v)}`).join(", ");
  else resT = pct(res);
  L.push(`Reserva del Claude oficial: ${resT}. Excluidos: ${cfg.excluir.join(", ") || "ninguno"}. Si no hay cupo: ${cfg.sin_cupo}${cfg.sin_cupo_de !== "gemini.sin_claude" ? "" : " (de gemini.sin_claude)"}.`);
  const plan = planDe(cfg, now);
  L.push(`Perfil: ${cfg.perfil}. Reserva para el líder (semanal de Claude): ${reservaLiderDe(cfg) ? pct(reservaLiderDe(cfg)) : "ninguna"}. Plan: ausente ${plan.ausente.join(", ") || "ningún día"}; hoy ${plan.hoy === "gastar" ? "gastar" : plan.hoy === "ahorrar" ? "ahorrar" : "sin pista"}.`);
  for (const rt of get(r, "ritmo", [])) L.push(`  Ritmo ${pyStr(rt.nombre) + (verdad(get(rt, "grupo")) ? ` – ${rt.grupo}` : "")} semanal: usado ${pct(rt.usado)}, esperado ${pct(rt.esperado)} -> ${veces(rt.ratio)}`);
  const reglas = (cfg.uso_por_modelo as [string, string][]).filter(([, v]) => v !== "libre");
  if (reglas.length) {
    L.push(`Uso por modelo: ${reglas.map(([k, v]) => `${k} → ${v.replace(/_/g, " ")}`).join("; ")}. Tareas poco importantes: ${cfg.tipos_poco_importantes.join(", ") || "ninguna"}. Tareas finales: ${cfg.tipos_finales.join(", ") || "ninguna"}.`);
  }
  if (cfg.tipos_finales.includes(get(r, "tipo"))) L.push("Esta tarea cuenta como final: los modelos de uso solo final (Argon) pueden entrar.");
  L.push("");
  L.push("Cupos que mira:");
  for (const s of get(cupos, "suscripciones", [])) {
    if (provDe(s) !== "google") L.push(`  ${s.nombre}: ${ventanasTxt(get(s, "ventanas", []), now)}`);
    else {
      for (const g of get(s, "grupos", []) || []) {
        const ex = verdad(get(g, "hasta")) ? `  (hasta el ${g.hasta})` : "";
        L.push(`  ${s.nombre} – ${g.nombre}: ${ventanasTxt(get(g, "ventanas", []), now)}${ex}`);
      }
      for (const m of get(s, "modelos", []) || []) L.push(`  ${s.nombre} – ${get(m, "nombre", get(m, "id"))}: ${ventanasTxt(get(m, "ventanas", []), now)}`);
    }
  }
  L.push("");
  L.push("Candidatos (de mejor a peor puntaje):");
  for (const c of get(r, "candidatos", [])) {
    const nom = c.modelo + (verdad(get(c, "effort")) ? " " + c.effort : "");
    if (c.descartado_por) L.push(`  ✗ ${nom} — descartado: ${c.descartado_por}`);
    else {
      const cupo = c.cupo_libre !== null ? `cupo libre ${pct(c.cupo_libre)}` : "sin dato de cupo";
      L.push(`  ✓ ${nom} — calidad ${pyStr(c.calidad, esFloat(c, "calidad"))}, ${cupo}, ${fmtF(c.puntaje, 1)} puntos${verdad(get(c, "aviso")) ? `  [${c.aviso}]` : ""}`);
    }
  }
  L.push("");
  if (verdad(get(r, "modelo"))) L.push(`Elijo: ${r.modelo}${verdad(get(r, "effort")) ? ` (effort ${r.effort})` : ""}`);
  else L.push("No elijo ninguno.");
  L.push(r.motivo);
  if (verdad(get(r, "todo_lleno")) && verdad(get(r, "modelo"))) {
    const t: Obj = {
      otro: 'Con sin_cupo "otro", pa lo lanza igual y, si choca el límite sin haber hecho nada, lo marca agotado y relanza con el siguiente.',
      esperar: `Con sin_cupo "esperar", pa no lo lanza: con --async hace cola hasta que vuelva un cupo${verdad(get(r, "vuelve_antes")) ? ` (el primero vuelve en ${humano(horasHasta(r.vuelve_antes, now))})` : ""}.`,
      fallar: 'Con sin_cupo "fallar", pa no lo lanza (sale 96).',
    };
    L.push(t[get(r, "sin_cupo", "otro")]);
  }
  return L.join("\n");
}

function ventanasTxt(vs: Obj[], now: Date): string {
  if (!verdad(vs)) return "sin ventanas";
  const out: string[] = [];
  for (const w of vs) {
    if (get(w, "usado") === null) out.push(`${w.id} sin dato`);
    else {
      const h = horasHasta(get(w, "vuelve"), now);
      out.push(`${w.id} ${pct(1 - w.usado)} libre${h !== null ? ` (vuelve en ${humano(h)})` : ""}`);
    }
  }
  return out.join(", ");
}

// --- resolver un id de modelo ------------------------------------------------------------------------
/** Cómo lanzar un id de reparto. {motor: claude|agy|codex|ollama|dsh|opencode, modelo, effort?}. null si no se reconoce. */
export function resolver(mid: string): Obj | null {
  if (mid.startsWith("agy:")) return { motor: "agy", modelo: mid.slice(4), id: mid, nota: `agy --model ${mid.slice(4)}` };
  if (mid.startsWith("gemini-")) return { motor: "agy", modelo: mid, id: mid, nota: `agy --model ${mid}` };
  let m = /^codex:(.+)-(low|medium|high)$/s.exec(mid);
  if (m) return { motor: "codex", modelo: m[1], effort: m[2], id: mid, nota: `codex exec -m ${m[1]} -c model_reasoning_effort=${m[2]}` };
  if (mid.startsWith("ollama:")) return { motor: "ollama", modelo: mid.slice(7), id: mid };
  m = /^dsh:(ollama|opencode|deepseek)\/(.+)$/s.exec(mid);
  if (m) return { motor: "dsh", modelo: m[2], proveedor: m[1], id: mid, nota: `pa -m ${mid} (motor/dsh/correr.mjs)` };
  m = /^opencode:([A-Za-z0-9][A-Za-z0-9._-]*)\/(.+)$/s.exec(mid);
  if (m) return { motor: "opencode", modelo: m[2], proveedor: m[1], id: mid, nota: `pa -m ${mid} (motor/opencode/correr.mjs)` };
  if (mid.startsWith("claude-")) return { motor: "claude", modelo: mid, id: mid };
  return null;
}

function cuentaPara(mid: string, cupos: Obj, _now: Date): Obj | null {
  const r = resolver(mid);
  if (r && r.motor === "codex") return { cuenta: "chatgpt", proveedor: "chatgpt", cupo_libre: null, agotada: false };
  if (!r || (r.motor !== "claude" && r.motor !== "agy")) return null;
  const prov = r.motor === "claude" ? "claude" : "google";
  const gid = prov === "claude" ? null : grupoDeModelo(mid);
  let mejor: [unknown[], unknown, number, boolean, boolean] | null = null;
  for (const s of get(cupos, "suscripciones", [])) {
    if (provDe(s) !== prov) continue;
    let vs: Obj[];
    let agot: boolean;
    if (prov === "claude") [vs, agot] = [get(s, "ventanas", []) || [], verdad(get(s, "agotado"))];
    else {
      const g = ((get(s, "grupos", []) || []) as Obj[]).find((g) => get(g, "id") === gid) ?? {};
      [vs, agot] = [get(g, "ventanas", []) || [], verdad(get(g, "agotado"))];
    }
    const conUso = vs.filter((w) => get(w, "usado") !== null);
    const us = conUso.map((w) => w.usado as number);
    const maxW = conUso.length ? maxPor(conUso, (w) => [w.usado]) : null;
    const libre = !us.length ? -1.0 : 1 - Math.max(...us);
    const k = [!agot, libre, !suf(cuentaDe(s))];
    const kk = (a: unknown[], b: unknown[]) => {
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return (a[i] as number) > (b[i] as number);
      return false;
    };
    if (mejor === null || kk(k, mejor[0])) mejor = [k, cuentaDe(s), libre, agot, maxW ? esFloat(maxW, "usado") : true];
  }
  if (!mejor) return { cuenta: prov, proveedor: prov, cupo_libre: null, agotada: false };
  const o: Obj = { cuenta: mejor[1], proveedor: prov, cupo_libre: mejor[2] < 0 ? null : pyRound(mejor[2], 4), agotada: mejor[3] };
  return marcarSi(o, "cupo_libre", mejor[4]);
}

// --- main --------------------------------------------------------------------------------------------
function textoCupos(d: Obj, now: Date): string {
  const L = [`Cupos leídos ${pyStr(get(d, "leido", "?"))}`];
  for (const s of get(d, "suscripciones", [])) {
    if (provDe(s) !== "google" && provDe(s) !== "openai" && !verdad(get(s, "grupos"))) {
      L.push(`${s.nombre}: ${ventanasTxt(get(s, "ventanas", []), now)}${verdad(get(s, "nota")) ? `  (${s.nota})` : ""}`);
    } else {
      L.push(`${s.nombre}:`);
      for (const g of get(s, "grupos", []) || []) L.push(`  ${g.nombre}: ${ventanasTxt(get(g, "ventanas", []), now)}${verdad(get(g, "hasta")) ? `  (hasta el ${g.hasta})` : ""}`);
    }
  }
  return L.join("\n");
}

function proveedorDe(c: Obj): string {
  if (c.proveedor !== "dsh") return c.proveedor;
  return c.modelo.startsWith("opencode:") ? "opencode" : c.modelo.split(":").slice(1).join(":").split("/")[0];
}

function extrasTabla(cfg: Obj, c: Obj): Obj {
  const ex = get(c, "origen") === "artificial-analysis" ? aaBuscarExtras(cfg.aa, c.modelo) : {};
  const out: Obj = {};
  for (const [campo, clave] of [["coding_por_effort", "coding"], ["agentic_por_effort", "agentic"], ["costo_por_effort", "cost"], ["tokens_por_effort", "tokens"], ["tiempo_por_effort", "time"]] as [string, string][]) {
    const d: Obj = {};
    for (const [e, v] of Object.entries(ex)) if (clave in v) d[e] = clave === "coding" || clave === "agentic" ? _n(v[clave]) : pyRound(v[clave], 4);
    if (clave !== "coding" && clave !== "agentic") conFloat(d, ...Object.keys(d));
    if (Object.keys(d).length) out[campo] = d;
  }
  if (Object.keys(ex).length) {
    const f: Obj = {};
    for (const [e, v] of Object.entries(ex)) f[e] = !v.suplemento ? "api" : v.aproximado ? "suplemento~" : "suplemento";
    out.fuente_por_effort = f;
  }
  return out;
}

function effortsEstimadosTabla(c: Obj): Obj {
  const medido: MapaEf = get(c, "calidad_por_effort") || {};
  const est = ((get(c, "efforts_posibles") || []) as string[]).filter((e) => !(e in medido));
  if (!Object.keys(medido).length || !est.length) return {};
  const q: Obj = {};
  for (const e of est) q[e] = calidadEnEffort(medido, e, c.calidad_mejor);
  return { efforts_estimados: est, calidad_estimada_por_effort: q };
}

function tabla(cfg: Obj, cupos: Obj, now: Date): Obj[] {
  const [cands] = armarCandidatos("lectura", cfg, cupos, now, EFFORT_TABLA);
  const out: Obj[] = [];
  for (const c of cands) {
    let fam = c.familia;
    if (fam === "dsh") fam = c.modelo.startsWith("opencode:") ? "opencode" : "dsh";
    const x = excluidoPor(c.modelo, cfg.excluir, fam);
    const gratis = c.proveedor === "local" || verdad(get(c, "gratis"));
    const fila: Obj = {
      id: c.modelo, nombre: c.nombre, proveedor: proveedorDe(c), cuenta: get(c, "cuenta"),
      grupo: c.grupo, familia: c.familia, familia_excluir: fam, calidad: c.calidad, effort_usado: get(c, "effort_calidad"), calidad_por_effort: get(c, "calidad_por_effort") || {}, estimada: verdad(get(c, "estimada")),
      ...effortsEstimadosTabla(c),
      ...extrasTabla(cfg, c),
      origen: get(c, "origen") || (verdad(get(c, "estimada")) ? "estimada" : "defecto"),
      aa_fecha: get(c, "origen") === "artificial-analysis" && cfg.aa ? cfg.aa.fecha : null,
      gratis, ...(verdad(get(c, "plan_go")) ? { plan: c.plan_go, go: goTopes(cfg, c.modelo) } : {}),
      cupo_libre: c.cupo_libre, vuelve: c.vuelve, ventanas: get(c, "ventanas", []),
      urgencia: get(c, "urgencia", 0.0), permitido: !x, excluido_por: x,
      agotado: verdad(c.descartado_por) && ["dijo sin cupo", "Claude dijo", "ventana"].some((p) => c.descartado_por.startsWith(p)),
    };
    conFloat(fila, "urgencia");
    marcarSi(fila, "cupo_libre", esFloat(c, "cupo_libre"));
    out.push(fila);
  }
  return out;
}

function textoTabla(filas: Obj[], now: Date): string {
  const L = [`${"modelo".padEnd(46)} ${"proveedor".padEnd(9)} ${"int.".padStart(5)}  ${"esfuerzo".padEnd(17)} ${"costo".padEnd(6)} ${"cupo libre".padEnd(10)} permitido`];
  for (const f of filas) {
    let cupo = f.cupo_libre === null ? "-" : pct(f.cupo_libre);
    if (verdad(f.vuelve)) cupo += ` (vuelve en ${humano(horasHasta(f.vuelve, now))})`;
    const ef = get(f, "effort_usado");
    const efTxt = !verdad(ef) ? "-" : `${ef} ${((get(f, "efforts_estimados") || []) as string[]).includes(ef) ? "estimado" : "medido"}`;
    const id = f.id + (suf(get(f, "cuenta")) ? " · " + f.cuenta : "");
    L.push(`${id.padEnd(46)} ${pyStr(f.proveedor).padEnd(9)} ${fmtF(f.calidad, 1).padStart(5)}${f.estimada ? "~" : " "}  ${efTxt.padEnd(17)} ${(f.gratis ? "gratis" : get(f, "plan") ? "Go" : "pago").padEnd(6)} ${cupo.padEnd(10)} ${f.permitido ? "sí" : `no (${f.excluido_por})`}`);
  }
  return L.join("\n");
}

const RESUMEN_MAX = 24;
const RESUMEN_EFFORTS: [string, string][] = [["low", "low"], ["medium", "med"], ["high", "high"], ["xhigh", "xhigh"], ["max", "max"]];

function paraQueSirve(f: Obj): string {
  const [fam, mid] = [f.familia, f.id];
  const porFamilia: Obj = {
    opus: "bases críticas, bug sin pista, o tras un fallo de uno menor",
    sonnet: "pedido ambiguo, varias partes, o si Haiku ya falló",
    haiku: "default si la tarea se describe con precisión (archivos, qué cambiar, listo, chequeo): lectura, mecánico, código e interfaz chica",
    argon: "diseño y segunda opinión; contexto largo (1M)",
    flash: "lectura y mecánico con chequeo; cupo de Google",
    "gpt-oss": "mecánico simple; sigue poco el contrato",
    astra: "tareas grandes (ChatGPT); pa todavía no lo lanza", sol: "código medio (ChatGPT); pa todavía no lo lanza",
    luna: "tareas chicas (ChatGPT); pa todavía no lo lanza",
  };
  if (fam in porFamilia) return porFamilia[fam];
  if (f.proveedor === "local" || mid.toLowerCase().startsWith("ollama:") || mid.toLowerCase().startsWith("dsh:ollama")) return "mecánico y lectura; lento y usa la GPU del dueño";
  if (f.calidad >= 45) return "código acotado con chequeo; no gasta cupo de pago";
  if (f.calidad >= 38) return "mecánico, lectura y código chico con chequeo";
  return "sólo mecánico con chequeo determinista";
}

function resumen(cfg: Obj, cupos: Obj, now: Date): Obj[] {
  const porId = new Map<string, Obj>();
  for (const f of tabla(cfg, cupos, now)) {
    if (!f.permitido) continue;
    const v = porId.get(f.id);
    if (v === undefined || (f.cupo_libre !== null ? f.cupo_libre : 2) > (v.cupo_libre !== null ? v.cupo_libre : 2)) porId.set(f.id, f);
  }
  const out: Obj[] = [];
  for (const f of porId.values()) {
    const intel: Record<string, [number, boolean]> = {};
    for (const [e, v] of Object.entries((get(f, "calidad_por_effort") || {}) as Obj)) intel[e] = [v, false];
    for (const [e, v] of Object.entries((get(f, "calidad_estimada_por_effort") || {}) as Obj)) if (!(e in intel)) intel[e] = [v, true];
    let costo: number | null;
    let costoF = true;
    if (f.gratis) costo = null;
    else if (verdad(get(f, "plan"))) {
      costo = get(cfg.costo, "opencode-go", COSTO_GO);
      if ("opencode-go" in cfg.costo) costoF = esFloat(cfg.costo, "opencode-go");
    } else if (f.familia in cfg.costo) {
      costo = cfg.costo[f.familia];
      costoF = esFloat(cfg.costo, f.familia);
    } else costo = f.familia === "dsh" ? COSTO_DSH_PAGO : 0.3;
    const fila: Obj = {
      id: f.id, proveedor: f.proveedor, familia: f.familia, calidad: f.calidad, estimada: f.estimada,
      effort_usado: get(f, "effort_usado"), intel, costo, gratis: f.gratis, plan: get(f, "plan"),
      cupo_libre: f.cupo_libre, vuelve: f.vuelve, agotado: f.agotado, sirve_para: paraQueSirve(f),
    };
    marcarSi(fila, "costo", costoF);
    marcarSi(fila, "cupo_libre", esFloat(f, "cupo_libre"));
    out.push(fila);
  }
  return ordenarPor(out, (r) => [-r.calidad, r.id]);
}

function textoResumen(filas: Obj[], now: Date): string {
  const L = [
    "Modelos habilitados hoy (reparto --resumen; se refresca con ese comando). Elegí vos con `-m <id>` y `--effort <e>` según el tamaño real de la tarea y lo que cuesta un error.",
    "int. = índice de inteligencia de Artificial Analysis por effort (~ = estimado); costo relativo a Opus = 1,0; cupo = libre ahora (y cuándo vuelve).",
  ];
  for (const r of filas.slice(0, RESUMEN_MAX)) {
    let efs: string;
    if (Object.keys(r.intel).length) efs = RESUMEN_EFFORTS.filter(([e]) => e in r.intel).map(([e, c]) => `${c} ${fn(r.intel[e][0])}${r.intel[e][1] ? "~" : ""}`).join(" ");
    else efs = `${fn(r.calidad)}${r.estimada ? "~" : ""}`;
    let precio: string;
    if (r.gratis) precio = "gratis";
    else if (verdad(get(r, "plan"))) precio = "plan Go";
    else precio = `pago x${fmtG(pyRound(r.costo, 2))}`;
    let cupo: string;
    if (r.cupo_libre === null) cupo = "cupo sin límite";
    else if (r.agotado) cupo = "SIN CUPO" + (verdad(r.vuelve) ? ` (vuelve en ${humano(horasHasta(r.vuelve, now))})` : "");
    else cupo = `cupo ${pct(r.cupo_libre)}` + (verdad(r.vuelve) && r.cupo_libre < 0.999 ? ` (vuelve en ${humano(horasHasta(r.vuelve, now))})` : "");
    L.push(`-m ${r.id} · int. ${efs} · ${precio} · ${cupo} · ${r.sirve_para}`);
  }
  if (filas.length > RESUMEN_MAX) L.push(`(+${filas.length - RESUMEN_MAX} modelos más: reparto --tabla)`);
  if (!filas.length) L.push("(ningún modelo habilitado: revisá `excluir` en modelos.json)");
  L.push("Guía: Haiku por defecto si se describe con precisión, Sonnet si es ambiguo o Haiku falló, Opus sólo bases, bug sin pista o tras un fallo de Sonnet; si hay chequeo, preferí los cupos gratis. Detalle: skill trama-orquestar.");
  return L.join("\n");
}

function aaDiag(cfg: Obj, filas: Obj[]): Obj {
  const aa: IndiceAA | null = cfg.aa;
  const out: Obj = { aa_fecha: aa ? aa.fecha : null, unidades: "Índice de inteligencia de AA (sin calibrar)", modelos: [] };
  const vistos = new Set<string>();
  for (const f of filas) {
    const mid = f.id;
    if (vistos.has(mid)) continue;
    vistos.add(mid);
    const [e] = aa ? aaEntrada(aa, mid) : [null, null];
    const r = aa ? aaBuscar(aa, mid) : null;
    const d: Obj = { id: mid, tokens: aaTokens(mid).join(" "), calidad: f.calidad, origen: f.origen, permitido: f.permitido, aa: null, efforts: {} };
    if (r && e) {
      const met = r[2];
      d.aa = conFloat({ nombre: r[1], slug: e[met]![2], metrica: met, indice: pyRound(r[0], 2) }, "indice");
      const crudos = aaBuscarEfforts(aa, mid);
      const cal = aaCalidadEfforts(aa, mid);
      const fuentes: Obj = {};
      for (const [ef, v] of Object.entries(aaBuscarExtras(aa, mid))) fuentes[ef] = (v.suplemento && "suplemento") || "api";
      const efs: Obj = {};
      for (const ef of EFFORTS_AA) if (ef in crudos && ef in cal) efs[ef] = conFloat({ indice: pyRound(crudos[ef], 2), usado: cal[ef], estado: "medido", fuente: get(fuentes, ef, "api") }, "indice");
      if (Object.keys(efs).length) {
        for (const ef of EFFORTS_AA) if (!(ef in efs)) efs[ef] = { indice: null, usado: calidadEnEffort(cal, ef, d.aa.indice), estado: "estimado", fuente: null };
        const ord: Obj = {};
        for (const ef of EFFORTS_AA) ord[ef] = efs[ef];
        d.efforts = ord;
      } else d.efforts = efs;
    }
    out.modelos.push(d);
  }
  return out;
}

function textoAaDiag(d: Obj): string {
  const L: string[] = [];
  if (d.aa_fecha === null) L.push("sin caché de Artificial Analysis (aa-modelos.json): ningún modelo se mide; valen los defaults y la estimación por el nombre");
  else {
    L.push(`Artificial Analysis, dato del ${d.aa_fecha}. Unidades: ${d.unidades}`);
    L.push("(medido = lo trae AA o la tabla suplementaria; estimado = interpolado entre los medidos, no es un dato de AA)");
  }
  for (const m of d.modelos) {
    L.push("");
    L.push(`${m.id}${m.permitido ? "" : "   [excluido en modelos.json]"}`);
    if (m.aa) {
      const a = m.aa;
      L.push(`  AA: ${pyStr(a.nombre)} [${a.slug || "-"}]  índice de inteligencia ${pyStr(a.indice, true)}`);
      const efs = Object.entries(m.efforts as Obj).map(([ef, v]) => `${ef} ${fn(v.usado)} (${v.estado}${v.fuente === "suplemento" ? " en " + v.fuente : ""})`).join(" · ");
      L.push(`  por effort: ${efs || "ninguno medido"}`);
    } else L.push(`  AA: sin coincidencia (buscado como "${m.tokens}"); cifra ${pyStr(m.calidad)} de origen ${m.origen}`);
  }
  return L.join("\n");
}

function textoPlan(plan: Plan, ritmo: Obj[]): string {
  const L: string[] = [];
  L.push(`Días ausentes: ${plan.ausente.join(", ") || "ninguno"}`);
  L.push(`Hoy: ${plan.hoy === "gastar" ? "gastar (usar más las suscripciones)" : plan.hoy === "ahorrar" ? "ahorrar (cuidar las suscripciones)" : "sin pista"}`);
  for (const r of ritmo) {
    const quien = pyStr(r.nombre) + (verdad(get(r, "grupo")) ? ` – ${r.grupo}` : "");
    const nota = r.nivel === "encima" ? " (por encima: los workers usan más modelos gratis)" : r.nivel === "debajo" ? " (por debajo: se aprovecha antes del reinicio)" : " (al ritmo)";
    L.push(`Ritmo ${quien} semanal: usado ${pyRound(r.usado * 100)} %, esperado ${pyRound(r.esperado * 100)} % -> ${veces(r.ratio)}${nota}`);
  }
  return L.join("\n");
}

function cmdPlan(args: string[], jsonOut: boolean, cfg: Obj, now: Date): number {
  const sub = (args.length ? args[0]! : "ver").toLowerCase();
  let plan = planLeer(now);
  let cupos: Obj;
  try {
    cupos = leerCupos(cfg, now);
  } catch {
    cupos = { suscripciones: [] };
  }
  cfg.plan = plan;
  const antes = resumenRitmo(cfg, cupos, now);
  let msg: string | null;
  if (sub === "ausente" && args.length >= 2) {
    let nuevas: string[];
    try {
      nuevas = fechasDe(args.slice(1).join(","), now);
    } catch (e) {
      err(`--plan ausente: ${(e as Error).message}`);
      return 2;
    }
    plan.ausente = [...new Set([...plan.ausente, ...nuevas])].sort();
    msg = `Ausente: ${nuevas.join(", ")}`;
  } else if (sub === "presente" && args.length >= 2) {
    let quitar: string[];
    try {
      quitar = fechasDe(args.slice(1).join(","), now);
    } catch (e) {
      err(`--plan presente: ${(e as Error).message}`);
      return 2;
    }
    plan.ausente = plan.ausente.filter((d) => !quitar.includes(d));
    msg = `Ya no ausente: ${quitar.join(", ")}`;
  } else if ((sub === "gastar-hoy" || sub === "ahorrar-hoy") && args.length === 1) {
    plan.hoy = sub.split("-")[0]!;
    msg = `Hoy: ${plan.hoy === "gastar" ? "gastar más de las suscripciones" : "ahorrar las suscripciones"}`;
  } else if (sub === "borrar" && args.length === 1) {
    plan = { ausente: [], hoy: null, actualizado: null };
    msg = "Plan borrado";
  } else if (sub === "ver" && args.length <= 1) msg = null;
  else {
    err("uso: reparto --plan ausente <AAAA-MM-DD>[,..] | presente <fecha> | gastar-hoy | ahorrar-hoy | ver | borrar");
    return 2;
  }
  if (msg) planGrabar(plan, now);
  cfg.plan = plan;
  const despues = resumenRitmo(cfg, cupos, now);
  if (jsonOut) {
    const o = marcarSi({ version: VERSION, plan, perfil: cfg.perfil, reserva_lider: reservaLiderDe(cfg), ritmo_antes: msg ? antes : null, ritmo: despues }, "reserva_lider", reservaLiderFloat(cfg));
    console.log(jsonPy(o));
    return 0;
  }
  if (msg) {
    console.log(msg + ".");
    for (let i = 0; i < Math.min(antes.length, despues.length); i++) {
      const [x, y] = [antes[i]!, despues[i]!];
      if (x.ratio !== y.ratio) console.log(`Ritmo ${pyStr(y.nombre)} semanal: ${veces(x.ratio)} -> ${veces(y.ratio)} (esperado ${pyRound(x.esperado * 100)} % -> ${pyRound(y.esperado * 100)} %).`);
    }
  }
  console.log(textoPlan(plan, despues));
  return 0;
}

function uso(): number {
  process.stdout.write(AYUDA);
  return 2;
}

const salidaJson = (v: unknown) => console.log(jsonPy(v));

export async function main(argv: string[]): Promise<number> {
  let a = [...argv];
  const jsonOut = a.includes("--json");
  const expl = a.includes("--explicar");
  a = a.filter((x) => x !== "--json" && x !== "--explicar");
  const opt: Record<string, string> = {};
  for (const k of ["--cuenta", "--mismo-proveedor", "--horas"]) {
    const i = a.indexOf(k, 1);
    if (i >= 1) {
      if (i + 1 >= a.length) return uso();
      opt[k] = a[i + 1]!;
      a.splice(i, 2);
    }
  }
  let horas = ENFRIAR_H;
  if ("--horas" in opt) {
    try {
      horas = pyFloat(opt["--horas"]);
      if (horas <= 0) throw new Error();
    } catch {
      err("--horas quiere un número de horas mayor que cero (ej. 5)");
      return 2;
    }
  }
  if ("--mismo-proveedor" in opt && !PROVEEDORES.includes(opt["--mismo-proveedor"]!)) {
    err("--mismo-proveedor quiere claude, google o chatgpt");
    return 2;
  }
  if (!a.length || a[0] === "-h" || a[0] === "--help") return uso();
  const cfg = cargarConfig();
  const now = ahora();
  const cupos = (): Obj | null => {
    try {
      return leerCupos(cfg, now);
    } catch (e) {
      err(`no pude leer los cupos: ${textoError(e)}`);
      return null;
    }
  };
  if (a[0] === "--plan") return cmdPlan(a.slice(1), jsonOut, cfg, now);
  if (a[0] === "--cupos") {
    const d = leerCupos(cfg, now);
    console.log(jsonOut ? jsonPy(d, { indent: process.stdout.isTTY ? 2 : null }) : textoCupos(d, now));
    return 0;
  }
  if (a[0] === "--tabla" && a.length === 1) {
    const d = cupos();
    if (!d) return 1;
    const filas = tabla(cfg, d, now);
    console.log(jsonOut ? jsonPy({ version: VERSION, leido: get(d, "leido"), modelos: filas }) : textoTabla(filas, now));
    return 0;
  }
  if (a[0] === "--resumen" && a.length === 1) {
    const d = cupos();
    if (!d) return 1;
    const filas = resumen(cfg, d, now);
    if (jsonOut) {
      const modelos = filas.map((r) => {
        const intel: Obj = {};
        for (const [e, [v, est]] of Object.entries(r.intel as Record<string, [number, boolean]>)) intel[e] = { valor: v, estimada: est };
        return copiarMarcas(r, { ...r, intel });
      });
      salidaJson({ version: VERSION, leido: get(d, "leido"), modelos });
    } else console.log(textoResumen(filas, now));
    return 0;
  }
  if (a[0] === "--aa-diag" && a.length === 1) {
    const d = cupos();
    if (!d) return 1;
    const r = aaDiag(cfg, tabla(cfg, d, now));
    console.log(jsonOut ? jsonPy(r) : textoAaDiag(r));
    return 0;
  }
  if (a[0] === "--tipo" && a.length === 2) {
    const d = cupos();
    if (!d) return 1;
    const r = elegir(a[1]!, cfg, d, now, opt["--mismo-proveedor"] ?? null, opt["--cuenta"] ?? null);
    if (r._reservar !== undefined) await registrarAsignacion(r._reservar, now);
    if (expl) r.explicacion = explicar(r, now, d, cfg);
    if (jsonOut) salidaJson(r);
    else if (expl) console.log(r.explicacion);
    else console.log(`${pyStr(r.modelo)}${verdad(get(r, "effort")) ? " " + r.effort : ""} — ${r.motivo}`);
    return verdad(get(r, "modelo")) ? 0 : 1;
  }
  if (a[0] === "--agotar" && (a.length === 2 || a.length === 4) && (a.length === 2 || a[2] === "--hasta")) return agotar(a[1]!, a.length === 4 ? a[3]! : null, cfg, now, opt["--cuenta"] ?? null);
  if (a[0] === "--enfriar" && a.length === 2) return enfriar(a[1]!, horas, now);
  if (a[0] === "--enfriado" && a.length === 2) {
    const hasta = leerEnfriados(stateDir(), now)[a[1]!.trim().toLowerCase()];
    if (hasta) console.log(hasta);
    return hasta ? 0 : 1;
  }
  if (a[0] === "--excluido" && a.length === 2) {
    const x = excluidoPor(a[1], cfg.excluir, a[1]!.toLowerCase().startsWith("ollama:") ? "local" : null);
    if (x) console.log(x);
    return x ? 0 : 1;
  }
  if (a[0] === "--olvidar-agotados" && a.length === 1) {
    for (const nombre of ["agotado.json", "enfriado.json"]) {
      try {
        unlinkSync(path.join(stateDir(), nombre));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    return 0;
  }
  if (a[0] === "--cuenta-para" && a.length === 2) {
    const d = cupos();
    if (!d) return 1;
    const r = cuentaPara(a[1]!, d, now);
    if (!r) {
      err(`${a[1]} no se corre con una cuenta (no es claude-* ni de agy)`);
      return 1;
    }
    console.log(jsonOut ? jsonPy(r) : pyStr(r.cuenta));
    return 0;
  }
  if (a[0] === "--resolver" && a.length === 2) {
    const r = resolver(a[1]!);
    if (!r) {
      err(`id de modelo desconocido: ${a[1]}`);
      return 1;
    }
    console.log(jsonOut ? jsonPy(r) : `${r.motor} ${r.modelo}`);
    return 0;
  }
  return uso();
}

const AYUDA = "reparto — qué modelo conviene para un tipo de tarea según la calidad que pide y el cupo que sobra.\n\n  reparto --cupos [--json]                     cupo de cada suscripción (Claude oficial, Google AI Pro/agy y ChatGPT/codex)\n  reparto --tabla [--json]                     todos los modelos que conoce: id, inteligencia (~ = estimada), gratis/pago,\n                                               cupo libre y cuándo vuelve, urgencia y si modelos.json los permite\n  reparto --resumen [--json]                   bloque corto (~30 líneas) para que el LÍDER elija modelo y effort: por modelo habilitado, id para `-m`,\n                                               inteligencia (AA) por effort, costo relativo, gratis/pago, cupo libre y cuándo vuelve, y para qué sirve\n  reparto --aa-diag [--json]                   por modelo local: con qué entrada de Artificial Analysis se emparejó, índice de inteligencia de AA (sin calibrar) por effort, medido o estimado\n  reparto --tipo T [--json] [--explicar]       modelo y effort que conviene para el tipo T\n  reparto --resolver ID [--json]               cómo se lanza un id de modelo (claude / agy / codex / ollama / dsh)\n  reparto --agotar ID [--hasta ISO]            marca agotado el grupo de agy o de codex de ese modelo (o grupo), o el\n                                               Claude oficial (claude-*), hasta que vuelve\n  reparto --enfriar ID [--horas N]             un modelo cortó por límite (pa sale 97): no es candidato N horas (default 5); es por modelo, no por grupo\n  reparto --enfriado ID                        si ese modelo sigue enfriado: imprime hasta cuándo y sale 0; si no, sale 1\n  reparto --excluido ID                        si modelos.json excluye ese id: imprime la regla y sale 0; si no, sale 1\n  reparto --olvidar-agotados                   borra las marcas de agotado y de enfriado\n  reparto --plan ausente F[,F..] | presente F  días que no se trabaja (AAAA-MM-DD, hoy, manana, o A..B): el presupuesto semanal se reparte\n                                               entre los demás días (antes de una ausencia + reinicio, hoy se gasta más)\n  reparto --plan gastar-hoy | ahorrar-hoy      pisa el ritmo sólo por hoy (vence solo a medianoche)\n  reparto --plan ver [--json] | borrar         lo que hay guardado (<estado>/plan.json) y el ritmo de cada ventana semanal | lo borra\n  reparto --cuenta-para ID [--json]            la cuenta de su proveedor con más cupo libre para ese modelo\n\nVarias cuentas por proveedor (bin/cuentas, ~/.config/trama/cuentas.json): cada cuenta es una suscripción aparte\nen --cupos (campos proveedor y cuenta), los candidatos salen una vez por cuenta (campo cuenta) y --tipo dice la\ncuenta elegida. --agotar ID --cuenta C marca agotado el grupo de esa cuenta; --tipo T --cuenta C elige sólo entre los\nmodelos de esa cuenta (pa --cuenta sin -m); --tipo T --mismo-proveedor P prefiere\nlas cuentas de P (el relanzamiento por falta de cupo de pa: otra cuenta del mismo proveedor antes de cambiar).\n\nInteligencia (`calidad`): en UNIDADES REALES del ÍNDICE DE INTELIGENCIA de Artificial Analysis (el general, el que AA mide completo; sin calibrar a 100).\nCoding y agentic de AA quedan como datos extra (--tabla: coding_por_effort / agentic_por_effort), nunca como base.\nSale de modelos.json (con \"calidad_unidades\": \"aa\"; sin eso son números de la escala vieja 0-100 y se migran al leer, ver vieja_a_aa);\nun modelo de opencode/dsh sin entrada se estima por el nombre (base 50, +10 con ultra/super/pro/max, -10 con flash/lightning/mini/nano,\nde la escala vieja, convertido a AA) y --tabla lo marca estimada. Los mínimos por tipo (\"sonnet\"...) valen el índice de inteligencia de esa familia\nal esfuerzo del tipo. `efforts_permitidos` {\"sonnet\": [\"low\",\"high\"]}: los esfuerzos que los workers pueden usar por familia o id. Cuenta igual en el puntaje.\nSi la app bajó los índices de Artificial Analysis (<estado>/aa-modelos.json; REPARTO_AA=<archivo> lo cambia, 0 lo apaga) valen antes que los\ndefaults y la estimación, pero después de lo que fija modelos.json. --tabla dice de dónde sale cada cifra en `origen`\n(usuario | artificial-analysis | defecto | estimada) y la fecha del dato en `aa_fecha`. Por esfuerzo, `calidad_por_effort` es lo MEDIDO (de la API o de\ndatos/aa-suplemento.json: REPARTO_AA_SUPLEMENTO=<archivo> lo cambia, 0 lo apaga; la API manda) y `efforts_estimados` + `calidad_estimada_por_effort`\nlo que se estima por interpolación (ver `fuente_por_effort`: api | suplemento | suplemento~ si la cifra es aproximada).\n\nRitmo y perfil (2026-10-26): cada ventana SEMANAL de una suscripción tiene un ritmo = usado / esperado; \"esperado\" = qué fracción de la\nsemana (ponderada por los días de trabajo del plan) ya pasó. Pasarse del ritmo resta puntos; ir por debajo y cerca del reinicio suma.\nmodelos.json `perfil` = equilibrado (default) | ahorro (workers a gratis/Google casi siempre, Claude sólo si nada más llega o si va\natrasado) | rendimiento (calidad primero); `reserva_lider` = fracción de la semana de Claude que queda para el líder (ver RITMO abajo).\n\nDónde deja de usarse cada proveedor (2026-10-27): `topes_uso` {\"google\": 90, \"google:claude-gpt\": 80, \"openai\": 95} = desde qué % USADO de una ventana no se elige\n(el del grupo gana al del proveedor; sin entrada, `llena`: 97 %). Claude se dice con `reserva` ({\"5h\": 0.2, \"7d\": 0.2} = lo que se guarda libre; sin ella, 97 %\nmás la reserva de `perfil`/`reserva_lider` en la semanal). `agy_min_libre_5h` (0,30 = desde 70 % usado) es el tope aparte de Google para trabajo de código en 5 h.\nOpenCode no informa % usado: se deja de usar cuando corta por límite (`--enfriar`, `--agotar`).\n\nSin dependencias (python3 estándar).\nEntorno (para tests): REPARTO_CUPOS_FIJOS=archivo.json (mismo formato que `--cupos --json`, no lee\nnada real), REPARTO_AHORA=ISO (la hora de \"ahora\"), REPARTO_STATE (caché de agy y grupos agotados; default\n<PA_STATE o ~/.local/state/pa>/reparto: el MISMO lugar para `pa` y para quien lo llame a mano), PA_STATE\n(statusline de Claude; también dónde mira los workers vivos para repartir la carga), TRAMA_MODELOS (modelos.json), REPARTO_CACHE_S (vida de la caché de agy: 120 s, y 30 s\nsi algún grupo tiene menos de la mitad de su ventana de 5 h), REPARTO_CARGA_FIJA='{\"grupo\": n}' (workers vivos por grupo,\nsin mirar el estado de pa), REPARTO_ASIGNACION_S (vida de esa anotación, 20; 0 la apaga), REPARTO_RESERVAR=1 (anota el grupo elegido: lo pone pa en su elección real),\nCODEX_HOME (credenciales y sesiones de codex; default ~/.codex), REPARTO_CODEX=0 (como si codex no estuviera).\ndsh (DeepSeek Harness: modelos gratis de OpenCode u Ollama, o DeepSeek): sus modelos son candidatos sólo si `dsh` está instalado y,\nsegún el proveedor, hay key (OPENCODE_API_KEY / DEEPSEEK_API_KEY en el entorno o en ~/.config/trama/claves.env) o Ollama responde\n(OLLAMA_HOST, default http://localhost:11434; la lista de modelos se guarda 60 s). REPARTO_DSH=0 los apaga (REPARTO_SIN_DSH=1 también:\nlo pone pa en --leer, donde dsh no va), REPARTO_CLAUDE=0 (como si claude no estuviera), REPARTO_DSH_FIJO='{\"ollama\":[\"m\"],\"opencode\":true,\n\"deepseek\":false}' (tests: no mira nada real). La calidad de cada modelo de dsh sale de `calidad` de modelos.json (\"dsh:opencode/glm-5.3-flash-free\": 55;\nadmite patrones con *); sin Claude, Gemini ni Codex y con la calidad por debajo de lo que pide el tipo, igual se elige el mejor gratis de dsh.\nopencode (el programa `opencode`: sus modelos gratis, `opencode:opencode/<modelo>`; grupo `opencode-free`): candidatos sólo si `opencode` está instalado;\nla lista sale de `opencode models` (los `*-free` y `big-pickle` de `opencode/`; se guarda 1 h), REPARTO_OPENCODE=0 los apaga (REPARTO_SIN_DSH=1 también),\nREPARTO_OPENCODE_FIJO='[\"opencode/beam-free\"]' (tests: no mira nada real). Los gratis de OpenCode por dsh (`dsh:opencode/*-free`) ya no se ofrecen solos:\nOpenCode los rechaza desde cualquier programa que no sea opencode (REPARTO_DSH_OPENCODE=1 los vuelve a ofrecer, con OPENCODE_API_KEY). La calidad sale de\n`calidad` (\"opencode:opencode/glm-5.3-flash-free\": 55; admite *), como la de dsh.\nOpenCode Go (plan pago de OpenCode, APAGADO por defecto): con `\"opencode_plan\": \"go\"` o `\"go-plus\"` en modelos.json los modelos de motor/opencode/go-topes.json\n(se leen de opencode.ai/go con motor/opencode/go-topes.mjs a un caché en ~/.local/state/hilos; go-topes.json es el respaldo sin red; REPARTO_GO_TABLA=<archivo> lo cambia) entran como candidatos `opencode:opencode-go/<modelo>` con costo marginal ~0\n(`costo[\"opencode-go\"]`, 0,02), por calidad de AA al esfuerzo que se usaría, como cualquier otro. Cada modelo de Go tiene su cupo: un 429 (`--agotar`) marca agotado SOLO\nese modelo (5 h), no el grupo `opencode-free`. Sin esa clave (o con \"gratis\") no cambia nada.\n";

if (esPrincipal(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (rc) => {
      process.exitCode = rc;
    },
    (e) => {
      process.stderr.write(`reparto: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
      process.exitCode = 1;
    },
  );
}
