// "Te espera" en la pantalla de la PC: lo que el renderer le pide al main de la ventana (el número en la bandeja y la
// notificación de escritorio). Sin Electron, para probarlo con `node --test` (tests/espera-aviso.test.ts); ventana-canales.ts
// lo ejecuta y main.ts arma la bandeja. Qué decide cuándo avisar: src/espera.ts.

import { appendFileSync } from "node:fs";

/** Cuántos líderes esperan y el texto de la bandeja ya traducido ("2 líderes te esperan"). */
export type EstadoEspera = { n: number; texto: string };
/** Una notificación: el líder (para abrirlo al tocarla) y sus textos ya traducidos. */
export type AvisoEspera = { sid: string; titulo: string; cuerpo: string };

export function estadoValido(x: unknown): EstadoEspera | null {
  const o = x as { n?: unknown; texto?: unknown } | null;
  if (!o || typeof o.n !== "number" || !Number.isInteger(o.n) || o.n < 0 || o.n > 999 || typeof o.texto !== "string") return null;
  return { n: o.n, texto: o.texto.slice(0, 120) };
}

export function avisoValido(x: unknown): AvisoEspera | null {
  const o = x as { sid?: unknown; titulo?: unknown; cuerpo?: unknown } | null;
  if (!o || typeof o.sid !== "string" || !o.sid || o.sid.length > 200) return null;
  if (typeof o.titulo !== "string" || !o.titulo.trim() || typeof o.cuerpo !== "string") return null;
  return { sid: o.sid, titulo: o.titulo.slice(0, 120), cuerpo: o.cuerpo.slice(0, 200) };
}

/**
 * Un punto de color en la esquina de arriba a la derecha de un bitmap BGRA (como lo da `nativeImage.toBitmap()`):
 * el ícono de la bandeja cuando alguien espera. Devuelve una copia; el original no se toca.
 */
export function conPunto(bitmap: Uint8Array, ancho: number, alto: number, rgb: readonly [number, number, number]): Uint8Array {
  const sal = Uint8Array.from(bitmap);
  const r = Math.max(2, Math.round(Math.min(ancho, alto) * 0.22));
  const cx = ancho - r - 1;
  const cy = r + 1;
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > r + 0.5) continue;
      // El borde se suaviza con la opacidad (alfa premultiplicado no hace falta: el punto es opaco por dentro).
      const a = d <= r - 0.5 ? 255 : Math.round(255 * (r + 0.5 - d));
      const i = (y * ancho + x) * 4;
      const k = a / 255;
      sal[i] = Math.round(rgb[2] * k + sal[i] * (1 - k));
      sal[i + 1] = Math.round(rgb[1] * k + sal[i + 1] * (1 - k));
      sal[i + 2] = Math.round(rgb[0] * k + sal[i + 2] * (1 - k));
      sal[i + 3] = Math.max(sal[i + 3], a);
    }
  }
  return sal;
}

/**
 * Muestra la notificación con `mostrar`. `HILOS_NOTIFICAR=<archivo>` (pruebas): en vez de mostrar nada, anota el aviso en
 * ese archivo, una línea de JSON. En bench, captura y pruebas, sin ese archivo, no sale nada: nunca una notificación de
 * mentira en el escritorio del usuario.
 */
export function anunciar(a: AvisoEspera, mostrar: (a: AvisoEspera) => void, env: NodeJS.ProcessEnv = process.env): void {
  if (env.HILOS_NOTIFICAR) appendFileSync(env.HILOS_NOTIFICAR, JSON.stringify(a) + "\n");
  else if (!env.HILOS_PRUEBA && !env.HILOS_BENCH && !env.HILOS_CAPTURA && !env.HILOS_CAPTURA_PNG && !env.HILOS_GUION && env.HILOS_FIXTURES !== "1") mostrar(a);
}
