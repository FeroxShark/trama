// El cupo libre de un modelo del debate, para ordenar quién habla primero y quién concluye (el de más cupo). Lo dice la última lectura de
// `reparto --cupos` (electron/cupos.ts). Sin Electron ni disco: lo prueba tests/debate.test.ts con lecturas armadas a mano.
import type { CuposLeidos, SuscripcionCupo, VentanaCupo } from "./cupos.ts";
import { suscripcionDeModelo } from "./cierre-cupo.ts";

/** El libre (0..100) de una suscripción: lo que deja la ventana más gastada; agotada, 0; sin ninguna ventana con dato, `null`. */
function libreDe(s: SuscripcionCupo, ahoraS: number): number | null {
  if (s.agotado && s.agotado > ahoraS) return 0;
  const ventanas: VentanaCupo[] = [...(s.ventanas ?? []), ...(s.grupos ?? []).flatMap((g) => (g.agotado && g.agotado > ahoraS ? [{ id: g.id, pct: 100, vuelve: null }] : g.ventanas))];
  const usados = ventanas.filter((v) => !v.deshabilitada && v.pct !== null).map((v) => v.pct as number);
  return usados.length ? 100 - Math.max(...usados) : null;
}

/**
 * Cuánto cupo libre tiene el modelo (más = mejor): el de su suscripción (con varias cuentas, la mejor). `null`: no se sabe (OpenCode,
 * Ollama y lo demás no tienen cupo que se acabe, o todavía no hay lectura).
 */
export function cupoLibreDeModelo(modelo: string, cupos: CuposLeidos | null, ahoraS = Math.floor(Date.now() / 1000)): number | null {
  const prov = suscripcionDeModelo(modelo);
  if (!prov || !cupos) return null;
  const libres: number[] = [];
  for (const s of cupos.suscripciones) {
    if ((s.proveedor ?? s.id) !== prov) continue;
    const l = libreDe(s, ahoraS);
    if (l !== null) libres.push(l);
  }
  if (!libres.length && prov === "claude" && cupos.claude) {
    // Una ventana sin dato (`null`) no cuenta: manda la conocida.
    const usados = [cupos.claude.cincoH, cupos.claude.sieteD].filter((v): v is number => v !== null);
    if (usados.length) libres.push(100 - Math.max(...usados));
  }
  return libres.length ? Math.max(...libres) : null;
}
