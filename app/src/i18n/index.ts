// El idioma de la interfaz: un diccionario por idioma (en.ts manda: sus claves
// son las únicas que existen; es.ts tiene que tener exactamente las mismas) y
// `t(clave, vars)`. Una clave que no está, o una variable que falta, no compila.
// Lo que viene de `pa` (RESULTADO, sus errores) no pasa por acá.
//
// Sin imports de React ni del DOM a la fuerza: lo usan módulos que prueba `node --test`.
// El hook para los componentes está en ./react.ts.
import { en } from "./en.ts";
import { es } from "./es.ts";

export type Idioma = "en" | "es";
export const IDIOMAS: readonly Idioma[] = ["en", "es"];
export type Clave = keyof typeof en;

/** Las `{variables}` de un texto. */
type Vars<S extends string> = S extends `${string}{${infer V}}${infer R}` ? V | Vars<R> : never;
type Args<K extends Clave> = [Vars<(typeof en)[K]>] extends [never] ? [] : [vars: Record<Vars<(typeof en)[K]>, string | number>];

/** Las claves sin variables (para guardarlas en tablas y resolverlas al pintar). */
export type ClaveSola = { [K in Clave]: Args<K> extends [] ? K : never }[Clave];

const DICCIONARIOS: Record<Idioma, Record<Clave, string>> = { en, es };

export const esIdioma = (x: unknown): x is Idioma => x === "en" || x === "es";

/** El de la query (lo pone el main desde preferencias.json o `HILOS_IDIOMA`); sin main, inglés. */
function inicial(): Idioma {
  const q = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("idioma");
  return esIdioma(q) ? q : "en";
}

let actual: Idioma = inicial();
if (typeof document !== "undefined") document.documentElement.lang = actual;
const oyentes = new Set<() => void>();

export const idioma = () => actual;

/** Cambia el idioma al toque: avisa a los suscriptos (React re-renderiza, el reloj repinta). */
export function cambiarIdioma(i: Idioma) {
  if (i === actual || !esIdioma(i)) return;
  actual = i;
  if (typeof document !== "undefined") document.documentElement.lang = i;
  for (const f of oyentes) f();
}

export function alCambiarIdioma(f: () => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

export function t<K extends Clave>(k: K, ...a: Args<K>): string {
  return tDe(actual, k, ...a);
}

/** Lo mismo en un idioma dado (para reservar el lugar del otro idioma: ./Fijo.tsx). */
export function tDe<K extends Clave>(i: Idioma, k: K, ...a: Args<K>): string {
  const texto = DICCIONARIOS[i][k];
  const vars = a[0] as Record<string, string | number> | undefined;
  return vars ? texto.replace(/\{(\w+)\}/g, (m, v: string) => (v in vars ? String(vars[v]) : m)) : texto;
}

/**
 * Lo que arma el main (errores, sobre todo) viene codificado como clave +
 * variables (electron/errores.ts: "\u0001i18n:<clave>\u0001<json>\u0001") y se
 * traduce acá, al pintar. Busca la marca en cualquier parte (Electron le pega
 * "Error invoking remote method…" adelante); sin marca o con una clave que no
 * existe, el texto queda como vino: lo de `pa` y `claude` no se traduce.
 */
const MARCA_MAIN = /\u0001i18n:([\w.]+)\u0001([^\u0001]*)\u0001/g;

export function textoMain(s: string): string;
export function textoMain(s: string | null): string | null;
export function textoMain(s: string | null): string | null {
  if (!s || !s.includes("\u0001")) return s;
  return s.replace(MARCA_MAIN, (m, k: string, json: string) => {
    if (!(k in en)) return m;
    let vars: Record<string, string | number> = {};
    try {
      if (json) vars = JSON.parse(json);
    } catch {
      /* sin variables */
    }
    return (t as (k: Clave, v?: Record<string, string | number>) => string)(k as Clave, vars);
  });
}

/**
 * Las salidas de `pa` y los fallos de `claude` que se repiten, en una frase simple. Se reconocen por el
 * código de salida (si se lo sabe) o por lo que dijo `pa` por stderr (sólo sus dos últimas líneas
 * llegan hasta acá). Lo que no está acá no se toca: ver `fraseError`.
 */
const FRASES: { rc?: number; clave: ClaveSola; re: RegExp }[] = [
  { rc: 75, clave: "error.ocupado", re: /tope global|puestos de .* est[aá]n ocupados|candado de git .* sigue ocupado/i },
  { rc: 76, clave: "error.limite", re: /l[ií]mite de sesi[oó]n|usage limit|session limit|rate.?limit/i },
  { rc: 78, clave: "error.sinResultado", re: /para cerrarlo a mano|se qued[oó] sin turnos|sin (?:el bloque )?RESULTADO|error_max_turns/i },
  { rc: 79, clave: "error.sucio", re: /Commitealos, movelos o tiralos|sin commitear archivos que la rama/i },
  { rc: 80, clave: "error.conflicto", re: /rebase de .* tiene conflictos|pa .* --actualizar/i },
  { rc: 92, clave: "error.vivo", re: /sigue viva \(corriendo o en cola\)|Paralo primero/i },
  { clave: "error.sinConexion", re: /ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|fetch failed|failed to fetch|network ?error|Unable to connect|sin conexi[oó]n|ERR_(?:INTERNET|NETWORK|CONNECTION)/i },
];

/** La frase simple de un error conocido, o `null` si no lo es. `rc`: el código de salida de `pa`, si se lo sabe. */
export function fraseConocida(texto: string | null, rc?: number | null): string | null {
  const f = FRASES.find((x) => (rc != null && x.rc === rc) || (texto != null && x.re.test(texto)));
  return f ? t(f.clave) : null;
}

/** El error de `pa` o `claude` en una frase simple; si no es de los conocidos, el texto crudo como vino. */
export function fraseError(texto: string, rc?: number | null): string {
  return fraseConocida(texto, rc) ?? texto;
}

/** Lo que se ve de un error que llegó del main: la clave traducida y, si es de los conocidos, su frase simple. */
export const textoError = (s: string): string => fraseError(textoMain(s));

/** Para números y fechas (`toLocaleString`). */
export const locale = () => (actual === "es" ? "es-AR" : "en-US");

/** "1.4" → "1,4" en español. */
export const coma = (s: string) => (actual === "es" ? s.replace(".", ",") : s);

/** El día de la semana: "jue" / "Thu", o largo: "jueves" / "Thursday". */
export const diaSemana = (f: Date, largo = false) =>
  f.toLocaleDateString(locale(), { weekday: largo ? "long" : "short" }).replace(/\.$/, "");
