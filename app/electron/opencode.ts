// OpenCode (`opencode`, https://opencode.ai) como motor de Trama: sus modelos GRATIS (`*-free`, `big-pickle`…) sólo andan dentro del
// programa oficial (con el login de OpenCode Console); desde cualquier otro cliente (dsh con la ruta OpenAI-compatible, curl) devuelven
// `429 FreeUsageLimitError` aun con la key propia. Así que Trama no los llama: lanza `opencode acp` (líderes: opencode-puente vía
// dsh-puente.ts) o `opencode run --format json` (workers: motor/opencode/correr.mjs) y le deja el login y el modelo a OpenCode. Sin Electron.
// DUPLICA A PROPÓSITO motor/opencode/config.mjs (el runner de `pa` no importa nada de app/): si cambia uno, cambia el otro.
//
// Convención de modelo en Trama: `opencode:<proveedor>/<modelo>`, p. ej. `opencode:opencode/deepseek-v4.1-flash-free` (exactamente lo
// que imprime `opencode models`, con el prefijo). El modelo puede llevar `:` y `/` (se parte en la primera `/`).
import { execFile } from "node:child_process";
import { accessSync, constants, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Politica } from "./acp.ts";
import { normal } from "./version.ts";

type Env = Record<string, string | undefined>;

export const COMANDO_INSTALAR_OPENCODE = "npm i -g opencode-ai";
export const COMANDO_LOGIN_OPENCODE = "opencode → /connect → OpenCode Console";

/** `opencode:<proveedor>/<modelo>` → `{ proveedor, modelo, valor }` (`valor`: `proveedor/modelo`, como lo entiende opencode); `null` si no es de opencode o está mal armado. */
export function parsearModelo(id: unknown): { proveedor: string; modelo: string; valor: string } | null {
  if (typeof id !== "string" || !id.startsWith("opencode:")) return null;
  const resto = id.slice("opencode:".length);
  const i = resto.indexOf("/");
  if (i <= 0) return null;
  const proveedor = resto.slice(0, i);
  const modelo = resto.slice(i + 1);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(proveedor) || !modelo.trim() || /\s/.test(modelo)) return null;
  return { proveedor, modelo, valor: resto };
}

export const formatearModelo = (valor: string) => `opencode:${valor}`;
export const esModeloOpencode = (id: unknown) => parsearModelo(id) !== null;

/** ¿Es un modelo gratis de OpenCode? (`*-free`, y `big-pickle`, que lo es sin llevarlo en el id). Recibe `opencode/xxx` o `opencode:opencode/xxx`. */
export const esGratis = (id: string): boolean => {
  const valor = id.startsWith("opencode:") ? id.slice("opencode:".length) : id;
  return /-free$/.test(valor) || valor === "opencode/big-pickle";
};

/** La salida de `opencode models`: una línea `<proveedor>/<modelo>` por modelo (se ignora el ruido: colores, avisos). Sin repetidos, en orden. */
export function parsearModelos(salida: string): string[] {
  const vistos = new Set<string>();
  for (const l of salida.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").split("\n")) {
    const t = l.trim();
    if (/^[A-Za-z0-9][A-Za-z0-9._-]*\/\S+$/.test(t)) vistos.add(t);
  }
  return [...vistos];
}

const ID_MODELO = /^[A-Za-z0-9][A-Za-z0-9._-]*\/\S+$/;
/** Un nivel de esfuerzo válido para `--variant` / ACP `effort` (una palabra: `low`, `medium`, `xhigh`, `minimal`…). */
const NIVEL = /^[A-Za-z][A-Za-z0-9_-]{0,23}$/;

/**
 * La salida de `opencode models --verbose`: cada modelo (`<proveedor>/<modelo>`) seguido de su JSON, que trae `variants` (`{ low: {…}, high: {…} }`)
 * cuando razona. Devuelve, por modelo, los niveles (en el orden en que vienen); `[]` si no tiene. Un JSON roto deja al modelo sin niveles.
 */
export function parsearModelosVerbose(salida: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let id: string | null = null;
  let cuerpo: string[] = [];
  const cerrar = () => {
    if (!id) return;
    let niveles: string[] = [];
    try {
      const v = JSON.parse(cuerpo.join("\n")).variants;
      if (v && typeof v === "object" && !Array.isArray(v)) niveles = Object.keys(v).filter((k) => NIVEL.test(k));
    } catch {
      /* sin JSON legible: sin niveles */
    }
    out[id] = niveles;
  };
  for (const l of salida.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").split("\n")) {
    const t = l.trim();
    // La línea de un id va a columna 0; el JSON de después empieza con `{` o va indentado (nunca calza con un id).
    if (ID_MODELO.test(t) && !/^\s/.test(l)) {
      cerrar();
      id = t;
      cuerpo = [];
    } else if (id) cuerpo.push(l);
  }
  cerrar();
  return out;
}

/** El nivel por defecto de un modelo con niveles: `medium` si lo tiene, si no el primero. */
export const effortDefectoOpencode = (niveles: readonly string[]): string => (niveles.includes("medium") ? "medium" : (niveles[0] ?? "medium"));

/**
 * ¿Hay que mandar este esfuerzo por ACP (`session/set_config_option` con `configId: "effort"`)? Devuelve el valor si la sesión ofrece la opción
 * `effort` y (cuando lista valores) incluye el pedido; `null` si no hay esfuerzo, no se ofrece la opción o el valor no es uno de los suyos.
 * Si el modelo no razona, opencode igual lo rechaza al aplicarlo: quien llama atrapa ese error.
 */
export function effortParaAcp(opciones: Array<Record<string, any>>, effort: string | null | undefined): string | null {
  const e = (effort ?? "").trim();
  if (!e || !NIVEL.test(e)) return null;
  const o = opciones.find((x) => x?.id === "effort");
  if (!o) return null;
  const valores = Array.isArray(o.options) ? o.options.map((x: any) => (x && typeof x === "object" ? x.value : x)).filter((v: unknown): v is string => typeof v === "string") : [];
  if (valores.length && !valores.includes(e)) return null;
  return e;
}

const ejecutable = (f: string) => {
  try {
    accessSync(f, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** El binario `opencode`: `HILOS_OPENCODE`, el PATH, `~/.opencode/bin` (su instalador), `~/.local/bin` y el prefijo global de npm. Sin nada: `opencode` pelado. */
export function resolverOpencode(env: Env = process.env, home: string = os.homedir(), esEjecutable: (f: string) => boolean = ejecutable): string {
  if (env.HILOS_OPENCODE) return env.HILOS_OPENCODE;
  const dirs = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  dirs.push(path.join(home, ".opencode", "bin"), path.join(home, ".local", "bin"));
  if (env.npm_config_prefix) dirs.push(path.join(env.npm_config_prefix, "bin"));
  dirs.push(path.join(home, ".npm-global", "bin"), "/usr/local/bin", path.dirname(process.execPath));
  for (const d of dirs) if (esEjecutable(path.join(d, "opencode"))) return path.join(d, "opencode");
  return "opencode";
}

/** ¿Está instalado `opencode`? `HILOS_OPENCODE` definido vale si apunta a un ejecutable (las pruebas); en una captura sin él no se prende solo. */
export function hayOpencode(env: Env = process.env, home: string = os.homedir(), existe: (f: string) => boolean = ejecutable): boolean {
  if (env.HILOS_OPENCODE !== undefined) return !!env.HILOS_OPENCODE && existe(env.HILOS_OPENCODE);
  if (env.HILOS_CAPTURA) return false;
  return resolverOpencode(env, home, existe) !== "opencode";
}

/** El entorno con el que correr `opencode`: el de la persona (su login y su config son lo que importa), sin variables de Claude. Sin Go, con el modelo chico en uno gratis. */
export function entornoOpencode(env: Env = process.env, home: string = os.homedir()): Env {
  const e: Env = { ...conModeloChico(env, home) };
  delete e.CLAUDE_CONFIG_DIR;
  return e;
}

// --- OpenCode Go (plan pago de OpenCode, APAGADO por defecto) ------------------------------------------------------------------
// DUPLICA A PROPÓSITO el final de motor/opencode/config.mjs. El plan vive en `opencode_plan` de modelos.json ("gratis" | "go" | "go-plus"; sin la
// clave, gratis). Los modelos de Go son del proveedor `opencode-go`: cupo propio por modelo (un 429 agota SOLO ese modelo, ~5 h), aparte del límite
// compartido de los gratis. Los topes, en motor/opencode/go-topes.json (ver opencode-go.ts).
export const PROVEEDOR_GO = "opencode-go";
export const PLANES_OPENCODE = ["gratis", "go", "go-plus"] as const;
export type PlanOpencode = (typeof PLANES_OPENCODE)[number];
/** ¿Es un modelo de OpenCode Go? Recibe `opencode-go/xxx` u `opencode:opencode-go/xxx`. */
export const esModeloGo = (id: unknown): boolean => typeof id === "string" && /^(?:opencode:)?opencode-go\//.test(id);
/** Cuánto dura la marca de agotado de un modelo de Go si no se sabe cuándo vuelve: la ventana de 5 h del plan. */
export const VENCE_GO_MS = 5 * 3600_000;

export const mensajeCuotaGo = (modelo: string): string =>
  `OpenCode Go: se acabó el cupo de 5 h de ${modelo} (los demás modelos de Go siguen). Esperá a que se renueve o probá con otro modelo.`;

/** Dónde está modelos.json (igual que `rutaModelos` de modelos-config.ts, que reparto y el runner también usan). */
export function rutaModelosOc(env: Env = process.env, home: string = os.homedir()): string {
  return env.TRAMA_MODELOS || env.HILOS_MODELOS || path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "trama", "modelos.json");
}

/** El plan de OpenCode que dice modelos.json; cualquier cosa rara (sin archivo, JSON roto, valor desconocido) es «gratis». */
export function planOpencode(env: Env = process.env, home: string = os.homedir()): PlanOpencode {
  try {
    const p = JSON.parse(readFileSync(rutaModelosOc(env, home), "utf8"))?.opencode_plan;
    return (PLANES_OPENCODE as readonly unknown[]).includes(p) ? (p as PlanOpencode) : "gratis";
  } catch {
    return "gratis";
  }
}

/**
 * Sin Go, el modelo chico (`small_model`: el que opencode usa para el título y el resumen de cada sesión) se fija en uno GRATIS: si no, opencode elige
 * solo uno barato del catálogo (en la consola de OpenCode aparecía GPT-6 Luna con 402, sin plan) y cada sesión deja un 402. No se pisa lo que la persona
 * ya puso (su opencode.json, OPENCODE_CONFIG o un OPENCODE_CONFIG_CONTENT con `small_model`) ni se toca si tiene otro proveedor conectado.
 */
export const MODELO_CHICO_GRATIS = "opencode/mimo-v2.6-flash-free";
export function conModeloChico(env: Env = process.env, home: string = os.homedir(), leer: (f: string) => string = (f) => readFileSync(f, "utf8")): Env {
  if (planOpencode(env, home) !== "gratis") return env;
  const tiene = (txt: string) => /["']?small_model["']?\s*:/.test(txt);
  const base = env.XDG_CONFIG_HOME || path.join(home, ".config");
  for (const f of [env.OPENCODE_CONFIG, path.join(base, "opencode", "opencode.json"), path.join(base, "opencode", "opencode.jsonc"), path.join(home, ".opencode", "opencode.json")]) {
    if (!f) continue;
    try {
      if (tiene(leer(f))) return env;
    } catch {
      /* sin ese archivo */
    }
  }
  for (const b of [env.XDG_DATA_HOME, path.join(home, ".local", "share")]) {
    if (!b) continue;
    try {
      if (Object.keys(JSON.parse(leer(path.join(b, "opencode", "auth.json")))).some((k) => k !== "opencode")) return env;
    } catch {
      /* sin auth.json */
    }
  }
  let previo: Record<string, unknown> = {};
  if (env.OPENCODE_CONFIG_CONTENT) {
    try {
      previo = JSON.parse(env.OPENCODE_CONFIG_CONTENT);
      if (!previo || typeof previo !== "object" || Array.isArray(previo)) return env;
    } catch {
      return env;
    }
    if (previo.small_model) return env;
  }
  return { ...env, OPENCODE_CONFIG_CONTENT: JSON.stringify({ ...previo, small_model: MODELO_CHICO_GRATIS }) };
}

/** Las credenciales de OpenCode (`auth.json` en `$XDG_DATA_HOME/opencode` y en `~/.local/share/opencode`): los ids de proveedor con login. Nunca los valores. */
export function proveedoresConLogin(env: Env = process.env, home: string = os.homedir()): string[] {
  const bases = [...new Set([env.XDG_DATA_HOME, path.join(home, ".local", "share")].filter((b): b is string => !!b))];
  const ids = new Set<string>();
  for (const b of bases) {
    try {
      const j = JSON.parse(readFileSync(path.join(b, "opencode", "auth.json"), "utf8"));
      if (j && typeof j === "object" && !Array.isArray(j)) for (const k of Object.keys(j)) ids.add(k);
    } catch {
      /* sin archivo o roto: el otro lugar */
    }
  }
  return [...ids];
}

/** `N credentials` de `opencode providers list` (o `auth list` en versiones viejas); `null` si no se entiende la salida. */
export function contarCredenciales(salida: string): number | null {
  const m = /(\d+)\s+credentials?/i.exec(salida.replace(/\u001b\[[0-9;]*[A-Za-z]/g, ""));
  return m ? Number(m[1]) : null;
}

export type EstadoOpencode = {
  version: 1;
  instalado: boolean;
  /** Lo que imprime `opencode --version`; `null` si no se pudo saber. */
  versionOpencode: string | null;
  /** Hay `npm` para instalarlo desde acá (informativo). */
  comando: string;
  /** Hay al menos un login (OpenCode Console u otro proveedor). `null`: no se pudo saber. */
  logueado: boolean | null;
  /** Los proveedores con login (sus ids, nunca las credenciales). */
  proveedores: string[];
  /** Con login en OpenCode Console / Zen (proveedor `opencode`): lo que habilita los gratis. */
  consola: boolean;
};

type Deps = {
  env: Env;
  home: string;
  existe: (f: string) => boolean;
  correr: (bin: string, args: string[], timeout: number) => Promise<string>;
};

const depsDeVerdad = (): Deps => ({
  env: process.env,
  home: os.homedir(),
  existe: ejecutable,
  correr: (bin, args, timeout) =>
    new Promise((ok, mal) => {
      execFile(bin, args, { timeout, env: entornoOpencode(process.env) as NodeJS.ProcessEnv, maxBuffer: 64 * 1024 * 1024 }, (err, out) => (err ? mal(err) : ok(String(out))));
    }),
});

/** ¿Rechazó `opencode` una bandera (`--refresh` no existe en 2.x)? Entonces se reintenta sin ella en vez de mostrarle el error crudo a la persona. */
const banderaRara = (e: unknown) => /unrecogni[sz]ed|unknown (flag|option|argument)|no such option/i.test(String((e as { stderr?: unknown; message?: unknown })?.stderr ?? "") + String((e as Error)?.message ?? e));

/** Los modelos que `opencode models` lista hoy (con su catálogo local; `refrescar` pide uno nuevo a models.dev). Rechaza si `opencode` falla. Si no conoce `--refresh`, cae a la lista sin él. */
export async function listarModelos(d: Deps = depsDeVerdad(), refrescar = false): Promise<string[]> {
  const bin = resolverOpencode(d.env, d.home, d.existe);
  if (refrescar) {
    try {
      return parsearModelos(await d.correr(bin, ["models", "--refresh"], 45_000));
    } catch (e) {
      if (!banderaRara(e)) throw e;
    }
  }
  return parsearModelos(await d.correr(bin, ["models"], 20_000));
}

/**
 * Los modelos con sus niveles de esfuerzo (`opencode models --verbose`). Si el verbose falla o no trae nada, cae a la lista pelada (sin niveles).
 * `refrescar` pide un catálogo nuevo a models.dev. Rechaza si ni la lista pelada anda.
 */
export async function listarModelosConEfforts(d: Deps = depsDeVerdad(), refrescar = false): Promise<{ modelos: string[]; efforts: Record<string, string[]> }> {
  const bin = resolverOpencode(d.env, d.home, d.existe);
  // Con `--refresh` primero; una versión que no lo conoce (o no conoce `--verbose`) se reintenta con menos banderas.
  const intentos = [...(refrescar ? [["models", "--verbose", "--refresh"]] : []), ["models", "--verbose"]];
  for (const args of intentos) {
    try {
      const efforts = parsearModelosVerbose(await d.correr(bin, args, args.includes("--refresh") ? 60_000 : 30_000));
      const modelos = Object.keys(efforts);
      if (modelos.length) return { modelos, efforts };
    } catch {
      /* esta forma no anda (versión vieja, bandera desconocida, salida enorme): la siguiente */
    }
  }
  return { modelos: await listarModelos(d, refrescar), efforts: {} };
}

/** El estado de OpenCode en esta máquina: se mira cada vez que se pide (instalarlo o conectarse después lo activa sin reiniciar). */
export async function estadoOpencode(d: Deps = depsDeVerdad()): Promise<EstadoOpencode> {
  const instalado = hayOpencode(d.env, d.home, d.existe);
  const bin = resolverOpencode(d.env, d.home, d.existe);
  let versionOpencode: string | null = null;
  let logueado: boolean | null = null;
  let proveedores: string[] = [];
  if (instalado) {
    versionOpencode = normal(await d.correr(bin, ["--version"], 8000).catch(() => "")) ?? null;
    proveedores = proveedoresConLogin(d.env, d.home);
    if (proveedores.length) logueado = true;
    else {
      // Sin auth.json legible: lo que dice el propio programa (`providers list`; antes `auth list`), con parseo flojo.
      let visto: boolean | null = null;
      // 2.x: `auth list` (una tabla con `OpenCode Console  Personal  stored`; `providers` no existe); 1.x: `providers list` con «N credentials».
      for (const cmd of [["auth", "list"], ["providers", "list"]]) {
        const sal = await d.correr(bin, cmd, 10_000).catch(() => null);
        if (sal === null) continue;
        const n = contarCredenciales(sal);
        const limpio = sal.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
        if (/opencode console[^\n]*\bstored\b/i.test(limpio)) {
          visto = true;
          if (!proveedores.includes("opencode")) proveedores = [...proveedores, "opencode"];
        } else if (n !== null && n > 0) visto = true;
        else if (/\bopencode\b/i.test(limpio) && !/\b0\s+credentials?/i.test(limpio)) {
          visto = true;
          if (!proveedores.includes("opencode")) proveedores = [...proveedores, "opencode"];
        } else if (n === 0) visto ??= false;
        if (visto) break;
      }
      logueado = visto;
    }
  }
  return { version: 1, instalado, versionOpencode, comando: COMANDO_INSTALAR_OPENCODE, logueado, proveedores, consola: proveedores.includes("opencode") };
}

/** ¿El error de OpenCode es de cuota o de límite de uso (HTTP 429, `FreeUsageLimitError`)? */
export { esErrorCuota } from "./dsh.ts";

/** Qué decirle a la persona cuando OpenCode corta por límite de uso: los modelos gratis tienen un cupo propio. */
export const mensajeCuotaOpencode = (modelo: string): string =>
  `OpenCode cortó por límite de uso (${modelo}). Esperá un rato, probá con otro modelo, o conectá tu cuenta: \`opencode\` → /connect → OpenCode Console.`;

/**
 * Cómo contestar los permisos de `opencode acp`: por defecto opencode pregunta sólo lo que sale de la carpeta de trabajo
 * (`external_directory`, con `rawInput: { filepath, parentDir }`) o repite una orden en bucle. Dentro del workspace se permite
 * una vez; una ruta fuera de `raiz` se rechaza (como `politicaEnWorkspace` de dsh).
 */
export function politicaOpencode(raiz: string): Politica {
  const base = path.resolve(raiz);
  const dentro = (p: string) => {
    const r = path.relative(base, path.resolve(base, p));
    return r === "" || (!r.startsWith("..") && !path.isAbsolute(r));
  };
  return ({ entrada, toolCall }) => {
    const entradas = [entrada, toolCall?.rawInput].filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
    for (const e of entradas) for (const k of ["filepath", "filePath", "file_path", "parentDir", "path", "cwd", "workdir"]) if (typeof e[k] === "string" && !dentro(e[k] as string)) return "rechazar";
    return "permitir";
  };
}
