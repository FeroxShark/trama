// Ajustes > Modelos > «Modelos para workers»: qué esfuerzos de qué modelos «no convienen». Un par modelo+esfuerzo está dominado si
// otro par permitido (de cualquier proveedor) rinde igual o más inteligencia por igual o menos costo. Puro: lo prueba tests/efforts-dominados.test.ts.
//
// Costo de un par, en este orden:
//  1. el costo por tarea de Artificial Analysis cuando el dato lo trae (`FilaTabla.costoPorEffort`, USD);
//  2. si no, COSTO_FAMILIA (el costo relativo de un token que usa `reparto`, COSTO en motor/bin/reparto) × MULT_EFFORT (cuánto más piensa
//     un esfuerzo alto: low 0,5, medium 0,75, high 1, xhigh 1,5, max 2,5). Es un proxy: sólo sirve para ordenar pares entre sí.
// En los modelos de suscripción (Claude, Google, ChatGPT) no se paga por token: el costo es el equivalente en API y se usa como proxy
// del cupo que se gasta. Los gratis y locales no entran (no hay nada que ahorrar con ellos).
import { EFFORTS_CALIDAD, type EffortCalidad } from "../../electron/efforts-calidad";
import type { FilaTabla } from "../../electron/reparto-tabla";
import type { Borrador } from "./modelos-borrador";
import { claveCalidad, effortsMostrados, estadoDe } from "./modelos-workers";

export const MULT_EFFORT: Record<EffortCalidad, number> = { low: 0.5, medium: 0.75, high: 1, xhigh: 1.5, max: 2.5 };
/** Igual que COSTO de motor/bin/reparto; lo que no está (DeepSeek de pago, otros) usa `COSTO_DEFECTO`. */
export const COSTO_FAMILIA: Record<string, number> = { opus: 1, argon: 0.6, sonnet: 0.35, "gpt-oss": 0.15, haiku: 0.12, flash: 0.2, astra: 1, sol: 0.6, luna: 0.08 };
export const COSTO_DEFECTO = 0.25;
/** Proveedores que se pagan con suscripción (el costo es el equivalente en API). */
export const SUSCRIPCION = ["claude", "google", "openai"];

export type Par = {
  /** Clave de `efforts_permitidos` (la de `calidad`). */
  clave: string;
  id: string;
  nombre: string;
  effort: EffortCalidad;
  inteligencia: number;
  costo: number;
  fuenteCosto: "aa" | "estimado";
  suscripcion: boolean;
};
export type Dominado = { par: Par; por: Par };

export const costoDe = (f: FilaTabla, effort: EffortCalidad): { costo: number; fuente: "aa" | "estimado" } => {
  const aa = f.costoPorEffort?.[effort];
  if (aa !== undefined) return { costo: aa, fuente: "aa" };
  return { costo: (COSTO_FAMILIA[f.familia] ?? COSTO_DEFECTO) * MULT_EFFORT[effort], fuente: "estimado" };
};

/** Los esfuerzos que se ofrecen para un modelo: los medidos y los estimados que puede correr; sin desglose, los cinco. */
export const effortsDe = (f: FilaTabla): EffortCalidad[] => {
  const con = effortsMostrados(f);
  return con.length ? con : [...EFFORTS_CALIDAD];
};

/** Los esfuerzos permitidos hoy para ese modelo en el borrador (sin la clave: todos los que se ofrecen). */
export const permitidosDe = (f: FilaTabla, b: Borrador): EffortCalidad[] => {
  const l = b.efforts_permitidos[claveCalidad(f)];
  return l === undefined ? effortsDe(f) : effortsDe(f).filter((e) => l.includes(e));
};

/** Prende o apaga un esfuerzo de un modelo; si vuelven a quedar todos, la clave sale (vale la fábrica). */
export function ponerEffort(b: Borrador, f: FilaTabla, effort: EffortCalidad, on: boolean): Borrador {
  const todos = effortsDe(f);
  const ahora = new Set(permitidosDe(f, b));
  if (on) ahora.add(effort);
  else ahora.delete(effort);
  const lista = todos.filter((e) => ahora.has(e));
  const { [claveCalidad(f)]: _, ...resto } = b.efforts_permitidos;
  return { ...b, efforts_permitidos: lista.length === todos.length ? resto : { ...resto, [claveCalidad(f)]: lista } };
}

/** Todos los pares modelo+esfuerzo permitidos (modelo permitido, esfuerzo permitido, con puntaje, de pago). */
export function paresDe(filas: FilaTabla[], b: Borrador): Par[] {
  const out: Par[] = [];
  for (const f of filas) {
    if (f.gratis || !estadoDe(f, b).permitido) continue;
    for (const e of permitidosDe(f, b)) {
      const q = f.calidadPorEffort[e];
      if (q === undefined) continue;   // un esfuerzo estimado no se compara: no hay dato de AA con qué decir que otro lo domina
      const c = costoDe(f, e);
      out.push({ clave: claveCalidad(f), id: f.id, nombre: f.nombre, effort: e, inteligencia: q, costo: c.costo, fuenteCosto: c.fuente, suscripcion: SUSCRIPCION.includes(f.proveedor) });
    }
  }
  return out;
}

/** ¿`b` rinde igual o más por igual o menos, y mejor en algo? (Dos pares idénticos no se dominan.) */
const domina = (b: Par, a: Par) => b.inteligencia >= a.inteligencia && b.costo <= a.costo && (b.inteligencia > a.inteligencia || b.costo < a.costo);

/** Los pares dominados y quién los domina (el más barato de los que rinden igual o más; a igual costo, el más inteligente). */
export function dominados(pares: Par[]): Dominado[] {
  const out: Dominado[] = [];
  for (const a of pares) {
    const ds = pares.filter((x) => x !== a && !(x.id === a.id && x.effort === a.effort) && domina(x, a)).sort((p, q) => p.costo - q.costo || q.inteligencia - p.inteligencia);
    if (ds[0]) out.push({ par: a, por: ds[0] });
  }
  return out;
}

/** Desmarca cada esfuerzo dominado (un modelo sin esfuerzos que sirvan queda sin ninguno: `reparto` no lo usa). */
export function aplicarSugerencias(b: Borrador, filas: FilaTabla[], dom: Dominado[]): Borrador {
  let r = b;
  for (const d of dom) {
    const f = filas.find((x) => x.id === d.par.id);
    if (f) r = ponerEffort(r, f, d.par.effort, false);
  }
  return r;
}
