// trama-estado — qué hay instalado y andando para Trama: claude, agy, dsh, Ollama y el motor. Port a TypeScript de
// motor/bin/trama-estado (misma CLI, misma salida, mismo contrato JSON).
//
//   trama-estado --json    una línea de JSON (contrato abajo); sale 0 siempre que pueda imprimir
//   trama-estado           lo mismo en palabras
//
// {"version":1,
//  "claude":{"instalado":bool,"logueado":bool},
//  "agy":{"instalado":bool,"logueado":bool},
//  "dsh":{"instalado":bool,"version":str|null,"ruta":str|null,"claves":{"opencode":bool,"deepseek":bool}},
//  "opencode":{"instalado":bool,"version":str|null,"ruta":str|null,"logueado":bool},
//  "ollama":{"url":str,"responde":bool,"modelos":[str]},
//  "motor":{"vivo":bool,"url":str}}   (+ "proceso":bool, extra: el proceso existe aunque no atienda HTTP)
//
// Nunca falla por algo que no encuentra: lo que falta sale en false. Las keys de dsh (OPENCODE_API_KEY, DEEPSEEK_API_KEY) se
// miran en el entorno y en claves.env (TRAMA_CLAVES lo redirige): sólo se dice si están, NUNCA su valor.
// Entorno (para probar): TRAMA_CLAUDE / TRAMA_AGY (otro nombre del binario), HILOS_DSH / HILOS_OPENCODE (el binario), TRAMA_MODELOS
// (otro modelos.json), TRAMA_PUERTO (puerto del motor, default 8791), OLLAMA_HOST (si modelos.json no dice).
import http from "node:http";
import https from "node:https";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { carpetasNpm, paraLanzar } from "../binario.ts";
import { prefijoDsh } from "../dsh.ts";
import { configTrama, esWindows, estadoHilos, homeDe } from "../rutas.ts";
import { enPath, esEjecutable } from "./base/buscar.ts";
import { esPrincipal } from "./base/principal.ts";
import { correr, vivo } from "./base/proc.ts";

type Env = Record<string, string | undefined>;

// `agy models`: una línea por modelo, "id<TAB>nombre" o sólo el id (gemini-…, claude-…, gpt-…; mismo patrón que bin/cuentas).
// Sin sesión no hay ninguna.
export const MODELO_AGY = /^\s*(?:[a-z0-9][a-z0-9.-]*\t|(?:gemini|claude|gpt)[-\w.]*\s*$)/i;

/** Como `json.dumps(…, ensure_ascii=False)` de Python: separadores «, » y «: » (el contrato histórico de este script). */
export function jsonPy(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "[" + v.map(jsonPy).join(", ") + "]";
  if (typeof v === "object") return "{" + Object.entries(v as Record<string, unknown>).map(([k, x]) => JSON.stringify(k) + ": " + jsonPy(x)).join(", ") + "}";
  return JSON.stringify(v);
}

/** Los saltos de línea de `str.splitlines()` de Python. */
const SALTOS = new RegExp("\\r\\n|[\\n\\r\\v\\f\\x1c-\\x1e\\x85\\u2028\\u2029]");

/** Verdad de Python (`bool(x)`). */
const verdad = (x: unknown) => !(x === null || x === undefined || x === false || x === 0 || x === "" || (Array.isArray(x) && x.length === 0) || (typeof x === "object" && x !== null && !Array.isArray(x) && Object.keys(x).length === 0));
const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** Primera línea (recortada a 40 caracteres) de la versión; null si el programa falló o no dijo nada. */
const primeraLinea = (rc: number, out: string) => (rc === 0 && out.trim() ? Array.from(out.trim().split(SALTOS)[0]!).slice(0, 40).join("") : null);

export type Contexto = { env: Env; home: string };

/** Corre un programa y devuelve [código, stdout]; cualquier falla (no existe, tiempo vencido) es [1, ""]. */
export async function salida(cmd: string[], espera = 10, env: Env = process.env): Promise<[number, string]> {
  // En Windows un `.cmd` de npm (dsh, opencode) no se lanza directo: `paraLanzar` lo pasa por cmd.exe. En Linux no cambia nada.
  const l = paraLanzar(cmd[0]!, cmd.slice(1), env);
  const r = await correr(l.file, l.args, { timeoutMs: espera * 1000, env, input: "", verbatim: l.verbatim });
  if (r.error || r.agotado) return [1, ""];
  return [r.codigo, r.salida];
}

const enPathCon = (c: Contexto, nombre: string, extra: string[] = []) => enPath(nombre, [path.join(c.home, ".local", "bin"), ...extra], c.env);

function dirsAgy(c: Contexto): string[] {
  // donde cae agy si no está en el PATH: /usr/local/bin y el ~/.antigravity*/bin del instalador
  let hallados: string[] = [];
  try {
    hallados = readdirSync(c.home).filter((n) => n.startsWith(".antigravity") && existsSync(path.join(c.home, n, "bin"))).sort().map((n) => path.join(c.home, n, "bin"));
  } catch {
    /* sin home legible */
  }
  return ["/usr/local/bin", ...hallados];
}

async function claude(c: Contexto) {
  const ruta = enPathCon(c, c.env.TRAMA_CLAUDE || "claude");
  if (!ruta) return { instalado: false, logueado: false };
  let logueado = false;
  const [rc, out] = await salida([ruta, "auth", "status", "--json"], 10, c.env);
  let parseado = false;
  if (rc === 0) {
    try {
      const j: unknown = JSON.parse(out);
      if (!esObjeto(j)) throw new Error("sin .get");
      logueado = verdad(j.loggedIn);
      parseado = true;
    } catch {
      parseado = false;
    }
  }
  // claude viejo sin `auth status`: queda el archivo de credenciales.
  if (rc === 0 && !parseado) logueado = existsSync(path.join(c.env.CLAUDE_CONFIG_DIR || path.join(c.home, ".claude"), ".credentials.json"));
  return { instalado: true, logueado };
}

async function agy(c: Contexto) {
  const ruta = enPathCon(c, c.env.TRAMA_AGY || "agy", dirsAgy(c));
  if (!ruta) return { instalado: false, logueado: false };
  // agy guarda el login de Google en el llavero del sistema (no hay archivo que mirar): con sesión lista modelos.
  // Colgado: salida() corta a los 15 s y devuelve "" (queda en false).
  const [, out] = await salida([ruta, "models"], 15, c.env);
  return { instalado: true, logueado: out.split(SALTOS).some((l) => MODELO_AGY.test(l)) };
}

/** ¿Hay key? El entorno o claves.env (líneas NOMBRE=valor). Sólo un booleano: el valor no sale de acá. */
export function claveDsh(nombre: string, c: Contexto): boolean {
  if (c.env[nombre]) return true;
  const f = c.env.TRAMA_CLAVES || path.join(configTrama(c.env, c.home), "claves.env");
  const re = new RegExp(`^\\s*(?:export\\s+)?${nombre}\\s*=\\s*(.*?)\\s*$`);
  try {
    for (const ln of readFileSync(f, "utf8").split(/\r\n|\r|\n/)) {
      const m = re.exec(ln);
      if (m && m[1]!.replace(/^['"]+|['"]+$/g, "")) return true;
    }
  } catch {
    /* sin archivo */
  }
  return false;
}

function dirsDsh(c: Contexto): string[] {
  // donde cae dsh si no está en el PATH: el prefijo global de npm (`carpetasNpm`: en Linux npm_config_prefix/bin, ~/.npm-global/bin y /usr/local/bin;
  // en Windows el prefijo y %APPDATA%\npm) y, en Windows, la raíz del prefijo de la instalación (~\.local: ahí npm deja dsh.cmd)
  return [...carpetasNpm(c.env, c.home), ...(esWindows() ? [prefijoDsh(c.home)] : [])];
}

async function dsh(c: Contexto) {
  const claves = { opencode: claveDsh("OPENCODE_API_KEY", c), deepseek: claveDsh("DEEPSEEK_API_KEY", c) };
  let ruta: string | null = c.env.HILOS_DSH || null;
  if (ruta) ruta = esEjecutable(ruta) ? ruta : null;
  else ruta = enPathCon(c, "dsh", dirsDsh(c));
  if (!ruta) return { instalado: false, version: null, ruta: null, claves };
  const [rc, out] = await salida([ruta, "--version"], 15, c.env);
  return { instalado: true, version: primeraLinea(rc, out), ruta, claves };
}

/** El programa opencode (sus modelos gratis sólo andan por él). `logueado`: hay credenciales en $XDG_DATA_HOME/opencode/auth.json (sólo se mira si existen, nunca su valor). */
async function opencode(c: Contexto) {
  let ruta: string | null = c.env.HILOS_OPENCODE || null;
  if (ruta) ruta = esEjecutable(ruta) ? ruta : null;
  else ruta = enPathCon(c, "opencode", [path.join(c.home, ".opencode", "bin"), path.join(c.home, ".local", "bin"), ...dirsDsh(c)]);
  if (!ruta) return { instalado: false, version: null, ruta: null, logueado: false };
  const [rc, out] = await salida([ruta, "--version"], 15, c.env);
  const version = primeraLinea(rc, out);
  const auth = path.join(c.env.XDG_DATA_HOME || path.join(c.home, ".local", "share"), "opencode", "auth.json");
  let logueado = false;
  try {
    const j: unknown = JSON.parse(readFileSync(auth, "utf8"));
    logueado = esObjeto(j) && Object.keys(j).length > 0;
  } catch {
    logueado = false;
  }
  if (!logueado) {
    // opencode 2.x ya no deja auth.json: lo dice `opencode auth list` (misma regla que app/electron/opencode.ts:
    // una línea «OpenCode Console … stored»). Sólo se lee esa tabla, nunca credenciales.
    const [, o2] = await salida([ruta, "auth", "list"], 5, c.env);
    const limpio = o2.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
    logueado = limpio.split(SALTOS).some((l) => l.toLowerCase().includes("opencode console") && l.toLowerCase().includes("stored"));
  }
  return { instalado: true, version, ruta, logueado };
}

function modelosJson(c: Contexto): Record<string, unknown> {
  const ruta = c.env.TRAMA_MODELOS || path.join(configTrama(c.env, c.home), "modelos.json");
  try {
    const j: unknown = JSON.parse(readFileSync(ruta, "utf8"));
    return esObjeto(j) ? j : {};
  } catch {
    return {};
  }
}

/** GET; devuelve [código HTTP, cuerpo] o [null, ""] si no hay nadie. Un 4xx/5xx también es «responde». */
export function pedir(url: string, espera = 3): Promise<[number | null, string]> {
  return new Promise((resolve) => {
    let listo = false;
    const fin = (r: [number | null, string]) => {
      if (!listo) {
        listo = true;
        resolve(r);
      }
    };
    try {
      const mod = url.startsWith("https:") ? https : http;
      const req = mod.get(url, { agent: false, timeout: espera * 1000 }, (res) => {
        const trozos: Buffer[] = [];
        let n = 0;
        res.on("data", (b: Buffer) => {
          if (n < 1 << 20) trozos.push(b);
          n += b.length;
        });
        res.on("end", () => fin([res.statusCode ?? null, res.statusCode && res.statusCode >= 400 ? "" : Buffer.concat(trozos).subarray(0, 1 << 20).toString("utf8")]));
        res.on("error", () => fin([res.statusCode ?? null, ""]));
      });
      req.on("timeout", () => {
        req.destroy();
        fin([null, ""]);
      });
      req.on("error", () => fin([null, ""]));
    } catch {
      fin([null, ""]);
    }
  });
}

async function ollama(c: Contexto) {
  let url = "";
  const locales = modelosJson(c).locales;
  for (const l of Array.isArray(locales) ? locales : []) {
    if (esObjeto(l) && typeof l.url === "string" && l.url) {
      url = l.url;
      break;
    }
  }
  if (!url) {
    url = c.env.OLLAMA_HOST || "http://localhost:11434";
    if (!url.includes("://")) url = "http://" + url;
  }
  url = url.replace(/\/+$/, "");
  const [cod, cuerpo] = await pedir(url + "/api/tags");
  let nombresM: unknown[] = [];
  if (cod === 200) {
    try {
      const j: unknown = JSON.parse(cuerpo);
      const ms = esObjeto(j) ? j.models : undefined;
      nombresM = (Array.isArray(ms) ? ms : []).filter((m) => esObjeto(m) && verdad(m.name)).map((m) => (m as { name: unknown }).name);
    } catch {
      /* sin lista */
    }
  }
  return { url, responde: cod === 200, modelos: nombresM };
}

async function motor(c: Contexto) {
  const url = `http://127.0.0.1:${c.env.TRAMA_PUERTO || "8791"}`;
  const [cod] = await pedir(url + "/");
  // `proceso`: el motor (su `dueno` en el estado de hilos) está vivo aunque no atienda HTTP todavía.
  let proceso = false;
  try {
    const j: unknown = JSON.parse(readFileSync(path.join(estadoHilos(c.env, c.home), "dueno"), "utf8"));
    const pid = esObjeto(j) ? Number(j.pid) : NaN;
    proceso = Number.isFinite(pid) && vivo(Math.trunc(pid));
  } catch {
    proceso = false;
  }
  return { vivo: cod !== null, url, proceso };
}

export async function estado(env: Env = process.env) {
  const c: Contexto = { env, home: homeDe(env) };
  return { version: 1, claude: await claude(c), agy: await agy(c), dsh: await dsh(c), opencode: await opencode(c), ollama: await ollama(c), motor: await motor(c) };
}

export type Estado = Awaited<ReturnType<typeof estado>>;

export function enPalabras(est: Estado): string {
  const si = (b: boolean) => (b ? "sí" : "no");
  const d = est.dsh;
  const oc = est.opencode;
  const o = est.ollama;
  return (
    [
      `claude   instalado: ${si(est.claude.instalado)} · sesión: ${si(est.claude.logueado)}`,
      `agy      instalado: ${si(est.agy.instalado)} · sesión: ${si(est.agy.logueado)}`,
      `dsh      instalado: ${si(d.instalado)}${d.version ? ` (${d.version})` : ""} · keys: OpenCode ${si(d.claves.opencode)}, DeepSeek ${si(d.claves.deepseek)}`,
      `opencode instalado: ${si(oc.instalado)}${oc.version ? ` (${oc.version})` : ""} · sesión: ${si(oc.logueado)}`,
      `ollama   ${o.url} · responde: ${si(o.responde)} · modelos: ${o.modelos.join(", ") || "ninguno"}`,
      `motor    ${est.motor.url} · vivo: ${si(est.motor.vivo)}`,
    ].join("\n") + "\n"
  );
}

/** La herramienta: sale 0 siempre que pueda imprimir (el contrato). */
export async function main(argv: string[], env: Env = process.env, out: (s: string) => void = (s) => process.stdout.write(s)): Promise<number> {
  try {
    const est = await estado(env);
    out(argv.includes("--json") ? jsonPy(est) + "\n" : enPalabras(est));
  } catch (e) {
    out(
      jsonPy({
        version: 1,
        claude: { instalado: false, logueado: false },
        agy: { instalado: false, logueado: false },
        dsh: { instalado: false, version: null, ruta: null, claves: { opencode: false, deepseek: false } },
        opencode: { instalado: false, version: null, ruta: null, logueado: false },
        ollama: { url: "", responde: false, modelos: [] },
        motor: { vivo: false, url: "", proceso: false },
        error: String((e as Error)?.message ?? e),
      }) + "\n",
    );
  }
  return 0;
}

if (esPrincipal(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
