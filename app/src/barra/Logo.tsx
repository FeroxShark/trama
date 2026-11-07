// El logo de una carpeta, para ubicarla sin leer: el ícono del proyecto si el
// main encontró uno (electron/iconos.ts) o su monograma (logo-logica.ts). Los íconos
// se piden una vez y los comparten todas las carpetas.
import { useSyncExternalStore } from "react";
import { Folder, Folders, Home } from "lucide-react";
import { GENERAL } from "../datos/contrato";
import { fuente } from "../datos/fuente";
import { monograma, tono } from "./logo-logica";

/** slug → data URL. `null`: todavía no llegaron (no se pinta el monograma para después cambiarlo). */
let iconos: Record<string, string> | null = null;
let pedido = false;
const oyentes = new Set<() => void>();

function poner(i: Record<string, string>) {
  iconos = i;
  oyentes.forEach((f) => f());
}

function suscribir(fn: () => void) {
  oyentes.add(fn);
  if (!pedido) {
    pedido = true;
    void fuente.iconos().then(poner, () => poner({}));
  }
  return () => void oyentes.delete(fn);
}

/** Vuelve a pedir los íconos (después de elegir o quitar el logo de un proyecto en Ajustes). */
export async function recargarIconos() {
  pedido = true;
  poner(await fuente.iconos().catch(() => iconos ?? {}));
}

/** Un ícono que no se pudo pintar deja su lugar al monograma. */
function descartar(proyecto: string) {
  if (!iconos?.[proyecto]) return;
  const { [proyecto]: _, ...resto } = iconos;
  poner(resto);
}

/** Los íconos de los proyectos (slug → data URL); `null`, todavía no llegaron. */
export const useIconos = () => useSyncExternalStore(suscribir, () => iconos);

/** `titulo`: el del registry, si tiene; el monograma sale de él, el tono del slug (no cambia de color) y es el texto alternativo del ícono. */
export function Logo({ proyecto, titulo }: { proyecto: string; titulo?: string | null }) {
  const todos = useIconos();
  // General no es un proyecto: son las sesiones que corren en el home.
  if (proyecto === GENERAL)
    return (
      <span className="logo" data-neutro="">
        <Home size={10} strokeWidth={2.2} />
      </span>
    );
  if (!todos) return <span className="logo" />;
  const src = todos[proyecto];
  if (src) return <img className="logo" src={src} alt={titulo || proyecto} draggable={false} onError={() => descartar(proyecto)} />;
  return (
    <span className="logo" style={{ background: tono(proyecto) }} aria-hidden="true">
      {monograma(titulo || proyecto)}
    </span>
  );
}

/**
 * El logo chico de una carpeta (cabecera de la barra y selector de carpeta del líder): el mismo ícono del riel y, sin ícono, sus iniciales sobre el
 * tono del proyecto (`--h`, de `estiloProyecto`). Decorativo: el nombre siempre está al lado. `otras`: la carpeta que junta varias; `generico`: algo
 * que no es un proyecto del registry (Auto, Otra carpeta…), con la carpeta genérica. `icono`: el tamaño (px) de los íconos de respaldo.
 */
export function LogoCab({ proyecto, titulo, otras = false, generico = false, personal = false, icono = 11 }: { proyecto?: string; titulo?: string | null; otras?: boolean; generico?: boolean; personal?: boolean; icono?: number }) {
  const src = useIconos()?.[proyecto ?? ""];
  return (
    <span className="proy-logo" aria-hidden="true">
      {otras ? (
        <Folders size={icono} strokeWidth={2} />
      ) : personal || proyecto === GENERAL ? (
        <Home size={icono} strokeWidth={2} />
      ) : generico || !proyecto ? (
        <Folder size={icono} strokeWidth={2} />
      ) : src ? (
        <img src={src} alt="" draggable={false} />
      ) : (
        monograma(titulo || proyecto).toLowerCase()
      )}
    </span>
  );
}
