// Los proyectos del registry (`~/.config/proyectos/registry.json`, `.projects[]`).
// Aparte y sin imports locales: lo usan pa.ts y statusline.ts, y statusline ya
// importa pa (si pa importara statusline, el ciclo deja PA_STATE sin definir).
import { readFile, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const REGISTRY = process.env.PROYECTOS_REGISTRY ?? path.join(os.homedir(), ".config", "proyectos", "registry.json");

const expandir = (p: string) => (p === "~" ? os.homedir() : p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p);

/** Igual que `slug_de` en `pa`: así se llama el proyecto en `pa --hilos`. */
export const slug = (ruta: string) => path.basename(ruta).replace(/[^A-Za-z0-9._-]/g, "-").toLowerCase();

export const real = (p: string) => realpath(p).catch(() => path.resolve(p));

/** Un proyecto del registry: `nombre` es lo que entiende `pa <proyecto>` (vía `proyecto-ruta`), `slug` lo que devuelve `pa --hilos`. */
export type Proyecto = {
  nombre: string;
  slug: string;
  ruta: string;
  desc: string;
  /** Campo opcional `icono` (o `icon`, como ya lo trae el registry): la ruta de su logo, tal cual está escrita. */
  icono: string | null;
  /** Campo opcional `titulo`: cómo se ve la carpeta en la barra (a `pa` va siempre `nombre`). */
  titulo: string | null;
  /** El `tests` del registry (lo que corre `pa --integrar --tests`); `null` si no tiene: ahí `--tests` sale 2. */
  tests: string | null;
  /** Campo `estado` del registry ("activo", "infra", "retirado"…); `null` si no lo trae. */
  estado: string | null;
};

/**
 * Los proyectos del registry, uno por carpeta real (varios nombres para la misma
 * carpeta son alias: gana el que coincide con el slug, si no el más corto). Sin
 * home ni "/". La ruta más larga primero (proyectos anidados).
 */
export async function registro(): Promise<Proyecto[]> {
  let regs: { name?: unknown; path?: unknown; desc?: unknown; icono?: unknown; icon?: unknown; tests?: unknown; titulo?: unknown; estado?: unknown }[] = [];
  try {
    regs = JSON.parse(await readFile(REGISTRY, "utf8")).projects ?? [];
  } catch {}
  const casa = await real(os.homedir());
  const porRuta = new Map<string, Proyecto>();
  for (const r of regs) {
    if (typeof r.path !== "string" || typeof r.name !== "string" || !r.name) continue;
    const ruta = await real(expandir(r.path));
    if (ruta === casa || ruta === "/") continue;
    const icono = [r.icono, r.icon].find((x): x is string => typeof x === "string" && x !== "") ?? null;
    const tests = typeof r.tests === "string" && r.tests.trim() ? r.tests : null;
    const titulo = typeof r.titulo === "string" && r.titulo.trim() ? r.titulo.trim() : null;
    const estado = typeof r.estado === "string" && r.estado.trim() ? r.estado.trim().toLowerCase() : null;
    const p = { nombre: r.name, slug: slug(ruta), ruta, desc: typeof r.desc === "string" ? r.desc : "", icono, tests, titulo, estado };
    const ya = porRuta.get(ruta);
    const peso = (x: Proyecto) => (x.nombre.toLowerCase() === x.slug ? 0 : 1000) + x.nombre.length;
    // El ícono, los tests y el título valen para la carpeta: los conserva aunque los traiga un alias que pierde.
    if (!ya || peso(p) < peso(ya))
      porRuta.set(ruta, { ...p, icono: p.icono ?? ya?.icono ?? null, tests: p.tests ?? ya?.tests ?? null, titulo: p.titulo ?? ya?.titulo ?? null });
    else {
      if (!ya.icono && icono) ya.icono = icono;
      if (!ya.tests && tests) ya.tests = tests;
      if (!ya.titulo && titulo) ya.titulo = titulo;
    }
  }
  return [...porRuta.values()].sort((a, b) => b.ruta.length - a.ruta.length);
}

const WORKTREE_PA = /[\\/]pa[\\/]worktrees[\\/]/;

/**
 * A qué carpetas puede mandarse un líder desde "Mover a proyecto…": el slug de cada proyecto del registry
 * **que existe**, sin lo retirado, sin los worktrees de `pa` y sin repetidos (dos rutas con el mismo
 * nombre de archivo, como dos `shell.qml`, dan un solo slug: la barra no los distingue). En orden alfabético.
 */
export async function destinos(): Promise<string[]> {
  const buenos: string[] = [];
  await Promise.all(
    (await registro()).map(async (p) => {
      if (p.estado === "retirado" || WORKTREE_PA.test(p.ruta)) return;
      if (await stat(p.ruta).catch(() => null)) buenos.push(p.slug);
    }),
  );
  return [...new Set(buenos)].sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
}

/**
 * Cada nombre del registry (los alias también) con el slug de su carpeta: el tablero anota los
 * items con el nombre, la barra los ordena por slug. Sin home ni "/", como `registro`.
 */
export async function slugsPorNombre(): Promise<Record<string, string>> {
  let regs: { name?: unknown; path?: unknown }[] = [];
  try {
    regs = JSON.parse(await readFile(REGISTRY, "utf8")).projects ?? [];
  } catch {}
  const casa = await real(os.homedir());
  const sale: Record<string, string> = {};
  for (const r of regs) {
    if (typeof r.path !== "string" || typeof r.name !== "string" || !r.name) continue;
    const ruta = await real(expandir(r.path));
    if (ruta !== casa && ruta !== "/") sale[r.name] = slug(ruta);
  }
  return sale;
}

