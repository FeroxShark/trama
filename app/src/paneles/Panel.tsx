// Los paneles del pie de la barra (Ajustes, Ramas, Estadísticas, Tablero): ocupan
// el lado derecho, donde va la conversación. Esc o "Volver" los cierra.
import { lazy, Suspense, useRef } from "react";
import { useFoco } from "../foco";
import type { PropsRamas } from "./Ramas";
import type { PropsTablero } from "./Tablero";
import { AvisoLecciones } from "./Lecciones";
import { t, type ClaveSola } from "../i18n";
import { useIdioma } from "../i18n/react";
import { Fijo } from "../i18n/Fijo";
import { Lado } from "../hilo/Lado";
import "./paneles.css";
import "./lavado.css";
import "./ajustes-vidrio.css";
import "./paneles-vidrio.css";

// Ajustes, Ramas, Estadísticas y el Tablero se cargan al abrirse (chunk aparte): no pesan en el arranque.
const Ajustes = lazy(() => import("./Ajustes").then((m) => ({ default: m.Ajustes })));
const Ramas = lazy(() => import("./Ramas").then((m) => ({ default: m.Ramas })));
const Tablero = lazy(() => import("./Tablero").then((m) => ({ default: m.Tablero })));
const TableroNuevo = lazy(() => import("./TableroNuevo").then((m) => ({ default: m.TableroNuevo })));
const Estadisticas = lazy(() => import("./Estadisticas").then((m) => ({ default: m.Estadisticas })));

export type CualPanel = "ajustes" | "ramas" | "estadisticas" | "tablero";

export const PANELES: Record<CualPanel, ClaveSola> = {
  ajustes: "panel.ajustes",
  ramas: "panel.ramas",
  estadisticas: "panel.estadisticas",
  tablero: "panel.tablero",
};

type Props = {
  cual: CualPanel;
  barraAbierta: boolean;
  alAlternarBarra: () => void;
  alVolver: () => void;
  ramas: PropsRamas;
  tablero: PropsTablero;
};

export function Panel({ cual, barraAbierta, alAlternarBarra, alVolver, ramas, tablero }: Props) {
  useIdioma();
  // El foco entra al panel al abrirlo (Tab sigue por su contenido) y, al cerrarlo, vuelve al botón del pie que lo abrió; Esc lo maneja la barra.
  const raiz = useRef<HTMLElement>(null);
  useFoco(raiz, { atrapar: false, enfocar: "raiz" });
  const lado = barraAbierta ? t("panel.ocultarBarra") : t("panel.mostrarBarra");
  return (
    <main ref={raiz} className="hilo pn-main" data-panel={cual} tabIndex={-1} aria-label={t(PANELES[cual])}>
      <header className="migas">
        <Lado etq={lado} alAlternar={alAlternarBarra} />
        <div className="ruta" data-desliza>
          <b>{t(PANELES[cual])}</b>
        </div>
        <button type="button" className="btn2 pn-volver" onClick={alVolver}>
          <Fijo k="panel.volver" /> <kbd>Esc</kbd>
        </button>
      </header>
      <div className="conv-zona">
        {/* La clave: al cambiar de panel el contenido entra de nuevo. */}
        <div key={cual} className={cual === "tablero" ? "pn pn-tablero" : cual === "ajustes" ? "pn pn-ajustes" : "pn"} data-desliza>
          {cual === "ajustes" ? (
            <Suspense fallback={null}>
              <Ajustes />
            </Suspense>
          ) : cual === "ramas" ? (
            <Suspense fallback={null}>
              <Ramas {...ramas} />
            </Suspense>
          ) : cual === "estadisticas" ? (
            <Suspense fallback={null}>
              <Estadisticas />
            </Suspense>
          ) : (
            // El tablero nuevo (lo que le toca al usuario); el kanban de siempre es su pestaña "Todo".
            <>
              <AvisoLecciones />
              <Suspense fallback={null}>
                <TableroNuevo todo={<Tablero {...tablero} />} carpetas={tablero.carpetas} lideres={tablero.lideres} alRedactar={tablero.alRedactar} avisar={tablero.avisar} />
              </Suspense>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
