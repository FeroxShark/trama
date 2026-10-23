// Las animaciones de estado que no terminan nunca: la doble onda y el brillo
// de "Trabajando", el halo de "Te necesita", el anillo de "Trabado", el latido
// de sus puntos y el fulgor de la corona de un líder que responde y las escenas de la tarjeta de actividad (latido-escenas.ts). En la maqueta son animaciones CSS infinitas; acá las mueve un
// timer en escalones, porque con una animación corriendo Chromium compone en
// cada vblank (13 % de CPU en reposo a 200 Hz, medido en B1) aunque no cambie
// nada. Así son PASOS_S frames por segundo, sólo mientras haya algo que
// animar y la ventana esté a la vista. Cada paso cuesta: con las fixtures, 10
// por segundo eran ~3 % de CPU en reposo, 30 son ~7 % y 60 ~11 %. El usuario prefiere
// fluidez a CPU: a 10 se veía a saltos (docs/estado/B1.md).
//
// Cada pieza se anota con una clase; la fase sale del reloj, no de un contador,
// así todas las filas laten juntas aunque hayan aparecido en momentos distintos.

import { MODO } from "../modo";
import { hayEscenas, limpiarEscenas, pintarEscenas } from "./latido-escenas";

const PASOS_S = 60;
const PASO_MS = 1000 / PASOS_S;

const de = (clase: string) => document.getElementsByClassName(clase) as HTMLCollectionOf<HTMLElement>;

/** Anillo de la onda (`data-b`: el segundo, medio ciclo atrás). */
const ondas = de("onda");
/** Punto que late (`data-lento`: al ritmo del halo). */
const laten = de("late");
const halos = de("halo");
const giran = de("gira");
const brillos = de("brillo");
/** El resplandor detrás de la corona de un líder que está respondiendo. */
const fulgores = de("fulgor");
/** Las tres hojas que se pliegan mientras un líder compacta (`data-k`: 0, 1, 2; B19). */
const pliegan = de("pliega");
/** El testimonio que va de un líder al otro mientras pasa la posta (B19). */
const postas = de("posta");
/** El cursor de la salida de un comando que todavía corre (la vista de worker): prende y apaga. */
const parpadean = de("parpadea");
const todas = [ondas, laten, halos, giran, brillos, fulgores, pliegan, postas, parpadean];

const quieto = matchMedia("(prefers-reduced-motion: reduce)");

const ONDA_MS = 1800;
const HALO_MS = 2600;
const GIRO_MS = 5000;
const BRILLO_MS = 2400;
const FULGOR_MS = 2200;
const PLIEGUE_MS = 1600;
const POSTA_MS = 1400;
const PARPADEO_MS = 1000;

const fase = (t: number, periodo: number, corrida = 0) => (t / periodo + corrida) % 1;
/** Parecida a cubic-bezier(0,0,.2,1): sale rápido y frena. */
const frena = (p: number) => 1 - (1 - p) ** 3;
/** Parecida a cubic-bezier(.4,0,.2,1). */
const suave = (p: number) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2);

let timer = 0;

function limpiar() {
  for (const n of ondas) n.style.cssText = "";
  for (const n of laten) n.style.transform = "";
  for (const n of halos) n.style.cssText = "";
  for (const n of giran) n.style.transform = "";
  for (const n of brillos) n.style.backgroundPosition = "";
  for (const n of fulgores) n.style.cssText = "";
  for (const n of pliegan) n.style.transform = "";
  for (const n of postas) n.style.cssText = "";
  for (const n of parpadean) n.style.opacity = "";
  limpiarEscenas();
}

function tic() {
  timer = 0;
  if (document.hidden || quieto.matches || (todas.every((c) => c.length === 0) && !hayEscenas())) return limpiar();
  // Con el reloj quieto de las capturas comparadas (src/reloj-fijo.ts) la fase es siempre la misma.
  const t = MODO.quieto ? 0 : performance.now();
  pintarEscenas(t);

  for (const n of ondas) {
    const e = frena(fase(t, ONDA_MS, n.dataset.b === undefined ? 0 : 0.5));
    n.style.transform = `scale(${(1 + 1.8 * e).toFixed(2)})`;
    n.style.opacity = (0.85 * (1 - e)).toFixed(2);
  }
  for (const n of laten) {
    const p = fase(t, n.dataset.lento === undefined ? ONDA_MS : HALO_MS);
    n.style.transform = `scale(${(0.9 + 0.1 * Math.cos(2 * Math.PI * p)).toFixed(3)})`;
  }
  // El halo crece y se apaga en el 70 % del ciclo; el resto espera invisible.
  const h = suave(Math.min(1, fase(t, HALO_MS) / 0.7));
  for (const n of halos) {
    n.style.transform = `scale(${(1 + 1.6 * h).toFixed(2)})`;
    n.style.opacity = (0.55 * (1 - h)).toFixed(2);
  }
  const giro = `rotate(${Math.round(fase(t, GIRO_MS) * 360)}deg)`;
  for (const n of giran) n.style.transform = giro;
  const brillo = `${(100 - 100 * fase(t, BRILLO_MS)).toFixed(1)}% 0`;
  for (const n of brillos) n.style.backgroundPosition = brillo;
  // El fulgor respira: va y vuelve, sin saltos (sólo opacity y transform).
  const f = 0.5 - 0.5 * Math.cos(2 * Math.PI * fase(t, FULGOR_MS));
  for (const n of fulgores) {
    n.style.transform = `scale(${(0.85 + 0.35 * f).toFixed(3)})`;
    n.style.opacity = (0.3 + 0.5 * f).toFixed(2);
  }

  // Las hojas de afuera van hacia la del medio y se achatan, y vuelven: un fuelle.
  const pl = suave(0.5 - 0.5 * Math.cos(2 * Math.PI * fase(t, PLIEGUE_MS)));
  for (const n of pliegan) {
    const k = Number(n.dataset.k ?? 1) - 1;
    n.style.transform = `translateY(${(-k * 0.3 * pl).toFixed(3)}em) scaleY(${(1 - 0.45 * pl).toFixed(3)})`;
  }
  // El testimonio cruza de un punto al otro, aparece al salir y se apaga al llegar.
  const po = fase(t, POSTA_MS);
  for (const n of postas) {
    n.style.transform = `translateX(${(1.5 * suave(po)).toFixed(3)}em)`;
    n.style.opacity = Math.sin(Math.PI * po).toFixed(2);
  }
  const pa = fase(t, PARPADEO_MS) < 0.5 ? "1" : "0";
  for (const n of parpadean) n.style.opacity = pa;

  timer = window.setTimeout(tic, PASO_MS);
}

/** Lo llama cada pieza animada al montarse. Si ya está corriendo, no hace nada. */
export function latir() {
  if (!timer) timer = window.setTimeout(tic, PASO_MS);
}

document.addEventListener("visibilitychange", () => !document.hidden && latir());
quieto.addEventListener("change", latir);
