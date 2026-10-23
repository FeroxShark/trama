// Qué máquinas hay y cómo están (electron/nucleo.ts `estadoMaquinas`): uno solo para el ícono de las filas y de la
// cabecera y para el aviso de la barra. Con una sola máquina configurada no hay nada que mostrar.
import { useSyncExternalStore } from "react";
import { fuente, type EstadoMaquina, type Maquinas } from "./datos/fuente";
import { t } from "./i18n";
import type { Opcion } from "./hilo/Selector";

let estado: Maquinas = { esta: { id: "pc", nombre: "PC" }, otras: [] };
let armado = false;
const oyentes = new Set<() => void>();

function poner(m: Maquinas) {
  estado = m;
  oyentes.forEach((f) => f());
}

function oir(fn: () => void) {
  if (!armado) {
    armado = true;
    // Si el main avisa antes de que conteste la primera lectura, vale el aviso.
    let avisado = false;
    fuente.alCambiarMaquinas((m) => {
      avisado = true;
      poner(m);
    });
    void fuente.maquinas().then((m) => !avisado && poner(m));
  }
  oyentes.add(fn);
  return () => void oyentes.delete(fn);
}

export const useMaquinas = () => useSyncExternalStore(oir, () => estado);

/** Hay más de una máquina configurada: sólo entonces las filas y la cabecera dicen de cuál son. */
export const hayVarias = (m: Maquinas) => m.otras.length > 0;

/** El nombre de una máquina por su id (el del `maquina` de una fila; sin él, la de esta trama). */
export function nombreMaquina(m: Maquinas, id: string | undefined): string {
  if (id === undefined || id === m.esta.id) return m.esta.nombre;
  return m.otras.find((o) => o.id === id)?.nombre ?? id;
}

/** Las otras que no están del todo bien: cada una con su aviso en la barra. */
export const conAviso = (m: Maquinas): { id: string; nombre: string; estado: EstadoMaquina }[] =>
  m.otras.filter((o) => o.estado === "sinConexion" || o.estado === "soloLectura");

/**
 * ¿Se le puede mandar algo a esa máquina (`undefined`: esta)? Sólo si está conectada y con el mismo build: en otra
 * versión se ve y nada más; caída o conectando, no hay a quién. Lo de acá, siempre.
 */
export const puedeMaquina = (m: Maquinas, id: string | undefined) => id === undefined || id === m.esta.id || m.otras.find((o) => o.id === id)?.estado === "conectada";

const ESTADO: Record<EstadoMaquina, "maquina.estadoConectando" | "maquina.estadoLectura" | "maquina.estadoCaida" | null> = {
  conectando: "maquina.estadoConectando",
  conectada: null,
  soloLectura: "maquina.estadoLectura",
  sinConexion: "maquina.estadoCaida",
};

/** Las opciones de un selector de máquina: esta primero; la que no está para recibir algo se ve, con su estado, y no se elige. */
export const opcionesMaquina = (m: Maquinas): Opcion[] => [
  { id: m.esta.id, nombre: m.esta.nombre, desc: "" },
  ...m.otras.map((o) => {
    const clave = ESTADO[o.estado];
    return { id: o.id, nombre: o.nombre, desc: clave ? t(clave) : "", deshabilitada: clave !== null };
  }),
];
