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
  /** Dónde escribe su salida el harness ("Output is being written to: <ruta>"); `null` si el resultado no la nombra (un Agent, un mensaje cortado). */
  salida: string | null;
};

/** Lo que devuelve el canal `tarea:salida`: las últimas líneas ya sin ANSI y si el archivo seguía más arriba. */
export type SalidaTarea = { texto: string; recortado: boolean };

/** Valida lo que cruzó el canal (llega sin tipar; por la tailnet, de otra máquina): `null` si no es una salida. */
export function salidaDe(x: unknown): SalidaTarea | null {
  const o = x as Record<string, unknown> | null;
  return o && typeof o === "object" && typeof o.texto === "string" ? { texto: o.texto, recortado: o.recortado === true } : null;
}

// Sólo la primera línea: un comando en primer plano puede imprimir esta misma frase (por ejemplo, al leer un transcript) y no por eso quedó de fondo.
const ID_BASH = /^[^\n]*?(?:running in background with ID|moved to the background \(ID): ?([\w-]+)/;
// La ruta puede llevar espacios (el temporal de un usuario de Windows): se corta en el `.output`.
const RUTA_SALIDA = /Output is being written to: ?(\S.*?\.output)(?=$|[\s"'`)\]]|\.(?:\s|$))/;
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
      const salida = bash ? (RUTA_SALIDA.exec(r.texto)?.[1] ?? null) : null;
      abiertas.set(id, { id, que: texto(h.entrada.description) || comando || id, comando, desde: Number.isNaN(desde) ? null : desde, salida });
    }
    // Después de sus herramientas: un cierre de este mismo mensaje sólo puede ser de algo lanzado antes.
    for (const id of m.cierres ?? []) abiertas.delete(id);
  }
  return [...abiertas.values()];
}
