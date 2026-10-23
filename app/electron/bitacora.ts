// El log propio de la app (`trama.log` en el estado propio): lo que salió mal y no tenía dónde quedar
// escrito. Un archivo de texto con rotación por tamaño (`trama.log`, `.1`, `.2`: el viejo se pierde) y
// el tope de recargas del renderer. Nunca tira: si no se puede escribir, calla. Sin imports de
// `electron`: lo prueba tests/bitacora.test.ts.
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";

export const MAX_BYTES = 1024 * 1024;
export const ARCHIVOS = 3;
/** Una entrada más larga se corta: un stack enorme no se come el archivo. */
const MAX_ENTRADA = 8 * 1024;

export type Nivel = "error" | "aviso" | "info";

/** Un error (o lo que se haya tirado) como texto: el stack si lo tiene. */
export function describir(e: unknown): string {
  if (e instanceof Error) return e.stack ?? `${e.name}: ${e.message}`;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e) ?? String(e);
  } catch {
    return String(e);
  }
}

export type Bitacora = {
  archivo: string;
  escribir(nivel: Nivel, donde: string, detalle: unknown): void;
};

export function crearBitacora(o: { archivo: string; maxBytes?: number; archivos?: number; ahora?: () => number; eco?: (linea: string) => void }): Bitacora {
  const max = o.maxBytes ?? MAX_BYTES;
  const archivos = Math.max(1, o.archivos ?? ARCHIVOS);
  const ahora = o.ahora ?? Date.now;
  let tam: number | null = null;

  const vecino = (n: number) => (n === 0 ? o.archivo : `${o.archivo}.${n}`);
  function rotar() {
    rmSync(vecino(archivos - 1), { force: true });
    for (let n = archivos - 2; n >= 0; n--) {
      try {
        renameSync(vecino(n), vecino(n + 1));
      } catch {
        // No existía: nada que mover.
      }
    }
    tam = 0;
  }

  return {
    archivo: o.archivo,
    escribir(nivel, donde, detalle) {
      try {
        let texto = describir(detalle);
        if (texto.length > MAX_ENTRADA) texto = `${texto.slice(0, MAX_ENTRADA)}… (cortado)`;
        // Un stack ocupa varias líneas: las de abajo van con sangría, que cada entrada empiece en su fecha.
        const linea = `${new Date(ahora()).toISOString()} ${nivel} [${donde}] ${texto.replace(/\n/g, "\n  ")}\n`;
        o.eco?.(linea.trimEnd());
        mkdirSync(path.dirname(o.archivo), { recursive: true });
        if (tam === null) {
          try {
            tam = statSync(o.archivo).size;
          } catch {
            tam = 0;
          }
        }
        const bytes = Buffer.byteLength(linea);
        if (tam > 0 && tam + bytes > max) rotar();
        appendFileSync(o.archivo, linea);
        tam += bytes;
      } catch {
        // El log no puede ser otra causa de caída.
      }
    },
  };
}

/**
 * Cuántas veces puede morir el renderer en una ventana de tiempo antes de dejar de recargarlo:
 * `muerte()` anota una y dice si se lo recarga. Con el tope en 3, las dos primeras muertes del minuto
 * se recargan y la tercera deja el cartel.
 */
export function crearTope(o: { max?: number; ventanaMs?: number; ahora?: () => number } = {}) {
  const max = o.max ?? 3;
  const ventana = o.ventanaMs ?? 60_000;
  const ahora = o.ahora ?? Date.now;
  let muertes: number[] = [];
  return {
    muerte(): boolean {
      const t = ahora();
      muertes = muertes.filter((m) => t - m < ventana);
      muertes.push(t);
      return muertes.length < max;
    },
    /** El usuario recargó a mano desde el cartel: se empieza de cero. */
    reiniciar() {
      muertes = [];
    },
  };
}
