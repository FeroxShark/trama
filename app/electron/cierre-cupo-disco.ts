// Lo de afuera del cierre ordenado (electron/cierre-cupo.ts): lee la señal previa, corre el vigilante con el uso de la
// cabecera y los Ajustes, escribe `$PA_STATE/cierre-cupo.json` atómico (o lo borra si no queda nada) y avisa a los oyentes
// de `alCierreCupo` con cada entrada que se dispara (la usa la cola/la interfaz). Sin Electron: lo prueba tests/cierre-cupo.test.ts.
import { readFileSync, renameSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { ARCHIVO_CIERRE, crearVigilante, leerSenal, lecturasDeUso, senalDe, type AjustesCierre, type EntradaCierre, type UsoMin } from "./cierre-cupo.ts";

const leer = (f: string): string | null => {
  try {
    return readFileSync(f, "utf8");
  } catch {
    return null;
  }
};

let tmps = 0;
/** Temporal en la misma carpeta + rename: quien lee ve el archivo viejo o el nuevo, nunca uno a medias. */
export function escribirSenalAtomica(archivo: string, texto: string): void {
  mkdirSync(path.dirname(archivo), { recursive: true });
  const tmp = `${archivo}.${process.pid}.${++tmps}.tmp`;
  writeFileSync(tmp, texto);
  renameSync(tmp, archivo);
}

/**
 * El cierre de una carpeta de estado (`dir`: `$PA_STATE`). `ajustes`: se lee en cada revisión (lo que diga modelos.json ahora).
 * `revisar(uso, ahora)` devuelve las entradas que se dispararon.
 */
export function crearCierreCupo(dir: string, ajustes: () => AjustesCierre) {
  const archivo = path.join(dir, ARCHIVO_CIERRE);
  const vig = crearVigilante(leerSenal(leer(archivo)));
  const oyentes = new Set<(e: EntradaCierre) => void>();

  function revisar(uso: UsoMin | null | undefined, ahora = Math.floor(Date.now() / 1000)): EntradaCierre[] {
    const a = ajustes();
    const p = vig.paso(lecturasDeUso(uso), a, ahora);
    if (p.cambio) {
      if (p.entradas.length) escribirSenalAtomica(archivo, JSON.stringify(senalDe(p.entradas, a, ahora), null, 2) + "\n");
      else rmSync(archivo, { force: true });
    }
    for (const e of p.nuevas) for (const fn of oyentes) fn(e);
    return p.nuevas;
  }

  /** Avisa cada entrada que se dispara (una vez por ventana). Devuelve cómo dejar de oír. */
  function alCierreCupo(fn: (e: EntradaCierre) => void): () => void {
    oyentes.add(fn);
    return () => oyentes.delete(fn);
  }

  return { archivo, revisar, alCierreCupo, entradas: vig.entradas };
}
