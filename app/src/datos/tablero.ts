// El tablero de pendientes del usuario (el CLI `tablero`): los tipos de lo que manda el main
// (electron/tablero.ts) y la lógica pura del panel (validar, filtrar, lo optimista, las filas de
// Proyectos, qué tarjetas pintar de una columna larga). Sin imports de React ni del DOM: lo prueba
// `node --test` (tests/tablero.test.ts). De dónde salen los datos: ./fuenteTablero.ts.

/** Las columnas que se ven, en orden. `hecho` va plegada; `tirado` no se muestra. */
export const ABIERTAS = ["bandeja", "sigue", "en-curso", "espera-dueno", "espera-externo", "ideas"] as const;
export type Abierta = (typeof ABIERTAS)[number];
export type Columna = Abierta | "hecho";

/**
 * Qué item es. Los de este tablero llevan su número; los de otra máquina (`maquina`) llevan `maquina:número`, porque
 * los números de dos tableros chocan: la acción sobre uno va al tablero de su máquina.
 */
export type ItemId = number | string;

/** El número que se ve (`#12`) de un id, con o sin el prefijo de su máquina. */
export const numero = (id: ItemId): string => String(id).replace(/^.*:/, "");

export type Item = {
  id: ItemId;
  /** El id de la otra máquina de la que viene (`servidor`) y su nombre; sin venir, el item es de este tablero. */
  maquina?: string;
  maquinaNombre?: string;
  columna: string;
  proyecto: string;
  titulo: string;
  detalle: string;
  /** El comando o nombre exacto de lo que el usuario tiene que probar. */
  prueba: string;
  /** Quién lo anotó (pa, doctor, shark, trama…). */
  origen: string;
  /** De qué fuente automática vino (`pa:<id>`, `doctor:<proyecto>:<chequeo>`); vacía si fue a mano. */
  clave: string;
  head: string | null;
  creado: string;
  tocado: string;
  cerrado: string | null;
  hasta: string | null;
  /** Pregunta o prueba (el CLI lo deriva si el item no lo trae). Lo usa el tablero nuevo (./pendientes.ts). */
  tipo: "pregunta" | "prueba";
  /** Una línea en palabras simples, y el contexto en una o dos: vacíos en un item viejo. */
  tituloSimple: string;
  contexto: string;
  /** Los botones de una pregunta, y el id del que viene sugerido. */
  opciones: { id: string; texto: string }[];
  porDefecto: string | null;
  /** Lo que el usuario contestó (`tablero responder`); `null` si no. El item no se cierra ni se mueve. */
  respuesta: Respuesta | null;
};

/** Lo que el usuario contestó a un item: `anda` sólo en una prueba; `opcion`/`opcionTexto`, si apretó un botón. */
export type Respuesta = { texto: string; opcion: string | null; opcionTexto: string | null; anda: boolean | null; fecha: string };

/** Una fila de `tablero proyectos`. `dias === null`: no hay repo donde mirar. */
export type Proyecto = { proyecto: string; etapa: string; dias: number | null; abiertos: number; sigue: string | null };

export type Tablero = {
  columnas: Record<Abierta, Item[]>;
  /** Lo cerrado en los últimos días, lo más nuevo primero. */
  hecho: Item[];
  proyectos: Proyecto[];
  pospuestos: number;
  /** Los items pospuestos (`hasta` en el futuro), con su `hasta`: salen de las columnas hasta ese día o hasta que se los trae de vuelta. */
  pospuestosLista: Item[];
  /** Lo que no se pudo leer (lo hecho, los proyectos o los pospuestos): el tablero sale igual. */
  aviso: string | null;
  /** Los nombres de las otras máquinas que no se pudieron leer: sus items no están. Vacío sin otras máquinas. */
  caidas: string[];
  /** No hay tablero todavía (no existe la vista): las columnas van vacías y el panel muestra el estado vacío. */
  sinVista: boolean;
};

export class ErrorTablero extends Error {}

const texto = (x: unknown) => (typeof x === "string" ? x : x == null ? "" : String(x));
const textoONada = (x: unknown) => (typeof x === "string" && x ? x : null);

function respuesta(x: unknown): Respuesta | null {
  const o = x as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return null;
  return { texto: texto(o.texto), opcion: textoONada(o.opcion), opcionTexto: textoONada(o.opcion_texto), anda: typeof o.anda === "boolean" ? o.anda : null, fecha: texto(o.fecha) };
}

function opciones(x: unknown): Item["opciones"] {
  if (!Array.isArray(x)) return [];
  return x.flatMap((o) => (o && typeof o === "object" && typeof o.id === "string" && o.id && typeof o.texto === "string" ? [{ id: o.id, texto: o.texto }] : []));
}

const ID_OTRA = /^([a-z][a-z0-9-]{0,15}):[1-9]\d{0,8}$/;

function item(x: unknown): Item | null {
  const o = x as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return null;
  const deOtra = typeof o.id === "string" ? ID_OTRA.exec(o.id) : null;
  if (!Number.isInteger(o.id) && !deOtra) return null;
  return {
    id: o.id as ItemId,
    ...(deOtra ? { maquina: deOtra[1], maquinaNombre: textoONada(o.maquinaNombre) ?? deOtra[1] } : {}),
    columna: texto(o.columna),
    proyecto: texto(o.proyecto),
    titulo: texto(o.titulo),
    detalle: texto(o.detalle),
    prueba: texto(o.prueba),
    origen: texto(o.origen),
    clave: texto(o.clave),
    head: textoONada(o.head),
    creado: texto(o.creado),
    tocado: texto(o.tocado),
    cerrado: textoONada(o.cerrado),
    hasta: textoONada(o.hasta),
    // Sin `tipo` (un CLI viejo): prueba si trae qué probar, si no pregunta (la misma regla del CLI).
    tipo: o.tipo === "prueba" || (o.tipo !== "pregunta" && texto(o.prueba).trim() !== "") ? "prueba" : "pregunta",
    tituloSimple: texto(o.titulo_simple),
    contexto: texto(o.contexto),
    opciones: opciones(o.opciones),
    porDefecto: textoONada(o.por_defecto),
    respuesta: respuesta(o.respuesta),
  };
}

const items = (x: unknown): Item[] => (Array.isArray(x) ? x.flatMap((i) => item(i) ?? []) : []);

function proyecto(x: unknown): Proyecto | null {
  const o = x as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || typeof o.proyecto !== "string" || !o.proyecto) return null;
  return {
    proyecto: o.proyecto,
    etapa: texto(o.etapa) || "?",
    dias: typeof o.dias === "number" && Number.isFinite(o.dias) ? o.dias : null,
    abiertos: typeof o.abiertos === "number" ? o.abiertos : 0,
    sigue: textoONada(o.sigue),
  };
}

/** Lo que mandó el main, mirado: una `version` que no se conoce o una vista que no es un objeto con columnas es un error. `vista: null` es sin tablero todavía. */
export function validar(crudo: unknown): Tablero {
  const c = crudo as { version?: unknown; vista?: unknown; hecho?: unknown; proyectos?: unknown; pospuestosLista?: unknown; aviso?: unknown; caidas?: unknown } | null;
  if (!c || c.version !== 1) throw new ErrorTablero("version");
  const v = c.vista as { columnas?: Record<string, unknown>; contadores?: Record<string, unknown> } | null;
  if (v !== null && (typeof v !== "object" || !v.columnas || typeof v.columnas !== "object")) throw new ErrorTablero("vista");
  const columnas = Object.fromEntries(ABIERTAS.map((k) => [k, items(v?.columnas?.[k])])) as Record<Abierta, Item[]>;
  const pospuestos = Number(v?.contadores?.pospuestos);
  return {
    columnas,
    hecho: items(c.hecho),
    proyectos: Array.isArray(c.proyectos) ? c.proyectos.flatMap((p) => proyecto(p) ?? []) : [],
    pospuestos: Number.isFinite(pospuestos) ? pospuestos : 0,
    pospuestosLista: items(c.pospuestosLista),
    aviso: typeof c.aviso === "string" && c.aviso ? c.aviso : null,
    caidas: Array.isArray(c.caidas) ? c.caidas.filter((n): n is string => typeof n === "string" && !!n) : [],
    sinVista: v === null,
  };
}

// --- Lo que se ve de cada tarjeta --------------------------------------------------

/**
 * El tono (0–359) del chip de un proyecto: sale del nombre, así que es siempre el mismo. Se
 * reparte con el ángulo áureo para que dos nombres parecidos no caigan en colores vecinos.
 */
export function tono(proyecto: string): number {
  let h = 2166136261;
  for (let i = 0; i < proyecto.length; i++) h = Math.imul(h ^ proyecto.charCodeAt(i), 16777619);
  return Math.round(((h >>> 0) * 137.508) % 360);
}

/** La edad como la dice el CLI: `12m`, `5h`, `9d` desde `creado`. Vacía si la fecha no se entiende. */
export function edad(desde: string, ahora: number): string {
  const t = Date.parse(desde);
  if (!Number.isFinite(t)) return "";
  const min = Math.max(0, Math.floor((ahora - t) / 60_000));
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.floor(min / 60)}h`;
  return `${Math.floor(min / 1440)}d`;
}

// --- Filtro y buscador -------------------------------------------------------------

/** Sin mayúsculas ni tildes: "pildora" encuentra "Píldora". */
export const plano = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export type Filtro = { proyecto: string | null; texto: string };

/** Los de ese proyecto que nombran todas las palabras buscadas (en el título, el detalle, la prueba o el proyecto). */
export function filtrar(lista: Item[], f: Filtro): Item[] {
  const palabras = plano(f.texto).split(/\s+/).filter(Boolean);
  if (!f.proyecto && !palabras.length) return lista;
  return lista.filter((i) => {
    if (f.proyecto && i.proyecto !== f.proyecto) return false;
    if (!palabras.length) return true;
    const donde = plano(`${i.titulo}\n${i.detalle}\n${i.prueba}\n${i.proyecto}\n#${i.id}`);
    return palabras.every((p) => donde.includes(p));
  });
}

// --- Lo optimista ------------------------------------------------------------------

/**
 * Lo que el usuario ya hizo y el CLI todavía no confirmó: a qué columna va cada item, o `null` si se
 * va de la vista (tirado, pospuesto).
 */
export type Pendientes = ReadonlyMap<ItemId, Columna | null>;

/**
 * El tablero como va a quedar: cada tarjeta movida ya está en su columna nueva, arriba de todo. Un pospuesto
 * con una columna en `pend` vuelve a ella (despostergar): sale de la lista de pospuestos y deja de contar.
 */
export function aplicar(t: Tablero, pend: Pendientes): Tablero {
  if (!pend.size) return t;
  const movidos = new Map<Columna, Item[]>();
  const sacar = (lista: Item[], de: Columna) =>
    lista.filter((i) => {
      const a = pend.get(i.id);
      if (a === undefined || a === de) return true;
      if (a !== null) movidos.set(a, [...(movidos.get(a) ?? []), { ...i, columna: a }]);
      return false;
    });
  const columnas = Object.fromEntries(ABIERTAS.map((k) => [k, sacar(t.columnas[k], k)])) as Record<Abierta, Item[]>;
  const hecho = sacar(t.hecho, "hecho");
  const traidos = t.pospuestosLista.filter((i) => pend.get(i.id) != null);
  for (const i of traidos) {
    const a = pend.get(i.id) as Columna;
    movidos.set(a, [...(movidos.get(a) ?? []), { ...i, columna: a, hasta: null }]);
  }
  for (const k of ABIERTAS) if (movidos.has(k)) columnas[k] = [...movidos.get(k)!, ...columnas[k]];
  return {
    ...t,
    columnas,
    hecho: [...(movidos.get("hecho") ?? []), ...hecho],
    pospuestos: Math.max(0, t.pospuestos - traidos.length),
    pospuestosLista: traidos.length ? t.pospuestosLista.filter((i) => pend.get(i.id) == null) : t.pospuestosLista,
  };
}

/** El item con ese id, esté donde esté. */
export function buscar(t: Tablero, id: ItemId): Item | null {
  for (const k of ABIERTAS) {
    const i = t.columnas[k].find((x) => x.id === id);
    if (i) return i;
  }
  return t.hecho.find((x) => x.id === id) ?? null;
}

/** Los nombres para el filtro y el alta: los de `tablero proyectos` (sin los retirados) y los que aparecen en algún item. */
export function nombres(t: Tablero): string[] {
  const s = new Set(t.proyectos.filter((p) => !retirado(p)).map((p) => p.proyecto));
  for (const k of ABIERTAS) for (const i of t.columnas[k]) if (i.proyecto) s.add(i.proyecto);
  return [...s].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

// --- Proyectos ---------------------------------------------------------------------

export type FilaProyecto = Proyecto & {
  /** Lo que espera al usuario en ese proyecto (`espera-dueno`). */
  esperan: Item[];
};

export const retirado = (p: Pick<Proyecto, "etapa">) => p.etapa === "retirado";

/**
 * Los proyectos por días sin tocar: con `parados` primero, los que más llevan quietos; si no, los
 * recién tocados. Los que no tienen repo (áreas) van al final. Los retirados no se mezclan con los
 * activos: van aparte, por abiertos y nombre (sin repo no hay días que ordenar).
 */
export function filasProyectos(t: Tablero, parados: boolean): { activos: FilaProyecto[]; retirados: FilaProyecto[] } {
  const esperan = new Map<string, Item[]>();
  for (const i of t.columnas["espera-dueno"]) esperan.set(i.proyecto, [...(esperan.get(i.proyecto) ?? []), i]);
  const signo = parados ? -1 : 1;
  const filas = t.proyectos.map((p) => ({ ...p, esperan: esperan.get(p.proyecto) ?? [] }));
  const nombre = (a: FilaProyecto, b: FilaProyecto) => a.proyecto.localeCompare(b.proyecto, undefined, { sensitivity: "base" });
  return {
    activos: filas
      .filter((p) => !retirado(p))
      .sort((a, b) => Number(a.dias === null) - Number(b.dias === null) || signo * ((a.dias ?? 0) - (b.dias ?? 0)) || nombre(a, b)),
    retirados: filas.filter(retirado).sort((a, b) => b.abiertos - a.abiertos || nombre(a, b)),
  };
}

// --- Columnas largas ---------------------------------------------------------------
// Bandeja pasa de 200 tarjetas: cada columna pinta sólo las que caen cerca de lo visible y el
// resto es relleno. Las tarjetas miden uno de dos altos fijos (con o sin `prueba`), en rem.

/** El alto del lugar de una tarjeta (con su separación), en rem. */
export const ALTO = { simple: 4.75, prueba: 6.5 } as const;

export const altoDe = (i: Item) => (i.prueba ? ALTO.prueba : ALTO.simple);

/** Dónde empieza cada tarjeta, en rem; el último valor es el alto total. */
export function tramos(lista: Item[]): number[] {
  const t = new Array<number>(lista.length + 1);
  t[0] = 0;
  for (let i = 0; i < lista.length; i++) t[i + 1] = t[i] + altoDe(lista[i]);
  return t;
}

/** El rango se redondea a múltiplos de esto: scrollear no re-renderiza en cada tarjeta. */
const PASO = 4;

/**
 * Qué tarjetas pintar: las que tocan `[arriba - margen, arriba + alto + margen]` (todo en rem),
 * redondeado a `PASO`. `[desde, hasta)`.
 */
export function rango(t: number[], arriba: number, alto: number, margen: number): [number, number] {
  const n = t.length - 1;
  if (n <= 0) return [0, 0];
  const y0 = arriba - margen;
  const y1 = arriba + alto + margen;
  // La primera tarjeta que termina después de y0 (búsqueda binaria).
  let a = 0;
  let b = n;
  while (a < b) {
    const m = (a + b) >> 1;
    if (t[m + 1] <= y0) a = m + 1;
    else b = m;
  }
  let hasta = a;
  while (hasta < n && t[hasta] < y1) hasta++;
  const desde = Math.floor(a / PASO) * PASO;
  return [Math.min(desde, n), Math.min(n, Math.ceil(hasta / PASO) * PASO)];
}
