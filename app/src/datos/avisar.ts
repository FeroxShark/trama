// "Responder y avisar" del tablero nuevo (docs/estado/tablero-avisar.md): a qué líderes vivos se les puede avisar de una
// respuesta, y el mensaje corto que se les escribe. Puro y con extensión en los imports: lo prueba `node --test`
// (tests/avisar.test.ts). Nunca decide enviar: eso lo hace el botón que toca el usuario.
import { Dueno } from "./dueno.ts";
import type { Tocada } from "./pendientes.ts";
import type { Item } from "./tablero.ts";

/** Un líder vivo al que se le puede escribir: de la app o abierto en una terminal (el primer mensaje lo trae, como la caja). */
export type LiderAviso = {
  id: string;
  nombre: string;
  /** Su carpeta en la barra (el slug del proyecto). */
  carpeta: string;
  origen: "app" | "terminal";
  ocupado: boolean;
  actividad: number;
  maquina?: string;
};

/** El worker que dejó el item (`pa:<id>`, `pa:<id>:<n>` o `pa:<id>:p<n>`), o `null` si no lo dejó `pa`. */
export function workerDe(clave: string): string | null {
  const m = /^pa:([^:]+)/.exec(clave);
  return m ? m[1] : null;
}

/**
 * A quiénes se les puede avisar de la respuesta a este item, en orden: primero el líder que originó la DECISION (el jefe
 * del worker de su clave `pa:<id>`, si sigue vivo), después los de la carpeta del proyecto, el de actividad más reciente primero.
 * Cada máquina tiene sus líderes: un item de otra nunca se avisa a los de ésta. `carpetas`: nombre del registry → slug.
 * `jefeDe`: de un worker (por su id) al session_id de su líder.
 */
export function candidatos(
  item: Pick<Item, "proyecto" | "clave" | "maquina">,
  carpetas: Readonly<Record<string, string>>,
  lideres: readonly LiderAviso[],
  jefeDe: (worker: string) => string | null,
): LiderAviso[] {
  const suyos = lideres.filter((l) => l.maquina === item.maquina);
  const carpeta = item.maquina ? item.proyecto : (item.proyecto && Object.hasOwn(carpetas, item.proyecto) && carpetas[item.proyecto]) || null;
  const w = workerDe(item.clave);
  const jefe = w ? jefeDe(item.maquina ? `${item.maquina}:${w}` : w) : null;
  const origen = jefe ? suyos.find((l) => l.id === jefe) : undefined;
  const enCarpeta = carpeta ? suyos.filter((l) => l.carpeta === carpeta && l !== origen).sort((a, b) => b.actividad - a.actividad) : [];
  return origen ? [origen, ...enCarpeta] : enCarpeta;
}

/** El líder elegido si sigue entre los candidatos; si no, el primero (el que originó la pregunta o el más reciente). */
export const elegirAviso = (cands: readonly LiderAviso[], elegido?: string): LiderAviso | null => cands.find((l) => l.id === elegido) ?? cands[0] ?? null;

/**
 * El mensaje para el líder. Es una instrucción para Claude, no texto de la UI: va en español y en un solo lugar (como
 * `armarMensaje`). Corto: el item, lo que el usuario eligió y cómo cerrarlo; la respuesta ya quedó guardada en el item.
 */
export function armarAviso(proyecto: string, x: Tocada): string {
  // El número del item en SU tablero: el `dell:12` es de quien junta, el líder de allá conoce el 12.
  const num = String(x.pend.id).replace(/^.*:/, "");
  const donde = proyecto ? ` sobre ${proyecto}` : "";
  return [
    `${Dueno()} contestó en el tablero${donde}: #${num} ${x.pend.titulo} → ${x.dice}`,
    `Ya quedó guardada en el item (\`tablero ver ${num}\`). Cuando lo resuelvas, cerralo con \`tablero cerrar ${num}\`.`,
  ].join("\n");
}
