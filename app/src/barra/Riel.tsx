// El riel de la barra (rediseño 0.4, maquetas/rediseno-0.4/barra-densa-b.html): 44 px a la izquierda con la marca, un monograma por
// proyecto que filtra la lista (× si algo falló, ? si algo te espera y un punto que late si algo corre: siempre con su nombre en el tooltip
// y su frase en el aria-label), los dos anillos de cupos y los íconos de los paneles. Una pestaña del color del proyecto, del lado del
// borde, dice cuál se está filtrando y cuál se está mirando: el hilo que sale del riel hacia la lista.
import { useEffect, useMemo, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { Folders, Home, PanelLeft } from "lucide-react";
import { GENERAL } from "../datos/contrato";
import { MODO } from "../modo";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { OTRAS } from "./claude-code";
import { useIconos } from "./Logo";
import { monogramas, tonoRiel } from "./logo-logica";
import { Marca } from "./Marca";
import { nombreCarpeta } from "./arbol";
import { Glifo } from "./Glifo";
import { latir } from "./latido";
import { useTitulos } from "./titulos";
import type { ItemRiel } from "./riel-logica";

type Props = {
  items: readonly ItemRiel[];
  /** El proyecto que filtra la lista; `null`: todos. */
  filtro: string | null;
  /** El proyecto de lo que está abierto a la derecha. */
  viendo: string | null;
  alFiltrar: (proyecto: string | null) => void;
  alOcultar: () => void;
  /** Clic derecho en el ícono de un proyecto. */
  alMenu: (proyecto: string, e: MouseEvent<HTMLButtonElement>) => void;
  /** Los anillos de cupos. */
  cupos: ReactNode;
  /** Los íconos de los paneles. */
  pie: ReactNode;
};

/** El color de un proyecto, el mismo en su cuadrado del riel y en su encabezado de la lista. */
export const estiloProyecto = (proyecto: string): CSSProperties => ({ "--h": tonoRiel(proyecto) }) as CSSProperties;

export function Riel({ items, filtro, viendo, alFiltrar, alMenu, alOcultar, cupos, pie }: Props) {
  useIdioma();
  const titulos = useTitulos();
  const iconos = useIconos();
  // Los monogramas, sin repetir. El orden es el del slug (no el del riel, que cambia con la actividad): el mismo proyecto, las mismas letras.
  const monogramaDe = useMemo(() => {
    const slugs = [...new Set(items.map((it) => it.proyecto))].filter((p) => p !== OTRAS && p !== GENERAL).sort();
    const letras = monogramas(slugs.map((p) => titulos[p] || p));
    return Object.fromEntries(slugs.map((p, i) => [p, letras[i]])) as Record<string, string>;
  }, [items, titulos]);
  const hayVivo = items.some((it) => it.vivo && !it.marca);
  useEffect(() => {
    if (hayVivo) latir();
  }, [hayVivo]);
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
              data-viendo={viendo === it.proyecto ? "" : undefined}
              aria-pressed={filtro === it.proyecto}
              aria-label={aria}
              data-tip={nombre}
              onClick={() => alFiltrar(filtro === it.proyecto ? null : it.proyecto)}
              onContextMenu={(e) => alMenu(it.proyecto, e)}
            >
              {otras ? (
                <Folders size={15} strokeWidth={2} aria-hidden="true" />
              ) : it.proyecto === GENERAL ? (
                <Home size={15} strokeWidth={2} aria-hidden="true" />
              ) : src ? (
                <img className="pr-img" src={src} alt="" draggable={false} />
              ) : (
                monogramaDe[it.proyecto].toLowerCase()
              )}
              {it.marca ? (
                <span className="marca" data-at={it.marca}>
                  <Glifo g={it.marca === "fallo" ? "falla" : "pide"} />
                </span>
              ) : it.vivo ? (
                <span className="vivo">
                  <span className="onda" />
                </span>
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
