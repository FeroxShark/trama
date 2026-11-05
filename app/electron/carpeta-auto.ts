// La carpeta "Auto" de un líder nuevo: al mandar el primer mensaje, el proyecto que ese mensaje nombra (por nombre, título, alias, slug o
// ruta del registry de ESTA máquina) o, si no nombra ninguno, la carpeta personal (`undefined`). Sin llamar a ningún modelo: no demora el envío.
// Nunca un proyecto retirado ni uno cuya carpeta ya no existe. Lo prueba tests/carpeta-auto.test.ts.
import { stat } from "node:fs/promises";
import { proyectoEnTexto } from "./tema.ts";
import { registro, vivosDe, type Proyecto } from "./registro.ts";

/** La ruta del proyecto vivo que nombra `texto` entre `proyectos`, o `undefined` (carpeta personal). `existe` dice si una carpeta está en el disco. */
export async function carpetaAutoDe(
  texto: string,
  proyectos: readonly Proyecto[],
  home: string,
  existe: (ruta: string) => Promise<boolean> = (r) => stat(r).then((s) => s.isDirectory(), () => false),
): Promise<string | undefined> {
  const vivos = vivosDe(proyectos);
  const slug = proyectoEnTexto(texto, vivos, home);
  if (!slug) return undefined;
  // Dos carpetas con el mismo nombre de archivo comparten slug: vale la primera que existe.
  for (const p of vivos) if (p.slug === slug && (await existe(p.ruta))) return p.ruta;
  return undefined;
}

/** `carpetaAutoDe` con el registry de esta máquina. */
export async function carpetaAuto(texto: string, home: string): Promise<string | undefined> {
  return carpetaAutoDe(texto, await registro(), home);
}
