// Las líneas de un diff, de un archivo escrito o de uno leído, con su número y el resaltado de su lenguaje (la vista de worker).
import { memo, useMemo } from "react";
import { t } from "../i18n";
import { resaltar } from "./resaltar";
import type { FilaDiff } from "./worker-datos";

/** Más filas que esto no se pintan: un archivo de miles de líneas trabaría la vista (el resto se dice en una línea). */
const TOPE_FILAS = 1500;

/** `marca`: la línea que se abrió desde un resultado (se resalta). */
export const Filas = memo(function Filas({ filas, lang, marca }: { filas: readonly FilaDiff[]; lang: string; marca?: number | null }) {
  const filasVistas = useMemo(
    () =>
      filas.slice(0, TOPE_FILAS).map((f, i) => (
        <div className="df-f" data-t={f.t === " " ? undefined : f.t} data-marca={marca != null && f.b === marca ? "" : undefined} key={i}>
          <span className="df-n">{(f.t === "-" ? f.a : f.b) ?? ""}</span>
          <span className="df-s" aria-hidden="true">{f.t === " " ? "" : f.t}</span>
          <span className="df-x">{resaltar(f.x, lang).map((k, j) => (k.c ? <span key={j} data-c={k.c}>{k.t}</span> : k.t))}</span>
        </div>
      )),
    [filas, lang, marca],
  );
  return (
    <div className="df codigo">
      {filasVistas}
      {filas.length > TOPE_FILAS ? <div className="wk-nota">{t("wk.masFilas", { n: filas.length - TOPE_FILAS })}</div> : null}
    </div>
  );
});
