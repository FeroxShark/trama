// El listado de `agy models`, entendido igual por quien reparte (cli/reparto.ts) y por Cuentas (cuentas.ts): una línea por modelo, 'id<TAB>nombre',
// sólo el id, o sólo el nombre ('Claude Opus 4.6 (Thinking)'). Puro: sin Electron ni el reparto entero.
const RE_AGY_ID = /^[a-z0-9][a-z0-9._-]*$/i;
const RE_AGY_FAMILIA = /^(?:gemini|claude|gpt)/i;

/** El id probable de un nombre de `agy models` que vino sin id ('Claude Sonnet 4.6 (Thinking)' → claude-sonnet-4-6-thinking; 'Gemini 4 Hydrogen (High)' →
 *  gemini-4-hydrogen-high): minúsculas, lo que no es letra ni número pasa a '-', y el punto de una versión de Claude pasa a '-' (los ids de Claude llevan 5-5). */
export function agyIdDeNombre(nombre: unknown): string {
  let n = String(nombre || "").toLowerCase().trim();
  if (n.startsWith("claude")) n = n.replace(/(\d)\.(\d)/g, "$1-$2");
  return n.replace(/[^a-z0-9.]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
}

/** Lo que imprime `agy models`: una línea por modelo, 'id<TAB>nombre', sólo el id, o sólo el nombre ('Claude Opus 4.6 (Thinking)'). Lo demás
 *  ('Fetching available models...') se ignora. [{id, nombre}] sin repetidos, en el orden de agy. */
export function agyParsearModelos(texto: unknown): { id: string; nombre: string }[] {
  const out: { id: string; nombre: string }[] = [];
  const vistos = new Set<string>();
  for (const l of (typeof texto === "string" ? texto : texto ? String(texto) : "").split(/\r\n|\r|\n/)) {
    const ln = l.trim();
    if (!ln) continue;
    let id: string;
    let nombre: string;
    if (ln.includes("\t")) {
      const k = ln.indexOf("\t");
      id = ln.slice(0, k).trim().toLowerCase();
      nombre = ln.slice(k + 1).trim();
      if (!RE_AGY_ID.test(id)) continue;
    } else if (RE_AGY_FAMILIA.test(ln) && RE_AGY_ID.test(ln)) {
      [id, nombre] = [ln.toLowerCase(), ln];
    } else if (RE_AGY_FAMILIA.test(ln) && ln.endsWith(")")) {
      [id, nombre] = [agyIdDeNombre(ln), ln];
    } else continue;
    if (!vistos.has(id)) {
      vistos.add(id);
      out.push({ id, nombre: nombre || id });
    }
  }
  return out;
}

