// Las guías de pantalla: qué guías hay (id, versión, pasos con su ancla en la pantalla) y la lógica pura de cuáles pasos mostrar según lo
// ya visto y el interruptor global. La vista (globo, foco, posición) está en Guia.tsx; el estado guardado en estado.ts y, en disco,
// preferencias.json (electron/guias-estado.ts).
//
// Cada guía lleva una VERSIÓN. Un paso lleva `desde`: la versión en que se agregó (1 si no dice). Quien ya vio la guía en la versión v
// sólo ve los pasos con `desde > v`, marcados como "Nuevo"; quien nunca la vio, todos. Subir la versión de una guía y poner `desde` en
// el paso nuevo es todo lo que hace falta para anunciar una novedad.
// Sin React ni DOM: lo prueba tests/guia.test.ts.
import type { ClaveSola } from "../i18n";
import type { CatId } from "../paneles/ajustes-nav";
import { aplicarOpGuias, type EstadoGuias, type OpGuias } from "../../electron/guias-estado";

export type { EstadoGuias, OpGuias };
export type Lado = "arriba" | "abajo" | "izquierda" | "derecha";
export type CualPanel = "ajustes" | "ramas" | "estadisticas" | "tablero";

export type Paso = {
  id: string;
  /** Selector CSS del elemento al que apunta (casi siempre `[data-guia="…"]`, o una clase/`data-opc` que ya existe). */
  ancla: string;
  /** Si el selector coincide con varios, cuál (0 = el primero que se ve). */
  indice?: number;
  /** El globo se coloca junto a este otro elemento (un menú entero) en vez de junto al ancla, para no taparlo; el aro sigue en el ancla. */
  junto?: string;
  titulo: ClaveSola;
  cuerpo: ClaveSola;
  /** De qué lado del ancla prefiere el globo; si no entra, el contrario. */
  lado?: Lado;
  /** La versión de la guía en que apareció este paso (1 si no dice). */
  desde?: number;
};

export type Guia = {
  id: string;
  version: number;
  nombre: ClaveSola;
  /** Selector que tiene que verse en pantalla para que la guía tenga sentido (el chat de un líder, un worker en la barra). */
  requiere?: string;
  pasos: readonly Paso[];
};

const dg = (id: string) => `[data-guia="${id}"]`;
const op = (c: CatId, nombre: string) => `[data-cat="${c}"] [data-opc="${nombre}"]`;

/** Un paso con las claves de texto por convención: `tour.<guía>.<paso>.t` y `.b`. */
function paso(guia: string, id: string, ancla: string, o: Partial<Pick<Paso, "indice" | "junto" | "lado" | "desde">> = {}): Paso {
  return { id, ancla, titulo: `tour.${guia}.${id}.t` as ClaveSola, cuerpo: `tour.${guia}.${id}.b` as ClaveSola, ...o };
}
function guia(id: string, version: number, pasos: Paso[], requiere?: string): Guia {
  return { id, version, nombre: `tour.g.${id}` as ClaveSola, pasos, ...(requiere ? { requiere } : {}) };
}

export const GUIAS: readonly Guia[] = [
  // La pantalla de siempre: la barra de la izquierda.
  guia("principal", 1, [
    paso("principal", "uso", dg("uso"), { lado: "derecha" }),
    paso("principal", "activas", dg("activas"), { lado: "derecha" }),
    paso("principal", "proyectos", ".lista .proy:not(.activas)", { lado: "derecha" }),
    paso("principal", "nueva", dg("nueva"), { lado: "abajo" }),
    paso("principal", "pie", dg("pie"), { lado: "arriba" }),
  ]),
  // El primer chat con un líder.
  guia(
    "lider",
    1,
    [
      paso("lider", "cabecera", ".hilo .migas", { lado: "abajo" }),
      paso("lider", "charla", ".hilo .conv-zona", { lado: "izquierda" }),
      paso("lider", "contexto", ".caja .ctx", { lado: "arriba" }),
    ],
    ".hilo .caja .ctx",
  ),
  // La caja donde se escribe (líder nuevo o abierto).
  guia(
    "caja",
    1,
    [
      paso("caja", "texto", ".caja textarea", { lado: "arriba" }),
      paso("caja", "modo", ".caja .modo", { lado: "arriba" }),
      paso("caja", "modelo", ".caja .pick", { indice: 0, lado: "arriba" }),
      paso("caja", "esfuerzo", ".caja .pick", { indice: 1, lado: "arriba" }),
      paso("caja", "mic", ".caja .dic", { lado: "arriba" }),
      paso("caja", "enviar", ".caja .prim", { lado: "arriba" }),
    ],
    ".caja",
  ),
  // El primer worker colgando de un líder en la barra.
  guia("worker", 1, [paso("worker", "fila", ".lista .w .fila", { lado: "derecha" }), paso("worker", "estado", ".lista .w .l2", { lado: "derecha" }), paso("worker", "pie", ".pie-worker", { lado: "arriba" })], ".lista .w .fila"),
  // El selector de modelo abierto.
  guia("modelo", 1, [
    paso("modelo", "riel", ".menu .mc-riel", { junto: ".menu", lado: "derecha" }),
    paso("modelo", "busca", ".menu .mc-busca", { junto: ".menu", lado: "derecha" }),
    paso("modelo", "lista", ".menu .mc-lista", { junto: ".menu", lado: "derecha" }),
  ], ".menu[data-columnas]"),
  // Ajustes: el marco, y una guía por categoría.
  guia("ajustes", 1, [paso("ajustes", "busca", ".aj-busca", { lado: "abajo" }), paso("ajustes", "nav", ".aj-nav", { lado: "derecha" })]),
  guia("ajustes-general", 1, [
    paso("ajustes-general", "idioma", op("general", "ajustes.idioma"), { lado: "abajo" }),
    paso("ajustes-general", "tema", op("general", "ajustes.tema"), { lado: "abajo" }),
    paso("ajustes-general", "compactar", op("general", "ajustes.compactar"), { lado: "abajo" }),
    paso("ajustes-general", "ramas", op("general", "ajustes.aplicarAuto"), { lado: "abajo" }),
    paso("ajustes-general", "bienvenida", op("general", "ajustes.bienvenida"), { lado: "abajo" }),
  ]),
  guia("ajustes-modelos", 1, [
    paso("ajustes-modelos", "lider", op("modelos", "ajustes.mdlLider"), { lado: "abajo" }),
    paso("ajustes-modelos", "auto", op("modelos", "ajustes.mdlAutomatico"), { lado: "abajo" }),
    paso("ajustes-modelos", "workers", op("modelos", "ajustes.mdlWk"), { lado: "abajo" }),
    paso("ajustes-modelos", "dictado", op("modelos", "ajustes.dictado"), { lado: "abajo" }),
  ]),
  guia("ajustes-cupos", 1, [
    paso("ajustes-cupos", "plan", op("cupos", "ajustes.planSus"), { lado: "abajo" }),
    paso("ajustes-cupos", "ventanas", op("cupos", "cu.claude"), { lado: "abajo" }),
    paso("ajustes-cupos", "ritmo", `[data-cat="cupos"] .cu-ritmo`, { lado: "abajo" }),
    paso("ajustes-cupos", "perfil", op("cupos", "ajustes.cuposPerfil"), { lado: "abajo" }),
    paso("ajustes-cupos", "reserva", op("cupos", "cu.topes"), { lado: "abajo" }),
  ]),
  guia("ajustes-proyectos", 1, [
    paso("ajustes-proyectos", "nombres", op("proyectos", "pry.nombres"), { lado: "abajo" }),
    paso("ajustes-proyectos", "agents", op("proyectos", "pry.instrucciones"), { lado: "abajo" }),
  ]),
  guia("ajustes-guia", 1, [
    paso("ajustes-guia", "guias", op("guia", "tour.mostrar"), { lado: "abajo" }),
    paso("ajustes-guia", "temas", `[data-cat="guia"] .gu-tema`, { lado: "abajo" }),
    paso("ajustes-guia", "agents", op("guia", "guia.agents"), { lado: "abajo" }),
  ]),
  // Los paneles del pie.
  guia("ramas", 1, [paso("ramas", "rama", ".pn-ramas .pn-rama", { lado: "abajo" }), paso("ramas", "auto", ".pn-ramas-cab .pn-llave", { lado: "abajo" })]),
  // Lo de Ramas que sólo existe después de que el analista contestó: su propia guía, para que no se dé por vista antes de poder verse.
  guia(
    "ramas-analisis",
    1,
    [
      paso("ramas-analisis", "filtros", ".pn-filtros", { lado: "abajo" }),
      paso("ramas-analisis", "veredicto", ".pn-ramas .pn-veredicto", { lado: "abajo" }),
      paso("ramas-analisis", "aplicar", ".pn-analista [data-aplicar]", { lado: "abajo" }),
    ],
    ".pn-ramas .pn-veredicto",
  ),
  guia("estadisticas", 1, [
    paso("estadisticas", "periodo", ".pn-cab", { lado: "abajo" }),
    paso("estadisticas", "cifras", ".pn-cifras", { lado: "abajo" }),
    paso("estadisticas", "dias", ".pn-barras", { lado: "arriba" }),
    paso("estadisticas", "tendencia", ".pn-tabla", { lado: "arriba" }),
  ]),
  guia("tablero", 1, [
    paso("tablero", "vistas", ".tb-vistas", { lado: "abajo" }),
    paso("tablero", "esperan", ".pd-lista", { lado: "abajo" }),
    paso("tablero", "fila", ".pd-lista .pd-fila", { lado: "abajo" }),
    paso("tablero", "lecciones", ".lc-aviso", { lado: "abajo" }),
  ]),
];

export const guiaPorId = (id: string): Guia | undefined => GUIAS.find((x) => x.id === id);

/** Dónde está el usuario, en lo que importa para elegir guía. */
export type Contexto = { panel: CualPanel | null; categoria: CatId | null; menuModelo: boolean };

/**
 * Las guías que pueden mostrarse ahora, en orden de prioridad: la del selector abierto manda; en un panel, la del panel (y la de Ajustes
 * con la de su categoría); sin panel, la barra y después el chat y su caja.
 */
export function candidatas(c: Contexto): string[] {
  if (c.menuModelo) return ["modelo"];
  if (c.panel === "ajustes") return ["ajustes", ...(c.categoria && guiaPorId(`ajustes-${c.categoria}`) ? [`ajustes-${c.categoria}`] : [])];
  if (c.panel === "ramas") return ["ramas", "ramas-analisis"];
  if (c.panel) return [c.panel];
  return ["principal", "lider", "caja", "worker"];
}

export type Pendientes = {
  guia: Guia;
  /** Los pasos que se muestran, en orden. */
  pasos: Paso[];
  /** Ya vio la guía antes: los pasos son sólo las novedades ("Nuevo"). */
  novedad: boolean;
};

/**
 * Qué pasos de una guía mostrar. Nada si las guías están apagadas, si ya vio esta versión o si ninguno de sus pasos está en pantalla
 * (`presente`: el ancla se ve ahora). Con la guía vista en una versión vieja, sólo los pasos posteriores a ella.
 */
export function pendientes(g: Guia, e: EstadoGuias, presente: (p: Paso) => boolean): Pendientes | null {
  if (e.off) return null;
  const visto = e.vistas[g.id] ?? 0;
  if (visto >= g.version) return null;
  const pasos = g.pasos.filter((p) => (p.desde ?? 1) > visto && presente(p));
  return pasos.length ? { guia: g, pasos, novedad: visto > 0 } : null;
}

/** Marcar la guía como vista en su versión actual. */
export const marcarVista = (e: EstadoGuias, g: Guia): EstadoGuias => aplicarOpGuias(e, { vista: { id: g.id, version: g.version } } satisfies OpGuias);

/**
 * Para la captura de "lo nuevo": la guía como si hubiera subido una versión con sus dos últimos pasos nuevos, y el estado como si el
 * usuario ya hubiera visto la anterior.
 */
export function simularNovedad(g: Guia): { guia: Guia; estado: EstadoGuias } {
  const version = g.version + 1;
  const desdeN = Math.max(0, g.pasos.length - 2);
  return {
    guia: { ...g, version, pasos: g.pasos.map((p, i) => (i >= desdeN ? { ...p, desde: version } : p)) },
    estado: { off: false, vistas: { [g.id]: g.version } },
  };
}

/** La captura `guia-<id>` → la guía; `null` si no es de acá. */
export function guiaDeCaptura(c: string | null | undefined): Guia | null {
  if (!c || !c.startsWith("guia-")) return null;
  return guiaPorId(c.slice(5)) ?? null;
}

/** El panel que una captura de guía necesita abierto (Ajustes con su categoría, Ramas…), o `null`. */
export function panelDeCaptura(id: string): { panel: CualPanel; categoria: CatId | null } | null {
  if (id === "ajustes") return { panel: "ajustes", categoria: null };
  if (id.startsWith("ajustes-")) return { panel: "ajustes", categoria: id.slice(8) as CatId };
  if (id === "ramas-analisis") return { panel: "ramas", categoria: null };
  if (id === "ramas" || id === "estadisticas" || id === "tablero") return { panel: id, categoria: null };
  return null;
}
