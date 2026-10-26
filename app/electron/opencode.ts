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

/** El entorno con el que correr `opencode`: el de la persona (su login y su config son lo que importa), sin variables de Claude. */
export function entornoOpencode(env: Env = process.env): Env {
  const e: Env = { ...env };
  delete e.CLAUDE_CONFIG_DIR;
  return e;
}

/** Las credenciales de OpenCode (`auth.json` en `$XDG_DATA_HOME/opencode`, default `~/.local/share/opencode`): los ids de proveedor con login. Nunca los valores. */
export function proveedoresConLogin(env: Env = process.env, home: string = os.homedir()): string[] {
  const dir = path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "opencode", "auth.json");
  try {
    const j = JSON.parse(readFileSync(dir, "utf8"));
    return j && typeof j === "object" && !Array.isArray(j) ? Object.keys(j) : [];
  } catch {
    return [];
  }
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
      execFile(bin, args, { timeout, env: entornoOpencode(process.env) as NodeJS.ProcessEnv, maxBuffer: 4 * 1024 * 1024 }, (err, out) => (err ? mal(err) : ok(String(out))));
    }),
});

/** Los modelos que `opencode models` lista hoy (con su catálogo local; `refrescar` pide uno nuevo a models.dev). Rechaza si `opencode` falla. */
export async function listarModelos(d: Deps = depsDeVerdad(), refrescar = false): Promise<string[]> {
  const bin = resolverOpencode(d.env, d.home, d.existe);
  const salida = await d.correr(bin, refrescar ? ["models", "--refresh"] : ["models"], refrescar ? 45_000 : 20_000);
  return parsearModelos(salida);
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
      // Sin auth.json legible: lo que dice el propio programa (`providers list`; antes `auth list`).
      const n = await d.correr(bin, ["providers", "list"], 10_000).then(contarCredenciales, () => null);
      const m = n ?? (await d.correr(bin, ["auth", "list"], 10_000).then(contarCredenciales, () => null));
      logueado = m === null ? null : m > 0;
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
