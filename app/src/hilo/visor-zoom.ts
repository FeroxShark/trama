// Lógica pura del visor de imágenes (src/hilo/VerArchivo.tsx): ajuste al área disponible,
// zoom hacia un punto, límites de arrastre y cursor. Sin DOM ni React: la prueba tests/visor-zoom.test.ts.

export type Tamano = { ancho: number; alto: number };
export type Punto = { x: number; y: number };

export const ZOOM_MAX = 8;
export const ZOOM_MIN_PISO = 0.1;
export const PASO_RUEDA = 1.18;
export const PASO_BOTON = 1.25;
export const PASO_TECLA_PAN = 48;

const EPSILON_ESCALA = 0.005;
const EPSILON_PAN = 0.5;

/** Escala inicial ("Ajustar"): entra entera en el área sin agrandar imágenes más chicas. */
export function escalaAjuste(imgAncho: number, imgAlto: number, areaAncho: number, areaAlto: number): number {
  if (imgAncho <= 0 || imgAlto <= 0 || areaAncho <= 0 || areaAlto <= 0) return 1;
  return Math.min(1, areaAncho / imgAncho, areaAlto / imgAlto);
}

/** Zoom mínimo permitido: como mucho 10 %, o la escala de ajuste si la imagen es enorme. */
export function escalaMinima(ajuste: number): number {
  return Math.min(ZOOM_MIN_PISO, ajuste);
}

/** ¿La imagen pintada excede el área disponible en algún eje? */
export function puedeArrastrar(imgAncho: number, imgAlto: number, escala: number, areaAncho: number, areaAlto: number): boolean {
  if (imgAncho <= 0 || imgAlto <= 0 || areaAncho <= 0 || areaAlto <= 0) return false;
  return imgAncho * escala > areaAncho + EPSILON_PAN || imgAlto * escala > areaAlto + EPSILON_PAN;
}

/** Limita el desplazamiento (`pan`) para no mostrar huecos vacíos ni perder la imagen. */
export function limitarPan(pan: Punto, imgAncho: number, imgAlto: number, escala: number, areaAncho: number, areaAlto: number): Punto {
  const maxX = Math.max(0, (imgAncho * escala - areaAncho) / 2);
  const maxY = Math.max(0, (imgAlto * escala - areaAlto) / 2);
  return {
    x: maxX === 0 ? 0 : Math.max(-maxX, Math.min(maxX, pan.x)),
    y: maxY === 0 ? 0 : Math.max(-maxY, Math.min(maxY, pan.y)),
  };
}

/** Acota una escala al rango válido [escalaMinima, ZOOM_MAX] y encastra cerca de 1 o del ajuste. */
export function acotarEscala(objetivo: number, ajuste: number, actual?: number): number {
  const min = escalaMinima(ajuste);
  const acotada = Math.max(min, Math.min(ZOOM_MAX, objetivo));
  if (actual !== undefined) {
    if (Math.abs(actual - 1) > 0.02 && Math.abs(acotada - 1) <= 0.03) return 1;
    if (Math.abs(actual - ajuste) > 0.02 * ajuste && Math.abs(acotada - ajuste) <= 0.02 * ajuste) return ajuste;
  }
  return acotada;
}

/**
 * Calcula la nueva escala y el desplazamiento manteniendo fijo el punto `foco`
 * (coordenadas relativas al centro de la escena); sin `foco`, escala desde el centro actual.
 */
export function zoomHaciaPunto(
  actual: { escala: number; pan: Punto },
  objetivo: number,
  img: Tamano,
  area: Tamano,
  ajuste: number,
  foco?: Punto | null,
): { escala: number; pan: Punto } {
  const nueva = acotarEscala(objetivo, ajuste, actual.escala);
  const factor = actual.escala > 0 ? nueva / actual.escala : 1;
  const dx = foco?.x ?? 0;
  const dy = foco?.y ?? 0;
  const bruto = foco
    ? { x: dx - (dx - actual.pan.x) * factor, y: dy - (dy - actual.pan.y) * factor }
    : { x: actual.pan.x * factor, y: actual.pan.y * factor };
  return {
    escala: nueva,
    pan: limitarPan(bruto, img.ancho, img.alto, nueva, area.ancho, area.alto),
  };
}

/** ¿Está prácticamente en la escala objetivo (Ajustar o 100 %)? */
export function esMismaEscala(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPSILON_ESCALA;
}

/** Escala destino al hacer clic / doble clic izquierdo: alterna entre «Ajustar» y 100 %. */
export function siguienteEscalaAlClic(escala: number, ajuste: number): number {
  if (!esMismaEscala(escala, ajuste)) return ajuste;
  return ajuste < 1 - EPSILON_ESCALA ? 1 : ajuste;
}

export type CursorVisor = "grabbing" | "grab" | "zoom-in" | "zoom-out" | "default";

/** Cursor según si está arrastrando, se puede arrastrar o el clic hace zoom. */
export function cursorDeVisor(opts: {
  arrastrando: boolean;
  puedeArrastrar: boolean;
  escala: number;
  ajuste: number;
}): CursorVisor {
  if (opts.arrastrando) return "grabbing";
  if (opts.puedeArrastrar) return "grab";
  if (opts.escala < 1 - EPSILON_ESCALA) return "zoom-in";
  if (opts.escala > opts.ajuste + EPSILON_ESCALA) return "zoom-out";
  return "default";
}

/** Porcentaje entero para mostrar en la barra. */
export function porcentajeZoom(escala: number): number {
  return Math.round(escala * 100);
}

/** Desplazamiento con rueda + Shift: si sólo sobra un eje, desplaza ese eje. */
export function panConRueda(
  pan: Punto,
  deltaX: number,
  deltaY: number,
  img: Tamano,
  escala: number,
  area: Tamano,
): Punto {
  const maxX = Math.max(0, (img.ancho * escala - area.ancho) / 2);
  const maxY = Math.max(0, (img.alto * escala - area.alto) / 2);
  let dx = deltaX;
  let dy = deltaY;
  if (maxX === 0 && maxY > 0) {
    dy = deltaY !== 0 ? deltaY : deltaX;
    dx = 0;
  } else if (maxY === 0 && maxX > 0) {
    dx = deltaX !== 0 ? deltaX : deltaY;
    dy = 0;
  }
  return limitarPan({ x: pan.x - dx, y: pan.y - dy }, img.ancho, img.alto, escala, area.ancho, area.alto);
}

/** Giro de la imagen en grados horarios; sólo múltiplos de 90. */
export type Giro = 0 | 90 | 180 | 270;

/** El giro después de un cuarto de vuelta: `1` a la derecha (horario), `-1` a la izquierda. */
export function girar(giro: Giro, sentido: 1 | -1): Giro {
  return ((((giro + 90 * sentido) % 360) + 360) % 360) as Giro;
}

/** La medida que ocupa la imagen en pantalla: con un cuarto de vuelta se intercambian ancho y alto. */
export function medidaGirada(img: Tamano, giro: Giro): Tamano {
  return giro === 90 || giro === 270 ? { ancho: img.alto, alto: img.ancho } : img;
}

/** Las imágenes del chat para pasar de una a otra: sin repetidas y en el orden en que aparecen; la abierta siempre está. */
export function galeriaDe(rutas: readonly string[], actual: string): { rutas: string[]; indice: number } {
  const unicas = [...new Set(rutas)];
  const i = unicas.indexOf(actual);
  return i >= 0 ? { rutas: unicas, indice: i } : { rutas: [actual], indice: 0 };
}

/** El lugar de la imagen vecina (`-1` anterior, `1` siguiente), o `null` en el extremo (no da la vuelta). */
export function vecino(indice: number, total: number, sentido: 1 | -1): number | null {
  const j = indice + sentido;
  return j >= 0 && j < total ? j : null;
}
