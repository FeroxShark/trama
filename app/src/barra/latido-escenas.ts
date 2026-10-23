// El movimiento de las escenas de la tarjeta de actividad del chat (src/hilo/Escenas.tsx, dirección C de
// referencias/maquetas/actividad). En la maqueta son animaciones CSS infinitas; acá las escribe `latido.ts`,
// en escalones y sólo mientras hay una escena a la vista (la tarjeta existe sólo mientras el líder hace algo).
// Cada pieza del dibujo lleva una clase `e-…`; su fase sale del reloj (`data-d`: milisegundos de atraso, como un
// `animation-delay`) y sólo se tocan `transform` y `opacity`. Sin movimiento (o con `limpiar`), el CSS deja cada
// pieza en una pose que igual se lee (src/hilo/actividad.css... en index.css, "escenas").

const de = (clase: string) => document.getElementsByClassName(clase) as HTMLCollectionOf<HTMLElement>;

/** Cada escena a la vista (la figura entera): si no hay ninguna, no hay nada que mover. */
const escenas = de("esc");

/** Parecida a cubic-bezier(0,0,.2,1): sale rápido y frena. */
const frena = (p: number) => 1 - (1 - p) ** 3;
/** Parecida a cubic-bezier(.4,0,.2,1). */
const suave = (p: number) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2);
const lineal = (p: number) => p;

type Punto = readonly [number, number];

/** Interpola entre los puntos (fase, valor) como los keyframes de CSS: antes del primero y después del último, se queda. */
function kf(p: number, pts: readonly Punto[], ease: (x: number) => number = lineal): number {
  if (p <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [p1, v1] = pts[i];
    if (p <= p1) {
      const [p0, v0] = pts[i - 1];
      return p1 === p0 ? v1 : v0 + (v1 - v0) * ease((p - p0) / (p1 - p0));
    }
  }
  return pts[pts.length - 1][1];
}

const n2 = (x: number) => x.toFixed(2);
const n3 = (x: number) => x.toFixed(3);

type Pieza = {
  clase: string;
  /** Lo que dura una vuelta. */
  ms: number;
  poner: (n: HTMLElement, p: number) => void;
  vivas: HTMLCollectionOf<HTMLElement>;
};

const pieza = (clase: string, ms: number, poner: Pieza["poner"]): Pieza => ({ clase, ms, poner, vivas: de(clase) });

const escala = (n: HTMLElement, x: number, op?: number) => {
  n.style.transform = `scale(${n3(x)})`;
  if (op !== undefined) n.style.opacity = n2(op);
};

// Los puntos de cada una son los keyframes de la maqueta, al pie de la letra.
const BANDA: Punto[] = [[0, 0], [0.14, 0], [0.2, 5], [0.34, 5], [0.4, 10], [0.54, 10], [0.6, 15], [0.74, 15], [0.8, 20], [0.94, 20], [1, 0]];
const VIEJO: Punto[] = [[0, 1], [0.18, 1], [0.38, 0.18], [0.88, 0.18], [1, 1]];
const NUEVO_X: Punto[] = [[0, 0], [0.22, 0], [0.62, 1], [1, 1]];
const NUEVO_OP: Punto[] = [[0, 1], [0.88, 1], [1, 0]];
const TIPEA: Punto[] = [[0, 0.04], [0.38, 1], [1, 1]];
const CUR_OP: Punto[] = [[0, 1], [0.38, 1], [0.46, 0], [0.54, 1], [0.62, 0], [0.7, 1], [1, 1]];
const CUR_X: Punto[] = [[0, 0], [0.38, 14], [1, 14]];
const SAL: Punto[] = [[0, 0], [0.5, 0], [0.62, 0.5], [0.9, 0.5], [1, 0]];
const BAJA_Y: Punto[] = [[0, 0], [0.3, 7], [0.6, 7], [0.8, 16], [1, 16]];
const BAJA_X: Punto[] = [[0, 0], [0.3, 0], [0.6, 11], [1, 11]];
const BAJA_OP: Punto[] = [[0, 0], [0.08, 1], [0.8, 1], [1, 0]];
const LUZ: Punto[] = [[0, 0.25], [0.7, 0.25], [0.85, 1], [1, 1]];
const LLENA_X: Punto[] = [[0, 0], [0.22, 1], [1, 1]];
const LLENA_OP: Punto[] = [[0, 1], [0.8, 1], [1, 0]];
const CURSOR: Punto[] = [[0, 1], [0.45, 1], [0.55, 0.1], [1, 0.1]];

/** El padre manda un punto a un hijo (`lado`: -1 izquierda, 1 derecha). */
const baja = (lado: number) => (n: HTMLElement, p: number) => {
  n.style.opacity = n2(kf(p, BAJA_OP));
  n.style.transform = `translate(${n2(lado * kf(p, BAJA_X, suave))}px, ${n2(kf(p, BAJA_Y, suave))}px)`;
};

const PIEZAS: Pieza[] = [
  // pensando: una mente que respira y dos ondas que se abren.
  pieza("e-nuc", 2200, (n, p) => escala(n, 1 - 0.12 * Math.cos(2 * Math.PI * p))),
  pieza("e-onda", 2200, (n, p) => {
    const e = frena(p);
    escala(n, 1 + 1.9 * e, 0.6 * (1 - e));
  }),
  // web: el meridiano del globo gira y un punto da la vuelta.
  pieza("e-mer", 2800, (n, p) => {
    n.style.transform = `scaleX(${n3(0.56 + 0.44 * Math.cos(2 * Math.PI * p))})`;
  }),
  pieza("e-orb", 3600, (n, p) => {
    n.style.transform = `rotate(${n2(p * 360)}deg)`;
  }),
  // código: la banda de lectura baja renglón por renglón.
  pieza("e-banda", 3200, (n, p) => {
    n.style.transform = `translateY(${n2(kf(p, BANDA, suave))}px)`;
  }),
  // editando: lo viejo se apaga y lo nuevo se escribe.
  pieza("e-viejo", 3200, (n, p) => {
    n.style.opacity = n2(kf(p, VIEJO, suave));
  }),
  pieza("e-nuevo", 3200, (n, p) => {
    n.style.opacity = n2(kf(p, NUEVO_OP));
    n.style.transform = `scaleX(${n3(kf(p, NUEVO_X, frena))})`;
  }),
  // comando: se tipea, el cursor parpadea, aparece la salida.
  pieza("e-tip", 3200, (n, p) => {
    n.style.transform = `scaleX(${n3(kf(p, TIPEA))})`;
  }),
  pieza("e-cur", 3200, (n, p) => {
    n.style.opacity = n2(kf(p, CUR_OP));
    n.style.transform = `translateX(${n2(kf(p, CUR_X))}px)`;
  }),
  pieza("e-sal", 3200, (n, p) => {
    n.style.opacity = n2(kf(p, SAL, frena));
  }),
  // delegando: el padre manda dos puntos a dos hijos, que se prenden al llegar.
  pieza("e-pa", 2600, baja(-1)),
  pieza("e-pb", 2600, baja(1)),
  pieza("e-luz", 2600, (n, p) => {
    n.style.opacity = n2(kf(p, LUZ, suave));
  }),
  // permiso: el anillo respira y el "pausa" late; nada avanza.
  pieza("e-anillo", 2800, (n, p) => {
    const f = 0.5 - 0.5 * Math.cos(2 * Math.PI * p);
    escala(n, 1 + 0.09 * f, 0.5 + 0.5 * f);
  }),
  pieza("e-pausa", 2800, (n, p) => {
    n.style.opacity = n2(0.7 + 0.3 * (0.5 - 0.5 * Math.cos(2 * Math.PI * p)));
  }),
  // escribiendo: líneas de texto que aparecen en cascada y un cursor.
  pieza("e-ln", 3200, (n, p) => {
    n.style.opacity = n2(kf(p, LLENA_OP));
    n.style.transform = `scaleX(${n3(kf(p, LLENA_X, frena))})`;
  }),
  pieza("e-cursor", 1000, (n, p) => {
    n.style.opacity = n2(kf(p, CURSOR));
  }),
];

/** ¿Hay una escena a la vista? Si no, `latido.ts` no gasta cuadros en ellas. */
export const hayEscenas = () => escenas.length > 0;

/** Un cuadro de todas las escenas. `t`: el reloj de `latido.ts` (ms). */
export function pintarEscenas(t: number) {
  for (const { ms, poner, vivas } of PIEZAS) {
    for (const n of vivas) {
      const atraso = n.dataset.d === undefined ? 0 : Number(n.dataset.d);
      poner(n, (((t - atraso) / ms) % 1 + 1) % 1);
    }
  }
}

/** Sin movimiento (o sin escenas): cada pieza vuelve a la pose del CSS. */
export function limpiarEscenas() {
  for (const { vivas } of PIEZAS) for (const n of vivas) n.style.cssText = "";
}
