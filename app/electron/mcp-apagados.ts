// `/mcp` de un líder: los conectores que Claude Code apagó para el proyecto (`projects[<carpeta>].disabledMcpServers` de `~/.claude.json`, p. ej.
// «claude.ai Notion») y prenderlos o apagarlos desde la app. Ese archivo trae las credenciales de la cuenta: se lee entero pero SÓLO se toca esa
// clave de ese proyecto, el resto se reescribe tal cual (mismo orden, misma sangría, mismo modo) y de su contenido nunca sale ni se loguea nada
// más que los nombres de esos conectores. Con varias cuentas, el archivo es el de la cuenta activa (la preferida de `cuentas preferir`).
// Node puro: los tests pasan el entorno, el home y la plataforma.
import { chmod, readFile, rename, stat, writeFile } from "node:fs/promises";
import { errorT } from "./errores.ts";
import { caminoDe, homeDe, plataformaActual, type Plataforma } from "./rutas.ts";
import { cuentasClaude, preferidaClaude } from "./uso-cuentas.ts";

type Env = Record<string, string | undefined>;
type Json = Record<string, unknown>;
const esObj = (x: unknown): x is Json => !!x && typeof x === "object" && !Array.isArray(x);
const lista = (x: unknown): string[] => (Array.isArray(x) ? x.filter((y): y is string => typeof y === "string") : []);

/** De dónde sale la config de Claude Code de la cuenta activa: su carpeta y su `.claude.json`, y el proyecto del líder (su home). */
export type ConfigActiva = { cuenta: string | null; dir: string; archivo: string; proyecto: string };

/** La cuenta activa es la preferida si existe (su carpeta propia); si no, la de siempre (`CLAUDE_CONFIG_DIR` o `~/.claude`). */
export function configActiva(env: Env = process.env, home = homeDe(env), plat: Plataforma = plataformaActual()): ConfigActiva {
  const c = caminoDe(plat);
  const pref = preferidaClaude(env, home, plat);
  const cuenta = pref ? cuentasClaude(env, home, plat).find((x) => x.id === pref) : undefined;
  if (cuenta) return { cuenta: cuenta.id, dir: cuenta.dir, archivo: c.join(cuenta.dir, ".claude.json"), proyecto: home };
  if (env.CLAUDE_CONFIG_DIR) return { cuenta: null, dir: env.CLAUDE_CONFIG_DIR, archivo: c.join(env.CLAUDE_CONFIG_DIR, ".claude.json"), proyecto: home };
  return { cuenta: null, dir: c.join(home, ".claude"), archivo: c.join(home, ".claude.json"), proyecto: home };
}

/** Claude Code guarda las carpetas con `/` también en Windows; para comparar se unifica y, en Windows, no se distingue mayúscula. */
const clave = (p: string, plat: Plataforma) => {
  const n = p.replace(/\\/g, "/").replace(/\/+$/, "");
  return plat === "win32" ? n.toLowerCase() : n;
};

/** El nombre de un conector: una línea, sin caracteres de control, de largo razonable. */
export function nombreConectorValido(x: unknown): x is string {
  return typeof x === "string" && x.length > 0 && x.length <= 200 && !/[\u0000-\u001f\u007f]/.test(x);
}

type Leido = { crudo: string; json: Json };

async function leer(archivo: string): Promise<Leido | null> {
  let crudo: string;
  try {
    crudo = await readFile(archivo, "utf8");
  } catch {
    return null;
  }
  try {
    const json = JSON.parse(crudo);
    if (!esObj(json)) throw new Error("no es un objeto");
    return { crudo, json };
  } catch {
    // Sólo el nombre del archivo: del contenido, ni un pedazo.
    throw errorT("main.conectoresIlegible", { f: ".claude.json" });
  }
}

/** La clave de `projects` que corresponde a esa carpeta, si Claude Code ya la tiene. */
function claveProyecto(json: Json, proyecto: string, plat: Plataforma): string | null {
  const proyectos = json.projects;
  if (!esObj(proyectos)) return null;
  const buscada = clave(proyecto, plat);
  return Object.keys(proyectos).find((k) => clave(k, plat) === buscada) ?? null;
}

function apagadosDe(json: Json, proyecto: string, plat: Plataforma): string[] {
  const k = claveProyecto(json, proyecto, plat);
  const p = k === null ? null : (json.projects as Json)[k];
  return esObj(p) ? lista(p.disabledMcpServers) : [];
}

/** Los conectores apagados para el proyecto; vacío si no hay archivo, no hay proyecto o no hay lista. Si el archivo no se puede leer, tira. */
export async function leerApagados(cfg: ConfigActiva, plat: Plataforma = plataformaActual()): Promise<string[]> {
  const l = await leer(cfg.archivo);
  return l ? [...new Set(apagadosDe(l.json, cfg.proyecto, plat))] : [];
}

/** La sangría con que está escrito el archivo (2 espacios si no se nota), para que reescribirlo no lo cambie entero. */
const sangriaDe = (crudo: string): string | number => /^\{\r?\n([ \t]+)"/.exec(crudo)?.[1] ?? 2;

/**
 * Apaga (`apagado: true`) o prende un conector para el proyecto: cambia sólo `projects[<carpeta>].disabledMcpServers`. Si ya está como se
 * pide no escribe nada. La escritura es atómica (archivo temporal al lado y `rename`, con el mismo modo que tenía) y el archivo se vuelve
 * a leer justo antes, para no pisar lo que Claude Code haya guardado en el medio. Devuelve la lista nueva.
 */
export async function fijarApagado(cfg: ConfigActiva, nombre: unknown, apagado: unknown, plat: Plataforma = plataformaActual()): Promise<string[]> {
  if (!nombreConectorValido(nombre) || typeof apagado !== "boolean") throw errorT("main.conectoresNoExiste");
  const l = await leer(cfg.archivo);
  if (!l) throw errorT("main.conectoresIlegible", { f: ".claude.json" });
  const k = claveProyecto(l.json, cfg.proyecto, plat);
  const actuales = apagadosDe(l.json, cfg.proyecto, plat);
  if (actuales.includes(nombre) === apagado) return [...new Set(actuales)];
  const nuevos = apagado ? [...actuales, nombre] : actuales.filter((n) => n !== nombre);
  if (k === null) {
    // Un proyecto que Claude Code todavía no conoce: sólo se crea para apagar algo.
    const proyectos = esObj(l.json.projects) ? l.json.projects : {};
    proyectos[cfg.proyecto.replace(/\\/g, "/")] = { disabledMcpServers: nuevos };
    l.json.projects = proyectos;
  } else ((l.json.projects as Json)[k] as Json).disabledMcpServers = nuevos;
  const salida = JSON.stringify(l.json, null, sangriaDe(l.crudo)) + (l.crudo.endsWith("\n") ? "\n" : "");
  const tmp = `${cfg.archivo}.trama-${process.pid}.tmp`;
  const modo = (await stat(cfg.archivo)).mode & 0o777;
  await writeFile(tmp, salida, { mode: 0o600 });
  await chmod(tmp, modo);
  await rename(tmp, cfg.archivo);
  return [...new Set(nuevos)];
}
