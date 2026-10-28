// El logo de una carpeta, para ubicarla sin leer: el ícono del proyecto si el
// main encontró uno (electron/iconos.ts) o su monograma (logo-logica.ts). Los íconos
// se piden una vez y los comparten todas las carpetas.
import { useSyncExternalStore } from "react";
import { Home } from "lucide-react";
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

/** `titulo`: el del registry, si tiene; el monograma sale de él, el tono del slug (no cambia de color) y es el texto alternativo del ícono. */
export function Logo({ proyecto, titulo }: { proyecto: string; titulo?: string | null }) {
  const todos = useSyncExternalStore(suscribir, () => iconos);
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
