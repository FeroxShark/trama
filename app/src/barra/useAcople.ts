// Estado persistido del acomodo de paneles acoplables (src/barra/acople-logica.ts).
// Lee de localStorage[CLAVE_ACOPLE] o migra desde hilos:barra:ancho y hilos:barra:abierta; cada cambio se guarda.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MODO } from "../modo";
import {
  CLAVE_ACOPLE,
  abrir as abrirLogica,
  acopleDeFabrica,
  alternarPlegado,
  cerrar as cerrarLogica,
  leerAcople,
  mover as moverLogica,
  normalizar,
  redimensionar as redimensionarLogica,
  repartir as repartirLogica,
  restablecerPartes as restablecerPartesLogica,
  restablecerZona as restablecerZonaLogica,
  type Acople,
  type PanelId,
  type Zona,
} from "./acople-logica";

export type UseAcople = {
  acople: Acople;
  mover: (panel: PanelId, zona: Zona, indice?: number) => void;
  cerrar: (panel: PanelId) => void;
  abrir: (panel: PanelId, desplegar?: boolean) => void;
  plegar: (panel: PanelId) => void;
  redimensionar: (zona: Zona, px: number, limite?: number) => void;
  repartir: (zona: Zona, panelDeArriba: PanelId, deltaPx: number, largoZona: number) => void;
  restablecerZona: (zona: Zona) => void;
  restablecerPartes: (zona: Zona) => void;
  restablecer: () => void;
};

const leerStorage = (clave: string): string | null => {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
};

export function useAcople(inicial?: Acople, opciones?: { desactivar?: boolean }): UseAcople {
  const desactivado = Boolean(opciones?.desactivar);
  const sucio = useRef(false);

  const [acople, setAcople] = useState<Acople>(() => {
    if (desactivado) return acopleDeFabrica();
    if (inicial !== undefined) return normalizar(inicial);
    if (MODO.datosFijos) return acopleDeFabrica();
    return leerAcople(leerStorage);
  });

  useEffect(() => {
    if (!sucio.current || desactivado || MODO.datosFijos) return;
    try {
      localStorage.setItem(CLAVE_ACOPLE, JSON.stringify(acople));
    } catch {
      // sin espacio o almacenamiento bloqueado
    }
  }, [acople, desactivado]);

  const aplicar = useCallback((fn: (prev: Acople) => Acople) => {
    sucio.current = true;
    setAcople(fn);
  }, []);

  const mover = useCallback(
    (panel: PanelId, zona: Zona, indice?: number) => aplicar((a) => moverLogica(a, panel, zona, indice)),
    [aplicar],
  );
  const cerrar = useCallback((panel: PanelId) => aplicar((a) => cerrarLogica(a, panel)), [aplicar]);
  const abrir = useCallback(
    (panel: PanelId, desplegar = false) =>
      aplicar((a) => {
        const abierto = abrirLogica(a, panel);
        return desplegar && abierto.plegados.includes(panel) ? alternarPlegado(abierto, panel) : abierto;
      }),
    [aplicar],
  );
  const plegar = useCallback((panel: PanelId) => aplicar((a) => alternarPlegado(a, panel)), [aplicar]);
  const redimensionar = useCallback(
    (zona: Zona, px: number, limite?: number) => aplicar((a) => redimensionarLogica(a, zona, px, limite)),
    [aplicar],
  );
  const repartir = useCallback(
    (zona: Zona, panelDeArriba: PanelId, deltaPx: number, largoZona: number) =>
      aplicar((a) => repartirLogica(a, zona, panelDeArriba, deltaPx, largoZona)),
    [aplicar],
  );
  const restablecerZona = useCallback((zona: Zona) => aplicar((a) => restablecerZonaLogica(a, zona)), [aplicar]);
  const restablecerPartes = useCallback((zona: Zona) => aplicar((a) => restablecerPartesLogica(a, zona)), [aplicar]);
  const restablecer = useCallback(() => aplicar(() => acopleDeFabrica()), [aplicar]);

  return useMemo(
    () => ({
      acople,
      mover,
      cerrar,
      abrir,
      plegar,
      redimensionar,
      repartir,
      restablecerZona,
      restablecerPartes,
      restablecer,
    }),
    [acople, mover, cerrar, abrir, plegar, redimensionar, repartir, restablecerZona, restablecerPartes, restablecer],
  );
}
