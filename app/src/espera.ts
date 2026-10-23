// "Te espera" en el renderer: quiénes esperan y a cuáles se avisa. Que un líder espere lo decide el main
// (electron/espera.ts; llega en `Lider.espera`); acá sólo se decide cuándo molestar (la notificación) y el
// ajuste que la apaga. Sin React ni DOM a la fuerza: lo prueba `node --test` (tests/espera-cliente.test.ts).
import type { Lider } from "./datos/contrato";

const q = typeof location === "undefined" ? null : new URLSearchParams(location.search);
/** Lo pone el main en la query (preferencias.json o `HILOS_AVISAR`); default, prendido. */
let prendido = q?.get("avisar") !== "0";
const oyentes = new Set<() => void>();

export const avisarEspera = () => prendido;

export function cambiarAvisarEspera(si: boolean) {
  if (si === prendido) return;
  prendido = si;
  for (const f of oyentes) f();
}

export function alCambiarAvisarEspera(f: () => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

/** Los que esperan al usuario, en el orden de la lista. */
export const esperan = (ls: readonly Lider[]): Lider[] => ls.filter((l) => l.espera && l.vivo && !l.caido);

/**
 * A cuáles avisar con una notificación ahora: una por líder y por turno (`ya` guarda el `desde` del último aviso de cada
 * uno), sólo con el ajuste prendido y la ventana sin el foco. Lo que ya esperaba al abrir trama (`primera`) y lo que
 * apareció con la ventana a la vista no avisa: El usuario lo vio. `ya` se pone al día siempre, y olvida a los que dejaron de esperar.
 */
export function porAvisar(ls: readonly Lider[], ya: Map<string, number>, o: { avisar: boolean; enfocada: boolean; primera: boolean }): Lider[] {
  const salen: Lider[] = [];
  const siguen = new Set<string>();
  for (const l of esperan(ls)) {
    siguen.add(l.id);
    const desde = l.espera!.desde;
    if (ya.get(l.id) === desde) continue;
    ya.set(l.id, desde);
    if (o.avisar && !o.enfocada && !o.primera) salen.push(l);
  }
  for (const id of [...ya.keys()]) if (!siguen.has(id)) ya.delete(id);
  return salen;
}
