// El uso del plan (las ventanas de 5 h y de la semana): qué lectura vale para cada una.
// Dos fuentes, y ninguna manda sola: el statusline (lo escribe una sesión de terminal; un
// líder de la app es un `claude -p` y no tiene) y el `rate_limit_event` que pasa por el
// stream de un líder de la app. El límite es de la cuenta, no de la sesión: vale la lectura
// más nueva que traiga esa ventana. Una que no la trae (el statusline de una sesión que
// todavía no contestó nada) no tapa a la anterior, y una ventana que ya se reinició no se
// afirma: `null`, que la barra muestra como "sin dato". Un porcentaje sin hora de reinicio
// (`resets_at` null) vale igual: la barra lo muestra sin el "se reinicia en…".
// Adentro de una misma ventana el uso no baja: una lectura más nueva con menos es un dato viejo
// con la hora de ahora (el statusline de una terminal ociosa se reescribe con lo último que vio
// su sesión, que puede ser de horas atrás). La tercera fuente, la oficial, es lo que dice
// claude.ai en ese momento (`get_usage`, pedido por `claude` mismo al sincronizar): ésa vale
// aunque diga menos.
// Puro: se prueba desde la terminal.

/** `resets_at` (epoch s) es `null` si la lectura trajo el porcentaje sin cuándo se reinicia. */
export type Ventana = { pct: number; resets_at: number | null };
/**
 * Una ventana como se la vio en `ts` (epoch s). `oficial`: la dijo el endpoint de uso de claude.ai
 * (lo mismo que su página), no la cabecera de una respuesta.
 */
export type Vista = Ventana & { ts: number; oficial?: true };
export type Lectura = { five_hour: Vista | null; seven_day: Vista | null };

const CUALES = ["five_hour", "seven_day"] as const;
const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
/**
 * Dos lecturas son de la misma ventana si su reinicio difiere menos que esto (s): la cabecera dice
 * el segundo y el endpoint puede redondear, y la ventana siguiente se reinicia por lo menos 5 h después.
 */
const MISMA_S = 3600;

/** ¿El statusline es de la cuenta de siempre? `config_dir` es el `CLAUDE_CONFIG_DIR` de la sesión: vacío o `~/.claude` = la de siempre; otra carpeta = una cuenta agregada, que no cuenta en el cupo de Claude. */
export function esCuentaDeSiempre(a: any, home = ""): boolean {
  const d = a?.config_dir;
  if (d == null || d === "") return true;
  if (typeof d !== "string") return false;
  const limpio = d.replace(/\/+$/, "");
  return limpio === "~/.claude" || (!!home && limpio === `${home.replace(/\/+$/, "")}/.claude`);
}

/** Lo que dejó un statusline (`rate_limits.*`: `used_percentage` de 0 a 100). */
export function deStatusline(a: any): Lectura {
  const ts = num(a?.ts) ? a.ts : 0;
  const v = (x: any): Vista | null => (num(x?.used_percentage) ? { pct: x.used_percentage, resets_at: num(x.resets_at) ? x.resets_at : null, ts } : null);
  return { five_hour: v(a?.rate_limits?.five_hour), seven_day: v(a?.rate_limits?.seven_day) };
}

/**
 * ¿Esta línea del stream dice cuánto va del plan? Lo dice el `rate_limit_event`, en cada turno:
 * `unifiedWindows` trae las dos ventanas (`utilization` de 0 a 1). Sin eso, la ventana que
 * nombra (`rateLimitType`) con su `utilization`, o entera si la rechazó. `null`: no dice nada.
 */
export function lecturaDe(linea: string, ahora: number): Lectura | null {
  if (!linea.includes('"rate_limit_event"')) return null;
  let o: any;
  try {
    o = JSON.parse(linea);
  } catch {
    return null;
  }
  if (o?.type !== "rate_limit_event") return null;
  const r = o.rate_limit_info ?? {};
  const l: Lectura = { five_hour: null, seven_day: null };
  for (const c of CUALES) {
    const w = r.unifiedWindows?.[c];
    if (num(w?.utilization)) l[c] = { pct: w.utilization * 100, resets_at: num(w.resetsAt) ? w.resetsAt : null, ts: ahora };
    else if (r.rateLimitType === c) {
      const u = num(r.utilization) ? r.utilization : r.status === "rejected" ? 1 : null;
      if (u !== null) l[c] = { pct: u * 100, resets_at: num(r.resetsAt) ? r.resetsAt : null, ts: ahora };
    }
  }
  return l.five_hour || l.seven_day ? l : null;
}

/**
 * Lo que contesta `claude` al `get_usage` (experimental en Claude Code 2.1.300): `rate_limits.*`
 * con `utilization` de 0 a 100 y `resets_at` en ISO 8601. `null`: no dice nada del plan (sin
 * suscripción, o el endpoint no contestó).
 */
export function deUsoOficial(r: any, ahora: number): Lectura | null {
  const v = (x: any): Vista | null => {
    if (!num(x?.utilization)) return null;
    const ms = typeof x.resets_at === "string" ? Date.parse(x.resets_at) : num(x.resets_at) ? x.resets_at * 1000 : NaN;
    return { pct: x.utilization, resets_at: Number.isFinite(ms) ? Math.round(ms / 1000) : null, ts: ahora, oficial: true };
  };
  const l: Lectura = { five_hour: v(r?.rate_limits?.five_hour), seven_day: v(r?.rate_limits?.seven_day) };
  return l.five_hour || l.seven_day ? l : null;
}

/**
 * ¿Esta línea del stream es la respuesta a un `get_usage`? (la de un `control_response` que trae
 * `rate_limits`). `null`: no lo es, o no dice nada del plan.
 */
export function oficialDe(linea: string, ahora: number): Lectura | null {
  if (!linea.includes('"rate_limits"')) return null;
  let o: any;
  try {
    o = JSON.parse(linea);
  } catch {
    return null;
  }
  if (o?.type !== "control_response" || o.response?.subtype !== "success") return null;
  return deUsoOficial(o.response.response, ahora);
}

/** Lo que vale de cada ventana (`mejor`) entre lo que había y lo nuevo: la nueva sólo toca las que trae. */
export function juntar(antes: Lectura | null, nueva: Lectura): Lectura {
  const de = (c: (typeof CUALES)[number]) => mejor([antes?.[c] ?? null, nueva[c]].filter((v) => v !== null));
  return { five_hour: de("five_hour"), seven_day: de("seven_day") };
}

/** ¿Dicen lo mismo? (sin mirar cuándo se vio). */
export function igual(a: Lectura | null, b: Lectura | null): boolean {
  return CUALES.every((c) => a?.[c]?.pct === b?.[c]?.pct && a?.[c]?.resets_at === b?.[c]?.resets_at);
}

/** Una lectura guardada (`uso.json`), o `null` si no lo es. */
export function guardada(x: any): Lectura | null {
  if (x?.version !== 1) return null;
  const v = (y: any): Vista | null =>
    num(y?.pct) && num(y?.ts) ? { pct: y.pct, resets_at: num(y.resets_at) ? y.resets_at : null, ts: y.ts, ...(y.oficial === true ? { oficial: true as const } : {}) } : null;
  const l = { five_hour: v(x.five_hour), seven_day: v(x.seven_day) };
  return l.five_hour || l.seven_day ? l : null;
}

/**
 * De todas las lecturas de una ventana, la que vale: de la más vieja a la más nueva, la de una
 * ventana posterior pisa; adentro de la misma, una oficial pisa siempre y otra sólo si no dice
 * menos (el uso no baja: menos es un dato viejo con la hora de ahora). La de una ventana anterior
 * no cuenta. Sin hora de reinicio no se sabe de qué ventana es: pisa la más nueva, como antes.
 */
function mejor(vs: Vista[]): Vista | null {
  let m: Vista | null = null;
  for (const v of [...vs].sort((a, b) => a.ts - b.ts)) {
    // Sin hora de reinicio no se sabe si es la misma ventana: vale la más nueva, como antes.
    const corre = m && v.resets_at !== null && m.resets_at !== null ? v.resets_at - m.resets_at : null;
    if (!m || corre === null || corre > MISMA_S) m = v;
    else if (corre < -MISMA_S) continue;
    else if (v.oficial || v.pct >= m.pct) m = v;
  }
  return m;
}

/**
 * Las barras: de cada ventana, la lectura que vale (`mejor`); si ya pasó su reinicio no se
 * sabe cuánto va de la que siguió (`null`). `ts`: cuándo se vio lo más nuevo que se muestra (0, nada).
 */
export function usoDe(lecturas: (Lectura | null)[], ahora: number): { ts: number; five_hour: Ventana | null; seven_day: Ventana | null } {
  const de = (c: (typeof CUALES)[number]): Vista | null => {
    const m = mejor(lecturas.map((l) => l?.[c] ?? null).filter((v) => v !== null));
    return m && (m.resets_at === null || m.resets_at > ahora) ? m : null;
  };
  const [h, s] = [de("five_hour"), de("seven_day")];
  const limpia = (v: Vista | null): Ventana | null => (v ? { pct: v.pct, resets_at: v.resets_at } : null);
  return { ts: Math.max(h?.ts ?? 0, s?.ts ?? 0), five_hour: limpia(h), seven_day: limpia(s) };
}

/** Cuándo se reinicia la próxima ventana que se muestra (epoch s): ahí hay que releer. `null`: ninguna. */
export function proximoReinicio(u: { five_hour: Ventana | null; seven_day: Ventana | null }): number | null {
  const rs = [u.five_hour?.resets_at, u.seven_day?.resets_at].filter(num);
  return rs.length ? Math.min(...rs) : null;
}
