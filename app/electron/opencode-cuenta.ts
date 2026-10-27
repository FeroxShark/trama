// Una cuenta agregada de OpenCode en el proceso de un líder (el puente `dsh-puente.ts` con `opencode acp`). Los workers no pasan por acá: `pa` pone el
// entorno de la cuenta (`cuentas env`) sólo en el proceso de `motor/opencode/correr.mjs`. Acá, lo mismo para el líder: si el entorno trae
// `TRAMA_OPENCODE_CUENTA=<id>`, el puente le pregunta a `cuentas env <id> --json` y corre `opencode acp` con ESE entorno (su XDG_DATA_HOME, donde
// opencode 2.x guarda el login en opencode.db, y su XDG_STATE_HOME). Sin la variable, o con la de siempre (`opencode`), no se toca nada.
//
// Fallar cerrado: si se pidió una cuenta y no se puede armar su entorno (no existe, no es de OpenCode, el CLI no contesta), el líder NO arranca; usar en
// silencio la cuenta de la persona gastaría el cupo equivocado. `opencode acp` corre dentro del proceso (no habla con el servicio de fondo de 2.x), así
// que con el entorno alcanza: no necesita `--standalone`, que sólo tienen los comandos de un solo tiro (`run`, `auth`, `models`).
// Node puro (sin `electron`): lo prueba tests/opencode-cuenta.test.ts.
import { execFileSync } from "node:child_process";
import os from "node:os";
import { pathConLocal, resolverBinario } from "./binario.ts";

type Env = Record<string, string | undefined>;

/** Lo único que una cuenta puede poner en el entorno del líder (lo demás que diga el CLI se descarta). */
export const CLAVES_CUENTA_OPENCODE = ["XDG_DATA_HOME", "XDG_STATE_HOME", "TRAMA_OPENCODE_CUENTA", "TRAMA_OPENCODE_PLAN"] as const;
const ID_CUENTA = /^[a-z0-9][a-z0-9-]{0,39}$/;
const PLANES = ["gratis", "go", "go-plus"];

/** La cuenta agregada de OpenCode del entorno (`TRAMA_OPENCODE_CUENTA`), o `null` (sin ella, o la de siempre). Un id con pinta rara no vale. */
export const cuentaAgregadaDe = (env: Env): string | null => {
  const id = env.TRAMA_OPENCODE_CUENTA ?? "";
  return ID_CUENTA.test(id) && id !== "opencode" ? id : null;
};

/**
 * Valida lo que dice `cuentas env <id> --json` y devuelve las variables a poner. Tira si no es una cuenta agregada de OpenCode con ese id, si le
 * faltan las carpetas, o si alguna no es una ruta absoluta (nunca se guarda un login en una carpeta relativa al directorio de quien lance).
 */
export function entornoDeSalida(salida: string, id: string): Record<string, string> {
  let o: { id?: unknown; proveedor?: unknown; defecto?: unknown; poner?: unknown } | null;
  try {
    o = JSON.parse(salida);
  } catch {
    throw new Error(`la cuenta de OpenCode «${id}»: \`cuentas env\` no devolvió un JSON`);
  }
  if (!o || o.id !== id || o.proveedor !== "opencode" || o.defecto === true) throw new Error(`«${id}» no es una cuenta agregada de OpenCode`);
  const poner = (o.poner ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of CLAVES_CUENTA_OPENCODE) if (typeof poner[k] === "string" && poner[k]) out[k] = poner[k] as string;
  if (!out.XDG_DATA_HOME?.startsWith("/") || !out.XDG_STATE_HOME?.startsWith("/") || out.XDG_DATA_HOME === out.XDG_STATE_HOME)
    throw new Error(`la cuenta de OpenCode «${id}» no trae carpetas propias (XDG_DATA_HOME y XDG_STATE_HOME)`);
  if (out.TRAMA_OPENCODE_CUENTA !== id) throw new Error(`la cuenta de OpenCode «${id}» no se identifica bien`);
  if (out.TRAMA_OPENCODE_PLAN && !PLANES.includes(out.TRAMA_OPENCODE_PLAN)) delete out.TRAMA_OPENCODE_PLAN;
  return out;
}

export type DepsCuentaOpencode = {
  /** `cuentas env <id> --json` (por defecto el comando real); devuelve su salida. */
  leer?: (id: string, env: Env, home: string) => string;
  home?: string;
};

const leerReal = (id: string, env: Env, home: string): string =>
  execFileSync(resolverBinario("cuentas", "HILOS_CUENTAS", env, home), ["env", id, "--json"], {
    env: { ...env, PATH: pathConLocal(env, home) } as NodeJS.ProcessEnv,
    encoding: "utf8",
    timeout: 15_000,
    stdio: ["ignore", "pipe", "pipe"],
  });

/**
 * El entorno del líder con la cuenta de OpenCode que pide `TRAMA_OPENCODE_CUENTA`. Sin pedido: el mismo entorno. Con pedido que no se puede cumplir:
 * tira (el líder no arranca; ver el encabezado).
 */
export function conCuentaOpencode(env: Env, deps: DepsCuentaOpencode = {}): Env {
  const id = cuentaAgregadaDe(env);
  if (!id) {
    // Una variable con basura no se deja pasar: opencode correría con la cuenta de siempre creyendo que es otra.
    if (env.TRAMA_OPENCODE_CUENTA && env.TRAMA_OPENCODE_CUENTA !== "opencode") throw new Error(`TRAMA_OPENCODE_CUENTA no es un id de cuenta válido`);
    return env;
  }
  const home = deps.home ?? os.homedir();
  let salida: string;
  try {
    salida = (deps.leer ?? leerReal)(id, env, home);
  } catch (e) {
    throw new Error(`no pude leer la cuenta de OpenCode «${id}» (\`cuentas env\`): ${String((e as Error)?.message ?? e).split("\n")[0].slice(0, 200)}`);
  }
  return { ...env, ...entornoDeSalida(salida, id) };
}
