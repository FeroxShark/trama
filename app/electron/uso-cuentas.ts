// El uso de las cuentas agregadas de Claude (`~/.config/trama/cuentas.json`, proveedor `claude`): ninguna statusline lo deja si la
// persona no abre una sesión interactiva con esa cuenta (en Windows casi nunca), así que la app lo pide por `get_usage` y lo guarda
// donde `reparto --cupos` lo lee: `<PA_STATE>/cuentas/<id>/uso.json`. Node puro.
import { readFileSync } from "node:fs";
import { caminoDe, homeDe, plataformaActual, type Plataforma } from "./rutas.ts";
import type { Lectura } from "./uso.ts";

type Env = Record<string, string | undefined>;
export type CuentaClaude = { id: string; dir: string };

const ID_OK = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** `cuentas.json`: `TRAMA_CUENTAS`, o `~/.config/trama/cuentas.json` (también en Windows: es donde lo escribe `cuentas`). */
export const archivoCuentas = (env: Env = process.env, home = homeDe(env), plat: Plataforma = plataformaActual()): string =>
  env.TRAMA_CUENTAS || caminoDe(plat).join(env.TRAMA_CUENTAS_HOME || home, ".config", "trama", "cuentas.json");

/** Las cuentas agregadas de Claude con su carpeta (`dir` del archivo, o `cuentas/<id>` junto a él). */
export function cuentasClaude(env: Env = process.env, home = homeDe(env), plat: Plataforma = plataformaActual(), leer: (f: string) => string = (f) => readFileSync(f, "utf8")): CuentaClaude[] {
  const c = caminoDe(plat);
  const archivo = archivoCuentas(env, home, plat);
  let lista: unknown;
  try {
    lista = (JSON.parse(leer(archivo)) as { cuentas?: unknown }).cuentas;
  } catch {
    return [];
  }
  if (!Array.isArray(lista)) return [];
  const vistas = new Set<string>();
  const res: CuentaClaude[] = [];
  for (const x of lista) {
    const o = (x ?? {}) as Record<string, unknown>;
    if (o.proveedor !== "claude" || typeof o.id !== "string" || !ID_OK.test(o.id) || o.id === "claude" || vistas.has(o.id)) continue;
    vistas.add(o.id);
    const dir = typeof o.dir === "string" && o.dir ? o.dir.replace(/^~(?=[\\/]|$)/, home) : c.join(c.dirname(archivo), "cuentas", o.id);
    res.push({ id: o.id, dir: c.resolve(dir) });
  }
  return res;
}

/**
 * La cuenta agregada de Claude que la persona dejó como la que se usa primero (`cuentas preferir`, `preferidas.claude` de cuentas.json), si
 * existe; `undefined`: la de siempre. Los líderes de la app nuevos nacen con ésta; no cambia la de los que ya existen.
 */
export function preferidaClaude(env: Env = process.env, home = homeDe(env), plat: Plataforma = plataformaActual(), leer: (f: string) => string = (f) => readFileSync(f, "utf8")): string | undefined {
  try {
    const p = (JSON.parse(leer(archivoCuentas(env, home, plat))) as { preferidas?: { claude?: unknown } | null }).preferidas?.claude;
    return typeof p === "string" && cuentasClaude(env, home, plat, leer).some((c) => c.id === p) ? p : undefined;
  } catch {
    return undefined;
  }
}

/** Lo que `reparto` lee de `cuentas/<id>/uso.json` (`pct` 0..100, `resets_at` y `ts` en epoch s). */
export function usoParaReparto(l: Lectura): { version: 1; five_hour?: { pct: number; resets_at: number | null; ts: number }; seven_day?: { pct: number; resets_at: number | null; ts: number } } {
  const v = (x: Lectura["five_hour"]) => (x ? { pct: x.pct, resets_at: x.resets_at, ts: x.ts } : undefined);
  const f = v(l.five_hour);
  const s = v(l.seven_day);
  return { version: 1, ...(f ? { five_hour: f } : {}), ...(s ? { seven_day: s } : {}) };
}

/** `<estado de pa>/cuentas/<id>/uso.json`. */
export const archivoUsoCuenta = (paState: string, id: string, plat: Plataforma = plataformaActual()): string => caminoDe(plat).join(paState, "cuentas", id, "uso.json");

/** El entorno de un `claude` de esa cuenta: su carpeta y sin claves de API que le tapen el login. */
export function entornoCuenta(env: NodeJS.ProcessEnv, dir: string): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { ...env, CLAUDE_CONFIG_DIR: dir };
  for (const v of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"]) delete e[v];
  return e;
}
