// La nota de una tarjeta de cupo (barra, src/barra/CuposRiel.tsx), sin React: cuándo vuelve su ventana. Si la fuente no trae la hora,
// la nota dice el nombre de la ventana traducido (la tarjeta chica; la grande ya lo lleva en el título) o "sin hora de vuelta".
// Nunca queda vacía. Puro: lo prueba `tests/cupos-nota.test.ts`.
import { t } from "../i18n/index.ts";
import { formatearFaltaCorto, type Unidades } from "./usoFila.ts";

/** Qué va en la nota: la hora de vuelta (el reloj la pinta), el nombre de la ventana o el texto «sin hora de vuelta». */
export type Nota = { tipo: "vuelve" } | { tipo: "ventana"; texto: string } | { tipo: "sinHora" };

/** `hasta`: cuándo vuelve la ventana (epoch s; 0: la fuente no lo dio). `ventana`: su nombre ya traducido ("semana"; "" si no tiene). */
export function notaDeCelda(p: { chica: boolean; hasta: number; ventana: string }): Nota {
  if (p.hasta > 0) return { tipo: "vuelve" };
  if (p.chica && p.ventana) return { tipo: "ventana", texto: p.ventana };
  return { tipo: "sinHora" };
}

/** Cómo se llama una ventana en la tarjeta ("5 h", "semana"); una desconocida, su id tal cual. */
export function ventanaCorta(id: string): string {
  if (id === "5h") return t("cupos.w5h");
  if (id === "7d" || id === "sem") return t("cupos.wSem");
  if (id === "1m") return t("cupos.w1m");
  return id;
}

/** "vuelve en 1 d 17 h" (o "vuelve en 3 h58"): lo que falta para `hasta`, con el mismo formato en todas las tarjetas. `en`: cuándo repintar. */
export function textoVuelve(hasta: number, ahoraS: number, u: Unidades): { texto: string; en: number } {
  const f = formatearFaltaCorto(hasta - ahoraS, u);
  return { texto: t("cupos.vuelveEn", { falta: f.texto }), en: f.en };
}
