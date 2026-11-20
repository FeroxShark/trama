// Lo que el usuario dejó escrito sin mandar en la caja de cada líder (y del líder nuevo), guardado en disco
// (`$HILOS_STATE/borradores.json`) para que un reinicio, un Ctrl+Q o un apagón no lo pierdan. La
// ventana manda la foto entera con cada cambio (demorada ~500 ms, src/volver.ts); acá se acota y se
// escribe de forma atómica. Los archivos adjuntos van como ruta (el main ya los guardó, electron/archivos.ts):
// no se copia nada, y uno cuyo archivo ya no está se suelta al leer, sin error. Las imágenes pegadas (base64 en
// memoria) van cada una en su archivo, por el hash de su contenido (`<sha256>.<ext>` en `$HILOS_STATE/borradores-img/`),
// y el JSON sólo guarda la referencia (`ImagenRef`): escribir texto no reescribe megas. Tope por borrador (4 imágenes,
// 8 MB de base64: `acotarPorPeso`) y total (`IMAGENES_TOTAL_MAX`, se van las de los borradores más viejos): lo que
// pasa no se guarda. Un archivo que ningún borrador referencia se borra (al mandar, al sacar con ×, al recortar).
// Sin `electron`: lo prueba tests/borradores.test.ts.
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { acotarPorPeso, BASE64_MAX, type Imagen, TIPOS_IMAGEN } from "./imagenes.ts";

/** Lo más que se guarda de un borrador (texto + lo elegido en sus preguntas), en bytes. Lo que pasa se recorta. */
export const BORRADOR_MAX = 200 * 1024;
/** Cuántos borradores se guardan: al llegar el 51, se va el que hace más que no se toca. */
export const BORRADORES_MAX = 50;

/** Lo más que ocupan, en total y contado en caracteres de base64, las imágenes guardadas de todos los borradores. */
export const IMAGENES_TOTAL_MAX = 24 * 1024 * 1024;

/** Cuánto se protege una imagen recién guardada (la ventana la sube antes de que una foto la referencie) de la limpieza. */
export const GRACIA_IMAGEN_MS = 60_000;

/** Una imagen pegada ya guardada en su archivo: el JSON sólo lleva esto. `largo`: caracteres de su base64 (para los topes). */
export type ImagenRef = { tipo: string; hash: string; largo: number };
export type ArchivoGuardado = { nombre: string; ruta: string };
export type BorradorGuardado = { texto: string; extra?: Record<string, string>; archivos?: ArchivoGuardado[]; imagenes?: ImagenRef[]; ts: number };
export type Foto = { version: 1; borradores: Record<string, BorradorGuardado> };

const cadena = (x: unknown): x is string => typeof x === "string";
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const HASH = /^[0-9a-f]{64}$/;
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const NOMBRE_IMAGEN = /^[0-9a-f]{64}\.(png|jpg|webp|gif)$/;
/** El archivo de una imagen: su hash y su extensión (sin carpetas: no hay forma de salirse de la carpeta de imágenes). */
const nombreImagen = (hash: string, tipo: string) => `${hash}.${EXT[tipo]}`;
const refValida = (i: unknown): i is ImagenRef => {
  const o = i as Partial<ImagenRef> | null;
  return !!o && cadena(o.tipo) && o.tipo in EXT && cadena(o.hash) && HASH.test(o.hash) && Number.isInteger(o.largo) && o.largo! > 0 && o.largo! <= BASE64_MAX;
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
  const imagenes = acotarPorPeso((Array.isArray(b.imagenes) ? b.imagenes : []).filter(refValida).map((i) => ({ tipo: i.tipo, hash: i.hash, largo: i.largo })), (i) => i.largo).entran;
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
    const peso = (b.imagenes ?? []).reduce((n, i) => n + i.largo, 0);
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

/** Donde viven los archivos de las imágenes (una carpeta). */
export type DiscoImagenes = {
  escribir(nombre: string, bytes: Buffer): Promise<void>;
  leer(nombre: string): Promise<Buffer | null>;
  listar(): Promise<string[]>;
  borrar(nombre: string): Promise<void>;
};

/** Una carpeta de verdad (la crea al escribir; la escritura es atómica: archivo temporal y rename). */
export function discoImagenesFs(dir: string): DiscoImagenes {
  return {
    async escribir(nombre, bytes) {
      await mkdir(dir, { recursive: true });
      const tmp = path.join(dir, `${nombre}.${process.pid}.tmp`);
      await writeFile(tmp, bytes);
      await rename(tmp, path.join(dir, nombre));
    },
    leer: (nombre) => readFile(path.join(dir, nombre)).catch(() => null),
    listar: () => readdir(dir).catch(() => []),
    borrar: (nombre) => rm(path.join(dir, nombre), { force: true }),
  };
}

export type ImagenLeida = Imagen & { hash: string };
export type BorradorLeido = Omit<BorradorGuardado, "imagenes"> & { imagenes?: ImagenLeida[] };
/** Lo que se lee al abrir: los borradores con sus imágenes ya leídas de sus archivos (las que faltan, descartadas). */
export type FotoLeida = { version: 1; borradores: Record<string, BorradorLeido> };

/** El archivo de borradores: `leer` una vez al abrir la ventana, `guardar` con cada foto nueva. */
export function almacenBorradores(
  leerArchivo: () => Promise<string | null>,
  escribir: (json: string) => Promise<void>,
  opciones: { ahora?: () => number; existe?: (ruta: string) => boolean; imagenes?: DiscoImagenes } = {},
) {
  const ahora = opciones.ahora ?? Date.now;
  const disco = opciones.imagenes;
  let actual: Record<string, BorradorGuardado> | null = null;
  const cargar = async () => (actual ??= leerFoto(await leerArchivo().catch(() => null), opciones.existe).borradores);
  /** Archivos recién subidos por la ventana y todavía sin referencia en ninguna foto: hasta entonces (o `GRACIA_IMAGEN_MS`) no se limpian. */
  const pendientes = new Map<string, number>();
  // Una cosa a la vez: una limpieza con una foto vieja no puede borrar lo que una foto nueva ya referencia.
  let fila: Promise<unknown> = Promise.resolve();
  const enFila = <T>(f: () => Promise<T>): Promise<T> => {
    const r = fila.then(f, f);
    fila = r.catch(() => {});
    return r;
  };

  const nombresUsados = (bs: Record<string, BorradorGuardado>) => new Set(Object.values(bs).flatMap((b) => (b.imagenes ?? []).map((i) => nombreImagen(i.hash, i.tipo))));

  /** Borra los archivos que ningún borrador referencia (salvo los recién subidos). */
  async function limpiar(bs: Record<string, BorradorGuardado>) {
    if (!disco) return;
    const usados = nombresUsados(bs);
    const t = ahora();
    for (const n of usados) pendientes.delete(n);
    for (const [n, desde] of pendientes) if (t - desde >= GRACIA_IMAGEN_MS) pendientes.delete(n);
    for (const n of await disco.listar().catch(() => [] as string[]))
      if (NOMBRE_IMAGEN.test(n) && !usados.has(n) && !pendientes.has(n)) await disco.borrar(n).catch(() => {});
  }

  return {
    async leer(): Promise<FotoLeida> {
      return enFila(async () => {
        const bs = await cargar();
        const borradores: Record<string, BorradorLeido> = {};
        const sanos: Record<string, BorradorGuardado> = {};
        for (const [clave, b] of Object.entries(bs)) {
          const imagenes: ImagenLeida[] = [];
          const refs: ImagenRef[] = [];
          for (const r of b.imagenes ?? []) {
            const bytes = disco ? await disco.leer(nombreImagen(r.hash, r.tipo)) : null;
            if (!bytes?.length) continue; // el archivo falta: la referencia se descarta, sin error
            const datos = bytes.toString("base64");
            imagenes.push({ tipo: r.tipo, hash: r.hash, datos });
            refs.push({ tipo: r.tipo, hash: r.hash, largo: datos.length });
          }
          const { imagenes: _, ...resto } = b;
          if (!resto.texto && !resto.extra && !resto.archivos && !refs.length) continue;
          sanos[clave] = refs.length ? { ...resto, imagenes: refs } : resto;
          borradores[clave] = imagenes.length ? { ...resto, imagenes } : { ...resto };
        }
        actual = sanos;
        await limpiar(sanos); // restos de un cierre a medias, o de un borrador que ya no está
        return { version: 1, borradores };
      });
    },
    /** Guarda la foto entera que manda la ventana (la ventana no manda hasta tener lo de la vez anterior, src/volver.ts). */
    guardar(entrada: unknown): Promise<void> {
      return enFila(async () => {
        const antes = await cargar();
        const foto = armar(entrada, antes, ahora());
        actual = foto.borradores;
        await escribir(JSON.stringify(foto));
        await limpiar(foto.borradores);
      });
    },
    /**
     * Guarda una imagen pegada en su archivo (`<sha256>.<ext>`) y devuelve el hash: la ventana lo manda una sola vez por
     * imagen y después las fotos llevan sólo la referencia. Si el archivo ya está, lo deja como está.
     */
    async guardarImagen(tipo: unknown, datos: unknown): Promise<string> {
      if (!disco) throw new Error("sin carpeta de imágenes");
      if (!cadena(tipo) || !(tipo in EXT) || !(TIPOS_IMAGEN as readonly string[]).includes(tipo)) throw new Error("tipo de imagen no soportado");
      if (!cadena(datos) || !datos || datos.length > BASE64_MAX || datos.length % 4 !== 0 || !BASE64.test(datos)) throw new Error("imagen mal formada");
      const bytes = Buffer.from(datos, "base64");
      const hash = createHash("sha256").update(bytes).digest("hex");
      const nombre = nombreImagen(hash, tipo);
      pendientes.set(nombre, ahora()); // antes de escribir: que una limpieza en curso no se la lleve
      const hay = await disco.leer(nombre);
      if (!hay || hay.length !== bytes.length) await disco.escribir(nombre, bytes);
      return hash;
    },
  };
}

