// Precios de API por millón de tokens (USD) para el costo equivalente de Estadísticas. Puro, sin React.
// Son los públicos de Anthropic (platform.claude.com/docs/en/about-claude/pricing, 2026-10-29). Es EQUIVALENTE: la
// suscripción no cobra por token, así que esto no es lo que se paga. Lo que no está en la tabla no tiene costo: no se
// inventa un precio (un modelo sin precio figura como "sin precio" y no suma al total).
//
// Caché escrito = el de 5 min (1,25× la entrada): el registro histórico no separa el de 1 h (2×). Haiku 5.5 usa el
// tramo de hasta 100 000 tokens por pedido; por encima cuesta el 5× (no se sabe por pedido desde el agregado).

export type Precio = {
  /** Entrada sin caché. */
  entrada: number;
  /** Salida. */
  salida: number;
  /** Caché leído (acierto de caché). */
  cacheLeido: number;
  /** Caché escrito (5 min). */
  cacheEscrito: number;
};

/** Clave: id de modelo (exacto, o prefijo: `claude-opus-5-5` cubre `claude-opus-5-5-20260401`). */
export type Tabla = Record<string, Precio>;

/** Tokens de una suma del registro histórico, con el caché escrito que se cobra como `cacheEscrito`. */
export type Tokens = { entrada: number; salida: number; cacheLeido: number; cacheEscrito: number };

/** Tope por millón: un número más grande es un error de tipeo, no un precio. */
export const PRECIO_MAX = 1000;

export const PRECIOS_PUBLICOS: Tabla = {
  "claude-fable-5-1": { entrada: 10, salida: 50, cacheLeido: 0.25, cacheEscrito: 12.5 },
  "claude-mythos-5-1": { entrada: 10, salida: 50, cacheLeido: 0.25, cacheEscrito: 12.5 },
  "claude-fable-5": { entrada: 10, salida: 50, cacheLeido: 1, cacheEscrito: 12.5 },
  "claude-opus-5-5": { entrada: 4, salida: 20, cacheLeido: 0.2, cacheEscrito: 5 },
  "claude-opus-5": { entrada: 5, salida: 25, cacheLeido: 0.5, cacheEscrito: 6.25 },
  "claude-opus-4-8": { entrada: 5, salida: 25, cacheLeido: 0.5, cacheEscrito: 6.25 },
  "claude-opus-4-7": { entrada: 5, salida: 25, cacheLeido: 0.5, cacheEscrito: 6.25 },
  "claude-opus-4-6": { entrada: 5, salida: 25, cacheLeido: 0.5, cacheEscrito: 6.25 },
  "claude-sonnet-5-5": { entrada: 2, salida: 10, cacheLeido: 0.1, cacheEscrito: 2.5 },
  "claude-sonnet-5": { entrada: 2, salida: 10, cacheLeido: 0.2, cacheEscrito: 2.5 },
  "claude-sonnet-4-6": { entrada: 3, salida: 15, cacheLeido: 0.3, cacheEscrito: 3.75 },
  "claude-haiku-5-5": { entrada: 0.1, salida: 0.5, cacheLeido: 0.01, cacheEscrito: 0.125 },
  "claude-haiku-4-5": { entrada: 1, salida: 5, cacheLeido: 0.1, cacheEscrito: 1.25 },
};

/** El precio de un modelo: el de su id exacto o el del prefijo más largo seguido de una fecha. `null`: sin precio. */
export function precioDe(modelo: string, tabla: Tabla): Precio | null {
  if (Object.hasOwn(tabla, modelo)) return tabla[modelo];
  let mejor: string | null = null;
  // Lo que sigue al prefijo tiene que ser una fecha (`-20260401`): `claude-opus-5-55` no es `claude-opus-5-5`.
  for (const k of Object.keys(tabla)) if (/^-\d{8}$/.test(modelo.slice(k.length)) && modelo.startsWith(k) && (mejor === null || k.length > mejor.length)) mejor = k;
  return mejor === null ? null : tabla[mejor];
}

/** Costo equivalente en USD de esos tokens a ese precio. */
export function costoUsd(s: Tokens, p: Precio): number {
  return (s.entrada * p.entrada + s.salida * p.salida + s.cacheLeido * p.cacheLeido + s.cacheEscrito * p.cacheEscrito) / 1_000_000;
}

/** Un número de la tabla editada: finito, de 0 a `PRECIO_MAX`. `null` si no sirve. */
export function precioValido(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= PRECIO_MAX ? x : null;
}

/** Lo guardado por el usuario (sólo los modelos que tocó) → un precio entero, o `null` si alguno de los 4 no sirve. */
export function precioDeGuardado(x: unknown): Precio | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const e = precioValido(o.entrada);
  const s = precioValido(o.salida);
  const r = precioValido(o.cacheLeido);
  const w = precioValido(o.cacheEscrito);
  return e === null || s === null || r === null || w === null ? null : { entrada: e, salida: s, cacheLeido: r, cacheEscrito: w };
}

/** Los públicos con lo que el usuario cambió encima (un modelo editado reemplaza su fila entera). */
export const tablaEfectiva = (cambios: Tabla): Tabla => ({ ...PRECIOS_PUBLICOS, ...cambios });

/** La suma de un modelo en el registro histórico (como `Suma` de electron/transcripts.ts). */
export type UsoModelo = { entrada: number; salida: number; cacheLeido: number; cacheCreado: number };

export type FilaCosto = { modelo: string; tokens: number; costo: number | null };

export type FilaRol = { rol: "lider" | "worker" | "subagente"; sesiones: number; tokens: number; costo: number; sinPrecio: boolean };

/**
 * El costo equivalente por rol: líderes, workers y subagentes (los que lanzan las sesiones con la herramienta Agent) por separado, para
 * que lo que gastan los subagentes se vea aparte de lo del líder que los lanzó. `sinPrecio`: algún modelo del rol no tiene precio y no suma.
 */
export function costoPorRol(roles: Record<FilaRol["rol"], { sesiones: number; modelos: Record<string, UsoModelo> }>, tabla: Tabla): FilaRol[] {
  return (["lider", "worker", "subagente"] as const).map((rol) => {
    const { filas, total } = filasCosto(roles[rol].modelos, tabla);
    return { rol, sesiones: roles[rol].sesiones, tokens: filas.reduce((n, f) => n + f.tokens, 0), costo: total, sinPrecio: filas.some((f) => f.costo === null) };
  });
}

/**
 * Una fila por modelo que usó tokens: primero los que tienen precio (de más a menos costo), después los sin precio (de más a
 * menos tokens). `total` suma sólo los que tienen precio. `tokens` es entrada + caché leído + salida, como en Estadísticas;
 * el costo además cobra el caché escrito, que no entra en esos tokens.
 */
export function filasCosto(modelos: Record<string, UsoModelo>, tabla: Tabla): { filas: FilaCosto[]; total: number } {
  const filas: FilaCosto[] = [];
  for (const [modelo, u] of Object.entries(modelos)) {
    const tokens = u.entrada + u.cacheLeido + u.salida;
    if (tokens <= 0 && u.cacheCreado <= 0) continue;
    const p = precioDe(modelo, tabla);
    const costo = p === null ? null : costoUsd({ entrada: u.entrada, salida: u.salida, cacheLeido: u.cacheLeido, cacheEscrito: u.cacheCreado }, p);
    filas.push({ modelo, tokens, costo });
  }
  filas.sort((a, b) => (a.costo === null ? 1 : b.costo === null ? -1 : b.costo - a.costo) || b.tokens - a.tokens);
  return { filas, total: filas.reduce((s, f) => s + (f.costo ?? 0), 0) };
}
