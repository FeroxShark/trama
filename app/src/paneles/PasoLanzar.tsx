// El paso previo de las acciones de Ramas que lanzan algo (Actualizar, Analizar, Retomar, Arreglar): nada sale al
// tocar el botón. Se elige el modelo y el esfuerzo (con el default de hoy ya puesto), se puede sumar un texto y se
// lanza con "Lanzar" (Enter, con el foco ahí desde que abre) o se cancela (Esc, Cancelar, tocar afuera).
// Es un modal como Salir: portal, atrapa el foco (`useFoco`) y el foco vuelve a lo que lo abrió.
// Qué se lanza lo dice quien lo pide (`lanzar`); acá no se conoce `pa` ni los líderes. La lógica pura, en lanzar.ts.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useFoco } from "../foco";
import { Selector, type Opcion } from "../hilo/Selector";
import { effortPara } from "../hilo/elegir";
import { effortsLeidos } from "../hilo/efforts";
import { effortsOpciones, MODELO_DEFAULT, MODELOS, MODELOS_WORKER } from "../hilo/opciones";
import { effortDeModelo } from "../hilo/modelos";
import { t, type ClaveSola } from "../i18n";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import { mensaje } from "../puente";
import { ACTUALIZAR, esfuerzoWorker, type Eleccion } from "./lanzar";

/** Qué acción pide el paso: elige los textos (`lanzar.<clave>.*`). */
export type ClaveLanzar = "actualizar" | "analizar" | "retomar" | "arreglar";

export type PedidoLanzar = {
  clave: ClaveLanzar;
  modelos: Opcion[];
  /** Con lo que arranca (el default de hoy de esa acción). */
  modelo: string;
  effort: string;
  /** El esfuerzo con que arranca otro modelo, mientras el usuario no haya tocado el suyo. */
  esfuerzoDe: (modelo: string) => string;
  /** El tipo de `pa --tipo` (sólo las acciones que lanzan un worker): se muestra, no se elige. */
  tipo?: string;
  /** Lanza de verdad. Si rechaza, el paso sigue abierto con el error. */
  lanzar: (e: Eleccion) => Promise<void>;
};

let pedido: PedidoLanzar | null = null;
const oyentes = new Set<() => void>();
const poner = (p: PedidoLanzar | null) => {
  pedido = p;
  oyentes.forEach((o) => o());
};
const suscribir = (f: () => void) => (oyentes.add(f), () => void oyentes.delete(f));

/** Abre el paso. Un segundo pedido con uno abierto lo reemplaza (el modal tapa la pantalla: no debería pasar). */
export const pedirPaso = (p: PedidoLanzar) => poner(p);
export const cerrarPaso = () => poner(null);

export function PasoLanzar() {
  const p = useSyncExternalStore(suscribir, () => pedido);
  useIdioma();
  return p ? <Dialogo key={p.clave} p={p} /> : null;
}

/** El paso de una acción que lanza un líder: sus modelos, y arranca con el que se le habría puesto sin él (el de routing). */
export function pasoLider(clave: ClaveLanzar, lanzar: PedidoLanzar["lanzar"], base?: { modelo?: string; effort?: string }) {
  const esfuerzoDe = (m: string) => effortPara(m, effortsLeidos() ?? {});
  const modelo = base?.modelo ?? MODELO_DEFAULT;
  pedirPaso({ clave, modelos: MODELOS, modelo, effort: base?.effort ?? esfuerzoDe(modelo), esfuerzoDe, lanzar });
}

/** El paso de una acción que lanza un worker de `pa` (Actualizar): arranca con lo que `pa --tipo mecanico` elige solo. */
export function pasoWorker(clave: ClaveLanzar, lanzar: PedidoLanzar["lanzar"]) {
  const esfuerzoDe = (m: string) => esfuerzoWorker(m, effortsLeidos() ?? {});
  pedirPaso({ clave, modelos: MODELOS_WORKER, modelo: ACTUALIZAR.modelo, effort: ACTUALIZAR.effort, esfuerzoDe, tipo: ACTUALIZAR.tipo, lanzar });
}

const TEXTOS: Record<ClaveLanzar, { titulo: ClaveSola; ayuda: ClaveSola }> = {
  actualizar: { titulo: "lanzar.actualizar.titulo", ayuda: "lanzar.actualizar.ayuda" },
  analizar: { titulo: "lanzar.analizar.titulo", ayuda: "lanzar.analizar.ayuda" },
  retomar: { titulo: "lanzar.retomar.titulo", ayuda: "lanzar.retomar.ayuda" },
  arreglar: { titulo: "lanzar.arreglar.titulo", ayuda: "lanzar.arreglar.ayuda" },
};

function Dialogo({ p }: { p: PedidoLanzar }) {
  const caja = useRef<HTMLDivElement>(null);
  const lanzarBtn = useRef<HTMLButtonElement>(null);
  const [modelo, setModelo] = useState(p.modelo);
  const [effort, setEffort] = useState(p.effort);
  // Si el usuario ya eligió el esfuerzo, cambiar de modelo no se lo pisa.
  const [tocado, setTocado] = useState(false);
  const [texto, setTexto] = useState("");
  const [yendo, setYendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useFoco(caja, { alCerrar: cerrarPaso, ignorar: '[role="listbox"]', enfocar: false });
  // El foco empieza en Lanzar: Enter lanza con el default sin tocar nada.
  useEffect(() => lanzarBtn.current?.focus({ preventScroll: true }), []);

  // Captura `ramas-lanzar-error`: el paso ya intentó lanzar y `pa` dijo que no.
  useEffect(() => {
    if (MODO.captura === "ramas-lanzar-error") void lanzar();
  }, []);

  const textos = TEXTOS[p.clave];
  const elegirModelo = (m: string) => {
    setModelo(m);
    // Lo elegido se queda si el modelo nuevo tiene ese nivel; si no (cada modelo tiene los suyos), el que le toca.
    setEffort((antes) => (tocado ? (effortDeModelo(m, antes) ?? p.esfuerzoDe(m)) : p.esfuerzoDe(m)));
  };
  const lanzar = async () => {
    if (yendo) return;
    setYendo(true);
    setError(null);
    try {
      await p.lanzar({ modelo, effort, texto });
      cerrarPaso();
    } catch (e) {
      setError(mensaje(e));
      setYendo(false);
    }
  };

  return createPortal(
    <div className="at" onClick={(e) => e.target === e.currentTarget && !yendo && cerrarPaso()}>
      <div ref={caja} className="at-caja lz-caja" role="dialog" aria-modal="true" aria-labelledby="lz-titulo" tabIndex={-1}>
        <h2 id="lz-titulo">{t(textos.titulo)}</h2>
        <p className="lz-ayuda">{t(textos.ayuda)}</p>
        <div className="lz-fila">
          <div className="pn-abajo lz-sel">
            <Selector etiqueta={t("lanzar.modelo")} opciones={p.modelos} valor={modelo} alElegir={elegirModelo} disabled={yendo} />
          </div>
          <div className="pn-abajo lz-sel">
            <Selector
              etiqueta={t("lanzar.effort")}
              opciones={effortsOpciones(modelo)}
              valor={effort}
              alElegir={(e) => (setEffort(e), setTocado(true))}
              disabled={yendo}
            />
          </div>
          {p.tipo ? <span className="lz-tipo">{t("lanzar.tipo", { tipo: p.tipo })}</span> : null}
        </div>
        <textarea
          className="lz-texto"
          value={texto}
          rows={3}
          disabled={yendo}
          placeholder={t("lanzar.texto")}
          aria-label={t("lanzar.texto")}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            // Enter en el texto es un salto de línea; con Ctrl o Cmd lanza.
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void lanzar();
            }
          }}
        />
        {error ? (
          <p className="lz-error" role="alert">
            {error}
          </p>
        ) : null}
        <footer className="lz-pie">
          <span className="lz-pista">{t("lanzar.listo")}</span>
          <button type="button" className="btn2" disabled={yendo} onClick={cerrarPaso}>
            {t("lanzar.cancelar")}
          </button>
          <button ref={lanzarBtn} type="button" className="btn2" data-primario="" disabled={yendo} onClick={() => void lanzar()}>
            {yendo ? t("lanzar.lanzando") : t("lanzar.lanzar")}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
