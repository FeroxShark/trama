// Ajustes > Actualizaciones > Salud: de los eventos de salud de Trama (`salud:eventos`, electron/salud-eventos.ts) saca cuatro renglones con
// cifra y palabra (vueltas de versión, reinicios lentos, líderes cortados al salir, avisos descartados), o «Todo bien» si no hay nada.
// Puro: sin React ni puente; los textos son claves de i18n que arma el componente. Los eventos llegan sin validar: lo que no tiene la
// forma de un evento se salta.
import type { Clave } from "../i18n";

/** Cuántos días mira el bloque. */
export const DIAS_SALUD = 30;
/** Un reinicio es lento si tardó más que esto (milisegundos). */
export const REINICIO_LENTO_MS = 15_000;

export type RenglonSalud = {
  id: "vueltas" | "reinicios" | "lideres" | "avisos";
  /** `true` cuando no hubo nada de eso: el renglón dice «Sin …». */
  ok: boolean;
  clave: Clave;
  vars?: { n: number; s?: number };
};
export type ResumenSalud = {
  /** Nada para mirar: el bloque dice sólo «Todo bien». */
  bien: boolean;
  /** Cuántos de los cuatro renglones tienen algo para mirar (los que no están `ok`). */
  cosas: number;
  /** Los cuatro renglones, siempre en este orden (vacío cuando `bien`). */
  renglones: RenglonSalud[];
};

const numero = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

export function resumirSalud(eventos: unknown): ResumenSalud {
  let vueltas = 0;
  let lentos = 0;
  let peorMs = 0;
  let lideres = 0;
  let avisos = 0;
  for (const e of Array.isArray(eventos) ? eventos : []) {
    if (!e || typeof e !== "object") continue;
    const ev = e as { tipo?: unknown; ms?: unknown; n?: unknown };
    if (ev.tipo === "vuelta-version") vueltas++;
    else if (ev.tipo === "reinicio") {
      const ms = numero(ev.ms);
      if (ms !== null && ms > REINICIO_LENTO_MS) {
        lentos++;
        peorMs = Math.max(peorMs, ms);
      }
    } else if (ev.tipo === "lideres-cortados") {
      const n = numero(ev.n);
      if (n !== null && n > 0) lideres += Math.floor(n);
    } else if (ev.tipo === "aviso-descartado") avisos++;
  }
  const renglones: RenglonSalud[] = [
    vueltas === 0 ? { id: "vueltas", ok: true, clave: "salud.vueltas0" } : { id: "vueltas", ok: false, clave: vueltas === 1 ? "salud.vueltas1" : "salud.vueltas", vars: { n: vueltas } },
    lentos === 0
      ? { id: "reinicios", ok: true, clave: "salud.reinicios0" }
      : { id: "reinicios", ok: false, clave: lentos === 1 ? "salud.reinicios1" : "salud.reinicios", vars: { n: lentos, s: Math.round(peorMs / 1000) } },
    lideres === 0 ? { id: "lideres", ok: true, clave: "salud.lideres0" } : { id: "lideres", ok: false, clave: lideres === 1 ? "salud.lideres1" : "salud.lideres", vars: { n: lideres } },
    avisos === 0 ? { id: "avisos", ok: true, clave: "salud.avisos0" } : { id: "avisos", ok: false, clave: avisos === 1 ? "salud.avisos1" : "salud.avisos", vars: { n: avisos } },
  ];
  const cosas = renglones.filter((r) => !r.ok).length;
  return cosas === 0 ? { bien: true, cosas: 0, renglones: [] } : { bien: false, cosas, renglones };
}
