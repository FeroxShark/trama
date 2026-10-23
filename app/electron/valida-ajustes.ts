// Lo que Ajustes deja cambiar y cuándo vale: el plan de la suscripción, la red de seguridad (`autoCompactWindow`) y el
// acceso desde el celular (puerto y dispositivos de la tailnet). Puro y sin imports: lo usan el main (para no escribir
// nada inválido) y el panel (para avisar antes de guardar), con las mismas reglas. Devuelve la clave de `src/i18n`
// del motivo (`null`: vale); el texto lo pone quien pinta.

export const PLANES = ["pro", "max"] as const;
export type Plan = (typeof PLANES)[number];

/** Dónde puede estar `autoCompactWindow` (tokens). */
export const RED_MIN = 100_000;
export const RED_MAX = 1_000_000;

/** Los puertos que se pueden abrir sin ser root. */
export const PUERTO_MIN = 1024;
export const PUERTO_MAX = 65535;
export const PUERTO_DEF = 8791;
/** Más dispositivos que esto no es el celular de una persona. */
export const DISPOSITIVOS_MAX = 20;

/** El acceso desde el celular como se edita: prendido o no, el puerto y los nombres cortos de los dispositivos que entran. */
export type ConfigEditable = { activo: boolean; puerto: number; dispositivos: string[] };

export const esPlan = (x: unknown): x is Plan => x === "pro" || x === "max";

/** Lo que se escribe en el campo de la red de seguridad: vacío = sin definir; si no, un entero entre `RED_MIN` y `RED_MAX`. */
export function validarRed(texto: string): { valor: number | null; error: string | null } {
  const s = texto.trim().replace(/[\s._']/g, "");
  if (!s) return { valor: null, error: null };
  if (!/^\d+$/.test(s)) return { valor: null, error: "ajustes.errRedNumero" };
  const n = Number(s);
  if (n < RED_MIN || n > RED_MAX) return { valor: null, error: "ajustes.errRedRango" };
  return { valor: n, error: null };
}

/** El puerto como número, o la clave del motivo. */
export function validarPuerto(x: unknown): string | null {
  const n = typeof x === "string" && /^\d+$/.test(x.trim()) ? Number(x) : x;
  if (typeof n !== "number" || !Number.isInteger(n)) return "ajustes.errPuertoNumero";
  return n < PUERTO_MIN || n > PUERTO_MAX ? "ajustes.errPuertoRango" : null;
}

/**
 * Un dispositivo es el nombre corto de la tailnet (`mi-celu`): letras, números y guiones. Una IP (`0.0.0.0`,
 * `192.0.2.1`), un nombre con puntos o uno que es sólo números no es un dispositivo: acá no se anota a quién
 * se escucha, sino quién entra, y a eso lo comprueba Tailscale por nombre.
 */
export function validarDispositivo(nombre: unknown, ya: readonly string[] = []): string | null {
  if (typeof nombre !== "string" || !nombre.trim()) return "ajustes.errDispVacio";
  const n = nombre.trim().toLowerCase();
  if (/[.:/]/.test(n) || /^\d+$/.test(n)) return "ajustes.errDispIp";
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(n)) return "ajustes.errDispNombre";
  if (ya.some((d) => d.toLowerCase() === n)) return "ajustes.errDispRepetido";
  return null;
}
