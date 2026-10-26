// Ajustes > Locales: modelos de Ollama sugeridos y si entran en la VRAM de esta máquina. Puro: sin red ni GPU. Los tamaños son lo que
// pesa la descarga según ollama.com/library (aproximados, por eso se muestran con «≈»); la memoria es la que dice `nvidia-smi` o
// sysfs (electron/ollama-entorno.ts). Bajar un modelo sólo lo descarga a disco: cargarlo es cosa de quien lo usa.

export type Sugerido = { modelo: string; bytes: number; para: "chico" | "codigo" | "general" | "grande" };

const GB = 1024 ** 3;

/** En orden de tamaño. El nombre es el de ollama.com/library (lo que va a `POST /api/pull`). */
export const SUGERIDOS: readonly Sugerido[] = [
  { modelo: "llama3.2:3b", bytes: 2.0 * GB, para: "chico" },
  { modelo: "qwen2.5-coder:7b", bytes: 4.7 * GB, para: "codigo" },
  { modelo: "qwen3:8b", bytes: 5.2 * GB, para: "general" },
  { modelo: "gemma3:12b", bytes: 8.1 * GB, para: "general" },
  { modelo: "qwen3:14b", bytes: 9.3 * GB, para: "general" },
  { modelo: "gpt-oss:20b", bytes: 14 * GB, para: "grande" },
  { modelo: "qwen3:32b", bytes: 20 * GB, para: "grande" },
];

export type Veredicto = "entra" | "justo" | "no_entra" | "sin_dato";

/**
 * ¿Entra en la VRAM? Los pesos tienen que caber con aire para el contexto: hasta el 75 % de la memoria es «entra», hasta el 100 % «justo»
 * (con poco contexto) y más es «no entra» entero (Ollama lo parte con la CPU y anda lento). Sin VRAM conocida, «sin dato»: nunca se afirma.
 */
export function cabe(vramMiB: number | null, bytes: number): Veredicto {
  if (vramMiB === null || !(vramMiB > 0)) return "sin_dato";
  const razon = bytes / (vramMiB * 1024 * 1024);
  return razon <= 0.75 ? "entra" : razon <= 1 ? "justo" : "no_entra";
}

/** El tamaño de una descarga con una cifra: 4,7 GB, o 640 MB si no llega al GB. */
export function tamanoCorto(bytes: number, coma: string = ","): string {
  const g = bytes / GB;
  const n = g >= 1 ? g : bytes / 1024 ** 2;
  const s = (g >= 10 || g < 1 ? Math.round(n) : Math.round(n * 10) / 10).toString().replace(".", coma);
  return `${s} ${g >= 1 ? "GB" : "MB"}`;
}

/** Los sugeridos que todavía no están instalados (`instalados`: nombres que dice `/api/tags`), sin repetir y en el mismo orden. */
export function sinInstalar(instalados: readonly string[]): Sugerido[] {
  const tiene = new Set(instalados);
  return SUGERIDOS.filter((s) => !tiene.has(s.modelo));
}

/** Los MiB de VRAM como GB redondeados para decir «12 GB». */
export function vramGb(vramMiB: number): number {
  return Math.round(vramMiB / 1024);
}
