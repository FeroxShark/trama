// "Cerrar del todo" (Ctrl+Q y el menú de la bandeja): la pregunta de Trama, no un `confirm()`. Dos salidas:
// dejar que los workers sigan (default) o parar todo. Si hay líderes respondiendo lo dice y pide confirmar.
// También le manda a la bandeja los textos de su menú ya traducidos (el main no tiene diccionario).
// Es un modal: atrapa el foco, Esc lo cierra y el foco vuelve a lo que lo abrió (`useFoco`).
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { fuente } from "../datos/fuente";
import { useFoco } from "../foco";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import { esVentana } from "../puente";

type Modo = "seguir" | "parar";
/** `null`: cerrado. `pregunta`: las dos salidas. `ocupados`: ya se eligió una y hay `n` líderes respondiendo. */
type Fase = null | { fase: "pregunta" } | { fase: "ocupados"; modo: Modo; n: number };

let fase: Fase = MODO.captura === "salir" ? { fase: "pregunta" } : MODO.captura === "salir-ocupados" ? { fase: "ocupados", modo: "seguir", n: 2 } : null;
const oyentes = new Set<() => void>();
const poner = (f: Fase) => {
  fase = f;
  oyentes.forEach((o) => o());
};
const suscribir = (f: () => void) => (oyentes.add(f), () => void oyentes.delete(f));

/** Sólo la ventana de la PC sale: por la tailnet `salir` no existe (el navegador no cierra a Trama). */
const enVentana = esVentana();

export function abrirSalir() {
  if (enVentana || MODO.captura) poner({ fase: "pregunta" });
}
export const cerrarSalir = () => poner(null);

export function Salir() {
  const f = useSyncExternalStore(suscribir, () => fase);
  useIdioma();
  const abrir = t("bandeja.abrir");
  const cerrar = t("bandeja.cerrar");
  useEffect(() => fuente.textosBandeja({ abrir, cerrar }), [abrir, cerrar]);
  useEffect(() => fuente.alPedirSalida(abrirSalir), []);
  return f ? <Dialogo f={f} /> : null;
}

function Dialogo({ f }: { f: NonNullable<Fase> }) {
  const caja = useRef<HTMLDivElement>(null);
  const [yendo, setYendo] = useState(false);
  useFoco(caja, { alCerrar: cerrarSalir });
  // Si salir devuelve 0 el proceso se va y esto no llega a verse; si no, hay líderes respondiendo.
  const ir = async (modo: Modo, forzar: boolean) => {
    if (yendo) return;
    setYendo(true);
    const n = await fuente.salir({ modo, forzar });
    setYendo(false);
    if (n > 0) poner({ fase: "ocupados", modo, n });
  };
  return createPortal(
    <div className="at" onClick={(e) => e.target === e.currentTarget && cerrarSalir()}>
      <div ref={caja} className="at-caja sa-caja" role="alertdialog" aria-modal="true" aria-labelledby="sa-titulo" tabIndex={-1}>
        {f.fase === "pregunta" ? (
          <>
            <h2 id="sa-titulo">{t("salir.titulo")}</h2>
            <button type="button" className="sa-op" data-primario disabled={yendo} onClick={() => void ir("seguir", false)}>
              <b>{t("salir.sigan")}</b>
              <span>{t("salir.siganAyuda")}</span>
            </button>
            <button type="button" className="sa-op" disabled={yendo} onClick={() => void ir("parar", false)}>
              <b>{t("salir.parar")}</b>
              <span>{t("salir.pararAyuda")}</span>
            </button>
            <footer className="sa-pie">
              <button type="button" className="btn2" onClick={cerrarSalir}>
                {t("salir.cancelar")}
              </button>
            </footer>
          </>
        ) : (
          <>
            <h2 id="sa-titulo">{f.n === 1 ? t("salir.ocupados1") : t("salir.ocupadosN", { n: f.n })}</h2>
            <p className="sa-ayuda">{t("salir.ocupadosAyuda")}</p>
            <footer className="sa-pie">
              <button type="button" className="btn2" data-primario onClick={cerrarSalir}>
                {t("salir.esperar")}
              </button>
              <button type="button" className="btn2" disabled={yendo} onClick={() => void ir(f.modo, true)}>
                {t("salir.igual")}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
