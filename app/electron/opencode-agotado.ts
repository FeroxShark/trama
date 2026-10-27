// El uso gratis de OpenCode (`provider.free-limit`, 429, FreeUsageLimitError) es UNO solo para todos sus modelos gratis: cuando se acaba para
// uno, se acabó para todos (los de otro proveedor de opencode, con tu clave, no se tocan). Se anota en el mismo `agotado.json` que
// usan los workers (`reparto --agotar`, motor/bin/reparto → leer_agotados): el grupo `opencode-free`, con `{ "hasta": ISO }`. Así
// `reparto` no ofrece ningún modelo gratis de OpenCode hasta que vuelve, y el selector de modelos los rotula «sin cupo gratis».
// Sin hora de vuelta conocida (OpenCode no la dice) la marca vence a la hora (`VENCE_SIN_HORA_MS`): se vuelve a intentar.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

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

/** Marca agotado el uso gratis de OpenCode hasta `hastaMs` (por defecto, dentro de 1 h). Devuelve cuándo vence (epoch ms), o `null` si no se pudo escribir. */
export function marcarOpencodeAgotado(hastaMs?: number, env: NodeJS.ProcessEnv = process.env, ahoraMs = Date.now()): number | null {
  const hasta = hastaMs && hastaMs > ahoraMs ? hastaMs : ahoraMs + VENCE_SIN_HORA_MS;
  try {
    const todo = leer(env);
    // Los vencidos se tiran (como `leer_agotados`); los demás grupos quedan como estaban.
    for (const [g, v] of Object.entries(todo)) if (!(Date.parse(v?.hasta ?? "") > ahoraMs)) delete todo[g];
    todo[GRUPO_OPENCODE_GRATIS] = { hasta: new Date(hasta).toISOString().replace(/\.\d{3}Z$/, "Z") };
    mkdirSync(dirEstadoReparto(env), { recursive: true });
    const tmp = `${archivo(env)}.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(todo));
    renameSync(tmp, archivo(env));
    return hasta;
  } catch {
    return null;
  }
}

/** Hasta cuándo (epoch ms) está agotado el uso gratis de OpenCode, o `null` si no lo está (o ya venció). */
export function opencodeAgotadoHasta(env: NodeJS.ProcessEnv = process.env, ahoraMs = Date.now()): number | null {
  const ms = Date.parse(leer(env)[GRUPO_OPENCODE_GRATIS]?.hasta ?? "");
  return Number.isFinite(ms) && ms > ahoraMs ? ms : null;
}
