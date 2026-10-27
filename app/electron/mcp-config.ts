// Los servidores MCP propios de Trama (Ajustes > Conectores): `~/.config/trama/mcp.json` guarda el qué (nombre, tipo, comando y argumentos
// o URL, y los NOMBRES de sus variables); los VALORES de esas variables (tokens, cabeceras) van a `claves.env` y nunca a `mcp.json`, a un log ni
// de vuelta a la interfaz (sólo se sabe si hay). Acá también se arma lo que cada motor de un líder recibe: el JSON de `--mcp-config` de Claude
// y la lista `mcpServers` de ACP (DeepSeek Harness y OpenCode). Node puro: los tests pasan las rutas.
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { esClaveMcp, guardarClavesMcp, leerClavesMcp, leerClavesMcpSync, rutaClaves } from "./claves.ts";
import { errorT } from "./errores.ts";
import { configTrama } from "./rutas.ts";

type Env = Record<string, string | undefined>;

export const TIPOS_MCP = ["stdio", "http", "sse"] as const;
export type TipoMcp = (typeof TIPOS_MCP)[number];
export const esTipoMcp = (t: unknown): t is TipoMcp => (TIPOS_MCP as readonly unknown[]).includes(t);

/** Una variable de un servidor: del entorno (stdio) o una cabecera HTTP (http / sse). Sólo el nombre; el valor está en `claves.env`. */
export type VariableMcp = { tipo: "env" | "cabecera"; nombre: string };

/** Lo que queda en `mcp.json`. */
export type ServidorMcp = {
  nombre: string;
  tipo: TipoMcp;
  /** stdio */
  comando?: string;
  args?: string[];
  /** http / sse */
  url?: string;
  variables: VariableMcp[];
};

/** Lo que manda la interfaz al guardar: `valor` ausente o vacío deja el que ya había; `null` lo borra. */
export type EntradaMcp = Omit<ServidorMcp, "variables"> & { variables: (VariableMcp & { valor?: string | null })[] };

/** Lo que la interfaz ve: igual que `ServidorMcp` pero cada variable con `hay` (si tiene valor guardado). Nunca el valor. */
export type VistaServidorMcp = Omit<ServidorMcp, "variables"> & { variables: (VariableMcp & { hay: boolean })[] };

export const rutaMcp = (env: Env = process.env) => env.TRAMA_MCP || path.join(configTrama(env), "mcp.json");

const NOMBRE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const VARIABLE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;

/** El nombre de la clave en `claves.env` de una variable de un servidor. */
export function claveDe(servidor: string, v: VariableMcp): string {
  const s = servidor.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const n = v.nombre.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return `MCP_${s}__${v.tipo === "env" ? "E" : "H"}_${n}`;
}

const texto = (x: unknown) => (typeof x === "string" ? x : "");

/** Valida un servidor (de la interfaz o del archivo); tira con el motivo traducible. Devuelve la forma limpia. */
export function validarServidor(x: unknown): ServidorMcp {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const nombre = texto(o.nombre).trim();
  if (!NOMBRE.test(nombre)) throw errorT("main.mcpNombre");
  if (!esTipoMcp(o.tipo)) throw errorT("main.mcpTipo", { v: String(o.tipo).slice(0, 20) });
  const variables: VariableMcp[] = [];
  for (const v of Array.isArray(o.variables) ? o.variables : []) {
    const tipo = v?.tipo === "cabecera" ? "cabecera" : "env";
    const n = texto(v?.nombre).trim();
    if (!VARIABLE.test(n)) throw errorT("main.mcpVariable", { v: n.slice(0, 40) });
    if (variables.some((y) => y.tipo === tipo && y.nombre.toLowerCase() === n.toLowerCase())) throw errorT("main.mcpVariableRepetida", { v: n });
    variables.push({ tipo, nombre: n });
  }
  if (o.tipo === "stdio") {
    const comando = texto(o.comando).trim();
    if (!comando || /\0/.test(comando) || comando.startsWith("-")) throw errorT("main.mcpComando");
    const args = (Array.isArray(o.args) ? o.args : []).map((a) => texto(a)).filter((a) => a !== "");
    if (args.some((a) => /\0/.test(a))) throw errorT("main.mcpComando");
    return { nombre, tipo: "stdio", comando, args, variables: variables.filter((v) => v.tipo === "env") };
  }
  const url = texto(o.url).trim();
  let ok = false;
  try {
    const u = new URL(url);
    ok = u.protocol === "https:" || u.protocol === "http:";
  } catch {
    /* mal armada */
  }
  if (!ok) throw errorT("main.mcpUrl");
  return { nombre, tipo: o.tipo, url, variables: variables.filter((v) => v.tipo === "cabecera") };
}

/** Los servidores guardados; un archivo que falta o está roto no tumba nada (se ignoran los renglones malos). */
export function leerMcpSync(ruta = rutaMcp()): ServidorMcp[] {
  let j: unknown;
  try {
    j = JSON.parse(readFileSync(ruta, "utf8"));
  } catch {
    return [];
  }
  return filas(j);
}

export async function leerMcp(ruta = rutaMcp()): Promise<ServidorMcp[]> {
  try {
    return filas(JSON.parse(await readFile(ruta, "utf8")));
  } catch {
    return [];
  }
}

function filas(j: unknown): ServidorMcp[] {
  const lista = (j as { servidores?: unknown })?.servidores;
  const r: ServidorMcp[] = [];
  for (const x of Array.isArray(lista) ? lista : []) {
    try {
      const s = validarServidor(x);
      if (!r.some((y) => y.nombre.toLowerCase() === s.nombre.toLowerCase())) r.push(s);
    } catch {
      /* un renglón roto no tira los demás */
    }
  }
  return r;
}

async function escribirMcp(ruta: string, servidores: ServidorMcp[]) {
  const dir = path.dirname(ruta);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = `${ruta}.trama-${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify({ version: 1, servidores }, null, 2) + "\n", { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, ruta);
}

export async function vistaMcp(rutas: { mcp?: string; claves?: string } = {}): Promise<VistaServidorMcp[]> {
  const servidores = await leerMcp(rutas.mcp);
  const guardadas = await leerClavesMcp(rutas.claves);
  return servidores.map((s) => ({ ...s, variables: s.variables.map((v) => ({ ...v, hay: !!guardadas[claveDe(s.nombre, v)] })) }));
}

/**
 * Agrega o reemplaza un servidor (por nombre, sin importar mayúsculas). Los valores nuevos van a `claves.env`; los de variables que ya
 * no están se borran de ahí; un valor ausente o vacío conserva el guardado. Valida todo antes de escribir algo. Devuelve cómo quedó.
 */
export async function guardarServidor(entrada: unknown, rutas: { mcp?: string; claves?: string } = {}): Promise<VistaServidorMcp[]> {
  const s = validarServidor(entrada);
  const dadas = (Array.isArray((entrada as EntradaMcp)?.variables) ? (entrada as EntradaMcp).variables : []) as { tipo?: unknown; nombre?: unknown; valor?: unknown }[];
  const ruta = rutas.mcp ?? rutaMcp();
  const hoy = await leerMcp(ruta);
  const previo = hoy.find((y) => y.nombre.toLowerCase() === s.nombre.toLowerCase());
  const cambios: Record<string, string | null> = {};
  for (const v of s.variables) {
    const d = dadas.find((x) => (x.tipo === "cabecera" ? "cabecera" : "env") === v.tipo && texto(x.nombre).trim() === v.nombre);
    if (typeof d?.valor === "string" && d.valor.trim()) cambios[claveDe(s.nombre, v)] = d.valor;
    else if (d?.valor === null) cambios[claveDe(s.nombre, v)] = null;
  }
  // Lo que ya no está: se borra su valor.
  for (const v of previo?.variables ?? []) if (!s.variables.some((y) => y.tipo === v.tipo && y.nombre === v.nombre)) cambios[claveDe(previo!.nombre, v)] = null;
  // Una variable sin valor ni uno guardado no sirve: se pide.
  const guardadas = await leerClavesMcp(rutas.claves);
  for (const v of s.variables) {
    const k = claveDe(s.nombre, v);
    if (cambios[k] === null || (cambios[k] === undefined && !guardadas[k])) throw errorT("main.mcpSinValor", { v: v.nombre });
  }
  // Primero los valores (validan), después la lista: un valor malo no deja un servidor a medias.
  if (Object.keys(cambios).length) await guardarClavesMcp(cambios, rutas.claves ?? rutaClaves());
  const lista = previo ? hoy.map((y) => (y === previo ? s : y)) : [...hoy, s];
  await escribirMcp(ruta, lista);
  return vistaMcp(rutas);
}

export async function quitarServidor(nombre: unknown, rutas: { mcp?: string; claves?: string } = {}): Promise<VistaServidorMcp[]> {
  const ruta = rutas.mcp ?? rutaMcp();
  const hoy = await leerMcp(ruta);
  const x = hoy.find((y) => y.nombre.toLowerCase() === texto(nombre).trim().toLowerCase());
  if (x) {
    const cambios: Record<string, string | null> = {};
    for (const v of x.variables) cambios[claveDe(x.nombre, v)] = null;
    if (Object.keys(cambios).length) await guardarClavesMcp(cambios, rutas.claves ?? rutaClaves());
    await escribirMcp(ruta, hoy.filter((y) => y !== x));
  }
  return vistaMcp(rutas);
}

// --- Lo que recibe cada motor ----------------------------------------------------------------------------------------------------------

/** Un servidor con sus valores a la vista: sólo en memoria, para armar el pedido a un motor. Nunca se loguea. */
export type ServidorResuelto = ServidorMcp & { valores: Record<string, string> };

/** Los servidores de Trama con sus valores; uno al que le falta un valor se deja afuera (arrancaría roto). */
export function resueltos(servidores: ServidorMcp[] = leerMcpSync(), claves: Record<string, string> = leerClavesMcpSync()): ServidorResuelto[] {
  const r: ServidorResuelto[] = [];
  for (const s of servidores) {
    const valores: Record<string, string> = {};
    for (const v of s.variables) {
      const x = claves[claveDe(s.nombre, v)];
      if (x) valores[v.nombre] = x;
    }
    if (s.variables.every((v) => valores[v.nombre])) r.push({ ...s, valores });
  }
  return r;
}

const cab = (s: ServidorResuelto) => s.variables.filter((v) => v.tipo === "cabecera");
const env = (s: ServidorResuelto) => s.variables.filter((v) => v.tipo === "env");

/** El JSON de `--mcp-config` de Claude (`{ mcpServers: { … } }`). Con valores: va a un archivo 0600, nunca al argv. */
export function jsonClaude(servidores: ServidorResuelto[]): string {
  const mcpServers: Record<string, unknown> = {};
  for (const s of servidores) {
    mcpServers[s.nombre] =
      s.tipo === "stdio"
        ? { type: "stdio", command: s.comando, args: s.args ?? [], ...(env(s).length ? { env: Object.fromEntries(env(s).map((v) => [v.nombre, s.valores[v.nombre]])) } : {}) }
        : { type: s.tipo, url: s.url, ...(cab(s).length ? { headers: Object.fromEntries(cab(s).map((v) => [v.nombre, s.valores[v.nombre]])) } : {}) };
  }
  return JSON.stringify({ mcpServers });
}

/** `mcpServers` de `session/new` y `session/resume` de ACP: stdio con `env` como lista de pares; http / sse con `headers` como lista de pares. */
export function paraAcp(servidores: ServidorResuelto[]): unknown[] {
  return servidores.map((s) =>
    s.tipo === "stdio"
      ? { name: s.nombre, command: s.comando, args: s.args ?? [], env: env(s).map((v) => ({ name: v.nombre, value: s.valores[v.nombre] })) }
      : { type: s.tipo, name: s.nombre, url: s.url, headers: cab(s).map((v) => ({ name: v.nombre, value: s.valores[v.nombre] })) },
  );
}

/** Lo mismo para el config de `opencode` (sección `mcp`): `local` con `command` en una lista y `environment`; `remote` con `headers`. */
export function paraOpencode(servidores: ServidorResuelto[]): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const s of servidores)
    r[s.nombre] =
      s.tipo === "stdio"
        ? { type: "local", command: [s.comando, ...(s.args ?? [])], enabled: true, ...(env(s).length ? { environment: Object.fromEntries(env(s).map((v) => [v.nombre, s.valores[v.nombre]])) } : {}) }
        : { type: "remote", url: s.url, enabled: true, ...(cab(s).length ? { headers: Object.fromEntries(cab(s).map((v) => [v.nombre, s.valores[v.nombre]])) } : {}) };
  return r;
}

/** Cada valor secreto (para sacarlo de lo que se loguee). */
export const secretosDe = (servidores: ServidorResuelto[]): string[] => servidores.flatMap((s) => Object.values(s.valores));

export { esClaveMcp };
