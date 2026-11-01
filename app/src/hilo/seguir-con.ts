// «Seguir con otro modelo» (#1791, parte 3), la lógica sin React (la prueba tests/seguir-con.test.ts): cuándo se ofrece, y cómo se ordena y
// se marca la lista de modelos del selector que se abre (los sin cupo, con su hora; el modelo que se cortó, aparte). Lo dibuja
// `SeguirCon.tsx`; lo que se hace al elegir lo hace el main (`lider:seguirCon` o `workers:seguirCon`, con el resumen de traspaso).
import type { Estado } from "../datos/contrato.ts";
import type { AvisoVisto } from "./avisos.ts";
import type { EstadoCupo } from "./cupo-modelos.ts";
import { esAvisoSinCupoOpencode } from "./agotados.ts";
import { filtrarLista } from "./selector-lista.ts";

/** Lo mínimo de una opción del selector que hace falta acá (el `Opcion` de Selector.tsx lo cumple). */
export type OpcionSeguir = { id: string; nombre: string; desc: string; grupo?: string; col?: string; colNombre?: string; deshabilitada?: boolean };

/** Un worker se puede seguir con otro modelo cuando su proceso ya terminó y dejó su puesto y su rama: terminó, pide una decisión o murió. */
export const seguibleWorker = (estado: Estado): boolean => estado === "listo" || estado === "decision" || estado === "murio";

/** Un líder se puede seguir con otro modelo cuando no está respondiendo: lo hablado hasta ahora ya está entero en su transcript. */
export const seguibleLider = (l: { ocupado: boolean }): boolean => !l.ocupado;

/**
 * Los avisos de un turno que cortan por falta de cupo: el límite de uso rechazado (5 h, semana), el error 429 y el «se acabó el uso gratis
 * de OpenCode». Ahí «Seguir con otro modelo» es la salida natural; el resto de los avisos (reintento, compactó…) no lo ofrecen.
 */
export const ofreceSeguir = (a: AvisoVisto): boolean =>
  (a.clase === "limite" && a.rechazado) || (a.clase === "error" && (a.codigo === "rate_limit" || esAvisoSinCupoOpencode(a.texto)));

export type FilaSeguir<T extends OpcionSeguir = OpcionSeguir> = {
  opcion: T;
  /** El cupo del modelo (null: no se mide). */
  cupo: EstadoCupo | null;
  /** Es el modelo con el que venía (el que se cortó): se ve, pero no se elige. */
  actual: boolean;
};
export type GrupoSeguir<T extends OpcionSeguir = OpcionSeguir> = { clave: string; nombre: string; filas: FilaSeguir<T>[] };

/** El proveedor de una opción (la clave de su columna, o su grupo): lo que separa la lista en secciones. */
const claveDe = (o: OpcionSeguir) => o.col ?? o.grupo ?? "";
const nombreDe = (o: OpcionSeguir) => o.colNombre ?? o.grupo ?? "";

/**
 * La lista del selector: sólo lo que coincide con la búsqueda y se puede elegir, en secciones por proveedor (en el orden en que aparecen),
 * y dentro de cada una lo que tiene cupo primero y lo que no, al final (sin cambiar el orden de cada mitad). Las secciones donde sólo
 * queda lo sin cupo van después de las que tienen algo disponible: lo primero que se ve es lo que se puede usar ya.
 */
export function listaSeguir<T extends OpcionSeguir>(opciones: readonly T[], cupos: ReadonlyMap<string, EstadoCupo>, actual: string | null, busqueda: string): GrupoSeguir<T>[] {
  const visibles = filtrarLista(
    opciones.filter((o) => !o.deshabilitada),
    busqueda,
  );
  const porClave = new Map<string, GrupoSeguir<T>>();
  for (const o of visibles) {
    const clave = claveDe(o);
    let g = porClave.get(clave);
    if (!g) porClave.set(clave, (g = { clave, nombre: nombreDe(o), filas: [] }));
    g.filas.push({ opcion: o, cupo: cupos.get(o.id) ?? null, actual: o.id === actual });
  }
  const grupos = [...porClave.values()];
  for (const g of grupos) {
    const con = g.filas.filter((f) => !f.cupo?.sin);
    g.filas = [...con, ...g.filas.filter((f) => f.cupo?.sin)];
  }
  const disponible = (g: GrupoSeguir<T>) => g.filas.some((f) => !f.actual && !f.cupo?.sin);
  return [...grupos.filter(disponible), ...grupos.filter((g) => !disponible(g))];
}

/** Las filas de la lista, de arriba abajo y sin las secciones: el orden en que las recorren las flechas. */
export const filasSeguir = <T extends OpcionSeguir>(grupos: readonly GrupoSeguir<T>[]): FilaSeguir<T>[] => grupos.flatMap((g) => g.filas);

/** Qué fila queda resaltada al abrir: la primera que se puede elegir y tiene cupo; si no hay, la primera que se puede elegir; si no, ninguna (-1). */
export function resaltadaInicial(filas: readonly FilaSeguir[]): number {
  const libre = filas.findIndex((f) => !f.actual && !f.cupo?.sin);
  return libre >= 0 ? libre : filas.findIndex((f) => !f.actual);
}

/** A dónde va la resaltada con una flecha, saltando el modelo actual (no se elige). Sin otra fila elegible, queda donde estaba. */
export function moverSeguir(filas: readonly FilaSeguir[], i: number, tecla: "ArrowDown" | "ArrowUp"): number {
  const paso = tecla === "ArrowDown" ? 1 : -1;
  for (let k = i + paso; k >= 0 && k < filas.length; k += paso) if (!filas[k].actual) return k;
  return i;
}
