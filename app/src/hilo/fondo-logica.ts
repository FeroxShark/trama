// Lo que el líder dejó corriendo de fondo y todavía no avisó que terminó: un Bash o un Agent lanzado en segundo plano (o un Bash que pasó
// solo a segundo plano por tardar) se abre con el id que dice su resultado y se cierra con el `<task-notification>` de ese id o un TaskStop.
// Sale de los mensajes del transcript, sin canales nuevos. Claude Code no da un porcentaje: se sabe qué corre y desde cuándo. Puro: lo prueba
// `tests/fondo-logica.test.ts`.
import type { Mensaje } from "../datos/contrato";

export type TareaFondo = {
  id: string;
  /** La descripción que le puso el modelo o, si no hay, el comando. */
  que: string;
  /** El comando de un Bash; `null` en un Agent. */
  comando: string | null;
  /** Epoch ms de cuándo se lanzó; `null` si el mensaje no lo dice. */
  desde: number | null;
};

const ID_BASH = /(?:running in background with ID|moved to the background \(ID): ?([\w-]+)/;
const ID_AGENT = /\bagentId: ?([\w-]+)/;
const CIERRE = /<task-id>\s*([^<\s]+)\s*<\/task-id>/g;

/** ¿Lo que devolvió la llamada es sólo el acuse de que quedó corriendo? No es que haya terminado. */
export const esAcuseFondo = (x: string): boolean => ID_BASH.test(x) || ID_AGENT.test(x);

const texto = (x: unknown): string => (typeof x === "string" ? x.trim() : "");

export function tareasDeFondo(mensajes: readonly Mensaje[]): TareaFondo[] {
  const abiertas = new Map<string, TareaFondo>();
  for (const m of mensajes) {
    if (m.rol === "user" && m.texto.includes("<task-notification>") && m.origen !== "human") for (const c of m.texto.matchAll(CIERRE)) abiertas.delete(c[1]);
    for (const h of m.det ?? []) {
      if (h.nombre === "TaskStop" || h.nombre === "KillShell") {
        const id = texto(h.entrada.task_id) || texto(h.entrada.shell_id);
        if (id && h.resultado && !h.resultado.error) abiertas.delete(id);
        continue;
      }
      const r = h.resultado;
      if (!r || r.error) continue;
      const bash = h.nombre === "Bash";
      if (!bash && !(h.nombre === "Agent" || h.nombre === "Task")) continue;
      if (!bash && h.entrada.run_in_background !== true) continue;
      const id = (bash ? ID_BASH : ID_AGENT).exec(r.texto)?.[1];
      if (!id) continue;
      const comando = bash ? texto(h.entrada.command) : null;
      const desde = m.ts ? Date.parse(m.ts) : NaN;
      abiertas.set(id, { id, que: texto(h.entrada.description) || comando || id, comando, desde: Number.isNaN(desde) ? null : desde });
    }
  }
  return [...abiertas.values()];
}
