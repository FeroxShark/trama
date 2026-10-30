// Dónde buscar un archivo local en esta plataforma. Sin lecturas: lo comparten archivo-ver.ts y archivo-abrir.ts.
import { rutaAbsoluta, rutaWsl } from "./imagen-ruta.ts";

/** Una ruta de Windows sólo se lee en Windows (y, por `/mnt`, en WSL); una de Linux, no en Windows. */
export function candidatasArchivo(x: unknown, plataforma: NodeJS.Platform = process.platform): string[] {
  const r = rutaAbsoluta(x);
  if (!r) return [];
  if (r.estilo === "win32") return plataforma === "win32" ? [r.ruta] : plataforma === "linux" ? [rutaWsl(r.ruta)] : [];
  return plataforma === "win32" ? [] : [r.ruta];
}
