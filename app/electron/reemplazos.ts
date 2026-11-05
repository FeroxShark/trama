// Los proyectos retirados del registry (`estado: retirado`) y por quién fueron reemplazados (`reemplazado_por`). Puro y sin imports:
// lo usan el main (registro.ts, statusline.ts) y la barra (arbol.ts). Lo prueban tests/reemplazos.test.ts y tests/registro.test.ts.

/** Lo mínimo de un proyecto para saber si está retirado y quién lo reemplaza (`reemplazadoPor` ya es el slug del que lo reemplaza). */
export type Reemplazable = { slug: string; estado: string | null; reemplazadoPor: string | null };

/** ¿Está retirado? No se infiere, no se ofrece para un líder nuevo y no tiene carpeta propia en el riel (si lo reemplaza otro). */
export const esRetirado = (p: { estado?: string | null }): boolean => p.estado === "retirado";

/**
 * De cada proyecto retirado con reemplazo al slug donde se ve: su `reemplazadoPor`, y si ése también está retirado y tiene reemplazo, el
 * que sigue (un ciclo corta donde se cierra). Un retirado sin reemplazo, o cuyo reemplazo no está en la lista, no entra: se ve en su
 * carpeta de siempre y nada se pierde de vista.
 */
export function mapaReemplazos(ps: readonly Reemplazable[]): Map<string, string> {
  const por = new Map(ps.map((p) => [p.slug, p]));
  const sale = new Map<string, string>();
  for (const p of ps) {
    if (!esRetirado(p) || !p.reemplazadoPor || p.reemplazadoPor === p.slug || !por.has(p.reemplazadoPor)) continue;
    const visto = new Set([p.slug]);
    let fin = p.reemplazadoPor;
    let ciclo = false;
    for (;;) {
      if (visto.has(fin)) {
        ciclo = true;
        break;
      }
      visto.add(fin);
      const q = por.get(fin)!;
      const sig = esRetirado(q) ? q.reemplazadoPor : null;
      if (!sig || !por.has(sig)) break;
      fin = sig;
    }
    if (!ciclo) sale.set(p.slug, fin);
  }
  return sale;
}

/** El slug donde se ve `slug` con los reemplazos de `mapa` (lo que no está en él queda igual). */
export const dondeSeVe = (slug: string, mapa: ReadonlyMap<string, string> | undefined): string => mapa?.get(slug) ?? slug;
