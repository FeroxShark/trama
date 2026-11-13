// Estado compartido de cupos (uso, fallo, pausa, releer) para CuposRiel y PanelCupo.
import { useEffect, useState } from "react";
import type { Uso } from "../datos/contrato";
import { fuente } from "../datos/fuente";
import { t } from "../i18n";
import type { Pintor } from "../reloj";
import { pintorHace } from "../tiempo";

/** Después de un clic el botón de releer descansa esto. */
export const PAUSA_RELEER_MS = 5000;

export interface EstadoUso {
  /** `undefined`: todavía no llegó. `null`: llegó y no hay de dónde sacarlo. */
  uso: Uso | null | undefined;
  /** La última lectura a pedido falló: se muestra el dato previo apagado y avisando. */
  fallo: boolean;
  /** Cooldown activo tras pedir una relectura manual. */
  pausa: boolean;
  releer: () => void;
}

let estado: Omit<EstadoUso, "releer"> = {
  uso: undefined,
  fallo: false,
  pausa: false,
};

const oyentes = new Set<() => void>();
let soltarFuente: (() => void) | null = null;
let relojPausa = 0;

function emitir() {
  for (const fn of oyentes) fn();
}

function arrancar() {
  if (soltarFuente) return;
  let vivo = true;
  const soltar = fuente.alCambiarUso((u) => {
    estado = {
      ...estado,
      uso: u,
      fallo: u && !("error" in u) ? false : estado.fallo,
    };
    emitir();
  });
  soltarFuente = () => {
    vivo = false;
    soltar();
  };
  void fuente.uso().then(
    (u) => {
      if (!vivo) return;
      estado = { ...estado, uso: u };
      emitir();
    },
    () => {
      if (!vivo) return;
      estado = { ...estado, uso: null };
      emitir();
    },
  );
}

/** Pide releer el uso bajo demanda con enfriamiento compartido. */
export function releerUso() {
  if (estado.pausa) return;
  clearTimeout(relojPausa);
  estado = { ...estado, pausa: true };
  emitir();
  relojPausa = window.setTimeout(() => {
    estado = { ...estado, pausa: false };
    emitir();
  }, PAUSA_RELEER_MS);
  void fuente.releerUso().then(
    (u) => {
      if (u && !("error" in u)) {
        estado = { ...estado, uso: u, fallo: false };
      } else {
        const antes = estado.uso;
        // Sin nada anterior que mostrar, el error ocupa el lugar de los números.
        estado = {
          ...estado,
          fallo: true,
          uso: antes && !("error" in antes) ? antes : u,
        };
      }
      emitir();
    },
    () => {
      estado = { ...estado, fallo: true };
      emitir();
    },
  );
}

/** «Actualizado hace 2 m»; si la última lectura falló, «No se pudo actualizar · datos de hace 8 m». */
export const pintorActualizado =
  (ts: number, fallo: boolean): Pintor =>
  (a) => {
    const h = ts ? pintorHace(ts)(a) : null;
    if (fallo) return { texto: h ? t("riel.noActualizoVisto", { hace: h.texto }) : t("riel.noActualizo"), en: h?.en ?? Infinity };
    return { texto: h ? t("riel.actualizado", { hace: h.texto }) : "", en: h?.en ?? Infinity };
  };

export function useUso(): EstadoUso {
  const [snap, setSnap] = useState(estado);

  useEffect(() => {
    const actualizar = () => setSnap(estado);
    oyentes.add(actualizar);
    arrancar();
    setSnap(estado);
    return () => {
      oyentes.delete(actualizar);
      if (oyentes.size === 0) {
        soltarFuente?.();
        soltarFuente = null;
        clearTimeout(relojPausa);
        relojPausa = 0;
        estado = { uso: undefined, fallo: false, pausa: false };
      }
    };
  }, []);

  return { ...snap, releer: releerUso };
}
