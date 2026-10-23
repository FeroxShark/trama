// "Retomar" (B22): el primer mensaje del líder nuevo que se hace cargo de una
// corrida que falló, se paró o quedó a medias. Va en español y en un solo lugar
// (el usuario lo pidió así: es una instrucción para Claude, no texto de la UI). Los
// datos los junta el main (electron/paneles.ts, `pasarALider`). Puro, con
// extensión en los imports: lo prueba `node --test` (tests/retomar.test.ts).
import { aDueno, Dueno, dueno } from "./dueno.ts";
import type { DatosPasar } from "../../electron/asistente.ts";

export type DatosRetomar = DatosPasar & {
  /** El estado de `pa --hilos` ("murio", "listo", "decision"…). */
  estado: string;
  /** Si el proyecto tiene `tests` en el registry (`--integrar --tests`). */
  tests: boolean;
};

/** "Atlas Web" va entre comillas en el comando; "atlas" no. */
export const arg = (s: string) => (/^[\w./-]+$/.test(s) ? s : `"${s.replace(/(["\\$`])/g, "\\$1")}"`);

const COMO: Record<string, string> = {
  murio: "murió: el proceso se cortó antes de terminar (no dejó respuesta final, o la dejó a medias)",
  colgado: "quedó trabado (sin avanzar)",
  trabajando: "figura trabajando",
  listo: "terminó",
  decision: "terminó pidiendo una decisión",
  entregado: "terminó y se entregó",
  archivado: "está archivada",
  descartado: "se descartó",
  revertido: "se integró y se revirtió",
};

/** Cómo terminó la corrida, en palabras. */
export const comoTermino = (estado: string) => COMO[estado] ?? estado;

const commits = (d: Pick<DatosPasar, "commits" | "tope">) =>
  typeof d.commits === "number"
    ? [`- Commits: ${d.commits}`]
    : [
        d.commits.length > d.tope ? `- Commits (más de ${d.tope}):` : `- Commits (${d.commits.length}):`,
        ...d.commits.slice(0, d.tope).map((c) => `  - ${c}`),
      ];

export function promptRetomar(d: DatosRetomar): string {
  const p = arg(d.proyecto);
  const donde = d.ruta ?? `la carpeta de ${d.proyecto}`;
  const integrar = `pa ${p} --integrar <id>${d.tests ? " --tests" : ""}`;
  return [
    `Retomá una corrida de \`pa\` que quedó sin cerrar. ${Dueno()} no quiere mergear a mano: hacete cargo vos.`,
    "",
    `- Proyecto: ${d.ruta ? `${d.proyecto} (${d.ruta})` : d.proyecto}`,
    `- Corrida: ${d.id} (la conversación entera: \`pa --hilo ${d.id} --json\`)`,
    ...(d.rama ? [`- Rama: ${d.rama}`, ...commits(d)] : ["- Sin rama"]),
    `- Cómo terminó: ${comoTermino(d.estado)}`,
    "",
    "La tarea que tenía:",
    d.tarea || "(no se sabe: leela con `pa --hilo`)",
    "",
    "Su RESULTADO:",
    d.resultado ?? "(no dejó RESULTADO)",
    "",
    "Su DECISION:",
    d.decision ?? "(ninguna)",
    "",
    "Qué hacer:",
    `1. Primero mirá la rama: qué hizo y qué falta. Con git (\`git -C ${donde} log --oneline HEAD..${d.rama ?? "<rama>"}\` y \`git -C ${donde} diff HEAD...${d.rama ?? "<rama>"}\`) o pidiéndoselo a un worker con \`pa ${p} --leer "…"\`.`,
    "2. Juzgá si vale la pena seguirla.",
    `3. Si vale: seguila con \`pa ${p} --seguir --id ${d.id} "<lo que falta>"\` (retoma su sesión y su rama) o lanzá un \`pa ${p} "<tarea>"\` nuevo encima, lo que convenga. Cuando quede bien, integrala con \`${integrar}\`.`,
    `4. Si no vale: recomendá descartarla (\`pa --descartar ${d.id}\`) y decí por qué, pero no la descartes sin que ${dueno()} diga que sí.`,
    "",
    `Contale ${aDueno()} en español y corto qué encontraste y qué hiciste.`,
  ].join("\n");
}
