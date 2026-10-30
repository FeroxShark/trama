// Actualizar seguro: la cuenta de si la versión que acaba de instalarse arranca bien, y cuándo hay que volver a la anterior.
// Sin Electron ni red (la carcasa de Windows tiene el mismo en windows/src/arranque-seguro.js: mismo archivo, mismas reglas).
//
// El estado vive en un JSON chico (`arranque.json`, junto al estado de la app) que leen y escriben tanto la ventana como el motor:
//   actual      la versión de la última corrida
//   arrancando  ms en que arrancó y todavía no llegó a "ventana lista" (null: ya llegó, o salió a propósito)
//   fallas      arranques seguidos de `actual` que se cerraron solos sin llegar
//   buena       `actual` ya llegó alguna vez a ventana lista (una versión buena no se deshace por un cierre suelto)
//   respaldo    copia de la versión que corre (o corría cuando se instaló la siguiente): instalador, AppImage o carpeta
//   anterior    copia de la que había antes de `actual`: la que "Volver a la versión anterior" restaura
//   rechazada   la versión que se desechó: no se vuelve a instalar sola
//   aviso       lo que la ventana cuenta al abrir tras volver ({de, a, motivo}); se gasta al leerlo
// Reglas: una versión nueva no probada (`buena` falso) vuelve sola a `anterior` si no llega a ventana lista en `ARRANQUE_MAX_MS`
// ("lento") o si se cierra sola `FALLAS_MAX` veces seguidas ("cierres"). Sin copia de la anterior no hay a dónde volver.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

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
  fallas: number;
  buena: boolean;
  respaldo: Copia | null;
  anterior: Copia | null;
  rechazada: string | null;
  aviso: Aviso | null;
};
/** Qué hacer tras mirar el arranque: seguir, o volver a esa copia por ese motivo. */
export type Decision = { accion: "seguir" } | { accion: "volver"; a: Copia; motivo: Motivo };

export const estadoVacio = (): Estado => ({ actual: null, arrancando: null, fallas: 0, buena: false, respaldo: null, anterior: null, rechazada: null, aviso: null });

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
 * a prueba. La misma que dejó un arranque sin terminar suma una falla. Si ya no está a prueba (o no hay a dónde volver) sigue.
 */
export function alArrancar(e: Estado, version: string, ahora: number): { estado: Estado; decision: Decision } {
  let s: Estado;
  if (e.actual !== version) {
    const anterior = e.respaldo && e.respaldo.version !== version && e.respaldo.version === e.actual ? e.respaldo : null;
    s = { ...e, actual: version, arrancando: ahora, fallas: 0, buena: false, anterior, respaldo: null };
  } else {
    s = { ...e, fallas: e.arrancando !== null ? e.fallas + 1 : e.fallas, arrancando: ahora };
  }
  const a = s.anterior;
  const desechar = !s.buena && s.fallas >= FALLAS_MAX && a !== null && a.version !== version;
  return { estado: s, decision: desechar ? { accion: "volver", a: a!, motivo: "cierres" } : { accion: "seguir" } };
}

/** La ventana quedó lista: esta versión anda. */
export const alVentanaLista = (e: Estado): Estado => ({ ...e, arrancando: null, fallas: 0, buena: true });

/** Salió a propósito (Cerrar del todo) antes de terminar de arrancar: no cuenta como cierre solo. */
export const alSalirAProposito = (e: Estado): Estado => (e.arrancando === null ? e : { ...e, arrancando: null });

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

/** El archivo de estado: lectura y escritura síncronas (es chico y se toca pocas veces); nunca tira al leer. */
export function crearAlmacen(archivo: string) {
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
  const cambiar = (f: (e: Estado) => Estado): Estado => {
    const n = f(leer());
    try {
      escribir(n);
    } catch {}
    return n;
  };
  return { leer, cambiar };
}
export type Almacen = ReturnType<typeof crearAlmacen>;
