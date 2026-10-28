// Los avisos de los workers en la ventana (src/avisos-worker.ts los guarda y los escribe; electron/avisos-worker.ts los detecta):
// cada aviso nuevo se anota y, si corresponde, sale como notificación: en la PC por el main (`esperaNotificar`), en el celular
// con la del navegador si el dueño la permitió al prender el aviso en Ajustes. Los terminados normales sólo suman al punto.
import { useEffect } from "react";
import { fuente } from "../datos/fuente";
import { avisarWorkers, debeNotificar, recibirAviso, textoAviso, verTerminados } from "../avisos-worker";
import { esVentana } from "../puente";

const enfocada = () => typeof document !== "undefined" && document.hasFocus();

/** Una notificación del navegador (el celular); sin permiso o sin API, nada. */
function notificarWeb(titulo: string, cuerpo: string, etiqueta: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(titulo, { body: cuerpo, tag: etiqueta, silent: true });
  } catch {
    // Algunos navegadores móviles sólo la aceptan desde el service worker: sin ella no hay aviso, y la pastilla igual lo muestra.
  }
}

export function useAvisosWorkers() {
  useEffect(
    () =>
      fuente.alAvisoWorker((a) => {
        if (!recibirAviso(a)) return;
        // Lo que terminó con la ventana a la vista ya se vio: el punto sólo cuenta lo de cuando no se miraba.
        if (a.tipo === "fin" && enfocada()) verTerminados();
        if (!debeNotificar(a, { avisar: avisarWorkers(), enfocada: enfocada() })) return;
        const { titulo, cuerpo } = textoAviso(a);
        if (esVentana()) fuente.esperaNotificar({ sid: a.jefe_id ?? a.id, titulo, cuerpo });
        else notificarWeb(titulo, cuerpo, a.clave);
      }),
    [],
  );
  // Mirar la ventana cuenta como haber visto lo que terminó bien.
  useEffect(() => {
    if (enfocada()) verTerminados();
    window.addEventListener("focus", verTerminados);
    return () => window.removeEventListener("focus", verTerminados);
  }, []);
}
