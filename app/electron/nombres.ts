// Lo que el usuario le cambia a la barra a mano (B20): `~/.local/state/hilos/nombres.json`,
// archivo propio de la app (`pa` no tiene títulos). `titulos`: id de un run o
// session_id de un líder → título que gana sobre la tarea o el nombre;
// `proyectos`: session_id → carpeta (slug) a la que se movió un líder (elegida a mano: nunca se pierde);
// `fijadas`: session_id → carpeta que la barra decidió sola (por sus workers o su primer mensaje) y que, ya decidida,
// no se recalcula (`armarArbol`); mover a mano la pisa;
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
export type Nombres = { titulos: Record<string, string>; proyectos: Record<string, string>; fijadas: Record<string, string>; ocultos: string[]; orden: Orden };
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
  const o = x && typeof x === "object" && !Array.isArray(x) ? (x as { carpetas?: unknown; lideres?: unknown; prioridad?: unknown; modo?: unknown }) : {};
  const lideres: Record<string, string[]> = {};
  if (o.lideres && typeof o.lideres === "object" && !Array.isArray(o.lideres))
    for (const [p, v] of Object.entries(o.lideres).slice(0, ORDEN_MAX)) {
      const ids = lista(v);
      if (ids.length) lideres[p] = ids;
    }
  return { carpetas: lista(o.carpetas), lideres, ...(typeof o.prioridad === "boolean" ? { prioridad: o.prioridad } : {}), ...(o.modo === "az" || o.modo === "recientes" ? { modo: o.modo } : {}) };
}

/** Un título como se guarda: una línea, sin espacios de más, corto. */
export const limpiarTitulo = (t: string) => t.replace(/\s+/g, " ").trim().slice(0, TITULO_MAX);

/** ¿Es un JSON válido de otra `version`? (Distinto de un archivo roto.) */
function versionAjena(crudo: string): boolean {
  try {
    const v = JSON.parse(crudo)?.version;
    return v !== undefined && v !== VERSION;
  } catch {
    return false;
  }
}

const VACIO = (): Nombres => ({ titulos: {}, proyectos: {}, fijadas: {}, ocultos: [], orden: { carpetas: [], lideres: {} } });

/** Lo que hay en el archivo, o `null` si no es un nombres.json de esta versión. */
function deTexto(crudo: string): Nombres | null {
  try {
    const j = JSON.parse(crudo);
    if (j?.version !== VERSION) return null;
    return { titulos: mapa(j.titulos), proyectos: mapa(j.proyectos), fijadas: mapa(j.fijadas), ocultos: Array.isArray(j.ocultos) ? j.ocultos.filter(texto) : [], orden: limpiarOrden(j.orden) };
  } catch {
    return null;
  }
}

export function almacenNombres(archivo: string, escribir: (archivo: string, texto: string) => Promise<void>) {
  let nombres: Nombres | null = null;

  /**
   * Lo guardado. Un archivo que falta es "todavía nada" (se recuerda); uno que no se pudo leer (bloqueado un instante, roto a
   * medias) NO se da por vacío para siempre: se lee el `.bak`, y no se recuerda, así la próxima lectura vuelve a intentar.
   * Si no hay de dónde leer, `fiel` es false: escribir encima borraría lo que el usuario eligió a mano.
   */
  /** Una sola lectura a la vez: dos pedidos juntos al arrancar no arman dos copias y se pisan los cambios del otro. */
  let leyendo: Promise<{ n: Nombres; fiel: boolean }> | null = null;
  function cargar(): Promise<{ n: Nombres; fiel: boolean }> {
    if (nombres) return Promise.resolve({ n: nombres, fiel: true });
    return (leyendo ??= leerDisco().finally(() => (leyendo = null)));
  }

  async function leerDisco(): Promise<{ n: Nombres; fiel: boolean }> {
    let crudo: string | null = null;
    let codigo: string | undefined;
    try {
      crudo = await readFile(archivo, "utf8");
    } catch (e) {
      codigo = (e as NodeJS.ErrnoException)?.code;
    }
    if (crudo !== null) {
      const n = deTexto(crudo);
      if (n) {
        return { n: (nombres = n), fiel: true };
      }
      // De otra versión: vacío, como siempre. Roto: se prueba el respaldo.
      if (versionAjena(crudo)) return { n: (nombres = VACIO()), fiel: true };
    }
    const bak = await readFile(`${archivo}.bak`, "utf8").then(
      deTexto,
      () => null,
    );
    if (crudo === null && codigo !== "ENOENT") return { n: bak ?? VACIO(), fiel: false };
    return { n: (nombres = bak ?? VACIO()), fiel: true };
  }

  async function leer(): Promise<Nombres> {
    return (await cargar()).n;
  }

  /** Para escribir: el estado real, o nada (se rechaza) si no se pudo leer, antes que pisar lo elegido a mano. */
  async function paraEscribir(): Promise<Nombres> {
    let c = await cargar();
    if (!c.fiel) c = await cargar();
    if (!c.fiel) throw new Error("nombres.json no se pudo leer");
    nombres = c.n;
    return c.n;
  }

  const guardar = async (n: Nombres) => {
    const texto = JSON.stringify({ version: VERSION, ...n });
    await escribir(archivo, texto);
    // El respaldo es igual a lo último que se escribió bien: si el archivo se rompe después (cortado a medias, truncado),
    // se vuelve a eso sin perder lo elegido a mano.
    await escribir(`${archivo}.bak`, texto).catch(() => {});
  };

  return {
    leer,
    /** El título de un run o un líder; vacío lo borra (vuelve la tarea o el nombre de siempre). */
    async titulo(id: unknown, titulo: unknown) {
      if (!texto(id) || typeof titulo !== "string") return;
      const n = await paraEscribir();
      const t = limpiarTitulo(titulo);
      if (t) n.titulos[id] = t;
      else delete n.titulos[id];
      await guardar(n);
    },
    /**
     * La carpeta de un líder (Mover a proyecto…); `null` la vuelve a la de sus workers o su primer mensaje (también
     * olvida la que se había fijado sola). Con `fijada`, no es una elección: es la que decidió la barra y ya no se recalcula;
     * nunca pisa lo elegido a mano.
     */
    async proyecto(sid: unknown, slug: unknown, fijada?: unknown) {
      if (!texto(sid) || (slug !== null && !texto(slug))) return;
      const n = await paraEscribir();
      if (fijada === true) {
        if (!slug || n.proyectos[sid] || n.fijadas[sid] === slug) return;
        n.fijadas[sid] = slug;
      } else {
        delete n.fijadas[sid];
        if (slug) n.proyectos[sid] = slug;
        else delete n.proyectos[sid];
      }
      await guardar(n);
    },
    /** Esconder (o volver a mostrar) los workers terminados de una carpeta. */
    async oculto(slug: unknown, si: unknown) {
      if (!texto(slug) || typeof si !== "boolean") return;
      const n = await paraEscribir();
      n.ocultos = n.ocultos.filter((x) => x !== slug);
      if (si) n.ocultos.push(slug);
      await guardar(n);
    },
    /** El orden entero que quedó tras arrastrar (ya sin lo que no existe); devuelve lo guardado. */
    async orden(orden: unknown): Promise<Nombres> {
      const n = await paraEscribir();
      n.orden = limpiarOrden(orden);
      await guardar(n);
      return n;
    },
  };
}
