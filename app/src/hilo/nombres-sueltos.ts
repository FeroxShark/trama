// Un archivo nombrado sólo por su nombre (`intensidad_neutral.wav`) en un mensaje que antes nombró la carpeta donde está
// (issue #7): se busca en las carpetas absolutas del mismo mensaje y, después, en la carpeta del chat. Sólo se vuelve tocable
// si el main confirma que existe ahí (`archivo:existen`); nada de recorrer el disco. Puro: no toca el disco ni el DOM.
// Un nombre con `..` o con separadores no se resuelve nunca (no es un nombre suelto: es una ruta).
import { tipoDeArchivo } from "../../electron/archivo-ruta.ts";
import type { Plataforma } from "../../electron/rutas.ts";
import { bloques, trozos, type Bloque } from "./markdown.ts";
import { rutasMencionadas } from "./rutas-mencionadas.ts";

/** Cuántos nombres distintos se buscan por mensaje, y cuántas carpetas donde buscar. */
export const MAX_NOMBRES = 24;
export const MAX_CARPETAS = 4;

const LARGO_MAX = 200;

/** `a.wav` sí; `../a.wav`, `x/a.wav`, `C:a.wav`, `a..wav`, `.env` y lo que no tiene extensión conocida, no. */
export function esNombreSuelto(s: string): boolean {
  if (!s || s !== s.trim() || s.length > LARGO_MAX) return false;
  if (/[\\\/:*?"<>|\u0000-\u001f]/.test(s) || s.includes("..")) return false;
  if (!/^[^.\s][^]*\.[A-Za-z0-9]{1,8}$/.test(s)) return false;
  return /\.html?$/i.test(s) || tipoDeArchivo(s).tipo !== "otro";
}

/** El nombre sin distinguir mayúsculas en Windows (`A.WAV` y `a.wav` son el mismo archivo); en Linux, tal cual. */
export const claveNombre = (n: string, plat: Plataforma): string => (plat === "win32" ? n.toLowerCase() : n);

// Un nombre en prosa: sin espacios, sin pegarse a una ruta (`/a/b.wav`), ni a otra palabra, ni a un guion o punto.
const NOMBRE_EN_PROSA = /(?<![\p{L}\p{N}_.\-\\\/:~])[\p{L}\p{N}_][\p{L}\p{N}_\-.]*\.[A-Za-z0-9]{1,8}(?![\p{L}\p{N}_\-\\\/:])/gu;

/** Parte un trozo de prosa en texto y nombres sueltos (lo que `esNombreSuelto` acepta), en su lugar. */
export function partirNombres(texto: string): Array<string | { nombre: string }> {
  const out: Array<string | { nombre: string }> = [];
  let i = 0;
  for (const m of texto.matchAll(NOMBRE_EN_PROSA)) {
    const idx = m.index ?? 0;
    if (!esNombreSuelto(m[0])) continue;
    if (idx > i) out.push(texto.slice(i, idx));
    out.push({ nombre: m[0] });
    i = idx + m[0].length;
  }
  if (!out.length) return [texto];
  if (i < texto.length) out.push(texto.slice(i));
  return out;
}

type Agregar = (nombre: string) => void;

function deLinea(texto: string, enLista: boolean, agregar: Agregar) {
  for (const x of trozos(texto)) {
    if (x.tipo === "link" || x.tipo === "img") continue;
    if (x.tipo === "code") {
      if (esNombreSuelto(x.texto)) agregar(x.texto);
    } else if (x.tipo === "b" || x.tipo === "i" || x.tipo === "s") {
      deLinea(x.texto, enLista, agregar);
    } else if (enLista) {
      for (const p of partirNombres(x.texto)) if (typeof p !== "string") agregar(p.nombre);
    }
  }
}

function deBloques(bs: readonly Bloque[], agregar: Agregar, enLista = false) {
  for (const b of bs) {
    if (b.tipo === "p" || b.tipo === "h") deLinea(b.texto, enLista, agregar);
    else if (b.tipo === "cita") deBloques(b.bloques, agregar, enLista);
    else if (b.tipo === "tabla") {
      for (const c of b.cabeza) deLinea(c, false, agregar);
      for (const f of b.filas) for (const c of f) deLinea(c, false, agregar);
    } else if (b.tipo === "ol" || b.tipo === "ul") {
      for (const it of b.items) {
        deLinea(it.texto, true, agregar);
        if (it.bloques) deBloques(it.bloques, agregar, true);
        if (it.sub) deBloques([it.sub], agregar, true);
      }
    }
  }
}

/** Los nombres sueltos del mensaje (en código en línea o en una lista), sin repetir, hasta `MAX_NOMBRES`. */
export function nombresSueltosDe(texto: string, plat: Plataforma = "linux"): string[] {
  if (!texto) return [];
  const vistos = new Set<string>();
  const out: string[] = [];
  deBloques(bloques(texto), (n) => {
    const k = claveNombre(n, plat);
    if (vistos.has(k) || out.length >= MAX_NOMBRES) return;
    vistos.add(k);
    out.push(n);
  });
  return out;
}

const esAbsoluta = (s: string, plat: Plataforma) =>
  plat === "win32" ? /^(?:[A-Za-z]:[\\\/]|~[\\\/])/.test(s) : /^(?:\/(?!\/)|~\/)/.test(s);

/** Une una carpeta y un nombre con el separador de la plataforma (`\` en Windows; `/` en Linux). */
export function unir(carpeta: string, nombre: string, plat: Plataforma): string {
  const sep = plat === "win32" ? "\\" : "/";
  const base = carpeta.replace(/[\\\/]+$/, "");
  return `${plat === "win32" ? base.replace(/\//g, "\\") : base}${sep}${nombre}`;
}

/** Dónde buscar: las carpetas absolutas que nombra el mensaje, en orden, y después la del chat; sin repetir. */
export function carpetasDeBusqueda(texto: string, cwd: string | null, plat: Plataforma = "linux"): string[] {
  const out: string[] = [];
  const vistas = new Set<string>();
  const poner = (c: string) => {
    const sinBarra = c.replace(/[\\\/]+$/, "");
    if (!sinBarra || !esAbsoluta(c, plat)) return;
    const k = plat === "win32" ? sinBarra.replace(/\//g, "\\").toLowerCase() : sinBarra;
    if (vistas.has(k) || out.length >= MAX_CARPETAS) return;
    vistas.add(k);
    out.push(sinBarra);
  };
  for (const r of rutasMencionadas(texto, plat)) if (r.tipo === "carpeta") poner(r.ruta);
  if (cwd) poner(cwd);
  return out;
}

export type PlanNombres = {
  /** Cada nombre con sus rutas posibles, en el orden de búsqueda. */
  candidatos: Array<{ nombre: string; rutas: string[] }>;
  /** Todas las rutas posibles juntas, para preguntarle al main de una vez. */
  rutas: string[];
};

/** Qué hay que preguntar: nombres sueltos × carpetas de búsqueda. Sin carpetas o sin nombres, nada. */
export function planDeNombres(texto: string, cwd: string | null, plat: Plataforma = "linux"): PlanNombres {
  const nombres = nombresSueltosDe(texto, plat);
  const carpetas = nombres.length ? carpetasDeBusqueda(texto, cwd, plat) : [];
  if (!nombres.length || !carpetas.length) return { candidatos: [], rutas: [] };
  const candidatos = nombres.map((nombre) => ({ nombre, rutas: carpetas.map((c) => unir(c, nombre, plat)) }));
  return { candidatos, rutas: candidatos.flatMap((c) => c.rutas) };
}

/** Los nombres que el main confirmó como archivo: cada uno con la primera ruta (en el orden de búsqueda) que existe. La clave es `claveNombre`. */
export function resolverNombres(
  plan: PlanNombres,
  tipos: Readonly<Record<string, "archivo" | "carpeta" | null | undefined>> | ReadonlyMap<string, "archivo" | "carpeta" | null>,
  plat: Plataforma = "linux",
): Map<string, string> {
  const tipo = (r: string) => (tipos instanceof Map ? tipos.get(r) : (tipos as Record<string, string | null | undefined>)[r]);
  const out = new Map<string, string>();
  for (const c of plan.candidatos) {
    const hallada = c.rutas.find((r) => tipo(r) === "archivo");
    if (hallada) out.set(claveNombre(c.nombre, plat), hallada);
  }
  return out;
}
