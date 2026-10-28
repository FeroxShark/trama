// La vista de Ramas, lo puro: cuántas ramas tiene cada veredicto del analista,
// el filtro por veredicto y el resumen de arriba. Con extensión en los imports:
// lo prueba `node --test` (tests/ramas-vista.test.ts).
import type { Juicio, Veredicto } from "../datos/analista.ts";
import { VEREDICTOS } from "../datos/analista.ts";

/** Lo que filtran los chips: un veredicto, las que no tienen (todavía) o todas. */
export type FiltroRama = Veredicto | "sin" | "todas";

/** Cuántas ramas tiene cada veredicto; `sin` son las que el analista no juzgó. */
export function cuentas(ids: readonly string[], juicios: ReadonlyMap<string, Juicio>): Record<Veredicto | "sin", number> {
  const c = { integrar: 0, descartar: 0, retomar: 0, revisar: 0, sin: 0 };
  for (const id of ids) {
    const j = juicios.get(id);
    if (j) c[j.veredicto]++;
    else c.sin++;
  }
  return c;
}

/** ¿Pasa la rama el filtro de los chips? */
export const pasa = (id: string, juicios: ReadonlyMap<string, Juicio>, f: FiltroRama): boolean => {
  if (f === "todas") return true;
  const j = juicios.get(id);
  return f === "sin" ? !j : j?.veredicto === f;
};

/** Los veredictos que tienen ramas, en el orden de los chips (integrar primero). */
export const conCuenta = (c: Record<Veredicto | "sin", number>): Veredicto[] => VEREDICTOS.filter((v) => c[v] > 0);

/** Un filtro que se quedó sin ramas (se resolvieron todas) vuelve a "todas". */
export const filtroVigente = (f: FiltroRama, c: Record<Veredicto | "sin", number>): FiltroRama => (f === "todas" || c[f] > 0 ? f : "todas");

// --- "Aplicar todos los veredictos" ---------------------------------------------------------------------------------------

/** Lo que "Aplicar todos" hace con una rama: las acciones que ya tiene cada fila (Integrar, Descartar, Retomar). */
export type AccionLote = "integrar" | "descartar" | "retomar";

/** Una rama tal como la ve el plan: lo mínimo de su fila. */
export type RamaPlan = {
  id: string;
  /** No está trabajando, ni integrada, ni con una acción en curso. */
  libre: boolean;
  /** Chocó con main (80): necesita Actualizar antes de integrar. */
  choco: boolean;
  /** Ya falló algo con ella (el error que muestra su fila). */
  conError: boolean;
  /** Murió: su trabajo está a medias; integrarlo no es "seguro". */
  murio: boolean;
  /** `pa --hilos`: el RESULTADO no trajo la verificación. */
  sinVerificar: boolean;
};

/** Qué se aplica y qué queda para el usuario (con el porqué de cada una). */
export type PlanLote = {
  integrar: string[];
  descartar: string[];
  retomar: string[];
  /** El analista dijo "revisar", o dijo "integrar" pero no es seguro: lo decide el usuario. */
  aparte: { id: string; motivo: "revisar" | "choco" | "error" | "murio" | "sinVerificar" }[];
  total: number;
};

export function planAplicar(ramas: readonly RamaPlan[], juicios: ReadonlyMap<string, Juicio>): PlanLote {
  const p: PlanLote = { integrar: [], descartar: [], retomar: [], aparte: [], total: 0 };
  for (const r of ramas) {
    const j = juicios.get(r.id);
    if (!j || !r.libre) continue;
    if (j.veredicto === "descartar") p.descartar.push(r.id);
    else if (j.veredicto === "retomar") p.retomar.push(r.id);
    else if (j.veredicto === "revisar") p.aparte.push({ id: r.id, motivo: "revisar" });
    else if (r.choco) p.aparte.push({ id: r.id, motivo: "choco" });
    else if (r.conError) p.aparte.push({ id: r.id, motivo: "error" });
    else if (r.murio) p.aparte.push({ id: r.id, motivo: "murio" });
    else if (r.sinVerificar) p.aparte.push({ id: r.id, motivo: "sinVerificar" });
    else p.integrar.push(r.id);
  }
  p.total = p.integrar.length + p.descartar.length + p.retomar.length;
  return p;
}

export type FasePaso = "espera" | "curso" | "ok" | "error";
export type PasoLote = { id: string; accion: AccionLote; fase: FasePaso; error: string | null };

/** Los pasos en el orden en que corren: integrar (de a una: tocan main), retomar y, al final, descartar. */
export const pasosDe = (p: Pick<PlanLote, "integrar" | "retomar" | "descartar">): PasoLote[] => [
  ...p.integrar.map((id) => ({ id, accion: "integrar" as const, fase: "espera" as const, error: null })),
  ...p.retomar.map((id) => ({ id, accion: "retomar" as const, fase: "espera" as const, error: null })),
  ...p.descartar.map((id) => ({ id, accion: "descartar" as const, fase: "espera" as const, error: null })),
];

/**
 * Corre los pasos de a uno con `ejecutar` (devuelve el error, o `null` si salió bien) y avisa cada cambio con la lista nueva.
 * Un paso que falla no frena a los demás. `parar()` corta antes del siguiente (los que no corrieron quedan en espera).
 */
export async function correrLote(
  pasos: readonly PasoLote[],
  ejecutar: (p: PasoLote) => Promise<string | null>,
  alCambiar: (pasos: PasoLote[]) => void,
  parar: () => boolean = () => false,
): Promise<PasoLote[]> {
  let actual = pasos.map((p) => ({ ...p }));
  const poner = (i: number, parche: Partial<PasoLote>) => {
    actual = actual.map((p, k) => (k === i ? { ...p, ...parche } : p));
    alCambiar(actual);
  };
  for (let i = 0; i < actual.length; i++) {
    if (parar()) break;
    poner(i, { fase: "curso" });
    let error: string | null;
    try {
      error = await ejecutar(actual[i]);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    poner(i, error === null ? { fase: "ok", error: null } : { fase: "error", error });
  }
  return actual;
}

/** Cuántos pasos salieron bien y cuántos fallaron. */
export const resumenLote = (pasos: readonly PasoLote[]) => ({
  ok: pasos.filter((p) => p.fase === "ok").length,
  mal: pasos.filter((p) => p.fase === "error").length,
  faltan: pasos.filter((p) => p.fase === "espera" || p.fase === "curso").length,
});

/** Qué líder analizó cada rama (rama → id de sesión del analista), para el enlace "Ver el análisis". */
export type Analisis = Readonly<Record<string, string>>;

/** Lo guardado en el navegador, leído con cuidado: algo roto o de otra forma cuenta como vacío. */
export function leerAnalisis(crudo: string | null): Analisis {
  try {
    const v: unknown = JSON.parse(crudo ?? "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    return {};
  }
}

/** El enlace sólo vale si el analista que hizo el análisis de esa rama sigue abierto: uno cerrado no tiene conversación a la que volver. */
export const analisisVigente = (a: Analisis, id: string, sidAnalista: string | undefined): boolean => !!sidAnalista && a[id] === sidAnalista;
