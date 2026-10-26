// El modelo con que Handy transcribe el dictado: lo que se elige en Ajustes y lo que se ofrece. Puro (sin Node ni
// electron): lo importan el main (dictado.ts, nucleo.ts) y la ventana (Ajustes), y lo prueba tests/dictado.test.ts.
// La recomendación de la casa es Whisper Large v3 Turbo: en el banco de asistente-voz (pruebas/stt/RESULTADOS.md) da
// 4,4 % de WER contra 4,0 % de Large v3, 2,3 veces más rápido y con la mitad de memoria de video.

/** Los ids de `handy --list-models` (los que se le pasan a `--model`). */
export const MODELO_TURBO = "handy-computer/whisper-large-v3-turbo-gguf/whisper-large-v3-turbo-Q8_0.gguf";
export const MODELO_LARGE_V3 = "handy-computer/whisper-large-v3-gguf/whisper-large-v3-Q5_K_M.gguf";

/** Los que se ofrecen siempre, bajados o no, en este orden. */
const FIJOS = [
  { id: MODELO_TURBO, nombre: "Whisper Large v3 Turbo" },
  { id: MODELO_LARGE_V3, nombre: "Whisper Large v3" },
];

export type ModeloDictado = { id: string; nombre: string; bajado: boolean };

/** Lo que muestra Ajustes. `motor`: con qué se transcribe en la máquina del motor (null: con nada; `windows` no usa modelo). */
export type ModelosDictado = { version: 1; elegido: string; modelos: ModeloDictado[]; motor: "handy" | "handy-windows" | "windows" | null };

/** Un id que se le puede pasar a `--model`: sin espacios, sin empezar con `-` (no es una opción) y corto. */
export const esModeloDictado = (x: unknown): x is string => typeof x === "string" && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(x);

/** Los modelos que dice `handy --list-models --json`; lo que no se entiende queda afuera. */
export function modelosDeHandy(stdout: string): ModeloDictado[] {
  let j: unknown;
  try {
    j = JSON.parse(stdout.trim());
  } catch {
    return [];
  }
  if (!Array.isArray(j)) return [];
  const salida: ModeloDictado[] = [];
  for (const m of j as Record<string, unknown>[]) {
    if (!m || !esModeloDictado(m.id)) continue;
    salida.push({ id: m.id, nombre: typeof m.name === "string" && m.name ? m.name : m.id, bajado: m.is_downloaded === true });
  }
  return salida;
}

/**
 * Lo que se ofrece: Turbo y Large v3 siempre (con si están bajados, si Handy lo dijo), después los demás que Handy ya
 * tiene bajados (los que corre sin descargar nada) por nombre, y el elegido si no estaba en ninguno.
 */
export function opcionesDictado(handy: ModeloDictado[] | null, elegido: string): ModeloDictado[] {
  const de = new Map((handy ?? []).map((m) => [m.id, m]));
  const fijos = FIJOS.map((f) => ({ ...f, bajado: de.get(f.id)?.bajado ?? false }));
  const otros = (handy ?? []).filter((m) => m.bajado && !FIJOS.some((f) => f.id === m.id)).sort((a, b) => a.nombre.localeCompare(b.nombre));
  const todos = [...fijos, ...otros];
  if (!todos.some((m) => m.id === elegido)) todos.push({ id: elegido, nombre: elegido, bajado: de.get(elegido)?.bajado ?? false });
  return todos;
}
