// "Iniciar" del tablero: de las tareas marcadas, a qué líder va cada una y con qué mensaje. Las
// de un mismo proyecto van juntas, numeradas, en un solo mensaje; cada proyecto, a su líder. El
// mensaje va en español y en un solo lugar (como retomar.ts: es una instrucción para Claude, no
// texto de la UI). Puro, con extensión en los imports: lo prueba `node --test` (tests/iniciar.test.ts).
import { aDueno, Dueno } from "./dueno.ts";
import type { Item } from "./tablero.ts";

/** Un líder de la app al que se le puede escribir, con la carpeta de la barra donde está y su modelo (para avisar si Iniciar se lo cambia). */
export type LiderDe = { id: string; nombre: string; carpeta: string; ocupado: boolean; actividad: number; modelo?: string | null; maquina?: string };

export type Grupo = {
  /** La máquina de sus tareas (el `maquina` del item): sin él, esta. Cada máquina tiene su tablero y sus líderes: nunca se mezclan en un grupo. */
  maquina?: string;
  /** El proyecto como lo nombra el tablero ("" = sin proyecto). */
  proyecto: string;
  /** Su carpeta en la barra (el slug), o `null`: trama no lo tiene (un área, o sin proyecto) y va a Inicio. */
  carpeta: string | null;
  items: Item[];
  /** Los líderes de la app que ya están en esa carpeta, el de actividad más reciente primero. */
  lideres: LiderDe[];
};

/** Con qué se anota lo elegido de un grupo (líder, modelo): el proyecto, y su máquina si no es esta. */
export const claveGrupo = (g: Pick<Grupo, "maquina" | "proyecto">) => (g.maquina ? `${g.maquina}:${g.proyecto}` : g.proyecto);

/** El "líder nuevo" de un destino (un session_id no puede ser vacío). */
export const NUEVO = "";

/**
 * Las tareas por proyecto, en el orden en que aparece cada uno. `carpetas`: nombre del registry →
 * slug (lo que trama conoce). En Inicio no se reusa a nadie: ahí los líderes son de cualquier cosa.
 */
export function agrupar(items: readonly Item[], carpetas: Readonly<Record<string, string>>, lideres: readonly LiderDe[]): Grupo[] {
  const grupos = new Map<string, Grupo>();
  for (const i of items) {
    const clave = `${i.maquina ?? ""}\0${i.proyecto}`;
    let g = grupos.get(clave);
    if (!g) {
      // `carpetas` es de esta máquina: las de la otra máquina se ubican por su propio nombre (trama no conoce su registry), y su líder nuevo no lleva carpeta.
      const carpeta = i.maquina ? null : (i.proyecto && Object.hasOwn(carpetas, i.proyecto) && carpetas[i.proyecto]) || null;
      const donde = carpeta ?? (i.maquina && i.proyecto ? i.proyecto : null);
      const suyos = donde ? lideres.filter((l) => l.carpeta === donde && l.maquina === i.maquina).sort((a, b) => b.actividad - a.actividad) : [];
      grupos.set(clave, (g = { ...(i.maquina ? { maquina: i.maquina } : {}), proyecto: i.proyecto, carpeta, items: [], lideres: suyos }));
    }
    g.items.push(i);
  }
  return [...grupos.values()];
}

/** A quién va un grupo: el elegido si sigue estando, si no el más reciente de su carpeta, si no uno nuevo. */
export function destinoDe(g: Grupo, elegido?: string): LiderDe | null {
  if (elegido === NUEVO) return null;
  return g.lideres.find((l) => l.id === elegido) ?? g.lideres[0] ?? null;
}

/** Un texto de varios renglones detrás de su etiqueta: los que siguen, alineados debajo. */
const campo = (pre: string, etq: string, texto: string) => {
  const [uno, ...resto] = texto.trim().split("\n");
  const sangria = " ".repeat(pre.length + 2);
  return [`${pre}${etq}: ${uno}`, ...resto.map((r) => (r.trim() ? sangria + r.trimEnd() : ""))];
};

const cuerpo = (i: Item, pre: string) => [
  ...(i.detalle.trim() ? campo(pre, "Detalle", i.detalle) : []),
  ...(i.prueba.trim() ? campo(pre, "Cómo se prueba", i.prueba) : []),
];

/** El primer mensaje (o el que sigue, si el líder ya estaba) con las tareas de un proyecto. */
export function promptIniciar(g: Pick<Grupo, "proyecto" | "carpeta" | "items">): string {
  // El número de cada item en SU tablero: el `servidor:12` es de quien junta, el líder de allá conoce el 12.
  const num = (i: Item) => String(i.id).replace(/^.*:/, "");
  const varias = g.items.length > 1;
  const donde = !g.proyecto
    ? "- Proyecto: ninguno anotado. Fijate vos dónde va."
    : g.carpeta
      ? `- Proyecto: ${g.proyecto}`
      : `- Proyecto: ${g.proyecto} (no es un proyecto del registry: fijate vos dónde va)`;
  const ids = g.items.map((i) => `#${num(i)}`).join(", ");
  const tareas = varias
    ? g.items.flatMap((i, k) => [`${k + 1}. #${num(i)}: ${i.titulo.trim()}`, ...cuerpo(i, "   ")])
    : [`- Tarea #${num(g.items[0])}: ${g.items[0].titulo.trim()}`, ...cuerpo(g.items[0], "- ")];
  return [
    varias ? `${Dueno()} quiere que te ocupes de estas ${g.items.length} tareas de su tablero.` : `${Dueno()} quiere que te ocupes de esta tarea de su tablero.`,
    "",
    donde,
    ...(varias ? ["", ...tareas] : tareas),
    "",
    varias
      ? `Ya quedaron en \`en-curso\` en el tablero (${ids}; \`tablero ver <id>\` muestra cada una entera). Cuando termines una, cerrala con \`tablero cerrar <id>\`; si alguna queda esperando ${aDueno()}, movela con \`tablero mover <id> --columna espera-dueno\`.`
      : `Ya quedó en \`en-curso\` en el tablero (\`tablero ver ${num(g.items[0])}\` la muestra entera). Cuando termines, cerrala con \`tablero cerrar ${num(g.items[0])}\`; si queda esperando ${aDueno()}, movela con \`tablero mover ${num(g.items[0])} --columna espera-dueno\`.`,
  ].join("\n");
}

/** Un modelo elegido para el grupo: `""` (o nada) es no elegir, y se usa el del líder o el de siempre. */
export const hayModelo = (elegido: string | null | undefined): elegido is string => !!elegido;

/**
 * Con qué modelo sale el mensaje. Sin elegir: el del líder al que va (iniciar una tarea no le cambia el modelo con el caché vivo)
 * o `defecto` si es nuevo. Elegido: ese, y el esfuerzo del líder sólo se conserva si el modelo es el mismo (`idDe`: de un modelo
 * como lo dice el líder al id del selector); `effort: null` = que lo ponga quien llama según el modelo.
 */
export function modeloDeInicio(
  elegido: string | null | undefined,
  lider: { modelo: string | null | undefined; effort: string | null | undefined } | null,
  defecto: string,
  idDe: (m: string | null | undefined) => string | null,
): { modelo: string; effort: string | null } {
  const modelo = (hayModelo(elegido) ? elegido : lider?.modelo) || defecto;
  const mismo = !hayModelo(elegido) || idDe(lider?.modelo) === elegido;
  return { modelo, effort: lider && mismo ? lider.effort || null : null };
}

/** ¿Iniciar le cambia el modelo a este líder? Sólo si el usuario eligió uno distinto del que tiene. */
export const cambiaElModelo = (lider: Pick<LiderDe, "modelo"> | null, elegido: string | null | undefined, idDe: (m: string | null | undefined) => string | null) =>
  !!lider && hayModelo(elegido) && idDe(lider.modelo) !== elegido;
