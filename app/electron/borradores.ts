// Lo que el usuario dejó escrito sin mandar en la caja de cada líder (y del líder nuevo), guardado en disco
// (`$HILOS_STATE/borradores.json`) para que un reinicio, un Ctrl+Q o un apagón no lo pierdan. La
// ventana manda la foto entera con cada cambio (demorada ~500 ms, src/volver.ts); acá se acota y se
// escribe de forma atómica. Los adjuntos van como ruta (el main ya los guardó, electron/archivos.ts):
// no se copia nada, y uno cuyo archivo ya no está se suelta al leer, sin error. Las imágenes pegadas
// no se guardan (son base64 en memoria; guardarlas llenaría el disco de lo que casi nunca se manda).
// Sin `electron`: lo prueba tests/borradores.test.ts.
import { statSync } from "node:fs";

/** Lo más que se guarda de un borrador (texto + lo elegido en sus preguntas), en bytes. Lo que pasa se recorta. */
export const BORRADOR_MAX = 200 * 1024;
/** Cuántos borradores se guardan: al llegar el 51, se va el que hace más que no se toca. */
export const BORRADORES_MAX = 50;

export type ArchivoGuardado = { nombre: string; ruta: string };
export type BorradorGuardado = { texto: string; extra?: Record<string, string>; archivos?: ArchivoGuardado[]; ts: number };
export type Foto = { version: 1; borradores: Record<string, BorradorGuardado> };

const cadena = (x: unknown): x is string => typeof x === "string";

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
  const b = x as { texto?: unknown; extra?: unknown; archivos?: unknown } | null;
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
  if (!texto && !Object.keys(extra).length && !archivos.length) return null;
  return { texto, ...(Object.keys(extra).length ? { extra } : {}), ...(archivos.length ? { archivos } : {}), ts };
}

const igual = (a: BorradorGuardado, b: BorradorGuardado) => a.texto === b.texto && JSON.stringify(a.extra) === JSON.stringify(b.extra) && JSON.stringify(a.archivos) === JSON.stringify(b.archivos);

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
  return { version: 1, borradores: Object.fromEntries(todos.slice(0, BORRADORES_MAX)) };
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
      if (c.texto || c.extra || c.archivos) borradores[clave] = c;
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
