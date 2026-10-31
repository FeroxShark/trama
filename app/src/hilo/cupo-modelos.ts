// Qué cupo tiene cada modelo y cada proveedor del selector de modelo, sin React. Sale del mismo `Uso` que la tarjeta de cupos de la
// barra y usa sus mismas funciones (src/barra/cuposVista.ts): un modelo se mira en la ventana o el grupo que le cobra (`ubicacionDe`),
// y un proveedor en su suscripción. Lo prueba tests/cupo-modelos.test.ts.
import type { Uso, VentanaCupo } from "../datos/contrato.ts";
import { resumenGrupo, resumenSusc, resumenVentanas, type ResumenCupo } from "../barra/cuposVista.ts";

/** Desde cuánto uso el modelo (o el proveedor) se dice «poco cupo»: queda menos de este % libre. */
export const POCO_LIBRE = 15;

/**
 * Lo que el selector dibuja de un modelo o de un proveedor. `sin`: no se puede usar ahora (cupo lleno, o marcado sin cupo por un 429);
 * `vuelve`: cuándo vuelve (epoch s, `null`: no se sabe); `poco`: queda menos de `POCO_LIBRE` % libre y no está sin cupo;
 * `libre`: el % libre de lo más usado que rige (`null`: sin dato).
 */
export type EstadoCupo = { sin: boolean; vuelve: number | null; poco: boolean; libre: number | null };

/** Dónde cobra su cupo un modelo: la suscripción (`claude` es la de Claude, con sus ventanas de 5 h y semana) y, si la tiene, el grupo. */
export type Ubicacion = { suscripcion: string; grupo?: string };

/**
 * El grupo de Google que cobra un modelo de agy, por el nombre (el mismo criterio que `idGrupo` de electron/cli/reparto.ts):
 * Argon tiene el suyo, Claude y GPT van juntos, y lo demás (Gemini Flash) es el grupo `gemini`.
 */
const grupoGoogle = (id: string): string => {
  if (id.includes("argon")) return "gemini-4-argon";
  if (id.includes("claude") || id.includes("gpt")) return "claude-gpt";
  return "gemini";
};

/** El lugar del `Uso` que cobra un modelo del selector; `null`: no tiene cupo medido (locales, DeepSeek Harness, los de pago de OpenCode). */
export function ubicacionDe(modelo: string): Ubicacion | null {
  if (modelo.startsWith("claude-")) return { suscripcion: "claude" };
  if (modelo.startsWith("gemini-") || modelo.startsWith("agy:")) return { suscripcion: "google", grupo: grupoGoogle(modelo) };
  if (/^opencode:opencode\/(?:.+-free|big-pickle)$/.test(modelo)) return { suscripcion: "opencode", grupo: "opencode-free" };
  // Los de Go tienen cupo por modelo: su grupo es su propio id, en minúsculas (como `goAgotadosHasta`).
  if (/^opencode:opencode-go\//.test(modelo)) return { suscripcion: "opencode", grupo: modelo.toLowerCase() };
  return null;
}

/** Las dos ventanas de Claude (5 h y semana) en la forma de las de una suscripción; `null` si el `Uso` es un error. */
function ventanasClaude(uso: Uso): VentanaCupo[] | null {
  if (!("five_hour" in uso)) return null;
  const de = (id: string, w: { pct: number; resets_at: number | null } | null): VentanaCupo[] => (w ? [{ id, pct: w.pct, vuelve: w.resets_at }] : []);
  return [...de("5h", uso.five_hour), ...de("7d", uso.seven_day)];
}

/** El resumen de lo que cobra un lugar, con las mismas funciones que la tarjeta; `null`: el `Uso` no trae ese lugar. */
function resumenDe(uso: Uso | null | undefined, lugar: Ubicacion, ahoraS: number): ResumenCupo | null {
  if (!uso) return null;
  if (lugar.suscripcion === "claude") {
    const ventanas = ventanasClaude(uso);
    return ventanas ? resumenVentanas(ventanas, undefined, ahoraS) : null;
  }
  const suscripciones = "suscripciones" in uso ? uso.suscripciones : undefined;
  const susc = suscripciones?.find((s) => s.id === lugar.suscripcion);
  if (!susc) return null;
  if (!lugar.grupo) return resumenVentanas(susc.ventanas ?? [], susc.agotado, ahoraS);
  const grupo = susc.grupos?.find((g) => g.id === lugar.grupo);
  return grupo ? resumenGrupo(grupo, ahoraS) : null;
}

/** Lo que el selector muestra de un resumen. `null` si no hay dato que mostrar (sin ventanas medidas, o sólo pedidos contados). */
function estadoDe(r: ResumenCupo): EstadoCupo | null {
  if (r.estado === "sin") return null;
  const sin = r.estado === "lleno" || r.estado === "marcado";
  const libre = r.pct === null ? null : 100 - r.pct;
  return { sin, vuelve: r.vuelve, poco: !sin && libre !== null && libre < POCO_LIBRE, libre };
}

/** El cupo de un modelo del selector, o `null` si el dato no dice nada de él. */
export function estadoCupoModelo(modelo: string, uso: Uso | null | undefined, ahoraS = Date.now() / 1000): EstadoCupo | null {
  const lugar = ubicacionDe(modelo);
  const r = lugar ? resumenDe(uso, lugar, ahoraS) : null;
  return r ? estadoDe(r) : null;
}

/** El cupo de cada modelo de `ids` que el dato dice algo de ellos (los que no están en el mapa no tienen nada que marcar). */
export function estadosCupoModelos(ids: readonly string[], uso: Uso | null | undefined, ahoraS = Date.now() / 1000): Map<string, EstadoCupo> {
  const out = new Map<string, EstadoCupo>();
  for (const id of ids) {
    const e = estadoCupoModelo(id, uso, ahoraS);
    if (e) out.set(id, e);
  }
  return out;
}

/**
 * El cupo de cada proveedor del selector (su columna, la `empresa`) que tiene su suscripción entera: Anthropic (las ventanas de Claude)
 * y Google (sus grupos). Sin entrada: OpenCode mezcla gratis y de pago, DeepSeek Harness y lo local no se miden por proveedor.
 * `sin` sólo cuando TODOS los grupos de Google están sin cupo; si sólo algunos, el proveedor no se marca (cada modelo lleva lo suyo).
 */
export function estadosCupoProveedores(uso: Uso | null | undefined, ahoraS = Date.now() / 1000): Map<string, EstadoCupo> {
  const out = new Map<string, EstadoCupo>();
  const anthropic = resumenDe(uso, { suscripcion: "claude" }, ahoraS);
  const e = anthropic ? estadoDe(anthropic) : null;
  if (e) out.set("anthropic", e);
  const suscripciones = uso && "suscripciones" in uso ? uso.suscripciones : undefined;
  const google = suscripciones?.find((s) => s.id === "google");
  if (!google) return out;
  const r = resumenSusc(google, ahoraS);
  if (r.nivel === "sin") return out;
  if (r.nivel === "lleno") return out.set("google", { sin: true, vuelve: r.vuelve, poco: false, libre: 0 });
  // Algún grupo sigue andando: el proveedor dice poco cupo si el que queda andando está por debajo del tope.
  const vivos = (google.grupos ?? []).map((g) => estadoDe(resumenGrupo(g, ahoraS))).filter((x): x is EstadoCupo => x !== null && !x.sin);
  if (!vivos.length) return out;
  const libres = vivos.map((x) => x.libre).filter((x): x is number => x !== null);
  const libre = libres.length ? Math.min(...libres) : null;
  return out.set("google", { sin: false, vuelve: null, poco: vivos.some((x) => x.poco), libre });
}
