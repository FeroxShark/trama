// Qué muestra la fila de una suscripción en la cabecera, sin React: en qué columna cae cada ventana
// y cuál grupo manda cuando una suscripción trae varios (la fila plegada muestra el más usado).
// Genérico: no conoce a ningún proveedor; lo prueba `tests/cupos-vista.test.ts`.
import type { GrupoCupo, VentanaCupo } from "../datos/contrato";

/** La fila tiene dos columnas: 5 h y semana (`7d`). Una ventana con otro id ocupa el lugar que quede. */
export function columnas(ventanas: VentanaCupo[]): [VentanaCupo | null, VentanaCupo | null] {
  const cinco = ventanas.find((v) => v.id === "5h") ?? null;
  const siete = ventanas.find((v) => v.id === "7d") ?? null;
  const otras = ventanas.filter((v) => v !== cinco && v !== siete);
  return [cinco ?? otras.shift() ?? null, siete ?? otras.shift() ?? null];
}

/** Lo más lleno de un grupo (`-1`: ninguna ventana con dato). */
export const usoMaximo = (g: GrupoCupo): number => g.ventanas.reduce((m, v) => (v.pct !== null && v.pct > m ? v.pct : m), -1);

/** El grupo más usado; con empate (o sin ningún dato) el primero, el orden del reparto. */
export function masUsado(grupos: GrupoCupo[]): GrupoCupo {
  return grupos.reduce((a, g) => (usoMaximo(g) > usoMaximo(a) ? g : a));
}
