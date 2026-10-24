// De dónde sale el tablero: del main (`vista.json` y el CLI `tablero`, electron/tablero.ts) o, en
// bench y capturas, del tablero inventado. Guarda la última lectura buena: al volver a abrir la
// pestaña se pinta al toque y se refresca atrás.
import { MODO } from "../modo";
import { t } from "../i18n";
import { main, mensaje } from "../puente";
import { tableroFijo } from "./fixtures-tablero";
import { ErrorTablero, validar, type Abierta, type ItemId, type Tablero } from "./tablero";
import type { RespuestaCli } from "../../electron/tablero";

export interface FuenteTablero {
  leer(): Promise<Tablero>;
  /** La última lectura buena, si hubo alguna. */
  guardado(): Tablero | null;
  /** El CLI reescribió la vista (alguien cargó, movió o cerró algo). */
  alCambiar(fn: () => void): () => void;
  /** `tablero mover <id> --columna <columna>`. Todas rechazan con lo que dijo el CLI. */
  mover(id: ItemId, columna: Abierta): Promise<void>;
  /** `tablero cerrar <id>`. */
  cerrar(id: ItemId): Promise<void>;
  /** `tablero tirar <id>`. */
  tirar(id: ItemId): Promise<void>;
  /** `tablero mover <id> --hasta <fecha>` (`mañana`, `+3d`, `+1s`, `AAAA-MM-DD`). */
  posponer(id: ItemId, hasta: string): Promise<void>;
  /** `tablero agregar "<texto>" [--proyecto P]`: a bandeja. */
  agregar(texto: string, proyecto: string | null, maquina?: string): Promise<void>;
  /** `tablero responder <id> …`: guarda la respuesta en el item (no lo cierra ni lo mueve); `null` la borra. */
  responder(id: ItemId, r: RespuestaCli): Promise<void>;
  /** Cuántos items esperan al usuario sin respuesta (para el número del pie): barato, sin traer el tablero entero. */
  esperan(): Promise<number | null>;
}

let ultimo: Tablero | null = null;

const esperanDe = (t: Tablero) => t.columnas["espera-dueno"].filter((i) => !i.respuesta).length;

const mirado = (crudo: unknown): Tablero => {
  try {
    return (ultimo = validar(crudo));
  } catch (e) {
    throw e instanceof ErrorTablero ? new Error(t("tablero.errorForma")) : e;
  }
};

/** Lo que rechaza el main, con su mensaje pelado (y traducido si es una clave). */
const limpio = <T>(p: Promise<T>): Promise<T> =>
  p.catch((e) => {
    throw new Error(mensaje(e));
  });

const conMain = (m: NonNullable<typeof main>): FuenteTablero => ({
  leer: () => limpio(m.tablero.leer()).then(mirado),
  guardado: () => ultimo,
  alCambiar: (fn) => m.tablero.alCambiar(fn),
  mover: (id, columna) => limpio(m.tablero.mover(id, columna)),
  cerrar: (id) => limpio(m.tablero.cerrar(id)),
  tirar: (id) => limpio(m.tablero.tirar(id)),
  posponer: (id, hasta) => limpio(m.tablero.posponer(id, hasta)),
  agregar: (texto, proyecto, maquina) => limpio(m.tablero.agregar(texto, proyecto, maquina)).then(() => {}),
  responder: (id, r) => limpio(m.tablero.responder(id, r)).then(() => {}),
  esperan: () => limpio(m.tablero.esperan()).then((n) => (typeof n === "number" ? n : null)),
});

/** El inventado: se lee siempre igual y las acciones no hacen nada (o fallan, con `HILOS_FALLA=tablero`). */
const fija: FuenteTablero = (() => {
  const ahora = Date.now();
  // Con los pendientes de muestra sólo en las capturas del tablero nuevo: el resto no cambia (ni el número del pie).
  const conPendientes = !!MODO.captura?.startsWith("tablero-nuevo");
  // Con items de otra máquina y una caída sólo en `tablero-maquinas`.
  const conMaquinas = MODO.captura === "tablero-maquinas";
  const accion = async () => {
    if (MODO.falla === "tablero") throw new Error("tablero: no pude escribir items.jsonl");
  };
  // Sin tablero todavía (`tablero-vacio`): la vista no existe, como en una instalación nueva.
  const sinVista = MODO.captura === "tablero-vacio";
  return {
    leer: async () => mirado(sinVista ? { version: 1, vista: null, hecho: [], proyectos: [], pospuestosLista: [], aviso: null } : tableroFijo(ahora, conPendientes, conMaquinas)),
    guardado: () => ultimo,
    alCambiar: () => () => {},
    mover: accion,
    cerrar: accion,
    tirar: accion,
    posponer: accion,
    agregar: accion,
    responder: accion,
    esperan: async () => (conPendientes ? esperanDe(mirado(tableroFijo(ahora, true))) : 0),
  };
})();

export const fuenteTablero: FuenteTablero = MODO.fixtures || !main ? fija : conMain(main);
