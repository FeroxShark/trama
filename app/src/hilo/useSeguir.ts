// El chat sigue su fondo mientras llega contenido (src/hilo/seguir.ts): el
// evento `scroll` de la zona dice si el usuario subió o volvió al final, y un
// ResizeObserver sobre lo de adentro la deja al fondo cada vez que crece (un
// paso nuevo, el texto que llega, una imagen que termina de cargar, el "qué
// hace" que aparece). El observer corre antes de pintar: no se ve el salto.
import { useEffect, useRef, type RefObject } from "react";
import { alScroll, seguidor, seguir, type Seguidor } from "./seguir";

export function useSeguir(zona: RefObject<HTMLElement | null>): Seguidor {
  const s = useRef<Seguidor | null>(null);
  s.current ??= seguidor();
  const seg = s.current;
  useEffect(() => {
    const z = zona.current;
    const adentro = z?.firstElementChild;
    if (!z || !adentro) return;
    const mover = () => alScroll(z, seg);
    z.addEventListener("scroll", mover, { passive: true });
    const ro = new ResizeObserver(() => seguir(z, seg));
    ro.observe(adentro);
    // Si cambia el alto de la zona (la caja crece, la ventana se achica), el fondo también se corre.
    ro.observe(z);
    return () => {
      z.removeEventListener("scroll", mover);
      ro.disconnect();
    };
  }, [zona, seg]);
  return seg;
}
