// modelos.json, el contrato compartido con Trama, tal como lo lee motor/bin/pa (modelos_cargar, modelos_worker, modelos_clave,
// excluido_por, efforts_permitidos_de, effort_apagado, gemini_politica, modelos_reparto): qué modelo usa cada `--tipo` sin `-m`,
// qué modelos o efforts apagó el dueño y qué hacer sin cupo. Sin el archivo todo es como antes; uno roto avisa en una línea
// por stderr y se ignora entero.
//
// El aviso de archivo roto se repite como en el bash: allá cada `$(…)` es un subshell que vuelve a leer el archivo si el shell
// principal todavía no lo leyó, así que un archivo roto avisa una vez por cada consulta hasta la primera lectura «de verdad»
// (`cargar(false)`). Las consultas de acá llaman `cargar(true)` (las del bash van siempre dentro de `$(…)`).
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { configTrama, homeDe, plataformaActual, type Plataforma } from "../../rutas.ts";
import { CODEX_RESPALDO, CODEX_SLUGS_EXTRA_RESPALDO, familiaCodexDeSlug, leerCodexModelos, resolverCodexPedido } from "../codex-modelos.ts";
import {
  NOTA_PCT_DEFECTO,
  NOTA_PCT_MAX,
  NOTA_PCT_MIN,
  NOTA_TAREA_PCT_DEFECTO,
  NOTA_TAREA_PCT_MAX,
  NOTA_TAREA_PCT_MIN,
  notaPctValido,
  notaTareaPctValido,
} from "../../modelos-tipos.ts";
import type { Env, Io } from "./entorno.ts";

export const TIPOS_VALIDOS = "mecanico|lectura|codigo-acotado|codigo-multi|frontend|diseno|debug|final";
export const GEMINI_MODELOS =
  "gemini-4-neon-(low|medium|high|xhigh)|gemini-4-argon-(low|medium|high)|gemini-4-hydrogen-(low|medium|high|xhigh)|agy:(claude-(opus|sonnet)-5-5-(low|medium|high)|gpt-oss-120b-medium)";
export const CODEX_MODELOS = `codex:(${[...CODEX_RESPALDO.map((m) => m.slug), ...CODEX_SLUGS_EXTRA_RESPALDO].map((s) => s.replace(/\./g, "\\.")).join("|")})-(low|medium|high)`;
export const DSH_MODELOS = "dsh:(ollama|opencode|deepseek)/\\S+";
export const OC_MODELOS = "opencode:[A-Za-z0-9][A-Za-z0-9._-]*/\\S+";
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
/** Familias que se reconocen dentro de un id (excluir y efforts_permitidos; la misma lista que reparto). */
const FAMILIAS_BASE = ["fable", "opus", "sonnet", "haiku", "neon", "argon", "hydrogen", "gpt-oss", "astra", "sol", "luna", "terra"];
const familiasCodex = (env?: Env, home?: string, plat?: Plataforma) => [
  ...new Set([...FAMILIAS_BASE, ...leerCodexModelos({ env, home, plat }).map((m) => familiaCodexDeSlug(m.slug))]),
];

/** `[[ x =~ ^(re)$ ]]` del bash. */
export const calza = (re: string, x: string) => new RegExp(`^(${re})$`).test(x);

// Predicados de motor (es_gemini, es_codex, es_dsh, es_opencode, es_local): sin distinguir mayúsculas, como `${1,,}`.
export const esGemini = (m: string) => /^(gemini|agy:)/.test(m.toLowerCase());
export const esCodex = (m: string) => m.toLowerCase().startsWith("codex:");
export const esOpencode = (m: string) => m.toLowerCase().startsWith("opencode:");
export const esDsh = (m: string) => /^(dsh|opencode):/.test(m.toLowerCase());
export const esLocal = (m: string) => m.toLowerCase().startsWith("ollama:");

type Json = unknown;
const tipo = (x: Json): string => (x === null || x === undefined ? "null" : Array.isArray(x) ? "array" : typeof x);
const esObjeto = (x: Json): x is Record<string, Json> => tipo(x) === "object";
/** `tojson` de jq (lo que falta es null). */
const tojson = (x: Json) => JSON.stringify(x === undefined ? null : x);
/** `tostring` de jq. */
const tostring = (x: Json) => (typeof x === "string" ? x : tojson(x));
/** `ascii_downcase` de jq. */
const asciiMinus = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
/** jq `.x?` sobre algo que no es objeto ni null no da nada (la interpolación entera desaparece). */
const campoOpcional = (x: Json, k: string): { hay: boolean; v?: Json } =>
  esObjeto(x) ? { hay: true, v: x[k] } : x === null || x === undefined ? { hay: true, v: null } : { hay: false };

/** Workers vivos por grupo de cupo (`tope_vivos`): default y máximo que acepta Ajustes. 0 = sin tope. */
export const TOPE_VIVOS_DEFECTO = 3;
export const TOPE_VIVOS_MAX = 50;
const topeEntero = (x: Json) => typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= TOPE_VIVOS_MAX;
const topeVivosValido = (x: Json) =>
  topeEntero(x) || (esObjeto(x) && Object.keys(x).length > 0 && Object.values(x).every(topeEntero));

/** El `tope_vivos` ya leído: el de los grupos que no se nombran y el de cada grupo (0 = sin tope en ese grupo). */
export interface TopeVivos {
  defecto: number;
  porGrupo: Record<string, number>;
}

/**
 * El tope que rige a un grupo de cupo (`claude-oficial`, `gemini-4-argon`, `codex`… con `@<cuenta>` si la cuenta no es la de siempre), o
 * `null` si ese grupo no tiene (0, o un grupo desconocido para reparto: Ollama y NVIDIA). Se busca el grupo con su cuenta, el grupo
 * solo, su proveedor (lo anterior al primer guion: `claude` rige a `claude-oficial`) y por último `*`.
 */
export function topeDeGrupo(t: TopeVivos, grupo: string | null): number | null {
  if (!grupo) return null;
  const solo = grupo.split("@")[0]!;
  const n = [grupo, solo, solo.split("-")[0]!].map((k) => t.porGrupo[k]).find((v) => v !== undefined) ?? t.defecto;
  return n > 0 ? n : null;
}

/** El primer problema de un modelos.json ya parseado, en el orden del jq de modelos_cargar ("" = vale). */
export function problemaModelos(c: Json, opts?: { env?: Env; home?: string; plat?: Plataforma }): string {
  if (!esObjeto(c)) return "no es un objeto JSON";
  const L = Array.isArray(c.locales) ? c.locales : [];
  const ids = L.filter(esObjeto).map((l) => l.id).filter((x): x is string => typeof x === "string");
  const modok = (m: Json) =>
    typeof m === "string" &&
    (/^claude-[a-z0-9][a-z0-9.-]*$/.test(m) ||
      /^agy:[a-z0-9][a-z0-9.-]*$/.test(m) || // un modelo que ofrece el agy de la cuenta (el catálogo cambia): si no existe, agy lo rechaza al lanzar y pa relanza
      calza(GEMINI_MODELOS, m) ||
      (m === m.toLowerCase() && resolverCodexPedido(m, opts) !== null) ||
      calza(DSH_MODELOS, m) ||
      calza(OC_MODELOS, m) ||
      (m.startsWith("ollama:") && ids.includes(m)));
  const efok = (e: Json) => e === null || e === undefined || (typeof e === "string" && (EFFORTS as readonly string[]).includes(e));
  const frac = (x: Json) => typeof x === "number" && x >= 0 && x < 1;
  const acok = (x: Json) => x === null || x === undefined || (typeof x === "number" && Number.isInteger(x) && x >= 100000 && x <= 1000000);
  const nulo = (x: Json) => x === null || x === undefined;

  if (c.version !== 1) return `version ${tojson(c.version)} (pa entiende 1)`;
  if (!nulo(c.locales) && !Array.isArray(c.locales)) return "locales no es una lista";
  for (const l of L) {
    const mal =
      !esObjeto(l) ||
      typeof l.id !== "string" ||
      !l.id.startsWith("ollama:") ||
      typeof l.url !== "string" ||
      !/^https?:\/\/[^ ]+$/.test(l.url) ||
      typeof l.modelo !== "string" ||
      l.modelo === "";
    if (mal) {
      const id = esObjeto(l) && l.id !== null && l.id !== undefined && l.id !== false ? l.id : l;
      return `local mal armado: ${tojson(id)} (hace falta id ollama:…, url http://… y modelo)`;
    }
  }
  if (!nulo(c.workers) && !esObjeto(c.workers)) return "workers no es un objeto";
  if (esObjeto(c.workers)) {
    for (const [k, v] of Object.entries(c.workers)) {
      if (!calza(`default|${TIPOS_VALIDOS}`, k)) return `tipo de worker desconocido: ${k}`;
      if (!esObjeto(v) || !modok(v.modelo)) {
        const m = campoOpcional(v, "modelo");
        if (m.hay)
          return `workers.${k}: modelo desconocido ${tojson(m.v)} (claude-…, gemini-…, agy:… o codex:… de pa, dsh:<ollama|opencode|deepseek>/<modelo>, opencode:<proveedor>/<modelo> u ollama:… que esté en locales)`;
      }
      if (esObjeto(v) && !efok(v.effort)) return `workers.${k}: effort ${tojson(v.effort)} no existe`;
    }
  }
  if (!nulo(c.reparto) && !/^(auto|fijo)$/.test(tostring(c.reparto))) return `reparto ${tojson(c.reparto)} (auto o fijo)`;
  if (!nulo(c.lider) && (!esObjeto(c.lider) || !modok(c.lider.modelo))) {
    const m = campoOpcional(c.lider, "modelo");
    if (m.hay) return `lider: modelo desconocido ${tojson(m.v)}`;
  }
  if (!nulo(c.gemini) && !esObjeto(c.gemini)) return "gemini no es un objeto";
  if (!nulo(c.reserva)) {
    const r = c.reserva;
    const ok =
      frac(r) ||
      (esObjeto(r) && Object.keys(r).length > 0 && Object.keys(r).every((k) => k === "5h" || k === "7d") && Object.values(r).every(frac));
    if (!ok) return `reserva ${tojson(r)} (un número de 0 a 1, {"5h":…,"7d":…} o null)`;
  }
  if (!nulo(c.excluir) && (!Array.isArray(c.excluir) || !c.excluir.every((x) => typeof x === "string" && x.replace(/\s/g, "") !== "")))
    return `excluir ${tojson(c.excluir)} (una lista de ids o familias)`;
  if (!nulo(c.autocompact)) {
    const a = c.autocompact;
    const mal =
      !esObjeto(a) || !acok(a.defecto) || (!nulo(a.por_modelo) && (!esObjeto(a.por_modelo) || !Object.values(a.por_modelo).every(acok)));
    if (mal)
      return `autocompact ${tojson(a)} ({"defecto": null, "por_modelo": {"haiku": 300000}}: tokens enteros entre 100000 y 1000000, o null = ventana nativa)`;
  }
  if (!nulo(c.efforts_permitidos)) {
    const ep = c.efforts_permitidos;
    const ok =
      esObjeto(ep) &&
      Object.values(ep).every((l) => Array.isArray(l) && l.every((e) => typeof e === "string" && (EFFORTS as readonly string[]).includes(e)));
    if (!ok) return `efforts_permitidos ${tojson(ep)} (un objeto familia o id → lista de low, medium, high, xhigh, max)`;
  }
  if ("permitir_max" in c && typeof c.permitir_max !== "boolean") return `permitir_max ${tojson(c.permitir_max)} (true o false)`;
  if (!nulo(c.nota_compactar) && typeof c.nota_compactar !== "boolean") return `nota_compactar ${tojson(c.nota_compactar)} (true o false)`;
  if (!nulo(c.nota_compactar_pct) && !notaPctValido(c.nota_compactar_pct))
    return `nota_compactar_pct ${tojson(c.nota_compactar_pct)} (entero entre ${NOTA_PCT_MIN} y ${NOTA_PCT_MAX})`;
  if (!nulo(c.nota_compactar_tarea_pct) && !notaTareaPctValido(c.nota_compactar_tarea_pct))
    return `nota_compactar_tarea_pct ${tojson(c.nota_compactar_tarea_pct)} (0 o entero entre ${NOTA_TAREA_PCT_MIN} y ${NOTA_TAREA_PCT_MAX})`;
  if (!nulo(c.perfil) && !/^(equilibrado|ahorro|agresivo|rendimiento)$/.test(tostring(c.perfil))) return `perfil ${tojson(c.perfil)} (equilibrado, ahorro, agresivo o rendimiento)`;
  if (!nulo(c.reserva_lider) && (typeof c.reserva_lider !== "number" || c.reserva_lider < 0 || c.reserva_lider >= 1))
    return `reserva_lider ${tojson(c.reserva_lider)} (un número de 0 a 1 o null)`;
  if (!nulo(c.tope_vivos) && !topeVivosValido(c.tope_vivos))
    return `tope_vivos ${tojson(c.tope_vivos)} (un entero de 0 a ${TOPE_VIVOS_MAX}, o un objeto {"*": 3, "claude": 2} de grupos a enteros; 0 = sin tope)`;
  if (!nulo(c.sin_cupo) && !/^(otro|esperar|fallar)$/.test(tostring(c.sin_cupo))) return `sin_cupo ${tojson(c.sin_cupo)} (otro, esperar o fallar)`;
  return "";
}

export type SinCupo = "otro" | "esperar" | "fallar";
export interface Politica {
  sinCupo: SinCupo;
  /** De dónde salió (para los mensajes): "default", "sin_cupo de modelos.json"… */
  sinCupoDe: string;
  permitirMax: boolean;
}

/** El modelos.json de una llamada a `pa`. */
export class Modelos {
  readonly archivo: string;
  private principal = false;
  private leido: { conf: Record<string, Json> | null; err: string } | null = null;
  private env: Env;
  private io: Io;
  private home: string;
  private plat: Plataforma;

  constructor(env: Env, io: Io, home: string = homeDe(env), plat: Plataforma = plataformaActual()) {
    this.env = env;
    this.io = io;
    this.home = home;
    this.plat = plat;
    this.archivo = env.TRAMA_MODELOS || path.join(configTrama(env, home, plat), "modelos.json");
  }

  private leer(): { conf: Record<string, Json> | null; err: string } {
    if (this.leido) return this.leido;
    let esArchivo = false;
    try {
      esArchivo = statSync(this.archivo).isFile();
    } catch {
      esArchivo = false;
    }
    if (!esArchivo) return (this.leido = { conf: null, err: "" });
    let txt = "";
    try {
      txt = readFileSync(this.archivo, "utf8");
    } catch {
      txt = "";
    }
    // jq sin entrada no imprime nada: un archivo vacío (o sólo espacios) cuenta como «sin archivo», sin aviso.
    if (!txt.trim()) return (this.leido = { conf: null, err: "" });
    let c: Json;
    try {
      c = JSON.parse(txt);
    } catch {
      return (this.leido = { conf: null, err: "no es JSON válido" });
    }
    const err = problemaModelos(c, { env: this.env, home: this.home, plat: this.plat });
    return (this.leido = err ? { conf: null, err } : { conf: c as Record<string, Json>, err: "" });
  }

  /** `modelos_cargar`: ¿hay un modelos.json válido? `sub` = la llamada va dentro de un `$(…)` del bash (ver arriba). */
  cargar(sub = false): boolean {
    const yaPrincipal = this.principal;
    const l = this.leer();
    if (!yaPrincipal && l.err) this.io.err(`pa: ${this.archivo} no va (${l.err}); sigo con los modelos de siempre.\n`);
    if (!sub) this.principal = true;
    return l.conf !== null;
  }

  private conf(): Record<string, Json> | null {
    return this.cargar(true) ? this.leido!.conf : null;
  }

  /** `modelos_worker`: modelo, effort y clave para ese tipo (vacío = default), o null. */
  worker(t: string): { modelo: string; effort: string; clave: string } | null {
    const c = this.conf();
    if (!c) return null;
    const w = esObjeto(c.workers) ? c.workers : {};
    const k = t && t in w ? t : "default" in w ? "default" : null;
    if (k === null) return null;
    const v = w[k];
    if (v === null || v === undefined) return { modelo: "", effort: "", clave: k };
    if (!esObjeto(v)) return null;
    return { modelo: typeof v.modelo === "string" ? v.modelo : "", effort: typeof v.effort === "string" ? v.effort : "", clave: k };
  }

  /** `modelos_clave`: el valor de una clave de primer nivel (texto o JSON compacto), o "". */
  clave(k: string): string {
    const c = this.conf();
    if (!c) return "";
    const v = c[k];
    if (v === null || v === undefined || v === false) return "";
    return typeof v === "string" ? v : JSON.stringify(v);
  }

  /** `excluido_por`: la entrada de `excluir` que atrapa al modelo, o null. */
  excluidoPor(modelo: string): string | null {
    const c = this.conf();
    if (!c || !Array.isArray(c.excluir)) return null;
    const m = modelo.toLowerCase();
    for (const p of c.excluir) {
      if (typeof p !== "string") continue;
      const q = asciiMinus(p).replace(/^\s+|\s+$/g, "");
      if (!q) continue;
      const atrapa = q.endsWith("*") ? m.startsWith(q.slice(0, -1)) : familiasCodex(this.env, this.home, this.plat).includes(q) ? m.includes(q) : m === q || m.startsWith(`${q}-`);
      if (atrapa) return p;
    }
    return null;
  }

  /** `efforts_permitidos_de`: null = sin regla (valen todos); si no, los permitidos en orden low..max (puede ser []). */
  effortsPermitidosDe(modelo: string): string[] | null {
    const c = this.conf();
    if (!c) return null;
    const ep = esObjeto(c.efforts_permitidos) ? c.efforts_permitidos : {};
    const m = modelo.toLowerCase();
    const base = m.replace(/-(low|medium|high|xhigh|max)$/, "");
    const f = familiasCodex(this.env, this.home, this.plat).find((x) => m.includes(x));
    const k = [m, base, f].find((x) => x !== undefined && x in ep);
    if (k === undefined) return null;
    const lista = ep[k] as Json[];
    return EFFORTS.filter((e) => lista.includes(e));
  }

  /** `effort_apagado`: null si el effort vale; si el dueño lo apagó, los permitidos separados por espacio (o "ninguno"). */
  effortApagado(modelo: string, effort: string): string | null {
    const ok = this.effortsPermitidosDe(modelo);
    if (ok === null || ok.includes(effort.toLowerCase())) return null;
    return ok.length ? ok.join(" ") : "ninguno";
  }

  /** `gemini_politica`: sin_cupo (otro | esperar | fallar, con el alias viejo gemini.sin_claude) y permitir_max. */
  politica(): Politica {
    let sinCupo: SinCupo = "otro";
    let sinCupoDe = "default";
    const v = this.clave("sin_cupo");
    if (v) {
      sinCupo = v as SinCupo;
      sinCupoDe = "sin_cupo de modelos.json";
    } else {
      const g = this.clave("gemini");
      let sc = "";
      try {
        const x = (JSON.parse(g || "null") as Record<string, Json> | null)?.sin_claude;
        if (x !== null && x !== undefined && x !== false) sc = tostring(x);
      } catch {
        sc = "";
      }
      if (sc === "esperar" || sc === "fallar") {
        sinCupo = sc;
        sinCupoDe = "sin_cupo de modelos.json (gemini.sin_claude de antes)";
      }
    }
    return { sinCupo, sinCupoDe, permitirMax: this.clave("permitir_max") === "true" };
  }

  /** `autocompact_de`: los tokens de `--autocompact` para ese modelo ("" = ventana nativa, no se pasa). `env` = PA_AUTOCOMPACT ya leído. */
  autocompactDe(modelo: string, env: number | "nativo" | null): string {
    if (env !== null) return env === "nativo" ? "" : String(env);
    const m = modelo.toLowerCase();
    const f = ["fable", "opus", "sonnet", "haiku"].find((x) => m.includes(x)) ?? null;
    const c = this.conf();
    const a = c && esObjeto(c.autocompact) ? c.autocompact : {};
    const por: Record<string, Json> = {};
    if (esObjeto(a.por_modelo)) for (const [k, x] of Object.entries(a.por_modelo)) por[k.toLowerCase()] = x;
    const k = [m, f].find((x) => x !== null && x in por);
    const v = k !== undefined ? por[k!] : typeof a.defecto === "number" ? a.defecto : f === "haiku" ? 300000 : null;
    return typeof v === "number" ? String(v) : "";
  }

  /**
   * `tope_vivos` de modelos.json: un número (para todos los grupos) o `{"*": 3, "claude": 2}`; default 3, 0 = sin tope. `PA_TOPE_VIVOS`
   * (un entero) lo pisa para todos los grupos: lo usa el arnés de paridad, porque el pa de bash no tiene este tope.
   */
  topeVivos(): TopeVivos {
    const e = this.env.PA_TOPE_VIVOS;
    if (e !== undefined && /^[0-9]+$/.test(e)) return { defecto: Number(e), porGrupo: {} };
    const c = this.conf();
    const v = c ? c.tope_vivos : undefined;
    if (topeVivosValido(v ?? null) && v !== null && v !== undefined) {
      if (typeof v === "number") return { defecto: v, porGrupo: {} };
      const { "*": def, ...resto } = v as Record<string, number>;
      return { defecto: def ?? TOPE_VIVOS_DEFECTO, porGrupo: resto };
    }
    return { defecto: TOPE_VIVOS_DEFECTO, porGrupo: {} };
  }

  /** `nota_compactar` de modelos.json: booleana, por defecto prendida (`true`). */
  notaCompactar(): boolean {
    const c = this.conf();
    return c && typeof c.nota_compactar === "boolean" ? c.nota_compactar : true;
  }

  /** `nota_compactar_pct` de modelos.json (entero 50..95, default 85). */
  notaCompactarPct(): number {
    const c = this.conf();
    return c && notaPctValido(c.nota_compactar_pct) ? c.nota_compactar_pct : NOTA_PCT_DEFECTO;
  }

  /** `nota_compactar_tarea_pct` de modelos.json (`0` = apagado o entero 30..90, default 60). */
  notaCompactarTareaPct(): number {
    const c = this.conf();
    return c && notaTareaPctValido(c.nota_compactar_tarea_pct) ? c.nota_compactar_tarea_pct : NOTA_TAREA_PCT_DEFECTO;
  }

  /** `modelos_reparto`: auto | fijo (PA_REPARTO=0 lo apaga, para los tests). */
  reparto(): string {
    if (this.env.PA_REPARTO === "0") return "fijo";
    const c = this.conf();
    const v = c && c.reparto !== null && c.reparto !== undefined && c.reparto !== false ? tostring(c.reparto) : "";
    return v || "auto";
  }
}
