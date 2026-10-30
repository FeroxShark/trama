// Costo equivalente en USD por modelo, en el período de Estadísticas: los tokens del registro histórico (todas las sesiones,
// líderes y workers) × el precio de cada modelo (precios.ts, con lo que el usuario cambió en Ajustes > Modelos). Es
// equivalente: la suscripción no cobra por token. Un modelo sin precio figura como "sin precio" y no suma al total.
import { useEffect, useMemo, useState } from "react";
import { VERSION } from "../datos/contrato";
import { fuentePaneles, type Consulta } from "../datos/paneles";
import { locale, t } from "../i18n";
import { tokens } from "./resumen";
import { costoPorRol, filasCosto, tablaEfectiva, type Tabla } from "./precios";
import { leerCambios } from "./precios-guardados";

const usd = (x: number) =>
  `US$ ${x.toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function CostoPorModelo({ dias }: { dias: 7 | 30 }) {
  const [consulta, setConsulta] = useState<Consulta | null>(null);
  // Los precios se leen al montar: lo que se cambie en Ajustes se ve al volver a Estadísticas.
  const [tabla] = useState<Tabla>(() => tablaEfectiva(leerCambios()));

  useEffect(() => {
    let vivo = true;
    // Si el registro falla, lo muestra Historial (más abajo); acá la sección simplemente no aparece.
    fuentePaneles.historial(dias).then(
      (r) => {
        if (vivo && r.version === VERSION && !("error" in r)) setConsulta(r);
      },
      () => {},
    );
    return () => {
      vivo = false;
    };
  }, [dias]);

  const cuenta = useMemo(() => (consulta ? filasCosto(consulta.modelos, tabla) : null), [consulta, tabla]);
  const roles = useMemo(() => (consulta ? costoPorRol(consulta.roles, tabla) : null), [consulta, tabla]);
  if (!cuenta) return null;

  return (
    <section className="pn-sec">
      <h2 className="pn-h">
        {t("est.costo")} <span className="pn-h-sub">{t("est.costoSub")}</span>
      </h2>
      {cuenta.filas.length === 0 ? (
        <div className="pn-aviso">{t("est.costoVacio")}</div>
      ) : (
        <ul className="pn-costo">
          {cuenta.filas.map((f) => (
            <li key={f.modelo} className="pn-costo-fila">
              <span className="pn-t-n">{f.modelo}</span>
              <span className="pn-num pn-tok">{tokens(f.tokens)}</span>
              <span className="pn-num" data-sin-precio={f.costo === null ? "" : undefined}>
                {f.costo === null ? t("est.costoSinPrecio") : usd(f.costo)}
              </span>
            </li>
          ))}
          <li className="pn-costo-fila pn-costo-total">
            <span className="pn-t-n">{t("est.costoTotal")}</span>
            <span />
            <span className="pn-num">{usd(cuenta.total)}</span>
          </li>
        </ul>
      )}
      {roles && cuenta.filas.length > 0 ? (
        <>
          <h3 className="pn-sub-h">{t("est.costoRoles")}</h3>
          <ul className="pn-costo" aria-label={t("est.costoRoles")}>
            {roles.map((r) => (
              <li key={r.rol} className="pn-costo-fila" data-rol={r.rol}>
                <span className="pn-t-n">{t(`hist.${r.rol}`)}</span>
                <span className="pn-num pn-tok">{tokens(r.tokens)}</span>
                <span className="pn-num" data-sin-precio={r.costo === 0 && r.sinPrecio ? "" : undefined}>
                  {r.costo === 0 && r.sinPrecio ? t("est.costoSinPrecio") : usd(r.costo)}
                </span>
              </li>
            ))}
          </ul>
          <div className="pn-nota">{t("est.costoRolesNota")}</div>
        </>
      ) : null}
      <div className="pn-nota">{t("est.costoNota")}</div>
    </section>
  );
}
