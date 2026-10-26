// Los textos de los resúmenes de cupo (los números salen de cuposVista.ts): la barra y Ajustes dicen lo mismo con las mismas palabras.
import type { GrupoCupo } from "../datos/contrato";
import { t } from "../i18n/index.ts";
import { cuandoFuturo } from "../tiempo.ts";
import { nombreGrupo } from "./cuposNombres.ts";
import type { ResumenCupo, ResumenSusc } from "./cuposVista";

/** "OK", "Running low", "Exhausted until Thu 01:01", "Marked out of quota until Thu 01:01". */
export function textoEstado(r: ResumenCupo, ahoraS = Date.now() / 1000): string {
  switch (r.estado) {
    case "ok":
      return t("cu.st.ok");
    case "bajo":
      return t("cu.st.bajo");
    case "sin":
      return t("cu.st.sin");
    case "lleno":
      return r.vuelve !== null ? t("cu.st.lleno", { cuando: cuandoFuturo(r.vuelve, ahoraS) }) : t("cu.st.llenoSin");
    case "marcado":
      return r.vuelve !== null ? t("cu.st.marcado", { cuando: cuandoFuturo(r.vuelve, ahoraS) }) : t("cu.st.marcadoSin");
  }
}

/** La línea de arriba de la tarjeta de una suscripción. Con algún grupo agotado y otros no, dice cuáles. */
export function textoSusc(r: ResumenSusc, grupos: readonly GrupoCupo[] | undefined, ahoraS = Date.now() / 1000): string {
  if (r.nivel === "ok") return t("cu.st.ok");
  if (r.nivel === "bajo") return t("cu.st.bajo");
  if (r.nivel === "sin") return t("cu.st.sin");
  if (r.nivel === "lleno") return r.vuelve !== null ? t("cu.st.lleno", { cuando: cuandoFuturo(r.vuelve, ahoraS) }) : t("cu.st.llenoSin");
  const nombres = r.agotados.map((a) => grupos?.find((g) => g.id === a.id)).filter((g): g is GrupoCupo => !!g).map(nombreGrupo).join(", ");
  return r.vuelve !== null ? t("cu.st.parcial", { grupos: nombres, cuando: cuandoFuturo(r.vuelve, ahoraS) }) : t("cu.st.parcialSin", { grupos: nombres });
}
