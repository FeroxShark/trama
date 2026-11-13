// «Contexto antes de compactar» de un modelo: las MISMAS reglas que `autocompact_de` de `pa` (cli/pa/modelos.ts), para que el líder que
// arranca Trama use el tope de su familia igual que un worker. Puro y sin imports de Node: lo usan el main (el `--autocompact` del
// líder y el límite del panel de contexto) y la interfaz (el anillo del líder). Lo prueba tests/lider-autocompact.test.ts.
//   - `PA_AUTOCOMPACT` pisa todo (`nativo` = sin tope; un número = ese).
//   - Si no: la entrada de `por_modelo` con el id del modelo, o con su familia (fable, opus, sonnet, haiku); `null` = nativo.
//   - Si no hay entrada: `defecto` si es un número; Haiku 300 000; el resto, nativo (`null`).
import { AUTOCOMPACT_HAIKU, AUTOCOMPACT_MAX, AUTOCOMPACT_MIN } from "./modelos-tipos.ts";

/** `autocompact` de modelos.json (`null` en una clave = nativo). */
export type TopeConf = { defecto: number | null; por_modelo: Record<string, number | null> };
/** `PA_AUTOCOMPACT` ya leído: `null` = no pisa nada, `"nativo"` = fuerza sin tope. */
export type TopeEntorno = number | "nativo" | null;

const FAMILIAS = ["fable", "opus", "sonnet", "haiku"] as const;

/** `PA_AUTOCOMPACT` como lo lee `pa` (tokens de 100 000 a 1 000 000, o `nativo`); lo que no sirve se ignora. */
export function topeDeEntorno(v: string | undefined): TopeEntorno {
  const s = (v ?? "").trim();
  if (s.toLowerCase() === "nativo") return "nativo";
  if (/^[0-9]+$/.test(s) && Number(s) >= AUTOCOMPACT_MIN && Number(s) <= AUTOCOMPACT_MAX) return Number(s);
  return null;
}

/** El tope en tokens que vale para ese modelo; `null` = nativo (no se pasa `--autocompact`). */
export function topeAutocompact(modelo: string, conf: TopeConf | null | undefined, env: TopeEntorno = null): number | null {
  if (env !== null) return env === "nativo" ? null : env;
  const m = modelo.toLowerCase();
  const fam = FAMILIAS.find((f) => m.includes(f)) ?? null;
  const por: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(conf?.por_modelo ?? {})) por[k.toLowerCase()] = v;
  const k = [m, fam].find((x) => x !== null && x in por);
  const v = k !== undefined && k !== null ? por[k] : typeof conf?.defecto === "number" ? conf.defecto : fam === "haiku" ? AUTOCOMPACT_HAIKU : null;
  return typeof v === "number" ? v : null;
}

/** Lo que manda `contexto:umbral` (sin confiar en él): la config y `PA_AUTOCOMPACT`; `undefined` si no tiene la forma. */
export function topeSano(x: unknown): { conf: TopeConf | null; env: TopeEntorno } | undefined {
  if (!x || typeof x !== "object") return undefined;
  const { conf, env } = x as { conf?: unknown; env?: unknown };
  const tok = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= AUTOCOMPACT_MIN && v <= AUTOCOMPACT_MAX;
  let c: TopeConf | null = null;
  if (conf && typeof conf === "object") {
    const k = conf as { defecto?: unknown; por_modelo?: unknown };
    const por: Record<string, number | null> = {};
    if (k.por_modelo && typeof k.por_modelo === "object") for (const [n, v] of Object.entries(k.por_modelo)) if (v === null || tok(v)) por[n] = v;
    c = { defecto: tok(k.defecto) ? k.defecto : null, por_modelo: por };
  }
  return { conf: c, env: env === "nativo" ? "nativo" : tok(env) ? env : null };
}
