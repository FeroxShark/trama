// "Recientes": el orden por lo último que se usó. Un proyecto vale por lo más reciente de cualquiera de sus conversaciones
// (los líderes de la barra, sus workers y las "De Claude Code"); un líder, por su última actividad o la de sus workers.
// Es una "foto" (`Recientes`) que quien arma la barra congela mientras el usuario la mira (`useRecientes.ts`): la
// actividad cambia con cada mensaje y, sin congelarla, la lista se reacomodaría bajo el mouse. Puro: lo prueba `tests/recientes.test.ts`.
import type { ConvClaudeCode, Hilo, Lider } from "../datos/contrato.ts";
import { carpetaDe } from "./claude-code.ts";

/** La última actividad (epoch s) de cada líder y de cada proyecto, en el momento de la foto. */
export type Recientes = { lideres: ReadonlyMap<string, number>; carpetas: ReadonlyMap<string, number> };

/** Cuándo se movió por última vez un worker: cuándo terminó, o desde cuándo corre. */
const deWorker = (h: Pick<Hilo, "inicio" | "duracion_s" | "murio_en">) => h.murio_en ?? h.inicio + (h.duracion_s ?? 0);

/** La foto de la actividad: líderes y workers por su proyecto, y las conversaciones de Claude Code por la carpeta que les toca. */
export function fotoRecientes(lideres: readonly Pick<Lider, "id" | "actividad">[], hilos: readonly Hilo[], convs: readonly ConvClaudeCode[]): Recientes {
  const porLider = new Map<string, number>();
  for (const l of lideres) porLider.set(l.id, l.actividad);
  const porCarpeta = new Map<string, number>();
  const sube = (m: Map<string, number>, k: string, v: number) => {
    if (v > (m.get(k) ?? -Infinity)) m.set(k, v);
  };
  for (const h of hilos) {
    const v = deWorker(h);
    if (h.jefe_id) sube(porLider, h.jefe_id, v);
    sube(porCarpeta, h.proyecto, v);
  }
  for (const c of convs) sube(porCarpeta, carpetaDe(c), c.ms / 1000);
  return { lideres: porLider, carpetas: porCarpeta };
}

const igualMapa = (a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>) => {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
};

export function igualRecientes(a: Recientes | undefined, b: Recientes | undefined): boolean {
  return a === b || (!!a && !!b && igualMapa(a.lideres, b.lideres) && igualMapa(a.carpetas, b.carpetas));
}
