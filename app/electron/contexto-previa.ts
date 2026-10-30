// La vista previa del panel de contexto: qué cargaría un líder o un worker NUEVO en un proyecto con un modelo, calculado sin lanzar nada. Sale
// de lo que ya se sabe: el prompt base y las herramientas de Claude Code (capturados una vez por versión, contexto-base.ts), los CLAUDE.md y la
// memoria que cargaría esa carpeta (`memoriaDeSesion`), las skills de ese proyecto, los servidores MCP prendidos (sólo un líder: un worker de
// `pa` va sin MCP) y los hooks. Todo estimado (caracteres / 3,5). Respeta los apagados de Trama (`apagados.json`): lo apagado no se carga (la memoria y las skills apagadas no figuran; las herramientas y MCP apagados figuran,
// tachados, y la vista no los suma). Devuelve un `Desglose` (fuente "previa") para que el panel dibuje lo mismo que con una sesión de verdad.
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { leerApagadosTrama, type Apagados } from "./apagados.ts";
import { leerBases, versionClaude, type BaseClaude, type DepsBase } from "./contexto-base.ts";
import { memoriaDeSesion, tokensAprox, VENTANA_CLAUDE, type Desglose, type FilaCategoria, type FilaHerramienta, type FilaMcp, type FilaMemoria, type FilaSkill } from "./contexto-desglose.ts";
import { leerSesion, piezasSistema } from "./contexto-sesion.ts";
import { inventario, rutasClaude, type Inventario, type Rutas } from "./conectores-claude.ts";
import { errorT } from "./errores.ts";
import { leerMcpSync } from "./mcp-config.ts";
import { catalogoSkills } from "./skills-catalogo.ts";

/** Las skills que carga una sesión en `cwd` (estimado): las prendidas del usuario, de plugins y de claude.ai, y las de ese proyecto. */
export async function skillsDeSesion(cwd: string | null, apagados: Apagados, inv?: Inventario) {
  inv ??= await inventario(rutasClaude());
  const dentro = (de: string) => !!cwd && (cwd === de || cwd.startsWith(de + path.sep));
  return catalogoSkills(inv, apagados)
    .filter((s) => s.estado === "activa" && (s.origen !== "proyecto" || dentro(s.de)))
    .map((s) => ({ nombre: s.clave, origen: s.origen, plugin: s.origen === "plugin" || s.origen === "claudeai" ? s.de : null, tokens: s.tokens }));
}

export type TipoPrevia = "lider" | "worker";

export type HookPrevia = { evento: string; nombre: string; comando: string; origen: string };

export type VistaPrevia = {
  version: 1;
  tipo: TipoPrevia;
  /** La carpeta donde arrancaría (`""`: el home). */
  proyecto: string;
  modelo: string;
  /** El prompt base de Claude Code: `lista` (de la versión instalada), `vieja` (de otra versión: sirve, pero conviene capturar) o `falta`. */
  base: { estado: "lista" | "vieja" | "falta"; version: string | null; instalada: string | null; capturadoEn: number | null };
  proyectos: { ruta: string; nombre: string }[];
  /** Los hooks que correrían (se sabe cuáles, no cuánto agregan: eso depende de lo que impriman). */
  hooks: HookPrevia[];
  /** `null`: no se puede armar (falta la base). */
  desglose: Desglose | null;
};

export type DepsPrevia = DepsBase & {
  rutas?: Rutas;
  apagados?: Apagados;
  /** Los servidores MCP propios de Trama (sus nombres); por defecto los del archivo real. */
  mcpTrama?: () => string[];
  /** La versión instalada de `claude`; por defecto se pregunta (`claude --version`). */
  version?: () => Promise<string | null>;
  inv?: Inventario;
  leer?: (ruta: string) => Promise<string | null>;
};

const MODELO = /^[\w.:/[\]-]{1,80}$/;
const MODELO_DEFAULT = "claude-opus-5-5";

/** La ventana de un modelo: 1M desde la familia 5 (o con `[1m]`), 200 mil antes. */
export const ventanaDe = (modelo: string): number => (/\[1m\]/i.test(modelo) || /^claude-[a-z]+-5(?:[-.]|$)/.test(modelo) ? VENTANA_CLAUDE : 200_000);

const dentro = (cwd: string, de: string) => !!de && (cwd === de || cwd.startsWith(de + path.sep) || cwd.startsWith(de + "/") || cwd.startsWith(de + "\\"));

/** Lo que pide el panel, validado: nunca una ruta que no sea un proyecto conocido ni un modelo raro. */
function entrada(x: unknown, proyectos: string[]): { tipo: TipoPrevia; proyecto: string; modelo: string } {
  const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
  const tipo = o.tipo === "worker" ? "worker" : o.tipo === "lider" || o.tipo === undefined ? "lider" : null;
  if (!tipo) throw errorT("main.previaRara", { v: String(o.tipo).slice(0, 40) });
  const proyecto = typeof o.proyecto === "string" ? o.proyecto : "";
  if (proyecto && !proyectos.includes(proyecto)) throw errorT("main.previaRara", { v: proyecto.slice(0, 80) });
  const modelo = typeof o.modelo === "string" && o.modelo ? o.modelo : MODELO_DEFAULT;
  if (!MODELO.test(modelo)) throw errorT("main.previaRara", { v: modelo.slice(0, 80) });
  return { tipo, proyecto, modelo };
}

/** La base que sirve: la de la versión instalada, si no la más nueva que haya (marcada `vieja`). */
export function elegirBase(bases: Record<string, BaseClaude>, instalada: string | null): { base: BaseClaude | null; estado: "lista" | "vieja" | "falta" } {
  if (instalada && bases[instalada]) return { base: bases[instalada], estado: "lista" };
  const nueva = Object.values(bases).sort((a, b) => b.capturadoEn - a.capturadoEn)[0] ?? null;
  return nueva ? { base: nueva, estado: "vieja" } : { base: null, estado: "falta" };
}

/** El `MEMORY.md` de la memoria automática de esa carpeta, como lo carga Claude Code (hasta 200 líneas), si existe. */
async function memoriaAutomatica(claudeDir: string, cwd: string, leer: (r: string) => Promise<string | null>): Promise<FilaMemoria | null> {
  const ruta = path.join(claudeDir, "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"), "memory", "MEMORY.md");
  const t = await leer(ruta);
  if (!t?.trim()) return null;
  return { ruta, tipo: "AutoMem", tokens: tokensAprox(t.split("\n").slice(0, 200).join("\n")), estimado: true };
}

/** Los hooks prendidos que correrían en una sesión en `cwd`: los del usuario, los de plugins y los del proyecto. */
function hooksDe(inv: Inventario, cwd: string): HookPrevia[] {
  return inv.items
    .filter((i) => i.tipo === "hook" && i.activo && (i.origen !== "proyecto" || dentro(cwd, i.de)))
    .map((i) => ({ evento: i.clase ?? "", nombre: i.nombre, comando: i.destino ?? "", origen: i.origen === "plugin" ? i.de.split("@")[0] : i.origen }));
}

let versionVista: { en: number; v: string | null } | null = null;
/** `claude --version` cada tanto (el panel pide la vista previa cada vez que se cambia algo): la respuesta vale un minuto. */
async function versionInstalada(d: DepsBase): Promise<string | null> {
  if (versionVista && Date.now() - versionVista.en < 60_000) return versionVista.v;
  const v = await versionClaude(d).catch(() => null);
  versionVista = { en: Date.now(), v };
  return v;
}

const cat = (id: FilaCategoria["id"], tokens: number): FilaCategoria => ({ id, nombre: null, tokens, estimado: true });

/**
 * Qué cargaría un líder o un worker nuevo. `{ tipo, proyecto?, modelo? }`: `proyecto` tiene que ser un proyecto conocido (o vacío: el home,
 * donde corre un líder sin carpeta). Sin base capturada devuelve el resto de los datos y `desglose: null`.
 */
export async function vistaPrevia(x: unknown, d: DepsPrevia = {}): Promise<VistaPrevia> {
  const home = d.home ?? os.homedir();
  const rutas = d.rutas ?? rutasClaude();
  const claudeDir = d.claudeDir ?? rutas.claude;
  const inv = d.inv ?? (await inventario(rutas));
  const { tipo, proyecto, modelo } = entrada(x, inv.proyectos);
  const cwd = proyecto || home;
  const apagados = d.apagados ?? leerApagadosTrama();
  const instalada = await (d.version ?? (() => versionInstalada(d)))();
  const { base, estado } = elegirBase(await leerBases(d.dirTrama), instalada);
  const proyectos = inv.proyectos.map((ruta) => ({ ruta, nombre: path.basename(ruta) || ruta }));
  const hooks = hooksDe(inv, cwd);
  const vista = { version: 1 as const, tipo, proyecto, modelo, base: { estado, version: base?.version ?? null, instalada, capturadoEn: base?.capturadoEn ?? null }, proyectos, hooks };
  if (!base) return { ...vista, desglose: null };

  // Sistema: el prompt base partido en secciones.
  const info = leerSesion([]);
  info.promptPartes = base.partes;
  const sistema = piezasSistema(info);

  // Herramientas: las integradas cargadas (con su peso) y las diferidas (sólo el nombre).
  const herramientas: FilaHerramienta[] = [
    ...base.herramientas.map((h) => ({ nombre: h.nombre, tokens: h.tokens, diferida: false, usos: 0 })),
    ...base.diferidas.filter((n) => !base.herramientas.some((h) => h.nombre === n)).map((n) => ({ nombre: n, tokens: null, diferida: true, usos: 0 })),
  ];

  // Memoria: los CLAUDE.md de esa carpeta (a un worker `pa` le saca el del home) más la memoria automática.
  const leer = d.leer ?? ((r: string) => readFile(r, "utf8").catch(() => null));
  const excludes = [...(tipo === "worker" ? [path.join(home, "CLAUDE.md")] : []), ...apagados.memoria];
  const memoria = await memoriaDeSesion({ cwd, claudeDir, excludes }, leer);
  const auto = await memoriaAutomatica(claudeDir, cwd, leer);
  if (auto && !memoria.some((m) => m.ruta === auto.ruta) && !excludes.includes(auto.ruta)) memoria.push(auto);

  // Skills (sólo la descripción está cargada) y MCP prendidos. Su peso se sabe al conectar: acá sólo que se cargarían.
  const skills: FilaSkill[] = (await skillsDeSesion(cwd, apagados, inv)).map((s) => ({ nombre: s.nombre, origen: s.origen, plugin: s.plugin, tokens: s.tokens, estimado: true, usos: 0, hook: 0 }));
  const nombresMcp = tipo === "worker" ? [] : [...new Set([...inv.items.filter((i) => i.tipo === "mcp" && i.activo && (i.origen !== "proyecto" || dentro(cwd, i.de))).map((i) => i.nombre), ...(d.mcpTrama ?? (() => leerMcpSync().map((s) => s.nombre)))()])];
  const mcp: FilaMcp[] = nombresMcp.map((servidor) => ({ servidor, tokens: null, usos: 0, instrucciones: 0, diferidos: null, resultados: null, herramientas: [] }));

  const suma = (xs: number[]) => xs.reduce((n, v) => n + v, 0);
  const categorias = [
    cat("sistema", suma(sistema.map((s) => s.tokens))),
    cat("herramientas", suma(herramientas.filter((h) => !h.diferida).map((h) => h.tokens ?? 0))),
    ...(mcp.length ? [cat("mcp", 0)] : []),
    cat("skills", suma(skills.map((s) => s.tokens ?? 0))),
    cat("memoria", suma(memoria.map((m) => m.tokens))),
  ];
  const usado = suma(categorias.map((c) => c.tokens));
  const desglose: Desglose = {
    version: 1,
    quien: { tipo, id: "" },
    motor: "claude",
    fuente: "previa",
    estimado: true,
    modelo,
    usado,
    ventana: ventanaDe(modelo),
    ventanaEstimada: true,
    categorias,
    herramientas,
    mcp,
    skills,
    memoria,
    sistema,
    promptVersion: base.version,
    usos: { herramientas: {}, skills: {}, mcp: {}, hook: {} },
    medidoEn: null,
    desactualizado: false,
    sinUso: { herramientas: [], mcp: [], skills: [] },
    motivo: null,
  };
  return { ...vista, desglose };
}
