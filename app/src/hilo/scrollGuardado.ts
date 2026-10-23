// En qué punto de cada conversación quedó el usuario, para que un reinicio lo devuelva ahí (src/volver.ts). Se
// anota la distancia al final, no el scrollTop: no cambia al anteponer una página de mensajes viejos. Pegado
// al final (lo normal) no se anota nada: la conversación abre al fondo, como siempre.
import { huboCambio } from "./cambios";
import { anotar, bajar, lejos, UMBRAL, type Seguidor, type Zona } from "./seguir";

/** Cuántas conversaciones se recuerdan: la que se toca hace más tiempo se olvida. */
const MAX = 50;
/** Dónde quedó cada una desde que se abrió la app (clave de la conversación → px que faltan al final). */
const vivos = new Map<string, number>();
/** Lo de la vez anterior que todavía no se aplicó (la conversación no se abrió en esta). */
const pendientes = new Map<string, number>();
/**
 * Un lugar de una conversación que sobrevive a que se vuelva a armar: el mensaje (la clave de su marca `i.k`), cuál de sus cajas
 * (`n`) y a qué altura de la pantalla (`y`, px desde el borde de arriba de la zona). La distancia al final no alcanza: los
 * mensajes que no se vieron todavía miden de mentira (`content-visibility`) y al volver a armarla cada uno mide otra cosa.
 */
export type Ancla = { k: string; n: number; y: number };
/** Dónde dejó el usuario cada conversación que se cerró en esta sesión (la que no está, quedó abajo del todo). */
const anclas = new Map<string, Ancla>();
/** Lo de la ancla que todavía no se aplicó (la conversación se abrió de nuevo y espera su contenido). */
const anclasPendientes = new Map<string, Ancla>();
/** Alineando la conversación a su ancla mientras terminan de medirse los mensajes: clave → se corta si el usuario la toca. */
const afirmando = new Map<string, { corta: boolean }>();

/** Las que el usuario dejó pegadas al fondo (la que no está, no se sabe o la dejó más arriba), y las que esperan que se las vuelva a pegar. */
const fondos = new Set<string>();
const fondosPendientes = new Set<string>();

/** Volviendo a un punto que está más arriba de lo cargado: mientras llegan las páginas, lo que se vea de paso no se anota. */
const llegando = new Set<string>();

/** El usuario movió el scroll de esta conversación (o creció lo de abajo). Escondida (un panel encima) no mide nada. */
export function anotarScroll(clave: string, z: Zona) {
  if (!z.clientHeight || llegando.has(clave)) return;
  const f = afirmando.get(clave);
  if (f && !f.corta) return;
  pendientes.delete(clave);
  anclasPendientes.delete(clave);
  anclas.delete(clave);
  const d = Math.round(lejos(z));
  if (d < UMBRAL) {
    if (vivos.delete(clave)) huboCambio();
    return;
  }
  if (vivos.get(clave) === d) return;
  vivos.delete(clave);
  vivos.set(clave, d);
  if (vivos.size > MAX) vivos.delete(vivos.keys().next().value as string);
  huboCambio();
}

/**
 * La conversación se abre de nuevo (otro líder y vuelta): si el usuario la había dejado más arriba del final, vuelve ahí.
 * Pegada al final no se anotó nada, y abre al fondo y sigue pegada.
 */
export function retomarScroll(clave: string) {
  const a = anclas.get(clave);
  const d = vivos.get(clave) ?? (a ? UMBRAL : undefined);
  if (d !== undefined) pendientes.set(clave, d);
  if (a) anclasPendientes.set(clave, a);
  if (fondos.has(clave)) fondosPendientes.add(clave);
  else fondosPendientes.delete(clave);
}

const esDom = (z: Zona): z is Zona & HTMLElement => typeof (z as Partial<HTMLElement>).querySelector === "function";
const esMarca = (e: Element) => e.localName === "i" && e.classList.contains("k");

/** Qué mensaje y a qué altura está arriba del todo en lo que se ve. `null`: no hay con qué anclar. */
export function anclaDe(z: HTMLElement): Ancla | null {
  const conv = z.querySelector(".conv");
  if (!conv) return null;
  const arriba = z.getBoundingClientRect().top;
  let k: string | null = null;
  let n = 0;
  for (const e of conv.children) {
    if (esMarca(e)) {
      k = (e as HTMLElement).dataset.k ?? null;
      n = 0;
      continue;
    }
    const r = e.getBoundingClientRect();
    if (k !== null && r.bottom > arriba + 1) return { k, n, y: Math.round(r.top - arriba) };
    n++;
  }
  return null;
}

/** El elemento de esa ancla, si la conversación lo tiene armado. */
function ubicar(z: HTMLElement, a: Ancla): Element | null {
  const m = z.querySelector(`.conv > i.k[data-k="${a.k}"]`);
  let e = m;
  for (let i = 0; e && i <= a.n; i++) {
    e = e.nextElementSibling;
    if (e && esMarca(e)) return null;
  }
  return e;
}

/** La conversación se cierra (otro líder, otro hilo): se anota dónde estaba, antes de que desaparezca su alto. `pegado`: seguía el fondo. */
export function guardarAncla(clave: string, z: HTMLElement, pegado = false) {
  // Se cierra antes de haber vuelto a su lugar (cambios en ráfaga, o todavía sin mensajes): lo que se ve no es lo que el usuario dejó.
  llegando.delete(clave);
  const f = afirmando.get(clave);
  const enVuelo = !!f && !f.corta;
  if (f) f.corta = true;
  if (enVuelo || pendientes.has(clave) || anclasPendientes.has(clave) || fondosPendientes.has(clave) || !z.clientHeight) return;
  // Pegado al fondo (el seguidor lo sabe): si hay algo creciendo abajo (el texto que llega, el paso en curso) lo medido
  // puede estar a un renglón del final sin que el usuario haya subido: se vuelve al fondo, no a ese punto.
  const d = pegado ? 0 : lejos(z);
  if (pegado) fondos.add(clave);
  else fondos.delete(clave);
  if (pegado) {
    pendientes.delete(clave);
    anclasPendientes.delete(clave);
    if (vivos.delete(clave)) huboCambio();
  } else anotarScroll(clave, z);
  anclas.delete(clave);
  if (d < UMBRAL) return;
  const a = anclaDe(z);
  if (a) anclas.set(clave, a);
}

/**
 * Al volver a una conversación, los mensajes que entran a la vista se miden y corren lo que está arriba: se la sostiene en su
 * ancla unos cuadros, hasta que deja de moverse. Sin timers: un cuadro a la vez, y se corta si el usuario la toca.
 */
function afirmar(z: HTMLElement, s: Seguidor, clave: string, a: Ancla) {
  const antes = afirmando.get(clave);
  if (antes) antes.corta = true;
  const mio = { corta: false };
  afirmando.set(clave, mio);
  let quietos = 0;
  let cuadros = 0;
  const paso = () => {
    if (mio.corta || !z.isConnected || ++cuadros > 30) return fin();
    const e = z.clientHeight ? ubicar(z, a) : null;
    if (e) {
      const dy = e.getBoundingClientRect().top - z.getBoundingClientRect().top - a.y;
      if (Math.abs(dy) > 0.5) {
        z.scrollTop += dy;
        quietos = 0;
        anotar(z, s);
      } else if (++quietos >= 3) return fin();
    }
    requestAnimationFrame(paso);
  };
  const fin = () => {
    if (afirmando.get(clave) === mio) afirmando.delete(clave);
    if (!mio.corta && z.isConnected) {
      anotar(z, s);
      anotarScroll(clave, z);
    }
  };
  requestAnimationFrame(paso);
}

/**
 * Volver a una conversación que quedó pegada al fondo: al fondo y, unos cuadros, otra vez al fondo cada vez que lo que se mide
 * lo aleja (los mensajes que entran a la vista corrigen su alto, y lo que crece abajo sigue creciendo): que un tirón de esos
 * no pase por el usuario subiendo, que soltaría el seguimiento. Se corta si el usuario la toca.
 */
function afirmarFondo(z: HTMLElement, s: Seguidor, clave: string) {
  const antes = afirmando.get(clave);
  if (antes) antes.corta = true;
  const mio = { corta: false };
  afirmando.set(clave, mio);
  let quietos = 0;
  let cuadros = 0;
  const paso = () => {
    if (mio.corta || !z.isConnected || ++cuadros > 30) return fin();
    if (!z.clientHeight) quietos = 0;
    else if (lejos(z) > 0.5) {
      bajar(z, s);
      quietos = 0;
    } else if (++quietos >= 3) return fin();
    requestAnimationFrame(paso);
  };
  const fin = () => {
    if (afirmando.get(clave) === mio) afirmando.delete(clave);
    if (!mio.corta && z.isConnected && z.clientHeight) bajar(z, s);
  };
  requestAnimationFrame(paso);
}

/** Falta cargar páginas para llegar al punto que se está recuperando. */
export const faltaLlegar = (clave: string) => llegando.has(clave);

/** El usuario tocó la conversación (rueda, dedo, teclas): lo que faltaba por volver ya no se aplica. */
export function soltarScroll(clave: string) {
  if (llegando.delete(clave)) {
    pendientes.delete(clave);
    anclasPendientes.delete(clave);
  }
  const f = afirmando.get(clave);
  if (f) f.corta = true;
}

/**
 * La conversación ya tiene contenido a la vista: si de la vez anterior quedó más arriba del final, vuelve ahí.
 * `hayMas`: hay mensajes anteriores sin cargar. Si lo cargado no alcanza para llegar a ese punto, va al comienzo de
 * lo cargado (eso pide la página anterior) y lo sigue intentando con cada página, hasta llegar o hasta que no quede nada más.
 * `false`: no había nada, o está escondida.
 */
export function restaurarScroll(z: Zona, s: Seguidor, clave: string, hayMas = false): boolean {
  if (fondosPendientes.has(clave) && z.clientHeight && esDom(z)) {
    fondosPendientes.delete(clave);
    pendientes.delete(clave);
    anclasPendientes.delete(clave);
    bajar(z, s);
    afirmarFondo(z, s, clave);
    return true;
  }
  const d = pendientes.get(clave);
  if (d === undefined || !z.clientHeight) return false;
  const a = anclasPendientes.get(clave);
  if (a && esDom(z)) {
    const e = ubicar(z, a);
    if (e) {
      pendientes.delete(clave);
      anclasPendientes.delete(clave);
      llegando.delete(clave);
      z.scrollTop += e.getBoundingClientRect().top - z.getBoundingClientRect().top - a.y;
      anotar(z, s);
      afirmar(z, s, clave, a);
      return true;
    }
    // Su mensaje está en una página que todavía no se cargó: al comienzo de lo cargado, que pide la anterior.
    if (hayMas) {
      llegando.add(clave);
      z.scrollTop = 0;
      anotar(z, s);
      return true;
    }
    anclasPendientes.delete(clave);
  }
  const top = z.scrollHeight - z.clientHeight - d;
  if (top < 0 && hayMas) {
    llegando.add(clave);
    z.scrollTop = 0;
    anotar(z, s);
    return true;
  }
  pendientes.delete(clave);
  llegando.delete(clave);
  z.scrollTop = Math.max(0, top);
  anotar(z, s);
  anotarScroll(clave, z);
  return true;
}

/** Lo que se guarda en disco: lo de ahora y lo de la vez anterior que no se tocó. */
export function fotoScrolls(): Record<string, number> {
  return { ...Object.fromEntries(pendientes), ...Object.fromEntries(vivos) };
}

/** Lo que dejó la vez anterior (lo que no se entiende se ignora). */
export function ponerScrolls(x: unknown) {
  if (!x || typeof x !== "object" || Array.isArray(x)) return;
  for (const [k, v] of Object.entries(x).slice(0, MAX)) if (typeof v === "number" && Number.isFinite(v) && v >= UMBRAL && !vivos.has(k)) pendientes.set(k, Math.round(v));
}
