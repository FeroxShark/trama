// Enlaces (caches compartidos del worktree: node_modules, .venv, target, .env, transcript) y borrado que no los atraviesa.
//   carpeta: symlink en POSIX; junction en Windows (no pide privilegios; el destino tiene que ser absoluto).
//   archivo: symlink en POSIX; en Windows hardlink si el destino está en el mismo volumen, y si no, copia.
// Ojo en Windows: un hardlink o una copia NO siguen al original si una herramienta lo reescribe con rename (se desacoplan); para
// los `.env` y similares (se leen, no se reescriben) alcanza. Ojo también con `realpath` sobre un junction: devuelve el destino.
import { copyFileSync, linkSync, lstatSync, readdirSync, rmdirSync, symlinkSync, unlinkSync, chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { plataformaActual, type Plataforma } from "../../rutas.ts";
import { conReintentoSync } from "./archivo.ts";

export type TipoEnlace = "symlink" | "junction" | "hardlink" | "copia";

export type OpcionesEnlace = {
  plat?: Plataforma;
  /** `fs.symlinkSync`, inyectable (los tests miran el tipo que se pide). */
  symlink?: (destino: string, enlace: string, tipo?: "dir" | "file" | "junction") => void;
  link?: (destino: string, enlace: string) => void;
  copiar?: (destino: string, enlace: string) => void;
};

/** `enlace` pasa a apuntar al directorio `destino`. Crea la carpeta de `enlace`. Devuelve qué se usó. Lanza EEXIST si ya hay algo. */
export function enlazarDir(destino: string, enlace: string, o: OpcionesEnlace = {}): TipoEnlace {
  const plat = o.plat ?? plataformaActual();
  const sym = o.symlink ?? ((d, e, t) => symlinkSync(d, e, t));
  mkdirSync(path.dirname(enlace), { recursive: true });
  if (plat === "win32") {
    sym(path.win32.resolve(destino), enlace, "junction");
    return "junction";
  }
  sym(destino, enlace, "dir");
  return "symlink";
}

/** `enlace` pasa a ser el archivo `destino` (symlink, hardlink o copia, según la plataforma). */
export function enlazarArchivo(destino: string, enlace: string, o: OpcionesEnlace = {}): TipoEnlace {
  const plat = o.plat ?? plataformaActual();
  mkdirSync(path.dirname(enlace), { recursive: true });
  if (plat !== "win32") {
    (o.symlink ?? ((d, e, t) => symlinkSync(d, e, t)))(destino, enlace, "file");
    return "symlink";
  }
  try {
    (o.link ?? linkSync)(destino, enlace);
    return "hardlink";
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || code === "ENOENT") throw e;
    (o.copiar ?? ((d, l) => copyFileSync(d, l)))(destino, enlace); // EXDEV (otro volumen), EPERM (FAT/red)…
    return "copia";
  }
}

const esLink = (p: string) => {
  try {
    return lstatSync(p).isSymbolicLink(); // Node informa los junctions de Windows como symlink
  } catch {
    return false;
  }
};

function soltarLink(p: string) {
  try {
    unlinkSync(p);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    if (code === "EPERM" || code === "EISDIR" || code === "EACCES") rmdirSync(p); // junction/symlink de carpeta en Windows
    else throw e;
  }
}

function borrar(p: string) {
  let st;
  try {
    st = lstatSync(p);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  if (st.isSymbolicLink()) return soltarLink(p); // se borra el enlace, jamás lo que hay detrás
  if (st.isDirectory()) {
    for (const n of readdirSync(p)) borrar(path.join(p, n));
    try {
      rmdirSync(p);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    return;
  }
  try {
    unlinkSync(p);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    if (code === "EPERM" || code === "EACCES") {
      chmodSync(p, 0o666); // archivos de sólo lectura (.git/objects) en Windows
      unlinkSync(p);
    } else throw e;
  }
}

/**
 * Borra `ruta` (archivo, carpeta o enlace) recursivamente SIN seguir symlinks ni junctions: un enlace dentro del árbol se quita
 * como enlace y su destino queda intacto (el `rm -r` sin barra final de bash). Reintenta ~2 s ante EBUSY/EPERM/EACCES/ENOTEMPTY
 * (antivirus). Si `ruta` no existe, no hace nada.
 */
export function borrarSinSeguir(ruta: string, o: { maxMs?: number } = {}): void {
  const fin = Date.now() + (o.maxMs ?? 2000);
  for (;;) {
    try {
      conReintentoSync(() => borrar(ruta), Math.max(0, fin - Date.now()));
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "ENOTEMPTY" || Date.now() >= fin) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

export { esLink };
