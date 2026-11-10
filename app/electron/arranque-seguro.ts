// Actualizar seguro: la cuenta de si la versión que acaba de instalarse arranca bien, y cuándo hay que volver a la anterior.
// Sin Electron ni red (la carcasa de Windows tiene el mismo en windows/src/arranque-seguro.js: mismo archivo, mismas reglas).
//
// El estado vive en un JSON chico (`arranque.json`, junto al estado de la app) que leen y escriben tanto la ventana como el motor:
//   actual      la versión de la última corrida
//   arrancando  ms en que arrancó y todavía no llegó a "ventana lista" (null: ya llegó, o salió a propósito)
//   inicio      ms del último arranque, haya terminado o no (para el registro: cuánto vivió el proceso anterior)
//   fallas      arranques seguidos de `actual` que se cerraron solos sin llegar
//   buena       `actual` ya llegó alguna vez a ventana lista (una versión buena no se deshace por un cierre suelto)
//   respaldo    copia de la versión que corre (o corría cuando se instaló la siguiente): instalador, AppImage o carpeta
//   anterior    copia de la que había antes de `actual`: la que "Volver a la versión anterior" restaura
//   rechazada   la versión que se desechó: no se vuelve a instalar sola
//   aviso       lo que la ventana cuenta al abrir tras volver ({de, a, motivo}); se gasta al leerlo
// Reglas: una versión nueva no probada (`buena` falso) vuelve sola a `anterior` si no llega a ventana lista en `ARRANQUE_MAX_MS`
// ("lento") o si se cierra sola `FALLAS_MAX` veces seguidas ("cierres"). Sin copia de la anterior no hay a dónde volver.
// Un cierre desde afuera no es «se cerró sola»: una señal (SIGTERM de systemd, Ctrl+C) sale a propósito, y mientras se instala
// (`trama-actualizacion.json` en `instalando`, o recién terminado) un arranque sin terminar no suma falla.
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tomar } from "./cli/base/lock.ts";

/** Cuánto se espera a la ventana lista de una versión nueva antes de volver a la anterior. */
export const ARRANQUE_MAX_MS = Number(process.env.TRAMA_ARRANQUE_MAX_MS) > 0 ? Number(process.env.TRAMA_ARRANQUE_MAX_MS) : 60_000;
/** Cierres solos seguidos que bastan para desechar una versión nueva. */
export const FALLAS_MAX = 2;

export type Motivo = "lento" | "cierres" | "manual";
export type Copia = { version: string; tipo: "appimage" | "carpeta" | "instalador"; ruta: string; cuando: number };
export type Aviso = { de: string; a: string; motivo: Motivo };
export type Estado = {
  actual: string | null;
  arrancando: number | null;
  inicio: number | null;
  fallas: number;
  buena: boolean;
  respaldo: Copia | null;
  anterior: Copia | null;
  rechazada: string | null;
  aviso: Aviso | null;
};
/** Qué hacer tras mirar el arranque: seguir, o volver a esa copia por ese motivo. */
export type Decision = { accion: "seguir" } | { accion: "volver"; a: Copia; motivo: Motivo };

export const estadoVacio = (): Estado => ({ actual: null, arrancando: null, inicio: null, fallas: 0, buena: false, respaldo: null, anterior: null, rechazada: null, aviso: null });

const texto = (x: unknown): string | null => (typeof x === "string" && x ? x : null);
const copiaValida = (x: unknown): Copia | null => {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const version = texto(o.version);
  const ruta = texto(o.ruta);
  if (!version || !ruta || !path.isAbsolute(ruta) || ruta.includes("\0")) return null;
  if (o.tipo !== "appimage" && o.tipo !== "carpeta" && o.tipo !== "instalador") return null;
  return { version, tipo: o.tipo, ruta, cuando: typeof o.cuando === "number" ? o.cuando : 0 };
};
const avisoValido = (x: unknown): Aviso | null => {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const de = texto(o.de);
  const a = texto(o.a);
  return de && a && (o.motivo === "lento" || o.motivo === "cierres" || o.motivo === "manual") ? { de, a, motivo: o.motivo } : null;
};

/** Lo que dice un JSON leído del disco, con cada campo validado (un archivo roto o a medias es el estado vacío). */
export function estadoDesde(j: unknown): Estado {
  if (!j || typeof j !== "object") return estadoVacio();
  const o = j as Record<string, unknown>;
  return {
    actual: texto(o.actual),
    arrancando: typeof o.arrancando === "number" ? o.arrancando : null,
    inicio: typeof o.inicio === "number" ? o.inicio : null,
    fallas: typeof o.fallas === "number" && o.fallas > 0 ? Math.floor(o.fallas) : 0,
    buena: o.buena === true,
    respaldo: copiaValida(o.respaldo),
    anterior: copiaValida(o.anterior),
    rechazada: texto(o.rechazada),
    aviso: avisoValido(o.aviso),
  };
}

/**
 * Arranca `version`. Una versión distinta de la última es nueva: su `anterior` es el respaldo de la que corría (si lo hay) y empieza
 * a prueba. La misma que dejó un arranque sin terminar suma una falla, salvo que se esté instalando (`instalando`: al anterior lo
 * cerró el instalador, no se cerró solo). Si ya no está a prueba (o no hay a dónde volver) sigue.
 */
export function alArrancar(e: Estado, version: string, ahora: number, o: { instalando?: boolean } = {}): { estado: Estado; decision: Decision } {
  let s: Estado;
  if (e.actual !== version) {
    const anterior = e.respaldo && e.respaldo.version !== version && e.respaldo.version === e.actual ? e.respaldo : null;
    s = { ...e, actual: version, arrancando: ahora, inicio: ahora, fallas: 0, buena: false, anterior, respaldo: null };
  } else {
    s = { ...e, fallas: e.arrancando !== null && !o.instalando ? e.fallas + 1 : e.fallas, arrancando: ahora, inicio: ahora };
  }
  const a = s.anterior;
  const desechar = !s.buena && s.fallas >= FALLAS_MAX && a !== null && a.version !== version;
  return { estado: s, decision: desechar ? { accion: "volver", a: a!, motivo: "cierres" } : { accion: "seguir" } };
}

/** La ventana quedó lista: esta versión anda. */
export const alVentanaLista = (e: Estado): Estado => ({ ...e, arrancando: null, fallas: 0, buena: true });

/**
 * Salió a propósito (Cerrar del todo, una señal) antes de terminar de arrancar: no cuenta como cierre solo. Con `desde` (el arranque
 * de este proceso) sólo limpia si el arranque pendiente es el suyo: otro proceso que se va no le borra la cuenta al que arranca.
 */
export const alSalirAProposito = (e: Estado, desde?: number | null): Estado =>
  e.arrancando === null || (desde !== undefined && e.arrancando !== desde) ? e : { ...e, arrancando: null };

/**
 * ¿Se está instalando? Mira `trama-actualizacion.json` (lo escribe Actualizar, electron/actualizacion-trama.ts): en `instalando`, o
 * escrito hace menos de `ARRANQUE_MAX_MS` con otra fase que `esperando` (el instalador terminó y reinició todo). Puro: `j` es el
 * JSON leído y `mtimeMs` cuándo se escribió.
 */
export function instalandoSegun(j: unknown, mtimeMs: number | null, ahora: number): boolean {
  if (!j || typeof j !== "object") return false;
  const fase = (j as Record<string, unknown>).fase;
  if (fase === "instalando") return true;
  return fase !== "esperando" && mtimeMs !== null && ahora - mtimeMs >= 0 && ahora - mtimeMs < ARRANQUE_MAX_MS;
}
/** `instalandoSegun` con el archivo del disco (si no está o está roto: no se instala). */
export function instalandoAhora(archivo: string, ahora: number): boolean {
  try {
    return instalandoSegun(JSON.parse(readFileSync(archivo, "utf8")), statSync(archivo).mtimeMs, ahora);
  } catch {
    return false;
  }
}

/** Una línea para el registro: la versión, la cuenta y cuánto hace que arrancó el último proceso. */
export function resumen(e: Estado, ahora: number): string {
  const hace = e.inicio === null ? "sin arranque anotado" : `arrancó hace ${Math.max(0, Math.round((ahora - e.inicio) / 1000))} s${e.arrancando !== null ? " sin llegar a ventana lista" : ""}`;
  return `${e.actual ?? "sin versión"}, fallas ${e.fallas}, buena ${e.buena ? "sí" : "no"}, ${hace}`;
}

/** Pasó `ARRANQUE_MAX_MS` sin ventana lista: una versión a prueba con anterior guardada vuelve a ella. */
export function alTiempoAgotado(e: Estado): Decision {
  const a = e.anterior;
  return e.arrancando !== null && !e.buena && a !== null && a.version !== e.actual ? { accion: "volver", a, motivo: "lento" } : { accion: "seguir" };
}

/** Se volvió a `a`: corre esa, ya probada; la desechada no se reinstala sola y la ventana lo cuenta al abrir. */
export function alVolver(e: Estado, a: Copia, motivo: Motivo): Estado {
  const de = e.actual ?? "";
  return { ...e, actual: a.version, arrancando: null, fallas: 0, buena: true, respaldo: null, anterior: null, rechazada: de && de !== a.version ? de : e.rechazada, aviso: de ? { de, a: a.version, motivo } : null };
}

/** Se guardó una copia de la versión que corre (antes de instalar la siguiente, o ya andando): queda de respaldo. */
export const conRespaldo = (e: Estado, r: Copia): Estado => ({ ...e, respaldo: r });

export const sinAviso = (e: Estado): Estado => (e.aviso ? { ...e, aviso: null } : e);

/**
 * El archivo de estado; nunca tira al leer. Lo escriben la ventana y el motor (Actualizar), así que `cambiar` lee y escribe con el
 * candado de `<archivo>.candado` (electron/cli/base/lock.ts; si no se consigue a tiempo, escribe igual: el estado es de ayuda).
 * `cambiarYa` es síncrono y sin candado: sólo para salir desde una señal, donde no hay tiempo de esperar a nadie.
 */
export function crearAlmacen(archivo: string, o: { esperarMs?: number } = {}) {
  const leer = (): Estado => {
    try {
      return estadoDesde(JSON.parse(readFileSync(archivo, "utf8")));
    } catch {
      return estadoVacio();
    }
  };
  const escribir = (e: Estado) => {
    mkdirSync(path.dirname(archivo), { recursive: true });
    const tmp = `${archivo}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, ...e }));
    renameSync(tmp, archivo);
  };
  /** Lee, aplica el cambio y escribe; devuelve lo que quedó. Si no se puede escribir, devuelve el cambio igual (el estado es de ayuda, no frena nada). */
  const cambiarYa = (f: (e: Estado) => Estado): Estado => {
    const n = f(leer());
    try {
      escribir(n);
    } catch {}
    return n;
  };
  /** Lo mismo con el candado: nadie más lee entre medio y pisa lo que se escribió. */
  const cambiar = async (f: (e: Estado) => Estado): Promise<Estado> => {
    const candado = await tomar(`${archivo}.candado`, { esperarMs: o.esperarMs ?? 3000 }).catch(() => null);
    try {
      return cambiarYa(f);
    } finally {
      await candado?.liberar();
    }
  };
  return { leer, cambiar, cambiarYa };
}
export type Almacen = ReturnType<typeof crearAlmacen>;
