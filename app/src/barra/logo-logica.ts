// El logo de una carpeta cuando el proyecto no tiene ícono propio: un
// monograma de una o dos letras sobre un tono que sale del nombre (siempre el
// mismo para el mismo proyecto). Sin React: lo prueban los tests.

/** Diez tonos medios que se leen sobre negro puro, con letra oscura encima. */
export const PALETA = [
  "#e5786d", // coral
  "#e0975c", // naranja
  "#d2b356", // ocre
  "#9fbf5f", // lima
  "#5fbf8a", // verde
  "#52b8b0", // turquesa
  "#5aa9dc", // celeste
  "#7f93ea", // azul lavanda
  "#a984e2", // violeta
  "#dd7fb4", // rosa
] as const;

/** FNV-1a de 32 bits: parejo con nombres cortos y parecidos ("atlas", "atlas-web"). */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const tono = (nombre: string): string => PALETA[hash(nombre.toLowerCase()) % PALETA.length];

/** Los tonos del riel (rediseño 0.4): pasteles para el monograma y el encabezado del proyecto, sobre su mismo tono al 15 %. */
export const PALETA_RIEL = ["#8fb5f0", "#7fd1c7", "#eaa0c8", "#b9a3f0", "#9ad48a", "#a9bdd6", "#d7a6e0", "#8fd6e8", "#c3cf8d"] as const;

export const tonoRiel = (nombre: string): string => PALETA_RIEL[hash(nombre.toLowerCase()) % PALETA_RIEL.length];

/**
 * "atlas" → "At", "atlas-web" → "AW", "SpaceLens" → "SL", "x" → "X". Dos
 * palabras (separadas por guion, punto, espacio o mayúscula) dan sus iniciales;
 * una sola, sus dos primeras letras.
 */
/** Las palabras del nombre: parte por lo que no es letra ni número y separa «SpaceLens» en dos. */
function palabrasDe(nombre: string): string[] {
  return nombre
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function monograma(nombre: string): string {
  const palabras = palabrasDe(nombre);
  if (palabras.length === 0) return "·";
  if (palabras.length === 1) {
    const [a, b = ""] = [...palabras[0]];
    return a.toUpperCase() + b.toLowerCase();
  }
  return ([...palabras[0]][0] + [...palabras[1]][0]).toUpperCase();
}

const VOCALES = "aeiouáéíóúü";
/** Si el nombre no da más consonantes: el resto del abecedario (consonantes, después vocales). */
const RESERVA = [..."bcdfghjklmnpqrstvwxyzñ", ..."aeiou"];

const esConsonante = (c: string) => /^\p{L}$/u.test(c) && !VOCALES.includes(c);

/** La alternativa de un monograma que choca: la primera letra se queda; la segunda, la siguiente consonante distinta del nombre. */
function alternativa(base: string, palabras: string[], usados: ReadonlySet<string>): string | null {
  const letras = palabras.flatMap((p) => [...p.toLowerCase()]);
  // La segunda letra del monograma: la inicial de la segunda palabra o la segunda letra del nombre.
  const pos = palabras.length > 1 ? [...palabras[0]].length : 1;
  const actual = letras[pos];
  const mayus = base === base.toUpperCase();
  const siguientes = letras.map((_, k) => letras[(pos + k) % letras.length]);
  for (const c of [...siguientes.filter(esConsonante), ...RESERVA]) {
    if (c === letras[0] || c === actual) continue;
    const m = [...base][0] + (mayus ? c.toUpperCase() : c);
    if (!usados.has(m)) return m;
  }
  return null;
}

/**
 * Los monogramas de una lista de nombres, sin repetir. El primero se queda con
 * su `monograma`; el que choca toma la siguiente consonante distinta de su
 * nombre («shark» y «shell» → «Sh» y «Sl»). Depende del orden de la lista: el
 * mismo orden, el mismo resultado. Un nombre sin letras queda «·» (no hay con
 * qué distinguirlo).
 */
export function monogramas(nombres: readonly string[]): string[] {
  const usados = new Set<string>();
  return nombres.map((nombre) => {
    const base = monograma(nombre);
    const palabras = palabrasDe(nombre);
    const elegido = usados.has(base) && palabras.length > 0 ? (alternativa(base, palabras, usados) ?? base) : base;
    usados.add(elegido);
    return elegido;
  });
}
