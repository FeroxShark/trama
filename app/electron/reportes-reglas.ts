// Las reglas del receptor de reportes anónimos (reportes/src/index.ts, el Worker), sin nada de Cloudflare ni de Node: las usan el Worker y la
// Trama que los baja (electron/reporte-anonimo.ts). Lo prueba app/tests/reporte-anonimo.test.ts.
// Todo lo que llega es de cualquiera: se valida el tipo y el largo de cada campo, se limpia el texto (sin caracteres de control, de
// dirección ni invisibles) y la captura sólo pasa si es un JPEG o un PNG de verdad (después Cloudflare Images la vuelve a generar).

/** Lo más largo que se acepta de cada cosa. */
export const MAX = { cuerpo: 1_600_000, descripcion: 3000, log: 120_000, version: 20, sistema: 120, captura: 1_400_000 } as const;
/** Cuánto vive un reporte en el KV si nadie lo baja. */
export const VIDA_S = 30 * 86_400;

export type Reporte = { descripcion: string; log: string | null; version: string; sistema: string };
export type Entrada = Reporte & { captura: Uint8Array | null };

// C0 salvo tab y salto de línea, DEL y C1; los de dirección (pueden dar vuelta lo que se lee) y los invisibles.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u034F\u061C\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFE00-\uFE0F\uFEFF\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;

/** Texto de afuera → texto plano seguro de guardar: normalizado, sin caracteres de control ni invisibles, con tope. `null` si no es texto. */
export function limpiarTexto(x: unknown, max: number): string | null {
  if (typeof x !== "string") return null;
  return x.normalize("NFC").replace(/\r\n?/g, "\n").replace(CONTROL, "").slice(0, max);
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Los primeros bytes dicen qué es: sólo JPEG o PNG. */
export function tipoImagen(b: Uint8Array): "image/jpeg" | "image/png" | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  return null;
}

export function deBase64(s: string): Uint8Array | null {
  if (!BASE64.test(s) || s.length % 4 !== 0) return null;
  try {
    const bin = atob(s);
    const b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return b;
  } catch {
    return null;
  }
}

export function aBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/** El cuerpo de un POST → la entrada limpia, o el motivo del rechazo (corto, sin repetir lo que vino). */
export function validarEntrada(texto: string): { ok: true; entrada: Entrada } | { ok: false; error: string } {
  if (texto.length > MAX.cuerpo) return { ok: false, error: "muy grande" };
  let o: Record<string, unknown>;
  try {
    const j = JSON.parse(texto) as unknown;
    if (!j || typeof j !== "object" || Array.isArray(j)) return { ok: false, error: "formato" };
    o = j as Record<string, unknown>;
  } catch {
    return { ok: false, error: "formato" };
  }
  const descripcion = limpiarTexto(o.descripcion, MAX.descripcion)?.trim();
  if (!descripcion) return { ok: false, error: "falta descripcion" };
  const log = o.log === null || o.log === undefined ? null : limpiarTexto(o.log, MAX.log);
  if (log === null && o.log !== null && o.log !== undefined) return { ok: false, error: "log" };
  const version = typeof o.version === "string" && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(o.version) ? o.version : "?";
  const sistema = limpiarTexto(o.sistema, MAX.sistema) ?? "?";
  let captura: Uint8Array | null = null;
  if (o.captura !== null && o.captura !== undefined) {
    if (typeof o.captura !== "string" || o.captura.length > MAX.captura) return { ok: false, error: "captura" };
    captura = deBase64(o.captura);
    if (!captura || !tipoImagen(captura)) return { ok: false, error: "captura" };
  }
  return { ok: true, entrada: { descripcion, log, version, sistema, captura } };
}

/** Los ids que arma el receptor: `<tiempo en base 36>-<16 hex>`. Nada más pasa a una clave del KV. */
export const ID_RE = /^[0-9a-z]{6,12}-[0-9a-f]{16}$/;

export function nuevoId(ahoraMs: number, azar: Uint8Array): string {
  return `${ahoraMs.toString(36)}-${[...azar.subarray(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Compara la clave de lectura sin cortar en el primer byte distinto. */
export function mismaClave(dada: string | null, buena: string | undefined): boolean {
  if (!dada || !buena || buena.length < 32) return false;
  const a = new TextEncoder().encode(dada);
  const b = new TextEncoder().encode(buena);
  let dif = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) dif |= (a[i] ?? 0) ^ b[i]!;
  return dif === 0;
}
