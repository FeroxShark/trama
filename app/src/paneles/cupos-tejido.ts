// Ajustes > Plan y cupos, la tela: qué dice cada renglón de cuenta (cuántos hilos prende cada carril, el estado en palabras) y el aviso de arriba
// cuando a la cuenta en uso se le acaba el cupo y otra tiene lugar. Puro, sin React ni textos: lo prueba tests/cupos-tejido.test.ts.
import type { GrupoCupo, SuscripcionCupo, VentanaCupo } from "../datos/contrato";
import { masUsado } from "../barra/cuposVista";

/** Cuántos hilos tiene un carril. */
export const HILOS = 37;
/** Desde este % usado la ventana «queda poco» (el carril pasa a ámbar y el estado lo dice en palabras). */
export const POCO_DESDE = 70;

export type NivelCarril = "ok" | "poco" | "sin" | "nada" | "off";

/** `off`: no rige ahora; `nada`: sin dato; `sin`: 100 %; `poco`: desde `POCO_DESDE`. */
export function nivelCarril(v: Pick<VentanaCupo, "pct" | "deshabilitada">): NivelCarril {
  if (v.deshabilitada) return "off";
  if (v.pct === null) return "nada";
  return v.pct >= 100 ? "sin" : v.pct >= POCO_DESDE ? "poco" : "ok";
}

/** Los hilos prendidos: nunca cero con algo de uso y el carril sólo se llena con el 100 %. */
export function hilosPrendidos(pct: number | null): number {
  if (pct === null || pct <= 0) return 0;
  if (pct >= 100) return HILOS;
  return Math.min(HILOS - 1, Math.ceil((pct / 100) * HILOS));
}

export type EstadoCuenta =
  | { nivel: "ok" | "sindato" | "desconectada" | "marcada" }
  | { nivel: "poco" | "sin"; ventana: string };

/** El estado de una cuenta: desconectada, marcada por un 429, sin cupo (manda la semana: con ella llena, la 5 h no cuenta), con poco (la más llena), con lugar. */
export function estadoCuenta(ventanas: readonly VentanaCupo[], agotado: number | undefined, logueado: boolean | null, ahoraS: number): EstadoCuenta {
  if (logueado === false) return { nivel: "desconectada" };
  if (agotado !== undefined && agotado > ahoraS) return { nivel: "marcada" };
  const rigen = ventanas.filter((v) => nivelCarril(v) !== "off" && nivelCarril(v) !== "nada");
  if (!rigen.length) return { nivel: "sindato" };
  const llenas = rigen.filter((v) => nivelCarril(v) === "sin");
  if (llenas.length) return { nivel: "sin", ventana: (llenas.find((v) => v.id === "7d") ?? llenas[0]).id };
  const pocas = rigen.filter((v) => nivelCarril(v) === "poco");
  if (pocas.length) return { nivel: "poco", ventana: pocas.reduce((a, v) => ((v.pct ?? 0) > (a.pct ?? 0) ? v : a)).id };
  return { nivel: "ok" };
}

/** Lo que muestra el renglón de una suscripción: sus ventanas o, repartida en grupos, las del grupo más usado. */
export function ventanasDeSusc(s: Pick<SuscripcionCupo, "ventanas" | "grupos" | "agotado"> | undefined): { ventanas: VentanaCupo[]; agotado: number | undefined; grupo: GrupoCupo | null } {
  if (!s) return { ventanas: [], agotado: undefined, grupo: null };
  if (s.ventanas?.length) return { ventanas: s.ventanas, agotado: s.agotado, grupo: null };
  if (s.grupos?.length) {
    const g = masUsado(s.grupos);
    return { ventanas: g.ventanas, agotado: g.agotado, grupo: g };
  }
  return { ventanas: [], agotado: s.agotado, grupo: null };
}

/** La cuenta en uso de un proveedor: la que el motor marca como preferida; si no marca ninguna, la de siempre. */
export function esEnUso<P extends { id: string; preferida: boolean; defecto: boolean }>(p: P, todas: readonly P[]): boolean {
  return p.preferida || (!todas.some((x) => x.preferida) && p.defecto);
}

export type FilaResumen = { id: string; nombre: string; enUso: boolean; estado: EstadoCuenta; ventanas: readonly VentanaCupo[] };
export type Hallazgo = { nombre: string; nivel: "poco" | "sin"; ventana: string; otra: string | null };

const usoMayor = (vs: readonly VentanaCupo[]) => vs.reduce((m, v) => Math.max(m, v.pct ?? 0), 0);

/** El aviso de arriba de la tela: la cuenta en uso con poco o sin cupo y, si la hay, la otra con más lugar. Trama no cambia sola: sólo lo dice. */
export function hallazgo(filas: readonly FilaResumen[]): Hallazgo | null {
  if (filas.length < 2) return null;
  const uso = filas.find((f) => f.enUso);
  if (!uso || (uso.estado.nivel !== "poco" && uso.estado.nivel !== "sin")) return null;
  const libres = filas.filter((f) => !f.enUso && f.estado.nivel === "ok");
  const otra = libres.length ? libres.reduce((a, f) => (usoMayor(f.ventanas) < usoMayor(a.ventanas) ? f : a)) : null;
  return { nombre: uso.nombre, nivel: uso.estado.nivel, ventana: uso.estado.ventana, otra: otra?.nombre ?? null };
}
