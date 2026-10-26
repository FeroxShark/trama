// Ajustes > Modelos > «Modelos para workers», arriba: la key de Artificial Analysis (de ahí sale la inteligencia medida), «Probar»,
// «Actualizar» y cómo está la caché. La key es de escritura (se guarda en claves.env y no vuelve: acá sólo se ve si hay) y sigue el camino
// de las demás (`claveDsh`). Atribución obligatoria: «Datos: Artificial Analysis» con el enlace, también al lado de los números (Fila).
import { useCallback, useEffect, useRef, useState } from "react";
import { fuentePaneles, type EstadoAA, type ResultadoAA } from "../datos/paneles";
import { locale, t, textoMain } from "../i18n";
import { Fijo } from "../i18n/Fijo";
import { mensaje } from "../puente";
import { Boton } from "../ui/componentes";
import { CampoClave, Estado } from "./AjustesDsh";

export const URL_ARTIFICIAL_ANALYSIS = "https://artificialanalysis.ai";

/** «Datos: Artificial Analysis» con el enlace: va donde se muestran los números. */
export function AtribucionAA() {
  return (
    <a className="wk-aa-enlace" href={URL_ARTIFICIAL_ANALYSIS} target="_blank" rel="noopener noreferrer" data-tip={t("ajustes.aaDatosTip")}>
      {t("ajustes.aaDatos")}
    </a>
  );
}

/** Cuánto falta para poder reintentar, en una palabra («3 h», «40 min»). */
export const tiempoCorto = (s: number): string => (s >= 5400 ? `${Math.round(s / 3600)} h` : `${Math.max(1, Math.round(s / 60))} min`);

/** Lo que pasó al bajar la lista → la frase (sin la key, que nunca llega hasta acá). */
export function fraseFalloAA(r: Extract<ResultadoAA, { ok: false }>): string {
  switch (r.tipo) {
    case "clave": return t("ajustes.aaFalloClave");
    case "limite": return r.reintentarS ? t("ajustes.aaFalloLimiteEn", { tiempo: tiempoCorto(r.reintentarS) }) : t("ajustes.aaFalloLimite");
    case "red": return t("ajustes.aaFalloRed");
    case "sin-clave": return t("ajustes.aaFalloSinClave");
    default: return t("ajustes.aaFalloForma");
  }
}

export function ClaveArtificialAnalysis({ alActualizar }: { alActualizar: () => void }) {
  const [e, setE] = useState<EstadoAA | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [bajando, setBajando] = useState<"probar" | "actualizar" | null>(null);
  const [res, setRes] = useState<ResultadoAA | null>(null);
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => void (vivo.current = false);
  }, []);
  const mirar = useCallback(() => fuentePaneles.estadoAA().then((x) => vivo.current && setE(x), () => undefined), []);
  useEffect(() => void mirar(), [mirar]);

  const guardar = async (valor: string | null): Promise<boolean> => {
    setOcupado(true);
    setRes(null);
    try {
      await fuentePaneles.claveDsh("ARTIFICIAL_ANALYSIS_API_KEY", valor);
      await mirar();
      return true;
    } catch (x) {
      if (vivo.current) setRes({ ok: false, tipo: "red", detalle: mensaje(x) });
      return false;
    } finally {
      if (vivo.current) setOcupado(false);
    }
  };
  const bajar = async (cual: "probar" | "actualizar") => {
    setBajando(cual);
    setRes(null);
    const r = await fuentePaneles.refrescarAA().catch((x) => ({ resultado: { ok: false, tipo: "red", detalle: mensaje(x) } as const, estado: null }));
    if (!vivo.current) return;
    setBajando(null);
    setRes(r.resultado);
    if (r.estado) setE(r.estado);
    if (r.resultado.ok) alActualizar();
  };

  const fecha = e?.fecha ? new Date(e.fecha).toLocaleDateString(locale(), { day: "2-digit", month: "2-digit" }) : null;
  return (
    <div className="wk-aa" data-aa>
      <h4 className="wk-aa-t">{t("ajustes.aaTitulo")}</h4>
      <p className="pn-nota">
        {t("ajustes.aaQue")} <AtribucionAA />
      </p>
      <CampoClave
        nombre="ARTIFICIAL_ANALYSIS_API_KEY"
        que={t("ajustes.aaClave")}
        hay={e?.hayClave ?? false}
        ocupado={ocupado}
        alGuardar={(v) => guardar(v)}
        alBorrar={() => void guardar(null)}
      />
      {e?.hayClave ? (
        <div className="dsh-fila">
          <Boton aria-label={t("ajustes.aaProbar")} onClick={() => void bajar("probar")} disabled={bajando !== null}>
            {bajando === "probar" ? t("ajustes.aaProbando") : <Fijo k="ajustes.aaProbar" />}
          </Boton>
          {e.fecha ? (
            <Boton onClick={() => void bajar("actualizar")} disabled={bajando !== null}>
              {bajando === "actualizar" ? t("ajustes.aaActualizando") : <Fijo k="ajustes.aaActualizar" />}
            </Boton>
          ) : null}
          <span role="status" className="wk-aa-estado">
            {res ? (
              res.ok ? <Estado ok texto={t("ajustes.aaProbadaOk", { n: res.modelos })} /> : <Estado ok={false} texto={fraseFalloAA(res)} />
            ) : e.fecha ? (
              <Estado ok texto={t("ajustes.aaAlDia", { n: e.modelos, fecha: fecha ?? "" })} />
            ) : (
              <span className="mdl-estado">{t("ajustes.aaSinDatos")}</span>
            )}
          </span>
        </div>
      ) : (
        <p className="pn-nota">{t("ajustes.aaSinClave")}</p>
      )}
      {res && !res.ok && res.detalle && !e?.hayClave ? <div className="pn-error" role="alert">{textoMain(res.detalle)}</div> : null}
    </div>
  );
}
