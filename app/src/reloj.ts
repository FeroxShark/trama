// El único timer de la barra. Edades, numeritos de caché y resets se anotan
// acá con un nodo y una función que dice qué texto va y cuándo cambia; el
// reloj escribe `textContent` (y algún atributo) directo en el DOM. React no
// se entera: un tic no re-renderiza nada.
//
// No es un intervalo fijo: duerme hasta el próximo texto que cambia (casi
// siempre, el próximo minuto) y con la ventana oculta no corre.
import { alCambiarIdioma } from "./i18n";

export type Pintura = {
  texto: string;
  /** Segundos hasta que este texto cambia. `Infinity`: ya no cambia. */
  en: number;
  /** Atributos a poner (string) o sacar (null) en el nodo. */
  attrs?: Record<string, string | null>;
};

/** Recibe "ahora" en segundos (epoch). */
export type Pintor = (ahora: number) => Pintura;

type Entrada = { el: HTMLElement; pintor: Pintor; toca: number };

const TOPE_MS = 3_600_000;

const entradas = new Set<Entrada>();
let timer = 0;
let desfase = 0;
let escrituras = 0;

const ahora = () => Date.now() + desfase;

function pintar(e: Entrada, t: number) {
  const p = e.pintor(t / 1000);
  if (e.el.textContent !== p.texto) {
    e.el.textContent = p.texto;
    escrituras++;
  }
  for (const [k, v] of Object.entries(p.attrs ?? {})) {
    if (v === null) e.el.removeAttribute(k);
    else if (e.el.getAttribute(k) !== v) e.el.setAttribute(k, v);
  }
  e.toca = t + Math.max(250, p.en * 1000);
}

function programar() {
  clearTimeout(timer);
  timer = 0;
  if (document.hidden) return;
  let min = Infinity;
  for (const e of entradas) min = Math.min(min, e.toca);
  if (min === Infinity) return;
  timer = window.setTimeout(tic, Math.min(TOPE_MS, Math.max(0, min - ahora()) + 20));
}

function tic() {
  const t = ahora();
  for (const e of entradas) if (e.toca <= t) pintar(e, t);
  programar();
}

function repintarTodo() {
  const t = ahora();
  for (const e of entradas) pintar(e, t);
  programar();
}

/** Anota un nodo. Pinta ya (antes del primer frame si se llama en un layout effect). */
export function suscribir(el: HTMLElement, pintor: Pintor): () => void {
  const e: Entrada = { el, pintor, toca: 0 };
  pintar(e, ahora());
  entradas.add(e);
  programar();
  return () => {
    entradas.delete(e);
  };
}

// Los textos del reloj se dicen al pintar: al cambiar de idioma, todos de nuevo.
alCambiarIdioma(repintarTodo);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) programar();
  else repintarTodo();
});

/** Para el guion de medición: adelantar el tiempo y contar qué se escribió. */
export const relojPrueba = {
  adelantar(segundos: number) {
    desfase += segundos * 1000;
    repintarTodo();
  },
  escrituras: () => escrituras,
  anotados: () => entradas.size,
};
