// La vista de worker, lo que no es pintar: nombre corto de un paso, cómo se juntan los chicos, el resumen que sale del
// último mensaje, el chip de tests, los pesos del mapa y el diff de una edición. Puro: lo prueba `tests/worker-datos.test.ts`.
import type { Cambio, Encabezado, Paso, TipoPaso } from "../datos/pasos";

/** Un paso lento es el que pasa de esto (ms): la duración sólo se escribe entonces. */
export const LENTO_MS = 10_000;

const base = (ruta: string) => ruta.split("/").filter(Boolean).pop() ?? ruta;
export const nombreDeArchivo = base;

const PALABRAS_COMANDO = 3;
const MAX_CORTO = 32;

/** Un comando en dos o tres palabras: sin el `cd … &&` de adelante, sin variables de entorno y hasta el primer `&&`, `|` o `;`. */
export function comandoCorto(cmd: string): string {
  let c = cmd.trim();
  c = c.replace(/^(?:cd\s+\S+\s*(?:&&|;)\s*)+/, "");
  c = c.split(/&&|\|\||[|;\n]/)[0].trim();
  const ps = c.split(/\s+/).filter((p) => p && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(p));
  return ps.slice(0, PALABRAS_COMANDO).join(" ").slice(0, MAX_CORTO);
}

/** El nombre corto de un paso, a la derecha del verbo: el archivo, el patrón buscado o dos palabras del comando. Vacío si no hay. */
export function corto(p: Paso): string {
  const d = p.detalle;
  switch (d.clase) {
    case "leer":
    case "editar":
    case "escribir":
      return base(d.ruta);
    case "buscar":
      return d.patron;
    case "correr":
      return d.descripcion && d.descripcion.length <= MAX_CORTO ? d.descripcion : comandoCorto(d.comando.t);
    case "delegar":
      return d.descripcion ?? "";
    case "pensar":
    case "texto":
      return "";
    default:
      return p.titulo;
  }
}

/** Un paso que se junta con los de al lado: leer y buscar que salieron bien. */
export const esChico = (p: Paso) => (p.tipo === "leer" || p.tipo === "buscar") && p.estado === "ok";

export type Fila = { grupo: false; p: Paso } | { grupo: true; ps: Paso[] };

/** Las filas de la lista: los chicos seguidos van en un grupo (de dos para arriba; uno solo queda suelto). */
export function filas(pasos: readonly Paso[]): Fila[] {
  const out: Fila[] = [];
  for (const p of pasos) {
    const ult = out[out.length - 1];
    if (esChico(p) && ult?.grupo) ult.ps.push(p);
    else if (esChico(p)) out.push({ grupo: true, ps: [p] });
    else out.push({ grupo: false, p });
  }
  return out.map((f) => (f.grupo && f.ps.length === 1 ? { grupo: false as const, p: f.ps[0] } : f));
}

/** Cuántos archivos leyó y cuántas veces buscó un grupo: lo que dice su rótulo. */
export function cuenta(ps: readonly Paso[]): { leer: number; buscar: number } {
  return { leer: ps.filter((p) => p.tipo === "leer").length, buscar: ps.filter((p) => p.tipo === "buscar").length };
}

/** Los pasos que van en la lista y el mapa: el último mensaje del turno es el resultado, que se ve arriba. */
export const visibles = (pasos: readonly Paso[]): Paso[] => pasos.filter((p) => !(p.detalle.clase === "texto" && p.detalle.final));

/** "38 s", "4 m 11 s", "1 h 05 m". */
export function durCorta(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} m ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} m`;
}

/** La duración de la fila, sólo si el paso es lento. */
export const durLenta = (p: Paso): string | null => (p.dur !== null && p.dur > LENTO_MS ? durCorta(p.dur) : null);

/** El peso de cada paso en el mapa: lo que pasó hasta el siguiente (el último, hasta el fin o `ahora`). Nunca cero ni menos del 1 % del total. */
export function pesos(pasos: readonly Paso[], fin: number | null): number[] {
  if (!pasos.length) return [];
  const brutos = pasos.map((p, i) => {
    const t = p.t ?? 0;
    const sig = pasos[i + 1]?.t ?? fin ?? t + (p.dur ?? 1000);
    return Math.max(0, sig - t);
  });
  const total = brutos.reduce((a, b) => a + b, 0) || pasos.length;
  const piso = total * 0.01;
  return brutos.map((b) => Math.max(b, piso));
}

// ---- El resultado -------------------------------------------------------------------------------------------------

const CABEZAS = /^(RESULTADO|ARCHIVOS|DECISION|DECISIÓN|SIGUE|PROBAR|PREGUNTA|CONTEXTO|OPCION|OPCIÓN|DEFECTO)\s*:/;
const TOPE_RESUMEN = 320;
const SUPUESTO = /\bsupuest[oa]s?\b|\bsupuse\b|\bsupuso\b|\bsupongo\b|\bassum(?:ed|ption|ptions|ing)\b/i;

export type Resumen = { resultado: string | null; supuestos: string[] };

/** La sección RESULTADO: del último mensaje del worker; si no trae encabezados, su primer párrafo. */
export function seccionResultado(texto: string): string {
  const ls = texto.split("\n");
  const i = ls.findIndex((l) => /^RESULTADO\s*:/.test(l.trim()));
  if (i < 0) return texto.trim().split(/\n\s*\n/)[0].trim();
  const out = [ls[i].trim().replace(/^RESULTADO\s*:\s*/, "")];
  for (const l of ls.slice(i + 1)) {
    if (CABEZAS.test(l.trim())) break;
    out.push(l.trim());
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

const mayus = (s: string) => (s ? s[0].toLocaleUpperCase() + s.slice(1) : s);

/** Las frases de un texto (cortan en . ! ? seguido de espacio). */
const frases = (s: string) => s.split(/(?<=[.!?])\s+/).map((f) => f.trim()).filter(Boolean);

/** Lo que dice el resultado en una o dos frases, y aparte los supuestos que declaró (frases con "supuestos", partidas por `;`). */
export function resumenDe(texto: string | null): Resumen {
  if (!texto) return { resultado: null, supuestos: [] };
  const sec = seccionResultado(texto);
  if (!sec) return { resultado: null, supuestos: [] };
  const fs = frases(sec);
  const supuestos: string[] = [];
  const resto: string[] = [];
  for (const f of fs) {
    if (!SUPUESTO.test(f)) {
      resto.push(f);
      continue;
    }
    const sin = f.replace(/^.*?\b(?:supuestos?|supuse|supuso|supongo|assum\w*)\b\s*[:,-]?\s*/i, "").replace(/[.!?]+$/, "");
    for (const s of (sin || f).split(/\s*;\s*/)) if (s.trim()) supuestos.push(mayus(s.trim()));
  }
  let r = "";
  for (const f of resto.slice(0, 2)) {
    if (r && (r + " " + f).length > TOPE_RESUMEN) break;
    r = r ? r + " " + f : f;
  }
  if (r.length > TOPE_RESUMEN) r = r.slice(0, TOPE_RESUMEN - 1).trimEnd() + "…";
  return { resultado: r ? mayus(r) : null, supuestos };
}

/** El texto del último mensaje del turno (el resultado), si el worker ya lo escribió. */
export function textoFinal(pasos: readonly Paso[]): string | null {
  for (let i = pasos.length - 1; i >= 0; i--) {
    const d = pasos[i].detalle;
    if (d.clase === "texto" && d.final) return d.texto.t;
  }
  return null;
}

// ---- El chip de tests ---------------------------------------------------------------------------------------------

const CORREDORES = /(?:^|[\s;&|(])(?:npm\s+(?:run\s+)?test|pnpm\s+(?:run\s+)?test|yarn\s+test|node\s+(?:\S+\s+)*--test|pytest|py\.test|cargo\s+test|vitest|jest|go\s+test|bun\s+test|deno\s+test)\b/;

export type Tests = { ok: boolean; n: number | null; paso: Paso };

/** Cuántos tests pasaron según lo que imprimió el corredor (`# pass 9`, `22 pass`, `Tests: 5 passed`); el último que aparezca. */
export function cuantosTests(salida: string): number | null {
  let n: number | null = null;
  for (const re of [/^#\s*pass\s+(\d+)/gim, /\b(\d+)\s+(?:pass(?:ed|ing)?)\b/gi, /\bTests?:\s+(?:\d+\s+failed,\s+)?(\d+)\s+passed/gi]) {
    for (const m of salida.matchAll(re)) n = Number(m[1]);
    if (n !== null) return n;
  }
  return null;
}

/** El último paso que corrió un corredor de tests y ya terminó. */
export function testsDe(pasos: readonly Paso[]): Tests | null {
  for (let i = pasos.length - 1; i >= 0; i--) {
    const p = pasos[i];
    const d = p.detalle;
    if (d.clase !== "correr" || p.estado === "corriendo" || !CORREDORES.test(d.comando.t)) continue;
    const ok = p.estado === "ok" && (d.codigo === null || d.codigo === 0);
    return { ok, n: ok ? cuantosTests(d.salida?.t ?? "") : null, paso: p };
  }
  return null;
}

// ---- Archivos y chips ---------------------------------------------------------------------------------------------

export type Chip = { ruta: string; nombre: string; mas: number; menos: number };

export const chipsDe = (e: Encabezado): Chip[] => e.archivos.map((a) => ({ ruta: a.ruta, nombre: base(a.ruta), mas: a.mas, menos: a.menos }));

// ---- El diff ------------------------------------------------------------------------------------------------------

export type FilaDiff = { t: "+" | "-" | " " | "~"; a: number | null; b: number | null; x: string };

/** Por arriba de esto (celdas de la tabla) no se calcula el mínimo: todo lo viejo sale y todo lo nuevo entra. */
const TOPE_CELDAS = 4_000_000;

const lineas = (s: string) => {
  if (s === "") return [];
  const ls = s.split("\n");
  if (ls[ls.length - 1] === "") ls.pop();
  return ls;
};

/**
 * El diff unificado de un cambio: lo común (adelante y atrás) como contexto y, en medio, el mínimo de líneas que sacar y poner
 * (subsecuencia común más larga). `desde` es la línea donde empieza lo cambiado: sin él las filas van sin número.
 */
export function diffDe(c: Cambio): FilaDiff[] {
  const v = lineas(c.viejo.t);
  const n = lineas(c.nuevo.t);
  let i0 = 0;
  while (i0 < v.length && i0 < n.length && v[i0] === n[i0]) i0++;
  let fv = v.length;
  let fn = n.length;
  while (fv > i0 && fn > i0 && v[fv - 1] === n[fn - 1]) {
    fv--;
    fn--;
  }
  const num = (k: number) => (c.desde === null ? null : c.desde + k);
  const out: FilaDiff[] = [];
  for (let k = 0; k < i0; k++) out.push({ t: " ", a: num(k), b: num(k), x: v[k] });

  const mv = v.slice(i0, fv);
  const mn = n.slice(i0, fn);
  let a = i0;
  let b = i0;
  const saca = (x: string) => out.push({ t: "-", a: num(a++), b: null, x });
  const pone = (x: string) => out.push({ t: "+", a: null, b: num(b++), x });
  if (!mv.length || !mn.length || (mv.length + 1) * (mn.length + 1) > TOPE_CELDAS) {
    mv.forEach(saca);
    mn.forEach(pone);
  } else {
    const w = mn.length + 1;
    const L = new Uint32Array((mv.length + 1) * w);
    for (let i = mv.length - 1; i >= 0; i--)
      for (let j = mn.length - 1; j >= 0; j--) L[i * w + j] = mv[i] === mn[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    let i = 0;
    let j = 0;
    while (i < mv.length || j < mn.length) {
      if (i < mv.length && j < mn.length && mv[i] === mn[j]) {
        out.push({ t: " ", a: num(a++), b: num(b++), x: mv[i] });
        i++;
        j++;
      } else if (j >= mn.length || (i < mv.length && L[(i + 1) * w + j] >= L[i * w + j + 1])) saca(mv[i++]);
      else pone(mn[j++]);
    }
  }
  for (let k = fv; k < v.length; k++) out.push({ t: " ", a: num(a++), b: num(b++), x: v[k] });
  return out;
}

/** Un archivo nuevo o escrito entero: todo son líneas que entran. */
export const filasEscritas = (contenido: string): FilaDiff[] => lineas(contenido).map((x, i) => ({ t: "+" as const, a: null, b: i + 1, x }));

/** Lo leído, con su numeración desde `desde` (si todas las líneas traen el `cat -n` de Claude Code, se le quita). */
export function filasLeidas(texto: string, desde: number | null): FilaDiff[] {
  let ls = lineas(texto);
  const cat = ls.length > 0 && ls.every((l) => /^\s*\d+\s*[→\t]/.test(l) || l === "");
  if (cat) ls = ls.map((l) => l.replace(/^\s*\d+\s*[→\t]/, ""));
  return ls.map((x, i) => ({ t: " " as const, a: null, b: desde === null ? null : desde + i, x }));
}

/** La extensión de un archivo, para el resaltado ("src/a.ts" → "ts"). */
export const extension = (ruta: string): string => /\.([A-Za-z0-9]+)$/.exec(base(ruta))?.[1]?.toLowerCase() ?? "";

export const TIPOS: readonly TipoPaso[] = ["pensar", "leer", "buscar", "editar", "escribir", "correr", "delegar", "texto", "otro"];
