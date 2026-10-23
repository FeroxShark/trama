// El analista de Ramas (B22): el brief que recibe (todas las ramas sin integrar)
// y el bloque de veredictos que contesta. En español y en un solo lugar, como
// el de Retomar: es una instrucción para Claude, no texto de la UI. Los datos
// los junta el main (electron/paneles.ts, `briefRamas`). Puro, con extensión
// en los imports: lo prueba `node --test` (tests/analista.test.ts).
import { Dueno, dueno } from "./dueno.ts";
import type { RamaBrief } from "../../electron/asistente.ts";
import { comoTermino } from "./retomar.ts";

export type Veredicto = "integrar" | "descartar" | "retomar" | "revisar";
export const VEREDICTOS: readonly Veredicto[] = ["integrar", "descartar", "retomar", "revisar"];
export type Juicio = { id: string; veredicto: Veredicto; motivo: string };

/** Cuántos commits y archivos por rama van en el brief (el resto, con git). */
const TOPE_COMMITS = 12;
const TOPE_ARCHIVOS = 15;

/** 90 → "2 min", 7200 → "2 h", 200000 → "2 d". */
export function edad(s: number): string {
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}

const lista = <T,>(xs: T[], tope: number, f: (x: T) => string) => [
  ...xs.slice(0, tope).map((x) => `    - ${f(x)}`),
  ...(xs.length > tope ? [`    - (y ${xs.length - tope} más)`] : []),
];

function rama(r: RamaBrief): string[] {
  const commits = typeof r.commits === "number" ? [`  - Commits: ${r.commits}`] : [`  - Commits (${r.commits.length}):`, ...lista(r.commits, TOPE_COMMITS, (c) => c)];
  const archivos = r.archivos === null ? [] : [`  - Archivos (${r.archivos.length}):`, ...lista(r.archivos, TOPE_ARCHIVOS, (a) => a)];
  return [
    `- id: ${r.id}`,
    `  - Proyecto: ${r.ruta ? `${r.proyecto} (${r.ruta})` : r.proyecto} · rama ${r.rama}`,
    `  - Tarea: ${r.tarea.replace(/\s+/g, " ").trim() || "(sin tarea)"}`,
    `  - Estado: ${r.estado} (${comoTermino(r.estado)}), hace ${edad(r.edad_s)}`,
    `  - Líder: ${r.lider_vivo === null ? "no tiene" : r.lider_vivo ? "vivo (la rama es suya)" : "ya no está"}`,
    `  - RESULTADO: ${r.resultado?.replace(/\s+/g, " ").trim() || "(no dejó)"}`,
    ...(r.decision ? [`  - DECISION: ${r.decision.replace(/\s+/g, " ").trim()}`] : []),
    ...commits,
    ...archivos,
  ];
}

const INICIO = "Sos el analista de las ramas de `pa` que todavía no están en main.";
const INICIO_ACTUALIZAR = "La lista de ramas cambió.";

export function promptAnalista(ramas: RamaBrief[]): string {
  return [
    `${INICIO} ${Dueno()} no mira diffs: decidí vos qué hacer con cada una.`,
    "",
    `Para cada rama mirá lo que haga falta: la conversación entera con \`pa --hilo <id> --json -n 6\` (RESULTADO y DECISION de abajo vienen recortados), los cambios con \`git -C <ruta> diff HEAD...<rama>\`. No integres, descartes ni lances nada: sólo juzgá. ${Dueno()} aprieta el botón.`,
    "",
    "Veredictos:",
    "- integrar: está bien y completa (se integra con los tests del proyecto).",
    "- descartar: no sirve, ya está hecha en otro lado o es vieja y no vale la pena.",
    "- retomar: sirve pero quedó a medias o falló; un líder nuevo la sigue.",
    `- revisar: no se puede decidir sin que ${dueno()} la mire (decí qué tiene que mirar).`,
    "",
    `Ramas (${ramas.length}):`,
    ...ramas.flatMap(rama),
    "",
    `Contestá en español y corto: primero un resumen para ${dueno()} (unas líneas), y al final un bloque así, con una entrada por rama:`,
    "",
    "```json",
    '[{"id": "<id>", "veredicto": "integrar|descartar|retomar|revisar", "motivo": "<una oración>"}]',
    "```",
    "",
    `Si ${dueno()} te pregunta algo después y cambiás de opinión, repetí el bloque entero con lo nuevo.`,
  ].join("\n");
}

/** El texto con que se le vuelve a pasar el brief (la lista cambió). */
export const promptActualizar = (ramas: RamaBrief[]) =>
  [`${INICIO_ACTUALIZAR} Volvé a juzgarlas todas, con el mismo formato (resumen corto y el bloque json al final).`, "", `Ramas (${ramas.length}):`, ...ramas.flatMap(rama)].join(
    "\n",
  );

/**
 * Los veredictos del último bloque ```json``` del texto que sea un array: las
 * entradas sin id conocido o con un veredicto raro se descartan (la última por
 * id gana). `null` si no hay bloque que sirva.
 */
export function veredictos(texto: string, ids: ReadonlySet<string>): Map<string, Juicio> | null {
  const bloques = [...texto.matchAll(/```(?:json)?[ \t]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  for (const b of bloques.reverse()) {
    let j: unknown;
    try {
      j = JSON.parse(b);
    } catch {
      continue;
    }
    if (!Array.isArray(j)) continue;
    const r = new Map<string, Juicio>();
    for (const x of j) {
      const id = typeof x?.id === "string" ? x.id.trim() : "";
      const v = typeof x?.veredicto === "string" ? x.veredicto.trim().toLowerCase() : "";
      if (!ids.has(id) || !VEREDICTOS.includes(v as Veredicto)) continue;
      r.set(id, { id, veredicto: v as Veredicto, motivo: typeof x.motivo === "string" ? x.motivo.trim() : "" });
    }
    return r;
  }
  return null;
}


/**
 * Lo que se ve en el chat del analista: los briefs son para él (no se muestran)
 * y el bloque ```json``` del final ya está como veredictos al lado de cada rama.
 */
export function paraVer<M extends { rol: string; texto: string }>(m: M): M | null {
  if (m.rol === "user") return m.texto.startsWith(INICIO) || m.texto.startsWith(INICIO_ACTUALIZAR) ? null : m;
  const texto = m.texto.replace(/\n*```json[ \t]*\n[\s\S]*?\n```\s*$/, "");
  return texto === m.texto ? m : { ...m, texto };
}
