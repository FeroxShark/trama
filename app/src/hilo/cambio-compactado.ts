// Lógica pura de «Compactar y cambiar» en la caja del líder (sin React ni Node: lo prueba tests/cambio-compactado.test.ts).
// El destino (modelo + esfuerzo) vive en este estado propio para sobrevivir cuando el líder pasa a ocupado o vence el caché.
import { esClaudeOficial } from "../../electron/esfuerzo-extras.ts";
import { esAgy, esLocal } from "./modelos.ts";

/** Cuántos segundos se espera a que el líder empiece a compactar antes de darlo por vencido. */
export const ESPERA_COMPACTAR_S = 30;

/** El modelo y esfuerzo que la persona había elegido antes de pedir «Compactar y cambiar». */
export type DestinoCambio = { modelo: string; effort: string };

export type EstadoCambioCompactado =
  | { fase: "reposo" }
  | { fase: "compactando"; destino: DestinoCambio; enviando: boolean; vioInicio: boolean }
  | { fase: "hecho"; destino: DestinoCambio }
  | { fase: "error"; destino: DestinoCambio; motivo: string }
  | { fase: "vencido"; destino: DestinoCambio };

export type EventoCambioCompactado =
  | { tipo: "iniciar"; destino: DestinoCambio }
  | { tipo: "enviado" }
  | { tipo: "empezo" }
  | { tipo: "compacto" }
  | { tipo: "fallo"; motivo: string }
  | { tipo: "vencio" }
  | { tipo: "reiniciar" };

export const REPOSO: EstadoCambioCompactado = { fase: "reposo" };

/**
 * Sólo Claude oficial y Gemini (`agy`) entienden `/compact` en la sesión (como PROPIOS y PROPIOS_AGY de comandos.ts).
 * Codex, DeepSeek, OpenCode y los modelos locales (Ollama / llama-server) sólo ofrecen «Volver».
 */
export const soportaCompactar = (modelo: string | null | undefined): boolean =>
  (esClaudeOficial(modelo) && !esLocal(modelo)) || esAgy(modelo);

/** Transición pura de la máquina de estados de «Compactar y cambiar». */
export function siguienteCambio(estado: EstadoCambioCompactado, ev: EventoCambioCompactado): EstadoCambioCompactado {
  if (ev.tipo === "reiniciar") return REPOSO;
  if (ev.tipo === "iniciar") return { fase: "compactando", destino: ev.destino, enviando: true, vioInicio: false };
  if (estado.fase !== "compactando") return estado;
  switch (ev.tipo) {
    case "enviado":
      return { ...estado, enviando: false };
    case "empezo":
      return estado.vioInicio ? estado : { ...estado, vioInicio: true };
    case "compacto":
      return { fase: "hecho", destino: estado.destino };
    case "fallo":
      return { fase: "error", destino: estado.destino, motivo: ev.motivo };
    case "vencio":
      return !estado.enviando && !estado.vioInicio ? { fase: "vencido", destino: estado.destino } : estado;
  }
}

/** ¿Corresponde correr el reloj de tiempo límite esperando a que empiece a compactar? */
export const debeEsperarInicio = (estado: EstadoCambioCompactado): boolean =>
  estado.fase === "compactando" && !estado.enviando && !estado.vioInicio;

/** El destino a aplicar una vez completada la compactación; `null` en cualquier otro estado (error/vencido nunca cambian solos). */
export const destinoAplicar = (estado: EstadoCambioCompactado): DestinoCambio | null =>
  estado.fase === "hecho" ? estado.destino : null;

export type SenalCompactado = {
  /** Hook de Claude (`useCompactando`) o evento del stream (`hace.que === "compactando"`). */
  compactandoAhora: boolean;
  /** Cantidad acumulada de cierres de turno (`vivo.fines`) vs la base al iniciar. */
  fines: number;
  finesBase: number;
  /** Cantidad de avisos `compacto` en el stream vs la base al iniciar. */
  compactos: number;
  compactosBase: number;
  /** Estado del último turno cerrado (`vivo.fin?.estado`). */
  finEstado: "listo" | "parado" | "error" | null;
  /** Texto del error del turno si `finEstado === "error"`. */
  errorTexto: string | null;
};

/**
 * Decide qué evento corresponde según el avance de la compactación (sirve igual para Claude con hook/stream y Gemini por stream).
 * Un `motivo` vacío en `fallo` lo completa la vista con el mensaje traducido según `finEstado`.
 */
export function evaluarProgreso(estado: EstadoCambioCompactado, s: SenalCompactado): EventoCambioCompactado | null {
  if (estado.fase !== "compactando") return null;
  if (s.fines > s.finesBase) {
    if (s.finEstado === "error") return { tipo: "fallo", motivo: s.errorTexto ?? "" };
    if (s.finEstado === "parado") return { tipo: "fallo", motivo: "" };
    if (s.compactos > s.compactosBase) return { tipo: "compacto" };
    if (estado.vioInicio && !s.compactandoAhora) return { tipo: "compacto" };
    if (!estado.vioInicio && !s.compactandoAhora) return { tipo: "fallo", motivo: "" };
  }
  if (s.compactandoAhora && !estado.vioInicio) return { tipo: "empezo" };
  return null;
}
