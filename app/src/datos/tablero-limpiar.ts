// «Limpiar» del Tablero: qué items entran en el diálogo (LimpiarTablero.tsx), cuáles se sugieren y cómo se cierran en lote.
// Puro (sin React ni DOM): lo prueba tests/tablero-limpiar.test.ts. Nada se borra: se cierra a `tirado` (`tablero tirar`) y
// «Deshacer» reabre lo de esa tanda (`tablero mover --columna=<la de antes>`). El CLI sólo trae `tirar` en lote; reabrir va de a uno,
// así que los dos se corren por item, de a pocos a la vez, para que la interfaz siga viva y el progreso se vea.
import type { Abierta, Item, ItemId, Tablero } from "./tablero.ts";
import { ABIERTAS } from "./tablero.ts";

/** Lo que el usuario distingue en el tablero: una prueba, una pregunta o una idea (la columna `ideas`). */
export type TipoLimpiar = "prueba" | "pregunta" | "idea";
export const TIPOS_LIMPIAR: readonly TipoLimpiar[] = ["prueba", "pregunta", "idea"];

/** Por qué se sugiere cerrar un item: su proyecto se retiró, su rama ya se integró, o es la prueba de una versión vieja de Trama. */
export type Motivo = "retirado" | "integrada" | "vieja";
export const MOTIVOS: readonly Motivo[] = ["retirado", "integrada", "vieja"];

/** Los plazos de «sin tocar hace más de», en días; 0 = cualquiera. */
export const DIAS_TABLERO = [0, 7, 30, 90] as const;

const DIA_MS = 86_400_000;

export const tipoDe = (i: Pick<Item, "columna" | "tipo">): TipoLimpiar => (i.columna === "ideas" ? "idea" : i.tipo);

/** Cuántos días hace que nadie toca el item (`tocado`, o `creado` si falta). */
export function diasSinTocar(i: Pick<Item, "tocado" | "creado">, ahora: number): number {
  const t = Date.parse(i.tocado) || Date.parse(i.creado);
  return Number.isFinite(t) ? Math.max(0, Math.floor((ahora - t) / DIA_MS)) : 0;
}

// --- Versiones -----------------------------------------------------------------------

export type Version = readonly [number, number, number];

/** `0.2.53` → `[0, 2, 53]`; `null` si no es una versión. */
export function leerVersion(s: string): Version | null {
  const m = /^v?(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i.exec(s.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

const cmp = (a: Version, b: Version) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * Las versiones que nombra un texto (`v0.2.40`, `0.2.40`). No cuentan los números de más de tres partes (una IP, `1.2.3.4`) ni los
 * pegados a una letra o un guion (`node22.1.0`, `1.2.3-rc`): mejor perder una versión que cerrar una prueba que sigue valiendo.
 */
export function versionesEn(texto: string): Version[] {
  const r: Version[] = [];
  for (const m of texto.matchAll(/(?<![\w.-])v?(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\w-]|\.\d)/gi)) r.push([Number(m[1]), Number(m[2]), Number(m[3])]);
  return r;
}

/**
 * ¿Es la prueba de una versión vieja de Trama? Una prueba que nombra versiones de la misma serie (mismo primer número) y la más nueva
 * que nombra es anterior a la actual. Sin versión en el texto, no se sugiere.
 */
export function esPruebaVieja(i: Pick<Item, "columna" | "tipo" | "titulo" | "prueba" | "detalle">, actual: Version): boolean {
  if (tipoDe(i) !== "prueba") return false;
  const vs = versionesEn(`${i.titulo}\n${i.prueba}\n${i.detalle}`).filter((v) => v[0] === actual[0]);
  if (!vs.length) return false;
  return cmp(vs.reduce((a, b) => (cmp(a, b) >= 0 ? a : b)), actual) < 0;
}

/** El id de la corrida de `pa` que nombra una clave `pa:<id>…`; `null` si no es de `pa`. */
export function corridaDe(clave: string): string | null {
  const m = /^pa:(\d{8}-\d{6}-\d+)/.exec(clave);
  return m ? m[1] : null;
}

// --- Qué se sugiere --------------------------------------------------------------------

/** Lo que hace falta saber de afuera del tablero para sugerir. */
export type Contexto = {
  /** Los proyectos con `etapa: retirado` del registry. */
  retirados: ReadonlySet<string>;
  /** Las corridas de `pa` ya integradas (`estado: integrado`). */
  integradas: ReadonlySet<string>;
  /** La versión de esta Trama. */
  version: Version;
};

export function motivosDe(i: Item, c: Contexto): Motivo[] {
  const r: Motivo[] = [];
  if (i.proyecto && c.retirados.has(i.proyecto)) r.push("retirado");
  const corrida = corridaDe(i.clave);
  if (corrida && c.integradas.has(corrida)) r.push("integrada");
  if (esPruebaVieja(i, c.version)) r.push("vieja");
  return r;
}

export type Filtros = {
  /** Sin tocar hace más de tantos días (0: cualquiera). */
  dias: number;
  /** Sólo de este proyecto (`null`: todos). */
  proyecto: string | null;
  /** Qué tipos entran. */
  tipos: ReadonlySet<TipoLimpiar>;
  /** Sólo lo que tiene algún motivo para cerrarse. */
  soloSugeridos: boolean;
};

export type CandidatoTablero = {
  item: Item;
  tipo: TipoLimpiar;
  motivos: Motivo[];
  dias: number;
};

/** Todo lo abierto a la vista (las columnas; no lo hecho ni lo pospuesto), con su tipo, sus motivos y su edad. */
export function abiertosConMotivos(t: Tablero, c: Contexto, ahora: number): CandidatoTablero[] {
  const r: CandidatoTablero[] = [];
  for (const k of ABIERTAS) for (const item of t.columnas[k]) r.push({ item, tipo: tipoDe(item), motivos: motivosDe(item, c), dias: diasSinTocar(item, ahora) });
  return r;
}

/** Los que pasan los filtros: lo sugerido primero, y dentro de cada grupo lo más viejo primero. */
export function candidatosTablero(todos: readonly CandidatoTablero[], f: Filtros): CandidatoTablero[] {
  return todos
    .filter((c) => f.tipos.has(c.tipo) && (f.proyecto === null || c.item.proyecto === f.proyecto) && c.dias >= f.dias && (!f.soloSugeridos || c.motivos.length > 0))
    .sort((a, b) => Number(b.motivos.length > 0) - Number(a.motivos.length > 0) || b.dias - a.dias || Number(a.item.id) - Number(b.item.id) || String(a.item.id).localeCompare(String(b.item.id)));
}

/**
 * ¿Viene marcado? Lo sugerido sí, y lo que el usuario pidió con un plazo también; lo demás (todo lo abierto de un proyecto, sin motivo
 * ni plazo) no: cerrar cientos de un clic tiene que ser una decisión, no el punto de partida.
 */
export const marcadoDeEntrada = (c: CandidatoTablero, f: Pick<Filtros, "dias">): boolean => c.motivos.length > 0 || f.dias > 0;

/** Los que se cierran: `marcas` es lo que el usuario cambió a mano (id → marcado); lo que no tocó queda como `marcadoDeEntrada`. */
export function aCerrar(lista: readonly CandidatoTablero[], f: Pick<Filtros, "dias">, marcas: ReadonlyMap<ItemId, boolean>): CandidatoTablero[] {
  return lista.filter((c) => marcas.get(c.item.id) ?? marcadoDeEntrada(c, f));
}

/** Cuántos hay por motivo en una lista (para el resumen: un item con dos motivos cuenta en los dos). */
export function contarMotivos(lista: readonly CandidatoTablero[]): Record<Motivo, number> {
  const r: Record<Motivo, number> = { retirado: 0, integrada: 0, vieja: 0 };
  for (const c of lista) for (const m of c.motivos) r[m]++;
  return r;
}

// --- La tanda, para deshacer -------------------------------------------------------------

/** Lo cerrado en una limpieza: cada item con la columna de la que salió, para reabrirlo ahí. */
export type Tanda = { fecha: number; items: { id: ItemId; columna: Abierta }[] };

export const columnaAbierta = (c: string): Abierta => ((ABIERTAS as readonly string[]).includes(c) ? (c as Abierta) : "bandeja");

export const tandaDe = (lista: readonly CandidatoTablero[], fecha: number): Tanda => ({
  fecha,
  items: lista.map((c) => ({ id: c.item.id, columna: columnaAbierta(c.item.columna) })),
});

/** Una tanda guardada, mirada (viene de `localStorage`: puede estar rota). `null` si no sirve o está vacía. */
export function tandaGuardada(crudo: string | null): Tanda | null {
  if (!crudo) return null;
  try {
    const j = JSON.parse(crudo) as { fecha?: unknown; items?: unknown };
    if (typeof j.fecha !== "number" || !Array.isArray(j.items)) return null;
    const items = j.items.flatMap((x: { id?: unknown; columna?: unknown }) =>
      x && (Number.isInteger(x.id) || typeof x.id === "string") && typeof x.columna === "string" ? [{ id: x.id as ItemId, columna: columnaAbierta(x.columna) }] : [],
    );
    return items.length ? { fecha: j.fecha, items } : null;
  } catch {
    return null;
  }
}

// --- Correr en lote ---------------------------------------------------------------------

export type ResultadoLote<T> = { hechos: T[]; fallos: { x: T; error: string }[]; cortado: boolean };

/** Cuántas fallas seguidas se aguantan antes de parar (un CLI roto no merece 900 errores). */
const FALLAS_SEGUIDAS = 5;

/**
 * Corre `accion` por cada elemento, de a `concurrencia` a la vez (el CLI toma un candado por escritura: más no acelera). Avisa cada
 * vez que termina uno. `parar()` deja de lanzar nuevos (los que ya van, terminan); varias fallas seguidas también paran.
 */
export async function correrEnLote<T>(
  lista: readonly T[],
  accion: (x: T) => Promise<void>,
  o: { concurrencia?: number; alAvanzar?: (listos: number, total: number) => void; parar?: () => boolean } = {},
): Promise<ResultadoLote<T>> {
  const hechos: T[] = [];
  const fallos: { x: T; error: string }[] = [];
  let siguiente = 0;
  let seguidas = 0;
  let listos = 0;
  let cortado = false;
  const obrero = async () => {
    while (siguiente < lista.length) {
      if (o.parar?.() || seguidas >= FALLAS_SEGUIDAS) {
        cortado = true;
        return;
      }
      const x = lista[siguiente++];
      try {
        await accion(x);
        hechos.push(x);
        seguidas = 0;
      } catch (e) {
        fallos.push({ x, error: e instanceof Error ? e.message : String(e) });
        seguidas++;
      }
      o.alAvanzar?.(++listos, lista.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrencia ?? 4, lista.length)) }, obrero));
  return { hechos, fallos, cortado };
}
