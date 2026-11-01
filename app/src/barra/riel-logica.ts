// La lógica de la barra con riel (rediseño 0.4), sin React: qué marca lleva cada proyecto del riel, qué queda a la vista con
// los filtros, cómo se resalta lo buscado y cómo se cuenta. Pura: lo prueba `tests/riel.test.ts`.
import { activo, atencionItem, liderEspera, normal, type Arbol, type Atencion, type Carpeta, type Item, type Rama } from "./arbol.ts";

const porInicio = (a: Item, b: Item) => b.h.inicio - a.h.inicio;
const ramasDe = (c: Carpeta): Rama[] => [...c.ramas, ...c.espera, ...c.dormidos];

/**
 * Lo que pide atención no se pliega: el worker que falló o pide algo queda a la vista bajo su líder (`vivas`) aunque
 * terminó. El resto, como venía: lo terminado sigue en su "N terminados".
 */
export function aRiel(a: Arbol, resueltos?: ReadonlySet<string>): Arbol {
  const ver = (r: Rama): Rama => {
    const suben = r.viejas.filter((it) => atencionItem(it, resueltos));
    if (!suben.length) return r;
    return { ...r, vivas: [...r.vivas, ...suben].sort(porInicio), viejas: r.viejas.filter((it) => !atencionItem(it, resueltos)) };
  };
  return {
    ...a,
    activas: a.activas.map(ver),
    carpetas: a.carpetas.map((c) => ({ ...c, ramas: c.ramas.map(ver), espera: c.espera.map(ver), dormidos: c.dormidos.map(ver) })),
  };
}

/** Lo peor de un proyecto: falló antes que pide; `null`, nada que mirar. */
export function atencionCarpeta(c: Carpeta, resueltos?: ReadonlySet<string>): Atencion | null {
  let pide = false;
  for (const r of ramasDe(c)) {
    if (r.lider && liderEspera(r.lider)) pide = true;
    for (const it of [...r.vivas, ...r.viejas]) {
      const at = atencionItem(it, resueltos);
      if (at === "fallo") return "fallo";
      if (at === "decision") pide = true;
    }
  }
  return pide ? "decision" : null;
}

/** ¿Corre algo en el proyecto? Un líder respondiendo o con subagentes, o un worker vivo. */
export const carpetaViva = (c: Carpeta): boolean =>
  ramasDe(c).some((r) => !!r.lider && (r.lider.ocupado || (r.lider.subagentes ?? 0) > 0)) || ramasDe(c).some((r) => [...r.vivas, ...r.viejas].some(activo));

export type ItemRiel = { proyecto: string; marca: Atencion | null; vivo: boolean; apagado: boolean };

/**
 * Los proyectos del riel, de un árbol sin buscar: siempre se ven todos, y buscando se apagan los que no traen resultados.
 * `conResultados`: los proyectos que coinciden; `null`, no se está buscando. `extras`: los que sólo tienen conversaciones de Claude Code.
 */
export function itemsRiel(base: readonly Carpeta[], conResultados: ReadonlySet<string> | null, resueltos?: ReadonlySet<string>, extras: readonly string[] = []): ItemRiel[] {
  const apagado = (p: string) => !!conResultados && !conResultados.has(p);
  return [
    ...base.map((c) => ({ proyecto: c.proyecto, marca: atencionCarpeta(c, resueltos), vivo: carpetaViva(c), apagado: apagado(c.proyecto) })),
    ...extras.map((p) => ({ proyecto: p, marca: null, vivo: false, apagado: apagado(p) })),
  ];
}

/**
 * El árbol que se ve con los filtros: un proyecto del riel y las píldoras de "falló" o "espera". Filtrando por lo que pide
 * atención queda el líder sólo si él espera o trae algo así, y de sus workers, sólo ésos. Lo cerrado se ve filtrando por
 * proyecto (el suyo) y no filtrando por atención. `lideres` y `aCargo` no cambian: dicen quién es quién, no qué se muestra.
 */
export function filtrarArbol(a: Arbol, { proyecto, ver, resueltos }: { proyecto: string | null; ver: Atencion | null; resueltos?: ReadonlySet<string> }): Arbol {
  if (!proyecto && !ver) return a;
  const deja = (r: Rama): Rama | null => {
    if (!ver) return r;
    const es = (it: Item) => atencionItem(it, resueltos) === ver;
    const vivas = r.vivas.filter(es);
    const viejas = r.viejas.filter(es);
    const yo = ver === "decision" && !!r.lider && liderEspera(r.lider);
    return yo || vivas.length + viejas.length > 0 ? { ...r, vivas, viejas } : null;
  };
  const lista = (rs: Rama[]) => rs.flatMap((r) => deja(r) ?? []);
  const carpetas = a.carpetas
    .filter((c) => !proyecto || c.proyecto === proyecto)
    .map((c) => ({ ...c, ramas: lista(c.ramas), espera: lista(c.espera), dormidos: lista(c.dormidos) }))
    .filter((c) => !ver || c.ramas.length + c.espera.length + c.dormidos.length > 0);
  return { ...a, carpetas, activas: [], cerrados: ver ? [] : a.cerrados.filter((it) => it.h.proyecto === proyecto) };
}

/** Los hilos de un proyecto: líderes y workers. */
export const hilosCarpeta = (c: Carpeta): number => ramasDe(c).reduce((n, r) => n + (r.lider ? 1 : 0) + r.vivas.length + r.viejas.length, 0);

/** Los hilos de un árbol, para "6 de 38" al buscar. */
export const hilosArbol = (a: Arbol): number => a.carpetas.reduce((n, c) => n + hilosCarpeta(c), 0);

/** Cuántos quietos (en espera o dormidos) se ven sin pedir "Ver N más". */
export const QUIETOS_VISTA = 2;

/** Los quietos de un proyecto que se ven y cuántos quedan detrás de "Ver N más". */
export function quietosDe(c: Carpeta, abierto: boolean): { ver: { r: Rama; tipo: "espera" | "dormidos" }[]; resto: number } {
  const todos = [...c.espera.map((r) => ({ r, tipo: "espera" as const })), ...c.dormidos.map((r) => ({ r, tipo: "dormidos" as const }))];
  return abierto ? { ver: todos, resto: 0 } : { ver: todos.slice(0, QUIETOS_VISTA), resto: Math.max(0, todos.length - QUIETOS_VISTA) };
}

/** Los proyectos con lo que pide atención primero; entre sí, como venían. */
export const ordenAtencion = (cs: readonly Carpeta[], resueltos?: ReadonlySet<string>): string[] => {
  const pide = (c: Carpeta) => atencionCarpeta(c, resueltos) !== null;
  return [...cs.filter(pide), ...cs.filter((c) => !pide(c))].map((c) => c.proyecto);
};

/** Las carpetas en el orden de `lista` (la foto de `ordenAtencion`); lo que no está en ella va al final, como venía. */
export function segunLista(cs: readonly Carpeta[], lista: readonly string[]): Carpeta[] {
  const lugar = new Map(lista.map((p, i) => [p, i]));
  return cs
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (lugar.get(a.c.proyecto) ?? Infinity) - (lugar.get(b.c.proyecto) ?? Infinity) || a.i - b.i)
    .map((x) => x.c);
}

export type Tramo = { t: string; m: boolean };

/** `texto` en tramos, con lo que coincide con `q` marcado (`m`), sin mayúsculas ni tildes como la búsqueda: "pago" marca "Págo". */
export function partirResalte(texto: string, q: string): Tramo[] {
  const aguja = normal(q.trim());
  if (!aguja) return [{ t: texto, m: false }];
  let plano = "";
  // De cada letra normalizada, en qué lugar del texto original está.
  const lugar: number[] = [];
  let off = 0;
  for (const ch of texto) {
    const n = normal(ch);
    for (let k = 0; k < n.length; k++) lugar.push(off);
    plano += n;
    off += ch.length;
  }
  const out: Tramo[] = [];
  let ult = 0;
  let i = plano.indexOf(aguja);
  while (i >= 0) {
    const a = lugar[i];
    const b = i + aguja.length < lugar.length ? lugar[i + aguja.length] : texto.length;
    if (a > ult) out.push({ t: texto.slice(ult, a), m: false });
    out.push({ t: texto.slice(a, b), m: true });
    ult = b;
    i = plano.indexOf(aguja, i + aguja.length);
  }
  if (ult < texto.length) out.push({ t: texto.slice(ult), m: false });
  return out.length ? out : [{ t: texto, m: false }];
}
