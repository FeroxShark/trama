// OpenCode (`opencode`, https://opencode.ai) como motor de workers de pa: sus modelos GRATIS (`*-free`, `big-pickle`…) sólo andan dentro del
// programa oficial (con el login de OpenCode Console); desde otro cliente devuelven 429 FreeUsageLimitError. Sin dependencias y sin importar
// nada de app/ (pa corre sin la app). OJO: app/electron/opencode.ts duplica esto A PROPÓSITO; si cambia uno, cambia el otro
// (tests/opencode.test.ts y tests/opencode-correr.test.ts cubren cada uno).
//
// Convención de modelo en Trama: `opencode:<proveedor>/<modelo>`, p. ej. `opencode:opencode/deepseek-v4.1-flash-free` (lo que imprime
// `opencode models`, con el prefijo). El modelo puede llevar `:` y `/` (se parte en la primera `/`).
import { accessSync, constants } from "node:fs";
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
