// El logo de cada proyecto para la barra y para Ajustes > Proyectos. Sale, en orden:
// el que se eligió a mano (campo `logo` del registry: una imagen ya achicada, no una ruta), el campo `icono` (o `icon`)
// del registry, un ícono que ya esté en el repo (lugares fijos, nada de recorrer carpetas ni de entrar a node_modules,
// .git o dist) y, al final, el que declara el `package.json` o electron-builder. Lo que no tiene ninguno lleva un
// monograma, que arma el frontend (src/barra/logo-logica.ts).
// Todo sale como data URL de 64 px o menos, o un SVG limpiado (sin scripts ni recursos de afuera).
// Sin imports de Electron: el achicado de los PNG lo pasa ipc.ts.
import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** `base.svg`, `base.ico`… en ese orden. */
const variantes = (base: string, exts = ["svg", "png", "ico"]) => exts.map((e) => `${base}.${e}`);
const FAVICON = ["svg", "ico", "png"];

/** Dónde se busca adentro del repo, en el orden de preferencia (como mucho tres carpetas adentro). */
export const LUGARES = [
  ...variantes("favicon", FAVICON),
  ...variantes("logo", ["svg", "png"]),
  ...variantes("icon", ["svg", "png"]),
  ...variantes("public/favicon", FAVICON),
  ...variantes("app/public/favicon", FAVICON),
  ...variantes("assets/icon"),
  ...variantes("build/icon"),
  "src-tauri/icons/icon.png",
];

/** Carpetas que nunca se pisan, ni siquiera si un `package.json` apunta ahí. */
const PROHIBIDAS = new Set(["node_modules", ".git", "dist"]);
/** Cuántas carpetas se baja, como mucho, para llegar a un ícono. */
const NIVELES = 3;

const TIPOS: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/** Más que esto no se lee: un ícono de carpeta no pesa megas. */
const TOPE = 512 * 1024;
/** Lo que no se puede achicar (un SVG) va entero al frontend: que sea chico. */
const TOPE_ENTERO = 96 * 1024;
/** El lado máximo de un logo ya achicado. */
export const LADO_MAX = 64;
/** Lo que pesa, como mucho, un PNG de 64 px guardado en el registry. */
const TOPE_GUARDADO = 64 * 1024;

/** Achica un PNG/JPG/WebP (lado máximo `LADO_MAX`) y lo devuelve como data URL; `null` si no lo pudo leer. */
export type Achicar = (crudo: Buffer) => string | null;

type Origen = { ruta: string; icono: string | null; /** El logo elegido a mano (data URL ya achicada). */ logo?: string | null };

const PNG_FIRMA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Ancho y alto de un PNG (de su cabecera), o `null` si no lo es. */
export function medidaPng(b: Buffer): { w: number; h: number } | null {
  if (b.length < 24 || !b.subarray(0, 8).equals(PNG_FIRMA)) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/** El PNG más grande que lleva un `.ico` (los de hoy guardan PNG adentro); `null` si sólo trae mapas de bits. */
export function pngDeIco(b: Buffer): Buffer | null {
  if (b.length < 22 || b.readUInt16LE(0) !== 0 || b.readUInt16LE(2) !== 1) return null;
  let mejor: { lado: number; datos: Buffer } | null = null;
  for (let i = 0, n = Math.min(b.readUInt16LE(4), 64); i < n; i++) {
    const e = 6 + i * 16;
    if (e + 16 > b.length) break;
    const largo = b.readUInt32LE(e + 8);
    const desde = b.readUInt32LE(e + 12);
    if (desde + largo > b.length || largo < 24) continue;
    const datos = b.subarray(desde, desde + largo);
    const m = medidaPng(datos);
    if (m && (!mejor || Math.max(m.w, m.h) > mejor.lado)) mejor = { lado: Math.max(m.w, m.h), datos };
  }
  return mejor?.datos ?? null;
}

const dataUrl = (tipo: string, b: Buffer | string) => `data:${tipo};base64,${Buffer.from(b).toString("base64")}`;

/**
 * Deja un SVG sin nada que se ejecute o que traiga cosas de afuera: saca scripts, foreignObject, animaciones, manejadores `on…`
 * y la declaración de entidades, y lo rechaza (`null`) si aun así queda un `javascript:`, un `href` o un `url()` que no sea
 * interno. Aunque se pinta con <img> (que no ejecuta nada), el archivo es de un repo ajeno.
 */
export function limpiarSvg(texto: string): string | null {
  if (!/<svg[\s>]/i.test(texto) || /<!ENTITY/i.test(texto)) return null;
  const s = texto
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|foreignObject|iframe|embed|object|animate|set)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|foreignObject|iframe|embed|object|animate|set)\b[^>]*>/gi, "")
    .replace(/(\s)on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "$1")
    .trim();
  if (/<script|<foreignobject|javascript:|vbscript:|@import|\bon[a-z]+\s*=/i.test(s)) return null;
  const interno = (u: string) => /^(#|data:image\/(png|jpe?g|gif|webp);base64,)/i.test(u.trim().replace(/^["']|["']$/g, ""));
  for (const m of s.matchAll(/\bhref\s*=\s*("([^"]*)"|'([^']*)')/gi)) if (!interno(m[2] ?? m[3] ?? "")) return null;
  for (const m of s.matchAll(/url\(\s*([^)]*)\)/gi)) if (!interno(m[1])) return null;
  return s;
}

/**
 * Lo que se guarda en el registry como logo elegido: un PNG de 64 px o menos, o un SVG limpio, ambos en data URL. Devuelve la
 * data URL normalizada o `null` si no sirve (así el main no guarda lo que mande cualquier cliente).
 */
export function validarLogo(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const m = /^data:(image\/png|image\/svg\+xml);base64,([A-Za-z0-9+/]+={0,2})$/.exec(valor);
  if (!m || valor.length > TOPE_ENTERO * 2) return null;
  const b = Buffer.from(m[2], "base64");
  if (m[1] === "image/png") {
    const d = medidaPng(b);
    return d && d.w > 0 && d.h > 0 && d.w <= LADO_MAX && d.h <= LADO_MAX && b.length <= TOPE_GUARDADO ? valor : null;
  }
  if (b.length > TOPE_ENTERO) return null;
  const limpio = limpiarSvg(b.toString("utf8"));
  return limpio ? dataUrl("image/svg+xml", limpio) : null;
}

/** Convierte los bytes de una imagen (según su extensión) en el logo listo para mostrar; `null` si no se puede. */
export function logoDeBytes(crudo: Buffer, ext: string, achicar: Achicar | null): string | null {
  const e = ext.toLowerCase();
  if (e === ".svg") return crudo.length <= TOPE_ENTERO ? ((s) => (s ? dataUrl("image/svg+xml", s) : null))(limpiarSvg(crudo.toString("utf8"))) : null;
  const base = e === ".ico" ? (pngDeIco(crudo) ?? crudo) : crudo;
  if (achicar) return achicar(base);
  // Sin con qué achicar (el motor solo): un PNG que ya es chico va tal cual.
  const d = medidaPng(base);
  return d && d.w <= LADO_MAX && d.h <= LADO_MAX && base.length <= TOPE_GUARDADO ? dataUrl("image/png", base) : null;
}

/** La ruta de `ref` adentro de `ruta` si está a no más de `NIVELES` carpetas y no pasa por una carpeta prohibida; si no, `null`. */
function adentro(ruta: string, ref: string): string | null {
  const abs = path.resolve(ruta, ref);
  const rel = path.relative(ruta, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const partes = rel.split(path.sep);
  if (partes.length - 1 > NIVELES || partes.some((p) => PROHIBIDAS.has(p))) return null;
  return abs;
}

/** Las rutas a probar para un proyecto sin leer nada del disco, en orden. */
export function candidatos(p: Origen): string[] {
  const propio = p.icono
    ? [p.icono === "~" || p.icono.startsWith("~/") ? path.join(os.homedir(), p.icono.slice(1)) : path.resolve(p.ruta, p.icono)]
    : [];
  return [...propio, ...LUGARES.map((l) => path.join(p.ruta, l))];
}

// Por archivo (con su fecha y tamaño): releer los íconos no vuelve a abrir nada.
const leidos = new Map<string, string | null>();
const configs = new Map<string, string[]>();

async function leer(archivo: string, achicar: Achicar | null): Promise<string | null> {
  const ext = path.extname(archivo).toLowerCase();
  if (!TIPOS[ext]) return null;
  const s = await stat(archivo).catch(() => null);
  if (!s?.isFile() || s.size === 0 || s.size > TOPE) return null;
  const clave = `${archivo}:${s.mtimeMs}:${s.size}:${achicar ? "a" : "-"}`;
  const ya = leidos.get(clave);
  if (ya !== undefined) return ya;
  const crudo = await readFile(archivo).catch(() => null);
  const url = crudo ? logoDeBytes(crudo, ext, achicar) : null;
  leidos.set(clave, url);
  return url;
}

/** Los textos `icon` que declara un `package.json` (el propio y el de electron-builder) o un `electron-builder.yml`. */
function iconosDeConfig(archivo: string, texto: string): string[] {
  const salida: string[] = [];
  if (archivo.endsWith(".json")) {
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(texto);
    } catch {
      return [];
    }
    const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" ? (x as Record<string, unknown>) : {});
    const b = obj(j.build);
    for (const x of [j.icon, b.icon, obj(b.mac).icon, obj(b.win).icon, obj(b.linux).icon]) if (typeof x === "string" && x) salida.push(x);
  } else {
    for (const m of texto.matchAll(/^\s{0,6}icon:\s*["']?([^"'#\r\n]+?)["']?\s*(?:#.*)?$/gim)) salida.push(m[1]);
  }
  return salida;
}

/** Las rutas que declaran el `package.json` y electron-builder de la raíz (y de `app/`), en ese orden. */
async function candidatosDeConfig(ruta: string): Promise<string[]> {
  const salida: string[] = [];
  for (const sub of ["", "app"]) {
    for (const nombre of ["package.json", "electron-builder.yml", "electron-builder.yaml", "electron-builder.json"]) {
      const archivo = path.join(ruta, sub, nombre);
      const s = await stat(archivo).catch(() => null);
      if (!s?.isFile() || s.size > TOPE) continue;
      const clave = `${archivo}:${s.mtimeMs}:${s.size}`;
      let refs = configs.get(clave);
      if (!refs) {
        refs = iconosDeConfig(archivo, await readFile(archivo, "utf8").catch(() => ""));
        configs.set(clave, refs);
      }
      for (const ref of refs) {
        if (path.isAbsolute(ref) || ref.split(/[\\/]/).includes("..")) continue;
        // Relativo a la carpeta de la config; electron-builder también los busca en `build/` (su `buildResources`).
        for (const r of path.extname(ref) ? [ref] : variantes(ref)) {
          for (const rel of [r, path.join("build", r)]) {
            const a = adentro(ruta, path.join(sub, rel));
            if (a) salida.push(a);
          }
        }
      }
    }
  }
  return salida;
}

/** El ícono de un proyecto como data URL, o `null` si no tiene (va el monograma). */
export async function iconoDe(p: Origen, achicar: Achicar | null = null): Promise<string | null> {
  if (p.logo) {
    const l = validarLogo(p.logo);
    if (l) return l;
  }
  for (const c of candidatos(p)) {
    const url = await leer(c, achicar);
    if (url) return url;
  }
  for (const c of await candidatosDeConfig(p.ruta)) {
    const url = await leer(c, achicar);
    if (url) return url;
  }
  return null;
}

/** slug → data URL, sólo de los proyectos que tienen ícono. */
export async function iconosDe(proyectos: (Origen & { slug: string })[], achicar: Achicar | null = null): Promise<Record<string, string>> {
  const pares = await Promise.all(proyectos.map(async (p) => [p.slug, await iconoDe(p, achicar)] as const));
  return Object.fromEntries(pares.filter((x): x is [string, string] => x[1] !== null));
}
