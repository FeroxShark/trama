// Dónde buscar un archivo local en esta plataforma. Sin lecturas: lo comparten archivo-ver.ts y archivo-abrir.ts.
import path from "node:path";
import { rutaAbsoluta, rutaWsl } from "./imagen-ruta.ts";

/**
 * Una ruta de Windows sólo se lee en Windows (y, por `/mnt`, en WSL); una de Linux, no en Windows. En Windows sale con las barras
 * nativas: un mensaje dice `C:/a/b` y `~/b` queda `C:\Users\x/b`, y eso va al shell del sistema (`shell.openPath`), que no siempre
 * acepta la barra `/`. La ruta ya viene sin `..` (`rutaAbsoluta`): normalizar no la lleva a otro lado.
 */
export function candidatasArchivo(x: unknown, plataforma: NodeJS.Platform = process.platform): string[] {
  const r = rutaAbsoluta(x);
  if (!r) return [];
  if (r.estilo === "win32") return plataforma === "win32" ? [path.win32.normalize(r.ruta)] : plataforma === "linux" ? [rutaWsl(r.ruta)] : [];
  return plataforma === "win32" ? [] : [r.ruta];
}
