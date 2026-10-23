// La config de modelos que comparten `pa` y trama (`~/.config/trama/modelos.json`): qué forma tiene, qué vale y cómo se
// junta lo que se edita en Ajustes con lo que ya hay en el archivo. Puro y sin imports de Node: lo usan el main (para no
// escribir nada inválido) y el panel (el borrador). Lo que no conoce lo deja como estaba: otra versión de trama o de `pa`
// puede haber agregado claves, y un Guardar no las borra. Lo prueba tests/modelos-config.test.ts.
import { errorT } from "./errores.ts";

export const TIPOS = ["default", "codigo-acotado", "codigo-multi", "frontend", "debug", "diseno", "lectura", "mecanico"] as const;
export type Tipo = (typeof TIPOS)[number];

/** Los niveles de esfuerzo de Claude Code; en Gemini va dentro del nombre y un local no tiene. */
export const EFFORTS_CONFIG = ["low", "medium", "high", "xhigh", "max"] as const;

/** Los Gemini que `pa` sabe lanzar (agy). */
export const GEMINI = [
  "gemini-4-argon-low",
  "gemini-4-argon-medium",
  "gemini-4-argon-high",
  "gemini-3.8-flash-low",
  "gemini-3.8-flash-medium",
  "gemini-3.8-flash-high",
] as const;

/** Los modelos no-Gemini que `agy` sirve con el cupo de Google (`agy:<modelo>-<effort>`). */
export const AGY = [
  "agy:claude-opus-5-5-low",
  "agy:claude-opus-5-5-medium",
  "agy:claude-opus-5-5-high",
  "agy:claude-sonnet-5-5-low",
  "agy:claude-sonnet-5-5-medium",
  "agy:claude-sonnet-5-5-high",
  "agy:gpt-oss-120b-low",
  "agy:gpt-oss-120b-medium",
  "agy:gpt-oss-120b-high",
] as const;

export const REPARTO = ["auto", "fijo"] as const;
export type ModoReparto = (typeof REPARTO)[number];

export const SIN_CLAUDE = ["claude", "esperar", "fallar"] as const;
export type SinClaude = (typeof SIN_CLAUDE)[number];
export const CUPO_MIN = 1;
export const CUPO_MAX = 100;
export const URL_OLLAMA = "http://localhost:11434";
/** Más locales que esto no es una lista que alguien arme a mano. */
export const LOCALES_MAX = 50;

/** Un modelo y, si es de Claude, su esfuerzo. */
export type Eleccion = { modelo: string; effort?: string };
/** Un modelo servido por Ollama: `id` es `ollama:<modelo>` y es lo que se elige en los selectores. */
export type Local = { id: string; nombre: string; url: string; modelo: string };
export type ConfigModelos = {
  lider?: Eleccion;
  reparto?: ModoReparto;
  workers: Partial<Record<Tipo, Eleccion>>;
  locales: Local[];
  gemini: { cupo_max?: number; sin_claude?: SinClaude };
};

export const vacia = (): ConfigModelos => ({ workers: {}, locales: [], gemini: {} });

export const esClaude = (m: string) => m.startsWith("claude-");
export const esGemini = (m: string) => m.startsWith("gemini-");
export const esAgy = (m: string) => m.startsWith("agy:");
export const esOllama = (m: string) => m.startsWith("ollama:");
/** Un id con forma de id (va a un archivo y a una línea de comandos): sin espacios ni comillas. */
const FORMA_ID = /^[A-Za-z0-9][\w.:/[\]-]{0,120}$/;

const esObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** La URL de un servidor Ollama sin la barra final; `null` si no es http(s) con host. */
export function urlOllama(texto: unknown): string | null {
  if (typeof texto !== "string") return null;
  try {
    const u = new URL(texto.trim());
    if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname || u.username || u.password || u.search || u.hash) return null;
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/** Lo que se lee de una elección del archivo; lo que no tiene forma se ignora (el archivo no se toca hasta guardar). */
function eleccionDe(x: unknown): Eleccion | undefined {
  if (!esObj(x) || typeof x.modelo !== "string" || !x.modelo) return undefined;
  return typeof x.effort === "string" && x.effort ? { modelo: x.modelo, effort: x.effort } : { modelo: x.modelo };
}

function localDe(x: unknown): Local | undefined {
  if (!esObj(x) || typeof x.id !== "string" || typeof x.modelo !== "string" || typeof x.url !== "string") return undefined;
  const url = urlOllama(x.url);
  if (!url || !x.modelo) return undefined;
  return { id: x.id, nombre: typeof x.nombre === "string" && x.nombre ? x.nombre : x.modelo, url, modelo: x.modelo };
}

/** Lo que dice un archivo ya parseado, sin exigir que esté perfecto: con lo que se entiende se arma el borrador. */
export function leerConfig(j: Record<string, unknown>): ConfigModelos {
  const c = vacia();
  c.lider = eleccionDe(j.lider);
  if (!c.lider) delete c.lider;
  if (j.reparto === "auto" || j.reparto === "fijo") c.reparto = j.reparto;
  if (esObj(j.workers)) for (const t of TIPOS) { const e = eleccionDe(j.workers[t]); if (e?.modelo === "auto") c.reparto = "auto"; else if (e) c.workers[t] = e; }
  if (Array.isArray(j.locales)) for (const l of j.locales) { const x = localDe(l); if (x) c.locales.push(x); }
  if (esObj(j.gemini)) {
    const g = j.gemini;
    if (typeof g.cupo_max === "number" && Number.isInteger(g.cupo_max) && g.cupo_max >= CUPO_MIN && g.cupo_max <= CUPO_MAX) c.gemini.cupo_max = g.cupo_max;
    if (typeof g.sin_claude === "string" && (SIN_CLAUDE as readonly string[]).includes(g.sin_claude)) c.gemini.sin_claude = g.sin_claude as SinClaude;
  }
  return c;
}

function validarEleccion(x: unknown, donde: string, locales: Local[]): Eleccion {
  if (!esObj(x)) throw errorT("main.modelosForma");
  const m = x.modelo;
  if (typeof m !== "string" || !FORMA_ID.test(m) || !(esClaude(m) || esGemini(m) || esAgy(m) || esOllama(m))) throw errorT("main.modelosModelo", { donde, v: String(m).slice(0, 60) });
  if (esOllama(m) && !locales.some((l) => l.id === m)) throw errorT("main.modelosLocalFalta", { donde, v: m.slice(0, 60) });
  const e: Eleccion = { modelo: m };
  if (x.effort !== undefined && x.effort !== null && x.effort !== "") {
    if (!esClaude(m)) throw errorT("main.modelosEffortAjeno", { donde });
    if (typeof x.effort !== "string" || !(EFFORTS_CONFIG as readonly string[]).includes(x.effort)) throw errorT("main.modelosEffort", { donde, v: String(x.effort).slice(0, 20) });
    e.effort = x.effort;
  }
  return e;
}

/** Lo que llega a guardar, revisado: tira con el motivo si algo no vale (y entonces no se escribe nada). */
export function validarConfig(x: unknown): ConfigModelos {
  if (!esObj(x)) throw errorT("main.modelosForma");
  const raro = Object.keys(x).find((k) => !["lider", "reparto", "workers", "locales", "gemini"].includes(k));
  if (raro !== undefined) throw errorT("main.modelosCampo", { campo: raro.slice(0, 40) });
  const c = vacia();

  if (x.locales !== undefined) {
    if (!Array.isArray(x.locales)) throw errorT("main.modelosForma");
    if (x.locales.length > LOCALES_MAX) throw errorT("main.modelosDemasiados", { max: LOCALES_MAX });
    for (const l of x.locales) {
      if (!esObj(l) || typeof l.modelo !== "string" || !l.modelo.trim() || !FORMA_ID.test(l.modelo.trim())) throw errorT("main.modelosLocalForma");
      const url = urlOllama(l.url);
      if (!url) throw errorT("main.modelosUrl", { v: String(l.url).slice(0, 60) });
      const modelo = l.modelo.trim();
      if (l.id !== `ollama:${modelo}`) throw errorT("main.modelosLocalId", { id: String(l.id).slice(0, 60), modelo });
      if (c.locales.some((o) => o.id === l.id)) throw errorT("main.modelosLocalRepetido", { id: l.id });
      const nombre = typeof l.nombre === "string" && l.nombre.trim() ? l.nombre.trim().slice(0, 80) : modelo;
      c.locales.push({ id: l.id, nombre, url, modelo });
    }
  }
  if (x.reparto !== undefined && x.reparto !== null) {
    if (typeof x.reparto !== "string" || !(REPARTO as readonly string[]).includes(x.reparto)) throw errorT("main.modelosForma");
    c.reparto = x.reparto as ModoReparto;
  }
  if (x.lider !== undefined && x.lider !== null) c.lider = validarEleccion(x.lider, "lider", c.locales);
  if (x.workers !== undefined) {
    if (!esObj(x.workers)) throw errorT("main.modelosForma");
    for (const [tipo, e] of Object.entries(x.workers)) {
      if (!(TIPOS as readonly string[]).includes(tipo)) throw errorT("main.modelosTipo", { tipo: tipo.slice(0, 40) });
      if (e === null || e === undefined) continue;
      if (esObj(e) && e.modelo === "auto" && (e.effort === undefined || e.effort === null || e.effort === "")) {
        c.reparto = "auto";
        continue;
      }
      c.workers[tipo as Tipo] = validarEleccion(e, tipo, c.locales);
    }
  }
  if (x.gemini !== undefined) {
    if (!esObj(x.gemini)) throw errorT("main.modelosForma");
    const g = x.gemini;
    const rarog = Object.keys(g).find((k) => k !== "cupo_max" && k !== "sin_claude");
    if (rarog !== undefined) throw errorT("main.modelosCampo", { campo: `gemini.${rarog.slice(0, 30)}` });
    if (g.cupo_max !== undefined && g.cupo_max !== null) {
      if (typeof g.cupo_max !== "number" || !Number.isInteger(g.cupo_max) || g.cupo_max < CUPO_MIN || g.cupo_max > CUPO_MAX)
        throw errorT("main.modelosCupo", { min: CUPO_MIN, max: CUPO_MAX });
      c.gemini.cupo_max = g.cupo_max;
    }
    if (g.sin_claude !== undefined && g.sin_claude !== null) {
      if (typeof g.sin_claude !== "string" || !(SIN_CLAUDE as readonly string[]).includes(g.sin_claude)) throw errorT("main.modelosSinClaude");
      c.gemini.sin_claude = g.sin_claude as SinClaude;
    }
  }
  return c;
}

/**
 * El objeto que se escribe: el que había con lo editado encima. Lo desconocido (claves de más arriba, de adentro de una
 * elección, de un local o de `gemini`) sigue donde estaba; lo que el borrador ya no tiene (un worker vuelto a "como hoy",
 * un local quitado, un límite vaciado) se saca. `version` siempre 1.
 */
export function unir(antes: Record<string, unknown> | null, c: ConfigModelos): Record<string, unknown> {
  const base: Record<string, unknown> = antes ? { ...antes } : {};
  base.version = 1;
  const sobre = (viejo: unknown, nuevo: Record<string, unknown>, quitar: string[]) => {
    const o: Record<string, unknown> = esObj(viejo) ? { ...viejo } : {};
    for (const k of quitar) delete o[k];
    return Object.assign(o, nuevo);
  };

  if (c.lider) base.lider = sobre(base.lider, { ...c.lider }, ["effort"]);
  else delete base.lider;

  if (c.reparto) base.reparto = c.reparto;
  else delete base.reparto;

  const w: Record<string, unknown> = esObj(base.workers) ? { ...base.workers } : {};
  for (const t of TIPOS) {
    const e = c.workers[t];
    if (e) w[t] = sobre(w[t], { ...e }, ["effort"]);
    else delete w[t];
  }
  if (Object.keys(w).length) base.workers = w;
  else delete base.workers;

  const viejos = Array.isArray(base.locales) ? base.locales : [];
  const ls = c.locales.map((l) => sobre(viejos.find((v) => esObj(v) && v.id === l.id), { ...l }, []));
  if (ls.length || "locales" in base) base.locales = ls;

  const g = sobre(base.gemini, { ...c.gemini }, ["cupo_max", "sin_claude"]);
  if (Object.keys(g).length) base.gemini = g;
  else delete base.gemini;
  return base;
}

// --- Qué corre hoy, sin archivo ------------------------------------------------------

/** Lo que hace `pa` cuando el archivo no dice nada (bin/pa: Sonnet high; `--tipo mecanico` Haiku xhigh) y el líder de trama (Opus high). */
export const HOY: { lider: Eleccion; workers: Partial<Record<Tipo, Eleccion>> } = {
  lider: { modelo: "claude-opus-5-5", effort: "high" },
  workers: {
    default: { modelo: "claude-sonnet-5-5", effort: "high" },
    mecanico: { modelo: "claude-haiku-5-5", effort: "xhigh" },
  },
};

/** Con qué lanza `pa` un tipo: el suyo, el `default` del archivo o lo de hoy. */
export function efectivoDe(c: ConfigModelos, tipo: Tipo): Eleccion {
  return c.workers[tipo] ?? (tipo === "default" ? undefined : c.workers.default) ?? HOY.workers[tipo] ?? HOY.workers.default!;
}

/** Las tres filas de worker de `~/CLAUDE.md` y el tipo de la config del que salen. */
export const ROL_DE_TIPO = { codigo: "codigo-acotado", explorar: "lectura", diseno: "frontend" } as const;
