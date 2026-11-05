// La carpeta donde arranca un líder nuevo. Siempre arranca en "Auto" (también con un proyecto filtrado en la barra): al mandar el primer
// mensaje el main infiere el proyecto que nombra (sin llamar a un modelo) y, si no nombra ninguno, el líder va a la carpeta personal.
// Elegir una carpeta a mano manda y nada la pisa después. Un proyecto retirado nunca se ofrece. Puro: lo prueba tests/carpeta-nueva.test.ts
// (la inferencia, en el main: electron/carpeta-auto.ts; el almacén del pedido "Nueva tarea aquí": carpeta-nueva-estado.ts).
import { esRetirado } from "../../electron/reemplazos.ts";

/** Lo mínimo que se necesita de un proyecto (`ProyectoNombre`, src/datos/proyectos.ts). */
export type ProyectoCarpeta = { slug: string; ruta: string; existe: boolean; estado?: string | null };

/** Los ids de las tres opciones fijas del selector (no pueden chocar con una ruta). */
export const AUTO = "\u0001auto";
export const PERSONAL = "\u0001personal";
export const OTRA = "\u0001otra";

/** Para comparar rutas sin importar `/` o `\`, mayúsculas (Windows) ni la barra del final. */
export const llanaRuta = (r: string) => r.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** Los proyectos que se ofrecen en el selector: con la carpeta en el disco y sin los retirados. */
export const ofrecidos = <P extends ProyectoCarpeta>(proyectos: readonly P[]): P[] => proyectos.filter((p) => p.existe && !esRetirado(p));

/**
 * Qué opción del selector corresponde a la carpeta de ahora: "Auto" mientras no se haya elegido nada a mano; después, la personal (vacía),
 * un proyecto que se ofrece (su ruta) u otra carpeta.
 */
export function opcionDe(carpeta: string, aMano: boolean, proyectos: readonly ProyectoCarpeta[]): string {
  if (!aMano) return AUTO;
  if (!carpeta.trim()) return PERSONAL;
  const p = ofrecidos(proyectos).find((x) => llanaRuta(x.ruta) === llanaRuta(carpeta));
  return p ? p.ruta : OTRA;
}

/**
 * Lo que se manda con el primer mensaje: sin elegir nada a mano, `auto` (el main de la máquina que corre el líder infiere la carpeta con su
 * registry; sin proyecto que nombre el mensaje, la personal); a mano, esa carpeta tal cual, o nada si es la personal.
 */
export function carpetaDeEnvio(carpeta: string, aMano: boolean): { carpeta?: string; auto?: true } {
  if (!aMano) return { auto: true };
  return carpeta.trim() ? { carpeta: carpeta.trim() } : {};
}

/** La carpeta de un proyecto pedido ("Nueva tarea aquí", una tarea del tablero): su ruta si se ofrece; `null` si no (retirado, borrado, desconocido). */
export function rutaPedida(slug: string, proyectos: readonly ProyectoCarpeta[]): string | null {
  return ofrecidos(proyectos).find((p) => p.slug === slug)?.ruta ?? null;
}
