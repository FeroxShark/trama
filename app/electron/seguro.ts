// "Integrar solo lo seguro" (B22): qué rama se puede integrar sin preguntarle a
// nadie. Sin imports: lo prueba tests/seguro.test.ts. El motor que lo corre está
// en autointegrar.ts.

/** Lo que se mira de una fila de `pa --hilos --json`. */
export type HiloSeguro = {
  id: string;
  proyecto: string;
  estado: string;
  inicio: number;
  rama: string | null;
  commits: number | null;
  decision_nada: boolean | null;
  en_cola?: boolean;
  jefe_id?: string | null;
  /** Si algún día `pa` lo manda: el código de salida del worker. */
  rc?: number | null;
};

const VIVO = new Set(["trabajando", "colgado"]);
/** Con estos estados la rama ya no está pendiente. */
export const RESUELTO = new Set(["integrado", "descartado", "revertido", "archivado"]);

/** El worker sigue (o espera puesto): su rama no se toca. */
export const vivo = (h: Pick<HiloSeguro, "estado" | "en_cola">) => VIVO.has(h.estado) || !!h.en_cola;

/**
 * Una fila por rama, la de la corrida más nueva: un `--seguir` o un
 * `--actualizar` trabaja sobre la rama de la corrida que continúa, y mientras
 * corre la vieja sigue diciendo "listo".
 */
export function ultimasPorRama<H extends HiloSeguro>(hilos: H[]): Map<string, H> {
  const m = new Map<string, H>();
  for (const h of hilos) {
    if (!h.rama) continue;
    const otro = m.get(h.rama);
    if (!otro || h.inicio > otro.inicio) m.set(h.rama, h);
  }
  return m;
}

export type Contexto = {
  /** El proyecto (la carpeta de `pa --hilos`) tiene `tests` en el registry. */
  tests: (proyecto: string) => boolean;
  /** El líder que la lanzó sigue vivo (su rama es suya: la integra él). */
  liderVivo: (sid: string) => boolean;
};

/**
 * Por qué una rama NO se integra sola, en pocas palabras (`null`: es segura). Es la fuente de `esSeguro`: un solo lugar para la
 * regla y para decírsela al líder (electron/autointegrar.ts, `integracionDe`).
 */
export function motivoNoSeguro(h: HiloSeguro, ultima: HiloSeguro | undefined, ctx: Contexto): string | null {
  if (!h.rama) return "no tiene rama";
  if (ultima && ultima.id !== h.id) return "su rama tiene una corrida más nueva";
  if (h.estado !== "listo" && h.estado !== "decision") return "no terminó bien";
  if (h.decision_nada !== true) return "pide una decisión";
  if (h.rc != null && h.rc !== 0) return `salió con código ${h.rc}`;
  if (!((h.commits ?? 0) > 0)) return "no tiene commits";
  if (vivo(h)) return "sigue corriendo";
  if (!ctx.tests(h.proyecto)) return "el proyecto no tiene tests registrados";
  if (h.jefe_id && ctx.liderVivo(h.jefe_id)) return "la integra el líder que la lanzó";
  return null;
}

/**
 * Seguro = terminó bien y no pide nada (listo o decision con "DECISION: nada"),
 * rc 0 si se sabe, con commits, el worker ya no corre, el proyecto tiene `tests`
 * (`--integrar --tests` es la red) y no lo lanzó un líder que siga vivo. Se
 * mira la última corrida de su rama (`ultima`): si es otra, tiene que ser ella.
 */
export const esSeguro = (h: HiloSeguro, ultima: HiloSeguro | undefined, ctx: Contexto): boolean => motivoNoSeguro(h, ultima, ctx) === null;

/** Las ramas que se pueden integrar solas, en orden de llegada (lo más viejo primero). */
export function seguras<H extends HiloSeguro>(hilos: H[], ctx: Contexto): H[] {
  const ultimas = ultimasPorRama(hilos);
  return [...ultimas.values()]
    .filter((h) => !RESUELTO.has(h.estado) && esSeguro(h, ultimas.get(h.rama!), ctx))
    .sort((a, b) => a.inicio - b.inicio);
}

/** El id de la corrida que lanzó `pa … --async` ("… (id: 20261003-…, log: …)"); `null` si no lo dijo. */
export function idLanzado(salida: string): string | null {
  return salida.match(/\(id: (\d{8}-\d{6}-\d+)[,)]/)?.[1] ?? null;
}

/** Con este código `pa --integrar` avisa de conflictos con main (propone `--actualizar`). */
export const RC_CONFLICTO = 80;
