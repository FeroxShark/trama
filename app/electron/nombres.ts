// Lo que el usuario le cambia a la barra a mano (B20): `~/.local/state/hilos/nombres.json`,
// archivo propio de la app (`pa` no tiene títulos). `titulos`: id de un run o
// session_id de un líder → título que gana sobre la tarea o el nombre;
// `proyectos`: session_id → carpeta (slug) a la que se movió un líder;
// `ocultos`: carpetas con los workers terminados escondidos; `orden`: el orden
// que puso arrastrando (carpetas, y líderes por carpeta). Sin imports
// locales (el archivo y la escritura atómica vienen de nucleo.ts): lo prueba
// `tests/nombres.test.ts`.
import { readFile } from "node:fs/promises";

const VERSION = 1;
/** Un título más largo que esto se corta: es una fila de la barra, no un párrafo. */
export const TITULO_MAX = 200;

/** Lo que el usuario reordenó arrastrando: lo listado va primero y en ese orden (`src/barra/orden.ts`). */
export type Orden = { carpetas: string[]; lideres: Record<string, string[]> };
export type Nombres = { titulos: Record<string, string>; proyectos: Record<string, string>; ocultos: string[]; orden: Orden };
/** Tope de una lista del orden: lo que mande de más un cliente roto no llena el archivo. */
export const ORDEN_MAX = 2000;

const texto = (x: unknown): x is string => typeof x === "string" && x !== "";
const mapa = (x: unknown): Record<string, string> =>
  x && typeof x === "object" && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x).filter((e): e is [string, string] => texto(e[1])))
    : {};

const lista = (x: unknown): string[] => (Array.isArray(x) ? [...new Set(x.filter(texto))].slice(0, ORDEN_MAX) : []);

/** El orden como se guarda: listas de textos sin repetir; una carpeta sin líderes listados no queda. */
export function limpiarOrden(x: unknown): Orden {
  const o = x && typeof x === "object" && !Array.isArray(x) ? (x as { carpetas?: unknown; lideres?: unknown; prioridad?: unknown }) : {};
  const lideres: Record<string, string[]> = {};
  if (o.lideres && typeof o.lideres === "object" && !Array.isArray(o.lideres))
    for (const [p, v] of Object.entries(o.lideres).slice(0, ORDEN_MAX)) {
      const ids = lista(v);
      if (ids.length) lideres[p] = ids;
    }
  return { carpetas: lista(o.carpetas), lideres, ...(typeof o.prioridad === "boolean" ? { prioridad: o.prioridad } : {}) };
}

/** Un título como se guarda: una línea, sin espacios de más, corto. */
export const limpiarTitulo = (t: string) => t.replace(/\s+/g, " ").trim().slice(0, TITULO_MAX);

export function almacenNombres(archivo: string, escribir: (archivo: string, texto: string) => Promise<void>) {
  let nombres: Nombres | null = null;

  async function leer(): Promise<Nombres> {
    if (nombres) return nombres;
    try {
      const j = JSON.parse(await readFile(archivo, "utf8"));
      if (j.version !== VERSION) throw new Error("versión");
      nombres = {
        titulos: mapa(j.titulos),
        proyectos: mapa(j.proyectos),
        ocultos: Array.isArray(j.ocultos) ? j.ocultos.filter(texto) : [],
        orden: limpiarOrden(j.orden),
      };
    } catch {
      nombres = { titulos: {}, proyectos: {}, ocultos: [], orden: { carpetas: [], lideres: {} } };
    }
    return nombres;
  }

  const guardar = (n: Nombres) => escribir(archivo, JSON.stringify({ version: VERSION, ...n }));

  return {
    leer,
    /** El título de un run o un líder; vacío lo borra (vuelve la tarea o el nombre de siempre). */
    async titulo(id: unknown, titulo: unknown) {
      if (!texto(id) || typeof titulo !== "string") return;
      const n = await leer();
      const t = limpiarTitulo(titulo);
      if (t) n.titulos[id] = t;
      else delete n.titulos[id];
      await guardar(n);
    },
    /** La carpeta de un líder (Mover a proyecto…); `null` la vuelve a la de sus workers o su primer mensaje. */
    async proyecto(sid: unknown, slug: unknown) {
      if (!texto(sid) || (slug !== null && !texto(slug))) return;
      const n = await leer();
      if (slug) n.proyectos[sid] = slug;
      else delete n.proyectos[sid];
      await guardar(n);
    },
    /** Esconder (o volver a mostrar) los workers terminados de una carpeta. */
    async oculto(slug: unknown, si: unknown) {
      if (!texto(slug) || typeof si !== "boolean") return;
      const n = await leer();
      n.ocultos = n.ocultos.filter((x) => x !== slug);
      if (si) n.ocultos.push(slug);
      await guardar(n);
    },
    /** El orden entero que quedó tras arrastrar (ya sin lo que no existe); devuelve lo guardado. */
    async orden(orden: unknown): Promise<Nombres> {
      const n = await leer();
      n.orden = limpiarOrden(orden);
      await guardar(n);
      return n;
    },
  };
}
