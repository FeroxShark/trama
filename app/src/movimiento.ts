// El movimiento de Trama, en un solo lugar: duraciones, resortes, desplazamientos y escalonado. Todo lo que se anima (paneles, modales,
// mensajes nuevos, botones, listas) sale de acá; nada de duraciones sueltas nuevas. `movimiento-estilos.css` espeja estos valores para lo que
// se anima en CSS (`tests/movimiento.test.ts` comprueba que coinciden). Sólo `transform` y `opacity`: nunca width/height.
// Con `prefers-reduced-motion` no hay desplazamiento ni escala: sólo fundidos (`reducido`, y en CSS las variables `--mov-desp`/`--mov-pulsa`).
import { useEffect, useState } from "react";

/** Resorte de las filas de la barra (el de siempre): rápido y seco. */
export const RESORTE = { type: "spring", stiffness: 520, damping: 42, mass: 1 } as const;
/** Paneles, modales y mensajes: entra con un leve desplazamiento, sin rebote marcado (ζ ≈ 0,87). */
export const RESORTE_SUAVE = { type: "spring", stiffness: 380, damping: 34, mass: 1 } as const;
/** Botones al apretar: más corto todavía. */
export const RESORTE_CORTO = { type: "spring", stiffness: 700, damping: 46, mass: 1 } as const;

/** Duraciones en milisegundos. Lo que sale dura menos de lo que tarda en entrar. */
export const DUR = {
  /** Un panel, un modal o un mensaje terminando de entrar. */
  entra: 280,
  /** Lo mismo, yéndose. */
  sale: 140,
  /** Un fundido sin movimiento (reduced-motion, fondos). */
  fundido: 160,
  /** Un botón apretado. */
  boton: 200,
} as const;

/** Cuánto se desplaza lo que entra, en píxeles. */
export const DESPLAZA = { panel: 8, mensaje: 8, lista: 6 } as const;
/** El botón apretado se achica a esto. */
export const ESCALA_BOTON = 0.97;

/** Listas que aparecen: un retardo por elemento, y de `max` en adelante entran juntos. */
export const ESCALON = { paso: 28, max: 8 } as const;

/** Resortes en CSS (`linear()` sobre la curva de cada resorte de arriba): los dos únicos que usa `movimiento-estilos.css`. */
export const CURVA_SUAVE = "linear(0, 0.044, 0.145, 0.271, 0.4, 0.522, 0.629, 0.719, 0.793, 0.851, 0.896, 0.93, 0.955, 0.973, 0.985, 0.993, 0.998, 1.001, 1)";
export const CURVA_CORTA = "linear(0, 0.057, 0.185, 0.335, 0.482, 0.611, 0.719, 0.804, 0.868, 0.915, 0.948, 0.971, 0.985, 0.994, 1)";

/** El retardo (en segundos, como pide motion) del elemento `i` de una lista; pasado el máximo, ninguno extra. */
export const retardo = (i: number, reducir = false) => (reducir ? 0 : (Math.min(Math.max(i, 0), ESCALON.max - 1) * ESCALON.paso) / 1000);

/** El valor de un desplazamiento según la preferencia: sin movimiento, cero. */
export const desplaza = (px: number, reducir: boolean) => (reducir ? 0 : px);

/** Lo que dura un fundido cuando se pide no mover nada. */
const FUNDIDO = { duration: DUR.fundido / 1000, ease: "easeOut" } as const;

/** Cómo entra y sale un panel (para motion): desplazamiento + fundido con resorte; se va más rápido de lo que llegó. */
export function variantesPanel(reducir: boolean) {
  const y = desplaza(DESPLAZA.panel, reducir);
  return {
    initial: { opacity: 0, y },
    animate: { opacity: 1, y: 0, transition: reducir ? FUNDIDO : RESORTE_SUAVE },
    exit: { opacity: 0, y: desplaza(DESPLAZA.panel / 2, reducir), transition: { duration: DUR.sale / 1000, ease: "easeIn" as const } },
  };
}

/** Un elemento de una lista que aparece: el índice decide el retardo (escalonado hasta `ESCALON.max`). */
export function variantesLista(i: number, reducir: boolean) {
  return {
    initial: { opacity: 0, y: desplaza(DESPLAZA.lista, reducir) },
    animate: { opacity: 1, y: 0, transition: { ...(reducir ? FUNDIDO : RESORTE_SUAVE), delay: retardo(i, reducir) } },
  };
}

/** `prefers-reduced-motion: reduce` ahora mismo, y al cambiar. */
export const reducido = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useReducido(): boolean {
  const [r, setR] = useState(reducido);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const m = matchMedia("(prefers-reduced-motion: reduce)");
    const alCambiar = () => setR(m.matches);
    m.addEventListener("change", alCambiar);
    return () => m.removeEventListener("change", alCambiar);
  }, []);
  return r;
}

/** Cuánto esperar tras abrir una conversación para que sus mensajes nuevos se animen (lo que ya estaba no se anima). */
export const ASIENTA_MS = 700;

/**
 * Verdadero cuando la conversación `clave` ya terminó de abrirse: pasan `ASIENTA_MS` desde que tiene contenido. Los mensajes que
 * llegan después entran con `movimiento-estilos.css`; lo que se cargó al abrir (el historial) aparece quieto. Cambia `clave`, vuelve a empezar.
 */
export function useAsentado(clave: string | null | undefined, hayContenido: boolean): boolean {
  const [listo, setListo] = useState<string | null>(null);
  useEffect(() => {
    if (!clave || !hayContenido) return;
    const id = setTimeout(() => setListo(clave), ASIENTA_MS);
    return () => clearTimeout(id);
  }, [clave, hayContenido]);
  return !!clave && listo === clave;
}

/**
 * Cerrar un modal con la salida corta: marca `saliendo` (el CSS lo funde en `DUR.sale`) y llama a `alCerrar` cuando termina. Un segundo
 * llamado mientras sale no hace nada. Devuelve `[cerrar, saliendo]`.
 */
export function useSalida(alCerrar: () => void): readonly [() => void, boolean] {
  const [saliendo, setSaliendo] = useState(false);
  useEffect(() => {
    if (!saliendo) return;
    const id = setTimeout(alCerrar, DUR.sale);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saliendo]);
  return [() => setSaliendo(true), saliendo] as const;
}
