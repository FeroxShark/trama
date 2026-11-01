// Puntos de control por turno (#1787), lo que no es pintar: a qué punto corresponde un turno de la conversación, qué archivos hay que
// restaurar al volver y el diff de git en filas. Puro: lo prueba `tests/punto-logica.test.ts`.
import type { ArchivoPunto, PuntoControl } from "../datos/contrato.ts";
import type { FilaDiff } from "./worker-datos.ts";

/** Cuánto antes del mensaje (s) puede estar el punto: relojes redondeados a segundos entre el main y el transcript. */
const HOLGURA_S = 5;

/**
 * El punto de control de un turno: el último que salió antes de que empezara (`desde`, epoch s) y que no había terminado cuando
 * empezó. Un turno que no pasó por la app (la terminal, uno de antes de que existieran los puntos) no tiene: `null`.
 * Un mensaje mandado a mitad del turno cae adentro del mismo punto.
 */
export function puntoDeTurno(puntos: readonly PuntoControl[], desde: number | null): PuntoControl | null {
  if (desde === null) return null;
  let mejor: PuntoControl | null = null;
  for (const p of puntos) {
    if (p.ts / 1000 - HOLGURA_S > desde) continue;
    if (p.fin !== null && desde > p.fin / 1000 + HOLGURA_S) continue;
    if (!mejor || p.ts > mejor.ts) mejor = p;
  }
  return mejor;
}

/** Los archivos que cambian al volver a antes de `id`: los de ese turno y los de los que siguieron, sin repetir. */
export function archivosAlVolver(puntos: readonly PuntoControl[], id: string): ArchivoPunto[] {
  const k = puntos.findIndex((p) => p.id === id);
  if (k < 0) return [];
  const por = new Map<string, ArchivoPunto>();
  for (const p of puntos.slice(k)) for (const a of p.archivos) if (!por.has(a.ruta)) por.set(a.ruta, a);
  return [...por.values()];
}

/** Las líneas más y menos de un turno. */
export const sumaDe = (archivos: readonly ArchivoPunto[]) => archivos.reduce((s, a) => ({ mas: s.mas + a.mas, menos: s.menos + a.menos }), { mas: 0, menos: 0 });

/**
 * El diff unificado de UN archivo (`git diff-tree -p`) en filas, con el número de línea de cada lado. Sin encabezados; sin cuerpo
 * (un binario, un cambio de modo) devuelve `[]`. Entre dos hunks va una fila `~` con el encabezado.
 */
export function parsearDif(texto: string): FilaDiff[] {
  const filas: FilaDiff[] = [];
  let a = 0;
  let b = 0;
  let en = false;
  for (const l of texto.split("\n")) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (h) {
      a = Number(h[1]);
      b = Number(h[2]);
      if (en) filas.push({ t: "~", a: null, b: null, x: l.replace(/\r$/, "") });
      en = true;
      continue;
    }
    if (!en) continue;
    const c = l[0];
    const x = l.slice(1).replace(/\r$/, "");
    if (c === "+") filas.push({ t: "+", a: null, b: b++, x });
    else if (c === "-") filas.push({ t: "-", a: a++, b: null, x });
    else if (c === " ") filas.push({ t: " ", a: a++, b: b++, x });
    // «\ No newline at end of file» y la línea vacía del final no son filas.
  }
  return filas;
}
