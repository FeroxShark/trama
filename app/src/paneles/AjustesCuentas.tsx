// Ajustes > Cuentas: si Claude Code y Gemini (agy) están conectados, con quién, o por qué no se pudo saber; y los botones
// para conectar, reconectar y comprobar. El estado lo da el motor preguntándole a cada CLI (`fuente.cuentas`, electron/cuentas.ts),
// no un archivo. Sólo existe en el .exe de Windows (`src/carcasa.ts`): ahí "Conectar" abre una consola de Ubuntu para iniciar
// sesión (Trama nunca ve la contraseña). Se vuelve a mirar al volver a la ventana (cuando se cierra la consola) o con Comprobar;
// sin reloj. Si Gemini quedó disponible después de abrir la app, la tabla de modelos se pone al día (el selector de líder nuevo).
import { useCallback, useEffect, useRef, useState } from "react";
import { carcasa, type Cuenta, type Proveedor } from "../carcasa";
import { fuente, type CuentaEstado, type EstadoCuentas } from "../datos/fuente";
import { pedirModelos } from "../datos/modelos-config";
import { aplicarModelos } from "../hilo/opciones";
import { t, textoMain, type ClaveSola } from "../i18n";
import { Fijo } from "../i18n/Fijo";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import { marcar } from "./ajustes-nav";
import { mensaje } from "../puente";
import type { FilaDato } from "./AjustesEditar";

const FILAS: { id: Proveedor; clave: "claude" | "agy"; nombre: ClaveSola; que: ClaveSola }[] = [
  { id: "claude", clave: "claude", nombre: "ajustes.ctaClaude", que: "ajustes.ctaClaudeQue" },
  { id: "gemini", clave: "agy", nombre: "ajustes.ctaGemini", que: "ajustes.ctaGeminiQue" },
];

const estado = (c: CuentaEstado): ClaveSola =>
  c.logueado ? "ajustes.ctaConectada" : c.error ? "ajustes.ctaError" : c.instalado ? "ajustes.ctaSinConectar" : "ajustes.ctaNoInstalada";

const deCarcasa = (c: Cuenta): CuentaEstado => ({ instalado: c.instalado, logueado: c.logueado, cuenta: c.cuenta ?? null, error: c.error ?? null });

export function AjustesCuentas({ Dato }: { Dato: FilaDato }) {
  useIdioma();
  const puente = carcasa();
  const [c, setC] = useState<EstadoCuentas | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mirando, setMirando] = useState(false);
  const [esperando, setEsperando] = useState<Proveedor | null>(null);
  const vivo = useRef(true);
  const sec = useRef<HTMLElement>(null);
  useEffect(() => () => void (vivo.current = false), []);

  const leer = useCallback(async () => {
    if (!puente) return;
    setMirando(true);
    try {
      let r = await fuente.cuentas();
      if (!r) {
        // El motor no contestó: lo que sabe la carcasa (trama-estado) es mejor que nada.
        const x = await puente.cuentas();
        if ("error" in x) throw new Error(x.error);
        r = { claude: deCarcasa(x.claude), agy: deCarcasa(x.agy) };
      }
      if (!vivo.current) return;
      setC(r);
      setError(null);
      // Gemini instalado y la tabla de modelos sin sus filas (agy apareció después de abrir la app): se arma de nuevo.
      if (r.agy.instalado) void pedirModelos(5000).then((m) => m && m.gemini && aplicarModelos(m));
    } catch (e) {
      if (vivo.current) setError(mensaje(e));
    } finally {
      if (vivo.current) setMirando(false);
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
    if (c && (MODO.variante ?? "").startsWith("cuentas")) sec.current?.scrollIntoView({ block: "start" });
  }, [c]);

  // La marca de la barra lateral: lo que falta conectar (sin dato, no se dice nada).
  useEffect(() => {
    if (!c) return;
    const sin = FILAS.filter((f) => !c[f.clave].logueado);
    if (sin.length === FILAS.length) marcar("cuentas", "aj.marca.ninguna");
    else if (sin.length) marcar("cuentas", "aj.marca.sinConectar", { quien: sin[0].id === "claude" ? "Claude" : "Gemini" });
    else marcar("cuentas", null);
    return () => marcar("cuentas", null);
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
      <Fijo k="ajustes.cuentasIntro" bloque className="pn-nota pn-intro" />
      {c
        ? FILAS.map((f) => {
            const cuenta = c[f.clave];
            return (
              <Dato key={f.id} nombre={f.nombre} que={f.que}>
                <div className="pn-cuenta">
                  <span className="pn-estado" data-escucha={cuenta.logueado ? "" : undefined} data-error={cuenta.error ? "" : undefined}>
                    {cuenta.logueado && cuenta.cuenta ? t("ajustes.ctaConectadaComo", { cuenta: cuenta.cuenta }) : t(estado(cuenta))}
                  </span>
                  <button type="button" className="btn2" disabled={!cuenta.instalado} onClick={() => void conectar(f.id)}>
                    {t(cuenta.logueado ? "ajustes.ctaReconectar" : f.id === "claude" ? "ajustes.ctaConectarClaude" : "ajustes.ctaConectarGemini")}
                  </button>
                </div>
                {cuenta.error ? <div className="pn-nota" role="status">{cuenta.error}</div> : null}
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
      {c || error ? (
        <div className="pn-acciones">
          <button type="button" className="btn2" disabled={mirando} onClick={() => void leer()}>
            {t(mirando ? "ajustes.ctaComprobando" : "ajustes.ctaRevisar")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
