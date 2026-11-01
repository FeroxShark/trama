// Entender "cuándo" en lo que escribe el usuario para programar un mensaje o posponer un hilo: "en 30 min", "+2h", "1h30",
// "18:30", "mañana 9:00", "in 45 minutes", "tomorrow 8am". Sin imports (la usan el main y la ventana) y sin leer el reloj: el
// "ahora" entra como argumento, así el test no espera por el reloj. Las horas sueltas son de la zona local de la máquina.

/** Lo más lejos que se programa algo: un año. */
export const LEJOS_MS = 366 * 24 * 3600 * 1000;

const MIN = 60_000;

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** "30" + "min"/"h"/"d" → milisegundos; `null` si la unidad no se conoce. */
function unidad(n: number, u: string): number | null {
  if (/^(m|min|mins|minuto|minutos|minute|minutes)$/.test(u)) return n * MIN;
  if (/^(h|hs|hr|hrs|hora|horas|hour|hours)$/.test(u)) return n * 60 * MIN;
  if (/^(d|dia|dias|day|days)$/.test(u)) return n * 24 * 60 * MIN;
  return null;
}

/** Una hora del día ("9", "9:05", "18.30", "6pm", "9:15 am") → [hora, minuto]; `null` si no es una hora. */
function horaDelDia(s: string): [number, number] | null {
  const m = /^(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/.exec(s.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  const ampm = m[3]?.[0];
  // Un número solo ("9") sin am/pm ni minutos es ambiguo con una duración: quien llama lo trata como hora sólo si viene con "mañana" o ":".
  if (ampm) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ampm === "p" ? 12 : 0);
  }
  if (h > 23 || min > 59) return null;
  return [h, min];
}

/** La próxima vez que el reloj de pared marque `h:m` (hoy si falta, si no mañana), o el día pedido a esa hora. */
function proxima(ahora: Date, h: number, m: number, diasMas: number | null): number {
  const d = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + (diasMas ?? 0), h, m, 0, 0);
  if (diasMas === null && d.getTime() <= ahora.getTime()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * Cuándo es lo que escribió, en ms desde epoch; `null` si no se entiende o ya pasó. Entiende:
 * duraciones ("en 30 min", "+2h", "en 1h30", "2 días"), una hora ("18:30", "6pm": la próxima vez que se cumpla), un día y hora
 * ("mañana 9:00", "tomorrow 8am", "hoy 23:00") y una fecha completa ("2026-11-05 09:00", "2026-11-05T09:00").
 */
export function resolverCuando(entrada: string, ahora: number): number | null {
  const crudo = sinTildes(String(entrada ?? "")).toLowerCase().trim().replace(/\s+/g, " ");
  if (!crudo || crudo.length > 60) return null;
  const hoy = new Date(ahora);

  // Fecha completa.
  const f = /^(\d{4})-(\d{2})-(\d{2})(?:[ t](\d{1,2}):(\d{2}))?$/.exec(crudo);
  if (f) {
    const d = new Date(Number(f[1]), Number(f[2]) - 1, Number(f[3]), f[4] === undefined ? 9 : Number(f[4]), f[5] === undefined ? 0 : Number(f[5]), 0, 0);
    if (d.getMonth() !== Number(f[2]) - 1 || d.getTime() <= ahora || d.getTime() - ahora > LEJOS_MS) return null;
    return d.getTime();
  }

  // Un día y, a veces, una hora.
  const dia = /^(hoy|today|manana|tomorrow|pasado manana)(?: (?:a las |a la |at )?(.+))?$/.exec(crudo);
  if (dia) {
    const mas = dia[1] === "hoy" || dia[1] === "today" ? 0 : dia[1] === "pasado manana" ? 2 : 1;
    const h = dia[2] === undefined ? ([9, 0] as [number, number]) : (horaDelDia(dia[2]) ?? (/^\d{1,2}$/.test(dia[2]) ? ([Number(dia[2]), 0] as [number, number]) : null));
    if (!h || h[0] > 23) return null;
    const t = proxima(hoy, h[0], h[1], mas);
    return t > ahora && t - ahora <= LEJOS_MS ? t : null;
  }

  // Una duración, con o sin "en"/"in"/"+".
  const sinEn = crudo.replace(/^(en|in|dentro de|\+)\s*/, "");
  const conPrefijo = sinEn !== crudo;
  // "1h30" sin "en" es una hora del día (01:30); como duración hace falta el prefijo: "en 1h30", "+1h30".
  const comp = !conPrefijo ? null : /^(\d+)\s*h(?:s|oras?|ours?|r|rs)?\s*(\d+)\s*(?:m|min|mins|minutos?)?$/.exec(sinEn);
  if (comp) {
    const ms = (Number(comp[1]) * 60 + Number(comp[2])) * MIN;
    return ms > 0 && ms <= LEJOS_MS ? ahora + ms : null;
  }
  const dur = /^(\d+(?:[.,]\d+)?)\s*([a-z]+)$/.exec(sinEn);
  if (dur) {
    const ms = unidad(Number(dur[1].replace(",", ".")), dur[2]);
    if (ms !== null && ms >= MIN && ms <= LEJOS_MS) return ahora + Math.round(ms);
    if (ms !== null) return null;
  }

  // Una hora del día (con ":" o "." o am/pm; un número solo no, es ambiguo).
  if (/\d[:.h]\d|\d ?(am|pm|a\.m|p\.m)/.test(crudo)) {
    const h = horaDelDia(crudo.replace(/^(a las |a la |at )/, ""));
    if (h) return proxima(hoy, h[0], h[1], null);
  }
  return null;
}

/** Las opciones rápidas del selector, como textos que `resolverCuando` entiende. */
export const RAPIDOS = ["en 15 min", "en 1 h", "en 3 h", "mañana 9:00"] as const;
