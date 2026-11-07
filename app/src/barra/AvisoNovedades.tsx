// «Novedades de la vX.Y.Z», al pie de la barra: la misma pastilla que los demás avisos (un punto y una línea) que, tras arrancar con
// una versión nueva, abre un globito con las viñetas de esa versión (y de las intermedias si saltó varias) del CHANGELOG.md del
// build. «Listo» lo cierra para siempre (guarda la versión en preferencias.json: ventana y celular comparten); Esc o un clic afuera
// sólo pliegan el globito. Sin toasts ni sonidos y sin abrirse solo: es un aviso mínimo. En la primera instalación no aparece.
// La regla de qué mostrar es pura (`versionesAMostrar`, electron/novedades-cambios.ts); los textos del historial, en Ajustes.
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { fuente } from "../datos/fuente";
import { parsearCambios, versionesAMostrar, type Entrada } from "../../electron/novedades-cambios";
import { useFoco } from "../foco";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import { Vinetas } from "../ui/Vinetas";
import "./novedades.css";

export const AvisoNovedades = memo(function AvisoNovedades() {
  const id = useIdioma();
  const [estado, setEstado] = useState<{ version: string; entradas: Entrada[] } | null>(null);
  const [abierto, setAbierto] = useState(MODO.captura === "novedades");
  const caja = useRef<HTMLDivElement>(null);
  const globo = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let vivo = true;
    void fuente.novedades(id).then((n) => {
      if (!vivo || !n.actual) return;
      const entradas = versionesAMostrar(parsearCambios(n.texto), n.vista, n.actual);
      if (entradas.length > 0) setEstado({ version: n.actual, entradas });
    });
    return () => {
      vivo = false;
    };
  }, [id]);

  const alCerrar = useCallback(() => setAbierto(false), []);
  useFoco(globo, { activo: abierto, alCerrar, devolver: () => boton.current });
  useEffect(() => {
    if (!abierto) return;
    const afuera = (e: PointerEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false);
    };
    addEventListener("pointerdown", afuera, true);
    return () => removeEventListener("pointerdown", afuera, true);
  }, [abierto]);

  if (!estado) return null;
  const { version, entradas } = estado;
  const listo = () => {
    fuente.cerrarNovedades(version);
    setAbierto(false);
    setEstado(null);
  };

  return (
    <div className="avc avn" ref={caja}>
      <button ref={boton} type="button" className="avc-b" aria-haspopup="dialog" aria-expanded={abierto} onClick={() => setAbierto((x) => !x)}>
        <span className="avc-p" aria-hidden="true" />
        {t("nov.disponible", { v: version })}
      </button>
      {abierto ? (
        <div ref={globo} className="avc-g avn-g" role="dialog" aria-label={t("nov.disponible", { v: version })} tabIndex={-1}>
          <div className="avc-t">{t("nov.disponible", { v: version })}</div>
          <div className="avn-cuerpo">
            {entradas.map((e) => (
              <section key={e.version} className="avn-ver">
                {entradas.length > 1 ? <h3 className="avn-v">v{e.version}</h3> : null}
                <Vinetas items={e.items} />
              </section>
            ))}
          </div>
          <div className="avc-a">
            <button type="button" className="avc-u" onClick={listo}>
              {t("nov.listo")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
});
