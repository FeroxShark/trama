// "Trama volvió a la versión anterior", al pie de la barra, con las pastillas de los demás avisos: si una versión nueva no arrancó bien
// (se cerró sola dos veces seguidas o no llegó a abrir a tiempo) Trama volvió sola a la que andaba, y esto se lo cuenta a quien abre
// la ventana. Se lo pregunta al main una vez (se gasta al leerlo) y queda abierto hasta que se toca "Entendido". Sin nada que contar, no se ve.
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { fuente, type AvisoVuelta as Aviso } from "../datos/fuente";
import { useFoco } from "../foco";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";

const TEXTO = { cierres: "vuelta.cierres", lento: "vuelta.lento", manual: "vuelta.manual" } as const;

let cache: Aviso | null | undefined;
let enVuelo: Promise<Aviso | null> | null = null;

/**
 * Lee el aviso de rollback una sola vez y lo conserva en memoria mientras la ventana siga abierta
 * (si `Acople` desmonta y remonta la barra al angostar, no se pierde antes de que se toque «Entendido»).
 */
export function leerAvisoVuelta(pedir: () => Promise<Aviso | null> = () => fuente.avisoVuelta()): Promise<Aviso | null> {
  if (cache !== undefined) return Promise.resolve(cache);
  if (!enVuelo)
    enVuelo = pedir().then(
      (a) => ((cache = a), (enVuelo = null), a),
      () => ((enVuelo = null), null),
    );
  return enVuelo;
}

export function descartarAvisoVuelta(): void {
  cache = null;
  enVuelo = null;
}

export const AvisoVuelta = memo(function AvisoVuelta() {
  useIdioma();
  const [aviso, setAviso] = useState<Aviso | null>(cache ?? null);
  const [abierto, setAbierto] = useState(true);
  const globo = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let vivo = true;
    void leerAvisoVuelta().then((a) => vivo && setAviso(a));
    return () => void (vivo = false);
  }, []);
  const alCerrar = useCallback(() => setAbierto(false), []);
  useFoco(globo, { activo: abierto && !!aviso, alCerrar, devolver: () => boton.current });
  if (!aviso) return null;

  return (
    <div className="avc avs">
      <button ref={boton} type="button" className="avc-b" aria-haspopup="dialog" aria-expanded={abierto} onClick={() => setAbierto((x) => !x)}>
        <span className="avc-p" aria-hidden="true" />
        {t("vuelta.pastilla", { a: aviso.a })}
      </button>
      {abierto ? (
        <div ref={globo} className="avc-g" role="dialog" aria-label={t("vuelta.titulo")} tabIndex={-1}>
          <div className="avc-t">{t("vuelta.titulo")}</div>
          <div className="avc-n">{t(TEXTO[aviso.motivo], { de: aviso.de, a: aviso.a })}</div>
          <div className="avc-a">
            <button
              type="button"
              className="avc-u"
              onClick={() => {
                descartarAvisoVuelta();
                setAviso(null);
              }}
            >
              {t("vuelta.entendido")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
});
