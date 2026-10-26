// El estado de las guías en el renderer: se lee una vez de preferencias.json (por `fuente`, o del almacenamiento local sin motor) y
// cada cambio se aplica acá al toque y se guarda. Lo comparten el globo (Guia.tsx) y Ajustes > Guía (AjustesGuia.tsx).
// Las capturas y las mediciones no recuerdan nada (MODO.datosFijos): lo que pasa en ellas no se guarda.
import { useSyncExternalStore } from "react";
import { fuente } from "../datos/fuente";
import { MODO } from "../modo";
import { aplicarOpGuias, GUIAS_VACIO, normalizarGuias, type EstadoGuias, type OpGuias } from "../../electron/guias-estado";

let estado: EstadoGuias = GUIAS_VACIO;
let cargado = false;
let cargando: Promise<void> | null = null;
const oyentes = new Set<() => void>();
const poner = (e: EstadoGuias) => {
  if (e === estado) return;
  estado = e;
  oyentes.forEach((o) => o());
};
const suscribir = (f: () => void) => (oyentes.add(f), () => void oyentes.delete(f));

/** Lee el estado guardado (una sola vez). Si la fuente no contesta, las guías quedan apagadas: mejor callar que molestar. */
export function cargarGuias(): Promise<void> {
  cargando ??= fuente
    .guias()
    .then((e) => poner(normalizarGuias(e)))
    .catch(() => poner({ off: true, vistas: {} }))
    .finally(() => {
      cargado = true;
      oyentes.forEach((o) => o());
    });
  return cargando;
}

export const guiasCargadas = () => cargado;
export const estadoGuias = () => estado;

/** Aplica un cambio al toque y lo guarda; lo que devuelve el motor (otro dispositivo pudo cambiar algo) pisa lo local. */
export function cambiarGuias(op: OpGuias) {
  poner(aplicarOpGuias(estado, op));
  if (MODO.datosFijos) return;
  pendientes++;
  // Con otro cambio en vuelo la respuesta llega vieja: sólo la última pisa lo local.
  const listo = (e: unknown) => {
    pendientes--;
    if (pendientes === 0 && e) poner(normalizarGuias(e));
  };
  void fuente.guardarGuias(op).then(listo, () => listo(null));
}
let pendientes = 0;

export function useGuias(): { estado: EstadoGuias; cargado: boolean } {
  const e = useSyncExternalStore(suscribir, () => estado);
  const c = useSyncExternalStore(suscribir, () => cargado);
  return { estado: e, cargado: c };
}
