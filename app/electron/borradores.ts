// Lo que el usuario dejó escrito sin mandar en la caja de cada líder (y del líder nuevo), guardado en disco
// (`$HILOS_STATE/borradores.json`) para que un reinicio, un Ctrl+Q o un apagón no lo pierdan. La
// ventana manda la foto entera con cada cambio (demorada ~500 ms, src/volver.ts); acá se acota y se
// escribe de forma atómica. Los archivos adjuntos van como ruta (el main ya los guardó, electron/archivos.ts):
// no se copia nada, y uno cuyo archivo ya no está se suelta al leer, sin error. Las imágenes pegadas (base64 en
// memoria) van en el mismo archivo, con tope por borrador (4 imágenes, 8 MB de base64: `acotarImagenes`) y un
// tope total (`IMAGENES_TOTAL_MAX`, se van las de los borradores más viejos): lo que pasa no se guarda.
// Sin `electron`: lo prueba tests/borradores.test.ts.
import { statSync } from "node:fs";
import { acotarImagenes, type Imagen, TIPOS_IMAGEN } from "./imagenes.ts";

/** Lo más que se guarda de un borrador (texto + lo elegido en sus preguntas), en bytes. Lo que pasa se recorta. */
export const BORRADOR_MAX = 200 * 1024;
/** Cuántos borradores se guardan: al llegar el 51, se va el que hace más que no se toca. */
export const BORRADORES_MAX = 50;

/** Lo más que ocupan, en total y contado en caracteres de base64, las imágenes guardadas de todos los borradores. */
export const IMAGENES_TOTAL_MAX = 24 * 1024 * 1024;

export type ArchivoGuardado = { nombre: string; ruta: string };
export type BorradorGuardado = { texto: string; extra?: Record<string, string>; archivos?: ArchivoGuardado[]; imagenes?: Imagen[]; ts: number };
export type Foto = { version: 1; borradores: Record<string, BorradorGuardado> };

const cadena = (x: unknown): x is string => typeof x === "string";
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const imagenValida = (i: unknown): i is Imagen => {
  const o = i as Partial<Imagen> | null;
  return !!o && cadena(o.tipo) && (TIPOS_IMAGEN as readonly string[]).includes(o.tipo) && cadena(o.datos) && o.datos.length % 4 === 0 && BASE64.test(o.datos);
};

/** `s` recortada a `bytes` bytes de UTF-8 sin partir un carácter. */
export function recortar(s: string, bytes: number): string {
  if (Buffer.byteLength(s) <= bytes) return s;
  let lo = 0;
  let hi = Math.min(s.length, bytes);
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (Buffer.byteLength(s.slice(0, m)) <= bytes) lo = m;
    else hi = m - 1;
  }
  // No deja media pareja suplente colgando.
  if (lo > 0 && /[\ud800-\udbff]/.test(s[lo - 1])) lo--;
  return s.slice(0, lo);
}

/** Un borrador que llegó de la ventana, acotado; `null` si no trae nada (ni texto, ni lo elegido, ni adjuntos). */
function limpio(x: unknown, ts: number): BorradorGuardado | null {
  const b = x as { texto?: unknown; extra?: unknown; archivos?: unknown; imagenes?: unknown } | null;
  if (!b || typeof b !== "object") return null;
  let resta = BORRADOR_MAX;
  const texto = cadena(b.texto) ? recortar(b.texto, resta) : "";
  resta -= Buffer.byteLength(texto);
  const extra: Record<string, string> = {};
  if (b.extra && typeof b.extra === "object" && !Array.isArray(b.extra))
    for (const [k, v] of Object.entries(b.extra)) {
      if (!cadena(v) || !v) continue;
      const c = Buffer.byteLength(k) + Buffer.byteLength(v);
      if (c > resta) continue;
      extra[k] = v;
      resta -= c;
    }
  const archivos = (Array.isArray(b.archivos) ? b.archivos : [])
    .filter((a): a is ArchivoGuardado => !!a && cadena(a.nombre) && cadena(a.ruta) && !!a.ruta)
    .slice(0, 20)
    .map((a) => ({ nombre: a.nombre.slice(0, 255), ruta: a.ruta }));
  const imagenes = acotarImagenes((Array.isArray(b.imagenes) ? b.imagenes : []).filter(imagenValida).map((i) => ({ tipo: i.tipo, datos: i.datos }))).entran;
  if (!texto && !Object.keys(extra).length && !archivos.length && !imagenes.length) return null;
  return { texto, ...(Object.keys(extra).length ? { extra } : {}), ...(archivos.length ? { archivos } : {}), ...(imagenes.length ? { imagenes } : {}), ts };
}

const igual = (a: BorradorGuardado, b: BorradorGuardado) => a.texto === b.texto && JSON.stringify(a.extra) === JSON.stringify(b.extra) && JSON.stringify(a.archivos) === JSON.stringify(b.archivos) && JSON.stringify(a.imagenes) === JSON.stringify(b.imagenes);

/**
 * Arma lo que se guarda: lo que viene de la ventana, acotado. Cada borrador lleva cuándo cambió por
 * última vez (el mismo `ts` si sigue igual a como estaba), y de pasarse de `BORRADORES_MAX` se van los más viejos.
 */
export function armar(entrada: unknown, antes: Readonly<Record<string, BorradorGuardado>>, ahora: number): Foto {
  const crudo = entrada && typeof entrada === "object" && !Array.isArray(entrada) ? (entrada as Record<string, unknown>) : {};
  const todos: [string, BorradorGuardado][] = [];
  for (const [clave, x] of Object.entries(crudo)) {
    if (!clave || clave.length > 200) continue;
    const b = limpio(x, ahora);
    if (!b) continue;
    const previo = antes[clave];
    todos.push([clave, previo && igual(previo, b) ? previo : b]);
  }
  todos.sort((a, b) => b[1].ts - a[1].ts);
  return { version: 1, borradores: Object.fromEntries(soltarImagenesDeMas(todos.slice(0, BORRADORES_MAX))) };
}

/** Pasado `IMAGENES_TOTAL_MAX`, los borradores más viejos (la lista viene del más nuevo al más viejo) pierden sus imágenes; si les queda otra cosa se guardan sin ellas. */
function soltarImagenesDeMas(l: [string, BorradorGuardado][]): [string, BorradorGuardado][] {
  let resta = IMAGENES_TOTAL_MAX;
  const r: [string, BorradorGuardado][] = [];
  for (const [clave, b] of l) {
    const peso = (b.imagenes ?? []).reduce((n, i) => n + i.datos.length, 0);
    if (peso <= resta) {
      resta -= peso;
      r.push([clave, b]);
      continue;
    }
    const { imagenes: _, ...resto } = b;
    if (resto.texto || resto.extra || resto.archivos) r.push([clave, resto]);
  }
  return r;
}

/** Lo que dice un archivo guardado, sin los adjuntos que ya no existen. Roto, de otra versión o ausente: nada. */
export function leerFoto(json: string | null, existe: (ruta: string) => boolean = hayArchivo): Foto {
  const vacia: Foto = { version: 1, borradores: {} };
  try {
    const j = JSON.parse(json ?? "") as Partial<Foto> | null;
    if (j?.version !== 1 || !j.borradores || typeof j.borradores !== "object") return vacia;
    const borradores: Record<string, BorradorGuardado> = {};
    for (const [clave, x] of Object.entries(j.borradores)) {
      const ts = Number((x as { ts?: unknown } | null)?.ts);
      const b = limpio(x, Number.isFinite(ts) ? ts : 0);
      if (!b) continue;
      const archivos = (b.archivos ?? []).filter((a) => existe(a.ruta));
      const { archivos: _, ...resto } = b;
      const c: BorradorGuardado = archivos.length ? { ...resto, archivos } : resto;
      if (c.texto || c.extra || c.archivos || c.imagenes) borradores[clave] = c;
    }
    return { version: 1, borradores };
  } catch {
    return vacia;
  }
}

function hayArchivo(ruta: string): boolean {
  try {
    return statSync(ruta).isFile();
  } catch {
    return false;
  }
}

/** El archivo de borradores: `leer` una vez al abrir la ventana, `guardar` con cada foto nueva. */
export function almacenBorradores(
  leerArchivo: () => Promise<string | null>,
  escribir: (json: string) => Promise<void>,
  opciones: { ahora?: () => number; existe?: (ruta: string) => boolean } = {},
) {
  const ahora = opciones.ahora ?? Date.now;
  let actual: Record<string, BorradorGuardado> | null = null;
  const cargar = async () => (actual ??= leerFoto(await leerArchivo().catch(() => null), opciones.existe).borradores);
  return {
    async leer(): Promise<Foto> {
      return { version: 1, borradores: { ...(await cargar()) } };
    },
    /** Guarda la foto entera que manda la ventana (la ventana no manda hasta tener lo de la vez anterior, src/volver.ts). */
    async guardar(entrada: unknown): Promise<void> {
      const antes = await cargar();
      const foto = armar(entrada, antes, ahora());
      actual = foto.borradores;
      await escribir(JSON.stringify(foto));
    },
  };
}
