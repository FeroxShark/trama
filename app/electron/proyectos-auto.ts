// Alta automática de proyectos en el registry (`registry.json`, `.projects[]`): toda carpeta donde trabaja un líder (nuevo, retomado
// o traído de Claude Code) queda anotada sola, con el nombre de la carpeta, sin pasos manuales. Antes nadie escribía el registry salvo
// la persona a mano (Linux) o el instalador (Windows: lo crea vacío `{"projects":[]}`), y por eso en Windows "Ajustes > Proyectos" no
// mostraba nada aunque hubiera líderes en varias carpetas.
//
// No se anota: el home, carpetas del sistema, los worktrees de `pa` (no son proyectos) ni carpetas que no existen. Sin repetidos:
// misma carpeta (ruta real normalizada; en Windows sin distinguir mayúsculas ni `/` de `\`) ya anotada con cualquier nombre = nada.
// Lo anotado no se toca: sólo se agregan entradas al final (`{ name, path }`), el resto del JSON queda como está.
// Node puro (sin `electron`): lo prueba tests/proyectos-auto.test.ts con rutas de las dos plataformas.
import { copyFile, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { caminoDe, homeDe, plataformaActual, registroProyectos, type Plataforma } from "./rutas.ts";
import { WORKTREE_PA } from "./worktrees-pa.ts";

type Env = Record<string, string | undefined>;

export type OpcionesAlta = {
  home?: string;
  plat?: Plataforma;
  /** La ruta real de una carpeta (para que un symlink y su destino sean el mismo proyecto). Por defecto `realpath` de verdad. */
  real?: (p: string) => Promise<string>;
  /** ¿Existe esa carpeta? Por defecto `stat` de verdad. */
  existe?: (p: string) => Promise<boolean>;
};

const SISTEMA_POSIX = ["/bin", "/boot", "/dev", "/etc", "/lib", "/lib32", "/lib64", "/libx32", "/proc", "/root", "/run", "/sbin", "/snap", "/sys", "/usr", "/var"];
const SISTEMA_DARWIN = ["/System", "/Library", "/Applications", "/private", "/cores"];
/** Debajo de la letra de unidad: `\Windows`, `\Program Files`, `\Program Files (x86)`, `\ProgramData`, `\$Recycle.Bin`, `\System Volume Information`. */
const SISTEMA_WIN = /^[a-z]:\\(?:windows|program files(?: \(x86\))?|programdata|\$recycle\.bin|system volume information|recovery)(?:\\|$)/i;

/** La carpeta normalizada: absoluta, sin `..`, sin barra final y (Windows) con `\`, sin prefijo `\\?\`. Sin tocar mayúsculas. */
export function normalizar(ruta: string, plat: Plataforma = plataformaActual()): string {
  const j = caminoDe(plat);
  let r = ruta.trim();
  if (plat === "win32") r = r.replace(/^\\\\\?\\(?=[a-z]:)/i, "").replace(/\//g, "\\");
  r = j.resolve(r);
  const raiz = j.parse(r).root;
  while (r.length > raiz.length && (r.endsWith("/") || r.endsWith("\\"))) r = r.slice(0, -1);
  return r;
}

/** La clave para decir "es la misma carpeta": normalizada y, en Windows, en minúsculas (el disco no distingue mayúsculas). */
export const claveRuta = (ruta: string, plat: Plataforma = plataformaActual()): string => {
  const n = normalizar(ruta, plat);
  return plat === "win32" ? n.toLowerCase() : n;
};

/** ¿Es una carpeta que no puede ser un proyecto? El home, la raíz, el padre de los homes y las del sistema. */
export function esCarpetaDeSistema(ruta: string, home: string, plat: Plataforma = plataformaActual()): boolean {
  const k = claveRuta(ruta, plat);
  const j = caminoDe(plat);
  if (k === claveRuta(home, plat)) return true;
  if (k === j.parse(k).root.toLowerCase() || k === j.parse(k).root) return true;
  if (plat === "win32") {
    if (SISTEMA_WIN.test(k) || /^[a-z]:\\users$/.test(k)) return true;
    return false;
  }
  if (k === "/home" || k === "/Users") return true;
  const lista = plat === "darwin" ? [...SISTEMA_POSIX, ...SISTEMA_DARWIN] : SISTEMA_POSIX;
  return lista.some((s) => k === s || k.startsWith(`${s}/`));
}

/** Los textos de un campo opcional del registry que puede ser uno o varios (`alias`, `aliases`). */
const textos = (x: unknown): string[] => (Array.isArray(x) ? x : typeof x === "string" ? [x] : []).filter((a): a is string => typeof a === "string" && a.trim() !== "").map((a) => a.trim());

const slugDe = (ruta: string, plat: Plataforma) => caminoDe(plat).basename(ruta).replace(/[^A-Za-z0-9._-]/g, "-").toLowerCase();

const expandirHome = (p: string, home: string, plat: Plataforma) => (p === "~" ? home : /^~[\\/]/.test(p) ? caminoDe(plat).join(home, p.slice(2)) : p);

/**
 * Qué nombre lleva la carpeta en el registry: el de la carpeta; si ya lo usa otro proyecto (nombre, nombre para mostrar, alias o slug),
 * `<padre>-<carpeta>` y, si aun así choca, `<carpeta>-2`, `-3`… Nunca empieza con "-" (parecería una opción de `pa`).
 */
export function nombreParaAlta(ruta: string, usados: ReadonlySet<string>, plat: Plataforma = plataformaActual()): string | null {
  const j = caminoDe(plat);
  const limpio = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, "").replace(/^-+/, "").trim();
  const base = limpio(j.basename(ruta));
  if (!base) return null;
  const libre = (n: string) => !usados.has(n.toLowerCase()) && !usados.has(slugDe(n, plat));
  if (libre(base)) return base;
  const padre = limpio(j.basename(j.dirname(ruta)));
  if (padre && libre(`${padre}-${base}`)) return `${padre}-${base}`;
  for (let i = 2; i < 1000; i++) if (libre(`${base}-${i}`)) return `${base}-${i}`;
  return null;
}

const realPorDefecto = (p: string) => realpath(p).catch(() => p);
const existePorDefecto = (p: string) => stat(p).then((s) => s.isDirectory(), () => false);

/** Para que dos altas a la vez (varios líderes que arrancan juntos) no se pisen leyendo y escribiendo el mismo archivo. */
let cola: Promise<unknown> = Promise.resolve();

/**
 * Anota en el registry las carpetas que todavía no estén. Devuelve los nombres que agregó (vacío si no había nada nuevo). Si el archivo
 * falta lo crea; si existe pero no se puede leer como registry, no lo toca (la persona lo arregla). Deja `registry.json.bak`.
 */
export function registrarCarpetas(archivo: string, carpetas: readonly string[], op: OpcionesAlta = {}): Promise<string[]> {
  const sigue = cola.then(() => alta(archivo, carpetas, op));
  cola = sigue.catch(() => {});
  return sigue;
}

async function alta(archivo: string, carpetas: readonly string[], op: OpcionesAlta): Promise<string[]> {
  const plat = op.plat ?? plataformaActual();
  const home = op.home ?? homeDe(process.env, plat);
  const real = op.real ?? (plat === plataformaActual() ? realPorDefecto : async (p: string) => p);
  const existe = op.existe ?? existePorDefecto;
  const j = caminoDe(plat);

  let json: { projects: Record<string, unknown>[] } & Record<string, unknown>;
  const crudo = await readFile(archivo, "utf8").catch((e: NodeJS.ErrnoException) => (e.code === "ENOENT" ? null : undefined));
  if (crudo === undefined) return [];
  if (crudo === null) json = { projects: [] };
  else {
    try {
      json = JSON.parse(crudo);
    } catch {
      return [];
    }
    if (!json || typeof json !== "object" || Array.isArray(json) || !Array.isArray(json.projects)) return [];
  }

  // Lo que ya hay: las carpetas (por clave) y todos los nombres que ocupan.
  const carpetasYa = new Set<string>();
  const usados = new Set<string>();
  for (const r of json.projects) {
    if (!r || typeof r !== "object") continue;
    if (typeof r.name === "string") usados.add(r.name.toLowerCase());
    for (const a of [...textos(r.titulo), ...textos(r.alias), ...textos(r.aliases)]) usados.add(a.toLowerCase());
    if (typeof r.path === "string" && r.path) {
      const p = expandirHome(r.path, home, plat);
      carpetasYa.add(claveRuta(p, plat));
      carpetasYa.add(claveRuta(await real(normalizar(p, plat)), plat));
      usados.add(slugDe(normalizar(p, plat), plat));
    }
  }

  const agregados: string[] = [];
  for (const c of carpetas) {
    if (typeof c !== "string" || !c.trim() || c.includes("\0") || !j.isAbsolute(c.trim().replace(/^\\\\\?\\(?=[a-z]:)/i, ""))) continue;
    const ruta = normalizar(c, plat);
    if (esCarpetaDeSistema(ruta, home, plat) || WORKTREE_PA.test(ruta)) continue;
    if (!(await existe(ruta))) continue;
    const verdadera = normalizar(await real(ruta), plat);
    if (esCarpetaDeSistema(verdadera, home, plat) || WORKTREE_PA.test(verdadera)) continue;
    if (carpetasYa.has(claveRuta(ruta, plat)) || carpetasYa.has(claveRuta(verdadera, plat))) continue;
    const nombre = nombreParaAlta(ruta, usados, plat);
    if (!nombre) continue;
    json.projects.push({ name: nombre, path: ruta });
    carpetasYa.add(claveRuta(ruta, plat));
    carpetasYa.add(claveRuta(verdadera, plat));
    usados.add(nombre.toLowerCase());
    usados.add(slugDe(ruta, plat));
    agregados.push(nombre);
  }
  if (!agregados.length) return [];

  await mkdir(path.dirname(archivo), { recursive: true });
  const tmp = `${archivo}.trama-${process.pid}.tmp`;
  try {
    if (crudo !== null) await copyFile(archivo, `${archivo}.bak`).catch(() => {});
    await writeFile(tmp, `${JSON.stringify(json, null, 2)}\n`, { mode: await stat(archivo).then((x) => x.mode & 0o777, () => 0o644) });
    await rename(tmp, archivo);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
  return agregados;
}

/**
 * ¿Se puede tocar el registry de esta corrida? Un estado aislado (`HILOS_STATE`: tests, capturas, pruebas) sin su propio
 * `PROYECTOS_REGISTRY` apuntaría al registry real de la persona: ahí no se anota nada.
 */
export const altaPermitida = (env: Env = process.env): boolean => !!env.PROYECTOS_REGISTRY || !env.HILOS_STATE;

/** Anota la carpeta de un líder (si no es el home ni del sistema). No tira: un registry que no se puede escribir no tiene que frenar al líder. */
export function anotarCarpeta(cwd: string | undefined | null, avisarError: (e: unknown) => void = () => {}): void {
  if (!cwd || !altaPermitida()) return;
  void registrarCarpetas(registroProyectos(), [cwd]).catch(avisarError);
}

/** Al abrir Trama: las carpetas de los líderes y conversaciones que ya existen. */
export function anotarCarpetas(cwds: readonly (string | undefined | null)[], avisarError: (e: unknown) => void = () => {}): Promise<string[]> {
  if (!altaPermitida()) return Promise.resolve([]);
  const unicas = [...new Set(cwds.filter((c): c is string => typeof c === "string" && c !== ""))];
  if (!unicas.length) return Promise.resolve([]);
  return registrarCarpetas(registroProyectos(), unicas).catch((e) => (avisarError(e), []));
}
