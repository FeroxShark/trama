// Ajustes > Cuentas: gestión de múltiples cuentas de Claude y conexión con Gemini CLI (agy).
// Permite alternar instantáneamente entre distintas cuentas de Claude sin perder las sesiones ni tokens.
import { useCallback, useEffect, useRef, useState } from "react";
import { User, Check, Plus, RefreshCw, AlertCircle, Shield } from "lucide-react";
import { carcasa, type Cuenta, type CuentasOk, type Proveedor } from "../carcasa";
import { fuentePaneles } from "../datos/paneles";
import { t, textoMain, type ClaveSola } from "../i18n";
import { Fijo } from "../i18n/Fijo";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import { mensaje } from "../puente";
import type { FilaDato } from "./AjustesEditar";

interface CuentaClaudePerfil {
  id: string;
  email: string;
  nombre: string;
  activa: boolean;
  creada: number;
}

interface EstadoPerfilesClaude {
  activa: string | null;
  cuentas: CuentaClaudePerfil[];
}

export function AjustesCuentas({ Dato }: { Dato: FilaDato }) {
  useIdioma();
  const puente = carcasa();
  const [c, setC] = useState<CuentasOk | null>(null);
  const [perfiles, setPerfiles] = useState<EstadoPerfilesClaude | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [esperando, setEsperando] = useState<string | null>(null);
  const [cambiando, setCambiando] = useState<string | null>(null);
  const vivo = useRef(true);
  const sec = useRef<HTMLElement>(null);

  useEffect(() => () => void (vivo.current = false), []);

  const leer = useCallback(async () => {
    try {
      // 1. Leer estado general de proveedores si hay puente
      if (puente) {
        const r = await puente.cuentas();
        if (vivo.current) {
          if ("error" in r) setError(r.error);
          else setC(r);
        }
      }

      // 2. Leer perfiles de Claude
      const p = await fuentePaneles.cuentasClaude.listar();
      if (vivo.current && p && Array.isArray(p.cuentas)) {
        setPerfiles(p);
      }
    } catch (e) {
      if (vivo.current) setError(mensaje(e));
    }
  }, [puente]);

  useEffect(() => {
    void leer();
    window.addEventListener("focus", leer);
    return () => window.removeEventListener("focus", leer);
  }, [leer]);

  useEffect(() => {
    if (MODO.variante === "cuentas") sec.current?.scrollIntoView({ block: "start" });
  }, []);

  const cambiarCuenta = async (id: string) => {
    setCambiando(id);
    setError(null);
    try {
      await fuentePaneles.cuentasClaude.cambiar(id);
      await leer();
    } catch (e) {
      if (vivo.current) setError(mensaje(e));
    } finally {
      if (vivo.current) setCambiando(null);
    }
  };

  const agregarCuenta = async () => {
    setEsperando("claude-nueva");
    setError(null);
    try {
      await fuentePaneles.cuentasClaude.agregar();
      await leer();
    } catch (e) {
      if (vivo.current) setError(mensaje(e));
    } finally {
      if (vivo.current) setEsperando(null);
    }
  };

  const conectarGemini = async () => {
    if (!puente) return;
    setEsperando("gemini");
    const r = await puente.conectar("gemini").catch((e) => ({ error: mensaje(e) }));
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

      {/* Proveedor Claude con múltiples cuentas */}
      <Dato nombre="ajustes.ctaClaude" que="ajustes.ctaClaudeQue">
        <div className="pn-claude-cuentas">
          {perfiles && perfiles.cuentas.length > 0 ? (
            <div className="pn-perfiles-lista">
              {perfiles.cuentas.map((cuenta) => (
                <div key={cuenta.id} className="pn-perfil-card" data-activo={cuenta.activa ? "" : undefined}>
                  <div className="pn-perfil-info">
                    <User size={16} className="pn-perfil-icono" />
                    <div>
                      <div className="pn-perfil-nombre">{cuenta.nombre || cuenta.email}</div>
                      <div className="pn-perfil-email">{cuenta.email}</div>
                    </div>
                  </div>
                  <div className="pn-perfil-acciones">
                    {cuenta.activa ? (
                      <span className="pn-perfil-badge-activa">
                        <Check size={13} strokeWidth={2.5} /> En uso
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn2 mini"
                        disabled={cambiando !== null}
                        onClick={() => void cambiarCuenta(cuenta.id)}
                      >
                        {cambiando === cuenta.id ? "Cambiando..." : "Usar esta cuenta"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="pn-aviso">
              {c?.claude.logueado ? "1 cuenta de Claude conectada" : "Sin cuentas de Claude guardadas"}
            </div>
          )}

          <div className="pn-perfil-boton-agregar">
            <button
              type="button"
              className="btn2"
              disabled={esperando === "claude-nueva"}
              onClick={() => void agregarCuenta()}
            >
              <Plus size={14} />
              {esperando === "claude-nueva" ? "Abriendo inicio de sesión..." : "Conectar otra cuenta de Claude"}
            </button>
          </div>
          {esperando === "claude-nueva" ? (
            <div className="pn-nota">Iniciá sesión en la terminal que se abrió para vincular la nueva cuenta.</div>
          ) : null}
        </div>
      </Dato>

      {/* Proveedor Gemini CLI (agy) */}
      <Dato nombre="ajustes.ctaGemini" que="ajustes.ctaGeminiQue">
        <div className="pn-cuenta">
          <span className="pn-estado" data-escucha={c?.agy.logueado ? "" : undefined}>
            {c?.agy.logueado ? "Conectada" : c?.agy.instalado ? "Sin conectar" : "No instalada"}
          </span>
          {c?.agy.logueado ? null : (
            <button
              type="button"
              className="btn2"
              disabled={!c?.agy.instalado || esperando === "gemini"}
              onClick={() => void conectarGemini()}
            >
              {esperando === "gemini" ? "Abriendo consola..." : "Conectar Gemini"}
            </button>
          )}
        </div>
        {esperando === "gemini" && !c?.agy.logueado ? (
          <div className="pn-nota">{t("ajustes.ctaConsola")}</div>
        ) : null}
      </Dato>

      {error ? (
        <div className="pn-error" role="alert">
          {textoMain(error)}
        </div>
      ) : null}

      <div className="pn-acciones">
        <button type="button" className="btn2" onClick={() => void leer()}>
          <RefreshCw size={14} />
          {t("ajustes.ctaRevisar")}
        </button>
      </div>
    </section>
  );
}
