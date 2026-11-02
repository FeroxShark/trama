// La línea bajo el título de un worker en la cabecera (Vista.tsx): proyecto · modelo y esfuerzo · commits · archivos tocados.
// Lo que no se sabe no sale: un modelo que no está en la tabla no se muestra (ni su esfuerzo, que va con él), y los ceros se ocultan.
// Sin React: lo prueba `node --test`.
import { t } from "../i18n/index.ts";
import { defDe } from "./modelos.ts";

export type DatosCabeceraWorker = {
  /** El proyecto como se ve en la barra (ya con el nombre de su carpeta). */
  proyecto: string;
  modelo: string | null | undefined;
  effort: string | null | undefined;
  commits: number;
  archivos: number;
};

/** La línea, con los datos que haya, separados por " · ". */
export function lineaCabeceraWorker(d: DatosCabeceraWorker): string {
  const partes = [d.proyecto];
  // El nombre de la tabla ("Haiku 5.5"), no el id: el mismo que muestra el ⓘ de los detalles.
  const modelo = defDe(d.modelo);
  if (modelo) partes.push([modelo.nombre, d.effort].filter(Boolean).join(" "));
  if (d.commits > 0) partes.push(d.commits === 1 ? t("vista.meta.commit1") : t("vista.meta.commitN", { n: d.commits }));
  if (d.archivos > 0) partes.push(d.archivos === 1 ? t("vista.meta.archivo1") : t("vista.meta.archivoN", { n: d.archivos }));
  return partes.filter(Boolean).join(" · ");
}
