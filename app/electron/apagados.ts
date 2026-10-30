// El apagado GLOBAL de Trama (panel de contexto): un registro único de skills, servidores MCP, herramientas y archivos de memoria
// (CLAUDE.md y compañía) que ningún líder ni worker de Claude carga, para que el contexto pese menos. Vive en
// `<config de trama>/apagados.json` y de él sale `apagados-claude.json`: el pedazo de settings de Claude Code que lo aplica
// (`skillOverrides`, `permissions.deny` y `claudeMdExcludes`). Ese pedazo lo suman `pa` (motor/bin/pa y su port, cli/pa/lanzar.ts)
// al `--settings` de cada worker y `argvLider` al de cada líder (un segundo `--settings`). Sin nada apagado no hay archivo y todo
// queda como siempre. Nunca toca `~/.claude.json` ni credenciales: sólo estos dos archivos propios. Node puro: los tests pasan la carpeta.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { errorT } from "./errores.ts";
import { configTrama } from "./rutas.ts";

export type TipoApagado = "skills" | "mcp" | "herramientas" | "memoria";
export const TIPOS_APAGADO: readonly TipoApagado[] = ["skills", "mcp", "herramientas", "memoria"];

export type Apagados = { version: 1 } & Record<TipoApagado, string[]>;

/** Lo que Claude Code entiende del registro: el pedazo de settings que se suma al de cada líder y worker. */
export type FragmentoClaude = { skillOverrides?: Record<string, "off">; permissions?: { deny: string[] }; claudeMdExcludes?: string[] };

/**
 * Herramientas que no se apagan: sin ellas un worker no puede leer, editar ni verificar, y `pa` no lo puede cerrar.
 * (Un líder sin Bash tampoco lanza workers.)
 */
export const HERRAMIENTAS_PROTEGIDAS: readonly string[] = ["Bash", "Read", "Edit", "Write"];

/** Cuántos de cada tipo como mucho (un registro que crece sin fin es un error, no un uso). */
const MAX_POR_TIPO = 500;

export const vacios = (): Apagados => ({ version: 1, skills: [], mcp: [], herramientas: [], memoria: [] });

/** El registro y el pedazo de settings derivado, en la carpeta de configuración de trama (`~/.config/trama` o `%LOCALAPPDATA%\trama\config`). */
export const archivoApagados = (dir = configTrama()) => path.join(dir, "apagados.json");
export const archivoFragmento = (dir = configTrama()) => path.join(dir, "apagados-claude.json");

/** Un nombre que se puede guardar: una línea, sin caracteres de control, de largo razonable. */
const nombreBien = (x: unknown): x is string => typeof x === "string" && x.trim() === x && x.length > 0 && x.length <= 300 && !/[\u0000-\u001f\u007f]/.test(x);

/**
 * ¿Vale ese nombre para ese tipo?
 * - skills: el nombre de la skill tal como la lista Claude Code (`nombre` o `plugin:nombre`).
 * - mcp: el nombre del servidor como lo muestra `/mcp` o `claude mcp list` (`claude.ai Notion`, `plugin:x:y`, `github`).
 * - herramientas: una integrada (`WebFetch`) o una de un MCP (`mcp__servidor__herramienta`); nunca las protegidas.
 * - memoria: una ruta absoluta o un glob absoluto (`/home/x/CLAUDE.md`, `**\/proyecto/CLAUDE.local.md`), como `claudeMdExcludes`.
 */
export function nombreValido(tipo: TipoApagado, x: unknown): x is string {
  if (!nombreBien(x)) return false;
  if (tipo === "herramientas") return /^(?:[A-Za-z][\w-]*|mcp__[\w-]+(?:__[\w-]+)?)$/.test(x) && !HERRAMIENTAS_PROTEGIDAS.includes(x);
  if (tipo === "memoria") return x.startsWith("/") || x.startsWith("**/") || /^[A-Za-z]:[\\/]/.test(x) || x.startsWith("\\\\");
  if (tipo === "skills") return !/\s/.test(x);
  return true;
}

/** Un registro leído (o recibido) limpio: sólo listas de nombres válidos, sin repetir, con su tope. */
export function normalizar(x: unknown): Apagados {
  const r = vacios();
  if (!x || typeof x !== "object" || Array.isArray(x)) return r;
  const o = x as Record<string, unknown>;
  for (const t of TIPOS_APAGADO) {
    const l = Array.isArray(o[t]) ? (o[t] as unknown[]) : [];
    r[t] = [...new Set(l.filter((n): n is string => nombreValido(t, n)))].slice(0, MAX_POR_TIPO);
  }
  return r;
}

export function leerApagadosTrama(dir = configTrama()): Apagados {
  try {
    return normalizar(JSON.parse(readFileSync(archivoApagados(dir), "utf8")));
  } catch {
    return vacios();
  }
}

/** El nombre de un servidor como lo usa Claude Code en las herramientas (`mcp__<esto>__…`): lo que no es letra, número, `_` o `-` pasa a `_`. */
export const servidorNormalizado = (nombre: string) => nombre.replace(/[^A-Za-z0-9_-]/g, "_");

/** El pedazo de settings de Claude Code; `null` si no hay nada apagado (entonces no hay archivo y nada cambia). */
export function fragmentoClaude(a: Apagados): FragmentoClaude | null {
  const f: FragmentoClaude = {};
  if (a.skills.length) f.skillOverrides = Object.fromEntries(a.skills.map((s) => [s, "off" as const]));
  const deny = [...new Set([...a.mcp.map((s) => `mcp__${servidorNormalizado(s)}`), ...a.herramientas])];
  if (deny.length) f.permissions = { deny };
  if (a.memoria.length) f.claudeMdExcludes = [...a.memoria];
  return Object.keys(f).length ? f : null;
}

function escribirAtomico(ruta: string, texto: string) {
  mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.${process.pid}.tmp`;
  writeFileSync(tmp, texto);
  renameSync(tmp, ruta);
}

/** Guarda el registro y rehace (o borra, si no queda nada) el pedazo de settings. Devuelve el registro guardado. */
export function guardarApagados(x: unknown, dir = configTrama()): Apagados {
  const a = normalizar(x);
  escribirAtomico(archivoApagados(dir), JSON.stringify(a, null, 2) + "\n");
  const f = fragmentoClaude(a);
  if (f) escribirAtomico(archivoFragmento(dir), JSON.stringify(f) + "\n");
  else rmSync(archivoFragmento(dir), { force: true });
  return a;
}

/** Apaga (`apagado: true`) o prende una cosa. Un tipo o un nombre que no vale (o una herramienta protegida) es un error. */
export function fijarApagadoTrama(tipo: unknown, nombre: unknown, apagado: unknown, dir = configTrama()): Apagados {
  if (!(TIPOS_APAGADO as readonly unknown[]).includes(tipo) || typeof apagado !== "boolean") throw errorT("main.apagadoRaro", { v: String(tipo) });
  const t = tipo as TipoApagado;
  if (!nombreValido(t, nombre)) throw errorT("main.apagadoRaro", { v: String(nombre).slice(0, 80) });
  const a = leerApagadosTrama(dir);
  const ya = a[t].includes(nombre);
  if (ya === apagado) return a;
  a[t] = apagado ? [...a[t], nombre] : a[t].filter((n) => n !== nombre);
  return guardarApagados(a, dir);
}

/** La ruta del pedazo de settings si hay algo apagado (lo que va a `--settings`); `undefined` si no. */
export function fragmentoVigente(dir = configTrama()): string | undefined {
  const f = fragmentoClaude(leerApagadosTrama(dir));
  if (!f) return undefined;
  const ruta = archivoFragmento(dir);
  // Si el registro se editó a mano, el pedazo se rehace acá: lo que se aplica es siempre lo del registro.
  try {
    if (readFileSync(ruta, "utf8") === JSON.stringify(f) + "\n") return ruta;
  } catch {
    /* no estaba */
  }
  escribirAtomico(ruta, JSON.stringify(f) + "\n");
  return ruta;
}

/**
 * Sumar el pedazo de settings al `--settings` de un worker (lo mismo que hacen `pa` en bash con jq y `settingsWorker` en el port): los
 * `claudeMdExcludes` y los `deny` se agregan a los que ya tiene, `skillOverrides` se pone. Lo que no es de esas tres claves no se toca.
 */
export function sumarFragmento(s: Record<string, unknown>, f: unknown): Record<string, unknown> {
  if (!f || typeof f !== "object" || Array.isArray(f)) return s;
  const o = f as Record<string, unknown>;
  const lista = (x: unknown) => (Array.isArray(x) ? x.filter((y): y is string => typeof y === "string") : []);
  s.claudeMdExcludes = [...lista(s.claudeMdExcludes), ...lista(o.claudeMdExcludes)];
  const so = o.skillOverrides;
  if (so && typeof so === "object" && !Array.isArray(so) && Object.keys(so).length) s.skillOverrides = so;
  const antes = s.permissions && typeof s.permissions === "object" ? lista((s.permissions as Record<string, unknown>).deny) : [];
  const deny = [...antes, ...lista((o.permissions as Record<string, unknown> | undefined)?.deny)];
  if (deny.length) s.permissions = { deny };
  return s;
}
