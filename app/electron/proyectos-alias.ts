// El nombre para mostrar de cada proyecto del registry (`titulo`, y `alias`): listarlo y cambiarlo. Es lo mismo que hacen
// `pa --proyectos` y `pa --renombrar <proy> <nombre>` (motor/bin/pa); `pa` entiende ese nombre como alias del proyecto
// (`pa Shark …` == `pa asistente-voz …`, motor/bin/proyecto-ruta). Cambia SÓLO ese texto: el slug, la ruta, las ramas
// `pa/<slug>/…` y la carpeta de estado no se tocan nunca (renombrarlos rompería el historial).
import { copyFile, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { errorT } from "./errores.ts";
import { NOMBRE_MAX, validarNombre, type NombreUsado } from "./proyectos-nombre.ts";
import { real, slug as slugDe } from "./registro.ts";

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const expandir = (p: string) => (p === "~" ? os.homedir() : p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p);

type Cruda = { i: number; nombre: string; ruta: string; slug: string; titulo: string | null; alias: string[] };

const textos = (x: unknown): string[] =>
  (Array.isArray(x) ? x : typeof x === "string" ? [x] : []).filter((a): a is string => typeof a === "string" && a.trim() !== "").map((a) => a.trim());

/** Las entradas del registry tal cual (una por nombre, con su lugar en el arreglo), con la ruta real y el slug de cada una. */
async function entradas(archivo: string): Promise<{ json: { projects: Record<string, unknown>[] } & Record<string, unknown>; lista: Cruda[] }> {
  let json: { projects: Record<string, unknown>[] } & Record<string, unknown>;
  try {
    json = JSON.parse(await readFile(archivo, "utf8"));
  } catch {
    throw errorT("main.registroIlegible");
  }
  if (!json || typeof json !== "object" || !Array.isArray(json.projects)) throw errorT("main.registroIlegible");
  const lista: Cruda[] = [];
  for (const [i, r] of json.projects.entries()) {
    if (!r || typeof r.path !== "string" || typeof r.name !== "string" || !r.name) continue;
    const ruta = await real(expandir(r.path));
    lista.push({
      i,
      nombre: r.name,
      ruta,
      slug: slugDe(ruta),
      titulo: typeof r.titulo === "string" && r.titulo.trim() ? r.titulo.trim() : null,
      alias: [...textos(r.alias), ...textos(r.aliases)],
    });
  }
  return { json, lista };
}

const usados = (lista: Cruda[]): NombreUsado[] => lista.map((e) => ({ nombre: e.nombre, slug: e.slug, ruta: e.ruta, otros: [...(e.titulo ? [e.titulo] : []), ...e.alias] }));

export type ProyectoNombre = {
  /** Lo que entiende `pa <proyecto>` (el `name` del registry). */
  nombre: string;
  slug: string;
  ruta: string;
  /** El nombre para mostrar; `null`: se ve con `nombre`. */
  titulo: string | null;
  /** Otros nombres con que el registry conoce al proyecto (`alias`): también valen para `pa` y no se pueden repetir. */
  alias: string[];
  /** La carpeta existe en esta máquina. */
  existe: boolean;
};

/** Un proyecto por carpeta (varios nombres para la misma son uno), los de la carpeta más corta primero no: por nombre. */
export async function listarProyectos(archivo: string): Promise<ProyectoNombre[]> {
  const { lista } = await entradas(archivo).catch(() => ({ lista: [] as Cruda[] }));
  const casa = await real(os.homedir());
  const porRuta = new Map<string, Cruda[]>();
  for (const e of lista) {
    if (e.ruta === casa || e.ruta === "/") continue;
    porRuta.set(e.ruta, [...(porRuta.get(e.ruta) ?? []), e]);
  }
  const salida: ProyectoNombre[] = [];
  for (const [ruta, es] of porRuta) {
    // Como `registro()`: el nombre que coincide con el slug, si no el más corto.
    const peso = (e: Cruda) => (e.nombre.toLowerCase() === e.slug ? 0 : 1000) + e.nombre.length;
    const principal = [...es].sort((a, b) => peso(a) - peso(b))[0];
    salida.push({
      nombre: principal.nombre,
      slug: principal.slug,
      ruta,
      titulo: es.find((e) => e.titulo)?.titulo ?? null,
      alias: [...new Set(es.flatMap((e) => e.alias))],
      existe: !!(await stat(ruta).catch(() => null)),
    });
  }
  return salida.sort((a, b) => (a.titulo ?? a.nombre).localeCompare(b.titulo ?? b.nombre, "es", { sensitivity: "base" }));
}

/**
 * Pone (o, con `nombre === null` o igual al del registry, saca) el nombre para mostrar del proyecto con ese slug, en todas sus
 * entradas del registry. Rechaza con una clave de i18n (`main.nombre*`) si no sirve. Antes de escribir deja `registry.json.bak`.
 */
export async function renombrarProyecto(archivo: string, slug: unknown, nombre: unknown): Promise<ProyectoNombre> {
  const s = String(slug ?? "");
  if (!SLUG.test(s)) throw errorT("main.proyectoRaro", { v: s });
  if (nombre !== null && typeof nombre !== "string") throw errorT("main.nombre.vacio");
  const { json, lista } = await entradas(archivo);
  const propias = lista.filter((e) => e.slug === s.toLowerCase());
  if (!propias.length) throw errorT("main.proyectoRaro", { v: s });
  let valor: string | null = null;
  if (nombre !== null) {
    const r = validarNombre(nombre, propias[0].ruta, usados(lista));
    if (!r.ok) throw errorT(`main.nombre.${r.motivo}`, { max: NOMBRE_MAX, con: r.con ?? "" });
    // Igual al nombre del registry: no hay nada que guardar.
    valor = propias.some((e) => e.nombre === r.valor) ? null : r.valor;
  }
  for (const e of propias) {
    const p = json.projects[e.i];
    if (valor === null) delete p.titulo;
    else p.titulo = valor;
  }
  const tmp = `${archivo}.trama-${process.pid}.tmp`;
  try {
    await copyFile(archivo, `${archivo}.bak`).catch(() => {});
    await writeFile(tmp, `${JSON.stringify(json, null, 2)}\n`, { mode: await stat(archivo).then((x) => x.mode & 0o777, () => 0o644) });
    await rename(tmp, archivo);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
  return (await listarProyectos(archivo)).find((p) => p.slug === propias[0].slug) as ProyectoNombre;
}
