// Lógica pura del panel acoplable «Tablero» (PanelTablero.tsx): qué items del tablero son del proyecto del chat abierto, en qué
// grupo van (preguntas, esperas, pendientes), en qué orden y cuántos esperan a la persona (el contador de la pestaña).
// Sin React ni DOM, con extensión en los imports: lo prueba `node --test` (tests/panel-tablero.test.ts).
import type { Abierta, Item, Tablero } from "../datos/tablero.ts";

/** El nombre de la carpeta sin proyecto (el de `GENERAL` en datos/contrato.ts). */
const SIN_PROYECTO = "general";

export type GruposPanel = {
  /** Preguntas sin contestar (`espera-dueno`): las de botones se contestan con un toque. */
  preguntas: Item[];
  /** Lo que ya no pide un toque: pruebas a mano, preguntas ya contestadas y lo que espera a otro. */
  esperas: Item[];
  /** Lo que sigue por hacer: en curso, lo que sigue y la bandeja. */
  pendientes: Item[];
};

/** Orden de las columnas de pendientes: lo que se está haciendo primero. */
const RANGO_PENDIENTE: Partial<Record<Abierta, number>> = { "en-curso": 0, sigue: 1, bandeja: 2 };

/** El slug de la carpeta con la que el tablero nombra un proyecto (nombre del registry, alias incluidos). */
const slugDe = (nombre: string, slugs: Record<string, string>): string => slugs[nombre] ?? nombre;

/** Si un item es de la carpeta `carpeta` (el slug del chat abierto); sin carpeta o la general, los items sin proyecto. */
export function esDeCarpeta(i: Pick<Item, "proyecto">, carpeta: string | null | undefined, slugs: Record<string, string>): boolean {
  const sin = !carpeta || carpeta === SIN_PROYECTO;
  const nombre = i.proyecto.trim();
  if (sin) return nombre === "" || nombre === SIN_PROYECTO;
  return nombre !== "" && slugDe(nombre, slugs) === carpeta;
}

/** Lo que espera a la persona sin respuesta: las preguntas sin contestar y las pruebas sin hacer. */
export const esperaALaPersona = (i: Item): boolean => i.columna === "espera-dueno" && !i.respuesta && !(i.renglones.length > 0 && i.renglones.every((r) => r.hecho));

const masNuevo = (a: Item, b: Item): number => {
  const d = Date.parse(b.creado || "") - Date.parse(a.creado || "");
  if (Number.isFinite(d) && d !== 0) return d;
  return String(b.id).localeCompare(String(a.id), undefined, { numeric: true });
};

/** Los items abiertos del proyecto, en los tres grupos y cada uno con lo más nuevo primero (los pendientes, por columna). */
export function gruposDelProyecto(t: Tablero | null, carpeta: string | null | undefined, slugs: Record<string, string>): GruposPanel {
  const res: GruposPanel = { preguntas: [], esperas: [], pendientes: [] };
  if (!t) return res;
  const suyos = (col: Abierta) => t.columnas[col].filter((i) => esDeCarpeta(i, carpeta, slugs));
  for (const i of suyos("espera-dueno")) (i.tipo === "pregunta" && !i.respuesta ? res.preguntas : res.esperas).push(i);
  res.esperas.push(...suyos("espera-externo"));
  for (const col of ["en-curso", "sigue", "bandeja"] as const) res.pendientes.push(...suyos(col));
  res.preguntas.sort(masNuevo);
  res.esperas.sort(masNuevo);
  res.pendientes.sort((a, b) => (RANGO_PENDIENTE[a.columna as Abierta] ?? 9) - (RANGO_PENDIENTE[b.columna as Abierta] ?? 9) || masNuevo(a, b));
  return res;
}

/** El número de la pestaña: lo que espera a la persona en este proyecto (preguntas sin contestar y pruebas sin hacer). */
export function contadorPanel(t: Tablero | null, carpeta: string | null | undefined, slugs: Record<string, string>): number {
  if (!t) return 0;
  return t.columnas["espera-dueno"].filter((i) => esDeCarpeta(i, carpeta, slugs) && esperaALaPersona(i)).length;
}

/** Cuántos renglones de una prueba están tildados, y cuántos hay (`null` si el item no tiene renglones). */
export function avanceRenglones(i: Pick<Item, "renglones">): { hechos: number; total: number } | null {
  if (!i.renglones.length) return null;
  return { hechos: i.renglones.filter((r) => r.hecho).length, total: i.renglones.length };
}

/** Los botones de una pregunta y cuál viene sugerida; una pregunta sin botones (item viejo) no se contesta con un toque. */
export function opcionesDe(i: Item): { id: string; texto: string; sugerida: boolean }[] {
  const def = i.opciones.some((o) => o.id === i.porDefecto) ? i.porDefecto : null;
  return i.opciones.map((o) => ({ id: o.id, texto: o.texto, sugerida: o.id === def }));
}

/** Lo que contestó la persona, en una línea (el texto del botón o lo que escribió); vacío si no contestó. */
export function contestadoComo(i: Pick<Item, "respuesta">): string {
  const r = i.respuesta;
  if (!r) return "";
  if (r.anda !== null) return r.texto;
  return r.opcionTexto ?? r.texto;
}
