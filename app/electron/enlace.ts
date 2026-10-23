// Los enlaces de un mensaje se abren afuera: la ventana nunca navega ni abre otra. Lo que se le
// pasa al sistema lo elige el texto de un modelo, así que sólo sale lo que es una página o un
// correo: nada de `file:`, `javascript:` ni esquemas de otras aplicaciones.
// Puro (sin `electron`): lo importan los tests. Abrir es de quien llama (`main.ts`).
import { appendFileSync } from "node:fs";

const ESQUEMAS = new Set(["http:", "https:", "mailto:"]);

/** La URL tal como se le pasa al sistema, o `null` si no es algo que se abra. */
export function abrible(url: string): string | null {
  try {
    const u = new URL(url);
    return ESQUEMAS.has(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Abre un enlace con `abrir` (el navegador del sistema). `HILOS_ABRIR=<archivo>` (pruebas): en
 * vez de abrir nada, anota la URL en ese archivo. `false`: no era algo que se abra.
 */
export function abrirEnlace(url: string, abrir: (u: string) => unknown): boolean {
  const u = abrible(url);
  if (!u) return false;
  const falso = process.env.HILOS_ABRIR;
  if (falso) appendFileSync(falso, u + "\n");
  else abrir(u);
  return true;
}
