// Los modelos que agrega `~/.config/trama/modelos.json` (Gemini, Ollama, el líder por defecto): el main los lee y manda sólo lo que
// se muestra (ids y nombres; la url de un Ollama no sale del main). Se pide una vez, antes de pintar (src/main.tsx). Sin el archivo,
// sin puente o con una respuesta rara: nada cambia y la tabla es la de siempre.
import { main } from "../puente";
import { MODO } from "../modo";
import { LLAMA_FIJOS } from "./fixtures";
import type { ConfigModelos } from "../hilo/modelos";

/** Lo que mandó el main, validado: lo que no se entiende no entra. */
export function configValida(x: unknown): ConfigModelos | null {
  const o = x as { version?: unknown; gemini?: unknown; dsh?: unknown; locales?: unknown; llama?: unknown; lider?: unknown } | null;
  if (!o || typeof o !== "object" || o.version !== 1) return null;
  const locales = (Array.isArray(o.locales) ? o.locales : [])
    .filter((l): l is { id: string; nombre: string; modelo?: unknown } => !!l && typeof l.id === "string" && l.id.startsWith("ollama:") && typeof l.nombre === "string")
    .map((l) => ({ id: l.id, nombre: l.nombre, ...(typeof l.modelo === "string" && l.modelo ? { modelo: l.modelo } : {}) }));
  const llama = (Array.isArray(o.llama) ? o.llama : [])
    .filter((l): l is { id: string; nombre: string; empresa: string } => !!l && typeof l.id === "string" && typeof l.nombre === "string" && typeof l.empresa === "string")
    .map((l) => ({ id: l.id, nombre: l.nombre, empresa: l.empresa }));
  const l = o.lider as { modelo?: unknown; effort?: unknown } | null;
  const lider = l && typeof l.modelo === "string" ? { modelo: l.modelo, effort: typeof l.effort === "string" ? l.effort : null } : null;
  return { gemini: o.gemini === true, ...(o.dsh === true ? { dsh: true } : {}), locales, llama, lider };
}

/** Pide la configuración al main; si tarda más de `tope` ms (el motor reconectando) se sigue sin ella. */
export async function pedirModelos(tope = 1500): Promise<ConfigModelos | null> {
  // Con fixtures (capturas, bench, navegador sin main) los locales son los de muestra: el archivo del usuario no entra.
  if (MODO.fixtures) return {
      gemini: MODO.captura === "lider-comandos" && MODO.variante === "agy",
      ...(MODO.variante === "dsh-menu" ? { dsh: true } : {}),
      locales: MODO.variante === "dsh-menu" ? [{ id: "ollama:qwen3-coder:30b", nombre: "Qwen3 Coder 30B", modelo: "qwen3-coder:30b" }] : [],
      llama: LLAMA_FIJOS,
      lider: null,
    };
  const m = main?.modelos;
  if (!m) return null;
  const espera = new Promise<null>((ok) => setTimeout(() => ok(null), tope));
  return Promise.race([m.config().then(configValida, () => null), espera]);
}
