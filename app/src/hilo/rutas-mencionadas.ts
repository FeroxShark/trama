// Rutas de carpetas y archivos `.html` nombradas en un mensaje del asistente:
// detección pura (sin tocar el disco): se tocan en su lugar del texto y las imágenes se muestran al pie.
import { extensionDe, tipoDeArchivo } from "../../electron/archivo-ruta.ts";
import type { Plataforma } from "../../electron/rutas.ts";
import { bloques, rutaCarpeta, trozos, type Bloque } from "./markdown.ts";

export type TipoRutaMencionada = "carpeta" | "html" | "archivo";

export type RutaMencionada = {
  tipo: TipoRutaMencionada;
  ruta: string;
};

const MAX_RUTAS = 6;
const LARGO_MAX = 1024;

function dePlataforma(s: string, plat: Plataforma): boolean {
  if (plat === "win32") return /^(?:[A-Za-z]:[\\\/]|~[\\\/])/.test(s);
  return /^(?:\/(?!\/)|~\/)/.test(s);
}

function tieneSegmentoUtil(s: string): boolean {
  const sinUnidad = s.replace(/^[A-Za-z]:/, "");
  if (!/\p{L}/u.test(sinUnidad)) return false;
  const partes = s.split(/[\\\/]/).filter(Boolean);
  return partes.length >= 2;
}

function sinBasura(s: string): boolean {
  return (
    s.length > 0 &&
    s.length <= LARGO_MAX &&
    !/[\u0000-\u001f*?]/.test(s) &&
    !s.includes("://") &&
    !s.split(/[\\\/]/).includes("..") &&
    !/\s(?:~[\\\/]|[A-Za-z]:[\\\/]|\/)/.test(s)
  );
}

function esHtml(s: string, plat: Plataforma): boolean {
  if (!sinBasura(s) || !dePlataforma(s, plat) || !tieneSegmentoUtil(s)) return false;
  return /[^\\\/]\.html$/i.test(s);
}

function esArchivo(s: string, plat: Plataforma): boolean {
  const terminaEnBarra = plat === "win32" ? /[\\\/]$/.test(s) : s.endsWith("/");
  if (terminaEnBarra) return false;
  if (!sinBasura(s) || !dePlataforma(s, plat) || !tieneSegmentoUtil(s)) return false;
  if (!/[^\\\/]\.[A-Za-z0-9]+$/.test(s) || !extensionDe(s)) return false;
  return tipoDeArchivo(s).tipo !== "otro";
}

function clasificar(s: string, plat: Plataforma, agregar: (tipo: TipoRutaMencionada, ruta: string) => void, carpetaProsa: boolean): boolean {
  if (esHtml(s, plat)) {
    agregar("html", s);
    return true;
  }
  if (esArchivo(s, plat)) {
    agregar("archivo", s);
    return true;
  }
  if (carpetaProsa && esCarpetaProsa(s, plat)) {
    agregar("carpeta", s);
    return true;
  }
  return false;
}

function esCarpetaCodigo(s: string, plat: Plataforma): string | null {
  const c = rutaCarpeta(s);
  if (!c || !sinBasura(c) || !dePlataforma(c, plat) || !tieneSegmentoUtil(c)) return null;
  return c;
}

function esCarpetaProsa(s: string, plat: Plataforma): boolean {
  const terminaEnBarra = plat === "win32" ? /[\\\/]$/.test(s) : s.endsWith("/");
  if (!terminaEnBarra) return false;
  return sinBasura(s) && dePlataforma(s, plat) && tieneSegmentoUtil(s);
}

function claveDedup(tipo: TipoRutaMencionada, ruta: string, plat: Plataforma): string {
  const sinBarra = ruta.replace(/[\\\/]+$/, "");
  const norm = plat === "win32" ? sinBarra.replace(/\//g, "\\").toLowerCase() : sinBarra;
  return `${tipo}:${norm}`;
}

type AgregarEn = (tipo: TipoRutaMencionada, ruta: string, pos: number) => void;

/** `pos`: dónde empieza la ruta dentro de `texto` (para tocarla en su lugar, `partirProsa`). */
function extraerDeProsa(texto: string, plat: Plataforma, agregar: AgregarEn, base = 0) {
  const prefijo = plat === "win32" ? "(?:[A-Za-z]:[\\\\/]|~[\\\\/])" : "(?:~/|/(?!/))";
  const re = new RegExp(`("(${prefijo}[^"\\n]+)"|\x27(${prefijo}[^\x27\\n]+)\x27|${prefijo}[^\\s"\x27<>\`()\\[\\]{}]+)`, "g");
  for (const m of texto.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > 0 && !/[\s(\[<,"\x27=;:¿¡]/.test(texto[idx - 1])) continue;
    const raw = m[0];
    if (m[2] || m[3]) {
      const crudo = m[2] ?? m[3];
      const inner = crudo.trim();
      const pos = base + idx + 1 + (crudo.length - crudo.trimStart().length);
      if (!clasificar(inner, plat, (tipo, ruta) => agregar(tipo, ruta, pos), true)) extraerDeProsa(inner, plat, agregar, pos);
      continue;
    }
    const limpio = raw.replace(/[.,;:!?\x27"`)\]]+$/, "");
    clasificar(limpio, plat, (tipo, ruta) => agregar(tipo, ruta, base + idx), true);
  }
}

/**
 * Parte un trozo de prosa en texto y rutas tocables, en orden: lo que `rutasMencionadas` encuentra en la prosa, pero en su lugar
 * (Texto.tsx lo dibuja como botón, igual que una ruta entre comillas invertidas).
 */
export function partirProsa(texto: string, plat: Plataforma = "linux"): Array<string | RutaMencionada> {
  const hallados: Array<RutaMencionada & { pos: number }> = [];
  extraerDeProsa(texto, plat, (tipo, ruta, pos) => {
    if (texto.startsWith(ruta, pos)) hallados.push({ tipo, ruta, pos });
  });
  if (!hallados.length) return [texto];
  hallados.sort((a, b) => a.pos - b.pos);
  const out: Array<string | RutaMencionada> = [];
  let i = 0;
  for (const h of hallados) {
    if (h.pos < i) continue;
    if (h.pos > i) out.push(texto.slice(i, h.pos));
    out.push({ tipo: h.tipo, ruta: h.ruta });
    i = h.pos + h.ruta.length;
  }
  if (i < texto.length) out.push(texto.slice(i));
  return out;
}

/** Lo que nombra un código en línea (`ruta`): una carpeta, un `.html` o un archivo mostrable; si no es ninguno, null. */
export function rutaDeCodigo(texto: string, plat: Plataforma = "linux"): RutaMencionada | null {
  const s = texto.trim();
  let r: RutaMencionada | null = null;
  if (!clasificar(s, plat, (tipo, ruta) => (r = { tipo, ruta }), false)) {
    const c = esCarpetaCodigo(s, plat);
    if (c) r = { tipo: "carpeta", ruta: c };
  }
  return r;
}

function recorrerLinea(texto: string, plat: Plataforma, agregar: (tipo: TipoRutaMencionada, ruta: string) => void) {
  for (const x of trozos(texto)) {
    if (x.tipo === "link" || x.tipo === "img") continue;
    if (x.tipo === "code") {
      const r = rutaDeCodigo(x.texto, plat);
      if (r) agregar(r.tipo, r.ruta);
      continue;
    }
    if (x.tipo === "b" || x.tipo === "i" || x.tipo === "s") {
      recorrerLinea(x.texto, plat, agregar);
      continue;
    }
    extraerDeProsa(x.texto, plat, agregar);
  }
}

function recorrerBloques(bs: readonly Bloque[], plat: Plataforma, agregar: (tipo: TipoRutaMencionada, ruta: string) => void) {
  for (const b of bs) {
    if (b.tipo === "p" || b.tipo === "h") {
      recorrerLinea(b.texto, plat, agregar);
    } else if (b.tipo === "cita") {
      recorrerBloques(b.bloques, plat, agregar);
    } else if (b.tipo === "tabla") {
      for (const c of b.cabeza) recorrerLinea(c, plat, agregar);
      for (const f of b.filas) for (const c of f) recorrerLinea(c, plat, agregar);
    } else if (b.tipo === "ol" || b.tipo === "ul") {
      for (const it of b.items) {
        recorrerLinea(it.texto, plat, agregar);
        if (it.bloques) recorrerBloques(it.bloques, plat, agregar);
        if (it.sub) recorrerBloques([it.sub], plat, agregar);
      }
    }
  }
}

/**
 * Devuelve las rutas absolutas de carpetas (con barra final o en código en línea) y archivos `.html`
 * nombrados en `texto` para la plataforma `plat`, en orden de aparición, sin duplicados y hasta 6.
 */
export function rutasMencionadas(texto: string, plat: Plataforma = "linux"): RutaMencionada[] {
  if (!texto) return [];
  const out: RutaMencionada[] = [];
  const vistas = new Set<string>();
  const agregar = (tipo: TipoRutaMencionada, ruta: string) => {
    if (out.length >= MAX_RUTAS) return;
    const clave = claveDedup(tipo, ruta, plat);
    if (vistas.has(clave)) return;
    vistas.add(clave);
    out.push({ tipo, ruta });
  };
  recorrerBloques(bloques(texto), plat, agregar);
  return out;
}

/**
 * Lo que va al pie del mensaje: sólo las imágenes, grandes (salvo que vengan con `![](ruta)`). Las carpetas y los archivos se tocan en
 * su lugar del texto (Texto.tsx: `rutaDeCodigo` y `partirProsa`).
 */
export function rutasSinLugar(texto: string, plat: Plataforma = "linux"): RutaMencionada[] {
  return rutasMencionadas(texto, plat).filter((r) => r.tipo === "archivo" && tipoDeArchivo(r.ruta).tipo === "imagen");
}

/** El último tramo (nombre de la carpeta o del archivo `.html`). */
export function nombreRuta(ruta: string): string {
  const limpio = ruta.replace(/[\\\/]+$/, "");
  const partes = limpio.split(/[\\\/]/).filter(Boolean);
  return partes.at(-1) ?? (ruta || "/");
}

/** La carpeta que contiene a un archivo (`/a/b/x.html` da `/a/b`; `C:\\a\\x.html` da `C:\\a`). En la raíz devuelve la raíz. */
export function carpetaDe(ruta: string): string {
  const corte = Math.max(ruta.lastIndexOf("/"), ruta.lastIndexOf("\\"));
  if (corte < 0) return ruta;
  const padre = ruta.slice(0, corte);
  if (padre === "" || /^[A-Za-z]:$/.test(padre)) return ruta.slice(0, corte + 1);
  return padre;
}

/** Acorta una ruta por el medio manteniendo visibles el inicio y los tramos finales. */
export function acortarRuta(ruta: string, max = 48): string {
  if (ruta.length <= max) return ruta;
  if (max < 8) return `${ruta.slice(0, Math.max(1, max - 1))}…`;
  const sep = ruta.includes("\\") && !ruta.includes("/") ? "\\" : "/";
  const partes = ruta.split(/[\\\/]/).filter(Boolean);
  if (partes.length >= 4) {
    const pref = ruta.startsWith("/") ? `/${partes[0]}/${partes[1]}` : `${partes[0]}${sep}${partes[1]}`;
    const colaFin = /[\\\/]$/.test(ruta) ? sep : "";
    const cola2 = `${partes[partes.length - 2]}${sep}${partes[partes.length - 1]}${colaFin}`;
    const cand2 = `${pref}${sep}…${sep}${cola2}`;
    if (cand2.length <= max && cand2.length < ruta.length) return cand2;
    const cola1 = `${partes[partes.length - 1]}${colaFin}`;
    const cand1 = `${pref}${sep}…${sep}${cola1}`;
    if (cand1.length <= max && cand1.length < ruta.length) return cand1;
  }
  const izq = Math.max(4, Math.floor((max - 1) * 0.38));
  const der = max - 1 - izq;
  return `${ruta.slice(0, izq)}…${ruta.slice(-der)}`;
}
