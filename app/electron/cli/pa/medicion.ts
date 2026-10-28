// `pa --bien <id> si|no|parcial` y `pa --bien-auto` (cmd_bien, cmd_bien_auto y reescribe_lineas de motor/bin/pa): las columnas `bien`,
// `integrada` y `retrabajo` de medicion.tsv. Mismas salidas, mismos códigos y mismo archivo que el bash; el awk de allá pasa a
// código (con sus reglas de comparación de números y de campos), el flock al lock de base/lock y `git` a base/git.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { git } from "../base/git.ts";
import { tomar } from "../base/lock.ts";
import { resolverProyecto } from "../proyecto-ruta.ts";
import { type Pa } from "./entorno.ts";
import { MEDICION_HEADER } from "./ganchos.ts";
import { leccionesDeMedicion } from "./lecciones.ts";
import { nombreRegistry } from "./ramas.ts";

// ------------------------------------------------------------------------------------------- piezas del awk

/** El texto de un archivo, o null si no se puede leer. */
export function leerArchivo(f: string): string | null {
  try {
    return readFileSync(f, "utf8");
  } catch {
    return null;
  }
}

/** Las líneas de un archivo como las ve awk: el último salto de línea no abre un registro más. */
export function registros(texto: string): string[] {
  if (texto === "") return [];
  const ls = texto.split("\n");
  if (ls[ls.length - 1] === "") ls.pop();
  return ls;
}

/** Un número tal como lo toma awk de un campo (`strnum`): null si el campo no parece un número. */
export function numeroAwk(s: string): number | null {
  return /^[ \t]*[-+]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]+)?[ \t]*$/.test(s) ? Number(s) : null;
}
/** `x + 0` de awk (texto que no empieza con un número = 0; toma el prefijo numérico). */
export function mas0(s: string | undefined): number {
  const m = /^[ \t]*([-+]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]+)?)/.exec(s ?? "");
  return m ? Number(m[1]) : 0;
}
/** `$6 != 1` de awk: el campo es el número 1 (también `1.0`); un campo vacío o con texto no lo es. */
export const esUno = (s: string | undefined) => numeroAwk(s ?? "") === 1;

/** `sprintf("%.Nf", x)` de C: redondea al par más cercano en un empate exacto (toFixed redondea hacia arriba). */
export function fijo(x: number, dec: number): string {
  const largo = x.toFixed(Math.min(100, dec + 60));
  const cola = largo.slice(largo.indexOf(".") + 1 + dec);
  if (/^50*$/.test(cola)) {
    const abajo = largo.slice(0, largo.length - cola.length).replace(/\.$/, "");
    const ult = Number(abajo[abajo.length - 1]);
    if (ult % 2 === 0) return abajo;
  }
  return x.toFixed(dec);
}
/** `print` de un número de awk: enteros tal cual, el resto con `%.6g`. */
export function imprimirAwk(x: number): string {
  if (Number.isInteger(x)) return String(x);
  return String(Number(x.toPrecision(6)));
}

/** `date -d "<fecha>" +%s` para lo que escribe `date -Iseconds` (null si no se entiende). */
export function epochDe(fecha: string): number | null {
  let d: Date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) d = new Date(`${fecha}T00:00:00`);
  else d = new Date(fecha);
  const t = d.getTime();
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

/** El flock de medicion.tsv: sobre su ruta (el mismo lugar que `medir`). */
async function conLock<T>(pa: Pa, f: string, cuerpo: () => T | Promise<T>): Promise<T> {
  const lock = await tomar(f, { plat: pa.plat, env: pa.env, esperarMs: 30_000 });
  try {
    return await cuerpo();
  } finally {
    await lock?.liberar();
  }
}

/** `medicion_header_al_dia` (se llama con el lock tomado): un header que es prefijo del de hoy se actualiza solo. */
export function headerAlDia(f: string): void {
  let t: string;
  try {
    t = readFileSync(f, "utf8");
  } catch {
    return;
  }
  if (!t) return;
  const h1 = t.split("\n")[0]!;
  if (h1 === MEDICION_HEADER || !MEDICION_HEADER.startsWith(`${h1}\t`)) return;
  writeFileSync(f, `${MEDICION_HEADER}\n${t.slice(t.indexOf("\n") + 1)}`);
}

// ------------------------------------------------------------------------------------------- pa --bien

/** `pa --bien <id> si|no|parcial`: anotar si esa corrida salió bien (columna 13 de medicion.tsv). */
export async function cmdBien(pa: Pa, args: string[]): Promise<number> {
  const id = args[0] ?? "";
  const val = args[1] ?? "";
  if (!id || !/^(si|no|parcial)$/.test(val)) {
    pa.io.err("uso: pa --bien <id-de-corrida> si|no|parcial\n");
    return 2;
  }
  const f = path.join(pa.state, "medicion.tsv");
  if (!existsSync(f) || !statSync(f).isFile()) {
    pa.io.err(`pa: no hay ${f} todavía.\n`);
    return 1;
  }
  const hay = await conLock(pa, f, () => {
    const t = leerArchivo(f) ?? "";
    const ls = registros(t);
    // `awk '$2 == i {n++}'` mira también el header.
    if (!ls.some((l) => l.split("\t")[1] === id)) return false;
    const sal = ls.map((l, i) => {
      if (i === 0 || l.split("\t")[1] !== id) return l;
      const c = l.split("\t");
      while (c.length < 13) c.push("");
      c[12] = val;
      return c.join("\t");
    });
    writeFileSync(f, `${sal.join("\n")}\n`);
    return true;
  });
  if (!hay) {
    pa.io.err(`pa: no hay ninguna corrida '${id}' en ${f}.\n`);
    return 1;
  }
  pa.io.out(`pa: corrida ${id} anotada como '${val}'.\n`);
  return 0;
}

// ------------------------------------------------------------------------------------------- pa --bien-auto

/**
 * `reescribe_lineas`: ¿la integración a2..b2 cambió o borró alguna línea que escribieron los commits de a1..b1? (en el repo r).
 * 0 = sí, 1 = no, 2 = no se puede saber (falta algún commit).
 */
export async function reescribeLineas(r: string, a1: string, b1: string, a2: string, b2: string, env: NodeJS.ProcessEnv): Promise<0 | 1 | 2> {
  const g = (args: string[]) => git(["-C", r, ...args], { env });
  for (const x of [a1, b1, a2, b2]) if ((await g(["cat-file", "-e", `${x}^{commit}`])).codigo !== 0) return 2;
  const rl = await g(["rev-list", `${a1}..${b1}`]);
  if (rl.codigo !== 0) return 2;
  const mios = new Set(rl.salida.split("\n").filter(Boolean));
  if (!mios.size) return 1;
  const nombres = async (a: string, b: string) => {
    const d = await g(["-c", "core.quotePath=false", "diff", "--name-only", a, b]);
    return d.salida.split("\n").filter(Boolean);
  };
  const dos = new Set(await nombres(a2, b2));
  const comunes = [...new Set(await nombres(a1, b1))].filter((n) => dos.has(n)).sort();
  for (const f of comunes) {
    const d = await git(["--literal-pathspecs", "-C", r, "diff", "-U0", a2, b2, "--", f], { env });
    const rangos: string[] = [];
    for (const l of d.salida.split("\n")) {
      if (!l.startsWith("@@ ")) continue;
      const campo2 = l.split(/[ \t]+/)[1] ?? "";
      const [p1, p2] = campo2.split(",");
      const s = mas0((p1 ?? "").slice(1));
      const c = p2 === undefined || p2 === "" ? 1 : mas0(p2);
      if (c > 0) rangos.push(`-L${s},+${c}`);
    }
    if (!rangos.length) continue;
    const b = await git(["--literal-pathspecs", "-C", r, "blame", "--porcelain", ...rangos, a2, "--", f], { env });
    if (b.codigo !== 0) continue;
    const autores = new Set<string>();
    for (const l of b.salida.split("\n")) {
      const m = /^([0-9a-f]{40}) [0-9]/.exec(l);
      if (m) autores.add(m[1]!);
    }
    if ([...autores].some((a) => mios.has(a))) return 0;
  }
  return 1;
}

interface FilaHilo {
  id: string;
  origen: string;
  inicio: string;
  rama: string;
}
interface FilaInteg {
  id: string;
  accion: string;
  epoch: number;
  proyecto: string;
  antes: string;
  despues: string;
}

/** Los `.hilo` de las carpetas de proyecto del estado: id, origen, inicio y rama de cada uno. */
function leerHilos(state: string): FilaHilo[] {
  const salida: FilaHilo[] = [];
  let dirs: string[] = [];
  try {
    dirs = readdirSync(state).sort();
  } catch {
    return salida;
  }
  for (const d of dirs) {
    let archivos: string[] = [];
    try {
      if (!statSync(path.join(state, d)).isDirectory()) continue;
      archivos = readdirSync(path.join(state, d)).filter((n) => n.endsWith(".hilo")).sort();
    } catch {
      continue;
    }
    for (const n of archivos) {
      const f = path.join(state, d, n);
      try {
        if (!statSync(f).isFile()) continue;
      } catch {
        continue;
      }
      const t = leerArchivo(f);
      if (t === null) continue;
      const ls = registros(t);
      if (!ls.length) continue; // awk no abre un registro en un archivo vacío
      const h: FilaHilo = { id: n.replace(/\.hilo$/, ""), origen: "", inicio: "", rama: "" };
      for (const l of ls) {
        if (l.startsWith("origen=")) h.origen = l.slice(7);
        else if (l.startsWith("inicio=")) h.inicio = l.slice(7);
        else if (l.startsWith("rama=")) h.rama = l.slice(5);
      }
      salida.push(h);
    }
  }
  return salida;
}

/** Las filas de integradas.tsv como las lee el `while read` del bash (IFS tab: los tabuladores seguidos cuentan como uno). */
function leerIntegradas(f: string): FilaInteg[] {
  const t = leerArchivo(f);
  if (t === null) return [];
  const ls = t.split("\n");
  ls.pop(); // el `read` no entrega una última línea sin salto de línea
  const salida: FilaInteg[] = [];
  for (const l of ls) {
    const c = l.replace(/^\t+/, "").split(/\t+/);
    const [fecha = "", id = "", proyecto = "", , , antes = "", despues = "", , , accion = ""] = c;
    if (fecha === "fecha" || !id) continue;
    const epoch = epochDe(fecha);
    if (epoch === null) continue;
    salida.push({ id, accion, epoch, proyecto, antes, despues });
  }
  return salida;
}

/** `pa --bien-auto`: completa `bien`, `integrada` y `retrabajo` con lo que dice integradas.tsv. */
export async function cmdBienAuto(pa: Pa): Promise<number> {
  const f = path.join(pa.state, "medicion.tsv");
  if (!existsSync(f) || !statSync(f).isFile()) {
    pa.io.err(`pa: no hay ${f} todavía.\n`);
    return 1;
  }
  const num = (v: string | undefined, defecto: number) => (v !== undefined && /^[0-9]+$/.test(v) ? Number(v) : defecto);
  const dias = num(pa.env.PA_BIEN_DIAS || undefined, 7);
  const ahora = Math.floor(Date.now() / 1000);
  const lim = ahora - dias * 86400;
  const ven = num(pa.env.PA_RETRABAJO_HORAS || undefined, 48) * 3600;

  const hilos = leerHilos(pa.state);
  const integ = leerIntegradas(path.join(pa.state, "integradas.tsv"));
  const medTexto = leerArchivo(f) ?? "";

  // acc/ep/epi/jid…: lo que el awk saca de integradas.tsv (la última fila de cada id manda).
  const acc = new Map<string, string>();
  const ep = new Map<string, number>();
  const epi = new Map<string, number>();
  const js: { id: string; ep: number; pr: string; a: string; b: string }[] = [];
  const ult = new Map<string, number>();
  for (const r of integ) {
    acc.set(r.id, r.accion);
    ep.set(r.id, r.epoch);
    if (r.accion === "integrada") {
      epi.set(r.id, r.epoch);
      js.push({ id: r.id, ep: r.epoch, pr: r.proyecto, a: r.antes, b: r.despues });
      ult.set(r.id, js.length - 1);
    }
  }
  const org = new Map<string, string>();
  for (const h of hilos) org.set(h.id, h.origen);

  // Retrabajo por líneas: sólo las integradas que todavía tienen una fila con `retrabajo` vacío (header de hoy o el del archivo).
  const medLs = registros(medTexto);
  const col = (h: string): Record<string, number> => {
    const c: Record<string, number> = {};
    h.split("\t").forEach((k, i) => (c[k] = i + 1));
    return c;
  };
  const cH = col(medLs[0] ?? "");
  const falta = new Set<string>();
  for (const l of medLs.slice(1)) {
    const c = l.split("\t");
    if (c.length < 13 || esUno(c[5])) continue;
    const cr = cH.retrabajo ?? 0;
    if (cr && cr <= c.length && c[cr - 1] !== "") continue;
    const k = org.get(c[1]!) || c[1]!;
    if (acc.get(k) === "integrada") falta.add(k);
  }
  const par: { k: string; pj: string; a1: string; b1: string; a2: string; b2: string }[] = [];
  for (const k of falta) {
    const m = js[ult.get(k)!]!;
    if (m.a === m.b) continue;
    for (const j of js) if (j.id !== k && j.pr === m.pr && j.ep > m.ep && j.ep <= m.ep + ven && j.a !== j.b) par.push({ k, pj: m.pr, a1: m.a, b1: m.b, a2: j.a, b2: j.b });
  }
  const rutaDe = new Map<string, string>();
  const visto = new Map<string, string>();
  for (const p of par) {
    if (!p.k || visto.get(p.k) === "1") continue;
    if (!rutaDe.has(p.pj)) {
      let r = "";
      try {
        const x = resolverProyecto(nombreRegistry(pa, p.pj), pa.env);
        if (x.ok) r = x.ruta;
      } catch {
        r = "";
      }
      rutaDe.set(p.pj, r);
    }
    const r = rutaDe.get(p.pj)!;
    let rc: 0 | 1 | 2 = 2;
    if (r && esDirectorio(r)) rc = await reescribeLineas(r, p.a1, p.b1, p.a2, p.b2, pa.env as NodeJS.ProcessEnv);
    if (rc === 0) visto.set(p.k, "1");
    else if (rc === 2 && !visto.has(p.k)) visto.set(p.k, "?");
  }

  let cuenta = "";
  try {
    cuenta = await conLock(pa, f, () => {
      headerAlDia(f);
      return reescribirMedicion(f, { acc, ep, epi, hilos, visto, lim, ahora, ven });
    });
  } catch {
    pa.io.err(`pa: --bien-auto no pudo reescribir ${f}.\n`);
    return 1;
  }
  pa.io.out(`pa: --bien-auto: ${cuenta || "0 anotadas"}.\n`);
  // Lo descartado o retrabajado deja una lección corta en el proyecto (sin repetirse).
  try {
    await leccionesDeMedicion(pa, f);
  } catch {
    /* `|| true` */
  }
  return 0;
}

function esDirectorio(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

interface Datos {
  acc: Map<string, string>;
  ep: Map<string, number>;
  epi: Map<string, number>;
  hilos: FilaHilo[];
  visto: Map<string, string>;
  lim: number;
  ahora: number;
  ven: number;
}

/** El awk principal de cmd_bien_auto sobre medicion.tsv (ya con el header al día): reescribe el archivo y devuelve el resumen. */
function reescribirMedicion(f: string, d: Datos): string {
  const { acc, ep, epi, visto, lim, ahora, ven } = d;
  const ini = new Map<string, string>();
  const rama = new Map<string, string>();
  const seg = new Map<string, string>();
  const rs = new Set<string>();
  for (const h of d.hilos) {
    ini.set(h.id, h.inicio);
    rama.set(h.id, h.rama);
    if (h.origen !== "") {
      if (mas0(h.inicio) > mas0(seg.get(h.origen))) seg.set(h.origen, h.inicio);
      const e = epi.get(h.origen);
      if (e !== undefined && mas0(h.inicio) > e && mas0(h.inicio) <= e + ven) rs.add(h.origen);
    }
  }
  const org = new Map(d.hilos.map((h) => [h.id, h.origen] as const));

  const texto = leerArchivo(f) ?? "";
  const ls = registros(texto);
  const salida: string[] = [];
  let ci = 0;
  let cr = 0;
  const n: Record<string, number> = { si: 0, parcial: 0, no: 0 };
  let t = 0;
  let m = 0;
  ls.forEach((linea, idx) => {
    if (idx === 0) {
      const c: Record<string, number> = {};
      linea.split("\t").forEach((k, i) => (c[k] = i + 1));
      ci = c.integrada ?? 0;
      cr = c.retrabajo ?? 0;
      salida.push(linea);
      return;
    }
    const campos = linea.split("\t");
    if (linea === "" || campos.length < 13) {
      salida.push(linea);
      return;
    }
    let cambio = false;
    const id = campos[1]!;
    const k = org.get(id) || id;
    const i0 = mas0(ini.get(id));
    const cub = acc.has(k) && i0 <= (ep.get(k) ?? 0);
    if (campos[12] === "" && cub) {
      const e = ep.get(k) ?? 0;
      let v = "";
      const a = acc.get(k);
      if (a === "revertida" || a === "descartada") v = "no";
      else if (a === "integrada" && e <= lim) v = mas0(seg.get(k)) > e ? "parcial" : "si";
      if (v !== "") {
        campos[12] = v;
        n[v]!++;
        t++;
        cambio = true;
      }
    }
    if (ci && cr && !esUno(campos[5])) {
      const vi = ci <= campos.length ? campos[ci - 1]! : "";
      const vr = cr <= campos.length ? campos[cr - 1]! : "";
      let ni = vi;
      let nr = vr;
      if (cub) {
        const a = acc.get(k);
        if (a === "descartada") {
          if (vi === "") ni = "0";
        } else if (a === "revertida") {
          ni = "1";
          nr = "1";
        } else if (a === "integrada") {
          ni = "1";
          if (vr === "") {
            if (visto.get(k) === "1" || rs.has(k)) nr = "1";
            else if (visto.get(k) !== "?" && ahora > (epi.get(k) ?? 0) + ven) nr = "0";
          }
        }
      } else if (!acc.has(k) && vi === "" && (rama.get(id) ?? "") !== "" && i0 > 0 && ahora > i0 + ven) ni = "0";
      if (ni !== vi || nr !== vr) {
        while (campos.length < Math.max(ci, cr)) campos.push("");
        campos[ci - 1] = ni;
        campos[cr - 1] = nr;
        m++;
        cambio = true;
      }
    }
    salida.push(cambio ? campos.join("\t") : linea);
  });
  writeFileSync(f, `${salida.join("\n")}\n`);
  return `${t} anotadas (si: ${n.si}, parcial: ${n.parcial}, no: ${n.no}); integrada/retrabajo: ${m} fila(s)`;
}
