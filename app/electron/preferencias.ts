// Lo que la app recuerda entre aperturas: `~/.local/state/hilos/preferencias.json`.
// El último esfuerzo que el usuario eligió para cada modelo en Nueva tarea (id de
// modelo → effort), el idioma de la interfaz, el tamaño de letra, las fuentes y
// los mensajes tiernos (Ajustes), la vista de la barra (todo o sólo líderes) y si el panel de consumo está a la vista.
// Se escribe sólo cuando cambia algo (pocas veces): sin debounce.
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ESTADO, escribirAtomico } from "./pa.js";
import { silencio } from "./log.js";
import { esModeloDictado } from "./dictado-modelos.js";

const ARCHIVO = path.join(ESTADO, "preferencias.json");
const VERSION = 1;

export type Idioma = "en" | "es";
/**
 * Tamaño de letra (px del texto base) y fuentes de la interfaz y del código.
 * Acá sólo se guardan: qué ids existen y entre qué px lo sabe el renderer
 * (src/tipografia.ts), que lleva a default lo que no conoce.
 */
export type Apariencia = { letra?: number; fuente?: string; mono?: string; tema?: string };
/** Qué muestra la barra: los líderes con sus workers colgando (`todo`) o sólo los líderes. */
export type VistaBarra = "todo" | "lideres";
/** `tiernos`: los mensajes tiernos (B17); sin el campo, prendidos. */
/** `autoIntegrar`: "Integrar solo lo seguro" de Ramas (B22); sin el campo, prendido. */
/** `consumo`: el panel de consumo (a la derecha) está a la vista; sin el campo, oculto. */
/** `avisarEspera`: la notificación de escritorio cuando un líder te espera y la ventana no tiene el foco; sin el campo, prendida. */
/** `bienvenida`: la pantalla de primer arranque ya se vio (o se cerró); sin el campo, se muestra. */
/** `dictadoModelo`: el modelo de Handy con que se transcribe el dictado (dictado-modelos.ts); sin el campo, Whisper Large v3 Turbo. */
export type Preferencias = {
  effort: Record<string, string>;
  idioma?: Idioma;
  tiernos?: boolean;
  avisarEspera?: boolean;
  vista?: VistaBarra;
  autoIntegrar?: boolean;
  consumo?: boolean;
  dictadoModelo?: string;
  bienvenida?: boolean;
} & Apariencia;

let prefs: Preferencias | null = null;

const texto = (r: unknown): r is Record<string, string> =>
  !!r && typeof r === "object" && Object.values(r).every((v) => typeof v === "string");
const esIdioma = (x: unknown): x is Idioma => x === "en" || x === "es";
const esVista = (x: unknown): x is VistaBarra => x === "todo" || x === "lideres";
const esLetra = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 8 && x <= 40;
const esFuente = (x: unknown): x is string => typeof x === "string" && /^[a-z0-9-]{1,32}$/.test(x);

function desde(j: {
  version?: unknown;
  effort?: unknown;
  idioma?: unknown;
  letra?: unknown;
  fuente?: unknown;
  mono?: unknown;
  tema?: unknown;
  tiernos?: unknown;
  avisarEspera?: unknown;
  vista?: unknown;
  autoIntegrar?: unknown;
  consumo?: unknown;
  dictadoModelo?: unknown;
  bienvenida?: unknown;
}): Preferencias {
  if (j.version !== VERSION) return { effort: {} };
  const p: Preferencias = { effort: texto(j.effort) ? j.effort : {} };
  if (esIdioma(j.idioma)) p.idioma = j.idioma;
  if (esLetra(j.letra)) p.letra = j.letra;
  if (esFuente(j.fuente)) p.fuente = j.fuente;
  if (esFuente(j.mono)) p.mono = j.mono;
  if (esFuente(j.tema)) p.tema = j.tema;
  if (typeof j.tiernos === "boolean") p.tiernos = j.tiernos;
  if (typeof j.avisarEspera === "boolean") p.avisarEspera = j.avisarEspera;
  if (esVista(j.vista)) p.vista = j.vista;
  if (typeof j.autoIntegrar === "boolean") p.autoIntegrar = j.autoIntegrar;
  if (typeof j.consumo === "boolean") p.consumo = j.consumo;
  if (esModeloDictado(j.dictadoModelo)) p.dictadoModelo = j.dictadoModelo;
  if (typeof j.bienvenida === "boolean") p.bienvenida = j.bienvenida;
  return p;
}

export async function leerPreferencias(): Promise<Preferencias> {
  if (prefs) return prefs;
  try {
    prefs = desde(JSON.parse(await readFile(ARCHIVO, "utf8")));
  } catch {
    prefs = { effort: {} };
  }
  return prefs;
}

/** El idioma guardado, síncrono: el main lo pone en la query antes de cargar la página (sin parpadeo). */
export function idiomaGuardado(): Idioma | null {
  if (prefs) return prefs.idioma ?? null;
  try {
    return desde(JSON.parse(readFileSync(ARCHIVO, "utf8"))).idioma ?? null;
  } catch {
    return null;
  }
}

/** Tamaño de letra y fuentes guardados, síncrono: van en la query como el idioma. */
export function aparienciaGuardada(): Apariencia {
  let p = prefs;
  if (!p) {
    try {
      p = desde(JSON.parse(readFileSync(ARCHIVO, "utf8")));
    } catch {
      return {};
    }
  }
  return { letra: p.letra, fuente: p.fuente, mono: p.mono, tema: p.tema };
}

/** La vista de la barra guardada, síncrona: va en la query como el idioma. */
export function vistaGuardada(): VistaBarra | null {
  if (prefs) return prefs.vista ?? null;
  try {
    return desde(JSON.parse(readFileSync(ARCHIVO, "utf8"))).vista ?? null;
  } catch {
    return null;
  }
}

const guardar = (p: Preferencias) => escribirAtomico(ARCHIVO, JSON.stringify({ version: VERSION, ...p })).catch(silencio("preferencias"));

export async function guardarEffort(modelo: string, effort: string) {
  if (typeof modelo !== "string" || typeof effort !== "string" || !modelo || !effort) return;
  const p = await leerPreferencias();
  if (p.effort[modelo] === effort) return;
  p.effort[modelo] = effort;
  await guardar(p);
}

export async function guardarIdioma(idioma: unknown) {
  if (!esIdioma(idioma)) return;
  const p = await leerPreferencias();
  if (p.idioma === idioma) return;
  p.idioma = idioma;
  await guardar(p);
}

export async function guardarVista(vista: unknown) {
  if (!esVista(vista)) return;
  const p = await leerPreferencias();
  if ((p.vista ?? "todo") === vista) return;
  p.vista = vista;
  await guardar(p);
}

/** Sólo lo que viene y es válido; lo demás queda como estaba. */
export async function guardarApariencia(a: unknown) {
  if (!a || typeof a !== "object") return;
  const { letra, fuente, mono, tema } = a as Record<string, unknown>;
  const p = await leerPreferencias();
  let cambio = false;
  if (esLetra(letra) && p.letra !== letra) (p.letra = letra), (cambio = true);
  if (esFuente(fuente) && p.fuente !== fuente) (p.fuente = fuente), (cambio = true);
  if (esFuente(mono) && p.mono !== mono) (p.mono = mono), (cambio = true);
  if (esFuente(tema) && p.tema !== tema) (p.tema = tema), (cambio = true);
  if (cambio) await guardar(p);
}

/** Los mensajes tiernos guardados, síncrono como el idioma: van en la query. Sin nada guardado, prendidos. */
export function tiernosGuardados(): boolean {
  if (prefs) return prefs.tiernos !== false;
  try {
    return desde(JSON.parse(readFileSync(ARCHIVO, "utf8"))).tiernos !== false;
  } catch {
    return true;
  }
}

export async function guardarTiernos(si: unknown) {
  if (typeof si !== "boolean") return;
  const p = await leerPreferencias();
  if ((p.tiernos !== false) === si) return;
  p.tiernos = si;
  await guardar(p);
}

/** El aviso de "te espera" guardado, síncrono como los tiernos: va en la query. Sin nada guardado, prendido. */
export function avisarEsperaGuardado(): boolean {
  if (prefs) return prefs.avisarEspera !== false;
  try {
    return desde(JSON.parse(readFileSync(ARCHIVO, "utf8"))).avisarEspera !== false;
  } catch {
    return true;
  }
}

export async function guardarAvisarEspera(si: unknown) {
  if (typeof si !== "boolean") return;
  const p = await leerPreferencias();
  if ((p.avisarEspera !== false) === si) return;
  p.avisarEspera = si;
  await guardar(p);
}

/** "Integrar solo lo seguro" (B22): prendido o apagado. Devuelve si cambió. */
export async function guardarAutoIntegrar(si: unknown): Promise<boolean> {
  if (typeof si !== "boolean") return false;
  const p = await leerPreferencias();
  if ((p.autoIntegrar !== false) === si) return false;
  p.autoIntegrar = si;
  await guardar(p);
  return true;
}

/** El panel de consumo a la vista, síncrono como la vista de la barra: va en la query. Sin nada guardado, oculto. */
export function consumoGuardado(): boolean {
  if (prefs) return prefs.consumo === true;
  try {
    return desde(JSON.parse(readFileSync(ARCHIVO, "utf8"))).consumo === true;
  } catch {
    return false;
  }
}

export async function guardarConsumo(si: unknown) {
  if (typeof si !== "boolean") return;
  const p = await leerPreferencias();
  if ((p.consumo === true) === si) return;
  p.consumo = si;
  await guardar(p);
}

/** El modelo del dictado que se eligió en Ajustes (rige desde la próxima transcripción). Devuelve si cambió. */
export async function guardarDictadoModelo(id: unknown): Promise<boolean> {
  if (!esModeloDictado(id)) return false;
  const p = await leerPreferencias();
  if (p.dictadoModelo === id) return false;
  p.dictadoModelo = id;
  await guardar(p);
  return true;
}

/**
 * ¿Hay que abrir la bienvenida sola? Sí si nunca se vio. Una corrida de prueba (bench, captura, pruebas, fixtures: las mismas
 * señales de `enPrueba`, `aislar.ts`) dice que no, para que ningún script la encuentre encima de lo que mira.
 */
export async function bienvenidaPendiente(): Promise<boolean> {
  const e = process.env;
  if (e.HILOS_BENCH || e.HILOS_CAPTURA || e.HILOS_CAPTURA_PNG || e.HILOS_PRUEBA || e.HILOS_GUION || e.HILOS_FIXTURES === "1") return false;
  return (await leerPreferencias()).bienvenida !== true;
}

export async function guardarBienvenida(si: unknown) {
  if (typeof si !== "boolean") return;
  const p = await leerPreferencias();
  if ((p.bienvenida === true) === si) return;
  p.bienvenida = si;
  await guardar(p);
}
