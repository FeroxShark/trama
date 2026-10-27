// Escritura de archivos que sobrevive al antivirus de Windows (EBUSY/EPERM/EACCES en rename y borrados) y a dos `pa` a la vez.
// Siempre `\n` (nunca `\r\n`) en lo que se escribe: los contratos de disco se comparan byte a byte.
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tomar } from "./lock.ts";

const REINTENTABLES = new Set(["EBUSY", "EPERM", "EACCES"]);
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const dormirSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export type OpcionesReintento = {
  /** Tope total de reintentos (ms). 2000 por defecto. */
  maxMs?: number;
  /** `rename` inyectable (los tests simulan EPERM). */
  renombrar?: (de: string, a: string) => Promise<void>;
};

/** Reintenta `f` mientras falle con EBUSY/EPERM/EACCES, esperando 10, 20, 40… ms (tope ~2 s por defecto). */
export async function conReintento<T>(f: () => Promise<T>, maxMs = 2000): Promise<T> {
  const fin = Date.now() + maxMs;
  let espera = 10;
  for (;;) {
    try {
      return await f();
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (!code || !REINTENTABLES.has(code) || Date.now() + espera > fin) throw e;
      await dormir(espera);
      espera = Math.min(espera * 2, 250);
    }
  }
}

export function conReintentoSync<T>(f: () => T, maxMs = 2000): T {
  const fin = Date.now() + maxMs;
  let espera = 10;
  for (;;) {
    try {
      return f();
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (!code || !REINTENTABLES.has(code) || Date.now() + espera > fin) throw e;
      dormirSync(espera);
      espera = Math.min(espera * 2, 250);
    }
  }
}

/** Texto con `\n` siempre (un `\r\n` o `\r` suelto que venga de afuera se normaliza). Los Buffer pasan tal cual. */
export const conLF = (x: string | Uint8Array): string | Uint8Array => (typeof x === "string" ? x.replace(/\r\n?/g, "\n") : x);

const tmpDe = (ruta: string) => `${ruta}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;

/** Escribe `contenido` en `ruta` de forma atómica: `<ruta>.tmp.*` + rename, con reintento si el antivirus tiene el archivo. Crea la carpeta. */
export async function escribirAtomico(ruta: string, contenido: string | Uint8Array, o: OpcionesReintento & { modo?: number } = {}): Promise<void> {
  await mkdir(path.dirname(ruta), { recursive: true });
  const tmp = tmpDe(ruta);
  const renombrar = o.renombrar ?? rename;
  try {
    await writeFile(tmp, conLF(contenido), { mode: o.modo });
    await conReintento(() => renombrar(tmp, ruta), o.maxMs);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

export function escribirAtomicoSync(ruta: string, contenido: string | Uint8Array, o: { maxMs?: number; modo?: number; renombrar?: (de: string, a: string) => void } = {}): void {
  mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = tmpDe(ruta);
  const renombrar = o.renombrar ?? renameSync;
  try {
    writeFileSync(tmp, conLF(contenido), { mode: o.modo });
    conReintentoSync(() => renombrar(tmp, ruta), o.maxMs);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/** Escribe un JSON (con `\n` al final) de forma atómica. */
export const escribirJson = (ruta: string, valor: unknown, o: OpcionesReintento & { modo?: number; espacios?: number } = {}) =>
  escribirAtomico(ruta, JSON.stringify(valor, null, o.espacios ?? 2) + "\n", o);

/**
 * Agrega UNA línea (siempre terminada en un solo `\n`) bajo lock, así dos `pa` que escriben a la vez no mezclan bytes
 * (el `( flock 4; printf >&4 )` de bash). El lock se llama `<ruta>.append` (no la ruta misma: quien ya tenga tomado `ruta` por otra
 * razón no se bloquea a sí mismo). Si no consigue el lock en `esperarMs` (10 s) lanza: no escribe a medias.
 */
export async function agregarLinea(ruta: string, linea: string, o: { esperarMs?: number; clave?: string } = {}): Promise<void> {
  const limpia = String(conLF(linea)).replace(/\n+$/, "");
  await mkdir(path.dirname(ruta), { recursive: true });
  const lock = await tomar(o.clave ?? `${ruta}.append`, { esperarMs: o.esperarMs ?? 10_000 });
  if (!lock) throw new Error(`no pude tomar el lock para agregar a ${ruta}`);
  try {
    await conReintento(() => appendFile(ruta, limpia + "\n"));
  } finally {
    await lock.liberar();
  }
}

/** Lee y parsea un JSON; `defecto` si falta, está vacío o roto (tolera BOM y `\r\n`). Nunca tira. */
export async function leerJson<T = unknown>(ruta: string, defecto?: T): Promise<T | undefined> {
  try {
    return parsear<T>(await readFile(ruta, "utf8"), defecto);
  } catch {
    return defecto;
  }
}

export function leerJsonSync<T = unknown>(ruta: string, defecto?: T): T | undefined {
  try {
    return parsear<T>(readFileSync(ruta, "utf8"), defecto);
  } catch {
    return defecto;
  }
}

function parsear<T>(texto: string, defecto?: T): T | undefined {
  const t = texto.replace(/^﻿/, "").trim();
  if (!t) return defecto;
  try {
    return JSON.parse(t) as T;
  } catch {
    return defecto;
  }
}
