// Actualizar seguro en Linux: guardar la versión que corre antes de instalar la siguiente, y volver a ella (sola, si la nueva no
// arranca bien, o con el botón "Volver a la versión anterior" de Ajustes > General). Las reglas están en arranque-seguro.ts; esto
// es el disco y el reinicio. Sin Electron: lo prueba tests/version-anterior.test.ts con carpetas temporales.
//
// Dos formas de estar instalada, y cada una guarda lo suyo:
//   AppImage   (`$APPIMAGE`)                    la copia es el archivo .AppImage; al volver se pisa el archivo (por rename, atómico).
//   carpeta    (~/.local/share/trama/app)       la copia son `dist/`, `dist-electron/` y `package.json` (lo que cambia entre versiones;
//                                               `node_modules` no, pesa cientos de MB); al volver se cambian por rename uno a uno.
// El AppImage no tiene instalador dentro de la app (lo reemplaza quien lo baja): se copia a sí mismo cuando llega a ventana lista
// (la carpeta también, así una actualización a mano deja a dónde volver). Y la carpeta tiene Actualizar (actualizacion-trama.ts), que
// copia antes de correr el instalador.
import { copyFile, chmod, cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { alArrancar, alSalirAProposito, alTiempoAgotado, alVentanaLista, alVolver, ARRANQUE_MAX_MS, conRespaldo, sinAviso, type Almacen, type Aviso, type Copia, type Motivo } from "./arranque-seguro.ts";

export type Instalacion = { tipo: "appimage"; ruta: string } | { tipo: "carpeta"; app: string };
type Env = NodeJS.ProcessEnv;

/** Lo que se copia de la carpeta de la app (y se restaura): lo que cambia entre versiones. */
export const PARTES = ["dist", "dist-electron", "package.json"] as const;

/** Cómo está instalada esta Trama, o null si no es una instalación (un checkout de desarrollo, un worktree, una prueba). */
export function instalacionDe(env: Env, appDir: string, home: string): Instalacion | null {
  const ai = env.APPIMAGE;
  if (ai && path.isAbsolute(ai) && existsSync(ai)) return { tipo: "appimage", ruta: ai };
  const estable = path.join(home, ".local", "share", "trama", "app");
  return path.resolve(appDir) === estable ? { tipo: "carpeta", app: estable } : null;
}

/** Donde se dejan las copias: junto a la app estable, fuera de ella (el instalador la reescribe). */
export const carpetaCopias = (home: string) => path.join(home, ".local", "share", "trama", "anterior");

/** ¿La copia sigue entera en el disco? */
export async function copiaExiste(c: Copia): Promise<boolean> {
  try {
    if (c.tipo === "carpeta") return (await stat(path.join(c.ruta, "dist-electron", "main.js"))).isFile() && (await stat(path.join(c.ruta, "package.json"))).isFile();
    return (await stat(c.ruta)).size > 0;
  } catch {
    return false;
  }
}

/** Copia la instalación que corre a `base`, atómicamente (se arma aparte y se renombra). La versión sale del nombre: `app-0.2.25`, `Trama-0.2.25.AppImage`. */
export async function guardarCopia(inst: Instalacion, version: string, base: string, ahora: number): Promise<Copia> {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`versión inválida: ${version}`);
  await mkdir(base, { recursive: true });
  if (inst.tipo === "appimage") {
    const destino = path.join(base, `Trama-${version}.AppImage`);
    const tmp = `${destino}.tmp`;
    await copyFile(inst.ruta, tmp);
    await chmod(tmp, 0o755);
    await rename(tmp, destino);
    return { version, tipo: "appimage", ruta: destino, cuando: ahora };
  }
  const destino = path.join(base, `app-${version}`);
  const tmp = `${destino}.tmp`;
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  for (const p of PARTES) await cp(path.join(inst.app, p), path.join(tmp, p), { recursive: true });
  await rm(destino, { recursive: true, force: true });
  await rename(tmp, destino);
  return { version, tipo: "carpeta", ruta: destino, cuando: ahora };
}

/** Borra de `base` lo que ninguna copia viva usa (queda a lo sumo la anterior y el respaldo). */
export async function podar(base: string, vivas: (Copia | null)[]): Promise<void> {
  const quedan = new Set(vivas.filter((c): c is Copia => !!c).map((c) => path.resolve(c.ruta)));
  let nombres: string[] = [];
  try {
    nombres = await readdir(base);
  } catch {
    return;
  }
  for (const n of nombres) if (!quedan.has(path.resolve(base, n))) await rm(path.join(base, n), { recursive: true, force: true }).catch(() => {});
}

/** Pone la copia en lugar de lo instalado (el AppImage o las partes de la carpeta). Si algo falla a la mitad deja lo que había. */
export async function restaurar(inst: Instalacion, c: Copia): Promise<void> {
  if (!(await copiaExiste(c))) throw new Error("la copia de la versión anterior ya no está");
  if (inst.tipo === "appimage") {
    if (c.tipo !== "appimage") throw new Error("la copia no es un AppImage");
    const tmp = `${inst.ruta}.volver`;
    await copyFile(c.ruta, tmp);
    await chmod(tmp, 0o755);
    await rename(tmp, inst.ruta);
    return;
  }
  if (c.tipo !== "carpeta") throw new Error("la copia no es una carpeta de la app");
  const hechas: string[] = [];
  try {
    for (const p of PARTES) {
      const actual = path.join(inst.app, p);
      await rm(`${actual}.malo`, { recursive: true, force: true });
      if (existsSync(actual)) await rename(actual, `${actual}.malo`);
      hechas.push(p);
      await cp(path.join(c.ruta, p), actual, { recursive: true });
    }
  } catch (e) {
    // A la mitad: lo que ya se cambió vuelve a como estaba.
    for (const p of hechas.reverse()) {
      const actual = path.join(inst.app, p);
      await rm(actual, { recursive: true, force: true }).catch(() => {});
      await rename(`${actual}.malo`, actual).catch(() => {});
    }
    throw e;
  }
  // El instalador no recompila si la huella de las fuentes no cambió: la de la versión mala ya no vale para lo que quedó.
  await rm(path.join(inst.app, ".build-huella"), { force: true });
  for (const p of PARTES) await rm(path.join(inst.app, `${p}.malo`), { recursive: true, force: true }).catch(() => {});
}

export type Volvio = { ok: true } | { ok: false; error: string };
export type Deps = {
  almacen: Almacen;
  /** La versión de este proceso (app.getVersion()). */
  version: string;
  inst: Instalacion | null;
  base: string;
  /** Tras restaurar: reinicia el motor y la ventana con lo que quedó (en Electron, `app.relaunch` + `quit`). */
  reiniciar: (inst: Instalacion) => Promise<void> | void;
  ahora?: () => number;
  /** El reloj del tope de arranque (en las pruebas, uno falso). */
  despues?: (f: () => void, ms: number) => { cancelar(): void };
  topeMs?: number;
  /** Cuándo arrancó este proceso (ms): un AppImage más nuevo que eso ya no es éste y no se copia como si lo fuera. */
  inicio?: number;
  log?: (m: string) => void;
};

export function crearVersionAnterior(d: Deps) {
  const ahora = d.ahora ?? Date.now;
  const log = d.log ?? (() => {});
  const despues = d.despues ?? ((f, ms) => {
    const r = setTimeout(f, ms);
    r.unref?.();
    return { cancelar: () => clearTimeout(r) };
  });
  let reloj: { cancelar(): void } | null = null;
  let volviendo: Promise<Volvio> | null = null;

  /** Restaura `c`, anota que se volvió y reinicia. Nunca rechaza; una sola vez a la vez. */
  function volver(c: Copia, motivo: Motivo): Promise<Volvio> {
    if (!d.inst) return Promise.resolve({ ok: false, error: "esta instalación no guarda versiones anteriores" });
    const inst = d.inst;
    volviendo ??= (async (): Promise<Volvio> => {
      reloj?.cancelar();
      try {
        await restaurar(inst, c);
        d.almacen.cambiar((e) => alVolver(e, c, motivo));
        log(`volví a la ${c.version} (${motivo})`);
        await d.reiniciar(inst);
        return { ok: true };
      } catch (e) {
        log(`no pude volver a la ${c.version}: ${e instanceof Error ? e.message : String(e)}`);
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    })().finally(() => (volviendo = null));
    return volviendo;
  }

  /** Al arrancar el proceso: anota el arranque y, si esta versión a prueba ya falló, vuelve (true: este proceso se va). */
  async function alArrancarProceso(): Promise<boolean> {
    if (!d.inst) return false;
    const r = alArrancar(d.almacen.leer(), d.version, ahora());
    d.almacen.cambiar(() => r.estado);
    if (r.decision.accion === "volver") return (await volver(r.decision.a, r.decision.motivo)).ok;
    // Sin ventana lista a tiempo, vuelve (si hay a dónde).
    reloj = despues(() => {
      const t = alTiempoAgotado(d.almacen.leer());
      if (t.accion === "volver") void volver(t.a, t.motivo);
    }, d.topeMs ?? ARRANQUE_MAX_MS);
    return false;
  }

  /** La ventana cargó: la versión anda, y se guarda como respaldo de la próxima (así una actualización a mano también deja a dónde volver). */
  async function alVentanaListaProceso(): Promise<void> {
    if (!d.inst) return;
    reloj?.cancelar();
    d.almacen.cambiar(alVentanaLista);
    await guardarAntes();
  }

  /** Guarda la versión que corre como respaldo, si todavía no está (antes de instalar la siguiente). Nunca rechaza. */
  async function guardarAntes(): Promise<void> {
    if (!d.inst) return;
    try {
      const e = d.almacen.leer();
      if (d.inst.tipo === "appimage" && (await stat(d.inst.ruta)).mtimeMs > (d.inicio ?? Date.now() - process.uptime() * 1000) + 2000) return;
      if (e.respaldo?.version === d.version && (await copiaExiste(e.respaldo))) return;
      const c = await guardarCopia(d.inst, d.version, d.base, ahora());
      const s = d.almacen.cambiar((x) => conRespaldo(x, c));
      await podar(d.base, [s.respaldo, s.anterior]);
    } catch (e) {
      log(`no pude guardar la versión que corre: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    alArrancar: alArrancarProceso,
    alVentanaLista: alVentanaListaProceso,
    /** Salió a propósito (Cerrar del todo): un arranque sin terminar no cuenta como cierre solo. */
    alSalir: () => void (d.inst && d.almacen.cambiar(alSalirAProposito)),
    guardarAntes,
    /** La versión anterior que hay para volver (con su copia entera en disco), o null. */
    async disponible(): Promise<string | null> {
      const a = d.inst ? d.almacen.leer().anterior : null;
      return a && a.version !== d.version && (await copiaExiste(a)) ? a.version : null;
    },
    /** El botón: vuelve a la anterior guardada. */
    async volverManual(): Promise<Volvio> {
      const a = d.inst ? d.almacen.leer().anterior : null;
      if (!a) return { ok: false, error: "no hay una versión anterior guardada" };
      return volver(a, "manual");
    },
    /** Lo que la ventana cuenta al abrir tras volver; se gasta al leerlo. */
    leerAviso(): Aviso | null {
      const e = d.almacen.leer();
      if (!e.aviso) return null;
      d.almacen.cambiar(sinAviso);
      return e.aviso;
    },
    /** La versión desechada, para que el aviso de "hay una Trama nueva" no la ofrezca otra vez. */
    rechazada: (): string | null => d.almacen.leer().rechazada,
  };
}
export type VersionAnterior = ReturnType<typeof crearVersionAnterior>;
