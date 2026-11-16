// El cierre por cupo de cada chat que ve la ventana, por líder (lo manda el main: electron/cierre-chats.ts). Fuera de los componentes a propósito:
// la tarjeta sobrevive a cambiar de chat y se lee igual al volver. Lo lee `useCierre`; en las capturas `lider-cierre` salen fixtures.
import { useEffect, useReducer } from "react";
import type { CierreVisto } from "../../electron/cierre-chats";
import { fuente } from "../datos/fuente";
import { MODO } from "../modo";

const estados = new Map<string, CierreVisto>();
const oyentes = new Set<() => void>();
let suscrito = false;
const avisar = () => oyentes.forEach((f) => f());

function poner(lista: CierreVisto[]) {
  estados.clear();
  for (const c of lista) estados.set(c.sid, c);
  avisar();
}

function asegurar() {
  if (suscrito) return;
  suscrito = true;
  fuente.alCierreLider(poner);
  void fuente.liderCierres().then(poner);
}

/** La captura `lider-cierre`: el chat de la captura, cerrado por cupo (variante `cerrando`, `cerrada` o `apagado`). */
export function cierreDeCaptura(sid: string, variante: string | null, ahora = Math.floor(Date.now() / 1000)): CierreVisto {
  const cerrando = variante === "cerrando";
  return {
    sid,
    proveedor: "claude",
    cuenta: "claude",
    ventana: "5h",
    restante: 4,
    vuelve: ahora + 2 * 3600 + 14 * 60,
    desde: ahora - 600,
    estado: cerrando ? "cerrando" : "cerrado",
    retomar: variante !== "apagado",
    relevo: "~/.local/state/trama/relevos/resumen.md",
    duenoEscribio: false,
    retomado: false,
    fase: cerrando ? "cerrando" : "cerrado",
  };
}

/** El cierre de ese chat, o `null` si no cerró por cupo. */
export function useCierre(sid: string): CierreVisto | null {
  const [, tocar] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    asegurar();
    oyentes.add(tocar);
    return () => void oyentes.delete(tocar);
  }, []);
  if (MODO.captura === "lider-cierre") return sid ? cierreDeCaptura(sid, MODO.variante) : null;
  return (sid && estados.get(sid)) || null;
}

/** «Retomar solo cuando vuelva el cupo» de ese chat; se ve de inmediato y el main lo guarda. */
export function ponerRetomar(sid: string, on: boolean) {
  const c = estados.get(sid);
  if (c) {
    estados.set(sid, { ...c, retomar: on });
    avisar();
  }
  void fuente.ponerRetomarCierre(sid, on);
}
