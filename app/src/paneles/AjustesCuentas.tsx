// Ajustes > Cuentas: si Claude Code y Gemini (agy) están conectados y un botón para conectar el que falte, para quien
// no lo hizo en el asistente del primer arranque. Sólo existe en el .exe de Windows (`src/carcasa.ts`): ahí "Conectar"
// abre una consola de Ubuntu para iniciar sesión (Trama nunca ve la contraseña). Se vuelve a mirar al volver a la ventana
// (cuando se cierra la consola) o con Revisar; sin reloj.
import { useCallback, useEffect, useRef, useState } from "react";
import { carcasa, type Cuenta, type CuentasOk, type Proveedor } from "../carcasa";
import { t, textoMain, type ClaveSola } from "../i18n";
import { Fijo } from "../i18n/Fijo";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import { mensaje } from "../puente";
import type { FilaDato } from "./AjustesEditar";

const FILAS: { id: Proveedor; clave: "claude" | "agy"; nombre: ClaveSola; que: ClaveSola }[] = [
  { id: "claude", clave: "claude", nombre: "ajustes.ctaClaude", que: "ajustes.ctaClaudeQue" },
  { id: "gemini", clave: "agy", nombre: "ajustes.ctaGemini", que: "ajustes.ctaGeminiQue" },
];

const estado = (c: Cuenta): ClaveSola => (c.logueado ? "ajustes.ctaConectada" : c.instalado ? "ajustes.ctaSinConectar" : "ajustes.ctaNoInstalada");

export function AjustesCuentas({ Dato }: { Dato: FilaDato }) {
  useIdioma();
  const puente = carcasa();
  const [c, setC] = useState<CuentasOk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [esperando, setEsperando] = useState<Proveedor | null>(null);
  const vivo = useRef(true);
  const sec = useRef<HTMLElement>(null);
  useEffect(() => () => void (vivo.current = false), []);

  const leer = useCallback(async () => {
    if (!puente) return;
    try {
      const r = await puente.cuentas();
      if (!vivo.current) return;
      if ("error" in r) setError(r.error);
      else {
        setC(r);
        setError(null);
      }
    } catch (e) {
      if (vivo.current) setError(mensaje(e));
    }
  }, [puente]);

  useEffect(() => {
    void leer();
    // Al volver a la ventana (se cerró la consola donde se inició sesión) se mira de nuevo.
    window.addEventListener("focus", leer);
    return () => window.removeEventListener("focus", leer);
  }, [leer]);

  // La captura de `cuentas` abre Ajustes mostrando esta sección.
  useEffect(() => {
    if (c && MODO.variante === "cuentas") sec.current?.scrollIntoView({ block: "start" });
  }, [c]);

  if (!puente) return null;

  const conectar = async (p: Proveedor) => {
    setEsperando(p);
    const r = await puente.conectar(p).catch((e) => ({ error: mensaje(e) }));
    if (!vivo.current) return;
    if (r?.error) {
      setEsperando(null);
      setError(r.error);
    }
  };

  return (
    <section className="pn-sec" ref={sec} data-cuentas>
      <h2 className="pn-h">{t("ajustes.cuentas")}</h2>
      <Fijo k="ajustes.cuentasIntro" bloque className="pn-nota pn-intro" />
      {c
        ? FILAS.map((f) => {
            const cuenta = c[f.clave];
            return (
              <Dato key={f.id} nombre={f.nombre} que={f.que}>
                <div className="pn-cuenta">
                  <span className="pn-estado" data-escucha={cuenta.logueado ? "" : undefined}>
                    {t(estado(cuenta))}
                  </span>
                  {cuenta.logueado ? null : (
                    <button type="button" className="btn2" disabled={!cuenta.instalado} onClick={() => void conectar(f.id)}>
                      {t(f.id === "claude" ? "ajustes.ctaConectarClaude" : "ajustes.ctaConectarGemini")}
                    </button>
                  )}
                </div>
                {esperando === f.id && !cuenta.logueado ? <div className="pn-nota">{t("ajustes.ctaConsola")}</div> : null}
              </Dato>
            );
          })
        : error
          ? null
          : <div className="pn-aviso">{t("ajustes.leyendo")}</div>}
      {error ? (
        <div className="pn-error" role="alert">
          {textoMain(error)}
        </div>
      ) : null}
      {c ? (
        <div className="pn-acciones">
          <button type="button" className="btn2" onClick={() => void leer()}>
            {t("ajustes.ctaRevisar")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
