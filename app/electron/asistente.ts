// Lo que lleva el primer mensaje del "asistente" de Ramas: un líder nuevo al que
// El usuario le pregunta si integrar o descartar una rama. El main junta los datos
// (id, proyecto, rama, commits, RESULTADO); el texto lo arma el renderer en el
// idioma elegido (src/datos/asistente.ts). También lo de "Pasárselo a un líder"
// (un worker sin líder que dejó una DECISION). Node puro, sin imports locales:
// lo prueba tests/asistente.test.ts.

export type DatosAsistente = {
  id: string;
  /** El nombre del registry: el que entiende `pa <proyecto>`. */
  proyecto: string;
  /** La carpeta del proyecto, para que el asistente corra git ahí; `null` si no está en el registry. */
  ruta: string | null;
  rama: string;
  /** Los commits (`git log --oneline`) o, si git no pudo, cuántos son. */
  commits: string[] | number;
  /** Cuántos commits como mucho se listan. */
  tope: number;
  tarea: string;
  resultado: string | null;
};

/** Hasta dónde llega la sección RESULTADO: el próximo encabezado del formato de los workers. */
const RESULTADO = /^[ \t]*(?:\*\*)?RESULTADO:?(?:\*\*)?:?[ \t]*/m;
const SIGUIENTE = /^[ \t]*(?:\*\*)?(?:ARCHIVOS|DECISION):?(?:\*\*)?:?/m;

/** La sección "RESULTADO:" de la respuesta de un worker, entera; `null` si no tiene. */
export function seccionResultado(texto: string): string | null {
  const m = texto.match(RESULTADO);
  if (!m || m.index === undefined) return null;
  const resto = texto.slice(m.index + m[0].length);
  const fin = resto.match(SIGUIENTE);
  return (fin?.index !== undefined ? resto.slice(0, fin.index) : resto).trim() || null;
}

/** El RESULTADO de la última respuesta de `pa --hilo <id> --json` (sin validar); `null` si no hay. */
export function resultadoDeConversacion(conv: unknown): string | null {
  const ms = (conv as { mensajes?: { rol?: unknown; texto?: unknown }[] })?.mensajes;
  if (!Array.isArray(ms)) return null;
  for (let i = ms.length - 1; i >= 0; i--) {
    const m = ms[i];
    if (m?.rol !== "assistant" || typeof m.texto !== "string") continue;
    const r = seccionResultado(m.texto);
    if (r) return r;
  }
  return null;
}

const DECISION = /^[ \t]*(?:\*\*)?DECISION:?(?:\*\*)?:?[ \t]*/gm;

/** La última sección "DECISION:" de una respuesta, entera (va al final); `null` si no tiene o dice "nada". */
export function seccionDecision(texto: string): string | null {
  let fin = -1;
  for (const m of texto.matchAll(DECISION)) fin = m.index + m[0].length;
  if (fin < 0) return null;
  const d = texto.slice(fin).trim();
  return d && !/^nada\.?$/i.test(d) ? d : null;
}

/** La DECISION de la última respuesta de `pa --hilo <id> --json` (sin validar); `null` si no hay. */
export function decisionDeConversacion(conv: unknown): string | null {
  const ms = (conv as { mensajes?: { rol?: unknown; texto?: unknown }[] })?.mensajes;
  if (!Array.isArray(ms)) return null;
  for (let i = ms.length - 1; i >= 0; i--) {
    const m = ms[i];
    if (m?.rol === "assistant" && typeof m.texto === "string") return seccionDecision(m.texto);
  }
  return null;
}

/** Lo de "Pasárselo a un líder": como el asistente, la rama puede no estar y va la DECISION entera. */
export type DatosPasar = Omit<DatosAsistente, "rama"> & { rama: string | null; decision: string | null };

/** Una rama sin integrar, para el analista de Ramas (B22); el texto lo arma src/datos/analista.ts. */
export type RamaBrief = {
  id: string;
  /** El nombre que entiende `pa`. */
  proyecto: string;
  ruta: string | null;
  rama: string;
  estado: string;
  tarea: string;
  /** Los de `pa --hilos` (recortados): el analista lee el entero con `pa --hilo`. */
  resultado: string | null;
  decision: string | null;
  /** `git log --oneline HEAD..rama`, o la cuenta de `pa` si git no pudo. */
  commits: string[] | number;
  /** `git diff --name-only HEAD...rama`; `null` si git no pudo. */
  archivos: string[] | null;
  /** Cuánto hace que terminó (s). */
  edad_s: number;
  /** Su líder: `null` si no tiene (lo lanzó la app o la terminal sin jefe). */
  lider_vivo: boolean | null;
};
