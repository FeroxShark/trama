// Ajustes > Conectores > Catálogos de plugins: instalar skills y plugins de Claude Code sin la terminal. Lee de disco los catálogos que ya conoce
// Claude Code (`~/.claude/plugins/known_marketplaces.json` y el `marketplace.json` de cada uno) y suma los dos oficiales de Anthropic aunque
// todavía no estén agregados. Agregar un catálogo, instalar y quitar un plugin los hace el propio `claude` (`claude plugin marketplace add <repo>`,
// `claude plugin install|uninstall <plugin>@<catálogo>`), sin shell: en Windows `claude.exe`, o el `claude.cmd` de npm por `cmd.exe` (`paraLanzar`).
// Con una cuenta elegida corre con su `CLAUDE_CONFIG_DIR` (las cuentas agregadas comparten `plugins/` con `~/.claude`, así que lo instalado se ve
// en todas). Todo se valida antes de correr algo: el repo es `usuario/repo` de GitHub y el plugin tiene que estar en un catálogo agregado.
// Node puro: los tests inyectan `claude` (el falso) y las rutas.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { paraLanzar, resolverBinario, resolverNpm } from "./binario.ts";
import { resumir, rutasClaude, type Rutas } from "./conectores-claude.ts";
import { errorT } from "./errores.ts";
import { entornoLider } from "./lider-arma.ts";
import { carpetaBin, homeDe, plataformaActual, type Plataforma } from "./rutas.ts";
import { cuentasClaude } from "./uso-cuentas.ts";

type Env = Record<string, string | undefined>;

/** Los catálogos oficiales que se ofrecen siempre (el nombre del catálogo es el de su `marketplace.json`, que se conoce recién al agregarlo). */
export const CATALOGOS_CONOCIDOS: readonly { repo: string; id: string }[] = [
  { repo: "anthropics/skills", id: "anthropic-agent-skills" },
  { repo: "anthropics/claude-plugins-official", id: "claude-plugins-official" },
];

export type PluginCatalogo = { nombre: string; descripcion: string; categoria: string; instalado: boolean };
export type Catalogo = {
  /** El nombre del catálogo (el del `marketplace.json`): es el que va después de la `@` en `plugin@catalogo`. */
  id: string;
  /** `usuario/repo` de GitHub, o vacío si el catálogo viene de otro lado (una URL de git, una carpeta). */
  repo: string;
  /** Uno de los oficiales que se ofrecen siempre. */
  conocido: boolean;
  /** Claude Code ya lo tiene agregado (si no, hay que agregarlo para ver sus plugins). */
  agregado: boolean;
  plugins: PluginCatalogo[];
};
export type EstadoCatalogos = {
  version: 1;
  catalogos: Catalogo[];
  /** Las cuentas agregadas de Claude con las que se puede correr (la de siempre no figura: es la opción por defecto). */
  cuentas: string[];
};

export type Salida = { code: number | null; stdout: string; stderr: string; tiempo: boolean; noExiste: boolean };

export type DepsPlugins = {
  env: Env;
  home: string;
  plat?: Plataforma;
  esEjecutable?: (f: string) => boolean;
  rutas?: Rutas;
  /** Las cuentas agregadas de Claude con su carpeta (`cuentas.json`); por defecto las del archivo real. */
  cuentas?: () => { id: string; dir: string }[];
  /** Corre un comando ya armado; por defecto `execFile` de verdad. */
  correr?: (file: string, args: string[], env: NodeJS.ProcessEnv, verbatim: boolean, timeoutMs: number) => Promise<Salida>;
};

// --- Validación -------------------------------------------------------------------------------------------------------------------------

const REPO = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9_.-]{1,100}$/;
const NOMBRE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const ID_CUENTA = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** `usuario/repo` (también acepta la URL de GitHub con o sin `.git`); `null` si no es un repo de GitHub válido. */
export function normalizarRepo(x: unknown): string | null {
  if (typeof x !== "string") return null;
  let r = x.trim().replace(/^https:\/\/github\.com\//i, "").replace(/\/+$/, "").replace(/\.git$/i, "");
  if (r.includes("..")) return null;
  r = r.replace(/^github\.com\//i, "");
  return REPO.test(r) ? r : null;
}

// --- Lectura ----------------------------------------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;
const esObj = (x: unknown): x is Json => !!x && typeof x === "object" && !Array.isArray(x);
const texto = (x: unknown) => (typeof x === "string" ? x : "");

async function leerJson(ruta: string): Promise<Json | null> {
  try {
    const j = JSON.parse(await readFile(ruta, "utf8"));
    return esObj(j) ? j : null;
  } catch {
    return null;
  }
}

/** Los `plugin@catalogo` que Claude Code tiene instalados para todo el usuario (alcance `user`, el que usa esta pantalla). */
async function instaladosDelUsuario(rutas: Rutas): Promise<Set<string>> {
  const j = await leerJson(path.join(rutas.claude, "plugins", "installed_plugins.json"));
  const r = new Set<string>();
  for (const [clave, v] of Object.entries(esObj(j?.plugins) ? (j!.plugins as Json) : {}))
    if (Array.isArray(v) && v.some((x) => esObj(x) && texto(x.scope) === "user")) r.add(clave);
  return r;
}

async function pluginsDe(instalacion: string, id: string, instalados: Set<string>): Promise<PluginCatalogo[]> {
  const ruta = instalacion.endsWith(".json") ? instalacion : path.join(instalacion, ".claude-plugin", "marketplace.json");
  const mercado = await leerJson(ruta);
  const r: PluginCatalogo[] = [];
  const vistos = new Set<string>();
  for (const p of Array.isArray(mercado?.plugins) ? mercado!.plugins : []) {
    if (!esObj(p) || !NOMBRE.test(texto(p.name)) || vistos.has(texto(p.name))) continue;
    vistos.add(texto(p.name));
    r.push({ nombre: texto(p.name), descripcion: resumir(texto(p.description)), categoria: texto(p.category), instalado: instalados.has(`${p.name}@${id}`) });
  }
  return r.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/** Los catálogos que Claude Code ya tiene (con sus plugins) y, antes que ellos, los oficiales que todavía no se agregaron. */
export async function estadoCatalogos(d: DepsPlugins): Promise<EstadoCatalogos> {
  const rutas = d.rutas ?? rutasClaude(d.env, d.plat ?? plataformaActual());
  const conocidos = await leerJson(path.join(rutas.claude, "plugins", "known_marketplaces.json"));
  const instalados = await instaladosDelUsuario(rutas);
  const agregados: Catalogo[] = [];
  for (const [id, v] of Object.entries(conocidos ?? {})) {
    if (!esObj(v) || !NOMBRE.test(id)) continue;
    const origen = esObj(v.source) ? v.source : {};
    // Los catálogos de tu cuenta de claude.ai no se tocan desde acá: sus plugins salen en el inventario.
    if (texto(origen.source) === "claudeai") continue;
    const repo = texto(origen.source) === "github" ? (normalizarRepo(origen.repo) ?? "") : "";
    const conocido = CATALOGOS_CONOCIDOS.some((c) => c.repo.toLowerCase() === repo.toLowerCase());
    agregados.push({ id, repo, conocido, agregado: true, plugins: texto(v.installLocation) ? await pluginsDe(texto(v.installLocation), id, instalados) : [] });
  }
  const faltan: Catalogo[] = CATALOGOS_CONOCIDOS.filter((c) => !agregados.some((a) => a.repo.toLowerCase() === c.repo.toLowerCase())).map((c) => ({ id: c.id, repo: c.repo, conocido: true, agregado: false, plugins: [] }));
  const orden = (c: Catalogo) => (c.conocido ? CATALOGOS_CONOCIDOS.findIndex((k) => k.repo.toLowerCase() === c.repo.toLowerCase()) : CATALOGOS_CONOCIDOS.length);
  const catalogos = [...faltan, ...agregados].sort((a, b) => orden(a) - orden(b) || a.id.localeCompare(b.id));
  return { version: 1, catalogos, cuentas: (d.cuentas ?? (() => cuentasClaude(d.env, d.home)))().map((c) => c.id) };
}

// --- Correr `claude` --------------------------------------------------------------------------------------------------------------------

/** El `claude` de la app: `HILOS_CLAUDE`, el del PATH o `~/.local/bin` (`claude.exe`), y en Windows el `claude.cmd` de npm. Sin nada: `claude` pelado. */
export function resolverClaude(env: Env, home: string, esEjecutable?: (f: string) => boolean, plat: Plataforma = plataformaActual()): string {
  const r = resolverBinario("claude", "HILOS_CLAUDE", env, home, esEjecutable, plat);
  if (r !== "claude" || plat !== "win32") return r;
  // El instalador nativo de Claude Code deja `claude.exe` en `%USERPROFILE%\.local\bin`, que no siempre está en el PATH de la app.
  const propio = path.win32.join(home, ".local", "bin", "claude.exe");
  if ((esEjecutable ?? (() => false))(propio)) return propio;
  return resolverNpm("claude", env, home, [carpetaBin(env, home, plat)], esEjecutable, plat);
}

const correrReal: NonNullable<DepsPlugins["correr"]> = (file, args, env, verbatim, timeout) =>
  new Promise((ok) => {
    const hijo = execFile(file, args, { env, timeout, maxBuffer: 4 << 20, windowsHide: true, windowsVerbatimArguments: verbatim, cwd: homeDe(env as Env) }, (e, stdout, stderr) => {
      const err = e as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
      ok({ code: err ? (typeof err.code === "number" ? err.code : null) : 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), tiempo: !!err?.killed, noExiste: err?.code === "ENOENT" });
    });
    hijo.stdin?.end();
  });

// eslint-disable-next-line no-control-regex
const sinColores = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
/** Lo último que dijo `claude` (stderr primero), en una línea y sin secretos a la vista. */
const motivo = (s: Salida) => {
  const lineas = sinColores(`${s.stderr}\n${s.stdout}`).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return resumir(lineas[0] ?? "", 300);
};

async function claude(d: DepsPlugins, argv: string[], cuenta: unknown, timeoutMs: number): Promise<void> {
  const plat = d.plat ?? plataformaActual();
  let dirCuenta = "";
  if (cuenta !== undefined && cuenta !== null && cuenta !== "") {
    const c = typeof cuenta === "string" && ID_CUENTA.test(cuenta) ? (d.cuentas ?? (() => cuentasClaude(d.env, d.home)))().find((x) => x.id === cuenta) : undefined;
    if (!c) throw errorT("main.pluginsCuenta");
    dirCuenta = c.dir;
  }
  const env: Env = { ...entornoLider(d.env, d.home), GIT_TERMINAL_PROMPT: "0", NO_COLOR: "1" };
  if (dirCuenta) env.CLAUDE_CONFIG_DIR = dirCuenta;
  const bin = resolverClaude(d.env, d.home, d.esEjecutable, plat);
  const l = paraLanzar(bin, ["plugin", ...argv], d.env, plat);
  const s = await (d.correr ?? correrReal)(l.file, l.args, env as NodeJS.ProcessEnv, l.verbatim, timeoutMs);
  if (s.noExiste) throw errorT("main.pluginsSinClaude");
  if (s.tiempo) throw errorT("main.pluginsTiempo");
  if (s.code !== 0) throw errorT("main.pluginsFallo", { m: motivo(s) || `claude plugin ${argv[0]} → ${s.code}` });
}

// --- Acciones ---------------------------------------------------------------------------------------------------------------------------

/** `claude plugin marketplace add <usuario/repo>` y el estado nuevo. */
export async function agregarCatalogo(repo: unknown, cuenta: unknown, d: DepsPlugins): Promise<EstadoCatalogos> {
  const r = normalizarRepo(repo);
  if (!r) throw errorT("main.pluginsRepo");
  await claude(d, ["marketplace", "add", r], cuenta, 180_000);
  return estadoCatalogos(d);
}

async function delCatalogo(d: DepsPlugins, plugin: unknown, catalogo: unknown): Promise<{ p: string; c: string; instalado: boolean }> {
  if (typeof plugin !== "string" || typeof catalogo !== "string" || !NOMBRE.test(plugin) || !NOMBRE.test(catalogo)) throw errorT("main.pluginsNoExiste");
  const cat = (await estadoCatalogos(d)).catalogos.find((x) => x.agregado && x.id === catalogo);
  const p = cat?.plugins.find((x) => x.nombre === plugin);
  if (!p) throw errorT("main.pluginsNoExiste");
  return { p: plugin, c: catalogo, instalado: p.instalado };
}

/** `claude plugin install <plugin>@<catálogo>` de un plugin que figura en un catálogo ya agregado. */
export async function instalarPlugin(plugin: unknown, catalogo: unknown, cuenta: unknown, d: DepsPlugins): Promise<EstadoCatalogos> {
  const x = await delCatalogo(d, plugin, catalogo);
  await claude(d, ["install", `${x.p}@${x.c}`], cuenta, 240_000);
  return estadoCatalogos(d);
}

/** `claude plugin uninstall <plugin>@<catálogo>` de uno instalado. */
export async function quitarPlugin(plugin: unknown, catalogo: unknown, cuenta: unknown, d: DepsPlugins): Promise<EstadoCatalogos> {
  const x = await delCatalogo(d, plugin, catalogo);
  if (!x.instalado) throw errorT("main.pluginsNoExiste");
  await claude(d, ["uninstall", `${x.p}@${x.c}`], cuenta, 120_000);
  return estadoCatalogos(d);
}
