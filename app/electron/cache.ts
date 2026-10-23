// El caché de prompt de un líder: hasta cuándo vive, según lo último que se le vio.
// Dos fuentes, y ninguna manda sola: el statusline (lo escribe una sesión de terminal; el de
// un líder que se trajo a la app queda viejo para siempre) y lo que la app vio pasar por el
// stream de un líder suyo. Cada pedido contestado lee o escribe el caché y lo renueva, así que
// vale el vencimiento más tardío. Sin ningún dato no se sabe: `null`, nunca "vencido".
// Puro: se prueba desde la terminal.

export type Cache = { cache_ttl_s: number | null; cache_vence: number | null };

/** Lo que dejó su statusline: el TTL y cuándo vence (epoch s), si los trae. */
export type DeStatusline = { ttl: number | null; vence: number | null };

/**
 * Lo que vio la app (epoch s; 0, nunca): cuándo terminó su último turno, cuándo contestó el
 * último pedido de este proceso (también a mitad de un turno) y el TTL que traía.
 */
export type DeApp = { ultimo: number; pedido: number; ttl: number | null };

export function cacheDe(sl: DeStatusline | null, app: DeApp | null): Cache {
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
