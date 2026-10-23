// Mirar una carpeta con inotify y no quedarse ciego: si el watcher falla (error) o se cierra solo, se
// vuelve a armar con espera creciente (1 s, 2 s, 4 s … tope 30 s) y cada fallo queda en el log de
// contención. Sin polling mientras anda: el reintento sólo existe después de una caída. Una carpeta que
// no existe al armar por primera vez no se reintenta (devuelve `null`: el que llama decide cuándo
// volver a pedirla, como antes). Sin Electron: lo prueba `tests/mirar.test.ts` con un watcher falso.
import { watch as watchReal, type FSWatcher } from "node:fs";
import { log as logReal } from "./log.ts";
import type { Bitacora } from "./bitacora.ts";

export const ESPERA_MIN_MS = 1000;
export const ESPERA_TOPE_MS = 30_000;

export type Mirada = { cerrar(): void };

type Watcher = Pick<FSWatcher, "close" | "on">;

export type OpcionesMirar = {
  /** Cómo aparece en el log. */
  donde: string;
  /** Después de volver a armar: lo que pasó mientras estuvo ciego no llegó, hay que releer. */
  alRearmar?: () => void;
  // Para los tests.
  log?: Bitacora;
  watch?: (dir: string, fn: (tipo: string, nombre: string | Buffer | null) => void) => Watcher;
  esperar?: (fn: () => void, ms: number) => unknown;
  cancelar?: (t: unknown) => void;
  ahora?: () => number;
};

export function mirarCarpeta(dir: string, alEvento: (tipo: string, nombre: string | Buffer | null) => void, o: OpcionesMirar): Mirada | null {
  const log = o.log ?? logReal;
  const crear = o.watch ?? ((d, fn) => watchReal(d, fn));
  const esperar = o.esperar ?? ((fn, ms) => setTimeout(fn, ms));
  const cancelar = o.cancelar ?? ((t) => clearTimeout(t as NodeJS.Timeout));
  const ahora = o.ahora ?? Date.now;
  let cerrado = false;
  let actual: Watcher | null = null;
  let armadoEn = 0;
  let demora = ESPERA_MIN_MS;
  let reloj: unknown = null;

  function caer(w: Watcher, motivo: unknown) {
    if (cerrado || w !== actual) return;
    actual = null;
    try {
      w.close();
    } catch {}
    // Si estuvo sano un buen rato, la caída es nueva: se empieza de cero.
    if (ahora() - armadoEn > ESPERA_TOPE_MS) demora = ESPERA_MIN_MS;
    log.escribir("aviso", `mirar ${o.donde}`, `el watcher de ${dir} se cayó (${motivo instanceof Error ? motivo.message : String(motivo)}): se rearma en ${demora / 1000} s`);
    reloj = esperar(rearmar, demora);
    demora = Math.min(ESPERA_TOPE_MS, demora * 2);
  }

  function armar() {
    const w = crear(dir, alEvento);
    actual = w;
    armadoEn = ahora();
    w.on("error", (e: unknown) => caer(w, e));
    w.on("close", () => caer(w, "cerrado"));
  }

  function rearmar() {
    reloj = null;
    if (cerrado) return;
    try {
      armar();
    } catch (e) {
      log.escribir("aviso", `mirar ${o.donde}`, `no se pudo rearmar ${dir} (${e instanceof Error ? e.message : String(e)}): se reintenta en ${demora / 1000} s`);
      reloj = esperar(rearmar, demora);
      demora = Math.min(ESPERA_TOPE_MS, demora * 2);
      return;
    }
    log.escribir("info", `mirar ${o.donde}`, `watcher de ${dir} rearmado`);
    try {
      o.alRearmar?.();
    } catch (e) {
      log.escribir("aviso", `mirar ${o.donde}`, e);
    }
  }

  try {
    armar();
  } catch (e) {
    // La carpeta no existe (todavía): como siempre, no se insiste. Otra falla sí.
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    log.escribir("aviso", `mirar ${o.donde}`, `no se pudo armar ${dir} (${e instanceof Error ? e.message : String(e)}): se reintenta en ${demora / 1000} s`);
    reloj = esperar(rearmar, demora);
    demora = Math.min(ESPERA_TOPE_MS, demora * 2);
  }
  return {
    cerrar() {
      cerrado = true;
      if (reloj != null) cancelar(reloj);
      reloj = null;
      const w = actual;
      actual = null;
      try {
        w?.close();
      } catch {}
    },
  };
}
