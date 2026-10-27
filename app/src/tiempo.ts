// Los textos que cambian con el tiempo, como pintores del reloj compartido.
import { diaSemana, locale, t } from "./i18n/index.ts";
import type { Pintor } from "./reloj";

const MIN = 60;
const HORA = 3600;
const DIA = 86400;

/**
 * Un prefijo que va pegado adelante ("líder · "). Si depende del idioma, una
 * función: se evalúa en cada pintada y al cambiar de idioma el reloj repinta.
 */
export type Prefijo = string | (() => string);
const pre = (p: Prefijo) => (typeof p === "string" ? p : p());

/** "hace 6 m", "hace 2 h", "ayer", "hace 3 d". */
export const pintorHace =
  (desde: number, prefijo: Prefijo = ""): Pintor =>
  (a) => {
    const d = Math.max(0, a - desde);
    const p = pre(prefijo);
    if (d < MIN) return { texto: p + t("tiempo.haceMenos"), en: MIN - d };
    if (d < HORA) return { texto: p + t("tiempo.haceM", { n: Math.floor(d / MIN) }), en: MIN - (d % MIN) };
    if (d < DIA) return { texto: p + t("tiempo.haceH", { n: Math.floor(d / HORA) }), en: HORA - (d % HORA) };
    if (d < 2 * DIA) return { texto: p + t("tiempo.ayer"), en: 2 * DIA - d };
    return { texto: p + t("tiempo.haceD", { n: Math.floor(d / DIA) }), en: DIA - (d % DIA) };
  };

/** "38 s", "4 m", "1 h 05 m": cuánto lleva trabajando. Segundos sólo el primer minuto. */
export const pintorDura =
  (desde: number, prefijo: Prefijo = ""): Pintor =>
  (a) => {
    const d = Math.max(0, a - desde);
    const p = pre(prefijo);
    if (d < MIN) return { texto: `${p}${Math.floor(d)} s`, en: 1 - (d % 1) };
    if (d < HORA) return { texto: `${p}${Math.floor(d / MIN)} m`, en: MIN - (d % MIN) };
    const m = Math.floor((d % HORA) / MIN);
    return { texto: `${p}${Math.floor(d / HORA)} h ${String(m).padStart(2, "0")} m`, en: MIN - (d % MIN) };
  };

/** "12 m", "1 h 05 m": una duración que ya no cambia. */
export function duracion(segundos: number) {
  const m = Math.max(1, Math.round(segundos / MIN));
  return m < 60 ? `${m} m` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} m`;
}

const dos = (n: number) => String(n).padStart(2, "0");
const diaDe = (f: Date) => new Date(f.getFullYear(), f.getMonth(), f.getDate()).getTime();

/**
 * La hora de un mensaje, en local y corta: "22:41" si es de hoy, "ayer 22:41",
 * "2 oct 22:41" (de otro año, con el año). Se calcula al pintar: sin reloj.
 */
export function cuando(epoch: number, ahora = Date.now() / 1000): string {
  const f = new Date(epoch * 1000);
  const h = new Date(ahora * 1000);
  const hora = `${dos(f.getHours())}:${dos(f.getMinutes())}`;
  const dias = Math.round((diaDe(h) - diaDe(f)) / (DIA * 1000));
  if (dias <= 0) return hora;
  if (dias === 1) return t("tiempo.ayerA", { h: hora });
  const fecha = f
    .toLocaleDateString(locale(), { day: "numeric", month: "short", ...(f.getFullYear() !== h.getFullYear() ? { year: "numeric" } : {}) })
    .replace(/\./g, "")
    .replace(/ de /g, " ");
  return `${fecha} ${hora}`;
}

/** Fecha y hora enteras, para el tooltip: "jueves, 2 de octubre de 2026, 22:41". */
export const cuandoLargo = (epoch: number) =>
  new Date(epoch * 1000).toLocaleString(locale(), { dateStyle: "full", timeStyle: "short", hour12: false });

/** Lo que falta, con unidades que se leen: "16 min", "13 h 25 min", "3 d 5 h". */
function falta(r: number): { texto: string; en: number } {
  if (r < HORA) return { texto: `${Math.max(1, Math.ceil(r / MIN))} min`, en: r % MIN || MIN };
  if (r < DIA) {
    const m = Math.floor((r % HORA) / MIN);
    return { texto: `${Math.floor(r / HORA)} h${m ? ` ${m} min` : ""}`, en: r % MIN || MIN };
  }
  const h = Math.floor((r % DIA) / HORA);
  return { texto: `${Math.floor(r / DIA)} d${h ? ` ${h} h` : ""}`, en: r % HORA || HORA };
}

/** "se reinicia en 16 min", "se reinicia en 13 h 25 min", "se reinicia en 3 d 5 h". */
export const pintorReinicio =
  (hasta: number): Pintor =>
  (a) => {
    const r = hasta - a;
    if (r <= 0) return { texto: t("tiempo.reiniciaYa"), en: Infinity };
    const f = falta(r);
    return { texto: t("tiempo.reiniciaEn", { t: f.texto }), en: f.en };
  };

/** Lo mismo en corto, para la barra angosta: "en 16 min", "en 13 h 25 min", "en 3 d 5 h". */
/** Para los cupos de Google: "vuelve en 2 d 19 h". */
export const pintorVuelve =
  (hasta: number): Pintor =>
  (a) => {
    const r = hasta - a;
    if (r <= 0) return { texto: t("tiempo.ya"), en: Infinity };
    const f = falta(r);
    return { texto: t("tiempo.vuelveEn", { t: f.texto }), en: f.en };
  };

export const pintorResta =
  (hasta: number): Pintor =>
  (a) => {
    const r = hasta - a;
    if (r <= 0) return { texto: t("tiempo.ya"), en: Infinity };
    const f = falta(r);
    return { texto: t("tiempo.en", { t: f.texto }), en: f.en };
  };

/** La hora local exacta, para el tooltip: "se reinicia a las 16:50", "se reinicia mañana 09:00", "se reinicia el jueves 18:00". */
export const pintorCuando =
  (hasta: number): Pintor =>
  (a) => {
    const r = hasta - a;
    if (r <= 0) return { texto: t("tiempo.reiniciaYa"), en: Infinity };
    const f = new Date(hasta * 1000);
    const hora = `${dos(f.getHours())}:${dos(f.getMinutes())}`;
    const medianoche = new Date(a * 1000).setHours(24, 0, 0, 0) / 1000;
    if (hasta < medianoche) return { texto: t("tiempo.reiniciaHoy", { hora }), en: r };
    // "Mañana" dura hasta la medianoche, cuando pasa a ser "hoy": ahí se repinta.
    const pasadoManana = new Date(a * 1000).setHours(48, 0, 0, 0) / 1000;
    if (hasta < pasadoManana) return { texto: t("tiempo.reiniciaManana", { hora }), en: Math.min(r, medianoche - a) };
    return { texto: t("tiempo.reiniciaElDia", { dia: diaSemana(f, true), hora }), en: Math.min(r, medianoche - a) };
  };

/** Desde esto (s) el uso del plan se muestra con cuándo se vio: puede estar atrasado. */
export const VIEJO_S = 15 * MIN;

/**
 * Un dato del uso del plan visto en `ts`: hasta `VIEJO_S`, lo de `pintor`; después, "visto hace
 * 40 m" en su lugar o, `junto`, después de lo suyo (el tooltip). `ts` 0: no se sabe, nunca viejo.
 */
export const pintorVisto =
  (ts: number, pintor: Pintor, junto = false): Pintor =>
  (a) => {
    const p = pintor(a);
    const d = a - ts;
    if (!ts || d < VIEJO_S) return { ...p, en: ts ? Math.min(p.en, VIEJO_S - d) : p.en };
    const h = pintorHace(ts)(a);
    const visto = t("uso.visto", { hace: h.texto });
    return junto && p.texto ? { texto: `${p.texto} · ${visto}`, en: Math.min(h.en, p.en) } : { texto: visto, en: h.en };
  };

// Cuándo empezó el pulso de cada caché: la señal late una sola vez aunque la
// fila se desmonte y vuelva (colapsar, buscar, StrictMode).
const pulsos = new Map<string, number>();
const PULSO_S = 2;

/**
 * El numerito: minutos que le quedan al caché. Señal (`data-senal`) a los
 * 10 min, o a 1/6 del TTL si es corto: "pulso" la primera vez, después "si".
 * Vencido o frío (no va a pegar aunque no haya vencido): "Uncached" y `data-frio`.
 */
export function pintorCache(clave: string, vence: number, ttl: number | null, frio: boolean): Pintor {
  const umbral = Math.min(10 * MIN, (ttl ?? HORA) / 6);
  return (a) => {
    const r = vence - a;
    if (frio || r <= 0)
      return { texto: t("cache.uncached"), en: Infinity, attrs: { "data-senal": null, "data-frio": "", "data-tip": t("cache.uncachedTip") } };
    let senal: string | null = null;
    if (r <= umbral) {
      if (!pulsos.has(clave)) pulsos.set(clave, a);
      senal = a - pulsos.get(clave)! < PULSO_S ? "pulso" : "si";
    }
    const m = Math.floor(r / MIN);
    return {
      texto: r < MIN ? "<1m" : `${m}m`,
      en: Math.min(r < MIN ? r : r % MIN || MIN, r > umbral ? r - umbral : Infinity),
      attrs: {
        "data-senal": senal,
        "data-frio": null,
        "data-tip": r < MIN ? t("cache.baratoMenos") : t("cache.barato", { m }),
      },
    };
  };
}

/** El mismo dato en la vista de hilo: "barato 38 min" / "uncached". */
export function pintorBarato(vence: number | null, frio: boolean): Pintor {
  return (a) => {
    const r = (vence ?? 0) - a;
    if (frio || r <= 0) return { texto: t("cache.vistaUncached"), en: Infinity };
    return {
      texto: r < MIN ? t("cache.vistaBaratoMenos") : t("cache.vistaBarato", { m: Math.floor(r / MIN) }),
      en: r < MIN ? r : r % MIN || MIN,
    };
  };
}

/**
 * Cuándo vuelve algo, en local y sin segundos: "hoy 01:01", "mañana 01:01", "jue 01:01" (dentro de la semana), "2 nov 01:01".
 * Se calcula al pintar (no es un reloj: la hora absoluta no cambia con el tiempo).
 */
export function cuandoFuturo(epoch: number, ahora = Date.now() / 1000): string {
  const f = new Date(epoch * 1000);
  const h = new Date(ahora * 1000);
  const hora = `${dos(f.getHours())}:${dos(f.getMinutes())}`;
  const dias = Math.round((diaDe(f) - diaDe(h)) / (DIA * 1000));
  if (dias <= 0) return t("tiempo.hoyA", { h: hora });
  if (dias === 1) return t("tiempo.mananaA", { h: hora });
  if (dias < 7) return `${diaSemana(f)} ${hora}`;
  const fecha = f.toLocaleDateString(locale(), { day: "numeric", month: "short" }).replace(/\./g, "").replace(/ de /g, " ");
  return `${fecha} ${hora}`;
}

/** "2 nov": una fecha ISO corta (YYYY-MM-DD) en local y sin año; si no es una fecha, el texto tal cual. */
export function fechaCorta(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(locale(), { day: "numeric", month: "short" }).replace(/\./g, "").replace(/ de /g, " ");
}
