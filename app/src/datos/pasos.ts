// Los pasos de un worker (la vista de worker): lo que manda el main (electron/pasos-worker.ts), con
// forma, y cómo se pone al día una vista con un lote de cambios. Puro: lo prueba `tests/pasos-vista.test.ts`.
// Los pasos mismos los arma el main de su propio transcript; acá sólo se comprueba el borde (que sea
// una vista, que traiga lista) y lo que no lo es queda vacío: la vista dice "sin dato".
import type { CambioPasos, Encabezado, Paso, VistaPasos } from "../../electron/pasos";

export type { ArchivoTocado, Cambio, CambioPasos, Cortado, Detalle, Encabezado, EstadoPaso, Paso, TipoPaso, VistaPasos } from "../../electron/pasos";

const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);
const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null);
const pasosDe = (x: unknown): Paso[] => (Array.isArray(x) ? x.filter((p): p is Paso => !!obj(p) && typeof (p as Paso).id === "string" && typeof (p as Paso).tipo === "string" && !!obj((p as Paso).detalle)) : []);
const encabezadoDe = (x: unknown): Encabezado | null => {
  const e = obj(x);
  return e && obj(e.tokens) && Array.isArray(e.archivos) ? (e as unknown as Encabezado) : null;
};

/** Lo que contestó `pasos:mirar`. Sin forma: una vista vacía (`hay: false`). */
export function vistaDe(x: unknown): VistaPasos | null {
  const v = obj(x);
  const e = encabezadoDe(v?.encabezado);
  if (!v || typeof v.id !== "string") return null;
  if (!e || v.hay !== true) return { id: v.id, hay: false, gen: num(v.gen), v: num(v.v), omitidos: 0, encabezado: e ?? vacio(), pasos: [] };
  return { id: v.id, hay: true, gen: num(v.gen), v: num(v.v), omitidos: num(v.omitidos), encabezado: e, pasos: pasosDe(v.pasos) };
}

/** Un lote de `pasos:cambio`. Sin forma: `null` (se ignora). */
export function cambioDe(x: unknown): CambioPasos | null {
  const c = obj(x);
  const e = encabezadoDe(c?.encabezado);
  if (!c || typeof c.id !== "string" || !e) return null;
  return { id: c.id, gen: num(c.gen), desde: num(c.desde), v: num(c.v), omitidos: num(c.omitidos), total: num(c.total), encabezado: e, cambios: pasosDe(c.cambios) };
}

export type Aplicado = { vista: VistaPasos } | { pedirDeNuevo: true };

/**
 * Pone al día `vista` con un lote. Si es de otro worker no es para esta vista; si cambió `gen` (el transcript se armó de nuevo) o
 * se perdió un lote (`vista.v < desde`) no se puede: hay que pedir la vista entera. Aplicar dos veces el mismo lote da lo mismo.
 */
export function aplicar(vista: VistaPasos, c: CambioPasos): Aplicado | null {
  if (c.id !== vista.id) return null;
  if (c.gen !== vista.gen || vista.v < c.desde) return { pedirDeNuevo: true };
  if (c.v <= vista.v) return { vista };
  const pasos = [...vista.pasos];
  const donde = new Map(pasos.map((p, i) => [p.n, i]));
  for (const p of c.cambios) {
    const i = donde.get(p.n);
    if (i === undefined) {
      donde.set(p.n, pasos.length);
      pasos.push(p);
    } else pasos[i] = p;
  }
  pasos.sort((a, b) => a.n - b.n);
  // El main descartó los más viejos: acá también.
  const sobran = pasos.length - Math.max(0, c.total - c.omitidos);
  return { vista: { ...vista, v: c.v, omitidos: c.omitidos, encabezado: c.encabezado, hay: true, pasos: sobran > 0 ? pasos.slice(sobran) : pasos } };
}

function vacio(): Encabezado {
  return {
    tarea: null, modelo: null, effort: null, turnos: 0, tokens: { entrada: 0, cacheCreado: 0, cacheLeido: 0, salida: 0 }, total: 0, cache: null,
    inicio: null, fin: null, dur: null, compactaciones: 0, pasos: 0, archivos: [], mas: 0, menos: 0,
  };
}
