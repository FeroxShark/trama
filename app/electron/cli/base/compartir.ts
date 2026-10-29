// Lo compartido de una cuenta agregada con el home de verdad (`cuentas`): cada carpeta (projects, plugins, skills…) es un symlink
// (junction en Windows) y cada archivo (settings.json…) un symlink (hardlink o copia en Windows) a ~/.claude.
// Si la cuenta ya tiene la suya propia (Claude la crea sola si no estaba el enlace), NO se borra nada: lo que tiene se MUEVE al
// compartido sólo donde allá no existe (los transcripts de projects por carpeta de proyecto, sin pisar) y recién entonces se
// reemplaza la carpeta, ya vacía, por el enlace. Lo que no se pueda mover queda donde está y se avisa.
import { copyFileSync, cpSync, existsSync, linkSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, rmdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import type { Plataforma } from "../../rutas.ts";
import { borrarSinSeguir, enlazarArchivo, enlazarDir, type OpcionesEnlace } from "./enlaces.ts";

export type OpcionesUnion = {
  plat: Plataforma;
  enlace?: OpcionesEnlace;
  /** Una línea para la persona (ya con el nombre de la cuenta si hace falta). */
  avisar: (m: string) => void;
};

const lstatBig = (p: string) => {
  try {
    return lstatSync(p, { bigint: true });
  } catch {
    return null;
  }
};

/** Mueve `a` a `b` (que no existe). Entre volúmenes copia y recién después borra el original. */
function mover(a: string, b: string) {
  mkdirSync(path.dirname(b), { recursive: true });
  try {
    renameSync(a, b);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "EXDEV" && code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") throw e;
    cpSync(a, b, { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true });
    borrarSinSeguir(a);
  }
}

const iguales = (a: string, b: string) => {
  try {
    const x = statSync(a);
    const y = statSync(b);
    return x.isFile() && y.isFile() && x.size === y.size && readFileSync(a).equals(readFileSync(b));
  } catch {
    return false;
  }
};

/** Pasa lo de la carpeta `a` a la `b` sólo donde `b` no lo tiene. Devuelve lo que no se pudo mover (rutas relativas). */
function unirCarpetas(a: string, b: string, rel = ""): string[] {
  const pendientes: string[] = [];
  for (const n of readdirSync(a)) {
    const pa = path.join(a, n);
    const pb = path.join(b, n);
    const r = rel ? `${rel}/${n}` : n;
    try {
      const sa = lstatSync(pa);
      const sb = lstatBig(pb);
      if (!sb) mover(pa, pb);
      else if (sa.isDirectory() && sb.isDirectory()) {
        pendientes.push(...unirCarpetas(pa, pb, r));
        try {
          rmdirSync(pa); // sólo si quedó vacía
        } catch {
          /* queda: tiene pendientes */
        }
      } else if (iguales(pa, pb)) unlinkSync(pa); // el mismo contenido ya está allá: no se pierde nada
      else pendientes.push(r);
    } catch {
      pendientes.push(r);
    }
  }
  return pendientes;
}

function unirDir(s: string, t: string, o: OpcionesUnion) {
  const ss = lstatBig(s);
  if (ss && !(ss.isDirectory() || (ss.isSymbolicLink() && existsSync(s) && statSync(s).isDirectory()))) {
    o.avisar(`${s} no es una carpeta: dejo ${t} como está`);
    return;
  }
  let pendientes: string[] = [];
  try {
    if (!ss) mover(t, s);
    else pendientes = unirCarpetas(t, s);
  } catch (e) {
    o.avisar(`no pude mover ${t} a ${s}: ${(e as NodeJS.ErrnoException).message}`);
    return;
  }
  if (pendientes.length) {
    o.avisar(`${t} sigue siendo propia: ${pendientes.length} cosa(s) no se pudieron mover a ${s} (por ej. ${pendientes[0]}); no se borró nada`);
    return;
  }
  try {
    if (lstatBig(t)) rmdirSync(t); // ya está vacía
    enlazarDir(s, t, o.enlace);
  } catch (e) {
    o.avisar(`no pude enlazar ${t}: ${(e as NodeJS.ErrnoException).message}`);
  }
}

/** Hardlink por un nombre temporal y rename: si el hardlink no se puede, el archivo de siempre queda intacto. */
function reenlazar(s: string, t: string, o: OpcionesUnion): boolean {
  const tmp = `${t}.trama-tmp`;
  try {
    rmSync(tmp, { force: true });
    (o.enlace?.link ?? linkSync)(s, tmp);
    renameSync(tmp, t);
    return true;
  } catch {
    rmSync(tmp, { force: true });
    return false;
  }
}

function unirArchivo(s: string, t: string, lt: ReturnType<typeof lstatBig>, o: OpcionesUnion) {
  const ls = lstatBig(s);
  try {
    if (!ls) {
      if (lt!.size === 0n) return; // vacío y sin original: nada que compartir todavía
      mover(t, s);
      enlazarArchivo(s, t, o.enlace);
      return;
    }
    if (!ls.isFile()) return;
    if (ls.ino !== 0n && ls.ino === lt!.ino && ls.dev === lt!.dev) return; // ya es el mismo archivo
    if (lt!.size === 0n || iguales(s, t)) {
      reenlazar(s, t, o); // si no se puede queda la copia de siempre: es igual
      return;
    }
    if (lt!.mtimeMs < ls.mtimeMs) {
      // copia vieja de ~/.claude: se actualiza (con respaldo de lo que había) y, si se puede, pasa a ser el mismo archivo
      if (!existsSync(`${t}.trama-previo`)) copyFileSync(t, `${t}.trama-previo`);
      if (!reenlazar(s, t, o)) copyFileSync(s, t);
      return;
    }
    o.avisar(`${t} es distinto a ${s} y más nuevo: lo dejo como está (no se borró nada)`);
  } catch (e) {
    o.avisar(`no pude compartir ${t}: ${(e as NodeJS.ErrnoException).message}`);
  }
}

/**
 * Deja `t` (en la carpeta de la cuenta) compartido con `s` (en el home de verdad). Sin nada en `t`: lo enlaza (si `s` existe).
 * Con un enlace ya puesto: nada. Con carpeta propia: la migra. Con archivo propio (sólo en Windows, donde el enlace puede
 * haberse desacoplado): lo vuelve el mismo archivo o, si es una copia, lo mantiene al día.
 */
export function unirEnlace(s: string, t: string, o: OpcionesUnion) {
  const lt = lstatBig(t);
  if (!lt) {
    const ls = lstatBig(s);
    if (!ls) return;
    try {
      mkdirSync(path.dirname(t), { recursive: true });
      if (statSync(s).isDirectory()) enlazarDir(s, t, o.enlace);
      else enlazarArchivo(s, t, o.enlace);
    } catch (e) {
      o.avisar(`no pude enlazar ${t}: ${(e as NodeJS.ErrnoException).message}`);
    }
    return;
  }
  if (lt.isSymbolicLink()) return; // symlink o junction
  if (lt.isDirectory()) return unirDir(s, t, o);
  if (lt.isFile() && o.plat === "win32") unirArchivo(s, t, lt, o);
}
