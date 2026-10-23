// Volver como estaba en TODO arranque (un Ctrl+Q, un apagón, el reinicio del cartel de la actualización):
// `$HILOS_STATE/volver.json` guarda cómo está la ventana (tamaño; y, si el usuario tocó Reiniciar, a la vista,
// con el foco y en Hyprland su escritorio y su lugar) y lo que cada vista tiene abierto (conversación, panel,
// scroll). Se reescribe con cada cambio (demorado, `crearGuardadoVolver`) y no se gasta al leerlo: la trama
// que arranca lo lee y lo deja. Lo escrito sin mandar no va acá: `electron/borradores.ts`.
// Sin `electron` ni imports locales salvo capacidades.ts: lo prueba tests/volver.test.ts. Lo arman main.ts e ipc.ts (la ventana).
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { capacidades } from "./capacidades.ts";

/** Lo más grande que se guarda de una vista. */
const VISTA_MAX = 2 * 1024 * 1024;
const TOPE_MS = 2000;
/** Cuánto se espera, tras un cambio, antes de escribir (los cambios seguidos, como un scroll, hacen una sola escritura). */
export const DEMORA_MS = 500;

/** Dónde tenía Hyprland la ventana. */
export type Lugar = { direccion: string; escritorio: number; flota: boolean; en: [number, number]; mide: [number, number] };
export type Ventana = { ancho: number; alto: number; visible: boolean; foco: boolean; lugar: Lugar | null };
/** `vistas`: lo que mandó cada vista (la ventana: "ventana"), tal cual; lo entiende el renderer (src/volver.ts). */
export type Volver = { version: 1; cuando: number; ventana: Ventana | null; vistas: Record<string, unknown> };

const entero = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const par = (x: unknown): x is [number, number] => Array.isArray(x) && x.length === 2 && x.every(entero);

function lugarDe(x: unknown): Lugar | null {
  const l = x as Partial<Lugar> | null;
  if (!l || typeof l.direccion !== "string" || !entero(l.escritorio) || !par(l.en) || !par(l.mide)) return null;
  return { direccion: l.direccion, escritorio: l.escritorio, flota: l.flota === true, en: l.en, mide: l.mide };
}

/** Lo que dejó la trama anterior. Roto, de otra versión o ausente: `null` (se abre como siempre). */
export function leerVolver(archivo: string): Volver | null {
  try {
    const j = JSON.parse(readFileSync(archivo, "utf8")) as Partial<Volver> | null;
    if (j?.version !== 1 || !entero(j.cuando)) return null;
    const v = j.ventana as Partial<Ventana> | null | undefined;
    const ventana = v && entero(v.ancho) && entero(v.alto) && v.ancho >= 200 && v.alto >= 200
      ? { ancho: Math.round(v.ancho), alto: Math.round(v.alto), visible: v.visible === true, foco: v.foco === true, lugar: lugarDe(v.lugar) }
      : null;
    const vistas = j.vistas && typeof j.vistas === "object" && !Array.isArray(j.vistas) ? (j.vistas as Record<string, unknown>) : {};
    return { version: 1, cuando: j.cuando, ventana, vistas };
  } catch {
    return null;
  }
}

/** Escribe sin que nadie lea el archivo a medias (tmp + rename). */
export function guardarVolver(archivo: string, v: Omit<Volver, "version" | "cuando">, ahora = Date.now()) {
  mkdirSync(path.dirname(archivo), { recursive: true });
  const vistas: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v.vistas)) {
    try {
      if (JSON.stringify(x).length <= VISTA_MAX) vistas[k] = x;
    } catch {}
  }
  const tmp = `${archivo}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: 1, cuando: ahora, ventana: v.ventana, vistas }));
  renameSync(tmp, archivo);
}

/**
 * Mantiene `volver.json` al día sin que nadie lo pida: la ventana avisa lo que tiene abierto (`vista`) y
 * el main que cambió su tamaño (`tocar`); cada aviso programa una escritura a los `demoraMs` (los seguidos
 * hacen una). `ahora` escribe ya (al salir). `congelar` la deja quieta: el reinicio del cartel escribe lo suyo
 * (con el escritorio y el lugar) y no quiere que la salida le pise el archivo.
 */
export function crearGuardadoVolver(o: { archivo: string; ventana: () => Ventana | null; vistaInicial?: unknown; demoraMs?: number }) {
  let vista: unknown = o.vistaInicial ?? null;
  let t: NodeJS.Timeout | null = null;
  let quieto = false;
  const escribir = () => {
    if (t) clearTimeout(t);
    t = null;
    if (quieto) return;
    try {
      guardarVolver(o.archivo, { ventana: o.ventana(), vistas: vista === null ? {} : { ventana: vista } });
    } catch {
      // Sin disco no hay con qué volver; la app sigue.
    }
  };
  const programar = () => {
    if (quieto || t) return;
    t = setTimeout(escribir, o.demoraMs ?? DEMORA_MS);
    t.unref();
  };
  return {
    /** Lo que la ventana tiene abierto ahora. */
    vista(v: unknown) {
      vista = v;
      programar();
    },
    /** La ventana cambió de tamaño. */
    tocar: programar,
    ahora: escribir,
    congelar() {
      quieto = true;
      if (t) clearTimeout(t);
      t = null;
    },
  };
}

// --- Hyprland -----------------------------------------------------------------------
// Una ventana nueva sale en el escritorio activo; la que se reinició puede haber estado en otro (el usuario
// tocó Reiniciar desde el celular, o esperó a que terminaran las tareas). Se la devuelve con `hyprctl`,
// **siempre nombrando la ventana por su dirección**: un dispatch sin ventana actúa sobre la que tiene
// el foco, que es del usuario. Sin Hyprland (o si `hyprctl` falla) no se hace nada.

const hyprctl = () => process.env.HILOS_HYPRCTL ?? "hyprctl";
const correr = (args: string[]) =>
  !capacidades().hyprctl
    ? Promise.resolve(null)
    : new Promise<string | null>((ok) => execFile(hyprctl(), args, { timeout: TOPE_MS }, (e, salida) => ok(e ? null : salida)));

/** Dónde está la ventana de ese proceso (el main de trama es el pid de su ventana), o `null`. */
export async function lugarDeVentana(pid: number): Promise<Lugar | null> {
  try {
    const j = JSON.parse((await correr(["clients", "-j"])) ?? "") as unknown;
    const c = (Array.isArray(j) ? j : []).find((c) => c?.pid === pid && c.mapped !== false);
    return c ? lugarDe({ direccion: c.address, escritorio: c.workspace?.id, flota: c.floating, en: c.at, mide: c.size }) : null;
  } catch {
    return null;
  }
}

/**
 * Los `dispatch` que dejan la ventana donde estaba, cada uno en las dos sintaxis (la de Lua primero, como
 * electron/terminal.ts). Al escritorio de antes sin llevarse el foco; el lugar y el tamaño sólo si flotaba y
 * flota (en mosaico los decide Hyprland). Los escritorios especiales (id negativo) no se tocan.
 */
export function pasos(antes: Lugar, ahora: Lugar): string[][][] {
  if (!/^0x[0-9a-f]+$/i.test(ahora.direccion)) return [];
  const w = `address:${ahora.direccion}`;
  const r: string[][][] = [];
  if (antes.escritorio > 0 && antes.escritorio !== ahora.escritorio)
    r.push([
      ["dispatch", `hl.dsp.window.move({ workspace = ${antes.escritorio}, follow = false, window = "${w}" })`],
      ["dispatch", "movetoworkspacesilent", `${antes.escritorio},${w}`],
    ]);
  if (antes.flota && ahora.flota) {
    const [x, y] = antes.en.map(Math.round);
    const [an, al] = antes.mide.map(Math.round);
    if (x !== ahora.en[0] || y !== ahora.en[1])
      r.push([
        ["dispatch", `hl.dsp.window.move({ x = ${x}, y = ${y}, window = "${w}" })`],
        ["dispatch", "movewindowpixel", `exact ${x} ${y},${w}`],
      ]);
    if (an !== ahora.mide[0] || al !== ahora.mide[1])
      r.push([
        ["dispatch", `hl.dsp.window.resize({ x = ${an}, y = ${al}, window = "${w}" })`],
        ["dispatch", "resizewindowpixel", `exact ${an} ${al},${w}`],
      ]);
  }
  return r;
}

/** Devuelve la ventana recién mostrada de ese proceso adonde estaba. Espera un poco a que Hyprland la vea. */
export async function acomodar(pid: number, antes: Lugar, intentos = 10, cadaMs = 150): Promise<boolean> {
  for (let i = 0; i < intentos; i++) {
    const ahora = await lugarDeVentana(pid);
    if (ahora) {
      for (const formas of pasos(antes, ahora)) for (const args of formas) if ((await correr(args))?.trim() === "ok") break;
      return true;
    }
    await new Promise((r) => setTimeout(r, cadaMs));
  }
  return false;
}
