// La lógica de «Revisar con IA» (src/paneles/PanelContexto.tsx), sin React: agrupar los hallazgos por archivo, los totales, el nombre corto de
// cada archivo y los textos del antes y el después. Los tipos son los del main (electron/auditoria-contexto-texto.ts).
import type { ArchivoAuditado, Auditoria, Hallazgo, TipoHallazgo } from "../../electron/auditoria-contexto-texto";

/** Los cuatro tipos, en el orden en que se explican. */
export const TIPOS_HALLAZGO: readonly TipoHallazgo[] = ["duplicado", "contradiccion", "viejo", "largo"];

/** Los archivos que llevan el mismo nombre en cualquier proyecto: se distinguen por su carpeta. */
const NOMBRES_COMUNES = new Set(["claude.md", "agents.md", "gemini.md", "memory.md"]);

const partes = (ruta: string) => ruta.split(/[\\/]+/).filter(Boolean);

/**
 * El nombre corto de cada archivo, sin repetirse: el nombre del archivo y, si dos comparten nombre o es uno de los que están en todos los
 * proyectos (CLAUDE.md, AGENTS.md…), la carpeta que lo contiene. La ruta entera va en el tip.
 */
export function nombresCortos(rutas: readonly string[]): Map<string, string> {
  const cuenta = new Map<string, number>();
  for (const r of rutas) cuenta.set(partes(r).at(-1) ?? r, (cuenta.get(partes(r).at(-1) ?? r) ?? 0) + 1);
  const nombres = new Map<string, string>();
  for (const r of rutas) {
    const p = partes(r);
    const base = p.at(-1) ?? r;
    const repetido = (cuenta.get(base) ?? 0) > 1 || NOMBRES_COMUNES.has(base.toLowerCase());
    nombres.set(r, repetido && p.length > 1 ? `${p.at(-2)}/${base}` : base);
  }
  return nombres;
}

export type GrupoArchivo = {
  ruta: string;
  nombre: string;
  /** Los hallazgos del archivo: pendientes (los que más ahorran primero), luego los que cambiaron y al final los aplicados. */
  hallazgos: Hallazgo[];
  /** Tokens por mensaje que todavía se pueden ahorrar en este archivo (sólo los pendientes). */
  ahorroPosible: number;
  /** Los ids de los pendientes (lo que «Aplicar todos» de este archivo aplica). */
  pendientes: string[];
};

/** Dentro de un archivo: lo pendiente primero, después lo que cambió (pide una nueva revisión) y al final lo ya aplicado. */
const RANGO: Record<Hallazgo["estado"], number> = { pendiente: 0, invalido: 1, aplicado: 2 };

/** Los hallazgos por archivo: primero el archivo donde más se puede ahorrar; los que ya no ahorran nada (todo aplicado) al final, por nombre. */
export function agrupar(a: Pick<Auditoria, "hallazgos">): GrupoArchivo[] {
  const por = new Map<string, Hallazgo[]>();
  for (const h of a.hallazgos) por.set(h.archivo, [...(por.get(h.archivo) ?? []), h]);
  const nombres = nombresCortos([...por.keys()]);
  const grupos = [...por].map(([ruta, hs]): GrupoArchivo => {
    const pend = hs.filter((h) => h.estado === "pendiente");
    return {
      ruta,
      nombre: nombres.get(ruta) ?? ruta,
      hallazgos: [...hs].sort((x, y) => RANGO[x.estado] - RANGO[y.estado] || y.ahorro - x.ahorro),
      ahorroPosible: pend.reduce((n, h) => n + h.ahorro, 0),
      pendientes: pend.map((h) => h.id),
    };
  });
  return grupos.sort((x, y) => y.ahorroPosible - x.ahorroPosible || x.nombre.localeCompare(y.nombre));
}

export type TotalesAuditoria = {
  /** Tokens por mensaje que se ahorran aplicando todo lo pendiente. */
  posible: number;
  /** Los que ya se ahorraron con lo aplicado. */
  aplicado: number;
  pendientes: number;
  aplicados: number;
  invalidos: number;
  /** Cuántos hay de cada tipo (todos los estados). */
  porTipo: Record<TipoHallazgo, number>;
};

export function totales(a: Pick<Auditoria, "hallazgos">): TotalesAuditoria {
  const r: TotalesAuditoria = { posible: 0, aplicado: 0, pendientes: 0, aplicados: 0, invalidos: 0, porTipo: { duplicado: 0, contradiccion: 0, viejo: 0, largo: 0 } };
  for (const h of a.hallazgos) {
    r.porTipo[h.tipo] += 1;
    if (h.estado === "pendiente") {
      r.pendientes += 1;
      r.posible += h.ahorro;
    } else if (h.estado === "aplicado") {
      r.aplicados += 1;
      r.aplicado += h.ahorro;
    } else r.invalidos += 1;
  }
  return r;
}

/** Los ids de todo lo pendiente (opcionalmente sólo los de un archivo). */
export function pendientesDe(a: Pick<Auditoria, "hallazgos">, archivo?: string): string[] {
  return a.hallazgos.filter((h) => h.estado === "pendiente" && (archivo === undefined || h.archivo === archivo)).map((h) => h.id);
}

/** Un fragmento para mostrar: sin los saltos de línea del final y cortado a `max` caracteres (en un límite de palabra si se puede), con «…» si se cortó. */
export function recortar(texto: string, max = 360): string {
  const s = texto.replace(/\s+$/u, "");
  if (s.length <= max) return s;
  const corte = s.slice(0, max);
  const espacio = corte.lastIndexOf(" ");
  return `${(espacio > max * 0.6 ? corte.slice(0, espacio) : corte).replace(/\s+$/u, "")}…`;
}

/** La carpeta de la copia, corta: las dos últimas partes (`md-backup/2026-11-22-1314`); la ruta entera va en el tip. */
export function carpetaCorta(ruta: string): string {
  return partes(ruta).slice(-2).join("/");
}

/** Una revisión sigue en curso (el sondeo la vuelve a pedir) mientras el main no la marque lista o con error. */
export const enCurso = (a: Pick<Auditoria, "estado"> | null | undefined): boolean => a?.estado === "corriendo";

/** Lo que se muestra de una auditoría que no está en curso: lista con hallazgos, lista sin nada que tocar, o con error. */
export type VistaAuditoria = "sin-revisar" | "corriendo" | "error" | "sin-hallazgos" | "hallazgos";
export function vistaDe(a: Auditoria | null | undefined): VistaAuditoria {
  if (!a) return "sin-revisar";
  if (a.estado === "corriendo") return "corriendo";
  if (a.estado === "error") return "error";
  return a.hallazgos.length ? "hallazgos" : "sin-hallazgos";
}

/** Los archivos que entraron en la revisión y lo que pesan, para la línea «Revisó N archivos (X tokens)». */
export function resumenArchivos(archivos: readonly ArchivoAuditado[]): { n: number; tokens: number } {
  return { n: archivos.length, tokens: archivos.reduce((s, f) => s + f.tokens, 0) };
}
