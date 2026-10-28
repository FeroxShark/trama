// Las API keys de los proveedores de DeepSeek Harness (OpenCode, DeepSeek): `~/.config/trama/claves.env` (`XDG_CONFIG_HOME` lo mueve),
// con modo 0600 en una carpeta 0700. Líneas `NOMBRE=valor` sin comillas ni `export`, sólo de los nombres que se conocen. Es el
// contrato que comparten la app y el motor (motor/dsh): si cambia uno, cambia el otro. Una key ya puesta en el entorno del proceso gana.
// Las keys son de escritura: la interfaz nunca las recibe de vuelta, sólo si hay o no (`hayClaves`).
// Node puro: los tests lo usan directo (`TRAMA_CLAVES` cambia la ruta).
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { errorT } from "./errores.ts";
import { configTrama } from "./rutas.ts";

export const NOMBRES_CLAVE = ["OPENCODE_API_KEY", "DEEPSEEK_API_KEY", "ARTIFICIAL_ANALYSIS_API_KEY", "NVIDIA_API_KEY"] as const;
/**
 * La de Artificial Analysis es de la app (baja los índices de inteligencia): no va al entorno de ningún líder ni worker. La de NVIDIA NIM
 * la lee `pa` del mismo archivo al lanzar un worker de opencode: tampoco va al entorno del líder.
 */
export const CLAVES_DE_PROVEEDOR = ["OPENCODE_API_KEY", "DEEPSEEK_API_KEY"] as const;
export type NombreClave = (typeof NOMBRES_CLAVE)[number];
export const esNombreClave = (n: unknown): n is NombreClave => (NOMBRES_CLAVE as readonly string[]).includes(n as string);

type Env = Record<string, string | undefined>;

/** Dónde está el archivo (se mira cada vez: los tests lo cambian por el entorno). */
export const rutaClaves = (env: Env = process.env) => env.TRAMA_CLAVES || path.join(configTrama(env), "claves.env");

/** El texto del archivo → las keys que se conocen. Ignora lo demás (comentarios, nombres ajenos, líneas rotas) y una comilla de más. */
export function analizarClaves(texto: string): Partial<Record<NombreClave, string>> {
  const r: Partial<Record<NombreClave, string>> = {};
  for (const linea of texto.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(linea);
    if (!m || !esNombreClave(m[1])) continue;
    let v = m[2].trim();
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    if (v) r[m[1]] = v;
  }
  return r;
}

/** Las keys guardadas; sin archivo (o ilegible) no hay ninguna. */
export async function leerClaves(ruta = rutaClaves()): Promise<Partial<Record<NombreClave, string>>> {
  try {
    return analizarClaves(await readFile(ruta, "utf8"));
  } catch {
    return {};
  }
}

/** Lo mismo, síncrono: para armar el entorno de un líder al lanzarlo. */
export function leerClavesSync(ruta = rutaClaves()): Partial<Record<NombreClave, string>> {
  try {
    return analizarClaves(readFileSync(ruta, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Los valores secretos de los servidores MCP propios (Ajustes > Conectores): `MCP_<SERVIDOR>__E_<VARIABLE>` (entorno de un stdio) o
 * `MCP_<SERVIDOR>__H_<CABECERA>` (cabecera de un http/sse). Viven en este mismo archivo, nunca en `mcp.json`. `guardarClave` los conserva.
 */
export const esClaveMcp = (n: unknown): n is string => typeof n === "string" && /^MCP_[A-Z0-9_]{1,200}$/.test(n);

/** Las líneas `MCP_…=valor` del texto. */
export function analizarClavesMcp(texto: string): Record<string, string> {
  const r: Record<string, string> = {};
  for (const linea of texto.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(linea);
    if (!m || !esClaveMcp(m[1])) continue;
    const v = m[2].trim();
    if (v) r[m[1]] = v;
  }
  return r;
}

export async function leerClavesMcp(ruta = rutaClaves()): Promise<Record<string, string>> {
  try {
    return analizarClavesMcp(await readFile(ruta, "utf8"));
  } catch {
    return {};
  }
}

export function leerClavesMcpSync(ruta = rutaClaves()): Record<string, string> {
  try {
    return analizarClavesMcp(readFileSync(ruta, "utf8"));
  } catch {
    return {};
  }
}

/** Un valor de un servidor MCP: una línea (puede llevar espacios: `Bearer …`), sin saltos ni nulos ni comillas que lo envuelvan. */
const validoMcp = (v: string) => v.length > 0 && v.length <= 4096 && !/[\r\n\0]/.test(v) && !/^(["']).*\1$/.test(v);

async function escribir(ruta: string, hoy: Partial<Record<NombreClave, string>>, mcp: Record<string, string>) {
  const texto =
    NOMBRES_CLAVE.filter((n) => hoy[n]).map((n) => `${n}=${hoy[n]}\n`).join("") +
    Object.keys(mcp).sort().map((n) => `${n}=${mcp[n]}\n`).join("");
  const dir = path.dirname(ruta);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = `${ruta}.trama-${process.pid}.tmp`;
  await writeFile(tmp, texto, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, ruta);
}

/** Guarda (valor) o borra (`null`) valores de servidores MCP, todos de una vez; el resto del archivo queda como estaba. Valida antes de escribir. */
export async function guardarClavesMcp(cambios: Record<string, string | null>, ruta = rutaClaves()): Promise<void> {
  for (const [n, v] of Object.entries(cambios)) {
    if (!esClaveMcp(n)) throw errorT("main.claveNombre", { v: String(n).slice(0, 40) });
    if (v !== null && (typeof v !== "string" || !validoMcp(v.trim()))) throw errorT("main.mcpValor");
  }
  const hoy = await leerClaves(ruta);
  const mcp = await leerClavesMcp(ruta);
  for (const [n, v] of Object.entries(cambios)) {
    if (v === null) delete mcp[n];
    else mcp[n] = v.trim();
  }
  await escribir(ruta, hoy, mcp);
}

/** Un valor que cabe en una línea sin comillas: sin espacios, saltos ni nulos (una key de verdad no los tiene). */
const valido = (v: string) => v.length > 0 && v.length <= 512 && !/[\s\0"'\\]/.test(v);

/**
 * Guarda (o borra con `null`) una key y deja el archivo en 0600 (tmp + rename en la misma carpeta; la carpeta se crea en 0700).
 * Rechaza sin tocar nada un nombre que no se conoce o un valor que no cabe en una línea. Sin keys el archivo queda vacío (no se quita).
 * Devuelve cuáles quedaron.
 */
export async function guardarClave(nombre: unknown, valor: string | null, ruta = rutaClaves()): Promise<Record<NombreClave, boolean>> {
  if (!esNombreClave(nombre)) throw errorT("main.claveNombre", { v: String(nombre).slice(0, 40) });
  if (valor !== null && (typeof valor !== "string" || !valido((valor = valor.trim())))) throw errorT("main.claveValor");
  const hoy = await leerClaves(ruta);
  if (valor === null) delete hoy[nombre];
  else hoy[nombre] = valor;
  await escribir(ruta, hoy, await leerClavesMcp(ruta));
  return hayClaves(hoy);
}

/** Qué keys hay (sólo si hay, nunca el valor). Las del entorno del proceso cuentan: son las que ganan. */
export function hayClaves(guardadas: Partial<Record<NombreClave, string>>, env: Env = process.env): Record<NombreClave, boolean> {
  return {
    OPENCODE_API_KEY: !!(env.OPENCODE_API_KEY || guardadas.OPENCODE_API_KEY),
    DEEPSEEK_API_KEY: !!(env.DEEPSEEK_API_KEY || guardadas.DEEPSEEK_API_KEY),
    ARTIFICIAL_ANALYSIS_API_KEY: !!(env.ARTIFICIAL_ANALYSIS_API_KEY || guardadas.ARTIFICIAL_ANALYSIS_API_KEY),
    NVIDIA_API_KEY: !!(env.NVIDIA_API_KEY || guardadas.NVIDIA_API_KEY),
  };
}

/** El entorno con las keys guardadas debajo: una variable ya puesta en `env` no se pisa. */
export function conClaves(env: Env, guardadas: Partial<Record<NombreClave, string>> = leerClavesSync()): Env {
  const e: Env = { ...env };
  for (const n of CLAVES_DE_PROVEEDOR) if (!e[n] && guardadas[n]) e[n] = guardadas[n];
  return e;
}
