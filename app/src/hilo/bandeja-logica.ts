// La bandeja de la cola (Bandeja.tsx), sin React: qué dice su pestaña según el estado, cuándo un paso cuenta como
// largo, qué pregunta antes de cortar y dónde cae una fila que se arrastra. La prueba tests/bandeja-logica.test.ts.
import { t, type ClaveSola } from "../i18n/index.ts";
import { duracion } from "../tiempo.ts";

/** Un paso que lleva más que esto ya no es "un rato": la pestaña lo dice y ofrece Parar. */
export const PASO_LARGO_S = 120;

/**
 * Por dónde va a entrar lo que está en la cola:
 *  - `turno`: a mitad del turno, en el próximo límite de herramienta (un `claude` de la app);
 *  - `fin`: al terminar el turno (los motores sin ese canal);
 *  - `terminal`: cuando termine en la terminal donde está abierto;
 *  - `ahora`: no hay nada que esperar.
 */
export type Canal = "turno" | "fin" | "terminal" | "ahora";

export const canalDe = (o: { ocupado: boolean; ajeno: boolean; directo: boolean }): Canal => (!o.ocupado ? "ahora" : o.ajeno ? "terminal" : o.directo ? "turno" : "fin");

/** El paso en curso: cuánto lleva y, si es un comando, cuál. */
export type Paso = { segundos: number; comando: string | null };

type Hace = { que: string; nombre: string | null; detalle: string | null } | null;

export function pasoDe(ind: { hace: Hace; inicio: number }, ahora: number): Paso | null {
  if (!ind.hace || !ind.inicio) return null;
  const comando = ind.hace.que === "herramienta" && ind.hace.nombre === "Bash" && ind.hace.detalle?.trim() ? ind.hace.detalle.trim() : null;
  return { segundos: Math.max(0, (ahora - ind.inicio) / 1000), comando };
}

export const esLargo = (p: Paso | null): p is Paso => !!p && p.segundos >= PASO_LARGO_S;

const COMANDO_MAX = 32;

/** Lo que se nombra de un comando en una pregunta: su primera línea, sin las opciones y cortada en una palabra. */
export function comandoCorto(comando: string): string {
  const linea = comando.split("\n", 1)[0].trim();
  const sin = linea.split(/\s--?(?=\s|\w)/, 1)[0].trim() || linea;
  if (sin.length <= COMANDO_MAX) return sin;
  const corte = sin.slice(0, COMANDO_MAX);
  const blanco = corte.lastIndexOf(" ");
  return `${blanco > COMANDO_MAX / 2 ? corte.slice(0, blanco) : corte}…`;
}

export type Tono = "espera" | "largo" | "fallo";
export type IconoTab = "reloj" | "capas" | "arena" | "error" | "camino";

export type Cabecera = {
  tono: Tono;
  icono: IconoTab;
  titulo: string;
  /** Lo que sigue al título: cuándo entra, o cuántos esperan. */
  nota: string | null;
  /** Cuánto lleva el paso largo. */
  tiempo: string | null;
  /** Ofrece Parar: el paso lleva demasiado y se puede cortar desde acá. */
  parar: boolean;
};

const NOTA: Record<Canal, { uno: ClaveSola; varios: ClaveSola }> = {
  turno: { uno: "cola.trasUno", varios: "cola.trasN" },
  fin: { uno: "cola.finUno", varios: "cola.finN" },
  terminal: { uno: "cola.terminalUno", varios: "cola.terminalN" },
  ahora: { uno: "cola.ahoraUno", varios: "cola.ahoraN" },
};

/**
 * La pestaña, en palabras (el color sólo acompaña). Lo que no salió va primero: lo demás espera a que se resuelva. Después, un paso largo
 * (lo que explica por qué tarda). Si no, cuántos hay y cuándo entran. `enEspera`: los que todavía se pueden editar; `enCamino`: los que ya salieron.
 */
export function cabecera(o: { enEspera: number; enCamino: number; fallo: boolean; canal: Canal; paso: Paso | null; cortable: boolean }): Cabecera {
  const n = o.enEspera + o.enCamino;
  if (o.fallo) {
    const resto = n - 1;
    return { tono: "fallo", icono: "error", titulo: t("cola.falloT"), nota: resto <= 0 ? null : resto === 1 ? t("cola.falloEspera1") : t("cola.falloEsperaN", { n: resto }), tiempo: null, parar: false };
  }
  if ((o.canal === "turno" || o.canal === "fin") && esLargo(o.paso)) {
    return { tono: "largo", icono: "arena", titulo: t(o.paso.comando ? "cola.largoComando" : "cola.largoPaso"), nota: null, tiempo: duracion(o.paso.segundos), parar: o.cortable };
  }
  const soloCamino = o.enEspera === 0 && o.enCamino > 0;
  const titulo = soloCamino ? (n === 1 ? t("cola.caminoUno") : t("cola.caminoN", { n })) : n === 1 ? t("cola.uno") : t("cola.n", { n });
  return { tono: "espera", icono: soloCamino ? "camino" : n === 1 ? "reloj" : "capas", titulo, nota: t(n === 1 ? NOTA[o.canal].uno : NOTA[o.canal].varios), tiempo: null, parar: false };
}

/** Lo que pregunta «Enviar ahora» antes de cortar. Sin un minuto cumplido no dice cuánto lleva. */
export function confirmacion(o: { canal: Canal; paso: Paso | null; n: number }): { titulo: string; cuerpo: string } {
  const titulo = o.canal === "terminal" ? t("cola.confTerminal") : o.paso?.comando ? t("cola.confTitulo", { que: comandoCorto(o.paso.comando) }) : t("cola.confPaso");
  const resto = o.n === 1 ? t("cola.confUno") : t("cola.confN", { n: o.n });
  return { titulo, cuerpo: o.paso && o.paso.segundos >= 60 ? `${t("cola.confLleva", { t: duracion(o.paso.segundos) })} ${resto}` : resto };
}

/** La lista con el que estaba en `desde` puesto en `hasta`. */
export function mover<T>(lista: readonly T[], desde: number, hasta: number): T[] {
  const r = [...lista];
  const [x] = r.splice(desde, 1);
  r.splice(hasta, 0, x);
  return r;
}

/** La lista en el orden pedido; lo que no está en el pedido (recién llegado) queda atrás, y lo que ya no está en la lista se ignora. */
export function aplicarOrden<T extends { id: number }>(lista: readonly T[], ids: readonly number[] | null): readonly T[] {
  if (!ids) return lista;
  const por = new Map(lista.map((x) => [x.id, x]));
  const r: T[] = [];
  for (const id of ids) {
    const x = por.get(id);
    if (x) {
      r.push(x);
      por.delete(id);
    }
  }
  return por.size ? [...r, ...por.values()] : r;
}

/**
 * Dónde cae la fila `desde` corrida `dy` píxeles: pasa a otra a mitad de camino entre los dos lugares que puede ocupar (va y vuelve en el mismo punto, sin saltos).
 * `alturas`: las de cada fila, en el orden en que estaban al agarrarla (las filas pueden tener distinto alto).
 */
export function destinoArrastre(alturas: readonly number[], desde: number, dy: number, gap: number): number {
  let y = 0;
  const propio = alturas[desde];
  let tope = 0;
  for (let k = 0; k < desde; k++) tope += alturas[k] + gap;
  const centro = tope + propio / 2 + dy;
  let hasta = 0;
  alturas.forEach((h, k) => {
    if (k === desde) return;
    if (centro > y + (h + gap) / 2 + propio / 2) hasta++;
    y += h + gap;
  });
  return hasta;
}

/** Cuánto se corrió el lugar de la fila al caer en `hasta` (la fila se dibuja corrida desde su lugar, siguiendo al puntero). */
export function corrimiento(alturas: readonly number[], desde: number, hasta: number, gap: number): number {
  const otras = alturas.filter((_, k) => k !== desde);
  let d = 0;
  for (let k = 0; k < hasta; k++) d += otras[k] + gap;
  let tope = 0;
  for (let k = 0; k < desde; k++) tope += alturas[k] + gap;
  return d - tope;
}
