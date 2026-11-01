// El riel de la barra (rediseño 0.4, maquetas/rediseno-0.4/barra-densa-b.html): 44 px a la izquierda con la marca, un monograma por
// proyecto que filtra la lista (× si algo falló, ? si algo te espera y un punto si algo corre: siempre con su nombre en el tooltip y su
// frase en el aria-label), los dos anillos de cupos y los íconos de los paneles.
import type { CSSProperties, ReactNode } from "react";
import { Folders, Home, PanelLeft } from "lucide-react";
import { GENERAL } from "../datos/contrato";
import { MODO } from "../modo";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { OTRAS } from "./claude-code";
import { useIconos } from "./Logo";
import { monograma, tonoRiel } from "./logo-logica";
import { Marca } from "./Marca";
import { nombreCarpeta } from "./arbol";
import { Glifo } from "./Glifo";
import { useTitulos } from "./titulos";
import type { ItemRiel } from "./riel";

type Props = {
  items: readonly ItemRiel[];
  /** El proyecto que filtra la lista; `null`: todos. */
  filtro: string | null;
  alFiltrar: (proyecto: string | null) => void;
  alOcultar: () => void;
  /** Los anillos de cupos. */
  cupos: ReactNode;
  /** Los íconos de los paneles. */
  pie: ReactNode;
};

/** El color de un proyecto, el mismo en su cuadrado del riel y en su encabezado de la lista. */
export const estiloProyecto = (proyecto: string): CSSProperties => ({ "--h": tonoRiel(proyecto) }) as CSSProperties;

export function Riel({ items, filtro, alFiltrar, alOcultar, cupos, pie }: Props) {
  useIdioma();
  const titulos = useTitulos();
  const iconos = useIconos();
  return (
    <div className="riel">
      <button type="button" className="riel-logo" aria-label={t("riel.ocultar")} data-tip={t("riel.ocultar")} onClick={alOcultar}>
        <Marca className="riel-marca" />
        <PanelLeft className="riel-ocultar" size={18} strokeWidth={1.8} aria-hidden="true" />
      </button>
      <nav className="riel-proys" aria-label={t("riel.aria")} data-guia="riel">
        <button type="button" className="pr todos" aria-pressed={filtro === null} data-tip={t("riel.todoTip")} onClick={() => alFiltrar(null)}>
          {t("riel.todo")}
        </button>
        {items.map((it) => {
          const otras = it.proyecto === OTRAS;
          const nombre = otras ? t("barra.otrasCarpetas") : nombreCarpeta(it.proyecto, MODO.usuario, t("barra.home"), titulos[it.proyecto]);
          const src = iconos?.[it.proyecto];
          const aria = it.marca === "fallo" ? t("riel.falla", { nombre }) : it.marca === "decision" ? t("riel.pide", { nombre }) : it.vivo ? t("riel.vivo", { nombre }) : nombre;
          return (
            <button
              key={it.proyecto}
              type="button"
              className="pr"
              style={estiloProyecto(it.proyecto)}
              data-proy={it.proyecto}
              data-apagado={it.apagado ? "" : undefined}
              aria-pressed={filtro === it.proyecto}
              aria-label={aria}
              data-tip={nombre}
              onClick={() => alFiltrar(filtro === it.proyecto ? null : it.proyecto)}
            >
              {otras ? (
                <Folders size={15} strokeWidth={2} aria-hidden="true" />
              ) : it.proyecto === GENERAL ? (
                <Home size={15} strokeWidth={2} aria-hidden="true" />
              ) : src ? (
                <img className="pr-img" src={src} alt="" draggable={false} />
              ) : (
                monograma(titulos[it.proyecto] || it.proyecto).toLowerCase()
              )}
              {it.marca ? (
                <span className="marca" data-at={it.marca}>
                  <Glifo g={it.marca === "fallo" ? "falla" : "pide"} />
                </span>
              ) : it.vivo ? (
                <span className="vivo" />
              ) : null}
            </button>
          );
        })}
      </nav>
      {cupos}
      {pie}
    </div>
  );
}
