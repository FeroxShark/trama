// Tema de color, color de acento y armado del tema personalizado ("Mío") en Ajustes > General.
import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { elegirApariencia } from "../apariencia";
import { t, type ClaveSola } from "../i18n";
import {
  ACENTOS,
  BASE_TEMA_DEF,
  TEMA_MIO,
  TEMAS,
  contraste,
  derivarTema,
  normalizarHex,
  textoSobreAcento,
  type BaseTema,
} from "../temas";
import { alCambiarApariencia, apariencia } from "../tipografia";
import { Boton } from "../ui/componentes";
import { IcApariencia, IcAtencion, IcEditar, IcOk, ICONO } from "../ui/iconos";

type DatoProps = {
  nombre: ClaveSola;
  que: ClaveSola;
  icono?: ReactNode;
  children: ReactNode;
};

type CampoColor = keyof BaseTema;

const CAMPOS_MIO: { k: CampoColor; label: ClaveSola }[] = [
  { k: "fondo", label: "ajustes.temaMioFondo" },
  { k: "superficie", label: "ajustes.temaMioSuperficie" },
  { k: "texto", label: "ajustes.temaMioTexto" },
  { k: "acento", label: "ajustes.temaMioAcento" },
];

export function AjustesTema({ Dato }: { Dato: (p: DatoProps) => ReactNode }) {
  const a = useSyncExternalStore(alCambiarApariencia, apariencia);
  const acentoActivo = normalizarHex(a.acento);
  const esMuestraFija = acentoActivo !== null && ACENTOS.some((m) => m.hex === acentoActivo);
  const acentoEsPropio = acentoActivo !== null && !esMuestraFija;
  const valorColorPropio = acentoActivo ?? a.mio?.acento ?? BASE_TEMA_DEF.acento;

  const [borrador, setBorrador] = useState<BaseTema>(() => a.mio ?? BASE_TEMA_DEF);
  const [confirmaBorrar, setConfirmaBorrar] = useState(false);

  useEffect(() => {
    if (a.mio) setBorrador(a.mio);
  }, [a.mio]);

  const derivado = useMemo(() => derivarTema(borrador), [borrador]);
  const ratioMin = Math.min(
    contraste(borrador.texto, borrador.fondo),
    contraste(borrador.texto, borrador.superficie),
  );
  const contrasteBajo = ratioMin < 4.5;

  const actualizarCampo = (k: CampoColor, valor: string) => {
    const limpio = normalizarHex(valor);
    if (!limpio) return;
    setBorrador((prev) => ({ ...prev, [k]: limpio }));
  };

  return (
    <>
      <Dato nombre="ajustes.tema" que="ajustes.temaQue" icono={<IcApariencia {...ICONO} />}>
        <div className="pn-temas" role="radiogroup" aria-label={t("ajustes.tema")}>
          {TEMAS.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={id === a.tema}
              data-tema-id={id}
              onClick={() => elegirApariencia({ tema: id })}
            >
              {/* La muestra pinta con los tokens del tema de la propia muestra (temas-colores.css); "sistema" es mitad grafito, mitad claro. */}
              <span className="pn-muestra" aria-hidden="true">
                {id === "sistema" ? (
                  <>
                    <i data-tema="grafito" />
                    <i data-tema="claro" />
                  </>
                ) : (
                  <i data-tema={id} />
                )}
              </span>
              {t(`ajustes.tema.${id}`)}
            </button>
          ))}
          {a.mio ? (
            <button
              key={TEMA_MIO}
              type="button"
              role="radio"
              aria-checked={a.tema === TEMA_MIO}
              data-tema-id={TEMA_MIO}
              onClick={() => elegirApariencia({ tema: TEMA_MIO })}
            >
              <span className="pn-muestra" aria-hidden="true">
                <i
                  style={
                    {
                      "--fondo-ventana": a.mio.fondo,
                      "--sup-1": a.mio.superficie,
                      "--acento": a.mio.acento,
                    } as CSSProperties
                  }
                />
              </span>
              {t("ajustes.tema.mio")}
            </button>
          ) : null}
        </div>
      </Dato>

      <Dato nombre="ajustes.acento" que="ajustes.acentoQue" icono={<IcApariencia {...ICONO} />}>
        <div className="pn-acento" role="group" aria-label={t("ajustes.acento")}>
          <button
            type="button"
            className="pn-acento-tema"
            aria-pressed={acentoActivo === null}
            aria-label={t("ajustes.acentoTemaAria")}
            onClick={() => elegirApariencia({ acento: null })}
          >
            {acentoActivo === null ? <IcOk size={14} strokeWidth={2.3} aria-hidden="true" /> : null}
            {t("ajustes.acentoTema")}
          </button>
          {ACENTOS.map((m) => {
            const activo = acentoActivo === m.hex;
            return (
              <button
                key={m.id}
                type="button"
                className="pn-muestra-btn"
                aria-pressed={activo}
                aria-label={t(`ajustes.acento.${m.id}`)}
                title={t(`ajustes.acento.${m.id}`)}
                data-acento={m.id}
                style={
                  {
                    "--muestra": m.hex,
                    "--muestra-texto": textoSobreAcento(m.hex),
                  } as CSSProperties
                }
                onClick={() => elegirApariencia({ acento: m.hex })}
              >
                {activo ? <IcOk size={14} strokeWidth={2.5} aria-hidden="true" /> : null}
              </button>
            );
          })}
          <label className="pn-acento-propio" data-activo={acentoEsPropio ? "" : undefined}>
            <input
              type="color"
              value={valorColorPropio}
              aria-label={t("ajustes.acentoPropioAria")}
              onChange={(e) => elegirApariencia({ acento: e.target.value })}
            />
            <span>{t("ajustes.acentoPropio")}</span>
          </label>
        </div>
      </Dato>

      <Dato nombre="ajustes.temaMio" que="ajustes.temaMioQue" icono={<IcEditar {...ICONO} />}>
        <div className="pn-mio">
          <div className="pn-mio-cols">
            {CAMPOS_MIO.map((c) => (
              <label key={c.k} className="pn-mio-campo">
                <span className="pn-mio-etq">{t(c.label)}</span>
                <span className="pn-mio-ctrl">
                  <input
                    type="color"
                    value={borrador[c.k]}
                    aria-label={t(c.label)}
                    onChange={(e) => actualizarCampo(c.k, e.target.value)}
                  />
                  <code>{borrador[c.k]}</code>
                </span>
              </label>
            ))}
          </div>

          <div className="pn-mio-prev" style={derivado.vars as CSSProperties}>
            <div className="pn-mio-prev-sup">
              <div className="pn-mio-prev-txt">
                <strong>{t("ajustes.temaMioMuestra")}</strong>
                <span>{t("ajustes.temaMioMuestraSub")}</span>
              </div>
              <span className="pn-mio-prev-btn">{t("ajustes.temaMioMuestraBtn")}</span>
            </div>
          </div>

          {contrasteBajo ? (
            <div className="pn-mio-aviso" role="status">
              <IcAtencion {...ICONO} aria-hidden="true" />
              <span>{t("ajustes.temaMioContraste", { ratio: ratioMin.toFixed(1) })}</span>
            </div>
          ) : null}

          <div className="pn-mio-acc">
            <Boton
              primario
              onClick={() => {
                setConfirmaBorrar(false);
                elegirApariencia({ tema: TEMA_MIO, mio: borrador, acento: null });
              }}
            >
              {t("ajustes.temaMioGuardar")}
            </Boton>
            {a.mio ? (
              confirmaBorrar ? (
                <div className="pn-mio-conf">
                  <span>{t("ajustes.temaMioBorrarConf")}</span>
                  <Boton
                    onClick={() => {
                      setConfirmaBorrar(false);
                      elegirApariencia({ mio: null });
                    }}
                  >
                    {t("ajustes.temaMioBorrarSi")}
                  </Boton>
                  <Boton onClick={() => setConfirmaBorrar(false)}>{t("ajustes.temaMioCancelar")}</Boton>
                </div>
              ) : (
                <Boton onClick={() => setConfirmaBorrar(true)}>{t("ajustes.temaMioBorrar")}</Boton>
              )
            ) : null}
          </div>
        </div>
      </Dato>
    </>
  );
}
