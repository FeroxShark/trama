// El modo debate, la lógica de la ventana sin React (la prueba tests/debate-vista.test.ts): cuándo un debate sigue vivo, qué botones
// corresponden a cada fase, quién habla ahora, cuánto lleva y cuántas llamadas puede costar. Lo dibuja `TarjetaDebate.tsx`; el estado
// viene del main (electron/debate-trabajo.ts) por el evento `debate:turno` y vive en `debate-vivo.ts`.
import type { EstadoDebate, FaseDebate, MotivoDebate, ParticipanteVisto } from "../../electron/debate-texto.ts";

/** ¿Sigue trabajando (los modelos, la conclusión o la entrega)? Mientras sí, no se puede lanzar otra revisión ni otro debate en ese chat. */
export const debateVivo = (e: Pick<EstadoDebate, "fase"> | null | undefined): boolean =>
  e?.fase === "corriendo" || e?.fase === "esperando" || e?.fase === "concluyendo" || e?.fase === "entregando";

/** Qué botones ofrece cada fase: «Cortar y concluir» sólo mientras se debate; «Cancelar» hasta que empieza la entrega (después ya no se puede). */
export function accionesDebate(fase: FaseDebate): { cortar: boolean; cancelar: boolean; ver: boolean; cerrar: boolean } {
  const debatiendo = fase === "corriendo" || fase === "esperando";
  return { cortar: debatiendo, cancelar: debatiendo || fase === "concluyendo", ver: fase === "hecho", cerrar: !debateVivo({ fase }) };
}

/** Cuánto lleva el debate: hasta ahora si sigue, hasta que terminó si no. */
export const duracionDebate = (e: Pick<EstadoDebate, "inicio" | "fin">, ahora: number): number => Math.max(0, (e.fin ?? ahora) - e.inicio);

/** Quién habla ahora: el primero de los que siguen que todavía no habló en esta ronda (`null`: nadie, o se está concluyendo). */
export function quienHabla(e: Pick<EstadoDebate, "fase" | "ronda" | "participantes">): ParticipanteVisto | null {
  if (e.fase !== "corriendo" || e.ronda < 1) return null;
  return e.participantes.find((p) => p.activo && p.turnos < e.ronda) ?? null;
}

/** El peor caso en llamadas a modelos: cada uno habla una vez por ronda (tope 3) y uno concluye. */
export const peorCasoLlamadas = (modelos: number, rondas: number): number => modelos * Math.min(3, rondas) + 1;

/** Cuánto falta para que la pregunta pendiente siga sin respuesta, en minutos (redondeado hacia arriba, nunca menos de 1). */
export const minutosQueFaltan = (hasta: number, ahora: number): number => Math.max(1, Math.ceil((hasta - ahora) / 60_000));

/** La clave de i18n de la frase que cuenta por qué terminó el debate. */
export const claveMotivo = (m: MotivoDebate | null): string => `debate.motivo.${m ?? "tope"}`;
