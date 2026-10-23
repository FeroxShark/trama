// Quién es esta máquina para el celular: trama se sirve por la tailnet desde la PC y desde el Dell, y cada una
// tiene que poder vivir como su propio ícono en la pantalla de inicio. De acá salen el título, el color, el
// manifest y el ícono (SVG y PNG) de cada entrada. Sin `electron` ni estado propio: lo prueba
// tests/identidad.test.ts. Contrato: docs/estado/celular-maquinas.md.
//
// Sin otra máquina configurada (sin `maquinas.json`, o con uno que no dice nada de esta) la identidad es
// "como hoy": `propia: false` y remoto.ts sirve los archivos de `dist/` tal cual, sin tocar nada.
import { crc32, deflateSync } from "node:zlib";
import type { ConfigMaquinas } from "./maquinas-config.js";

export type Identidad = {
  /** El id de esta máquina (`pc`, `dell`). */
  id: string;
  /** Cómo se la llama: `PC`, `Dell`. */
  nombre: string;
  /** El título de la pestaña: `trama · Dell`. */
  titulo: string;
  /** El nombre del acceso directo: `Trama Dell`. */
  corto: string;
  /** El color oscuro de la barra del navegador y del fondo del ícono (`#rrggbb`). */
  fondo: string;
  /** El color de los trazos del ícono (`#rrggbb`). */
  trazo: string;
  /** Falso: ninguna otra máquina a la vista, y todo sale como siempre. */
  propia: boolean;
};

/** La de hoy: el logo de siempre y el fondo de siempre. */
const FONDO_BASE = "#0a0a0a";
const TRAZO_BASE = "#fafafa";
/** Los colores que llevan por defecto las máquinas conocidas; el resto elige uno por su id. */
const DEFECTO: Record<string, string> = { pc: TRAZO_BASE, dell: "#5eead4" };
const PALETA = ["#fbbf24", "#a78bfa", "#fb7185", "#60a5fa", "#a3e635", "#f472b6"];

const hex = (c: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];
const aHex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
/** `a` con `k` (0 a 1) de `b`. */
function mezcla(a: string, b: string, k: number): string {
  const [x, y] = [hex(a), hex(b)];
  return aHex(x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k);
}

function colorDe(id: string): string {
  if (DEFECTO[id]) return DEFECTO[id];
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETA[h % PALETA.length];
}

/** La identidad que sale de `maquinas.json` (o de `SOLA`). */
export function identidadDe(cfg: Pick<ConfigMaquinas, "esta" | "nombre" | "color" | "maquinas">): Identidad {
  const id = cfg.esta;
  const nombre = cfg.nombre || (id === "pc" ? "PC" : id.charAt(0).toUpperCase() + id.slice(1));
  const trazo = cfg.color ?? colorDe(id);
  // El gris de siempre cuando el trazo es el blanco de siempre; si no, un fondo oscuro con un toque del color.
  const fondo = trazo === TRAZO_BASE ? FONDO_BASE : mezcla(FONDO_BASE, trazo, 0.16);
  const propia = cfg.maquinas.length > 0 || !!cfg.nombre || !!cfg.color || id !== "pc";
  return { id, nombre, titulo: `trama · ${nombre}`, corto: `Trama ${nombre}`, fondo, trazo, propia };
}

/** Para ponerlo en un atributo o en un texto de HTML. */
export const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** El manifest de esta entrada: su nombre, sus colores y los mismos tres íconos (que salen pintados a su color). */
export function manifest(i: Identidad): string {
  return JSON.stringify({
    id: "./",
    name: i.corto,
    short_name: i.corto,
    start_url: "./",
    scope: "./",
    display: "standalone",
    background_color: i.fondo,
    theme_color: i.fondo,
    icons: [
      { src: "./icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "./icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "./icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  });
}

// El logo (public/favicon.svg), en coordenadas de 0 a 64: cuatro trazos a media opacidad y cuatro enteros.
const K = 11 / 6; // translate(10 10) scale(1.8333)
const g = (x: number) => 10 + K * x;
type Trazo = [number, number, number, number, number];
const TRAZOS: Trazo[] = [
  [8.5, 2.5, 8.5, 12, 0.5],
  [8.5, 19, 8.5, 21.5, 0.5],
  [15.5, 2.5, 15.5, 5, 0.5],
  [15.5, 12, 15.5, 21.5, 0.5],
  [2.5, 8.5, 5, 8.5, 1],
  [12, 8.5, 21.5, 8.5, 1],
  [2.5, 15.5, 12, 15.5, 1],
  [19, 15.5, 21.5, 15.5, 1],
];
const ANCHO = 2.4 * K;

/** El mismo ícono de `public/favicon.svg` con los colores de esta entrada. */
export function icono(i: Identidad): string {
  const borde = mezcla(i.fondo, i.trazo, 0.12);
  const ps = (op: number) =>
    TRAZOS.filter((t) => t[4] === op)
      .map((t) => (t[0] === t[2] ? `M${t[0]} ${t[1]}v${t[3] - t[1]}` : `M${t[0]} ${t[1]}h${t[2] - t[0]}`))
      .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="${i.fondo}"/>` +
    `<rect x="1" y="1" width="62" height="62" rx="13" fill="none" stroke="${borde}" stroke-width="2"/>` +
    `<g transform="translate(10 10) scale(1.8333)" fill="none" stroke="${i.trazo}" stroke-width="2.4" stroke-linecap="round">` +
    `<path d="${ps(0.5)}" opacity=".5"/><path d="${ps(1)}"/></g></svg>\n`
  );
}

const cubre = (d: number, k: number) => Math.min(1, Math.max(0, 0.5 - d * k));
/** Distancia con signo a un cuadrado redondeado centrado en (32, 32), de medio lado `m` y radio `r`. */
function sdfCaja(x: number, y: number, m: number, r: number) {
  const qx = Math.abs(x - 32) - (m - r);
  const qy = Math.abs(y - 32) - (m - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
function sdfTramo(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const h = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - dx * h, py - ay - dy * h);
}

const png = (ancho: number, rgba: Buffer) => {
  const trozo = (tipo: string, datos: Buffer) => {
    const t = Buffer.concat([Buffer.from(tipo, "latin1"), datos]);
    const l = Buffer.alloc(4);
    l.writeUInt32BE(datos.length);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc32(t));
    return Buffer.concat([l, t, c]);
  };
  const cab = Buffer.alloc(13);
  cab.writeUInt32BE(ancho, 0);
  cab.writeUInt32BE(ancho, 4);
  cab[8] = 8; // bits por canal
  cab[9] = 6; // RGBA
  const filas = Buffer.alloc((ancho * 4 + 1) * ancho);
  for (let y = 0; y < ancho; y++) rgba.copy(filas, y * (ancho * 4 + 1) + 1, y * ancho * 4, (y + 1) * ancho * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo("IHDR", cab), trozo("IDAT", deflateSync(filas)), trozo("IEND", Buffer.alloc(0))]);
};

const hechos = new Map<string, Buffer>();

/**
 * El ícono en PNG de `tam` px. `enmascarable`: sin esquinas redondas y con el logo más chico (Android lo
 * recorta a su forma). Dibujado acá (sin librerías) y guardado: sólo cuesta la primera vez que se lo pide.
 */
export function iconoPng(i: Identidad, tam: number, enmascarable = false): Buffer {
  const clave = `${i.fondo}${i.trazo}${tam}${enmascarable}`;
  const hecho = hechos.get(clave);
  if (hecho) return hecho;
  const fondo = hex(i.fondo);
  const trazo = hex(i.trazo);
  const borde = hex(mezcla(i.fondo, i.trazo, 0.12));
  const k = tam / 64;
  // El logo se achica hacia el centro en el enmascarable: tiene que caber en el círculo seguro.
  const e = enmascarable ? 0.62 : 1;
  const tr = TRAZOS.map(([ax, ay, bx, by, op]) => ({ a: [32 + (g(ax) - 32) * e, 32 + (g(ay) - 32) * e], b: [32 + (g(bx) - 32) * e, 32 + (g(by) - 32) * e], op }));
  const mitad = (ANCHO * e) / 2;
  const salida = Buffer.alloc(tam * tam * 4);
  for (let y = 0; y < tam; y++) {
    for (let x = 0; x < tam; x++) {
      const px = (x + 0.5) / k;
      const py = (y + 0.5) / k;
      const alfa = enmascarable ? 1 : cubre(sdfCaja(px, py, 32, 14), k);
      let c = fondo;
      if (!enmascarable) {
        const b = cubre(Math.abs(sdfCaja(px, py, 31, 13)) - 1, k) * 0.999;
        c = c.map((v, n) => v + (borde[n] - v) * b) as typeof c;
      }
      let t = 0;
      for (const s of tr) t = Math.max(t, cubre(sdfTramo(px, py, s.a[0], s.a[1], s.b[0], s.b[1]) - mitad, k) * s.op);
      c = c.map((v, n) => v + (trazo[n] - v) * t) as typeof c;
      const o = (y * tam + x) * 4;
      salida[o] = c[0];
      salida[o + 1] = c[1];
      salida[o + 2] = c[2];
      salida[o + 3] = Math.round(alfa * 255);
    }
  }
  const r = png(tam, salida);
  hechos.set(clave, r);
  return r;
}
