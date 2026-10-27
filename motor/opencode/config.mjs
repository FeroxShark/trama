// OpenCode (`opencode`, https://opencode.ai) como motor de workers de pa: sus modelos GRATIS (`*-free`, `big-pickle`…) sólo andan dentro del
// programa oficial (con el login de OpenCode Console); desde otro cliente devuelven 429 FreeUsageLimitError. Sin dependencias y sin importar
// nada de app/ (pa corre sin la app). OJO: app/electron/opencode.ts duplica esto A PROPÓSITO; si cambia uno, cambia el otro
// (tests/opencode.test.ts y tests/opencode-correr.test.ts cubren cada uno).
//
// Convención de modelo en Trama: `opencode:<proveedor>/<modelo>`, p. ej. `opencode:opencode/deepseek-v4.1-flash-free` (lo que imprime
// `opencode models`, con el prefijo). El modelo puede llevar `:` y `/` (se parte en la primera `/`).
import { accessSync, constants, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** `opencode:<proveedor>/<modelo>` → `{ proveedor, modelo, valor }` (`valor`: `proveedor/modelo`, lo que entiende `opencode -m`); `null` si está mal armado. */
export function parsearModelo(id) {
  if (typeof id !== "string" || !id.startsWith("opencode:")) return null;
  const resto = id.slice("opencode:".length);
  const i = resto.indexOf("/");
  if (i <= 0) return null;
  const proveedor = resto.slice(0, i);
  const modelo = resto.slice(i + 1);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(proveedor) || !modelo.trim() || /\s/.test(modelo)) return null;
  return { proveedor, modelo, valor: resto };
}

/** ¿Gratis? (`*-free` y `big-pickle` de OpenCode.) Recibe `opencode/xxx` o `opencode:opencode/xxx`. */
export const esGratis = (id) => {
  const valor = String(id).startsWith("opencode:") ? String(id).slice("opencode:".length) : String(id);
  return /-free$/.test(valor) || valor === "opencode/big-pickle";
};

/** ¿El error es de cuota o de límite de uso (HTTP 429, `FreeUsageLimitError`)? */
export const esErrorCuota = (texto) => /\bQUOTA\b|FreeUsageLimitError|Free usage limit|\b429\b\s*[:\-]\s*(?:\{|Too Many|rate|quota|free)|(?:HTTP|status|code)\W{0,3}429\b|"statusCode":\s*429/i.test(texto);

export const mensajeCuotaOpencode = (modelo) =>
  `OpenCode cortó por límite de uso (${modelo}). Esperá un rato, probá con otro modelo, o conectá tu cuenta: \`opencode\` → /connect → OpenCode Console.`;

const ejecutable = (f) => {
  try {
    accessSync(f, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** El binario `opencode`: `HILOS_OPENCODE`, el PATH, `~/.opencode/bin`, `~/.local/bin` y el prefijo global de npm. Sin nada: `opencode` pelado. */
export function resolverOpencode(env = process.env, home = os.homedir(), esEjecutable = ejecutable) {
  if (env.HILOS_OPENCODE) return env.HILOS_OPENCODE;
  const dirs = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  dirs.push(path.join(home, ".opencode", "bin"), path.join(home, ".local", "bin"));
  if (env.npm_config_prefix) dirs.push(path.join(env.npm_config_prefix, "bin"));
  dirs.push(path.join(home, ".npm-global", "bin"), "/usr/local/bin", path.dirname(process.execPath));
  for (const d of dirs) if (esEjecutable(path.join(d, "opencode"))) return path.join(d, "opencode");
  return "opencode";
}

// --- OpenCode Go (plan pago de OpenCode, APAGADO por defecto) ------------------------------------------------------------------
// El plan se guarda en `opencode_plan` de modelos.json ("gratis" | "go" | "go-plus"; sin la clave, gratis). Los modelos de Go son del proveedor
// `opencode-go` (`opencode:opencode-go/<modelo>`) y tienen su cupo propio por modelo: un 429 de uno no agota a los demás ni al límite compartido
// de los gratis. Los topes están en go-topes.json (el ÚNICO archivo de datos; lo lee también reparto). DUPLICADO en app/electron/opencode.ts.
export const PROVEEDOR_GO = "opencode-go";
export const PLANES_OPENCODE = ["gratis", "go", "go-plus"];
/** ¿Es un modelo de OpenCode Go? Recibe `opencode-go/xxx` u `opencode:opencode-go/xxx`. */
export const esModeloGo = (id) => /^(?:opencode:)?opencode-go\//.test(String(id));

/** Cuánto dura la marca de agotado de un modelo de Go si no se sabe cuándo vuelve: la ventana de 5 h del plan. */
export const VENCE_GO_MS = 5 * 3600_000;

export const mensajeCuotaGo = (modelo) =>
  `OpenCode Go: se acabó el cupo de 5 h de ${modelo} (los demás modelos de Go siguen). Esperá a que se renueve o probá con otro modelo.`;

/** Dónde está modelos.json (igual que `rutaModelos` de app/electron/modelos-config.ts y que reparto). */
export function rutaModelos(env = process.env, home = os.homedir()) {
  return env.TRAMA_MODELOS || env.HILOS_MODELOS || path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "trama", "modelos.json");
}

/**
 * El plan de OpenCode que dice modelos.json; cualquier cosa rara (sin archivo, JSON roto, valor desconocido) es «gratis». Un worker de una cuenta
 * agregada de OpenCode trae el plan de esa cuenta en TRAMA_OPENCODE_PLAN (lo pone `cuentas env`): ése manda.
 */
export function planOpencode(env = process.env, home = os.homedir()) {
  if (PLANES_OPENCODE.includes(env.TRAMA_OPENCODE_PLAN)) return env.TRAMA_OPENCODE_PLAN;
  try {
    const p = JSON.parse(readFileSync(rutaModelos(env, home), "utf8"))?.opencode_plan;
    return PLANES_OPENCODE.includes(p) ? p : "gratis";
  } catch {
    return "gratis";
  }
}

/**
 * Sin Go, el modelo chico (`small_model`: el que opencode usa para el título y el resumen de cada sesión) se fija en uno GRATIS: si no, opencode
 * elige solo uno barato del catálogo (en la consola de OpenCode aparecía GPT-6 Luna con 402, sin plan) y cada sesión deja un 402. No se pisa lo que la
 * persona ya puso (su opencode.json, OPENCODE_CONFIG o un OPENCODE_CONFIG_CONTENT con `small_model`).
 */
export const MODELO_CHICO_GRATIS = "opencode/mimo-v2.6-flash-free";
export function conModeloChico(env = process.env, home = os.homedir(), leer = (f) => readFileSync(f, "utf8")) {
  if (planOpencode(env, home) !== "gratis") return env;
  const tiene = (txt) => /["']?small_model["']?\s*:/.test(txt);
  const base = env.XDG_CONFIG_HOME || path.join(home, ".config");
  for (const f of [env.OPENCODE_CONFIG, path.join(base, "opencode", "opencode.json"), path.join(base, "opencode", "opencode.jsonc"), path.join(home, ".opencode", "opencode.json")]) {
    if (!f) continue;
    try {
      if (tiene(leer(f))) return env;
    } catch {
      /* sin ese archivo */
    }
  }
  // Con otro proveedor conectado (su clave de Anthropic, OpenAI…) opencode puede elegir bien el modelo chico: no se toca.
  for (const b of [env.XDG_DATA_HOME, path.join(home, ".local", "share")]) {
    if (!b) continue;
    try {
      if (Object.keys(JSON.parse(leer(path.join(b, "opencode", "auth.json")))).some((k) => k !== "opencode")) return env;
    } catch {
      /* sin auth.json */
    }
  }
  let previo = {};
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

/**
 * Espejo de conPermisoFuera de app/electron/opencode.ts (duplicado a propósito): `permission.external_directory` en la config de opencode, `deny` en el
 * runner `run` (sin ACP nadie contesta un permiso). Si la persona ya fijó external_directory (en OPENCODE_CONFIG_CONTENT o su config global) o un
 * `permission` que no es objeto, no se toca.
 */
export function conPermisoFuera(env = process.env, valor = "deny", home = os.homedir(), leer = (f) => readFileSync(f, "utf8")) {
  let previo = {};
  if (env.OPENCODE_CONFIG_CONTENT) {
    try {
      previo = JSON.parse(env.OPENCODE_CONFIG_CONTENT);
      if (!previo || typeof previo !== "object" || Array.isArray(previo)) return env;
    } catch {
      return env;
    }
  }
  const permiso = previo.permission;
  if (permiso !== undefined && (!permiso || typeof permiso !== "object" || Array.isArray(permiso))) return env;
  if (permiso && "external_directory" in permiso) return env;
  const base = env.XDG_CONFIG_HOME || path.join(home, ".config");
  for (const f of [env.OPENCODE_CONFIG, path.join(base, "opencode", "opencode.json"), path.join(base, "opencode", "opencode.jsonc"), path.join(home, ".opencode", "opencode.json")]) {
    if (!f) continue;
    try {
      if (/["']external_directory["']\s*:/.test(leer(f))) return env;
    } catch {
      /* sin ese archivo */
    }
  }
  return { ...env, OPENCODE_CONFIG_CONTENT: JSON.stringify({ ...previo, permission: { ...permiso, external_directory: valor } }) };
}
