// Las conversaciones de Claude Code que no se abrieron desde Trama: `<config>/projects/<carpeta>/<sid>.jsonl`, la de siempre
// (`~/.claude`, o `CLAUDE_CONFIG_DIR`) y la de cada cuenta agregada. La barra las muestra en "De Claude Code" y las retoma con
// `lider.retomar` (que ya sabe `--resume` en la carpeta original). Acá sólo se LEE: nunca se escribe un .jsonl.
//
// Barato aunque haya cientos de GB: de cada transcript se lee la cabeza (cwd, primer mensaje) y la cola (título, modelo) y nada más;
// el resultado queda en memoria y en `$HILOS_STATE/claude-code.json` por (mtime, tamaño), así que un transcript que no cambió cuesta
// un `stat`. Nunca traba: todo es asíncrono y de a pocos archivos a la vez. Sin Electron: `tests/claude-code.test.ts`.
import { open, readdir, readFile, realpath, rename, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { silencio } from "./log.ts";

const VERSION = 1;
/** Cuánto se lee del principio y del final de cada transcript. */
const CABEZA = 256 * 1024;
const COLA = 256 * 1024;
/** Cuántos archivos se leen a la vez. */
const A_LA_VEZ = 8;
const SID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const TITULO_MAX = 140;

/** Una conversación de Claude Code. `ms`: la última vez que se tocó (mtime). */
export type ConvClaude = { sid: string; titulo: string; ms: number; modelo: string | null; cwd: string };

type Anotado = [mtimeMs: number, tam: number, conv: ConvClaude | null];
type Guardado = { version: number; archivos: Record<string, Anotado> };

/** Lo que pone Claude Code en un mensaje que no escribió la persona (comandos, avisos, recordatorios). */
const ES_ETIQUETA = /^\s*<(?:local-command|command-|system-reminder|user-prompt-submit-hook|bash-|task-notification|ide_|teammate-message)/i;

const limpio = (t: string): string => {
  const l = t.replace(/\s+/g, " ").trim();
  return l.length > TITULO_MAX ? `${l.slice(0, TITULO_MAX - 1).trimEnd()}…` : l;
};

/** El texto de un mensaje del usuario (`message.content`: un string o una lista de partes). */
function textoUsuario(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  for (const p of content) {
    const x = p as { type?: unknown; text?: unknown };
    if (x?.type === "text" && typeof x.text === "string" && x.text.trim()) return x.text;
  }
  return "";
}

type Dato = { cwd: string | null; primero: string; resumen: string; titulo: string; ia: string; ultimo: string; modelo: string | null; usuarios: number };

/** Junta lo que dicen las líneas de un trozo (el que viene después pisa al anterior). `parcial`: la primera línea pudo quedar cortada. */
function recorrer(texto: string, d: Dato, parcial: boolean): void {
  const lineas = texto.split("\n");
  if (parcial) lineas.shift();
  for (const l of lineas) {
    if (l.length < 2 || l.charCodeAt(0) !== 123) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(l);
    } catch {
      continue;
    }
    if (d.cwd === null && typeof o.cwd === "string" && path.isAbsolute(o.cwd)) d.cwd = o.cwd;
    switch (o.type) {
      case "custom-title":
        if (typeof o.customTitle === "string" && o.customTitle.trim()) d.titulo = o.customTitle;
        break;
      case "ai-title":
        if (typeof o.aiTitle === "string" && o.aiTitle.trim()) d.ia = o.aiTitle;
        break;
      case "summary":
        if (typeof o.summary === "string" && o.summary.trim() && !d.resumen) d.resumen = o.summary;
        break;
      case "last-prompt":
        if (typeof o.lastPrompt === "string" && o.lastPrompt.trim()) d.ultimo = o.lastPrompt;
        break;
      case "user": {
        if (o.isSidechain === true) break;
        const t = o.isMeta === true ? "" : textoUsuario((o.message as { content?: unknown } | undefined)?.content);
        if (t.trim() && !ES_ETIQUETA.test(t)) {
          d.usuarios++;
          if (!d.primero) d.primero = t;
        }
        break;
      }
      case "assistant": {
        const m = (o.message as { model?: unknown } | undefined)?.model;
        if (typeof m === "string" && m && m !== "<synthetic>" && o.isSidechain !== true) d.modelo = m;
        break;
      }
    }
  }
}

/**
 * La conversación que cuenta un transcript, a partir de su cabeza y su cola (`cola`: `null` si la cabeza ya es todo el archivo).
 * `null`: no es una conversación (sin sesión, sin carpeta, o sin ningún mensaje de la persona).
 * El título es el que le puso la persona (/rename), el que generó Claude Code, el resumen de las viejas, o el primer mensaje.
 */
export function leerConv(sid: string, ms: number, cabeza: string, cola: string | null): ConvClaude | null {
  const d: Dato = { cwd: null, primero: "", resumen: "", titulo: "", ia: "", ultimo: "", modelo: null, usuarios: 0 };
  recorrer(cabeza, d, false);
  if (cola !== null) recorrer(cola, d, true);
  const titulo = limpio(d.titulo || d.ia || d.resumen || d.primero || d.ultimo);
  if (!d.cwd || !titulo || (!d.usuarios && !d.ultimo)) return null;
  return { sid, titulo, ms, modelo: d.modelo, cwd: d.cwd };
}

async function leerTrozos(archivo: string, tam: number): Promise<{ cabeza: string; cola: string | null }> {
  const f = await open(archivo, "r");
  try {
    const n = Math.min(tam, CABEZA);
    const a = Buffer.alloc(n);
    const { bytesRead } = await f.read(a, 0, n, 0);
    const cabeza = a.subarray(0, bytesRead).toString("utf8");
    if (tam <= CABEZA) return { cabeza, cola: null };
    const m = Math.min(tam - CABEZA, COLA);
    const b = Buffer.alloc(m);
    const r = await f.read(b, 0, m, tam - m);
    return { cabeza, cola: b.subarray(0, r.bytesRead).toString("utf8") };
  } finally {
    await f.close();
  }
}

export type OpcionesIndice = {
  /** Las carpetas `projects` a mirar (también las de otras cuentas); las que no existen se saltean y las que apuntan a la misma, cuentan una vez. */
  raices: () => string[];
  /** La carpeta `projects` que leen los líderes de Trama: lo que esté en otra no se puede retomar con esta cuenta (`ajena`). */
  propia?: () => string;
  /** Dónde se guarda lo ya leído; sin esto sólo queda en memoria. */
  cache?: string;
};

/** Una conversación lista para mostrar. `ajena`: es de otra cuenta de Claude (su `projects` no es el de Trama). */
export type ConvListada = ConvClaude & { ajena: boolean };

/** Qué leyó una pasada (para el test y el log). */
export type Pasada = { archivos: number; leidos: number };

export function crearIndiceClaudeCode(o: OpcionesIndice) {
  const anotados = new Map<string, Anotado>();
  let cargado = false;
  let corriendo: Promise<{ convs: ConvListada[]; pasada: Pasada }> | null = null;

  async function cargar(): Promise<void> {
    if (cargado) return;
    cargado = true;
    if (!o.cache) return;
    try {
      const g = JSON.parse(await readFile(o.cache, "utf8")) as Guardado;
      if (g?.version !== VERSION || !g.archivos || typeof g.archivos !== "object") return;
      for (const [k, v] of Object.entries(g.archivos)) if (Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number") anotados.set(k, v);
    } catch {}
  }

  async function guardar(): Promise<void> {
    if (!o.cache) return;
    const g: Guardado = { version: VERSION, archivos: Object.fromEntries(anotados) };
    await mkdir(path.dirname(o.cache), { recursive: true });
    const tmp = `${o.cache}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(g));
    await rename(tmp, o.cache);
  }

  async function pasada(): Promise<{ convs: ConvListada[]; pasada: Pasada }> {
    await cargar();
    const vistas = new Set<string>();
    const raices: string[] = [];
    for (const r of o.raices()) {
      const real = await realpath(r).catch(() => null);
      if (real && !vistas.has(real)) {
        vistas.add(real);
        raices.push(real);
      }
    }
    const archivos: { ruta: string; sid: string }[] = [];
    for (const raiz of raices) {
      for (const c of await readdir(raiz, { withFileTypes: true }).catch(() => [])) {
        if (!c.isDirectory()) continue;
        const dir = path.join(raiz, c.name);
        for (const n of await readdir(dir).catch(() => [] as string[])) {
          const sid = n.endsWith(".jsonl") ? n.slice(0, -6) : "";
          if (SID.test(sid)) archivos.push({ ruta: path.join(dir, n), sid });
        }
      }
    }
    const estan = new Set(archivos.map((a) => a.ruta));
    let cambio = false;
    for (const k of [...anotados.keys()])
      if (!estan.has(k)) {
        anotados.delete(k);
        cambio = true;
      }
    const m: Pasada = { archivos: archivos.length, leidos: 0 };
    let i = 0;
    const obrero = async () => {
      for (let a = archivos[i++]; a; a = archivos[i++]) {
        try {
          const st = await stat(a.ruta);
          const antes = anotados.get(a.ruta);
          if (antes && antes[0] === st.mtimeMs && antes[1] === st.size) continue;
          const { cabeza, cola } = await leerTrozos(a.ruta, st.size);
          anotados.set(a.ruta, [st.mtimeMs, st.size, leerConv(a.sid, Math.floor(st.mtimeMs), cabeza, cola)]);
          m.leidos++;
          cambio = true;
        } catch {
          // Se borró o no se puede leer: no figura.
          if (anotados.delete(a.ruta)) cambio = true;
        }
      }
    };
    await Promise.all(Array.from({ length: A_LA_VEZ }, obrero));
    if (cambio) await guardar().catch(silencio("claude-code"));
    // Una misma sesión en dos carpetas (cuentas con `projects` aparte): gana la más reciente.
    const propia = o.propia ? await realpath(o.propia()).catch(() => path.resolve(o.propia!())) : null;
    const porSid = new Map<string, ConvListada>();
    for (const [ruta, v] of anotados) {
      const c = v[2];
      if (c && (porSid.get(c.sid)?.ms ?? -1) < c.ms) porSid.set(c.sid, { ...c, ajena: propia !== null && !ruta.startsWith(propia + path.sep) });
    }
    return { convs: [...porSid.values()].sort((a, b) => b.ms - a.ms), pasada: m };
  }

  /** Todas, de la más reciente a la más vieja. Dos pedidos a la vez comparten la misma lectura. */
  function listar(): Promise<{ convs: ConvListada[]; pasada: Pasada }> {
    corriendo ??= pasada().finally(() => {
      corriendo = null;
    });
    return corriendo;
  }

  return { listar };
}

/** La carpeta personal en la barra (igual que `GENERAL` de la interfaz). */
export const GENERAL = "general";

/** Una conversación como la ve la barra: de qué proyecto es (su `slug`, o `GENERAL`; `null`: una carpeta que no está registrada) y si su carpeta sigue existiendo. */
export type VistaConv = { sid: string; titulo: string; ms: number; modelo: string | null; cwd: string; proyecto: string | null; existe: boolean; ajena: boolean };

const dentro = (c: string, r: string) => c === r || c.startsWith(r + path.sep) || c.startsWith(r + "/");
const WORKTREE_PA = /[\\/]pa[\\/]worktrees[\\/]/;

/**
 * Lo que la barra recibe: sin las que ya son de Trama (`excluidas`: líderes y workers) ni las de los worktrees de `pa`, cada una con su
 * proyecto (por la ruta más larga que la contiene; la carpeta personal es `casa`) y si su carpeta existe. `rutas`: [ruta real, slug].
 */
export async function vistaConvs(
  convs: ConvListada[],
  d: { excluidas: Set<string>; rutas: [string, string][]; casa: string; real: (p: string) => Promise<string>; existe: (p: string) => Promise<boolean> },
): Promise<VistaConv[]> {
  const sale: VistaConv[] = [];
  const dirs = new Map<string, Promise<[string | null, boolean]>>();
  const de = (cwd: string) => {
    let p = dirs.get(cwd);
    if (!p) {
      p = (async (): Promise<[string | null, boolean]> => {
        const r = await d.real(cwd);
        const hit = d.rutas.find(([ruta]) => dentro(r, ruta));
        return [hit ? hit[1] : r === d.casa ? GENERAL : null, await d.existe(cwd)];
      })();
      dirs.set(cwd, p);
    }
    return p;
  };
  for (const c of convs) {
    if (d.excluidas.has(c.sid) || WORKTREE_PA.test(c.cwd)) continue;
    const [proyecto, existe] = await de(c.cwd);
    sale.push({ sid: c.sid, titulo: c.titulo, ms: c.ms, modelo: c.modelo, cwd: c.cwd, proyecto, existe, ajena: c.ajena });
  }
  return sale;
}

/** Los `session_id` de los workers de `pa` (`<estado>/<proyecto>/<id>.sid`): sus conversaciones son de `pa`, no de la persona. */
export async function sidsDePa(paState: string): Promise<Set<string>> {
  const sids = new Set<string>();
  for (const c of await readdir(paState, { withFileTypes: true }).catch(() => [])) {
    if (!c.isDirectory()) continue;
    for (const n of await readdir(path.join(paState, c.name)).catch(() => [] as string[])) {
      if (!n.endsWith(".sid")) continue;
      const sid = await readFile(path.join(paState, c.name, n), "utf8").then((t) => t.trim(), () => "");
      if (SID.test(sid)) sids.add(sid);
    }
  }
  return sids;
}
