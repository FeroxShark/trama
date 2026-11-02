// El título de un worker en la barra: no el brief entero sino su objetivo. De la línea «Objetivo:» (sin el rótulo); sin ella, la
// primera línea que no sea «Contexto:» ni un encabezado de reglas («Seguí AGENTS.md…»). Recortado a ~60 caracteres en una palabra entera. El brief completo sigue en `h.tarea` (la
// vista del worker lo muestra). Lo prueba `tests/titulo-tarea.test.ts`. Sin imports: lo usan la barra (`src/barra/Barra.tsx`) y los avisos (`tareaCorta`, avisos-worker.ts).

export const TITULO_TAREA_MAX = 60;

/** Los rótulos de un brief (Objetivo / Archivos / Listo cuando / Cómo verificar / No tocar, y Contexto). */
const ROTULO = "(?:objetivo|goal|contexto|context|archivos|files|listo\\s+cuando|done\\s+when|c[oó]mo\\s+verificar|how\\s+to\\s+verify|no\\s+tocar|do\\s+not\\s+touch)";
const OBJETIVO = new RegExp(`(?:^|\\n|\\s)(?:objetivo|goal)\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*${ROTULO}\\s*:|\\s${ROTULO}\\s*:|$)`, "i");
const ES_CONTEXTO = /^\s*(?:\[[^\]]*\]\s*)?(?:contexto|context)\s*:/i;

/**
 * Una línea de reglas: el encabezado que el jefe le pone a casi todos los briefs («Seguí AGENTS.md (…). Usá ui-ux-pro-max y taste-skill.
 * Respetá app/src/barra/CONVENCIONES.md.»). No dice qué hace el worker: no sirve de título. Lo es si TODAS sus oraciones mandan seguir
 * un documento o una skill (verbo de mandato + AGENTS.md, CLAUDE.md, CONVENCIONES, una skill…), o si trae el rótulo «Reglas:».
 */
const ROTULO_REGLAS = /^\s*(?:reglas|rules)(?:\s+del\s+proyecto)?\s*:/i;
const MANDATO = /^\s*(?:segu[ií]|sigue|follow|us[aá]|use|respet[aá]|respect|le[eé]|read|carg[aá]|load|apliqu?[eé]|apply|cumpl[ií]|tené en cuenta|recordá|obedec[eé])(?![\p{L}])/iu;
const DOCUMENTO = /agents\.md|claude\.md|convenciones|skills?\b|ui-ux-pro-max|taste-skill|frontend-design|tokens\.css|\bi18n\b|docs?\//i;
const esReglas = (linea: string): boolean => {
  if (ROTULO_REGLAS.test(linea)) return true;
  // Oraciones: se corta en «. » sin romper rutas ni «AGENTS.md»: el punto debe ir seguido de espacio y mayúscula.
  const oraciones = linea.trim().split(/(?<=[.;])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/).filter(Boolean);
  return oraciones.length > 0 && oraciones.every((o) => MANDATO.test(o) && DOCUMENTO.test(o));
};

const corto = (s: string, tope: number) => {
  const l = s.replace(/\s+/g, " ").trim();
  if (l.length <= tope) return l;
  const corte = l.slice(0, tope - 1);
  const i = corte.lastIndexOf(" ");
  return `${(i > tope / 2 ? corte.slice(0, i) : corte).replace(/[\s,;:.-]+$/u, "")}…`;
};

/** Cómo se llama un worker en la barra, de su tarea (brief o texto suelto). "" si no hay nada que decir. */
export function tituloTarea(tarea: string | null | undefined, tope = TITULO_TAREA_MAX): string {
  const t = (tarea ?? "").trim();
  if (!t) return "";
  const o = OBJETIVO.exec(t)?.[1]?.replace(/\s+/g, " ").trim();
  if (o) return corto(o, tope);
  for (const linea of t.split("\n")) {
    const l = linea.replace(/^\s*(\[[^\]]*\]\s*)?/, "").trim();
    if (l && !ES_CONTEXTO.test(linea) && !esReglas(l)) return corto(l, tope);
  }
  // Todo era «Contexto:» o reglas: mejor ese texto que nada.
  return corto(t.replace(ES_CONTEXTO, ""), tope);
}
