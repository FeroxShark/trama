// La versión de Trama que corre esta página, para el aviso de Trama nueva (AvisoClaude.tsx). Lo prueba tests/version-pagina.test.ts.
import type { EstadoActTrama } from "../datos/fuente.ts";

declare const __TRAMA_VERSION__: string | undefined;
/** La versión que corre esta página (la pone vite al compilar; en los tests no hay). */
const VERSION_PAGINA = typeof __TRAMA_VERSION__ === "string" ? __TRAMA_VERSION__ : null;
/**
 * ¿La ventana ya estrenó la que se instaló? Al volver el motor, la ventana se pone al día sola (ventana-cliente.ts: recarga la
 * página o relanza el proceso): si esta página ya es esa versión, pedir «Reiniciar la ventana» sería un segundo reinicio de más.
 */
export const yaEstrenada = (instalada: string, pagina: string | null = VERSION_PAGINA) => pagina !== null && pagina === instalada;

/** Qué pasa con Actualizar en `AvisoClaude`. */
export type FaseAct =
  | { tipo: "nada" }
  | { tipo: "actualizando" }
  | { tipo: "hecho"; version: string; abiertos: number }
  | { tipo: "error"; texto: string }
  | { tipo: "esperando" }
  | { tipo: "instalada"; version: string }
  | { tipo: "reiniciando"; version: string }
  | { tipo: "reiniciado"; version: string; reiniciados: number; ocupados: number };

/**
 * Fase efectiva del aviso: en Trama manda el avance del main (`act`), salvo mientras un reintento local acaba de dispararse
 * (`fase.tipo === "actualizando"`) o falló antes de que el main cambiara de estado (`fase.tipo === "error"`), para que un
 * `act.fase === "error"` anterior no deje el botón de actualizar habilitado al reintentar.
 */
export const faseEfectiva = (trama: boolean, fase: FaseAct, act: EstadoActTrama, pagina: string | null = VERSION_PAGINA): FaseAct =>
  !trama
    ? fase
    : fase.tipo === "actualizando"
      ? fase
      : act.fase === "esperando"
        ? { tipo: "esperando" }
        : act.fase === "instalando"
          ? { tipo: "actualizando" }
          : act.fase === "hecho" && !yaEstrenada(act.version, pagina)
            ? { tipo: "instalada", version: act.version }
            : fase.tipo === "error"
              ? fase
              : act.fase === "error"
                ? { tipo: "error", texto: act.error }
                : fase;
