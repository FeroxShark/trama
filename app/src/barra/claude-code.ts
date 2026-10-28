// Las conversaciones de Claude Code en la barra ("De Claude Code (N)"): a qué carpeta va cada una, el buscador y cuántas se ven.
// Puro: lo prueba `tests/claude-code-barra.test.ts`. La lista la arma el main (electron/claude-code.ts).
import { GENERAL, type ConvClaudeCode } from "../datos/contrato.ts";

/** La carpeta "Otras carpetas": las conversaciones cuya carpeta no es un proyecto registrado (ni la personal). No puede chocar con un slug. */
export const OTRAS = "\u0001otras";

/** La clave del pliegue de "De Claude Code" de una carpeta (con ":" va con los pliegues, cerrado de fábrica). */
export const claveClaude = (carpeta: string) => `claude:${carpeta}`;

/** Cuántas se muestran de una vez; el resto, con "Ver más". */
export const LOTE = 25;
/** Con menos que esto el buscador sobra. */
export const PARA_BUSCAR = 8;

/** La carpeta de la barra a la que va una conversación. */
export const carpetaDe = (c: ConvClaudeCode): string => c.proyecto ?? OTRAS;

/** Cada conversación en su carpeta, sin las que ya son líderes de la barra (`ocultas`: sus session_id). Cada lista queda de la más reciente a la más vieja. */
export function repartirClaude(convs: ConvClaudeCode[], ocultas: ReadonlySet<string>): Map<string, ConvClaudeCode[]> {
  const m = new Map<string, ConvClaudeCode[]>();
  for (const c of convs) {
    if (ocultas.has(c.sid)) continue;
    const k = carpetaDe(c);
    const l = m.get(k);
    if (l) l.push(c);
    else m.set(k, [c]);
  }
  for (const l of m.values()) l.sort((a, b) => b.ms - a.ms);
  return m;
}

const llano = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Las que dicen todas las palabras de `q` en su título o en el nombre de su carpeta (sin tildes ni mayúsculas). */
export function filtrarClaude(convs: ConvClaudeCode[], q: string): ConvClaudeCode[] {
  const palabras = llano(q).split(/\s+/).filter(Boolean);
  if (!palabras.length) return convs;
  return convs.filter((c) => {
    const texto = llano(`${c.titulo} ${carpetaCorta(c.cwd)}`);
    return palabras.every((p) => texto.includes(p));
  });
}

/** El último tramo de una ruta ("/home/ana/atlas" → "atlas"), sirva la barra que sirva. */
export const carpetaCorta = (cwd: string): string => cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;

/** Las carpetas que tienen conversaciones y todavía no tienen su sección en la barra, de la que se tocó más reciente: los proyectos primero, "Otras carpetas" al final. */
export function carpetasExtra(reparto: Map<string, ConvClaudeCode[]>, enBarra: ReadonlySet<string>): string[] {
  const claves = [...reparto.keys()].filter((k) => !enBarra.has(k) && k !== GENERAL);
  const reciente = (k: string) => reparto.get(k)![0]?.ms ?? 0;
  return claves.sort((a, b) => (a === OTRAS ? 1 : b === OTRAS ? -1 : reciente(b) - reciente(a)));
}
