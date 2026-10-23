// "Mandar a verificar y arreglar" (B25): el primer mensaje del líder nuevo que
// se hace cargo de una integración que rompió algo. Va en español y en un solo
// lugar (como retomar.ts: es una instrucción para Claude, no texto de la UI).
// Los datos los junta el main (electron/paneles.ts, `arreglarDatos`). Puro, con
// extensión en los imports: lo prueba `node --test` (tests/arreglar.test.ts).
import { aDueno, Dueno } from "./dueno.ts";
import { arg } from "./retomar.ts";
import type { Motivo } from "./salud.ts";

export type DatosArreglar = {
  /** El id de la integración (el de la corrida de `pa`). */
  id: string;
  /** El nombre del registry (lo que entiende `pa <proyecto>`). */
  proyecto: string;
  ruta: string | null;
  rama: string | null;
  /** main antes y después de integrar (`integradas.tsv`); `null` si `pa` no la anotó. */
  head_antes: string | null;
  head_despues: string | null;
  /** `git log --oneline head_antes..head_despues`, o `null` si no se pudo. */
  commits: string[] | null;
  tope: number;
  motivo: Motivo;
  /** Los `tests` del registry. */
  tests: string | null;
  /** La cola de la salida de los tests rojos sobre main, si se corrieron. */
  cola: string | null;
  rc: number | null;
};

const POR_QUE: Record<Motivo, string> = {
  tests: "después de integrarla, los tests del proyecto dan rojo en main",
  revertida: "se integró y después se revirtió (`pa --revertir`)",
  bien_no: "su corrida quedó anotada como que salió mal (`bien=no` en medicion.tsv)",
};

const corto = (h: string | null) => (h ? h.slice(0, 12) : null);

export function promptArreglar(d: DatosArreglar): string {
  const p = arg(d.proyecto);
  const git = d.ruta ? `git -C ${d.ruta}` : "git";
  const enDonde = d.ruta ? "" : ` en la carpeta de ${d.proyecto}`;
  const rango = d.head_antes && d.head_despues ? `${corto(d.head_antes)}..${corto(d.head_despues)}` : null;
  const commits = d.commits
    ? [
        d.commits.length > d.tope ? `- Commits (más de ${d.tope}):` : `- Commits (${d.commits.length}):`,
        ...d.commits.slice(0, d.tope).map((c) => `  - ${c}`),
      ]
    : [];
  return [
    `Una integración a main rompió algo. Verificá qué pasó y arreglalo. ${Dueno()} no mira diffs: hacete cargo vos.`,
    "",
    `- Proyecto: ${d.ruta ? `${d.proyecto} (${d.ruta})` : d.proyecto}`,
    `- Integración: ${d.id} (la conversación del worker: \`pa --hilo ${d.id} --json\`)`,
    d.rama ? `- Rama: ${d.rama}` : "- Rama: (no se sabe)",
    rango ? `- Commits que entraron a main: ${rango}` : "- Commits que entraron a main: (pa no los anotó; buscalos con git log)",
    ...commits,
    `- Por qué está en rojo: ${POR_QUE[d.motivo]}`,
    ...(d.tests ? [`- Tests del proyecto: \`${d.tests}\``] : []),
    "",
    ...(d.cola
      ? [`Lo último que dijeron los tests sobre main${d.rc != null ? ` (rc ${d.rc})` : ""}:`, "```", d.cola, "```", ""]
      : []),
    "Qué hacer:",
    `1. Encontrá qué se rompió: mirá los commits (${rango ? `\`${git} log -p ${rango}\`` : `\`${git} log\``}${enDonde})${d.tests ? ` y corré los tests en main (\`${d.tests}\`)` : ""}. Puede que el rojo no sea culpa de esta integración: si es así, decilo.`,
    `2. Arreglalo con un worker de \`pa\`: \`pa ${p} "<qué arreglar y por qué>"\`, y cuando quede bien, integralo con \`pa ${p} --integrar <id>${d.tests ? " --tests" : ""}\`.`,
    `3. Si arreglarlo es peor que deshacerlo, revertí la integración: \`pa --revertir ${d.id}\` (deja la historia, no fuerza nada).`,
    "",
    `Contale ${aDueno()} en español y corto qué encontraste y qué hiciste.`,
  ].join("\n");
}
