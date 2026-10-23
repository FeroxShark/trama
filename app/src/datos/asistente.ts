// El primer mensaje de "Pasárselo a un líder" (un worker sin líder que dejó una
// DECISION), en el idioma elegido: id, proyecto, rama, commits, RESULTADO y la
// DECISION entera. Los datos los junta el main (electron/paneles.ts).
// Con extensión en el import: lo prueba `node --test` (tests/asistente.test.ts).
import { t } from "../i18n/index.ts";
import type { DatosAsistente, DatosPasar } from "../../electron/asistente.ts";

const listaCommits = (d: Pick<DatosAsistente, "commits" | "tope">) =>
  typeof d.commits === "number"
    ? [t("asis.commits", { n: d.commits })]
    : [
        d.commits.length > d.tope ? t("asis.commitsMas", { n: d.tope }) : t("asis.commitsLista", { n: d.commits.length }),
        ...d.commits.slice(0, d.tope).map((c) => `  - ${c}`),
      ];

const proyecto = (d: Pick<DatosAsistente, "proyecto" | "ruta">) => t("asis.proyecto", { v: d.ruta ? `${d.proyecto} (${d.ruta})` : d.proyecto });

/**
 * El primer mensaje del líder al que el usuario le pasa un worker sin líder que
 * quedó esperando una decisión: todo lo de la corrida, la DECISION entera y el
 * pedido de que se la explique y lo siga él.
 */
export function promptPasar(d: DatosPasar): string {
  return [
    t("pasar.intro"),
    "",
    t("pasar.id", { v: d.id }),
    proyecto(d),
    ...(d.rama ? [t("asis.rama", { v: d.rama }), ...listaCommits(d)] : [t("pasar.sinRama")]),
    ...(d.tarea ? [t("asis.tarea", { v: d.tarea })] : []),
    "",
    t("asis.resultado"),
    d.resultado ?? t("asis.sinResultado"),
    "",
    t("pasar.decision"),
    d.decision ?? t("pasar.sinDecision"),
    "",
    t("pasar.pedido"),
  ].join("\n");
}
