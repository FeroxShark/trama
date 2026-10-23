// La cuenta de "¿entra si libero esto?" para el aviso de un modelo local que no entra en la VRAM (LiberarVram.tsx). Pura, sin
// React ni Electron: la prueban los tests. Parte de la misma estimación que ya muestra el detalle (electron/locales-calc.ts) y le
// suma lo que devolvería el servicio; nada se mide de nuevo.
import { ctxQueEntra, MIB, type Estimacion } from "../../electron/locales-calc.ts";

/** Lo que le sobra a la KV con lo que corre ahora (sin guardar lugar para Handy / TTS): puede ser negativo. */
export const sobraKvMiB = (est: Pick<Estimacion, "presupuestoMiB" | "reservaMiB" | "modeloMiB">) =>
  est.presupuestoMiB + est.reservaMiB - est.modeloMiB;

/** Cuántos MiB faltan para que entre el `-c` pedido (0 si ya entra). */
export function faltaMiB(est: Pick<Estimacion, "presupuestoMiB" | "reservaMiB" | "modeloMiB" | "kvMiBPorK">, ctx: number): number {
  return Math.max(0, Math.ceil((est.kvMiBPorK * ctx) / 1000 - sobraKvMiB(est)));
}

export type Efecto = {
  /** El `-c` más grande que entraría liberándolo (0: ni el mínimo). */
  ctx: number;
  /** `entra`: el pedido entra entero; `menos`: entra pero con menos contexto; `no`: solo no alcanza. */
  veredicto: "entra" | "menos" | "no";
};

/** Qué pasaría con el contexto pedido si se libera un servicio que ocupa `miB`. */
export function efectoDeLiberar(
  est: Pick<Estimacion, "presupuestoMiB" | "reservaMiB" | "modeloMiB" | "kvMiBPorK">,
  info: { ctxMin: number; ctxMax: number; paso: number },
  miB: number,
  pedido: number,
): Efecto {
  const ctx = ctxQueEntra(sobraKvMiB(est) + miB, {
    pesosMiB: 0,
    fijoMiB: 0,
    kvBytesPorToken: (est.kvMiBPorK * MIB) / 1000,
    ctxMin: info.ctxMin,
    ctxMax: info.ctxMax,
    paso: info.paso,
  });
  const pedidoAbajo = Math.floor(pedido / info.paso) * info.paso;
  return { ctx, veredicto: ctx >= pedidoAbajo && ctx > 0 ? "entra" : ctx > 0 ? "menos" : "no" };
}
