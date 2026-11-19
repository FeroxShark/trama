// «Reportar un bug» (el bicho del pie de la barra): arma una carpeta en Descargas con la captura de la ventana y el log de Trama,
// y la URL de un issue nuevo del repo con el texto prellenado. La persona arrastra los dos archivos al issue: GitHub no deja
// adjuntar por la URL. El log se limpia antes de escribirlo (el repo es público): claves, tokens, correos y la carpeta personal.
// `limpiarLog`, `urlIssue` y `carpetaDescargas` son puros (los prueba tests/reporte.test.ts); `armarReporte` escribe.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ESTADO } from "./estado.ts";

/**
 * app/package.json (electron/ y dist-electron/ están a la misma profundidad): la versión, el repo (`github:dueño/repo`) y la dirección
 * del receptor de reportes anónimos (`tramaReportes`, sólo https; no es secreta).
 */
export function paquete(): { version: string | null; repo: string | null; reportes: string | null } {
  try {
    const p = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: unknown; repository?: unknown; tramaReportes?: unknown };
    const r = typeof p.repository === "string" ? p.repository : (p.repository as { url?: unknown } | undefined)?.url;
    const m = typeof r === "string" ? /^(?:github:|(?:git\+)?https:\/\/github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(r.trim()) : null;
    const reportes = typeof p.tramaReportes === "string" && /^https:\/\/[\w.-]+(?::\d+)?\/?$/.test(p.tramaReportes) ? p.tramaReportes.replace(/\/$/, "") : null;
    return { version: typeof p.version === "string" ? p.version : null, repo: m ? m[1]! : null, reportes };
  } catch {
    return { version: null, repo: null, reportes: null };
  }
}

/** Cuántas líneas del final de cada log van al reporte. */
export const LINEAS_LOG = 400;
/** Lo más largo que se deja la descripción en la URL (GitHub corta las URL muy largas). */
const MAX_DESC = 3000;

const CLAVES: [RegExp, string][] = [
  [/sk-ant-[A-Za-z0-9_-]+/g, "<clave>"],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, "<clave>"],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/g, "<token>"],
  [/\bgithub_pat_[A-Za-z0-9_]{16,}/g, "<token>"],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, "<clave>"],
  [/\bnvapi-[A-Za-z0-9_-]{16,}/g, "<clave>"],
  [/\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "<token>"],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 <token>"],
  [/\b((?:[A-Z0-9_]*_)?(?:API_?KEY|TOKEN|SECRET|PASSWORD|CLAVE)[A-Z0-9_]*)(\s*[=:]\s*)("?)[^\s"']+\3/gi, "$1$2<oculto>"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, "<correo>"],
];

const escaparRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Las últimas `lineas` líneas del log, sin claves, tokens ni correos, y con la carpeta personal como `~` (en las dos formas de
 * Windows: `C:\Users\x` y `C:/Users/x`).
 */
export function limpiarLog(texto: string, home: string, lineas = LINEAS_LOG): string {
  let s = texto.split(/\r?\n/).slice(-lineas).join("\n");
  const casas = [...new Set([home, home.replace(/\\/g, "/")].filter((h) => h.length > 1))].sort((a, b) => b.length - a.length);
  for (const h of casas) s = s.replace(new RegExp(escaparRe(h), process.platform === "win32" ? "gi" : "g"), "~");
  for (const [re, por] of CLAVES) s = s.replace(re, por);
  return s;
}

export type DatosReporte = { descripcion: string; version: string | null; sistema: string; carpeta: string | null; conCaptura: boolean; conLog: boolean };

/** El título del issue: la primera línea de lo que escribió la persona (hasta 80 letras), o uno genérico. */
export function tituloDe(descripcion: string): string {
  const l = descripcion.trim().split(/\r?\n/)[0]?.trim() ?? "";
  if (!l) return "Bug";
  return l.length > 80 ? `${l.slice(0, 79).trimEnd()}…` : l;
}

/** La URL de un issue nuevo con título, cuerpo y la etiqueta `bug`. */
export function urlIssue(repo: string, d: DatosReporte): string {
  const desc = d.descripcion.trim().slice(0, MAX_DESC) || "(sin descripción)";
  const adjuntos = [d.conCaptura ? "`captura.png`" : null, d.conLog ? "`log.txt`" : null].filter(Boolean).join(" y ");
  const cuerpo = [
    "### Qué pasó",
    "",
    desc,
    "",
    "### Dónde",
    "",
    `- Trama ${d.version ?? "?"}`,
    `- ${d.sistema}`,
    ...(adjuntos && d.carpeta ? ["", "### Adjuntos", "", `Arrastrá acá ${adjuntos} (están en \`${d.carpeta}\`, la carpeta que abrió Trama).`] : []),
  ].join("\n");
  const q = new URLSearchParams({ title: tituloDe(d.descripcion), body: cuerpo, labels: "bug" });
  return `https://github.com/${repo}/issues/new?${q.toString()}`;
}

/** Linux: la de `XDG_DOWNLOAD_DIR` (user-dirs.dirs), si no `~/Descargas` o `~/Downloads` si existen; Windows: `%USERPROFILE%\Downloads`. Si no hay, la carpeta personal. */
export function carpetaDescargas(home: string, plat: NodeJS.Platform = process.platform, leer: (f: string) => string | null = leerTexto, existe: (f: string) => boolean = existsSync): string {
  const p = plat === "win32" ? path.win32 : path.posix;
  if (plat !== "win32") {
    const dirs = leer(p.join(home, ".config", "user-dirs.dirs"));
    const m = dirs?.match(/^XDG_DOWNLOAD_DIR="([^"]+)"/m);
    if (m) {
      const d = m[1]!.replace(/^\$HOME/, home);
      if (existe(d)) return d;
    }
  }
  for (const n of ["Downloads", "Descargas"]) {
    const d = p.join(home, n);
    if (existe(d)) return d;
  }
  return home;
}

const leerTexto = (f: string): string | null => {
  try {
    return readFileSync(f, "utf8");
  } catch {
    return null;
  }
};

const dos = (n: number) => String(n).padStart(2, "0");
const sello = (d: Date) => `${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}-${dos(d.getHours())}${dos(d.getMinutes())}${dos(d.getSeconds())}`;

export const sistemaDe = () => `${os.type()} ${os.release()} (${process.platform}, ${process.arch})`;

/** El log de Trama y el de la ventana cliente, limpios, uno detrás del otro. `null`: no hay ninguno. */
export function logs(home: string): string | null {
  const partes: string[] = [];
  for (const n of ["trama.log", "ventana.log"]) {
    const t = leerTexto(path.join(ESTADO, n));
    if (t?.trim()) partes.push(`===== ${n} (últimas ${LINEAS_LOG} líneas) =====\n${limpiarLog(t, home)}`);
  }
  return partes.length ? partes.join("\n\n") + "\n" : null;
}

export type Reporte = { ok: true; carpeta: string; url: string } | { ok: false; error: string };

/**
 * Escribe `trama-reporte-<fecha>/` en Descargas con `captura.png` (si llegó, en base64) y `log.txt`, y devuelve la carpeta y la URL
 * del issue. No abre nada: la página abre la URL y la carpeta con los canales de la ventana.
 */
export function armarReporte(x: unknown, home = os.homedir(), ahora = new Date()): Reporte {
  const o = (x && typeof x === "object" ? x : {}) as { descripcion?: unknown; captura?: unknown; log?: unknown };
  const descripcion = typeof o.descripcion === "string" ? o.descripcion.slice(0, 20_000) : "";
  const png = typeof o.captura === "string" && /^[A-Za-z0-9+/=]+$/.test(o.captura) ? Buffer.from(o.captura, "base64") : null;
  const conPng = !!png && png.length > 8 && png.subarray(1, 4).toString("latin1") === "PNG";
  const log = o.log === false ? null : logs(home);
  const carpeta = path.join(carpetaDescargas(home), `trama-reporte-${sello(ahora)}`);
  try {
    mkdirSync(carpeta, { recursive: true });
    if (conPng) writeFileSync(path.join(carpeta, "captura.png"), png!);
    if (log) writeFileSync(path.join(carpeta, "log.txt"), log);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const visible = carpeta.startsWith(home) ? `~${carpeta.slice(home.length)}` : carpeta;
  const pq = paquete();
  if (!pq.repo) return { ok: false, error: "package.json sin repository" };
  const url = urlIssue(pq.repo, { descripcion, version: pq.version, sistema: sistemaDe(), carpeta: visible, conCaptura: conPng, conLog: !!log });
  return { ok: true, carpeta, url };
}
