// Rutas de carpetas y archivos `.html` nombradas en un mensaje del asistente:
// detección pura (sin tocar el disco) para mostrar tarjetas rápidas debajo del texto.
import type { Plataforma } from "../../electron/rutas.ts";
import { bloques, rutaCarpeta, trozos, type Bloque } from "./markdown.ts";

export type TipoRutaMencionada = "carpeta" | "html";

export type RutaMencionada = {
  tipo: TipoRutaMencionada;
  ruta: string;
};

const MAX_RUTAS = 4;
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

function extraerDeProsa(texto: string, plat: Plataforma, agregar: (tipo: TipoRutaMencionada, ruta: string) => void) {
  const prefijo = plat === "win32" ? "(?:[A-Za-z]:[\\\\/]|~[\\\\/])" : "(?:~/|/(?!/))";
  const re = new RegExp(`("(${prefijo}[^"\\n]+)"|\x27(${prefijo}[^\x27\\n]+)\x27|${prefijo}[^\\s"\x27<>\`()\\[\\]{}]+)`, "g");
  for (const m of texto.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > 0 && !/[\s(\[<,"\x27=;:¿¡]/.test(texto[idx - 1])) continue;
    const raw = m[0];
    if (m[2] || m[3]) {
      const inner = (m[2] ?? m[3]).trim();
      if (esHtml(inner, plat)) agregar("html", inner);
      else if (esCarpetaProsa(inner, plat)) agregar("carpeta", inner);
      else extraerDeProsa(inner, plat, agregar);
      continue;
    }
    const limpio = raw.replace(/[.,;:!?\x27"`)\]]+$/, "");
    if (esHtml(limpio, plat)) agregar("html", limpio);
    else if (esCarpetaProsa(limpio, plat)) agregar("carpeta", limpio);
  }
}

function recorrerLinea(texto: string, plat: Plataforma, agregar: (tipo: TipoRutaMencionada, ruta: string) => void) {
  for (const x of trozos(texto)) {
    if (x.tipo === "link" || x.tipo === "img") continue;
    if (x.tipo === "code") {
      const s = x.texto.trim();
      if (esHtml(s, plat)) {
        agregar("html", s);
      } else {
        const c = esCarpetaCodigo(s, plat);
        if (c) agregar("carpeta", c);
      }
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
 * nombrados en `texto` para la plataforma `plat`, en orden de aparición, sin duplicados y hasta 4.
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
