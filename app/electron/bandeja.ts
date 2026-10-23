// El ícono de trama en la bandeja del sistema (StatusNotifierItem): clic trae la ventana, clic derecho abre el menú con
// Abrir y Cerrar del todo. Sin Electron para probarlo con fakes: main.ts le pasa `Tray` y `Menu`. Los textos los traduce el
// renderer con `t()` y se los manda por `bandeja:textos` (acá no hay diccionario); hasta que lleguen no hay menú.

import type { EstadoEspera } from "./espera-aviso.js";

export type Textos = { abrir: string; cerrar: string };
export type Item = { label?: string; type?: "separator"; click?: () => void };
export type Icono = {
  setToolTip(t: string): void;
  setContextMenu(m: unknown): void;
  on(ev: "click", fn: () => void): unknown;
  destroy(): void;
  setImage?(i: unknown): void;
};

export type Bandeja = { textos(t: Textos): void; espera(e: EstadoEspera): void; destruir(): void };

export function armarBandeja(o: {
  crear: () => Icono;
  menu: (items: Item[]) => unknown;
  abrir: () => void;
  cerrarDelTodo: () => void;
  nombre?: string;
  /** El ícono de siempre y el que lleva un punto cuando algún líder espera (sin esto, sólo cambia el tooltip). */
  imagenes?: { normal: unknown; espera: unknown };
}): Bandeja {
  const icono = o.crear();
  const nombre = o.nombre ?? "trama";
  icono.setToolTip(nombre);
  icono.on("click", o.abrir);
  return {
    textos(t) {
      icono.setContextMenu(o.menu([{ label: t.abrir, click: o.abrir }, { type: "separator" }, { label: t.cerrar, click: o.cerrarDelTodo }]));
    },
    // Alguien espera: el tooltip lo dice y el ícono lleva un punto; nadie, como siempre.
    espera(e) {
      icono.setToolTip(e.n > 0 ? e.texto || nombre : nombre);
      if (o.imagenes) icono.setImage?.(e.n > 0 ? o.imagenes.espera : o.imagenes.normal);
    },
    destruir: () => icono.destroy(),
  };
}

/** Lo que llega por `bandeja:textos`: dos textos no vacíos, o `null`. */
export function textosValidos(x: unknown): Textos | null {
  const o = x as { abrir?: unknown; cerrar?: unknown } | null;
  return typeof o?.abrir === "string" && o.abrir.trim() && typeof o.cerrar === "string" && o.cerrar.trim() ? { abrir: o.abrir.slice(0, 80), cerrar: o.cerrar.slice(0, 80) } : null;
}
