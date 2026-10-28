// Lo que necesita el port de motor/bin/reparto (python) para escribir EXACTAMENTE lo mismo que el original: los números con la
// forma de Python (un float entero sale «1.0», `round` con empate al par, "%.1f", "%g"), `json.dumps` (separadores ", " y ": ",
// ensure_ascii), `fnmatch.fnmatchcase`, `datetime.fromisoformat` y `float()`/`int()` de un texto.
//
// En JS no hay float entero (1.0 === 1): los valores que en Python son float se MARCAN por objeto y clave. Se marcan solos al
// leer JSON (`leerJson`: un literal con punto o exponente) y a mano al armar los dict de salida (`conFloat`). `jsonPy` escribe
// con ".0" un número entero sólo si está marcado.

const MARCAS = new WeakMap<object, Set<string>>();

/** Marca esas claves de `o` como float de Python. */
export function conFloat<T extends object>(o: T, ...ks: (string | number)[]): T {
  let s = MARCAS.get(o);
  if (!s) MARCAS.set(o, (s = new Set()));
  for (const k of ks) s.add(String(k));
  return o;
}

/** ¿El valor de `o[k]` es un float de Python? */
export function esFloat(o: unknown, k: string | number): boolean {
  return typeof o === "object" && o !== null && !!MARCAS.get(o)?.has(String(k));
}

/** Marca (o desmarca) `o[k]` según `si`. */
export function marcarSi<T extends object>(o: T, k: string | number, si: boolean): T {
  if (si) return conFloat(o, k);
  MARCAS.get(o)?.delete(String(k));
  return o;
}

/** Copia las marcas de `de` a `a` (para las claves que `a` tiene). */
export function copiarMarcas<T extends object>(de: object, a: T): T {
  const s = MARCAS.get(de);
  if (s) for (const k of s) if (k in a) conFloat(a, k);
  return a;
}

/** `json.loads`: como JSON.parse, pero marca los números que en Python serían float (con punto o exponente). */
export function leerJson(texto: string): any {
  const revivir = function (this: object, k: string, v: unknown, ctx?: { source?: string }) {
    if (typeof v === "number" && ctx?.source && /[.eE]/.test(ctx.source)) conFloat(this, k);
    return v;
  };
  return JSON.parse(texto, revivir as (this: unknown, k: string, v: unknown) => unknown);
}

// ---------------------------------------------------------------------------------------------------------- números

/** `repr(float)` de Python: lo más corto que vuelve al mismo número, con ".0" si es entero y exponente fuera de [1e-4, 1e16). */
export function reprFloat(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (x === Infinity) return "inf";
  if (x === -Infinity) return "-inf";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const [m, e] = x.toExponential().split("e") as [string, string];
  const exp = Number(e);
  if (exp < -4 || exp >= 16) {
    const ee = Math.abs(exp) < 10 ? `0${Math.abs(exp)}` : String(Math.abs(exp));
    return `${m}e${exp < 0 ? "-" : "+"}${ee}`;
  }
  const s = String(x);
  if (/e/.test(s)) {
    // JS usa exponente desde 1e21 (o bajo 1e-6): acá van los dígitos a mano.
    const neg = m.startsWith("-");
    const dig = m.replace("-", "").replace(".", "");
    let r: string;
    if (exp >= 0) r = dig.length > exp + 1 ? `${dig.slice(0, exp + 1)}.${dig.slice(exp + 1)}` : `${dig}${"0".repeat(exp + 1 - dig.length)}.0`;
    else r = `0.${"0".repeat(-exp - 1)}${dig}`;
    return (neg ? "-" : "") + r;
  }
  return Number.isInteger(x) ? `${s}.0` : s;
}

/** `round(x, n)` de Python: correcto sobre el valor exacto del double, con empate al par. Sin `n`, un entero. */
export function pyRound(x: number, n = 0): number {
  if (!Number.isFinite(x)) return x;
  const neg = x < 0 || Object.is(x, -0);
  const a = Math.abs(x);
  let s = a.toFixed(n);
  if (n + 30 <= 100) {
    const largo = a.toFixed(n + 30);
    const resto = largo.slice(largo.length - 30);
    if (/^50*$/.test(resto)) {
      // empate exacto: toFixed sube; Python va al par
      const base = largo.slice(0, largo.length - 30).replace(/\.$/, "");
      const ultimo = Number(base.replace(".", "").slice(-1));
      s = ultimo % 2 === 0 ? base : s;
    }
  }
  const v = Number(s);
  return neg ? -v : v;
}

/** `"%.nf" % x`. */
export function fmtF(x: number, n: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  const r = pyRound(x, n);
  const s = Math.abs(r).toFixed(n);
  return (x < 0 || Object.is(x, -0) ? "-" : "") + s;
}

/** `"%g" % x` (6 cifras significativas, sin ceros de sobra). */
export function fmtG(x: number): string {
  if (x === 0) return Object.is(x, -0) ? "-0" : "0";
  if (!Number.isFinite(x)) return Number.isNaN(x) ? "nan" : x > 0 ? "inf" : "-inf";
  const [m, e] = x.toExponential(5).split("e") as [string, string];
  const exp = Number(e);
  const sinCeros = (t: string) => (t.includes(".") ? t.replace(/0+$/, "").replace(/\.$/, "") : t);
  if (exp < -4 || exp >= 6) return `${sinCeros(m)}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  return sinCeros(x.toFixed(Math.max(0, 5 - exp)));
}

/** `str(x)` de un número: entero tal cual, float con repr (`float` fuerza la forma de float). */
export const pyStr = (x: unknown, float = false): string =>
  typeof x === "number" ? (float || !Number.isInteger(x) ? reprFloat(x) : String(x)) : x === null || x === undefined ? "None" : x === true ? "True" : x === false ? "False" : String(x);

/** `float(texto)` de Python (tira si no es un número). */
export function pyFloat(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v).trim().toLowerCase();
  if (/^[+-]?(inf|infinity)$/.test(s)) return s.startsWith("-") ? -Infinity : Infinity;
  if (/^[+-]?nan$/.test(s)) return NaN;
  if (!/^[+-]?(\d(_?\d)*(\.(\d(_?\d)*)?)?|\.\d(_?\d)*)(e[+-]?\d(_?\d)*)?$/.test(s)) throw new Error(`could not convert string to float: '${String(v)}'`);
  return Number(s.replace(/_/g, ""));
}

/** `int(x)` de Python sobre un texto o un número (tira si no se puede). */
export function pyInt(v: unknown): number {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("cannot convert float");
    return Math.trunc(v);
  }
  if (typeof v === "boolean") return v ? 1 : 0;
  const s = String(v).trim();
  if (!/^[+-]?\d(_?\d)*$/.test(s)) throw new Error(`invalid literal for int(): '${String(v)}'`);
  return Number(s.replace(/_/g, ""));
}

/** ¿Un número de verdad? (`isinstance(v, (int, float)) and not isinstance(v, bool)`) */
export const esNum = (v: unknown): v is number => typeof v === "number";

/** Verdad de Python (`bool(x)`). */
export function verdad(x: unknown): boolean {
  if (x === null || x === undefined || x === false || x === 0 || x === "") return false;
  if (typeof x === "number" && Number.isNaN(x)) return true;
  if (Array.isArray(x)) return x.length > 0;
  if (x instanceof Set || x instanceof Map) return x.size > 0;
  if (typeof x === "object") return Object.keys(x).length > 0;
  return true;
}

/** Compara dos tuplas como Python (números y textos; null < todo lo demás no existe en Python: no se usa). */
export function cmpTupla(a: readonly unknown[], b: readonly unknown[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] as number | string | boolean;
    const y = b[i] as number | string | boolean;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return a.length - b.length;
}

/** `max(xs, key=k)`: el PRIMERO de los máximos. */
export function maxPor<T>(xs: readonly T[], k: (x: T) => unknown[]): T {
  let mejor: T = xs[0] as T;
  let km = k(mejor);
  for (const x of xs.slice(1)) {
    const kx = k(x);
    if (cmpTupla(kx, km) > 0) [mejor, km] = [x, kx];
  }
  return mejor;
}

/** `min(xs, key=k)`: el PRIMERO de los mínimos. */
export function minPor<T>(xs: readonly T[], k: (x: T) => unknown[]): T {
  let mejor: T = xs[0] as T;
  let km = k(mejor);
  for (const x of xs.slice(1)) {
    const kx = k(x);
    if (cmpTupla(kx, km) < 0) [mejor, km] = [x, kx];
  }
  return mejor;
}

/** `sorted(xs, key=k)` (estable). */
export const ordenarPor = <T>(xs: readonly T[], k: (x: T) => unknown[]): T[] => [...xs].sort((a, b) => cmpTupla(k(a), k(b)));

// ---------------------------------------------------------------------------------------------------------- json.dumps

function textoJson(s: string, ascii: boolean): string {
  let r = JSON.stringify(s);
  if (ascii) r = r.replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  else r = r.replace(/\\u(d[89ab][0-9a-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
  return r;
}

/** `json.dumps(v, ensure_ascii=ascii, indent=indent)` de Python. Los enteros marcados (`conFloat`, `leerJson`) salen con ".0". */
export function jsonPy(v: unknown, o: { ascii?: boolean; indent?: number | null; float?: boolean } = {}): string {
  const ascii = o.ascii ?? false;
  const ind = o.indent ?? null;
  const num = (x: number, float: boolean) => (Number.isNaN(x) ? "NaN" : x === Infinity ? "Infinity" : x === -Infinity ? "-Infinity" : float || !Number.isInteger(x) ? reprFloat(x) : String(x));
  const ir = (x: unknown, float: boolean, nivel: number): string => {
    if (x === null || x === undefined) return "null";
    if (x === true) return "true";
    if (x === false) return "false";
    if (typeof x === "number") return num(x, float);
    if (typeof x === "string") return textoJson(x, ascii);
    const sep = ind === null ? "" : "\n" + " ".repeat(ind * (nivel + 1));
    const fin = ind === null ? "" : "\n" + " ".repeat(ind * nivel);
    const coma = ind === null ? ", " : ",";
    if (Array.isArray(x)) {
      if (!x.length) return "[]";
      return "[" + x.map((y, i) => sep + ir(y, esFloat(x, i), nivel + 1)).join(coma) + fin + "]";
    }
    if (x instanceof Set) return ir([...x], false, nivel);
    const ents = Object.entries(x as Record<string, unknown>);
    if (!ents.length) return "{}";
    return "{" + ents.map(([k, y]) => sep + textoJson(k, ascii) + ": " + ir(y, esFloat(x, k), nivel + 1)).join(coma) + fin + "}";
  };
  return ir(v, o.float ?? false, 0);
}

// ---------------------------------------------------------------------------------------------------------- fnmatch

const CACHE_FN = new Map<string, RegExp>();

/** `fnmatch.fnmatchcase(nombre, patron)`: `*`, `?`, `[seq]`, `[!seq]`, todo el texto, distingue mayúsculas. */
export function fnmatchcase(nombre: string, patron: string): boolean {
  let re = CACHE_FN.get(patron);
  if (!re) {
    let s = "";
    for (let i = 0; i < patron.length; i++) {
      const c = patron[i]!;
      if (c === "*") s += "[\\s\\S]*";
      else if (c === "?") s += "[\\s\\S]";
      else if (c === "[") {
        let j = i + 1;
        if (patron[j] === "!") j++;
        if (patron[j] === "]") j++;
        while (j < patron.length && patron[j] !== "]") j++;
        if (j >= patron.length) s += "\\[";
        else {
          let dentro = patron.slice(i + 1, j);
          i = j;
          let neg = false;
          if (dentro.startsWith("!")) {
            neg = true;
            dentro = dentro.slice(1);
          }
          const esc = dentro.replace(/[\\\]^]/g, (m) => "\\" + m);
          s += neg ? `[^${esc}]` : `[${esc}]`;
        }
      } else s += c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    }
    re = new RegExp(`^(?:${s})$`, "u");
    CACHE_FN.set(patron, re);
  }
  return re.test(nombre);
}

// ---------------------------------------------------------------------------------------------------------- fechas

const DIAS_MES = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).getUTCDate();

/** `datetime.fromisoformat(s.replace("Z", "+00:00"))` (lo común de Python 3.11+); sin zona, la hora local. null si no va. */
export function parseIsoPy(s: unknown): Date | null {
  if (typeof s !== "string" || !s) return null;
  const t = s.replace(/Z/g, "+00:00");
  const m = /^(\d{4})-?(\d{2})-?(\d{2})(?:.(\d{2})(?::?(\d{2})(?::?(\d{2})(?:[.,](\d+))?)?)?)?(?:([+-])(\d{2}):?(\d{2})(?::?(\d{2})(?:\.(\d+))?)?)?$/su.exec(t);
  if (!m) return null;
  const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [h, mi, se] = [Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)];
  const ms = m[7] ? Math.floor(Number(`0.${m[7]}`) * 1000) : 0;
  if (a < 1 || me < 1 || me > 12 || d < 1 || d > DIAS_MES(a, me) || h > 23 || mi > 59 || se > 59) return null;
  if (m[8]) {
    const oh = Number(m[9]);
    const om = Number(m[10]);
    const os_ = Number(m[11] ?? 0);
    if (oh > 23 || om > 59 || os_ > 59) return null;
    const off = (m[8] === "-" ? -1 : 1) * ((oh * 60 + om) * 60 + os_) * 1000;
    return new Date(Date.UTC(a, me - 1, d, h, mi, se, ms) - off);
  }
  const r = new Date(a, me - 1, d, h, mi, se, ms);
  r.setFullYear(a);
  return r;
}

/** `dt.strftime("%Y-%m-%dT%H:%M:%SZ")` en UTC. */
export const isoPy = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 19) + "Z" : null);

/** La fecha local (AAAA-MM-DD) de un instante. */
export const fechaLocal = (d: Date): string =>
  `${String(d.getFullYear()).padStart(4, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** El instante como hora de pared local, en ms "ingenuos" (como un `datetime` sin zona: la aritmética no ve los cambios de hora). */
export const pared = (d: Date): number => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());

/** `datetime.strptime(s, "%Y-%m-%d").date()` como [año, mes, día]; null si no va. */
export function fechaDe(s: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m) return null;
  const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (me < 1 || me > 12 || d < 1 || d > DIAS_MES(a, me) || a < 1) return null;
  return [a, me, d];
}

/** Una fecha (AAAA-MM-DD) más `n` días. */
export function sumarDias(f: string, n: number): string {
  const [a, m, d] = f.split("-").map(Number) as [number, number, number];
  const x = new Date(Date.UTC(a, m - 1, d + n));
  x.setUTCFullYear(x.getUTCFullYear());
  return x.toISOString().slice(0, 10);
}

/** Días entre dos fechas AAAA-MM-DD (b - a). */
export const diasEntre = (a: string, b: string): number => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

/** Los saltos de línea de `str.splitlines()` de Python. */
export const SALTOS_PY = /\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/;

/** `str.splitlines()`. */
export function splitlines(s: string): string[] {
  const r = s.split(SALTOS_PY);
  if (r.length && r[r.length - 1] === "") r.pop();
  return r;
}

/** Las líneas de `for ln in open(f)` (saltos universales: \r\n y \r cuentan como \n), sin el salto. */
export function lineasTexto(s: string): string[] {
  const r = s.replace(/\r\n?/g, "\n").split("\n");
  if (r.length && r[r.length - 1] === "") r.pop();
  return r;
}
