// Ajustes > Proyectos > Limpieza de worktrees y ramas viejos de `pa` (electron/limpieza-pa.ts): la pasada automática (apagada de entrada), los
// días de antigüedad, "Ver qué se borraría" (la lista exacta, sin tocar nada) y, a la vista de esa lista, "Borrar lo de la lista".
// Lo seguro lo decide `pa --limpiar`; acá no se arma ninguna ruta ni se borra nada por cuenta propia.
import { useEffect, useState } from "react";
import { Check, Trash2, X } from "lucide-react";
import { fuenteLimpieza, type ConfigLimpieza, type PlanLimpieza } from "../datos/limpieza";
import { t, textoMain } from "../i18n";
import { useIdioma } from "../i18n/react";
import { mensaje } from "../puente";
import { cuantas, DIAS_OFRECIDOS, tamano } from "./limpieza-vista";
import "./proyectos.css";

const DEFECTO: ConfigLimpieza = { auto: false, dias: 7 };

export function LimpiezaPa() {
  const idioma = useIdioma();
  const coma = idioma === "en" ? "." : ",";
  const [cfg, setCfg] = useState<ConfigLimpieza>(DEFECTO);
  const [plan, setPlan] = useState<PlanLimpieza | null>(null);
  const [fase, setFase] = useState<"quieto" | "viendo" | "borrando">("quieto");
  const [hecho, setHecho] = useState<PlanLimpieza | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fuenteLimpieza.config().then((c) => vivo && setCfg(c), () => {});
    return () => {
      vivo = false;
    };
  }, []);

  const guardar = (cambio: Partial<ConfigLimpieza>) => {
    setCfg((c) => ({ ...c, ...cambio }));
    // la lista que se estaba viendo es de otros días: ya no vale
    if (cambio.dias !== undefined) {
      setPlan(null);
      setHecho(null);
    }
    fuenteLimpieza.guardar(cambio).then(setCfg, (e) => setError(mensaje(e)));
  };
  const ver = async () => {
    setFase("viendo");
    setError(null);
    setHecho(null);
    try {
      setPlan(await fuenteLimpieza.ver(cfg.dias));
    } catch (e) {
      setPlan(null);
      setError(mensaje(e));
    } finally {
      setFase("quieto");
    }
  };
  const borrar = async () => {
    setFase("borrando");
    setError(null);
    try {
      setHecho(await fuenteLimpieza.aplicar(cfg.dias));
      setPlan(null);
    } catch (e) {
      setError(mensaje(e));
    } finally {
      setFase("quieto");
    }
  };

  const hay = plan ? cuantas(plan) : 0;
  return (
    <>
      <h2 className="pn-h">{t("lmp.titulo")}</h2>
      <p className="pn-nota">{t("lmp.intro")}</p>
      <div data-opc="lmp.auto" className="lmp-fila">
        <span className="lmp-etq" id="lmp-auto">{t("lmp.auto")}</span>
        <div className="pn-chips" role="group" aria-labelledby="lmp-auto">
          <button type="button" className="pn-chip-f" aria-pressed={!cfg.auto} onClick={() => guardar({ auto: false })}>
            {t("lmp.autoNo")}
          </button>
          <button type="button" className="pn-chip-f" aria-pressed={cfg.auto} onClick={() => guardar({ auto: true })}>
            {t("lmp.autoSi")}
          </button>
        </div>
      </div>
      <p className="pn-nota">{t("lmp.autoQue")}</p>
      <div data-opc="lmp.dias" className="lmp-fila">
        <span className="lmp-etq" id="lmp-dias">{t("lmp.dias")}</span>
        <div className="pn-chips" role="group" aria-labelledby="lmp-dias">
          {DIAS_OFRECIDOS.map((n) => (
            <button key={n} type="button" className="pn-chip-f" aria-pressed={cfg.dias === n} onClick={() => guardar({ dias: n })}>
              {t("lmp.diasN", { n })}
            </button>
          ))}
        </div>
      </div>
      <div className="pry-acc">
        <button type="button" className="mini" data-ver-limpieza disabled={fase !== "quieto"} onClick={() => void ver()}>
          <Trash2 size={13} strokeWidth={1.8} aria-hidden="true" />
          {fase === "viendo" ? t("lmp.viendo") : t("lmp.ver")}
        </button>
      </div>
      {error ? <p className="pn-error" role="alert">{t("lmp.error", { e: textoMain(error) })}</p> : null}
      {plan && !hay ? <p className="pn-nota" role="status">{t("lmp.nada", { n: plan.dias })}</p> : null}
      {plan && hay ? (
        <div className="lmp-plan" data-plan-limpieza>
          {plan.worktrees.length ? (
            <>
              <h3 className="pn-sub-h">{t("lmp.secWt")}</h3>
              <ul className="lmp-lista">
                {plan.worktrees.map((w) => (
                  <li key={w.puesto}>{t("lmp.filaWt", { puesto: w.puesto, dias: w.dias, tam: tamano(w.bytes, coma) })}</li>
                ))}
              </ul>
            </>
          ) : null}
          {plan.ramas.length ? (
            <>
              <h3 className="pn-sub-h">{t("lmp.secRamas")}</h3>
              <ul className="lmp-lista">
                {plan.ramas.map((r) => (
                  <li key={r.rama}>{t("lmp.filaRama", { rama: r.rama, estado: r.commits > 0 ? t("lmp.ramaIntegrada") : t("lmp.ramaVacia"), dias: r.dias })}</li>
                ))}
              </ul>
            </>
          ) : null}
          {plan.builds.length ? (
            <>
              <h3 className="pn-sub-h">{t("lmp.secBuild")}</h3>
              <ul className="lmp-lista">
                {plan.builds.map((b) => (
                  <li key={`${b.puesto}/${b.dir}`}>{t("lmp.filaBuild", { ruta: `${b.puesto}/${b.dir}`, tam: tamano(b.bytes, coma) })}</li>
                ))}
              </ul>
            </>
          ) : null}
          {plan.enUso.length ? <p className="pn-nota">{t("lmp.enUso", { lista: plan.enUso.join(", ") })}</p> : null}
          <p className="pn-nota">{t("lmp.total", { tam: tamano(plan.bytes, coma) })}</p>
          <div className="pry-acc">
            <button type="button" className="mini pn-primario" data-borrar-limpieza disabled={fase !== "quieto"} onClick={() => void borrar()}>
              <Trash2 size={13} strokeWidth={1.8} aria-hidden="true" />
              {fase === "borrando" ? t("lmp.borrando") : t("lmp.borrar")}
            </button>
            <button type="button" className="mini" data-cerrar disabled={fase === "borrando"} onClick={() => setPlan(null)}>
              <X size={13} strokeWidth={1.8} aria-hidden="true" />
              {t("lmp.noBorrar")}
            </button>
          </div>
        </div>
      ) : null}
      {hecho ? (
        <p className="pn-nota pry-ok" role="status">
          <Check size={13} strokeWidth={2} aria-hidden="true" /> {cuantas(hecho) ? t("lmp.hecho", { tam: tamano(hecho.bytes, coma) }) : t("lmp.hechoNada")}
        </p>
      ) : null}
    </>
  );
}
