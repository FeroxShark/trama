// Reordenar la barra arrastrando con el botón izquierdo: un líder dentro de su carpeta, o una
// carpeta entre las demás. Como el borde de la barra, mientras dura se escribe directo en el DOM
// (ni un render de React por movimiento) y el orden se asienta al soltar (`alSoltar`).
//
// Se arrastra lo que trae `data-mueve` (su id) y `data-grupo` (entre quiénes se mueve), agarrado
// de su fila (`.lider`) o del nombre de la carpeta (`.proy-nom`). Empieza recién pasados unos
// píxeles: un clic sin mover sigue siendo un clic. Soltar afuera o Escape lo cancela. Sólo con
// mouse o lápiz: con el dedo, arrastrar es scrollear y mantener apretado es el menú (`tooltip.ts`).

/** El grupo de las carpetas; el de los líderes de una carpeta es `lider:<proyecto>` o `espera:<proyecto>`. */
export const CARPETAS = "carpetas";

export type Movida = { grupo: string; id: string; junto: string; antes: boolean };

type Opciones = {
  /** La raíz de la app: lleva `data-moviendo` mientras dura (cursor, sin selección de texto). */
  raiz: () => HTMLElement | null;
  /** La línea que marca dónde cae: un hijo de la lista, que acá sólo se ubica. */
  linea: () => HTMLElement | null;
  /** Falso mientras no se puede reordenar (buscando: ahí el orden es el de la búsqueda). */
  puede: () => boolean;
  alSoltar: (m: Movida) => void;
  /** Avisa cuándo empieza y cuándo termina un arrastre: mientras dura, la barra no reacomoda nada (`activas.ts`, `diferir`). */
  alArrastrar?: (si: boolean) => void;
};

/** Cuánto hay que mover para que deje de ser un clic. */
const UMBRAL = 5;
/** Cerca de un borde de la lista, cada movimiento la corre un poco. */
const BORDE = 28;
const PASO = 14;

export function armarArrastre(lista: HTMLElement, o: Opciones): () => void {
  let cortar: (() => void) | null = null;

  const bajar = (e: PointerEvent) => {
    if (e.button !== 0 || e.pointerType === "touch" || !e.isPrimary || cortar || !o.puede()) return;
    const asa = (e.target as Element | null)?.closest?.(".lider, .proy-nom");
    const unidad = asa?.closest<HTMLElement>("[data-mueve]");
    const grupo = unidad?.dataset.grupo;
    const id = unidad?.dataset.mueve;
    if (!asa || !unidad || !grupo || !id || (grupo === CARPETAS) !== asa.classList.contains("proy-nom")) return;
    const hermanos = () => [...lista.querySelectorAll<HTMLElement>("[data-grupo]")].filter((x) => x.dataset.grupo === grupo);
    if (hermanos().length < 2) return;

    const x0 = e.clientX;
    const y0 = e.clientY;
    let x = x0;
    let y = y0;
    let moviendo = false;
    let destino: Movida | null = null;
    const linea = o.linea();

    const esconder = () => {
      destino = null;
      linea?.removeAttribute("data-ve");
    };

    // Dónde caería con el puntero en (x, y): entre qué dos hermanos, y la línea ahí.
    const ubicar = () => {
      if (!unidad.isConnected) return terminar(false);
      const L = lista.getBoundingClientRect();
      // Un líder no cambia de carpeta arrastrando: fuera de la suya es afuera.
      const marco = grupo === CARPETAS ? L : (unidad.closest(".proy")?.getBoundingClientRect() ?? L);
      if (x < L.left || x > L.right || y < Math.max(L.top, marco.top) || y > Math.min(L.bottom, marco.bottom)) return esconder();
      const hs = hermanos();
      const cajas = hs.map((h) => h.getBoundingClientRect());
      const yo = hs.indexOf(unidad);
      const i = cajas.filter((c) => (c.top + c.bottom) / 2 < y).length;
      // Justo antes o justo después de sí mismo no mueve nada: sin línea.
      if (yo < 0 || hs.length < 2 || i === yo || i === yo + 1) return esconder();
      const hueco = Math.min(6, Math.max(1, (cajas[1].top - cajas[0].bottom) / 2));
      const corte = i === 0 ? cajas[0].top - hueco : i === hs.length ? cajas[i - 1].bottom + hueco : (cajas[i - 1].bottom + cajas[i].top) / 2;
      const junto = hs[Math.min(i, hs.length - 1)].dataset.mueve;
      if (!junto) return esconder();
      destino = { grupo, id, junto, antes: i < hs.length };
      if (!linea) return;
      const caja = cajas[yo];
      linea.style.width = `${caja.width}px`;
      linea.style.transform = `translate(${caja.left - L.left - lista.clientLeft + lista.scrollLeft}px, ${corte - L.top - lista.clientTop + lista.scrollTop}px)`;
      linea.setAttribute("data-ve", "");
    };

    const empezar = () => {
      moviendo = true;
      o.alArrastrar?.(true);
      try {
        lista.setPointerCapture(e.pointerId);
      } catch {
        // El puntero ya no está: se sigue por los eventos de la ventana.
      }
      o.raiz()?.setAttribute("data-moviendo", "");
      unidad.setAttribute("data-movida", "");
      window.addEventListener("keydown", tecla, true);
      lista.addEventListener("scroll", ubicar);
    };

    const mover = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      x = ev.clientX;
      y = ev.clientY;
      if (!moviendo) {
        if (Math.hypot(x - x0, y - y0) < UMBRAL) return;
        empezar();
      }
      const L = lista.getBoundingClientRect();
      if (x >= L.left && x <= L.right) {
        if (y > L.top && y < L.top + BORDE) lista.scrollTop -= PASO;
        else if (y < L.bottom && y > L.bottom - BORDE) lista.scrollTop += PASO;
      }
      ubicar();
    };

    const terminar = (soltado: boolean) => {
      const m = soltado && moviendo ? destino : null;
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", subir);
      window.removeEventListener("pointercancel", cancelar);
      window.removeEventListener("blur", cancelar);
      window.removeEventListener("keydown", tecla, true);
      lista.removeEventListener("scroll", ubicar);
      cortar = null;
      if (moviendo) {
        o.alArrastrar?.(false);
        esconder();
        o.raiz()?.removeAttribute("data-moviendo");
        unidad.removeAttribute("data-movida");
        if (lista.hasPointerCapture(e.pointerId)) lista.releasePointerCapture(e.pointerId);
        // El clic que cierra el arrastre no abre la fila ni pliega la carpeta.
        const tragar = (c: MouseEvent) => {
          c.stopPropagation();
          c.preventDefault();
        };
        window.addEventListener("click", tragar, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", tragar, true), 0);
      }
      if (m) o.alSoltar(m);
    };
    const subir = (ev: PointerEvent) => {
      if (ev.pointerId === e.pointerId) terminar(true);
    };
    const cancelar = () => terminar(false);
    const tecla = (k: KeyboardEvent) => {
      if (k.key !== "Escape") return;
      // Escape es del arrastre: no cierra el panel ni lo abierto.
      k.preventDefault();
      k.stopImmediatePropagation();
      terminar(false);
    };

    cortar = cancelar;
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", subir);
    window.addEventListener("pointercancel", cancelar);
    window.addEventListener("blur", cancelar);
  };

  lista.addEventListener("pointerdown", bajar);
  return () => {
    lista.removeEventListener("pointerdown", bajar);
    cortar?.();
  };
}
