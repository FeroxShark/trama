// El uso gratis de OpenCode (`provider.free-limit`, 429, FreeUsageLimitError) es UNO solo para todos sus modelos gratis: cuando se acaba para
// uno, se acabó para todos (los de otro proveedor de opencode, con tu clave, no se tocan). Se anota en el mismo `agotado.json` que
// usan los workers (`reparto --agotar`, motor/bin/reparto → leer_agotados): el grupo `opencode-free`, con `{ "hasta": ISO }`. Así
// `reparto` no ofrece ningún modelo gratis de OpenCode hasta que vuelve, y el selector de modelos los rotula «sin cupo gratis».
// Sin hora de vuelta conocida (OpenCode no la dice) la marca vence a la hora (`VENCE_SIN_HORA_MS`): se vuelve a intentar.
// OpenCode Go es otra cosa: su cupo es POR MODELO (pedidos cada 5 h), así que un 429 de un modelo de Go marca sólo a ese modelo (el grupo es su
// id, `opencode:opencode-go/<modelo>`, vence a las 5 h) y no toca `opencode-free`, que sigue valiendo sólo para los gratis.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { esModeloGo, VENCE_GO_MS } from "./opencode.ts";

/** El grupo de `reparto` de los modelos `opencode:*` (grupo_de_modelo). */
export const GRUPO_OPENCODE_GRATIS = "opencode-free";
/** Cuánto dura la marca si no se sabe cuándo vuelve el cupo. */
export const VENCE_SIN_HORA_MS = 60 * 60 * 1000;

/** ¿Es el error del uso gratis de OpenCode (y no una cuota cualquiera)? */
export const esLimiteGratisOpencode = (texto: string): boolean => /provider\.free-limit|FreeUsageLimitError|Free usage limit/i.test(texto);

/** Dónde `reparto` guarda los agotados (`state_dir()`: REPARTO_STATE, o <PA_STATE o ~/.local/state/pa>/reparto). */
export function dirEstadoReparto(env: NodeJS.ProcessEnv = process.env, casa = os.homedir()): string {
  if (env.REPARTO_STATE) return env.REPARTO_STATE;
  return path.join(env.PA_STATE || path.join(casa, ".local", "state", "pa"), "reparto");
}

const archivo = (env: NodeJS.ProcessEnv) => path.join(dirEstadoReparto(env), "agotado.json");

function leer(env: NodeJS.ProcessEnv): Record<string, { hasta?: string }> {
  try {
    const d = JSON.parse(readFileSync(archivo(env), "utf8"));
    return d && typeof d === "object" && !Array.isArray(d) ? d : {};
  } catch {
    return {};
  }
}

/** Escribe `grupo` → `{ hasta }` en agotado.json (tira los vencidos, deja los demás grupos). Devuelve `false` si no se pudo escribir. */
function anotar(grupo: string, hastaMs: number, env: NodeJS.ProcessEnv, ahoraMs: number): boolean {
  try {
    const todo = leer(env);
    // Los vencidos se tiran (como `leer_agotados`); los demás grupos quedan como estaban.
    for (const [g, v] of Object.entries(todo)) if (!(Date.parse(v?.hasta ?? "") > ahoraMs)) delete todo[g];
    todo[grupo] = { hasta: new Date(hastaMs).toISOString().replace(/\.\d{3}Z$/, "Z") };
    mkdirSync(dirEstadoReparto(env), { recursive: true });
    const tmp = `${archivo(env)}.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(todo));
    renameSync(tmp, archivo(env));
    return true;
  } catch {
    return false;
  }
}

/** Marca agotado el uso gratis de OpenCode hasta `hastaMs` (por defecto, dentro de 1 h). Devuelve cuándo vence (epoch ms), o `null` si no se pudo escribir. */
export function marcarOpencodeAgotado(hastaMs?: number, env: NodeJS.ProcessEnv = process.env, ahoraMs = Date.now()): number | null {
  const hasta = hastaMs && hastaMs > ahoraMs ? hastaMs : ahoraMs + VENCE_SIN_HORA_MS;
  return anotar(GRUPO_OPENCODE_GRATIS, hasta, env, ahoraMs) ? hasta : null;
}

/** Hasta cuándo (epoch ms) está agotado el uso gratis de OpenCode, o `null` si no lo está (o ya venció). */
export function opencodeAgotadoHasta(env: NodeJS.ProcessEnv = process.env, ahoraMs = Date.now()): number | null {
  const ms = Date.parse(leer(env)[GRUPO_OPENCODE_GRATIS]?.hasta ?? "");
  return Number.isFinite(ms) && ms > ahoraMs ? ms : null;
}

// --- OpenCode Go: el grupo es el propio modelo ------------------------------------------------------------------------------------

/** El grupo de `reparto` de un modelo de Go (`grupo_de_modelo`): su id completo en minúsculas, con el prefijo `opencode:`. */
export const grupoModeloGo = (id: string): string => (id.startsWith("opencode:") ? id : `opencode:${id}`).toLowerCase();

/** Marca agotado SOLO ese modelo de Go hasta `hastaMs` (por defecto, dentro de 5 h). `null` si no es de Go o no se pudo escribir. */
export function marcarModeloGoAgotado(id: string, hastaMs?: number, env: NodeJS.ProcessEnv = process.env, ahoraMs = Date.now()): number | null {
  if (!esModeloGo(id)) return null;
  const hasta = hastaMs && hastaMs > ahoraMs ? hastaMs : ahoraMs + VENCE_GO_MS;
  return anotar(grupoModeloGo(id), hasta, env, ahoraMs) ? hasta : null;
}

/** Los modelos de Go agotados ahora: id del grupo (`opencode:opencode-go/<modelo>`) → hasta cuándo (epoch ms). */
export function modelosGoAgotados(env: NodeJS.ProcessEnv = process.env, ahoraMs = Date.now()): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [g, v] of Object.entries(leer(env))) {
    const ms = Date.parse(v?.hasta ?? "");
    if (esModeloGo(g) && Number.isFinite(ms) && ms > ahoraMs) out[g] = ms;
  }
  return out;
}
