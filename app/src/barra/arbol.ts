// El árbol de la barra: carpeta de proyecto → líder → sus workers. Los líderes
// son las sesiones de Claude Code con las que habla el usuario; los workers, las
// corridas de `pa` que lanzó cada uno (`jefe_id`). Puro: lo prueba
// `tests/arbol.test.ts`.
import { cerrable, cerrado, esShark, GENERAL, SHARK, type Caido, type Estado, type Hilo, type Lider, type Orden } from "../datos/contrato.ts";
import { fraseConocida, t } from "../i18n/index.ts";
import { porManual } from "./orden.ts";

/** Un líder sin workers a la vista, sin responder y sin actividad en esto, va plegado en "N líderes en espera". */
export const ESPERA_S = 30 * 60;
/**
 * Un líder sin proceso (cerrado, o muerto) y sin workers a la vista, con más de esto sin actividad, está dormido:
 * va plegado al final de su carpeta en "N dormidos". Nada se esconde por tiempo, sólo se pliega.
 */
export const DORMIDO_S = 24 * 3600;
/** Un worker cuyo líder ya no vive se muestra (bajo su líder sin proceso, o en "sin líder") hasta esto. */
export const HUERFANO_S = 24 * 3600;

export type Item = { h: Hilo; estado: Estado };

/**
 * Lo que cuelga dentro de una carpeta: un líder con sus workers, los huérfanos
 * ("sin líder") o lo que lanzó el usuario sin líder (la app). `vivas` se ve siempre:
 * lo que trabaja y lo que pide algo. `viejas` es lo que terminó y se esconde
 * solo (`seOculta`): va plegado en el "+N" del líder o en "N terminadas". Bajo
 * un líder, en la vista de todo (`aVistaTodo`), también lo que murió o frenó
 * `pa`, en "N terminados". Lo que `pa` ya cerró (integrado, archivado, …) se va
 * a "Cerrados".
 */
export type Rama = {
  clave: string;
  tipo: "lider" | "huerfanos" | "sueltas";
  lider: Lider | null;
  vivas: Item[];
  viejas: Item[];
  /**
   * Sólo en "sin líder": quién lanzó lo que cuelga acá, por nombre. `muertos`, los líderes
   * que murieron sin cerrar (los mataron, se colgó la máquina); `idos`, los que ya no están.
   */
  muertos?: string[];
  idos?: string[];
};

/**
 * `ramas`: los líderes en su orden fijo (`ordenLideres`) y, al final, lo suelto y lo huérfano.
 * `espera`: los líderes ociosos, plegados al final en "N líderes en espera"
 * (pliegue de clave `espera:<proyecto>`). `dormidos`: los sin proceso de más de un día, plegados
 * después de ésos en "N dormidos" (`dormidos:<proyecto>`).
 */
export type Carpeta = { proyecto: string; ramas: Rama[]; espera: Rama[]; dormidos: Rama[]; cuenta: number };

/** La clave del pliegue de los líderes en espera de una carpeta. */
export const claveEspera = (proyecto: string) => `espera:${proyecto}`;
/** La clave del pliegue de los líderes dormidos de una carpeta. */
export const claveDormidos = (proyecto: string) => `dormidos:${proyecto}`;

/**
 * Cómo se ve el nombre de una carpeta: la del home (`GENERAL`, donde arranca
 * un líder nuevo) lleva el usuario del sistema o, si no se sabe, `home`; un
 * proyecto, su `titulo` del registry si tiene (a `pa` va siempre el nombre).
 */
export const nombreCarpeta = (proyecto: string, usuario: string | null | undefined, home: string, titulo?: string | null) =>
  proyecto === GENERAL ? usuario?.trim() || home : titulo?.trim() || proyecto;

export type Arbol = {
  carpetas: Carpeta[];
  /** Lo cerrado que no quedó en ningún árbol: "Cerrados · N", al fondo. */
  cerrados: Item[];
  /** Los líderes de la barra por id (también los que quedaron sin proceso), con la carpeta que les tocó. */
  lideres: Map<string, Lider>;
  /** Los que se hacen cargo de sus workers: todos menos los que quedaron sin proceso (`caido`). */
  aCargo: Set<string>;
};

/** Cuándo terminó (o empezó, si sigue); lo que murió, cuándo lo vio morir la app (si lo vio). */
export const fin = (h: Hilo) => h.murio_en ?? h.inicio + (h.duracion_s ?? 0);

/** La lanzó un líder: lo que pregunte es para el líder, no para el usuario. */
export const deLider = (h: Hilo) => h.origen === "jefe";

/** Pasado esto desde su arranque, un worker sin datos deja de ser "Arrancando…": ya no es que `pa` no los escribió todavía. */
export const ARRANQUE_S = 120;

/**
 * Recién lanzado: `pa --hilos` lo lista antes de escribir su `.hilo` (tarea, líder, rama) y la app lo
 * pinta desde el evento de arranque (`Hilo.arrancando`). Mientras faltan sus datos dice "Arrancando…", no
 * "Sin tarea / sin líder / sin rama".
 */
export const arrancando = (h: Pick<Hilo, "tarea" | "estado" | "rama" | "inicio" | "arrancando" | "en_cola">, ahora: number) =>
  h.estado === "trabajando" && !h.en_cola && !h.tarea && !h.rama && (h.arrancando === true || ahora - h.inicio < ARRANQUE_S);

/** Lo frenó a propósito `pa --parar`: lo lista como `murio`, pero no se cayó ni falló. */
export const frenado = (it: Item) => it.estado === "murio" && it.h.frenado_en != null;

/** El estado que se muestra. Sólo pide algo al usuario ("Te necesita") lo que no lanzó un líder. */
export function estadoVisto(h: Hilo, optimista?: Estado): Estado {
  const e = optimista ?? h.estado;
  return e === "decision" && deLider(h) ? "listo" : e;
}

/** Trabajando, trabado o en cola. */
export const activo = (it: Item) => it.estado === "trabajando" || it.estado === "colgado" || it.h.en_cola;

/**
 * ¿Se esconde solo? (B15) Lo que terminó y no le pide nada al usuario no ocupa la
 * barra. Queda a la vista lo que trabaja (o está trabado o en cola), lo que
 * falló y, si no hay un líder vivo que se haga cargo (`conLider`), lo que
 * espera una decisión y lo que dejó una rama con commits sin integrar.
 */
export function seOculta(it: Item, conLider: boolean): boolean {
  if (activo(it) || it.estado === "murio") return false;
  if (conLider || cerrado(it.estado)) return true;
  // Sin líder la decisión es del usuario, aunque la haya lanzado uno (`estadoVisto` la muestra como terminada).
  if (it.estado === "decision" || it.h.estado === "decision") return false;
  return !(it.h.rama && it.h.commits > 0);
}

/**
 * Lo que se lista debajo de un líder en la vista "Líderes y workers" (`aVistaTodo`): lo que trabaja (o
 * está trabado o en cola) y lo que espera al usuario ("te necesita"). Murió, terminó o `pa --parar` frenó
 * se pliega en "N terminados". Sólo de un líder sin proceso queda también lo que dejó una rama con
 * commits sin integrar: nadie se hace cargo de su Settle más que el usuario.
 */
export const aLaVista = (it: Item, conLider: boolean): boolean =>
  activo(it) || it.estado === "decision" || (!conLider && it.estado !== "murio" && !seOculta(it, false));

/** Lo vivo de un líder, en números: para su fila cuando la barra muestra sólo líderes. */
export type Resumen = { trabajando: number; trabados: number; fallaron: number; frenados: number };

export function resumen(vivas: Item[]): Resumen {
  const r = { trabajando: 0, trabados: 0, fallaron: 0, frenados: 0 };
  for (const it of vivas) {
    if (it.estado === "colgado") r.trabados++;
    else if (frenado(it)) r.frenados++;
    else if (it.estado === "murio") r.fallaron++;
    else if (activo(it)) r.trabajando++;
  }
  return r;
}

/**
 * ¿El worker tiene Settle propio? Sólo si terminó y no tiene un líder que se haga cargo
 * (viejo, lanzado desde la app, huérfano o de un líder sin proceso): los de un líder se van
 * con el Settle del líder. `lideres`: los que se hacen cargo (`Arbol.aCargo`).
 */
export const settleWorker = (h: Hilo, estado: Estado, lideres: { has(id: string): boolean }) =>
  cerrable(estado) && !(h.jefe_id && lideres.has(h.jefe_id));

/**
 * Qué ofrece el Settle propio de un worker. Lo que murió no se integra con tests a
 * ciegas: sin commits (o sin rama) no hay nada que perder y se quita de una; con
 * commits, el usuario elige entre Integrar y Quitar (este confirma). El resto, Settle.
 */
export type Salida = "settle" | "quitar" | "elegir";

export const salidaDe = (h: Pick<Hilo, "rama" | "commits">, estado: Estado): Salida =>
  estado !== "murio" ? "settle" : h.rama && (h.commits ?? 0) > 0 ? "elegir" : "quitar";

/** Lo que pide un botón del Settle propio: el Settle de siempre, o Integrar / Quitar de lo que murió. */
export type Como = "settle" | "integrar" | "quitar";

/** El Settle propio de un worker (`settleWorker`) y qué ofrece; `null` si no tiene. */
export const salidaWorker = (h: Hilo, estado: Estado, lideres: { has(id: string): boolean }): Salida | null =>
  settleWorker(h, estado, lideres) ? salidaDe(h, estado) : null;

/**
 * El error de `pa` en una fila: lo que dijo entero va al tooltip; en la fila, si es
 * largo, una clave corta (i18n) en vez de stderr cortado a mitad de palabra.
 * `null`: ya es corto, va tal cual.
 */
export function claveError(texto: string): `fila.error${"Conflictos" | "Ocupado" | "SinTests" | "Pa"}` | null {
  if (texto.length <= 48 && !texto.includes("\n")) return null;
  if (/conflict/i.test(texto)) return "fila.errorConflictos";
  if (/sigue viva|la está usando|sigue ocupado|reintentá/i.test(texto)) return "fila.errorOcupado";
  if (/no tiene `tests`/.test(texto)) return "fila.errorSinTests";
  return "fila.errorPa";
}

/**
 * Lo que se ve de un error de `pa` en una fila: el corto de `claveError`, o la frase simple si es de los
 * códigos que `pa` da seguido (`fraseConocida`) y no tenía uno propio; lo desconocido, crudo como hoy.
 */
export function errorCorto(texto: string): string {
  const k = claveError(texto);
  const frase = k === null || k === "fila.errorPa" ? fraseConocida(texto) : null;
  return frase ?? (k ? t(k) : texto);
}

/** Quitar: con rama, `pa --descartar` (borra la rama); sin rama no hay qué descartar y se archiva. */
export const comoQuitar = (h: Pick<Hilo, "rama">): "descartar" | "archivar" => (h.rama ? "descartar" : "archivar");

export type SettleLider = {
  /** Quieto: no responde y no tiene workers trabajando ni en cola. Si no, el botón no aparece. */
  puede: boolean;
  /** Los workers terminados que se archivan (`pa --archivar`). */
  archivar: string[];
  /** Cuántas ramas con commits quedan sin integrar: si hay, se confirma en línea antes. */
  ramas: number;
};

/** El Settle de un líder ("esta conversación terminó") con los workers que cuelgan de él. */
export function settleLider(l: Pick<Lider, "ocupado">, workers: Item[]): SettleLider {
  const terminados = workers.filter((it) => cerrable(it.estado) && !it.h.en_cola);
  return {
    puede: !l.ocupado && !workers.some(activo),
    archivar: terminados.map((it) => it.h.id),
    // Un `--seguir` trabaja sobre la rama del que retoma: se cuenta una vez.
    ramas: new Set(terminados.filter((it) => it.h.rama && it.h.commits > 0).map((it) => it.h.rama)).size,
  };
}

/** Para buscar: sin mayúsculas ni tildes ("Líder" = "lider"). */
export const normal = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Cuánto coincide `q` (ya `normal`) con lo mejor de `xs`: 3 igual, 2 empieza, 1 contiene, 0 nada. */
export function puntaje(q: string, ...xs: (string | null | undefined)[]): number {
  let n = 0;
  for (const x of xs) {
    if (!x) continue;
    const s = normal(x);
    n = Math.max(n, s === q ? 3 : s.startsWith(q) ? 2 : s.includes(q) ? 1 : 0);
  }
  return n;
}

const coincide = (q: string, ...xs: (string | null | undefined)[]) => puntaje(q, ...xs) > 0;

const porInicio = (a: Item, b: Item) => b.h.inicio - a.h.inicio;

/**
 * El orden de la barra es fijo: cada sesión tiene su lugar y no lo cambia por lo que
 * hace (quién escribió último, quién responde, quién tiene workers trabajando). Eso lo
 * dice el indicador de la fila, nunca la posición. Los líderes de una carpeta van por
 * cuándo se crearon, el más viejo arriba: uno nuevo entra al final y no corre a nadie.
 * Sale sólo de datos que no cambian, así que es el mismo tras relanzar y en el celular.
 * Lo único que lo cambia es el usuario arrastrando (`Opciones.orden`): eso gana sobre esto.
 */
export const ordenLideres = (a: Pick<Lider, "id" | "creado">, b: Pick<Lider, "id" | "creado">) =>
  a.creado - b.creado || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Orden por prioridad (`Orden.prioridad`, prendido de fábrica; apagado, queda el orden fijo de arriba).
 * Cada líder cae en un rango: 0 si necesita al usuario (pide un permiso o una pregunta, o terminó su turno y no lo
 * vio: `Lider.espera`/`pide`), 1 si tiene el caché vivo (`cache_vence` en el futuro: lo que el numerito no dice
 * "Uncached") y 2 el resto. Una carpeta toma el mejor rango de sus líderes. Los rangos 0 y 1 mantienen entre sí
 * el orden de siempre (así un chat que escribe no salta cada vez que contesta); el 2 va por actividad reciente.
 * `a` es la actividad de ese momento (sólo cuenta en el rango 2): se congela junto con el rango.
 */
export type Rango = { r: 0 | 1 | 2; a: number };
export type Prioridad = ReadonlyMap<string, Rango>;

export function rangoLider(l: Pick<Lider, "espera" | "pide" | "cache_vence" | "caido" | "actividad" | "subagentes">, ahora: number): Rango {
  if (!l.caido && (l.espera || l.pide)) return { r: 0, a: 0 };
  // Con subagentes corriendo la sesión trabaja aunque su caché ya no cuente: no cae al rango de las dormidas.
  if (!l.caido && l.subagentes) return { r: 1, a: 0 };
  if (!l.caido && l.cache_vence != null && l.cache_vence > ahora) return { r: 1, a: 0 };
  return { r: 2, a: l.actividad };
}

/** Los rangos de todos los líderes; `igualPrioridad` evita rearmar la barra si nada cambió. */
export const prioridadDe = (lideres: readonly Lider[], ahora: number): Prioridad => new Map(lideres.map((l) => [l.id, rangoLider(l, ahora)]));

export function igualPrioridad(a: Prioridad | undefined, b: Prioridad | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  for (const [id, x] of a) {
    const y = b.get(id);
    if (!y || y.r !== x.r || y.a !== x.a) return false;
  }
  return true;
}

/** Cuándo (epoch s) vence el primer caché que hoy está vivo: ahí hay que volver a mirar los rangos. `null`: ninguno. */
export function proximoVencimiento(lideres: readonly Lider[], ahora: number): number | null {
  let min: number | null = null;
  for (const l of lideres) if (!l.caido && l.cache_vence != null && l.cache_vence > ahora && (min === null || l.cache_vence < min)) min = l.cache_vence;
  return min;
}

/** Entre líderes con prioridad: por rango; el 2, el más reciente primero; empate, el orden de siempre (`resto`). */
export const compararPrioridad = <T extends { id: string }>(p: Prioridad, resto: (a: T, b: T) => number) => (a: T, b: T) => {
  const x = p.get(a.id) ?? { r: 2, a: 0 };
  const y = p.get(b.id) ?? { r: 2, a: 0 };
  return x.r - y.r || (x.r === 2 ? y.a - x.a : 0) || resto(a, b);
};

/**
 * Las carpetas, por el nombre que se ve (título del registry o nombre), sin mayúsculas
 * ni tildes; la del home va primera siempre (ahí vive Nuevo líder). Sin `localeCompare`:
 * el orden no depende del idioma de la máquina ni del navegador del celular.
 */
export function ordenCarpetas(a: string, b: string, titulos?: ReadonlyMap<string, string>): number {
  if (a === b) return 0;
  if (a === GENERAL || b === GENERAL) return a === GENERAL ? -1 : 1;
  const x = normal(titulos?.get(a)?.trim() || a);
  const y = normal(titulos?.get(b)?.trim() || b);
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : 1;
}

/**
 * Las carpetas como se ven: la del home primera siempre (no se mueve), después las que el usuario
 * acomodó arrastrando, en ese orden, y al final las que nunca movió, por nombre.
 */
export function compararCarpetas(orden: Orden | undefined, titulos?: ReadonlyMap<string, string>): (a: string, b: string) => number {
  const manual = porManual<string>(orden?.carpetas, (p) => p, (a, b) => ordenCarpetas(a, b, titulos));
  return (a, b) => (a === b ? 0 : a === GENERAL || b === GENERAL ? (a === GENERAL ? -1 : 1) : manual(a, b));
}

/** Los líderes de una carpeta como se ven: los que el usuario acomodó arrastrando y, después, el resto por creación. */
export const compararLideres = (orden: Orden | undefined, proyecto: string) =>
  porManual<Pick<Lider, "id" | "creado">>(orden?.lideres[proyecto], (l) => l.id, ordenLideres);

/**
 * Todos los líderes de una carpeta en el orden que les toca, también los plegados en "N líderes
 * en espera": la lista entera sobre la que se mueve uno al arrastrarlo.
 */
export const lideresEnOrden = (c: Carpeta, orden: Orden | undefined): string[] =>
  [...c.ramas, ...c.espera, ...c.dormidos]
    .flatMap((r) => (r.lider ? [r.lider] : []))
    .sort(compararLideres(orden, c.proyecto))
    .map((l) => l.id);

/**
 * Los líderes que ya no están en la lista del main (cerraron, o los mataron y su sesión
 * ya no queda) pero dejaron algo a la vista: un worker que trabaja, falló, espera una
 * decisión o tiene una rama sin integrar (lo que `seOculta` no esconde), del último día.
 * Siguen en la barra con sus workers colgando, sin proceso (`caido`), para retomarlos.
 * "murio" si se sabe que lo mataron (`caidos`); si no, "cerro".
 */
export function lideresSinProceso(
  hilos: readonly Hilo[],
  { lideres, caidos, optimista, ahora }: { lideres: readonly Lider[]; caidos?: readonly Caido[]; optimista?: ReadonlyMap<string, Estado>; ahora: number },
): Lider[] {
  const estan = new Set(lideres.map((l) => l.id));
  const por = new Map<string, { nombre: string; actividad: number; pide: boolean }>();
  // Cuándo se creó no se sabe (ya no está su sesión): su lugar es el de su primer worker, que no cambia.
  const creado = new Map<string, number>();
  for (const h of hilos) {
    if (!h.jefe_id || !deLider(h) || estan.has(h.jefe_id)) continue;
    creado.set(h.jefe_id, Math.min(creado.get(h.jefe_id) ?? Infinity, h.inicio));
    const it: Item = { h, estado: estadoVisto(h, optimista?.get(h.id)) };
    if (!activo(it) && fin(h) < ahora - HUERFANO_S) continue;
    let x = por.get(h.jefe_id);
    if (!x) por.set(h.jefe_id, (x = { nombre: "", actividad: 0, pide: false }));
    x.nombre ||= h.jefe ?? "";
    x.actividad = Math.max(x.actividad, Math.min(ahora, fin(h)));
    x.pide ||= !seOculta(it, false);
  }
  const caido = new Map((caidos ?? []).map((c) => [c.id, c]));
  const out: Lider[] = [];
  for (const [id, x] of por) {
    if (!x.pide) continue;
    const c = caido.get(id);
    out.push({
      id,
      nombre: c?.nombre || x.nombre,
      proyecto: GENERAL,
      titulo: "",
      actividad: x.actividad,
      creado: creado.get(id) ?? 0,
      cache_ttl_s: null,
      cache_vence: 0,
      origen: "terminal",
      pid: null,
      vivo: false,
      ocupado: false,
      modelo: null,
      effort: null,
      caido: c ? "murio" : "cerro",
    });
  }
  return out;
}

type Opciones = {
  optimista?: ReadonlyMap<string, Estado>;
  lideres: Lider[];
  /** Líderes settleados (id → epoch del Settle): no se ven hasta que tengan actividad nueva. */
  settleados?: ReadonlyMap<string, number>;
  busqueda?: string;
  /** Líderes que el usuario movió a otra carpeta (B20, "Mover a proyecto…"): session_id → carpeta. */
  mover?: ReadonlyMap<string, string>;
  /** Carpetas con los workers terminados escondidos (B20): todo lo que no trabaja va al "+N" o a "N terminadas". */
  ocultos?: ReadonlySet<string>;
  /** El `titulo` del registry de cada proyecto (slug → título): la carpeta se busca también por él. */
  titulos?: ReadonlyMap<string, string>;
  /** Los líderes que murieron sin cerrar (`RespuestaLideres.caidos`): "sin líder" los nombra. */
  caidos?: readonly Caido[];
  /** El orden que el usuario puso arrastrando (`nombres.json`): gana sobre el de siempre. */
  orden?: Orden;
  /** Con el orden por prioridad prendido (el de fábrica), los rangos (ya congelados por quien arma la barra); sin él, el orden fijo. */
  prioridad?: Prioridad;
  /** Epoch en segundos. */
  ahora: number;
};

/**
 * Arma las carpetas. Sin búsqueda, sólo las que tienen algo activo: un líder
 * (vivo o sin proceso: `caido`), un worker trabajando o en cola, un huérfano que
 * pide algo, o algo que lanzó el usuario y no cerró. Los workers de un líder sin
 * proceso cuelgan de él con las reglas de un huérfano (nadie se hace cargo). Con búsqueda (sin mayúsculas ni tildes), primero la
 * carpeta cuyo nombre o título coincide (igual > empieza > contiene) con todo lo
 * suyo; después las que tienen líderes (por nombre) o hilos (por su título) que
 * coinciden. Lo que no trabaja se pliega igual que sin buscar, y lo cerrado
 * también (en su carpeta, no en "Cerrados").
 */
export function armarArbol(hilos: Hilo[], { optimista, lideres: todos, settleados, busqueda = "", mover, ocultos, titulos, caidos, orden, prioridad, ahora }: Opciones): Arbol {
  const lideres = settleados?.size ? todos.filter((l) => !(l.actividad <= (settleados.get(l.id) ?? -1))) : todos;
  const q = normal(busqueda.trim());
  const buscando = q !== "";
  // Cuánto coincide cada carpeta por su nombre o su título (General no tiene: es el home).
  const puntos = new Map<string, number>();
  const deCarpeta = (p: string) => {
    let n = puntos.get(p);
    if (n === undefined) puntos.set(p, (n = !buscando || p === GENERAL ? 0 : puntaje(q, p, titulos?.get(p))));
    return n;
  };

  // Cada líder va a la carpeta que eligió el usuario; si no, a la de su primer worker;
  // sin workers, a la del proyecto que nombra su primer mensaje (`inferido`, del
  // main) y si no nombra ninguno, a "general". El primero y no el más nuevo: un
  // líder que reparte trabajo en varios proyectos no salta de carpeta con cada worker.
  // Shark (el asistente de voz) va siempre a su carpeta propia, con sus workers, salvo que el usuario lo mueva.
  const primero = new Map<string, Hilo>();
  const vivos = new Set(lideres.map((l) => l.id));
  for (const h of hilos) {
    if (!h.jefe_id || !vivos.has(h.jefe_id)) continue;
    const y = primero.get(h.jefe_id);
    if (!y || h.inicio < y.inicio || (h.inicio === y.inicio && h.id < y.id)) primero.set(h.jefe_id, h);
  }
  const lid = new Map<string, Lider>();
  for (const l of lideres) {
    const proyecto = mover?.get(l.id) ?? (esShark(l) ? SHARK : undefined) ?? primero.get(l.id)?.proyecto ?? l.inferido ?? GENERAL;
    lid.set(l.id, l.proyecto === proyecto ? l : { ...l, proyecto });
  }

  const caido = new Map((caidos ?? []).filter((c) => !vivos.has(c.id)).map((c) => [c.id, c]));
  type Armando = { lideres: Map<string, Rama>; huerfanos: Rama; sueltas: Rama };
  const carpetas = new Map<string, Armando>();
  const carpeta = (p: string) => {
    let c = carpetas.get(p);
    if (!c)
      carpetas.set(
        p,
        (c = {
          lideres: new Map(),
          huerfanos: { clave: `huerfanos:${p}`, tipo: "huerfanos", lider: null, vivas: [], viejas: [] },
          sueltas: { clave: `sueltas:${p}`, tipo: "sueltas", lider: null, vivas: [], viejas: [] },
        }),
      );
    return c;
  };
  const ramaLider = (l: Lider) => {
    const c = carpeta(l.proyecto);
    let r = c.lideres.get(l.id);
    if (!r) c.lideres.set(l.id, (r = { clave: `lider:${l.id}`, tipo: "lider", lider: l, vivas: [], viejas: [] }));
    return r;
  };

  if (!buscando) for (const l of lid.values()) ramaLider(l);
  // Buscando: el líder que coincide por nombre (o por su carpeta) trae a sus workers, plegados.
  const traen = new Set<string>();
  if (buscando)
    for (const l of lid.values())
      if (deCarpeta(l.proyecto) || coincide(q, l.nombre, l.titulo)) {
        traen.add(l.id);
        ramaLider(l);
      }

  // Lo que no trabaja de una carpeta con los terminados ocultos, plegado siempre.
  // Buscando, también lo que falló y lo cerrado: los resultados no se despliegan todos.
  const plegar = (it: Item, p: string, conLider: boolean) =>
    (ocultos?.has(p) && !activo(it)) || seOculta(it, conLider) || (buscando && !activo(it) && (it.estado === "murio" || cerrado(it.estado)));

  const sueltos: Item[] = [];
  for (const h of hilos) {
    const it: Item = { h, estado: estadoVisto(h, optimista?.get(h.id)) };
    const l = h.jefe_id ? lid.get(h.jefe_id) : undefined;
    // Un hilo coincide por su título (o porque su carpeta coincide), no por la rama ni el id.
    if (buscando && !(l && traen.has(l.id)) && !deCarpeta(l?.proyecto ?? h.proyecto) && !coincide(q, h.tarea)) continue;
    if (l) {
      // Lo que `pa` ya cerró no queda colgando: va a "Cerrados" (buscando, plegado en su carpeta).
      // Lo viejo de un líder sin proceso tampoco, como lo de un huérfano.
      if (!buscando && (cerrado(it.estado) || (l.caido && !activo(it) && fin(h) < ahora - HUERFANO_S))) sueltos.push(it);
      else {
        const r = ramaLider(l);
        (plegar(it, l.proyecto, !l.caido) ? r.viejas : r.vivas).push(it);
      }
    } else if (deLider(h) && !arrancando(h, ahora)) {
      // Huérfano: su líder ya no vive. (Uno recién lanzado todavía no dice quién es su líder: va suelto.)
      if (!buscando && !activo(it) && fin(h) < ahora - HUERFANO_S) {
        sueltos.push(it);
        continue;
      }
      const r = carpeta(h.proyecto).huerfanos;
      (plegar(it, h.proyecto, false) ? r.viejas : r.vivas).push(it);
    } else if (cerrado(it.estado) && !buscando) sueltos.push(it);
    else {
      const r = carpeta(h.proyecto).sueltas;
      (plegar(it, h.proyecto, false) ? r.viejas : r.vivas).push(it);
    }
  }

  const cerrados = sueltos.filter((it) => cerrado(it.estado));
  const salida: { c: Carpeta; puntos: number }[] = [];
  for (const [proyecto, a] of carpetas) {
    // Cada líder en su lugar de siempre: ni responder ni tener workers trabajando lo mueve.
    const fijo = compararLideres(orden, proyecto);
    const porLider = prioridad && !buscando ? compararPrioridad<Pick<Lider, "id" | "creado">>(prioridad, fijo) : fijo;
    const ls = [...a.lideres.values()].sort((x, y) => porLider(x.lider!, y.lider!));
    // Ocioso: nada colgando (ni escondido en su "+N"), sin responder y sin actividad en 30 min (buscando no se pliega nada).
    // Uno sin proceso no espera nada: queda a la vista hasta que el usuario lo retome o lo archive.
    const ocioso = (r: Rama) =>
      !buscando && !r.lider!.ocupado && !r.lider!.caido && r.vivas.length + r.viejas.length === 0 && r.lider!.actividad < ahora - ESPERA_S;
    // Dormido: sin proceso, nada colgando y más de un día quieto (también el Murió): no se esconde, se pliega al final.
    const dormido = (r: Rama) =>
      !buscando && !r.lider!.vivo && !r.lider!.ocupado && r.vivas.length + r.viejas.length === 0 && r.lider!.actividad < ahora - DORMIDO_S;
    const dormidos = ls.filter(dormido);
    const espera = ls.filter((r) => !dormido(r) && ocioso(r));
    const ramas = [...ls.filter((r) => !dormido(r) && !ocioso(r)), a.sueltas, a.huerfanos].filter(
      (r) => r.tipo === "lider" || r.vivas.length + r.viejas.length > 0,
    );
    for (const r of ramas) {
      r.vivas.sort(porInicio);
      r.viejas.sort(porInicio);
    }
    // "Sin líder" dice de quién eran: no es lo mismo un líder que cerró que uno que murió.
    const muertos = new Set<string>();
    const idos = new Set<string>();
    for (const { h } of [...a.huerfanos.vivas, ...a.huerfanos.viejas]) {
      const c = h.jefe_id ? caido.get(h.jefe_id) : undefined;
      if (c) muertos.add(c.nombre || h.jefe || c.id.slice(0, 8));
      else if (h.jefe) idos.add(h.jefe);
    }
    a.huerfanos.muertos = [...muertos];
    a.huerfanos.idos = [...idos];
    const items = ramas.flatMap((r) => [...r.vivas, ...r.viejas]);
    // Lo del usuario, aunque esté plegado, y lo huérfano que trabaja o pide algo.
    const visible = buscando || ls.length > 0 || a.sueltas.vivas.length + a.sueltas.viejas.length > 0 || a.huerfanos.vivas.length > 0;
    if (!visible) {
      // Carpeta quieta: no se ve; lo cerrado de ella sigue en "Cerrados".
      for (const it of items) if (cerrado(it.estado)) cerrados.push(it);
      continue;
    }
    salida.push({ c: { proyecto, ramas, espera, dormidos, cuenta: items.length }, puntos: deCarpeta(proyecto) });
  }
  // Buscando, primero la carpeta que coincide por nombre o título; si no, el orden fijo (o el que puso el usuario).
  const porCarpeta = compararCarpetas(orden, titulos);
  // Con prioridad, el home sigue primero (ahí vive Nuevo líder) y cada carpeta va por su mejor líder.
  const mejor = (c: Carpeta): Rango => {
    let m: Rango = { r: 2, a: 0 };
    for (const r of [...c.ramas, ...c.espera, ...c.dormidos]) {
      const x = r.lider && prioridad?.get(r.lider.id);
      if (x && (x.r < m.r || (x.r === m.r && x.a > m.a))) m = x;
    }
    return m;
  };
  const porPrioridad = (a: Carpeta, b: Carpeta) => {
    if (a.proyecto === GENERAL || b.proyecto === GENERAL) return 0;
    const x = mejor(a);
    const y = mejor(b);
    return x.r - y.r || (x.r === 2 ? y.a - x.a : 0);
  };
  salida.sort((a, b) => b.puntos - a.puntos || (prioridad && !buscando ? porPrioridad(a.c, b.c) : 0) || porCarpeta(a.c.proyecto, b.c.proyecto));
  cerrados.sort((a, b) => fin(b.h) - fin(a.h));
  const aCargo = new Set<string>();
  for (const l of lid.values()) if (!l.caido) aCargo.add(l.id);
  return { carpetas: salida.map((x) => x.c), cerrados, lideres: lid, aCargo };
}

/**
 * La vista "Líderes y workers" sobre el árbol de `armarArbol` (que es el de "sólo líderes"): debajo de cada
 * líder y en "sin líder" (huérfanos), lo que no se ve (`aLaVista`) pasa de `vivas` a `viejas` y se pliega en
 * "N terminados" / "N terminadas". Lo del usuario sin líder (sueltas) no cambia. Pura: no toca los totales,
 * sólo dónde cae cada worker.
 */
export function aVistaTodo(a: Arbol): Arbol {
  return {
    ...a,
    carpetas: a.carpetas.map((c) => ({
      ...c,
      ramas: c.ramas.map((r) => {
        if (r.tipo === "sueltas" || (r.tipo === "lider" && !r.lider)) return r;
        // Sin líder no hay quien se haga cargo: como un líder sin proceso, lo que dejó una rama con commits se queda.
        const conLider = r.tipo === "lider" && !r.lider!.caido;
        const escondidas = r.vivas.filter((it) => !aLaVista(it, conLider));
        if (!escondidas.length) return r;
        return { ...r, vivas: r.vivas.filter((it) => aLaVista(it, conLider)), viejas: [...escondidas, ...r.viejas].sort(porInicio) };
      }),
    })),
  };
}

/**
 * Las filas que se ven, en orden (para el teclado y para decidir si se
 * virtualiza). `abierta(clave)` dice si una carpeta (clave = proyecto) o el
 * pliegue de una rama (clave de la rama) está abierto. `soloLideres`: los
 * workers de un líder no tienen fila propia (van resumidos en la del líder)
 * salvo que su pliegue esté abierto; lo que no cuelga de un líder sigue igual.
 */
export function filasVisibles(a: Arbol, abierta: (clave: string) => boolean, verCerrados: boolean, soloLideres = false): Item[] {
  const out: Item[] = [];
  for (const c of a.carpetas) {
    if (!abierta(c.proyecto)) continue;
    for (const r of c.ramas) {
      const abre = abierta(r.clave);
      if (abre || !(soloLideres && r.tipo === "lider")) out.push(...r.vivas);
      if (abre) out.push(...r.viejas);
    }
    // Los líderes en espera no tienen workers colgando (si no, no estarían en espera).
  }
  if (verCerrados) out.push(...a.cerrados);
  return out;
}

/** Dónde quedó un líder en la barra: su carpeta y si cayó entre los "N líderes en espera" o los "N dormidos". */
export type Lugar = { sid: string; proyecto: string; espera: boolean; dormido: boolean };

/** `null`: no está en la barra (todavía no llegó, se archivó, o la búsqueda no lo trae). */
export function lugarLider(a: Arbol, sid: string): Lugar | null {
  const proyecto = a.lideres.get(sid)?.proyecto;
  const c = proyecto === undefined ? undefined : a.carpetas.find((x) => x.proyecto === proyecto);
  if (!c) return null;
  const es = (r: Rama) => r.lider?.id === sid;
  if (c.espera.some(es)) return { sid, proyecto: c.proyecto, espera: true, dormido: false };
  if (c.dormidos.some(es)) return { sid, proyecto: c.proyecto, espera: false, dormido: true };
  return c.ramas.some(es) ? { sid, proyecto: c.proyecto, espera: false, dormido: false } : null;
}

/**
 * Qué hay que abrir para que el líder que se está viendo quede a la vista: su
 * carpeta (clave = proyecto) cuando cambia la selección o él cambia de carpeta, y
 * el pliegue de espera o el de dormidos si cayó ahí. `antes` es lo último que se desplegó: sin
 * cambio no devuelve nada, así lo que el usuario pliega a mano se respeta.
 */
export function aDesplegar(antes: Lugar | null, ahora: Lugar | null): string[] {
  if (!ahora) return [];
  const cambio = !antes || antes.sid !== ahora.sid || antes.proyecto !== ahora.proyecto;
  const claves = cambio ? [ahora.proyecto] : [];
  if (ahora.espera && (cambio || !antes.espera)) claves.push(claveEspera(ahora.proyecto));
  if (ahora.dormido && (cambio || !antes.dormido)) claves.push(claveDormidos(ahora.proyecto));
  return claves;
}
