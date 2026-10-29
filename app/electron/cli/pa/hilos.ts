// `pa --hilos [--json] [--todo]` (cmd_hilos de motor/bin/pa): el contrato JSON de las corridas para la app. Lectura pura: no toma locks
// ni toca nada (pasa con modelo local). Un «hilo» es una corrida: su `.hilo` (o, en las de antes del `.hilo`, lo que quede de
// `.corrida`/`.json`) más su estado de ahora. El bash junta los hechos y UN jq arma la salida; acá es todo TypeScript (en Windows no
// hay jq), con las mismas reglas: `//` sólo cae con null (un "" cuenta), `.[a:b]` cuenta caracteres y el JSON sale con sangría de 2.
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import path from "node:path";
import { registroProyectos } from "../../rutas.ts";
import { git } from "../base/git.ts";
import { resolverProyecto } from "../proyecto-ruta.ts";
import { carpetasDeProyecto, esArchivo, kill0, leerCampo, listar, nombreRegistry, runningVivo, vive } from "./corridas.ts";
import type { Pa } from "./entorno.ts";
import { carpetaProyectosClaude } from "./worktrees.ts";

export type J = Record<string, unknown>;

// ---------------------------------------------------------------- piezas de jq

/** `.[a:b]` de un string: por caracteres (no por unidades UTF-16). */
export const cortar = (s: string, a: number, b: number) => [...s].slice(a, b).join("");

/** `nonempty`: null si es null o "". */
export const noVacio = <T>(v: T | null | undefined): T | null => (v === null || v === undefined || (v as unknown) === "" ? null : v);

/** `num`: el número de un texto (`tonumber?`), o null. */
export function num(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v !== "string" || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** `tostring`. */
export const comoString = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v) ?? "null");

/** `trim_` de JQ_DECISION. */
export const trimJq = (s: string) => s.replace(/^\s+/, "").replace(/\s+$/, "");

/** `get` seguro: v.a.b.c (undefined si algo no es objeto). */
export function ruta(v: unknown, ...ks: string[]): unknown {
  let x = v;
  for (const k of ks) {
    if (x === null || typeof x !== "object" || Array.isArray(x)) return undefined;
    x = (x as J)[k];
  }
  return x;
}

/** `decision_de` de JQ_DECISION: la DECISION del último bloque del texto. */
export function decisionDe(texto: string): string {
  const l = texto.split("\n");
  let a = -1;
  l.forEach((x, i) => {
    if (/^[*#> \t-]*DECISI(?:O|Ó)N\*{0,}:/.test(x)) a = i;
  });
  let t: string;
  if (a >= 0) {
    const resto = l[a]!.replace(/^[*#> \t-]*DECISI(?:O|Ó)N\*{0,}:\*{0,}/, "");
    if (/^[ \t]*$/.test(resto)) {
      let acc = "";
      for (const x of l.slice(a + 1)) {
        if (/^[*#> \t-]*SIGUE\*{0,}:/.test(x)) break;
        if (/^[ \t]*$/.test(x)) {
          if (acc !== "") break;
        } else acc = acc === "" ? x : `${acc} ${x}`;
      }
      t = acc;
    } else t = resto;
  } else {
    const ms = l.filter((x) => /DECISI(?:O|Ó)N\*{0,}:/.test(x));
    const m = ms[ms.length - 1];
    t = m === undefined ? "" : (m.split(/DECISI(?:O|Ó)N\*{0,}:\*{0,}/).pop() ?? "");
  }
  t = t.replace(/[*#> \t-]*SIGUE\*{0,}:.*$/, "").replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
  return cortar(t, 0, 400);
}

/** `decision_es_nada`. */
export const decisionEsNada = (s: string) => trimJq(s.replace(/\*/g, "")).replace(/\.$/, "").replace(/[A-Z]/g, (c) => c.toLowerCase()) === "nada";

// ---------------------------------------------------------------- archivos clave=valor y transcripts

/** `campos` del jq: las líneas `clave=valor` (clave en minúsculas y `_`) de un texto; la última repetida gana. */
export function campos(texto: string): Record<string, string> {
  const r: Record<string, string> = {};
  for (const l of texto.split("\n")) {
    const m = /^([a-z_]+)=(.*)$/.exec(l);
    if (m) r[m[1]!] = m[2]!;
  }
  return r;
}

const leerOpt = (f: string): string | null => {
  try {
    return readFileSync(f, "utf8");
  } catch {
    return null;
  }
};
/** `[[ -s f ]]` + leerlo entero. */
const contenido = (f: string): string | null => {
  const t = leerOpt(f);
  return t ? t : null;
};

/** Las primeras `n` líneas de un archivo (sin leerlo entero). */
export function primerasLineas(f: string, n: number): string[] {
  let fd: number;
  try {
    fd = openSync(f, "r");
  } catch {
    return [];
  }
  try {
    const trozos: Buffer[] = [];
    let saltos = 0;
    for (;;) {
      const b = Buffer.alloc(65536);
      const k = readSync(fd, b, 0, b.length, null);
      if (k <= 0) break;
      const t = b.subarray(0, k);
      trozos.push(t);
      for (const c of t) if (c === 10) saltos++;
      if (saltos >= n) break;
    }
    const ls = Buffer.concat(trozos).toString("utf8").split("\n");
    if (ls[ls.length - 1] === "") ls.pop();
    return ls.slice(0, n);
  } catch {
    return [];
  } finally {
    closeSync(fd);
  }
}

/** `tail -n N`: las últimas `n` líneas de un archivo (sin leerlo entero). */
export function ultimasLineas(f: string, n: number): string[] {
  let fd: number;
  try {
    fd = openSync(f, "r");
  } catch {
    return [];
  }
  try {
    let pos = fstatSync(fd).size;
    const trozos: Buffer[] = [];
    let saltos = 0;
    while (pos > 0 && saltos <= n) {
      const len = Math.min(262144, pos);
      pos -= len;
      const b = Buffer.alloc(len);
      readSync(fd, b, 0, len, pos);
      trozos.unshift(b);
      for (const c of b) if (c === 10) saltos++;
    }
    let t = Buffer.concat(trozos).toString("utf8");
    if (pos > 0) t = t.slice(t.indexOf("\n") + 1);
    const ls = t.split("\n");
    if (ls[ls.length - 1] === "") ls.pop();
    return ls.slice(-n);
  } catch {
    return [];
  } finally {
    closeSync(fd);
  }
}

/** El transcript `$PROJ/*\/<sid>.jsonl` de una sesión (el primero), o "". */
export function transcriptDe(pa: Pa, sid: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(sid)) return "";
  const proj = carpetaProyectosClaude(pa);
  for (const d of listar(proj)) {
    const t = path.join(proj, d, `${sid}.jsonl`);
    if (esArchivo(t)) return t;
  }
  return "";
}

const parse = (l: string): unknown => {
  try {
    return JSON.parse(l);
  } catch {
    return undefined;
  }
};
const esObj = (v: unknown): v is J => v !== null && typeof v === "object" && !Array.isArray(v);

// ---------------------------------------------------------------- tiempo

const dos = (n: number) => String(n).padStart(2, "0");
/** `date +%Y%m%d-%H%M%S` en hora local. */
const sello = (d: Date) => `${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}-${dos(d.getHours())}${dos(d.getMinutes())}${dos(d.getSeconds())}`;

/** `strptime("%Y%m%d-%H%M%S") | mktime`: segundos como si el texto fuera UTC; null si no es una fecha. */
function comoUtc(t: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(t);
  if (!m) return null;
  const [a, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 61) return null;
  return Date.UTC(a, mo - 1, d, h, mi, s) / 1000;
}

/** `fromdateiso8601` de «2026-10-28T10:10:10Z» (con o sin fracción). */
function deIso(t: unknown): number | null {
  if (typeof t !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(t);
  if (!m) return null;
  const [a, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  return Date.UTC(a, mo - 1, d, h, mi, s) / 1000;
}

// ---------------------------------------------------------------- los hechos de cada corrida

const ID_RE = /^[0-9]{8}-[0-9]{6}-[0-9]+$/;

interface Hecho {
  id: string;
  slug: string;
  dir: string;
  vivo: string;
  enCola: boolean;
  iniRun: string;
  tareaRun: string;
  acc: string;
  listo: boolean;
  leer: boolean;
  commits: string;
  ppal: string;
  trans: string;
  sid: string;
  /** El primer mensaje del usuario y el final del transcript (200 líneas), como las deja el bash en su caché. */
  cache: string[];
}

class Hilos {
  readonly now = Math.floor(Date.now() / 1000);
  readonly corte: string;
  readonly runDe = new Map<string, string>();
  readonly accDe = new Map<string, string>();
  private readonly rutaDe = new Map<string, string>();
  private readonly refsDe = new Set<string>();

  readonly pa: Pa;
  constructor(pa: Pa) {
    this.pa = pa;
    const d = new Date(this.now * 1000);
    d.setDate(d.getDate() - 7);
    this.corte = sello(d);
    for (const n of listar(pa.state, (x) => x.endsWith(".running") && x.length > 8)) {
      const f = path.join(pa.state, n);
      const k = leerCampo(f, "id");
      if (k && runningVivo(f)) this.runDe.set(k, f);
    }
    const t = leerOpt(path.join(pa.state, "integradas.tsv"));
    if (t) {
      t.split("\n").forEach((l, i) => {
        if (i === 0 || !l) return;
        const c = l.split("\t");
        if (c[1]) this.accDe.set(c[1], c[9] ?? "");
      });
    }
  }

  /** `ruta_ppal`: el tree principal de un proyecto (por slug), con sus ramas pa/<slug>/* a mano. */
  async rutaPpal(slug: string): Promise<string> {
    const c = this.rutaDe.get(slug);
    if (c !== undefined) return c;
    const { pa } = this;
    let r = "";
    try {
      const res = resolverProyecto(nombreRegistry(pa, slug), pa.env, registroProyectos(pa.env, pa.home, pa.plat));
      r = res.ok ? res.ruta : "";
    } catch {
      r = "";
    }
    this.rutaDe.set(slug, r);
    if (r) {
      const g = await git(["for-each-ref", "--format=%(refname:short)", `refs/heads/pa/${slug}/`], { cwd: r, env: pa.env });
      if (g.codigo === 0) for (const ref of g.salida.split("\n")) if (ref) this.refsDe.add(`${slug}/${ref}`);
    }
    return r;
  }
  tieneRef = (slug: string, rama: string) => this.refsDe.has(`${slug}/${rama}`);

  /** `pid_en_cola`: el pid de `$id.pid` vive pero no hay `.running`. */
  enCola(d: string, id: string): boolean {
    const l = leerLinea(path.join(d, `${id}.pid`));
    return l !== null && /^[0-9]+$/.test(l) && kill0(l) && vive(l);
  }

  /** `en_ventana`: lo vivo, lo no cobrado, lo que tiene una rama viva sin integrar ni descartar ni archivar, y los últimos 7 días. */
  async enVentana(s: string, d: string, id: string): Promise<boolean> {
    if (!(id < this.corte) || this.runDe.has(id)) return true;
    if (this.enCola(d, id)) return true;
    if (!existsSync(path.join(d, `${id}.corrida`)) || this.accDe.get(id)) return false;
    const rama = leerCampo(path.join(d, `${id}.corrida`), "rama");
    if (!rama) return false;
    if (leerCampo(path.join(d, `${id}.hilo`), "archivado")) return false;
    await this.rutaPpal(s);
    return this.tieneRef(s, rama);
  }

  /** `hechos_de`: lo que el jq no puede ver. */
  async hechos(s: string, d: string, id: string, mtimes: string[]): Promise<Hecho> {
    const r = this.runDe.get(id);
    let vivo = "";
    let enCola = false;
    let iniRun = "";
    let tareaRun = "";
    if (r) {
      vivo = "trabajando";
      const ep = leerCampo(r.replace(/\.running$/, ".heartbeat"), "epoch");
      if (/^[0-9]+$/.test(ep) && this.now - Number(ep) > 600) vivo = "colgado";
      iniRun = leerCampo(r, "inicio");
      tareaRun = leerCampo(r, "tarea").replace(/\x1f/g, " ");
    } else if (this.enCola(d, id)) {
      vivo = "trabajando";
      enCola = true;
    }
    const corrida = path.join(d, `${id}.corrida`);
    const hilo = path.join(d, `${id}.hilo`);
    const rama = leerCampo(corrida, "rama") || leerCampo(hilo, "rama");
    const ppal = await this.rutaPpal(s);
    let commits = "";
    if (rama && ppal && this.tieneRef(s, rama)) {
      const g = await git(["rev-list", "--count", `HEAD..${rama}`], { cwd: ppal, env: this.pa.env });
      if (g.codigo === 0) commits = g.salida.replace(/\n+$/, "");
    }
    let sid = leerLinea(path.join(d, `${id}.sid`)) ?? "";
    if (!sid) {
      const x = contenido(path.join(d, `${id}.json`));
      const m = x === null ? null : /"session_id":"([A-Za-z0-9._-]+)"/.exec(x);
      if (m) sid = m[1]!;
    }
    let trans = "";
    const cache: string[] = [];
    if (/^[A-Za-z0-9._-]+$/.test(sid)) {
      trans = transcriptDe(this.pa, sid);
      if (trans) {
        const u = primerasLineas(trans, 30).find((l) => l.includes('"type":"user"'));
        if (u !== undefined) cache.push(u);
        for (const l of ultimasLineas(trans, 200)) if (l.includes('"type":"assistant"')) cache.push(l);
      }
    }
    if (!vivo && !this.accDe.get(id)) {
      for (const t of [path.join(d, `${id}.log`), path.join(d, `${id}.json`), path.join(d, `${id}.err`), trans]) if (t && existsSync(t)) mtimes.push(t);
    }
    return {
      id,
      slug: s,
      dir: d,
      vivo,
      enCola,
      iniRun,
      tareaRun,
      acc: this.accDe.get(id) ?? "",
      listo: existsSync(path.join(d, `${id}.listo`)),
      leer: existsSync(path.join(d, `${id}.leer`)),
      commits,
      ppal,
      trans,
      sid,
      cache,
    };
  }
}

/** `linea_rapida`: la primera línea de un archivo, o null si no hay nada. */
function leerLinea(f: string): string | null {
  const t = leerOpt(f);
  if (t === null) return null;
  const l = t.split("\n")[0]!;
  return l === "" && t.length === 0 ? null : l;
}

// ---------------------------------------------------------------- el armado del jq

/** Un hilo: el objeto de la salida (con las claves en el orden del jq). */
function armar(h: Hecho, mtimes: Map<string, number>, ahora: number, offs: number, ultSid: Map<string, string>): J {
  const hp = leerOpt(path.join(h.dir, `${h.id}.hilo`));
  const cp = leerOpt(path.join(h.dir, `${h.id}.corrida`));
  const jp = contenido(path.join(h.dir, `${h.id}.json`));
  const H = hp ? campos(hp) : {};
  const C = cp ? campos(cp) : {};
  const jj = jp === null ? null : parse(jp);
  const Jo: J | null = esObj(jj) ? jj : null;
  const result = Jo === null ? null : (Jo.result ?? null);
  const dec: string | null = H.decision ?? (Jo === null ? null : decisionDe(comoString(result ?? "")));
  const dnada: string | null = H.decision_nada ?? (H.decision === undefined && dec !== null ? (decisionEsNada(dec) ? "1" : "0") : null);
  const ini: number | null = num(H.inicio) ?? num(h.iniRun) ?? (() => {
    const u = comoUtc(h.id.slice(0, 15));
    return u === null ? null : u - offs;
  })();
  const esLeer = (H.leer ?? C.leer) === "1" || h.leer;
  // el modelo con más tokens de salida (en un empate, el último)
  let modelo: string | null = noVacio(H.modelo);
  if (modelo === null && Jo !== null) {
    const mu = Jo.modelUsage;
    let mejor: string | null = null;
    let mejorV = -Infinity;
    if (esObj(mu)) {
      for (const [k, v] of Object.entries(mu)) {
        const t = ruta(v, "outputTokens");
        const n = typeof t === "number" ? t : 0;
        if (n >= mejorV) {
          mejor = k;
          mejorV = n;
        }
      }
    }
    modelo = mejor;
  }
  // caché: el último mensaje del asistente (no sidechain) que creó caché da el TTL y la hora
  const msgs = h.cache.map(parse).filter(esObj);
  const as = msgs.filter((m) => m.type === "assistant" && m.isSidechain !== true);
  const pos = (m: J, k: string) => {
    const v = ruta(m, "message", "usage", "cache_creation", k);
    return typeof v === "number" && v > 0;
  };
  const cc = [...as].reverse().find((m) => pos(m, "ephemeral_1h_input_tokens") || pos(m, "ephemeral_5m_input_tokens")) ?? null;
  const ttl0 = cc === null ? null : pos(cc, "ephemeral_1h_input_tokens") ? 3600 : 300;
  const iso = cc === null ? null : deIso(cc.timestamp);
  const vence = ttl0 === null || iso === null ? null : Math.floor(iso + ttl0);
  const ttl = vence === null ? null : ttl0;
  const primerUser = msgs.find((m) => m.type === "user");
  let tareaT: string | null = null;
  if (primerUser) {
    const c = ruta(primerUser, "message", "content");
    const t = typeof c === "string" ? c : Array.isArray(c) ? c.filter((e) => esObj(e) && e.type === "text").map((e) => ((e as J).text === null || (e as J).text === undefined ? "" : String((e as J).text))).join(" ") : "";
    tareaT = noVacio(cortar(trimJq(t.replace(/\s+/g, " ")), 0, 500));
  }
  const u: J = as.length ? as[as.length - 1]! : {};
  const cmod = ttl === null ? null : noVacio(ruta(u, "message", "model") as string | null | undefined);
  const esperado = (noVacio(C.ruta_trabajo) ?? h.ppal).replace(/\/$/, "");
  const cwd = typeof u.cwd === "string" ? u.cwd : "";
  let frio: string | null = null;
  if (ttl !== null) {
    if (ahora >= vence!) frio = "vencido";
    else if (modelo !== null && cmod !== null && cmod !== modelo) frio = "modelo";
    else if (cwd !== "" && esperado !== "" && cwd.replace(/\/$/, "") !== esperado) frio = "otro_dir";
  }
  const reciente = h.listo && ini !== null && ahora - ini < 86400;
  let estado: string;
  if (h.vivo !== "") estado = h.vivo;
  else if (noVacio(H.archivado) !== null) estado = "archivado";
  else if (h.acc === "integrada") estado = "integrado";
  else if (h.acc === "revertida") estado = "revertido";
  else if (h.acc === "descartada") estado = "descartado";
  else if (Jo === null) estado = "murio";
  else if (noVacio(dec) !== null && dnada !== "1" && (reciente || (noVacio(H.lanzo) ?? "jefe") !== "jefe")) estado = "decision";
  else if (reciente) estado = "listo";
  else estado = "entregado";
  // Cuándo murió: exacta si pa la vio terminar (`fin=`); si no, lo último que se movió de lo suyo, y sin nada de eso, el inicio.
  const fin = num(H.fin);
  let murioEn: number | null = null;
  if (estado === "murio") {
    if (fin !== null) murioEn = fin;
    else {
      const ms = [`${h.dir}/${h.id}.log`, `${h.dir}/${h.id}.json`, `${h.dir}/${h.id}.err`, h.trans !== "" && ultSid.get(h.sid) === h.id ? h.trans : ""]
        .map((k) => (k ? mtimes.get(k) : undefined))
        .filter((x): x is number => x !== undefined);
      murioEn = ms.length ? Math.max(...ms) : ini;
    }
  }
  let duracion: number | null = null;
  if (h.vivo !== "" && ini !== null) duracion = Math.floor(ahora - ini);
  else if (Jo !== null && typeof Jo.duration_ms === "number") duracion = Math.floor(Jo.duration_ms / 1000);
  let resultado: string | null = null;
  const rs = comoString(result ?? "");
  if (rs.includes("RESULTADO:")) {
    const m = /RESULTADO:\**\s*([\s\S]*)/.exec(rs);
    const r = (m?.[1] ?? "").split("ARCHIVOS:")[0]!.split("DECISI")[0]!;
    resultado = noVacio(cortar(trimJq(r.replace(/\s+/g, " ")), 0, 200));
  }
  return {
    id: h.id,
    proyecto: h.slug,
    tarea: noVacio(H.tarea) ?? noVacio(h.tareaRun) ?? tareaT,
    modelo,
    effort: noVacio(H.effort),
    cuenta: noVacio(H.cuenta),
    origen: noVacio(H.lanzo) ?? "jefe",
    sigue_de: noVacio(H.origen) ?? noVacio(C.origen),
    jefe: noVacio(H.jefe) ?? noVacio(C.jefe),
    jefe_id: noVacio(H.jefe_id) ?? noVacio(C.jefe_id),
    estado,
    en_cola: h.enCola,
    murio_en: murioEn,
    murio_en_exacta: estado === "murio" ? fin !== null : null,
    inicio: ini,
    duracion_s: duracion,
    puesto: esLeer ? null : (noVacio(H.puesto) ?? noVacio(C.puesto)),
    espera_s: num(H.espera),
    rama: noVacio(C.rama) ?? noVacio(H.rama),
    commits: num(h.commits),
    decision: noVacio(dec),
    decision_nada: dnada === null ? null : dnada === "1",
    sigue: noVacio(H.sigue),
    verificado: noVacio(H.verificado) === null ? null : H.verificado === "1",
    resultado,
    archivado: noVacio(H.archivado),
    leer: esLeer,
    cache_ttl_s: ttl,
    cache_vence: vence,
    cache_frio: frio,
    cache_modelo: cmod,
  };
}

/** `@tsv`: escapa la barra, el tab y los saltos. */
const tsv = (s: string) => s.replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r");

export async function cmdHilos(pa: Pa, args: string[]): Promise<number> {
  let json = false;
  let todo = false;
  for (const a of args) {
    if (a === "--json") json = true;
    else if (a === "--todo") todo = true;
    else {
      pa.io.err("uso: pa --hilos [--json] [--todo]\n");
      return 2;
    }
  }
  const H = new Hilos(pa);
  const mtimes = new Map<string, number>();
  const rutas: string[] = [];
  const hechos: Hecho[] = [];
  const visto = new Set<string>();
  for (const s of carpetasDeProyecto(pa.state)) {
    if (s === "jefe") continue;
    const d = path.join(pa.state, s);
    for (const ext of [".hilo", ".corrida", ".json", ".pid", ".cola"]) {
      for (const n of listar(d, (x) => x.endsWith(ext) && x.length > ext.length)) {
        const id = n.slice(0, -ext.length);
        if (!ID_RE.test(id) || visto.has(`${s}/${id}`)) continue;
        visto.add(`${s}/${id}`);
        if (!todo && !(await H.enVentana(s, d, id))) continue;
        hechos.push(await H.hechos(s, d, id, rutas));
      }
    }
  }
  for (const r of rutas) {
    try {
      mtimes.set(r, Math.floor(statSync(r).mtimeMs / 1000));
    } catch {
      /* se borró en el medio */
    }
  }
  // la última corrida de cada sesión: un --seguir escribe en el MISMO transcript que la que retoma
  const ultSid = new Map<string, string>();
  for (const h of hechos) if (h.sid && (ultSid.get(h.sid) ?? "") < h.id) ultSid.set(h.sid, h.id);
  const offs = -new Date().getTimezoneOffset() * 60;
  const hilos = hechos.map((h) => armar(h, mtimes, H.now, offs, ultSid));
  hilos.sort((a, b) => ((a.id as string) < (b.id as string) ? -1 : (a.id as string) > (b.id as string) ? 1 : 0));
  hilos.reverse();
  if (json) pa.io.out(`${JSON.stringify({ version: 1, hilos }, null, 2)}\n`);
  else
    for (const h of hilos) {
      const t = (h.tarea as string | null) ?? (h.resultado as string | null) ?? "";
      pa.io.out(`${[h.id, h.estado, h.proyecto, cortar(t, 0, 70)].map((x) => tsv(String(x))).join("\t")}\n`);
    }
  return 0;
}
