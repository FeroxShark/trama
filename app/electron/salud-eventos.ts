// La salud de Trama en un archivo chico: `$HILOS_STATE/salud-eventos.jsonl`, una línea JSON por cosa que pasó
// (`{t, tipo, ...datos}`), junto a `trama.log`. Guarda sólo los últimos `MAX_EVENTOS`. Lo lee la interfaz por `salud:eventos`
// (un bloque «Salud» de Ajustes). Escribir nunca tira la app: si falla, el evento se pierde y listo.
// Aparte de electron/salud.ts (la salud de lo integrado en ramas).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ESTADO } from "./estado.ts";

export const ARCHIVO_SALUD = path.join(ESTADO, "salud-eventos.jsonl");
/** Cuántos eventos se guardan: al pasarse se tiran los más viejos. */
export const MAX_EVENTOS = 200;

/** Lo que se anota. `vuelta-version`: Trama volvió a una versión anterior; `reinicio`: un reinicio completo (`ms`); `lideres-cortados`:
 *  líderes que no cerraron a tiempo y recibieron SIGTERM (`n`); `aviso-descartado`: un aviso de worker que no se entregó (`motivo`). */
export type EventoSalud =
  | { tipo: "vuelta-version"; version?: string; motivo?: string }
  | { tipo: "reinicio"; ms: number }
  | { tipo: "lideres-cortados"; n: number }
  | { tipo: "aviso-descartado"; motivo?: string };
export type EventoGuardado = EventoSalud & { t: number };

const MS_DIA = 86_400_000;

/** Agrega una línea y deja las últimas `MAX_EVENTOS`. Nunca lanza. */
export function anotar(e: EventoSalud, archivo = ARCHIVO_SALUD, t = Date.now()): void {
  try {
    let antes: string[] = [];
    try {
      antes = readFileSync(archivo, "utf8").split("\n").filter(Boolean);
    } catch {
      // Sin archivo todavía.
    }
    // Se reescribe entero (son pocas líneas): así una última línea cortada a medias no se pega con la nueva.
    const lineas = [...antes, JSON.stringify({ t, ...e })].slice(-MAX_EVENTOS);
    writeFileSync(archivo, `${lineas.join("\n")}\n`);
  } catch {
    // La salud no puede romper lo que mide.
  }
}

/** Los eventos de los últimos `dias` días (más viejo primero). Una línea rota se salta; sin archivo, `[]`. Nunca lanza. */
export function leer(dias: number, archivo = ARCHIVO_SALUD, ahora = Date.now()): EventoGuardado[] {
  let texto: string;
  try {
    texto = readFileSync(archivo, "utf8");
  } catch {
    return [];
  }
  const desde = ahora - (Number.isFinite(dias) ? Math.max(0, dias) : 0) * MS_DIA;
  const fuera: EventoGuardado[] = [];
  for (const l of texto.split("\n")) {
    if (!l) continue;
    try {
      const e = JSON.parse(l) as EventoGuardado;
      if (e && typeof e === "object" && typeof e.t === "number" && typeof e.tipo === "string" && e.t >= desde) fuera.push(e);
    } catch {
      // Una línea a medio escribir o rota: se salta.
    }
  }
  return fuera;
}
