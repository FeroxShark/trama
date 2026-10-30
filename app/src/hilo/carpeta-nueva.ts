// La carpeta donde arranca un líder nuevo. Antes, sin elegir nada, arrancaba en la carpeta personal (`~`) y las conversaciones quedaban
// sueltas fuera de todo proyecto. Ahora arranca en el proyecto seleccionado en la barra o, si no hay, en el último donde se mandó un
// primer mensaje; la carpeta personal sólo si la persona la elige. Puro: lo prueba tests/carpeta-nueva.test.ts (el almacén: carpeta-nueva-estado.ts).
import { GENERAL } from "../datos/contrato.ts";

/** Lo mínimo que se necesita de un proyecto (`ProyectoNombre`, src/datos/proyectos.ts). */
export type ProyectoCarpeta = { slug: string; ruta: string; existe: boolean };

/** Los ids de las dos opciones fijas del selector (no pueden chocar con una ruta). */
export const PERSONAL = "\u0001personal";
export const OTRA = "\u0001otra";

/** Para comparar rutas sin importar `/` o `\`, mayúsculas (Windows) ni la barra del final. */
export const llanaRuta = (r: string) => r.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/**
 * La carpeta con que arranca la caja de un líder nuevo, para `proyectos`: el proyecto seleccionado en la barra (`seleccion`, su slug)
 * y si no, el último donde se mandó un primer mensaje (`ultima`, su ruta, sólo si sigue siendo un proyecto). `""`: la personal
 * (sin ninguno de los dos, o si el último fue la personal elegida a mano: `ultima === PERSONAL`).
 */
export function carpetaPorDefecto(d: { seleccion: string | null; ultima: string | null; proyectos: readonly ProyectoCarpeta[] }): string {
  const s = d.seleccion && d.seleccion !== GENERAL ? d.proyectos.find((p) => p.slug === d.seleccion && p.existe) : undefined;
  if (s) return s.ruta;
  const ultima = d.ultima;
  if (ultima && ultima !== PERSONAL) {
    const u = d.proyectos.find((p) => p.existe && llanaRuta(p.ruta) === llanaRuta(ultima));
    if (u) return u.ruta;
  }
  return "";
}

/** Qué opción del selector corresponde a `carpeta` (lo escrito o elegido): la personal, un proyecto (su ruta) u otra carpeta. */
export function opcionDe(carpeta: string, proyectos: readonly ProyectoCarpeta[]): string {
  if (!carpeta.trim()) return PERSONAL;
  const p = proyectos.find((x) => x.existe && llanaRuta(x.ruta) === llanaRuta(carpeta));
  return p ? p.ruta : OTRA;
}
