// Qué dice una «barra lisa» de cupo (src/ui/BarraCupo.tsx), sin React: un límite (5 h, semana, un grupo) → nivel, cifra y cuándo vuelve.
// Los umbrales son los de siempre (`AMBAR_DESDE` de cupos-riel-logica.ts: ámbar desde 80 %, coral sólo sin cupo, al 100 %). Puro: lo prueba
// `tests/barra-cupo.test.ts`.
import { AMBAR_DESDE } from "../barra/cupos-riel-logica.ts";
import { t } from "../i18n/index.ts";
import { cuandoFuturoCorto } from "../tiempo.ts";

/** `normal`: neutro; `poco`: desde `AMBAR_DESDE` %; `sin`: al 100 %. Sin dato es `normal` con `sinDato`. */
export type NivelBarra = "normal" | "poco" | "sin";

export interface LimiteBarra {
  /** % usado; `null`: sin dato. */
  pct: number | null;
  /** Cuándo vuelve (epoch s); `null` o 0: no se sabe. */
  vuelve?: number | null;
}

export interface VistaBarra {
  nivel: NivelBarra;
  sinDato: boolean;
  /** El % usado, redondeado (puede pasar de 100); `null`: sin dato. */
  pct: number | null;
  /** Cuánto se llena la barra, de 0 a 100 (sin dato: 0). */
  relleno: number;
  /** «85 %»; sin dato, «—». */
  cifra: string;
  /** La palabra del estado: «queda poco», «sin cupo», «sin dato»; vacía si está normal (no hay nada que decir). */
  texto: string;
  /** «vuelve a las 17:40» / «vuelve vie 09:00»; vacío si no se sabe o no se usó nada (con 0 % no hay nada que esperar). */
  vuelve: string;
}

/** El nivel de un % usado: el mismo corte que los anillos y el detalle de la barra. */
export const nivelBarra = (pct: number | null): NivelBarra => (pct === null ? "normal" : pct >= 100 ? "sin" : pct >= AMBAR_DESDE ? "poco" : "normal");

/** «vuelve a las 17:40» (hoy) o «vuelve vie 09:00» (otro día). */
export function textoVuelve(epoch: number, ahoraS: number): string {
  const cuando = cuandoFuturoCorto(epoch, ahoraS);
  return /^\d{2}:\d{2}$/.test(cuando) ? t("bcupo.vuelveA", { h: cuando }) : t("bcupo.vuelve", { cuando });
}

export function vistaBarra(l: LimiteBarra, ahoraS = Date.now() / 1000): VistaBarra {
  if (l.pct === null || !Number.isFinite(l.pct)) return { nivel: "normal", sinDato: true, pct: null, relleno: 0, cifra: "—", texto: t("riel.sinDato"), vuelve: "" };
  // El nivel sale del dato crudo: un 99,6 % no está «sin cupo», y tampoco se muestra como «100 %».
  const nivel = nivelBarra(l.pct);
  const pct = Math.max(0, l.pct < 100 ? Math.min(99, Math.round(l.pct)) : Math.round(l.pct));
  const texto = nivel === "sin" ? t("bcupo.sinCupo") : nivel === "poco" ? t("bcupo.quedaPoco") : "";
  const vuelve = pct > 0 && l.vuelve ? textoVuelve(l.vuelve, ahoraS) : "";
  return { nivel, sinDato: false, pct, relleno: Math.min(100, pct), cifra: `${pct} %`, texto, vuelve };
}

/** Lo que lee el lector de pantalla: «5 h: 85 % usado, queda poco, vuelve a las 17:40». */
export function ariaBarra(nombre: string, v: VistaBarra): string {
  if (v.pct === null) return t("bcupo.ariaSinDato", { nombre });
  return [t("bcupo.aria", { nombre, pct: v.pct }), v.texto, v.vuelve].filter(Boolean).join(", ");
}
