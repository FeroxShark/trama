// El log de esta app: `$HILOS_STATE/trama.log` (1 MB, 3 archivos; electron/bitacora.ts). También sale por
// stderr, que es lo que ve `journalctl --user -u trama`. `silencio` es el `.catch` que no cambia nada
// pero deja una línea. La ventana en modo cliente (electron/ventana-cliente.ts) escribe en `ventana.log`:
// dos procesos rotando el mismo archivo se pisan.
import path from "node:path";
import { crearBitacora, type Bitacora } from "./bitacora.ts";
import { ESTADO } from "./estado.ts";

const eco = (l: string) => console.error(l);
let actual = crearBitacora({ archivo: path.join(ESTADO, "trama.log"), eco });

export const log: Bitacora = {
  get archivo() {
    return actual.archivo;
  },
  escribir: (nivel, donde, detalle) => actual.escribir(nivel, donde, detalle),
};

/** Desde acá, el log va a `$HILOS_STATE/<nombre>` (la ventana cliente: `ventana.log`). */
export function logAparte(nombre: string) {
  actual = crearBitacora({ archivo: path.join(ESTADO, nombre), eco });
}

/** `.catch(silencio("donde"))`: el mismo comportamiento que `.catch(() => {})`, con una línea en el log. */
export const silencio = (donde: string) => (e: unknown) => log.escribir("aviso", donde, e);
