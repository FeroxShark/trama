// ¿Existen estas rutas, y son archivo o carpeta? (canal `archivo:existen`). Lo usa el chat para volver tocable un nombre suelto
// (`a.wav`) que un mensaje deja bajo una carpeta: la ventana arma las rutas posibles y acá sólo se confirma cuáles están. No lee
// contenido ni abre ni ejecuta nada: devuelve el tipo y nada más. Lo que llega por IPC no es de fiar: sólo rutas absolutas
// (candidatasArchivo las limpia, sin `..`), y un secreto (`.env`, claves) contesta que no está.
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { candidatasArchivo } from "./archivo-candidatas.ts";
import { esSecreto } from "./archivo-ver.ts";

export type TipoExistente = "archivo" | "carpeta";

/** Cuántas rutas se contestan por pedido (el resto va como `null`). */
export const MAX_EXISTEN = 96;

/** Una por ruta de `x` (una lista de textos), en el mismo orden; `null` si no está, no es absoluta o no se muestra. Nunca lanza. */
export async function tiposDeRutas(x: unknown, plataforma: NodeJS.Platform = process.platform, home: string = homedir()): Promise<Array<TipoExistente | null>> {
  if (!Array.isArray(x)) return [];
  const lista = x.slice(0, MAX_EXISTEN);
  return Promise.all(
    lista.map(async (r): Promise<TipoExistente | null> => {
      const conHome = typeof r === "string" ? r.trim().replace(/^~(?=$|[\\\/])/, home) : r;
      for (const ruta of candidatasArchivo(conHome, plataforma)) {
        try {
          const st = await stat(ruta);
          if (st.isFile()) return esSecreto(ruta) ? null : "archivo";
          if (st.isDirectory()) return "carpeta";
        } catch {
          /* no está */
        }
      }
      return null;
    }),
  );
}
