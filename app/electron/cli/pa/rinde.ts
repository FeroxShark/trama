// `pa --rinde [--dias N] [--json] [--por tipo|fase|tarea | --rubrica]` (cmd_rinde y cmd_rinde_rubrica de motor/bin/pa): qué rinde
// cada modelo × effort en cada tipo de tarea (o fase, o tarea madre), y cuánto acierta cada fila de la rúbrica, desde medicion.tsv.
// El awk, el sort y el jq del bash pasan a código; los números salen con el mismo formato (`%.0f`, `%.2f` de C y el `print` de awk).
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { type Pa } from "./entorno.ts";
import { fijo, imprimirAwk, leerArchivo, registros } from "./medicion.ts";
import { isoSegundos } from "./ramas.ts";

const USO = "uso: pa --rinde [--dias N] [--json] [--por tipo|fase|tarea | --rubrica]";

/** Un número ya formateado que el JSON imprime tal cual (jq conserva el texto de `tonumber`: `1.00` sigue siendo `1.00`). */
class Literal {
  texto: string;
  constructor(t: string) {
    this.texto = t;
  }
}
/** `def n: if . == "" then null else tonumber end`. */
const n = (s: string | undefined): Literal | null => (s === undefined || s === "" ? null : new Literal(s));

/** El JSON con la sangría de jq (2 espacios). */
export function jsonJq(v: unknown, nivel = 0): string {
  const sp = "  ".repeat(nivel + 1);
  const fin = "  ".repeat(nivel);
  if (v instanceof Literal) return v.texto;
  if (Array.isArray(v)) return v.length ? `[\n${v.map((x) => sp + jsonJq(x, nivel + 1)).join(",\n")}\n${fin}]` : "[]";
  if (v && typeof v === "object") {
    const ks = Object.entries(v as Record<string, unknown>);
    return ks.length ? `{\n${ks.map(([k, x]) => `${sp}${JSON.stringify(k)}: ${jsonJq(x, nivel + 1)}`).join(",\n")}\n${fin}}` : "{}";
  }
  return JSON.stringify(v ?? null);
}

/** `date -d "-N days" -Iseconds`. */
function haceDias(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return isoSegundos(d);
}

/** Orden de `LC_ALL=C sort` (por bytes de UTF-8; para texto sin astrales, el orden por unidades de código). */
const cmpC = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** `sort -V` (versión) en la locale C: `1`, `1b`, `1c`, `2`, …, `7`, `7b`, `8`, `8b`, `9`, `10`. */
function cmpVersion(a: string, b: string): number {
  const trozos = (s: string) => s.match(/[0-9]+|[^0-9]+/g) ?? [];
  const x = trozos(a);
  const y = trozos(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const p = x[i]!;
    const q = y[i]!;
    const dp = /^[0-9]/.test(p);
    const dq = /^[0-9]/.test(q);
    if (dp && dq) {
      const d = BigInt(p) > BigInt(q) ? 1 : BigInt(p) < BigInt(q) ? -1 : 0;
      if (d) return d;
    } else if (dp !== dq) return dp ? -1 : 1;
    else if (p !== q) return cmpC(p, q);
  }
  return x.length - y.length || cmpC(a, b);
}

const rellenar = (s: string, w: number) => s.padEnd(w);
const izq = (s: string, w: number) => s.padStart(w);

interface Celda {
  tipo: string;
  modelo: string;
  effort: string;
  cuenta: string;
  n: number;
  dato: number;
  ok: number;
  pct: string;
  med: string;
  costo: string;
  comp: string;
}

/** El cuerpo común del awk: las filas de los últimos días, con una función `v(nombre)` por columna. */
function filasDe(texto: string, desde: string): ((nombre: string) => string)[] {
  const ls = registros(texto);
  if (!ls.length) return [];
  const c: Record<string, number> = {};
  ls[0]!.split("\t").forEach((k, i) => (c[k] = i + 1));
  const salida: ((nombre: string) => string)[] = [];
  for (const l of ls.slice(1)) {
    const f = l.split("\t");
    if (l === "" || f.length < 5 || !/^[0-9]{4}-/.test(f[0]!) || f[0]! < desde) continue;
    salida.push((nombre) => (nombre in c && c[nombre]! <= f.length ? f[c[nombre]! - 1]! : ""));
  }
  return salida;
}

const esNum = (x: string) => /^[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$/.test(x);
const conDato = (i: string, r: string) => i === "0" || (i === "1" && (r === "0" || r === "1"));

function celdasPor(texto: string, desde: string, por: string): Celda[] {
  const g = new Map<string, { t: string; m: string; e: string; cu: string; n: number; dato: number; ok: number; tur: number[]; usd: number; nu: number; nc: number; comp: number }>();
  for (const v of filasDe(texto, desde)) {
    let t = v(por);
    if (t === "") t = "~";
    let e = v("effort");
    if (e === "") e = "settings";
    let cu = v("cuenta");
    if (cu === "claude" || cu === "google" || cu === "chatgpt") cu = "";
    const k = [t, v("modelo"), e, cu].join("\t");
    let a = g.get(k);
    if (!a) g.set(k, (a = { t, m: v("modelo"), e, cu, n: 0, dato: 0, ok: 0, tur: [], usd: 0, nu: 0, nc: 0, comp: 0 }));
    a.n++;
    const i = v("integrada");
    const r = v("retrabajo");
    if (conDato(i, r)) {
      a.dato++;
      if (i === "1" && r === "0") a.ok++;
    }
    let x = v("num_turns");
    if (esNum(x)) a.tur.push(Number(x));
    x = v("costo_usd");
    if (esNum(x)) {
      a.usd += Number(x);
      a.nu++;
    }
    x = v("compactaciones");
    if (esNum(x)) {
      a.nc++;
      if (Number(x) > 0) a.comp++;
    }
  }
  const celdas: Celda[] = [];
  for (const a of g.values()) {
    const tur = [...a.tur].sort((p, q) => p - q);
    const m = tur.length;
    const med = m === 0 ? "" : imprimirAwk(m % 2 ? tur[(m + 1) / 2 - 1]! : (tur[m / 2 - 1]! + tur[m / 2]!) / 2);
    celdas.push({
      tipo: a.t,
      modelo: a.m,
      effort: a.e,
      cuenta: a.cu,
      n: a.n,
      dato: a.dato,
      ok: a.ok,
      pct: a.dato ? fijo((100 * a.ok) / a.dato, 0) : "",
      med,
      costo: a.nu ? fijo(a.usd / a.nu, 2) : "",
      comp: a.nc ? fijo((100 * a.comp) / a.nc, 0) : "",
    });
  }
  return celdas.sort((p, q) => cmpC(p.tipo, q.tipo) || cmpC(p.modelo, q.modelo) || cmpC(p.effort, q.effort) || cmpC(p.cuenta, q.cuenta));
}

interface FilaRub {
  fila: string;
  modelo: string;
  effort: string;
  n: number;
  est: number;
  dato: number;
  ok: number;
  pct: string;
}

function filasRubrica(texto: string, desde: string): FilaRub[] {
  const g = new Map<string, FilaRub>();
  for (const v of filasDe(texto, desde)) {
    const f = v("rub_fila");
    if (!/^[0-9]+[a-z]?$/.test(f)) continue;
    let a = g.get(f);
    if (!a) g.set(f, (a = { fila: f, modelo: "", effort: "", n: 0, est: 0, dato: 0, ok: 0, pct: "" }));
    a.n++;
    a.modelo = v("rub_modelo");
    a.effort = v("rub_effort");
    if (v("modelo") === v("rub_modelo")) {
      a.est++;
      const i = v("integrada");
      const r = v("retrabajo");
      if (conDato(i, r)) {
        a.dato++;
        if (i === "1" && r === "0") a.ok++;
      }
    }
  }
  for (const a of g.values()) a.pct = a.dato ? fijo((100 * a.ok) / a.dato, 0) : "";
  return [...g.values()].sort((p, q) => cmpVersion(p.fila, q.fila));
}

/** `pa --rinde`. */
export function cmdRinde(pa: Pa, args: string[]): number {
  let dias = "30";
  let json = false;
  let por = "tipo";
  let rub = false;
  for (let i = 0; i < args.length; ) {
    const a = args[i]!;
    if (a === "--dias") {
      dias = args[i + 1] ?? "";
      i += 2;
    } else if (a === "--json") {
      json = true;
      i++;
    } else if (a === "--por") {
      por = args[i + 1] ?? "";
      i += 2;
    } else if (a === "--rubrica") {
      rub = true;
      i++;
    } else {
      pa.io.err(`${USO}\n`);
      return 2;
    }
  }
  if (!/^[0-9]+$/.test(dias)) {
    pa.io.err(`${USO}  (N = días, un número)\n`);
    return 2;
  }
  if (!/^(tipo|fase|tarea)$/.test(por)) {
    pa.io.err(`${USO}  (--por: tipo, fase o tarea, no '${por}')\n`);
    return 2;
  }
  if (rub && por !== "tipo") {
    pa.io.err("pa: --rubrica no se combina con --por: agrupa por fila de la tabla.\n");
    return 2;
  }
  const f = path.join(pa.state, "medicion.tsv");
  const texto = existsSync(f) && statSync(f).isFile() ? leerArchivo(f) ?? "" : "";
  const desde = haceDias(Number(dias));
  return rub ? salidaRubrica(pa, dias, desde, json, filasRubrica(texto, desde)) : salidaPor(pa, dias, desde, json, por, celdasPor(texto, desde, por));
}

function salidaPor(pa: Pa, dias: string, desde: string, json: boolean, por: string, celdas: Celda[]): number {
  if (json) {
    pa.io.out(
      `${jsonJq({
        version: 1,
        dias: new Literal(String(Number(dias))),
        desde,
        por,
        celdas: celdas.map((c) => ({
          [por]: c.tipo === "~" ? "?" : c.tipo,
          modelo: c.modelo,
          effort: c.effort,
          cuenta: c.cuenta === "" ? null : c.cuenta,
          n: n(String(c.n)),
          con_dato: n(String(c.dato)),
          ok: n(String(c.ok)),
          pct_ok: n(c.pct),
          turnos_mediana: n(c.med),
          costo_medio_usd: n(c.costo),
          pct_compacto: n(c.comp),
        })),
      })}\n`,
    );
    return 0;
  }
  if (!celdas.length) {
    pa.io.out(`pa: ninguna corrida en los últimos ${dias} días.\n`);
    return 0;
  }
  pa.io.out("últimos " + dias + " días · ok% = integrada sin retrabajo, sobre las que ya tienen dato (pa --bien-auto) · turnos = mediana · US$ = costo medio · comp% = compactaron\n");
  const fila = (a: string[]) => `${rellenar(a[0]!, 15)} ${rellenar(a[1]!, 18)} ${rellenar(a[2]!, 8)} ${izq(a[3]!, 4)} ${izq(a[4]!, 5)} ${izq(a[5]!, 5)} ${izq(a[6]!, 7)} ${izq(a[7]!, 8)} ${izq(a[8]!, 6)}\n`;
  pa.io.out(fila([por, "modelo", "effort", "n", "dato", "ok%", "turnos", "US$", "comp%"]));
  for (const c of celdas) {
    pa.io.out(fila([c.tipo === "~" ? "?" : c.tipo, c.cuenta ? `${c.modelo}@${c.cuenta}` : c.modelo, c.effort, String(c.n), String(c.dato), c.pct || "-", c.med || "-", c.costo || "-", c.comp || "-"]));
  }
  return 0;
}

function salidaRubrica(pa: Pa, dias: string, desde: string, json: boolean, filas: FilaRub[]): number {
  if (json) {
    pa.io.out(
      `${jsonJq({
        version: 1,
        dias: new Literal(String(Number(dias))),
        desde,
        por: "rubrica",
        filas: filas.map((a) => ({
          fila: a.fila === "" ? null : /^[0-9]+$/.test(a.fila) ? new Literal(String(Number(a.fila))) : a.fila,
          modelo_estimado: a.modelo === "" ? null : a.modelo,
          effort_estimado: a.effort === "" ? null : a.effort,
          n: n(String(a.n)),
          con_modelo_estimado: n(String(a.est)),
          con_dato: n(String(a.dato)),
          ok: n(String(a.ok)),
          pct_acierto: n(a.pct),
        })),
      })}\n`,
    );
    return 0;
  }
  if (!filas.length) {
    pa.io.out(`pa: ninguna corrida con rúbrica (pa <proy> --rubrica '…') en los últimos ${dias} días.\n`);
    return 0;
  }
  pa.io.out("últimos " + dias + " días · est = corrieron con el modelo que daba la fila · acierto% = integrada sin retrabajo con ese modelo, sobre las que ya tienen dato (pa --bien-auto)\n");
  const fila = (a: string[]) => `${rellenar(a[0]!, 5)} ${rellenar(a[1]!, 34)} ${rellenar(a[2]!, 8)} ${izq(a[3]!, 4)} ${izq(a[4]!, 4)} ${izq(a[5]!, 5)} ${izq(a[6]!, 8)}\n`;
  pa.io.out(fila(["fila", "modelo estimado", "effort", "n", "est", "dato", "acierto%"]));
  for (const a of filas) pa.io.out(fila([a.fila, a.modelo || "-", a.effort || "-", String(a.n), String(a.est), String(a.dato), a.pct || "-"]));
  return 0;
}
