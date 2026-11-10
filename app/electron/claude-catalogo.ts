// Los modelos de Claude que ofrece ESTA cuenta: los lee del catálogo que el propio `claude` baja y deja en
// `<config de claude>/cache/model-catalog/<cuenta>-<huella>-cc.json` (`catalog.config.models`, cada uno con `section`: `main` los
// últimos, `overflow` las generaciones anteriores). Sólo se lee, nunca se escribe. Así un modelo nuevo (Fable 5.2) aparece solo en
// los selectores si la cuenta lo tiene, y no aparece si no. Sin carpeta, sin archivo o con uno roto: `null` (la tabla de siempre).
import { readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type ModeloClaudeCuenta = {
  id: string;
  nombre: string;
  /** `main`: de los últimos; `overflow`: una generación anterior. */
  principal: boolean;
  /** Niveles de esfuerzo que dice el catálogo (vacío: el modelo no razona por niveles). */
  efforts: string[];
  /** Familia (`fable`, `opus`, `sonnet`, `haiku`…) o `""`. */
  familia: string;
};

const ID = /^claude-[a-z0-9][\w.-]{0,60}$/i;

/** El archivo `*-cc.json` más reciente de la carpeta del catálogo, o `null`. */
function masReciente(dir: string): string | null {
  let mejor: { f: string; t: number } | null = null;
  try {
    for (const n of readdirSync(dir)) {
      if (!n.endsWith("-cc.json")) continue;
      const f = path.join(dir, n);
      const t = statSync(f).mtimeMs;
      if (!mejor || t > mejor.t) mejor = { f, t };
    }
  } catch {
    return null;
  }
  return mejor?.f ?? null;
}

/** Los modelos del catálogo de la cuenta, en su orden; `null` si no hay catálogo legible. */
export function modelosClaudeCuenta(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): ModeloClaudeCuenta[] | null {
  const archivo = masReciente(path.join(env.CLAUDE_CONFIG_DIR ?? path.join(home, ".claude"), "cache", "model-catalog"));
  if (!archivo) return null;
  try {
    const crudo = JSON.parse(readFileSync(archivo, "utf8")) as { catalog?: { config?: { models?: unknown } } };
    const lista = crudo.catalog?.config?.models;
    if (!Array.isArray(lista)) return null;
    const vistos = new Set<string>();
    const out: ModeloClaudeCuenta[] = [];
    for (const m of lista as Array<Record<string, unknown>>) {
      const id = typeof m?.id === "string" ? m.id : "";
      if (!ID.test(id) || vistos.has(id)) continue;
      vistos.add(id);
      const rt = (m.runtime ?? {}) as { effort_levels?: unknown; family?: unknown };
      out.push({
        id,
        nombre: (typeof m.name === "string" && m.name.trim() ? m.name.trim() : id).slice(0, 60),
        principal: m.section === "main",
        efforts: Array.isArray(rt.effort_levels) ? rt.effort_levels.filter((e): e is string => typeof e === "string" && /^[a-z]{2,10}$/.test(e)) : [],
        familia: typeof rt.family === "string" && /^[a-z]{2,20}$/.test(rt.family) ? rt.family : "",
      });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}
