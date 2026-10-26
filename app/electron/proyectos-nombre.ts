// Las reglas del nombre para mostrar de un proyecto (`titulo` en el registry, `pa --renombrar`). Puro y sin imports: lo usan el main
// (proyectos-alias.ts, que escribe el registry) y la pantalla de Ajustes (que valida mientras se escribe). `pa` tiene las mismas
// reglas en bash (motor/bin/pa, nombre_invalido): si cambia una, cambia la otra (tests/proyectos-alias.test.ts las cruza).

export const NOMBRE_MAX = 40;

/** Un proyecto del registry tal como cuenta para saber si un nombre ya está usado. */
export type NombreUsado = { nombre: string; slug: string; ruta: string; /** `titulo` y alias */ otros: string[] };

export type MotivoNombre = "vacio" | "largo" | "guion" | "control" | "repetido";
export type ResultadoNombre = { ok: true; valor: string } | { ok: false; motivo: MotivoNombre; con?: string };

/**
 * ¿Sirve `crudo` como nombre para mostrar del proyecto de `propia` (su ruta real)? Sin blancos a los costados; hasta 40 caracteres;
 * sin `-` adelante (a `pa` llegaría como una opción); sin saltos de línea ni caracteres de control; y que ningún OTRO proyecto
 * (otra carpeta) lo tenga ya como nombre, slug, nombre para mostrar o alias, sin distinguir mayúsculas.
 */
export function validarNombre(crudo: string, propia: string, proyectos: readonly NombreUsado[]): ResultadoNombre {
  const n = crudo.trim();
  if (!n) return { ok: false, motivo: "vacio" };
  if ([...n].length > NOMBRE_MAX) return { ok: false, motivo: "largo" };
  if (n.startsWith("-")) return { ok: false, motivo: "guion" };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(n)) return { ok: false, motivo: "control" };
  const q = n.toLowerCase();
  for (const p of proyectos) {
    if (p.ruta === propia) continue;
    if ([p.nombre, p.slug, ...p.otros].some((x) => x.toLowerCase() === q)) return { ok: false, motivo: "repetido", con: p.nombre };
  }
  return { ok: true, valor: n };
}

/** El nombre que se ve de un proyecto: el nombre para mostrar si tiene, si no el de siempre. */
export const nombreParaMostrar = (nombre: string, titulo: string | null | undefined): string => (titulo && titulo.trim() ? titulo.trim() : nombre);

/** Lo mínimo de un proyecto para saber cómo se ve. */
export type ConTitulo = { nombre: string; slug: string; titulo: string | null };

/** Cada nombre con que se llama a un proyecto (el del registry y su slug, sin distinguir mayúsculas) → su nombre para mostrar; sólo los que tienen uno. */
export function mapaNombres(proyectos: readonly ConTitulo[]): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const p of proyectos) if (p.titulo && p.titulo.trim()) for (const k of [p.nombre.toLowerCase(), p.slug.toLowerCase()]) mapa.set(k, p.titulo.trim());
  return mapa;
}

/** Cómo se ve el proyecto que se llama `x` (nombre del registry o slug): su nombre para mostrar si tiene; si no, `x` tal cual. */
export const nombreVisible = (proyectos: readonly ConTitulo[], x: string): string => mapaNombres(proyectos).get(x.toLowerCase()) ?? x;
