// El prompt base de Claude Code (su texto de sistema y sus herramientas), capturado una vez por versión de `claude` para la vista previa del
// panel de contexto: qué cargaría un líder o un worker nuevo sin lanzarlo. Claude Code anota en el transcript de cada sesión el pedido que
// armó (`api-request-shape` y `prompt_snapshot`), así que no hace falta ningún proxy: se corre `claude -p ok` una vez en una carpeta vacía,
// se lee su transcript y se guarda SÓLO el campo `system` y la lista de herramientas (nombre y peso) en `<config de trama>/prompt-base.json`.
// Nunca se guarda ni se lee un header, un token ni una clave; el entorno sale sin `ANTHROPIC_*` (`entornoLider`): siempre la suscripción.
// El transcript de la corrida (y su carpeta) se borran al terminar: no queda una sesión de más en el historial.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { paraLanzar } from "./binario.ts";
import { leerSesion } from "./contexto-sesion.ts";
import { errorT } from "./errores.ts";
import { entornoLider } from "./lider-arma.ts";
import { resolverClaude } from "./plugins-claude.ts";
import { configTrama, homeDe, plataformaActual, type Plataforma } from "./rutas.ts";

type Env = Record<string, string | undefined>;

/** Lo único que se guarda de una corrida: de qué versión y modelo salió, el texto de sistema por partes y las herramientas. */
export type BaseClaude = {
  version: string;
  capturadoEn: number;
  modelo: string | null;
  /** El prompt de sistema por partes, tal cual lo armó Claude Code (`InfoSesion.promptPartes`). */
  partes: string[];
  /** Herramientas integradas cargadas, con su peso estimado. */
  herramientas: { nombre: string; tokens: number }[];
  /** Nombres de herramientas integradas que se anuncian diferidas (no están en la ventana). */
  diferidas: string[];
};

type Almacen = { version: 1; bases: Record<string, BaseClaude> };

/** Cuántas versiones se guardan (las más nuevas por fecha de captura). */
const MAX_VERSIONES = 6;
const VERSION = /^\d+\.\d+\.\d+(?:[-+.][\w.]+)?$/;

export const archivoBase = (dir = configTrama()) => path.join(dir, "prompt-base.json");

const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** Las bases guardadas; un archivo roto o raro cuenta como vacío (nunca tira). */
export async function leerBases(dir = configTrama()): Promise<Record<string, BaseClaude>> {
  try {
    const j = JSON.parse(await readFile(archivoBase(dir), "utf8")) as unknown;
    if (!obj(j) || !obj(j.bases)) return {};
    const r: Record<string, BaseClaude> = {};
    for (const [v, b] of Object.entries(j.bases)) {
      if (!VERSION.test(v) || !obj(b) || !Array.isArray(b.partes) || !b.partes.every((p) => typeof p === "string") || !b.partes.length) continue;
      const herramientas = (Array.isArray(b.herramientas) ? b.herramientas : []).filter((h): h is { nombre: string; tokens: number } => obj(h) && typeof h.nombre === "string" && typeof h.tokens === "number");
      const diferidas = (Array.isArray(b.diferidas) ? b.diferidas : []).filter((n): n is string => typeof n === "string");
      r[v] = { version: v, capturadoEn: typeof b.capturadoEn === "number" ? b.capturadoEn : 0, modelo: typeof b.modelo === "string" ? b.modelo : null, partes: b.partes as string[], herramientas, diferidas };
    }
    return r;
  } catch {
    return {};
  }
}

/** Guarda una base (escritura atómica) y deja sólo las `MAX_VERSIONES` más nuevas. */
export async function guardarBase(b: BaseClaude, dir = configTrama()): Promise<void> {
  const bases = { ...(await leerBases(dir)), [b.version]: b };
  const nuevas = Object.values(bases).sort((a, c) => c.capturadoEn - a.capturadoEn).slice(0, MAX_VERSIONES);
  const a: Almacen = { version: 1, bases: Object.fromEntries(nuevas.map((x) => [x.version, x])) };
  await mkdir(dir, { recursive: true });
  const destino = archivoBase(dir);
  const tmp = `${destino}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(a), { mode: 0o600 });
  await rename(tmp, destino);
}

/** La base de un transcript (`api-request-shape` + `prompt_snapshot`); `null` si no trae la versión o el prompt. */
export function baseDeTranscript(lineas: string[], capturadoEn = Date.now()): BaseClaude | null {
  const i = leerSesion(lineas);
  if (!i.version || !VERSION.test(i.version) || !i.promptPartes.length || !i.herramientas) return null;
  let modelo: string | null = null;
  for (const l of lineas) {
    if (!l.includes('"model"')) continue;
    try {
      const o = JSON.parse(l) as unknown;
      if (obj(o) && obj(o.message) && typeof o.message.model === "string" && o.message.model.startsWith("claude-")) {
        modelo = o.message.model;
        break;
      }
    } catch {
      /* sigue */
    }
  }
  return {
    version: i.version,
    capturadoEn,
    modelo,
    partes: i.promptPartes,
    herramientas: i.herramientas.filter((h) => !h.nombre.startsWith("mcp__")),
    diferidas: i.diferidas.filter((n) => !n.startsWith("mcp__")),
  };
}

// --- Capturar con `claude -p ok` --------------------------------------------------------------------------------------------------------

export type Salida = { code: number | null; stdout: string; stderr: string; tiempo: boolean; noExiste: boolean };

export type DepsBase = {
  env?: Env;
  home?: string;
  plat?: Plataforma;
  /** La carpeta de config de Claude (`CLAUDE_CONFIG_DIR` o `~/.claude`). */
  claudeDir?: string;
  /** Donde se guarda `prompt-base.json`. */
  dirTrama?: string;
  /** Una carpeta temporal vacía donde correr. */
  tmp?: string;
  esEjecutable?: (f: string) => boolean;
  /** Corre `claude` ya armado; por defecto `execFile` de verdad. */
  correr?: (file: string, args: string[], env: NodeJS.ProcessEnv, verbatim: boolean, cwd: string, timeoutMs: number) => Promise<Salida>;
};

const correrReal: NonNullable<DepsBase["correr"]> = (file, args, env, verbatim, cwd, timeout) =>
  new Promise((ok) => {
    const hijo = execFile(file, args, { env, cwd, timeout, maxBuffer: 8 << 20, windowsHide: true, windowsVerbatimArguments: verbatim }, (e, stdout, stderr) => {
      const err = e as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
      ok({ code: err ? (typeof err.code === "number" ? err.code : null) : 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), tiempo: !!err?.killed, noExiste: err?.code === "ENOENT" });
    });
    hijo.stdin?.end();
  });

/** La versión de `claude` instalada (`2.1.314`); `null` si no está o no se entiende lo que contesta. */
export async function versionClaude(d: DepsBase = {}): Promise<string | null> {
  const env = d.env ?? process.env;
  const home = d.home ?? homeDe(env);
  const plat = d.plat ?? plataformaActual();
  const l = paraLanzar(resolverClaude(env, home, d.esEjecutable, plat), ["--version"], env, plat);
  const s = await (d.correr ?? correrReal)(l.file, l.args, entornoLider(env, home) as NodeJS.ProcessEnv, l.verbatim, home, 20_000);
  return /\b(\d+\.\d+\.\d+(?:[-+.][\w.]+)?)\b/.exec(s.stdout)?.[1] ?? null;
}

/** El transcript de la sesión `sid` en cualquier carpeta de proyectos de Claude; `null` si no está. */
async function transcriptPorSid(claudeDir: string, sid: string): Promise<{ archivo: string; carpeta: string } | null> {
  const raiz = path.join(claudeDir, "projects");
  for (const c of await readdir(raiz).catch(() => [] as string[])) {
    const archivo = path.join(raiz, c, `${sid}.jsonl`);
    if (await readFile(archivo, "utf8").then(() => true, () => false)) return { archivo, carpeta: path.join(raiz, c) };
  }
  return null;
}

/**
 * Corre `claude -p ok` una vez (el modelo más chico; si no lo acepta, el de siempre) en una carpeta vacía, lee de su transcript el prompt y
 * las herramientas, los guarda y borra lo que dejó la corrida. Si ya hay una base de esa versión la devuelve sin correr nada.
 */
export async function capturarBase(d: DepsBase = {}, forzar = false): Promise<BaseClaude> {
  const env = d.env ?? process.env;
  const home = d.home ?? homeDe(env);
  const plat = d.plat ?? plataformaActual();
  const claudeDir = d.claudeDir ?? env.CLAUDE_CONFIG_DIR ?? path.join(home, ".claude");
  const dirTrama = d.dirTrama ?? configTrama();
  const version = await versionClaude(d);
  if (!version) throw errorT("main.baseSinClaude");
  const ya = (await leerBases(dirTrama))[version];
  if (ya && !forzar) return ya;

  const bin = resolverClaude(env, home, d.esEjecutable, plat);
  const entorno = { ...entornoLider(env, home), GIT_TERMINAL_PROMPT: "0", NO_COLOR: "1" } as NodeJS.ProcessEnv;
  const carpeta = await mkdtemp(path.join(d.tmp ?? os.tmpdir(), "trama-base-"));
  const sid = randomUUID();
  let hallado: { archivo: string; carpeta: string } | null = null;
  try {
    for (const modelo of ["haiku", null]) {
      const argv = ["-p", "ok", "--session-id", sid, "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--output-format", "json", ...(modelo ? ["--model", modelo] : [])];
      const l = paraLanzar(bin, argv, env, plat);
      const s = await (d.correr ?? correrReal)(l.file, l.args, entorno, l.verbatim, carpeta, 120_000);
      if (s.noExiste) throw errorT("main.baseSinClaude");
      hallado = await transcriptPorSid(claudeDir, sid);
      if (s.code === 0 || hallado) break;
      if (s.tiempo) throw errorT("main.baseTiempo");
    }
    if (!hallado) throw errorT("main.baseSinTranscript");
    const base = baseDeTranscript((await readFile(hallado.archivo, "utf8")).split("\n").filter(Boolean));
    if (!base) throw errorT("main.baseSinTranscript");
    // La versión que escribió el transcript es la de verdad; si no coincide con `claude --version` se guarda con la que dice el pedido.
    await guardarBase(base, dirTrama);
    return base;
  } finally {
    // Sólo lo que creó esta corrida: su transcript, su carpeta de proyecto (con la `memory/` vacía que Claude Code le deja) y la carpeta temporal.
    if (hallado) await rm(hallado.archivo, { force: true }).catch(() => {});
    await limpiarProyecto(path.join(claudeDir, "projects", carpeta.replace(/[^A-Za-z0-9]/g, "-")));
    await rm(carpeta, { recursive: true, force: true }).catch(() => {});
  }
}

/** Borra la carpeta de proyecto de la corrida si es suya (lleva `trama-base-` en el nombre) y no tiene más que carpetas vacías. */
async function limpiarProyecto(dir: string): Promise<void> {
  if (!path.basename(dir).includes("trama-base-")) return;
  const entradas = await readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entradas) return;
  for (const e of entradas) {
    if (!e.isDirectory() || (await readdir(path.join(dir, e.name)).catch(() => ["x"])).length) return;
  }
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}
