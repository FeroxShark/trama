// «Revisar con otro modelo», la lógica de la ventana sin React (la prueba tests/revision-vista.test.ts): el reloj de la revisión,
// la clave de texto de cada paso y cuándo una revisión sigue viva. Lo dibuja `RevisionVista.tsx`; el estado viene del main
// (electron/revision-trabajo.ts) por el evento `revision` del líder y vive en `revision-vivo.ts`.
import type { PasoRevision, RevisionEstado } from "../../electron/revision-plan-texto.ts";

/** «45 s», «1 m 20 s», «12 m 05 s»: lo que lleva trabajando el revisor. */
export function tiempoCorrido(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} m ${String(s % 60).padStart(2, "0")} s`;
}

/** Cuánto lleva una revisión: hasta ahora si sigue, hasta que terminó si no. */
export const duracionRevision = (e: Pick<RevisionEstado, "inicio" | "fin">, ahora: number): number => (e.fin ?? ahora) - e.inicio;

/** La clave de i18n del texto de un paso. */
export const clavePaso = (p: PasoRevision) => (p.k === "leer" ? "revision.pasoLeer" : p.k === "buscar" ? "revision.pasoBuscar" : p.k === "listar" ? "revision.pasoListar" : "revision.pasoOtro");

/** ¿Sigue trabajando (el revisor o la entrega)? Mientras sí, no se puede lanzar otra revisión en ese chat. */
export const revisionViva = (e: Pick<RevisionEstado, "fase"> | null | undefined): boolean => e?.fase === "corriendo" || e?.fase === "entregando";
