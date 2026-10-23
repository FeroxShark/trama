// "Te espera" en la ventana (electron/espera.ts lo decide; acá se muestra y se avisa): el número en el título y en la bandeja,
// la notificación de escritorio (una por líder y por turno, sólo con la ventana sin el foco) y apagar el estado cuando el usuario
// ya tiene esa conversación a la vista. Sin timers: se mueve sólo cuando llega la lista de líderes o cambia el foco.
import { useEffect, useRef } from "react";
import type { Lider } from "../datos/contrato";
import { fuente } from "../datos/fuente";
import { esperan, porAvisar, avisarEspera } from "../espera";
import { t } from "../i18n";

const TITULO = typeof document === "undefined" ? "trama" : document.title || "trama";

/** El texto del tooltip de la bandeja y del título: "2 líderes te esperan". */
export const textoEspera = (n: number) => (n === 0 ? "" : n === 1 ? t("espera.uno") : t("espera.varios", { n }));

const enfocada = () => typeof document !== "undefined" && document.hasFocus();

/**
 * `lideres`: la lista que se ve; `sid`: la conversación abierta (o null). El usuario "la tiene a la vista" si está abierta y la
 * ventana tiene el foco: ahí el líder deja de esperar (`fuente.liderVisto`) y no se avisa.
 */
export function useEspera(lideres: readonly Lider[], sid: string | null) {
  const ya = useRef(new Map<string, number>());
  const primera = useRef(true);
  const idioma = t("espera.uno");

  // Título, bandeja y notificación, con cada lista nueva.
  useEffect(() => {
    const quienes = esperan(lideres);
    const n = quienes.length;
    if (typeof document !== "undefined") document.title = n > 0 ? `(${n}) ${TITULO}` : TITULO;
    void fuente.esperaEstado({ n, texto: textoEspera(n) });
    for (const l of porAvisar(lideres, ya.current, { avisar: avisarEspera(), enfocada: enfocada(), primera: primera.current })) {
      const nombre = l.nombre || t("lider.sesionJefe");
      fuente.esperaNotificar({ sid: l.id, titulo: nombre, cuerpo: t(l.espera!.motivo === "pide" ? "espera.pide" : "espera.listo") });
    }
    if (lideres.length > 0) primera.current = false;
  }, [lideres, idioma]);

  // El usuario mira esa conversación: deja de esperar.
  useEffect(() => {
    if (!sid) return;
    const visto = () => {
      if (enfocada() && lideres.some((l) => l.id === sid && l.espera)) fuente.liderVisto(sid);
    };
    visto();
    window.addEventListener("focus", visto);
    return () => window.removeEventListener("focus", visto);
  }, [sid, lideres]);
}

/** Lo que pasa al tocar la notificación: lo conecta la barra con su `abrirLider`. */
export function useAlAbrirEspera(abrir: (sid: string) => void) {
  useEffect(() => fuente.alAbrirEspera(abrir), [abrir]);
}
