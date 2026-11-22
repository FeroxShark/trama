// «Revisar con IA» en la vista previa del panel de contexto: un modelo barato lee lo que se carga en cada mensaje del proyecto elegido y marca lo
// repetido, contradictorio, viejo o largo. Acá se ven los hallazgos por archivo, con el antes y el después, y se aplican de a uno, por archivo o
// todos. Nada se escribe sin el botón (el main guarda una copia antes). La lógica de agrupar y contar: contexto-auditoria.ts; los datos: datos/contexto.ts.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowLeftRight, Check, CircleAlert, Copy, Hourglass, LoaderCircle, Ruler, Sparkles } from "lucide-react";
import type { Auditoria, Hallazgo, TipoHallazgo } from "../../electron/auditoria-contexto-texto";
import { fuenteContexto } from "../datos/contexto";
import { MODELOS, nombreModelo } from "../hilo/opciones";
import { mensaje } from "../puente";
import { locale, t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { agrupar, carpetaCorta, enCurso, pendientesDe, recortar, resumenArchivos, totales, vistaDe, type GrupoArchivo } from "./contexto-auditoria";

const miles = (n: number) => n.toLocaleString(locale());
const SONDEO_MS = 1500;

/** Cada tipo con su ícono: el color acompaña, nunca es lo único que lo distingue (siempre va la palabra). */
const ICONO_TIPO: Record<TipoHallazgo, typeof Copy> = { duplicado: Copy, contradiccion: ArrowLeftRight, viejo: Hourglass, largo: Ruler };

function Tipo({ tipo }: { tipo: TipoHallazgo }) {
  const Icono = ICONO_TIPO[tipo];
  return (
    <span className="cp-au-tipo" data-tipo={tipo} data-tip={t(`ctxp.aud.tipoAyuda.${tipo}` as "ctxp.aud.tipoAyuda.largo")}>
      <Icono size={13} strokeWidth={2} aria-hidden />
      {t(`ctxp.aud.tipo.${tipo}` as "ctxp.aud.tipo.largo")}
    </span>
  );
}

function FilaHallazgo({ h, puede, ocupado, alAplicar }: { h: Hallazgo; puede: boolean; ocupado: boolean; alAplicar: () => void }) {
  return (
    <li className="cp-au-h" data-estado={h.estado} data-tipo={h.tipo}>
      <div className="cp-au-h-cab">
        <Tipo tipo={h.tipo} />
        <span className="cp-au-ahorro cp-num">{t("ctxp.aud.ahorro", { n: miles(h.ahorro) })}</span>
      </div>
      <p className="cp-au-razon">{h.razon}</p>
      <div className="cp-au-dif">
        <div className="cp-au-antes">
          <span className="cp-au-etq">{t("ctxp.aud.antes")}</span>
          <p>
            <del>{recortar(h.buscar)}</del>
          </p>
        </div>
        <div className="cp-au-despues">
          <span className="cp-au-etq">{t("ctxp.aud.despues")}</span>
          {h.reemplazo.trim() ? (
            <p>
              <ins>{recortar(h.reemplazo)}</ins>
            </p>
          ) : (
            <p className="cp-au-borra">{t("ctxp.aud.seBorra")}</p>
          )}
        </div>
      </div>
      {h.estado === "aplicado" ? (
        <p className="cp-au-estado" data-estado="aplicado">
          <Check size={14} strokeWidth={2.2} aria-hidden />
          {t("ctxp.aud.aplicado")}
        </p>
      ) : h.estado === "invalido" ? (
        <p className="cp-au-estado" data-estado="invalido">
          <CircleAlert size={14} strokeWidth={2} aria-hidden />
          <span>
            <b>{t("ctxp.aud.invalido")}</b> {t("ctxp.aud.invalidoNota")}
          </span>
        </p>
      ) : puede ? (
        <div className="cp-au-pie">
          <button type="button" className="btn2 cp-au-btn" disabled={ocupado} aria-busy={ocupado || undefined} onClick={alAplicar}>
            {ocupado ? t("ctxp.aud.aplicando") : t("ctxp.aud.aplicar")}
          </button>
        </div>
      ) : null}
    </li>
  );
}

function Archivo({ g, puede, ocupados, alAplicar }: { g: GrupoArchivo; puede: boolean; ocupados: ReadonlySet<string>; alAplicar: (ids: string[]) => void }) {
  const nombreId = useId();
  const variosPendientes = g.pendientes.length > 1;
  const trabajando = g.pendientes.some((id) => ocupados.has(id));
  return (
    <section className="cp-au-arch" aria-labelledby={nombreId}>
      <div className="cp-au-arch-cab">
        <h5 id={nombreId} className="cp-au-arch-n" data-tip={g.ruta}>
          {g.nombre}
        </h5>
        {g.ahorroPosible > 0 ? <span className="cp-au-arch-ahorro cp-num">{t("ctxp.aud.ahorroArchivo", { n: miles(g.ahorroPosible) })}</span> : null}
        {puede && variosPendientes ? (
          <button type="button" className="cp-au-lnk" disabled={trabajando} onClick={() => alAplicar(g.pendientes)}>
            {t("ctxp.aud.aplicarArchivo", { n: g.pendientes.length })}
          </button>
        ) : null}
      </div>
      <ul className="cp-au-lista" aria-label={t("ctxp.aud.grupo", { archivo: g.nombre })}>
        {g.hallazgos.map((h) => (
          <FilaHallazgo key={h.id} h={h} puede={puede} ocupado={ocupados.has(h.id)} alAplicar={() => alAplicar([h.id])} />
        ))}
      </ul>
    </section>
  );
}

/** El modelo de la revisión: «automático» (lo elige el main) o uno de Claude. */
function useModelosRevision() {
  return MODELOS.filter((m) => m.id.startsWith("claude-"));
}

export function AuditoriaContexto({ proyecto, puede }: { proyecto: string; puede: boolean }) {
  useIdioma();
  const uid = useId();
  const [aud, setAud] = useState<Auditoria | null>(null);
  const [modelo, setModelo] = useState("");
  const [lanzando, setLanzando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errAplicar, setErrAplicar] = useState<string | null>(null);
  const [ocupados, setOcupados] = useState<ReadonlySet<string>>(new Set());
  // Una respuesta del sondeo que salió antes de que terminara la revisión no pisa el resultado: cada cambio de fuente sube la ficha.
  const ficha = useRef(0);
  const modelos = useModelosRevision();

  // Al cambiar de proyecto se lee la última revisión de ese proyecto (si hay una en curso, el sondeo de abajo la sigue).
  useEffect(() => {
    let vivo = true;
    ficha.current += 1;
    setAud(null);
    setError(null);
    setErrAplicar(null);
    setLanzando(false);
    fuenteContexto.auditoria(proyecto).then(
      (a) => vivo && setAud(a),
      (e) => vivo && setError(mensaje(e)),
    );
    return () => {
      vivo = false;
    };
  }, [proyecto]);

  // Mientras corre (la lancé yo o venía de antes), se pregunta cada tanto cómo va: la línea de avance y el final.
  const corriendo = lanzando || enCurso(aud);
  useEffect(() => {
    if (!corriendo) return;
    let vivo = true;
    const x = setInterval(() => {
      const mia = ficha.current;
      fuenteContexto.auditoria(proyecto).then(
        (a) => vivo && mia === ficha.current && a && setAud(a),
        () => {},
      );
    }, SONDEO_MS);
    return () => {
      vivo = false;
      clearInterval(x);
    };
  }, [corriendo, proyecto]);

  const revisar = useCallback(async () => {
    setError(null);
    setErrAplicar(null);
    setLanzando(true);
    const mia = (ficha.current += 1);
    try {
      const a = await fuenteContexto.auditar(modelo ? { proyecto, modelo } : { proyecto });
      if (mia === ficha.current) setAud(a);
    } catch (e) {
      if (mia === ficha.current) setError(mensaje(e));
    } finally {
      if (mia === ficha.current) {
        ficha.current += 1;
        setLanzando(false);
      }
    }
  }, [proyecto, modelo]);

  const aplicar = useCallback(
    async (ids: string[]) => {
      if (!aud || !ids.length) return;
      setErrAplicar(null);
      setOcupados((o) => new Set([...o, ...ids]));
      try {
        setAud(await fuenteContexto.aplicar(aud.id, ids));
      } catch (e) {
        setErrAplicar(mensaje(e));
      } finally {
        setOcupados((o) => {
          const n = new Set(o);
          for (const id of ids) n.delete(id);
          return n;
        });
      }
    },
    [aud],
  );

  const vista = lanzando ? "corriendo" : vistaDe(aud);
  const grupos = aud && vista === "hallazgos" ? agrupar(aud) : [];
  const tot = aud && vista === "hallazgos" ? totales(aud) : null;
  const pendientes = aud ? pendientesDe(aud) : [];
  const rev = aud ? resumenArchivos(aud.archivos) : null;

  return (
    <section className="cp-au" aria-label={t("ctxp.aud.titulo")}>
      <h4 className="cp-h">
        <span>{t("ctxp.aud.titulo")}</span>
      </h4>
      <p className="cp-nota">{t("ctxp.aud.intro")}</p>
      {puede ? (
        <div className="cp-au-form">
          <label className="cp-previa-campo" htmlFor={`${uid}-mod`}>
            <span>{t("ctxp.aud.modelo")}</span>
            <select id={`${uid}-mod`} value={modelo} disabled={corriendo} onChange={(e) => setModelo(e.target.value)}>
              <option value="">{t("ctxp.aud.modeloAuto")}</option>
              {modelos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="cp-au-revisar" disabled={corriendo} aria-busy={corriendo || undefined} onClick={() => void revisar()}>
            {corriendo ? <LoaderCircle size={15} strokeWidth={2} className="cp-au-gira" aria-hidden /> : <Sparkles size={15} strokeWidth={2} aria-hidden />}
            {corriendo ? t("ctxp.aud.corriendo") : vista === "sin-revisar" ? t("ctxp.aud.revisar") : t("ctxp.aud.revisarOtra")}
          </button>
        </div>
      ) : (
        <p className="cp-nota">{t("ctxp.soloPc")}</p>
      )}
      {corriendo ? (
        <div className="cp-au-avance" role="status">
          <p>{aud?.avance ?? t("ctxp.aud.avanceInicial")}</p>
          <p className="cp-nota">{t("ctxp.aud.sigueUsando")}</p>
        </div>
      ) : null}
      {error || (vista === "error" && aud) ? (
        <p className="cp-error" role="alert">
          {t("ctxp.aud.error", { motivo: error ?? aud?.error ?? "" })}
        </p>
      ) : null}
      {vista === "sin-hallazgos" ? <p className="cp-nada">{t("ctxp.aud.sinHallazgos")}</p> : null}
      {tot && aud ? (
        <>
          <div className="cp-au-resumen">
            <div className="cp-au-total">
              <span className="cp-au-total-etq">{t("ctxp.aud.posibleEtq")}</span>
              <b className="cp-au-cifra cp-num">{t("ctxp.aud.ahorro", { n: miles(tot.posible) })}</b>
              <span className="cp-nota">{t("ctxp.aud.cuenta", { pendientes: tot.pendientes, total: aud.hallazgos.length })}</span>
            </div>
            {puede && pendientes.length ? (
              <button type="button" className="btn2" disabled={pendientes.some((id) => ocupados.has(id))} onClick={() => void aplicar(pendientes)}>
                {t("ctxp.aud.aplicarTodos", { n: pendientes.length })}
              </button>
            ) : null}
          </div>
          {tot.aplicado > 0 ? <p className="cp-nota cp-au-ahorrado">{t("ctxp.aud.ahorrado", { n: miles(tot.aplicado) })}</p> : null}
          {errAplicar ? (
            <p className="cp-error" role="alert">
              {t("ctxp.aud.errorAplicar", { motivo: errAplicar })}
            </p>
          ) : null}
          {grupos.map((g) => (
            <Archivo key={g.ruta} g={g} puede={puede} ocupados={ocupados} alAplicar={(ids) => void aplicar(ids)} />
          ))}
          {aud.respaldo ? (
            <p className="cp-nota cp-au-copia" data-tip={aud.respaldo}>
              {t("ctxp.aud.copia", { carpeta: carpetaCorta(aud.respaldo) })}
            </p>
          ) : null}
        </>
      ) : null}
      {rev && rev.n > 0 && !corriendo && vista !== "error" ? <p className="cp-nota">{t("ctxp.aud.reviso", { n: rev.n, tokens: miles(rev.tokens), modelo: nombreModelo(aud?.modelo ?? "") })}</p> : null}
    </section>
  );
}
