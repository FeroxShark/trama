// Los modelos que agrega `~/.config/trama/modelos.json` (Gemini, Ollama, el líder por defecto): el main los lee y manda sólo lo que
// se muestra (ids y nombres; la url de un Ollama no sale del main). Se pide una vez, antes de pintar (src/main.tsx). Sin el archivo,
// sin puente o con una respuesta rara: nada cambia y la tabla es la de siempre.
import { main } from "../puente";
import { MODO } from "../modo";
import { LLAMA_FIJOS } from "./fixtures";
import type { ConfigModelos } from "../hilo/modelos";

/** Lo que mandó el main, validado: lo que no se entiende no entra. */
export function configValida(x: unknown): ConfigModelos | null {
  const o = x as { version?: unknown; gemini?: unknown; dsh?: unknown; opencode?: unknown; opencodeEfforts?: unknown; opencodePlan?: unknown; agyModelos?: unknown; locales?: unknown; llama?: unknown; lider?: unknown } | null;
  if (!o || typeof o !== "object" || o.version !== 1) return null;
  const locales = (Array.isArray(o.locales) ? o.locales : [])
    .filter((l): l is { id: string; nombre: string; modelo?: unknown } => !!l && typeof l.id === "string" && l.id.startsWith("ollama:") && typeof l.nombre === "string")
    .map((l) => ({ id: l.id, nombre: l.nombre, ...(typeof l.modelo === "string" && l.modelo ? { modelo: l.modelo } : {}) }));
  const llama = (Array.isArray(o.llama) ? o.llama : [])
    .filter((l): l is { id: string; nombre: string; empresa: string } => !!l && typeof l.id === "string" && typeof l.nombre === "string" && typeof l.empresa === "string")
    .map((l) => ({ id: l.id, nombre: l.nombre, empresa: l.empresa }));
  const opencode = (Array.isArray(o.opencode) ? o.opencode : []).filter((m): m is string => typeof m === "string" && /^[A-Za-z0-9][\w.-]*\/\S+$/.test(m));
  // Niveles de esfuerzo por modelo de opencode (`opencode/xxx` → ["low", …]); sólo los de modelos listados y con nombres sanos.
  const opencodeEfforts: Record<string, string[]> = {};
  if (o.opencodeEfforts && typeof o.opencodeEfforts === "object" && !Array.isArray(o.opencodeEfforts))
    for (const [m, v] of Object.entries(o.opencodeEfforts as Record<string, unknown>)) {
      const niveles = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^[A-Za-z][\w-]{0,23}$/.test(x)) : [];
      if (opencode.includes(m) && niveles.length) opencodeEfforts[m] = niveles;
    }
  // El plan de OpenCode Go sólo cuenta si es uno de los dos pagos; cualquier otra cosa es «apagado».
  const opencodePlan = o.opencodePlan === "go" || o.opencodePlan === "go-plus" ? o.opencodePlan : null;
  // Los modelos que ofrece el agy de esta cuenta (ids de pa); sin lista, el selector muestra los de siempre.
  const agyModelos = (Array.isArray(o.agyModelos) ? o.agyModelos : [])
    .filter((m): m is { id: string; nombre: string } => !!m && typeof m.id === "string" && /^(?:agy:)?[a-z0-9][\w.-]{0,80}$/i.test(m.id) && typeof m.nombre === "string")
    .map((m) => ({ id: m.id, nombre: m.nombre.slice(0, 80) }));
  const l = o.lider as { modelo?: unknown; effort?: unknown } | null;
  const lider = l && typeof l.modelo === "string" ? { modelo: l.modelo, effort: typeof l.effort === "string" ? l.effort : null } : null;
  return { gemini: o.gemini === true, ...(agyModelos.length ? { agyModelos } : {}), ...(o.dsh === true ? { dsh: true } : {}), ...(opencode.length ? { opencode } : {}), ...(Object.keys(opencodeEfforts).length ? { opencodeEfforts } : {}), ...(opencode.length && opencodePlan ? { opencodePlan } : {}), locales, llama, lider };
}

/** Pide la configuración al main; si tarda más de `tope` ms (el motor reconectando) se sigue sin ella. */
export async function pedirModelos(tope = 1500): Promise<ConfigModelos | null> {
  // Con fixtures (capturas, bench, navegador sin main) los locales son los de muestra: el archivo del usuario no entra.
  if (MODO.fixtures) {
    // `modelo` con `sin-cupo`: las cinco columnas a la vista (Google con modelos agotados, OpenCode gratis agotado) para ver el cupo de cada uno.
    const todas = MODO.captura === "modelo" && MODO.variante === "sin-cupo";
    return {
      gemini: (MODO.captura === "lider-comandos" && MODO.variante === "agy") || MODO.captura === "lider-cambio-motor" || todas,
      // `lider-cambio-motor`: todos los motores a la vista (el selector de una conversación que ya empezó muestra todas las columnas).
      ...(MODO.variante === "dsh-menu" || MODO.captura === "lider-cambio-motor" || todas ? { dsh: true } : {}),
      ...(MODO.captura === "lider-cambio-motor" || todas ? { opencode: ["opencode/big-pickle"] } : {}),
      locales: MODO.variante === "dsh-menu" || MODO.captura === "lider-cambio-motor" || todas ? [{ id: "ollama:qwen3-coder:30b", nombre: "Qwen3 Coder 30B", modelo: "qwen3-coder:30b" }] : [],
      llama: LLAMA_FIJOS,
      lider: null,
    };
  }
  const m = main?.modelos;
  if (!m) return null;
  const espera = new Promise<null>((ok) => setTimeout(() => ok(null), tope));
  return Promise.race([m.config().then(configValida, () => null), espera]);
}
