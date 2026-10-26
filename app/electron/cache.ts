// El caché de prompt de un líder: hasta cuándo vive, según lo último que se le vio.
// Dos fuentes, y ninguna manda sola: el statusline (lo escribe una sesión de terminal; el de
// un líder que se trajo a la app queda viejo para siempre) y lo que la app vio pasar por el
// stream de un líder suyo. Cada pedido contestado lee o escribe el caché y lo renueva, así que
// vale el vencimiento más tardío. Sin ningún dato no se sabe: `null`, nunca "vencido".
// Puro: se prueba desde la terminal.

export type Cache = { cache_ttl_s: number | null; cache_vence: number | null };

/**
 * Quién sirve el modelo, a efectos del caché: sólo el de Claude tiene un caché de prompt con TTL que Trama sabe leer
 * (5 min o 1 h, y el pedido dice con cuál escribió). Los demás no:
 *  - gemini (agy): caché implícito de Google, sin TTL documentado ni señal por pedido;
 *  - dsh / opencode: DeepSeek cachea en disco, sin ventana fija (horas a días, "best effort"); los modelos gratis de OpenCode
 *    Zen cobran $0 por lectura de caché pero no dicen cuánto vive;
 *  - ollama / local: no hay caché de prompt que venza, hay un modelo cargado en memoria hasta su `keep_alive`.
 */
export type MotorCache = "claude" | "gemini" | "dsh" | "opencode" | "ollama";

export function motorDeCache(modelo: string | null | undefined): MotorCache {
  const m = modelo ?? "";
  return m.startsWith("dsh:") ? "dsh" : m.startsWith("opencode:") ? "opencode" : m.startsWith("ollama:") ? "ollama" : /^(?:gemini-|agy:)/.test(m) ? "gemini" : "claude";
}

/** ¿Tiene sentido mostrar "le quedan N min de caché" (y "Uncached") para este modelo? Sin modelo (se desconoce) se asume Claude. */
export const cacheAplica = (modelo: string | null | undefined): boolean => motorDeCache(modelo) === "claude";

/** `keep_alive` de Ollama ("5m", "1h", "300", "30s") en segundos; negativo ("-1": para siempre), 0 o ilegible: `null`. */
export function keepAliveS(v: string | number | null | undefined): number | null {
  if (typeof v === "number") return v > 0 && Number.isFinite(v) ? v : null;
  const m = String(v ?? "").trim().match(/^(\d+(?:\.\d+)?)([smh]?)$/);
  if (!m) return null;
  const n = Number(m[1]) * ({ "": 1, s: 1, m: 60, h: 3600 } as Record<string, number>)[m[2]];
  return n > 0 ? n : null;
}

const SIN_CACHE: Cache = { cache_ttl_s: null, cache_vence: null };

/** Lo que dejó su statusline: el TTL y cuándo vence (epoch s), si los trae. */
export type DeStatusline = { ttl: number | null; vence: number | null };

/**
 * Lo que vio la app (epoch s; 0, nunca): cuándo terminó su último turno, cuándo contestó el
 * último pedido de este proceso (también a mitad de un turno) y el TTL que traía.
 */
export type DeApp = { ultimo: number; pedido: number; ttl: number | null };

/**
 * `modelo`: el del líder. Fuera de Claude no hay vencimiento que afirmar (`cache_vence: null`: la barra no pone numerito ni
 * "Uncached" y "Activas" no lo cuenta como caliente). Un Ollama con `keepAlive` conocido sí: el modelo sigue cargado hasta
 * `ultimo pedido + keep_alive`. Sin modelo vale lo de Claude. El TTL sale de lo medido (`usage.cache_creation`) y, si no,
 * del statusline de Claude Code; nunca se supone por plan (no se puede leer, y pasar del plan a créditos lo baja a 5 min).
 */
export function cacheDe(sl: DeStatusline | null, app: DeApp | null, modelo?: string | null, keepAlive?: string | number | null): Cache {
  const motor = motorDeCache(modelo);
  if (motor === "ollama") {
    const ka = keepAliveS(keepAlive);
    const visto = app ? Math.max(app.ultimo, app.pedido) : 0;
    return ka && visto > 0 ? { cache_ttl_s: ka, cache_vence: visto + ka } : SIN_CACHE;
  }
  if (motor !== "claude") return SIN_CACHE;
  const ttl = app?.ttl ?? sl?.ttl ?? null;
  const visto = app ? Math.max(app.ultimo, app.pedido) : 0;
  const deApp = visto > 0 && ttl ? visto + ttl : null;
  const deSl = sl?.vence ?? null;
  // Hubo un pedido después de lo que dice el statusline y no se sabe con qué TTL: no se sabe.
  if (deApp === null && visto > 0 && (deSl === null || deSl <= visto)) return { cache_ttl_s: ttl, cache_vence: null };
  if (deApp === null && deSl === null) return { cache_ttl_s: ttl, cache_vence: null };
  return { cache_ttl_s: ttl, cache_vence: Math.max(deApp ?? 0, deSl ?? 0) };
}

/** El TTL con el que un pedido escribió el caché (`usage.cache_creation`); `null` si sólo leyó. */
export function ttlDeUso(usage: any): number | null {
  const cc = usage?.cache_creation ?? {};
  return cc.ephemeral_1h_input_tokens > 0 ? 3600 : cc.ephemeral_5m_input_tokens > 0 ? 300 : null;
}

/**
 * ¿Esta línea del stream es un pedido contestado que tocó el caché de la conversación? Lo es el
 * mensaje entero del asistente con `usage` que leyó o escribió caché (leerlo también lo renueva).
 * Los de un subagente (`parent_tool_use_id`) son de otro prompt y no cuentan. `null`: no lo es.
 */
export function pedidoDe(linea: string): { ttl: number | null } | null {
  if (!linea.includes('"cache_')) return null;
  let o: any;
  try {
    o = JSON.parse(linea);
  } catch {
    return null;
  }
  if (o?.type !== "assistant" || o.parent_tool_use_id) return null;
  const u = o.message?.usage;
  if (!u) return null;
  const ttl = ttlDeUso(u);
  if (ttl === null && !(u.cache_read_input_tokens > 0) && !(u.cache_creation_input_tokens > 0)) return null;
  return { ttl };
}
