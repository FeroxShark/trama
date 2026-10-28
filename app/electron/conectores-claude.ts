// Ajustes > Conectores: todo lo que tiene conectado Claude Code en esta máquina (skills, plugins, servidores MCP y hooks) leído de sus
// archivos: `~/.claude/settings.json`, `~/.claude/skills/*/SKILL.md`, `~/.claude/plugins/installed_plugins.json` y los manifiestos de cada
// plugin, `~/.claude.json` (mcpServers por proyecto) y, de cada proyecto conocido, `.mcp.json`, `.claude/skills` y `.claude/settings*.json`.
// Se puede prender y apagar lo que Claude Code deja: un plugin (`enabledPlugins`) y un servidor de `.mcp.json` (`enabledMcpjsonServers` /
// `disabledMcpjsonServers` en `.claude/settings.local.json` del proyecto). NUNCA sale un secreto: de las variables de un MCP sólo el nombre,
// y en comandos, argumentos, URLs y hooks se enmascaran los valores de claves, tokens y contraseñas. Node puro: los tests pasan las rutas.
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { errorT } from "./errores.ts";
import { homeDe, plataformaActual, registroProyectos, type Plataforma } from "./rutas.ts";

type Env = Record<string, string | undefined>;

export type TipoConector = "skill" | "plugin" | "mcp" | "hook";
/** De dónde viene: tu usuario (`~/.claude`), un proyecto (`.claude/` o `.mcp.json`), un plugin o tu cuenta de claude.ai. */
export type OrigenConector = "usuario" | "proyecto" | "plugin" | "claudeai";

export type Conector = {
  /** Estable entre lecturas; es lo que vuelve al prender o apagar. */
  id: string;
  tipo: TipoConector;
  nombre: string;
  origen: OrigenConector;
  /** El plugin (`nombre@mercado`) o el proyecto (su carpeta) de donde viene; vacío si es del usuario. */
  de: string;
  /** Una línea: la `description` del SKILL.md o del plugin.json, o lo que dice la config. */
  descripcion: string;
  activo: boolean;
  /** Se puede prender y apagar desde acá (si no, sigue a su plugin o lo maneja Claude Code). */
  conmutable: boolean;
  /** MCP: `http`, `sse` o `stdio`. Hook: el evento. */
  clase?: string;
  /** MCP: el comando o la URL ya enmascarados. Hook: el comando enmascarado. */
  destino?: string;
  /** Nombres de las variables de un MCP (nunca sus valores). */
  variables?: string[];
  /** Por qué está apagado, cuando no es un simple apagado: `sin-aprobar` (el `.mcp.json` de un proyecto todavía no se aprobó) o `siguePlugin`. */
  nota?: "sin-aprobar" | "sigue-plugin" | "no-instalado";
};

export type Inventario = { version: 1; items: Conector[]; proyectos: string[] };

export type Rutas = {
  /** `~/.claude` (o `CLAUDE_CONFIG_DIR`). */
  claude: string;
  /** `~/.claude.json`. */
  claudeJson: string;
  /** El registro de proyectos de Trama. */
  registro: string;
  home: string;
};

export function rutasClaude(env: Env = process.env, plat: Plataforma = plataformaActual()): Rutas {
  const home = homeDe(env, plat);
  const j = plat === "win32" ? path.win32 : path.posix;
  const claude = env.CLAUDE_CONFIG_DIR || j.join(home, ".claude");
  return { claude, claudeJson: env.CLAUDE_CONFIG_DIR ? j.join(claude, ".claude.json") : j.join(home, ".claude.json"), registro: registroProyectos(env, home, plat), home };
}

// --- Secretos ---------------------------------------------------------------------------------------------------------------------------

const OCULTO = "••••";
const NOMBRE_SECRETO = "(?:key|token|secret|passw(?:or)?d|passwd|pwd|auth|bearer|credential|cookie|signature)";
/** Valores sueltos que parecen claves aunque nadie las nombre (sk-…, ghp_…, xoxb-…). */
const FORMA_CLAVE = /\b(?:sk|pk|rk|ghp|gho|ghu|ghs|github_pat|xox[abprs]|glpat|AKIA|AIza)[-_A-Za-z0-9]{10,}/g;

/** Enmascara lo que parezca un secreto en un texto suelto (un comando, una URL, un argumento). */
export function enmascarar(s: string): string {
  return s
    .replace(new RegExp(`(\\b[\\w.-]*${NOMBRE_SECRETO}[\\w.-]*)(\\s*[=:]\\s*)((?:(?:bearer|basic)\\s+)?(?:"[^"]*"|'[^']*'|[^\\s&"']+))`, "gi"), (_m, k: string, sep: string) => `${k}${sep}${OCULTO}`)
    .replace(/\b(bearer|basic)\s+[^\s"']+/gi, (_m, k: string) => `${k} ${OCULTO}`)
    .replace(/(\/\/[^/\s:@]+:)[^@\s/]+@/g, `$1${OCULTO}@`)
    .replace(FORMA_CLAVE, OCULTO);
}

/** Los argumentos de un comando: el valor que sigue a una bandera tipo `--token` también se oculta. */
export function enmascararArgs(args: string[]): string[] {
  const salida: string[] = [];
  let oculta = false;
  for (const a of args) {
    if (oculta) {
      salida.push(OCULTO);
      oculta = false;
      continue;
    }
    if (new RegExp(`^--?[\\w-]*${NOMBRE_SECRETO}[\\w-]*$`, "i").test(a)) oculta = true;
    salida.push(enmascarar(a));
  }
  return salida;
}

// --- Lectura ----------------------------------------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;
const esObj = (x: unknown): x is Json => !!x && typeof x === "object" && !Array.isArray(x);
const texto = (x: unknown) => (typeof x === "string" ? x : "");
const lista = (x: unknown): string[] => (Array.isArray(x) ? x.filter((y): y is string => typeof y === "string") : []);

async function leerJson(ruta: string): Promise<Json | null> {
  try {
    const j = JSON.parse(await readFile(ruta, "utf8"));
    return esObj(j) ? j : null;
  } catch {
    return null;
  }
}

async function leerTexto(ruta: string): Promise<string | null> {
  try {
    return await readFile(ruta, "utf8");
  } catch {
    return null;
  }
}

async function esCarpeta(ruta: string): Promise<boolean> {
  try {
    return (await stat(ruta)).isDirectory();
  } catch {
    return false;
  }
}

/** Una línea legible: espacios juntos y un largo razonable. */
export function resumir(s: string, max = 220): string {
  const l = s.replace(/\s+/g, " ").trim();
  return l.length > max ? `${l.slice(0, max - 1).trimEnd()}…` : l;
}

/** El frontmatter de un SKILL.md: `clave: valor` con comillas, bloques `|` y `>` o continuación con sangría. Sin dependencias. */
export function frontmatter(md: string): Record<string, string> {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (!m) return {};
  const r: Record<string, string> = {};
  const lineas = m[1].split(/\r?\n/);
  for (let i = 0; i < lineas.length; i++) {
    const k = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lineas[i]);
    if (!k) continue;
    let v = k[2].trim();
    const bloque = /^[|>][+-]?$/.test(v);
    if (bloque || v === "") {
      const partes: string[] = [];
      while (i + 1 < lineas.length && (/^\s+\S/.test(lineas[i + 1]) || lineas[i + 1].trim() === "")) partes.push(lineas[++i].trim());
      v = partes.join(" ");
    } else if (/^["']/.test(v)) {
      const q = v[0];
      while (!(v.length > 1 && v.endsWith(q)) && i + 1 < lineas.length && /^\s+\S/.test(lineas[i + 1])) v += ` ${lineas[++i].trim()}`;
      v = v.slice(1, v.endsWith(q) && v.length > 1 ? -1 : undefined);
      if (q === '"') v = v.replace(/\\(["\\])/g, "$1");
    } else {
      while (i + 1 < lineas.length && /^\s+\S/.test(lineas[i + 1]) && !/^\s+[\w-]+:\s/.test(lineas[i + 1])) v += ` ${lineas[++i].trim()}`;
    }
    r[k[1]] = v.trim();
  }
  return r;
}

async function skillsDe(dir: string): Promise<{ nombre: string; descripcion: string }[]> {
  let entradas: string[];
  try {
    entradas = (await readdir(dir)).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
  const r: { nombre: string; descripcion: string }[] = [];
  for (const e of entradas) {
    const md = await leerTexto(path.join(dir, e, "SKILL.md"));
    if (md === null) continue;
    const f = frontmatter(md);
    r.push({ nombre: f.name || e, descripcion: resumir(f.description || "") });
  }
  return r;
}

type Hook = { evento: string; matcher: string; comando: string; mensaje: string };

/** `{ Evento: [{ matcher, hooks: [{ type, command, statusMessage }] }] }` → una lista plana (sólo los de tipo comando o con url). */
function hooksDe(h: unknown): Hook[] {
  const r: Hook[] = [];
  if (!esObj(h)) return r;
  for (const [evento, grupos] of Object.entries(h)) {
    for (const g of Array.isArray(grupos) ? grupos : []) {
      if (!esObj(g)) continue;
      for (const x of Array.isArray(g.hooks) ? g.hooks : []) {
        if (!esObj(x)) continue;
        const comando = texto(x.command) || texto(x.url) || texto(x.prompt);
        if (comando) r.push({ evento, matcher: texto(g.matcher), comando, mensaje: texto(x.statusMessage) });
      }
    }
  }
  return r;
}

type Servidor = { nombre: string; clase: string; destino: string; variables: string[] };

/** `mcpServers` de un `.mcp.json`, de `~/.claude.json` o de un plugin: sólo qué es; los valores no se leen ni se devuelven. */
function servidoresDe(m: unknown): Servidor[] {
  const r: Servidor[] = [];
  if (!esObj(m)) return r;
  for (const [nombre, c] of Object.entries(m)) {
    if (!esObj(c)) continue;
    const url = texto(c.url);
    const comando = texto(c.command);
    const clase = texto(c.type) || (url ? "http" : "stdio");
    const destino = url ? enmascarar(url) : [enmascarar(comando), ...enmascararArgs(lista(c.args))].filter(Boolean).join(" ");
    const variables = [...Object.keys(esObj(c.env) ? c.env : {}), ...Object.keys(esObj(c.headers) ? c.headers : {})];
    r.push({ nombre, clase, destino, variables });
  }
  return r;
}

// --- Proyectos --------------------------------------------------------------------------------------------------------------------------

const expandir = (p: string, home: string) => (p === "~" ? home : p.startsWith("~/") || p.startsWith("~\\") ? path.join(home, p.slice(2)) : p);
const igual = (a: string, b: string) => path.resolve(a) === path.resolve(b);

/** Los proyectos conocidos: el registro de Trama y los que Claude Code recuerda en `~/.claude.json`, sin repetir y sin el home. */
export async function proyectosConocidos(rutas: Rutas, claudeJson?: Json | null): Promise<string[]> {
  const reg = await leerJson(rutas.registro);
  const vistos: string[] = [];
  const poner = (p: string) => {
    if (!p || igual(p, rutas.home) || vistos.some((v) => igual(v, p))) return;
    vistos.push(p);
  };
  for (const x of Array.isArray(reg?.projects) ? reg!.projects : []) if (esObj(x) && texto(x.path)) poner(expandir(texto(x.path), rutas.home));
  const cj = claudeJson === undefined ? await leerJson(rutas.claudeJson) : claudeJson;
  if (esObj(cj?.projects)) for (const p of Object.keys(cj!.projects as Json)) poner(p);
  const existentes: string[] = [];
  for (const p of vistos) if (await esCarpeta(p)) existentes.push(p);
  return existentes;
}

// --- El inventario ----------------------------------------------------------------------------------------------------------------------

const CLAVE_PLUGIN = /^[^@\s]+@[^@\s]+$/;

type Ajustes = { usuario: Json | null; proyecto: Json | null; local: Json | null };

async function ajustesDe(rutas: Rutas, proyecto?: string): Promise<Ajustes> {
  return {
    usuario: await leerJson(path.join(rutas.claude, "settings.json")),
    proyecto: proyecto ? await leerJson(path.join(proyecto, ".claude", "settings.json")) : null,
    local: proyecto ? await leerJson(path.join(proyecto, ".claude", "settings.local.json")) : null,
  };
}

/** El valor de `enabledPlugins[clave]` con el orden de Claude Code: lo local pisa lo del proyecto y esto lo del usuario. */
function pluginPrendido(a: Ajustes, clave: string): boolean {
  for (const f of [a.local, a.proyecto, a.usuario]) {
    const e = f?.enabledPlugins;
    if (esObj(e) && typeof e[clave] === "boolean") return e[clave] as boolean;
  }
  return false;
}

const idDe = (...partes: string[]) => partes.join("|");

export async function inventario(rutas: Rutas = rutasClaude()): Promise<Inventario> {
  const items: Conector[] = [];
  const cj = await leerJson(rutas.claudeJson);
  const proyectos = await proyectosConocidos(rutas, cj);
  const usuario = await ajustesDe(rutas);
  const hooksOff = usuario.usuario?.disableAllHooks === true;

  // Skills del usuario y de cada proyecto.
  for (const s of await skillsDe(path.join(rutas.claude, "skills")))
    items.push({ id: idDe("skill", "usuario", s.nombre), tipo: "skill", nombre: s.nombre, origen: "usuario", de: "", descripcion: s.descripcion, activo: true, conmutable: false });
  for (const p of proyectos)
    for (const s of await skillsDe(path.join(p, ".claude", "skills")))
      items.push({ id: idDe("skill", "proyecto", p, s.nombre), tipo: "skill", nombre: s.nombre, origen: "proyecto", de: p, descripcion: s.descripcion, activo: true, conmutable: false });

  // Plugins instalados (y los que sólo figuran en `enabledPlugins`), con lo que traen.
  const instalados = await leerJson(path.join(rutas.claude, "plugins", "installed_plugins.json"));
  const vistos = new Set<string>();
  const alcances = new Map<string, Ajustes>();
  const ajustesProyecto = async (p: string) => {
    if (!alcances.has(p)) alcances.set(p, await ajustesDe(rutas, p));
    return alcances.get(p)!;
  };
  const plugins = esObj(instalados?.plugins) ? (instalados!.plugins as Json) : {};
  for (const [clave, instalaciones] of Object.entries(plugins)) {
    if (!CLAVE_PLUGIN.test(clave)) continue;
    for (const inst of Array.isArray(instalaciones) ? instalaciones : []) {
      if (!esObj(inst)) continue;
      const proyecto = texto(inst.scope) === "project" && texto(inst.projectPath) ? texto(inst.projectPath) : "";
      const instalado = texto(inst.installPath);
      const ajustes = proyecto ? await ajustesProyecto(proyecto) : usuario;
      const activo = pluginPrendido(ajustes, clave);
      const manifiesto = instalado ? await leerJson(path.join(instalado, ".claude-plugin", "plugin.json")) : null;
      const id = idDe("plugin", clave, proyecto);
      vistos.add(clave);
      items.push({
        id,
        tipo: "plugin",
        nombre: clave.split("@")[0],
        origen: proyecto ? "proyecto" : "usuario",
        de: proyecto || clave.split("@")[1],
        descripcion: resumir(texto(manifiesto?.description)),
        activo,
        conmutable: true,
        clase: texto(inst.version) || texto(manifiesto?.version) || undefined,
      });
      if (!instalado) continue;
      const nota: Conector["nota"] = activo ? undefined : "sigue-plugin";
      const base = { origen: "plugin" as const, de: clave, activo, conmutable: false, nota };
      for (const s of await skillsDe(path.join(instalado, "skills")))
        items.push({ ...base, id: idDe("skill", "plugin", clave, proyecto, s.nombre), tipo: "skill", nombre: s.nombre, descripcion: s.descripcion });
      // El `.mcp.json` de un plugin es `{ mcpServers: {…} }` o directamente el mapa de servidores.
      const mcpJson = await leerJson(path.join(instalado, ".mcp.json"));
      const mcp = [...servidoresDe(mcpJson?.mcpServers ?? mcpJson), ...servidoresDe(manifiesto?.mcpServers)];
      for (const s of mcp)
        if (!items.some((x) => x.id === idDe("mcp", "plugin", clave, proyecto, s.nombre)))
          items.push({ ...base, id: idDe("mcp", "plugin", clave, proyecto, s.nombre), tipo: "mcp", nombre: s.nombre, descripcion: "", clase: s.clase, destino: s.destino, variables: s.variables });
      const hooksPlugin = [...hooksDe(manifiesto?.hooks), ...hooksDe((await leerJson(path.join(instalado, "hooks", "hooks.json")))?.hooks)];
      hooksPlugin.forEach((h, i) =>
        items.push({
          ...base,
          activo: activo && !hooksOff,
          id: idDe("hook", "plugin", clave, proyecto, String(i)),
          tipo: "hook",
          nombre: h.matcher ? `${h.evento} · ${h.matcher}` : h.evento,
          descripcion: resumir(h.mensaje),
          clase: h.evento,
          destino: resumir(enmascarar(h.comando), 300),
        }),
      );
    }
  }
  const enSettings = usuario.usuario?.enabledPlugins;
  for (const [clave, v] of Object.entries(esObj(enSettings) ? enSettings : {}))
    if (CLAVE_PLUGIN.test(clave) && !vistos.has(clave))
      items.push({ id: idDe("plugin", clave, ""), tipo: "plugin", nombre: clave.split("@")[0], origen: "usuario", de: clave.split("@")[1], descripcion: "", activo: v === true, conmutable: true, nota: "no-instalado" });

  // Servidores MCP: los del usuario y los de cada proyecto en `~/.claude.json`, y el `.mcp.json` de cada proyecto.
  for (const s of servidoresDe(cj?.mcpServers))
    items.push({ id: idDe("mcp", "usuario", s.nombre), tipo: "mcp", nombre: s.nombre, origen: "usuario", de: "", descripcion: "", activo: true, conmutable: false, clase: s.clase, destino: s.destino, variables: s.variables });
  const proyectosCj = esObj(cj?.projects) ? (cj!.projects as Json) : {};
  for (const [p, v] of Object.entries(proyectosCj)) {
    if (!esObj(v)) continue;
    const apagados = lista(v.disabledMcpServers);
    for (const s of servidoresDe(v.mcpServers))
      items.push({ id: idDe("mcp", "proyecto-cj", p, s.nombre), tipo: "mcp", nombre: s.nombre, origen: "proyecto", de: p, descripcion: "", activo: !apagados.includes(s.nombre), conmutable: false, clase: s.clase, destino: s.destino, variables: s.variables });
  }
  const claudeAi = new Set<string>();
  for (const v of Object.values(proyectosCj)) if (esObj(v)) for (const n of lista(v.disabledMcpServers)) if (n.startsWith("claude.ai ")) claudeAi.add(n);
  for (const n of [...claudeAi].sort())
    items.push({ id: idDe("mcp", "claudeai", n), tipo: "mcp", nombre: n.slice("claude.ai ".length), origen: "claudeai", de: "", descripcion: "", activo: false, conmutable: false, clase: "http" });
  for (const p of proyectos) {
    const a = await ajustesProyecto(p);
    const cjp = esObj(proyectosCj[p]) ? (proyectosCj[p] as Json) : {};
    const todos = (k: "enabledMcpjsonServers" | "disabledMcpjsonServers") => [a.usuario, a.proyecto, a.local, cjp].flatMap((f) => lista(f?.[k]));
    const todoPrendido = [a.local, a.proyecto, a.usuario].some((f) => f?.enableAllProjectMcpServers === true);
    for (const s of servidoresDe((await leerJson(path.join(p, ".mcp.json")))?.mcpServers)) {
      const apagado = todos("disabledMcpjsonServers").includes(s.nombre);
      const prendido = todos("enabledMcpjsonServers").includes(s.nombre) || todoPrendido;
      const apagadoEnLocal = lista(a.local?.disabledMcpjsonServers).includes(s.nombre);
      items.push({
        id: idDe("mcp", "proyecto", p, s.nombre),
        tipo: "mcp",
        nombre: s.nombre,
        origen: "proyecto",
        de: p,
        descripcion: "",
        activo: prendido && !apagado,
        // Sólo se toca lo local; si lo apaga otro archivo, prender desde acá no alcanzaría.
        conmutable: !apagado || apagadoEnLocal,
        nota: !prendido && !apagado ? "sin-aprobar" : undefined,
        clase: s.clase,
        destino: s.destino,
        variables: s.variables,
      });
    }
  }

  // Hooks del usuario y de cada proyecto.
  const poner = (origen: OrigenConector, de: string, archivo: string, hs: Hook[]) =>
    hs.forEach((h, i) =>
      items.push({
        id: idDe("hook", origen, de, archivo, String(i)),
        tipo: "hook",
        nombre: h.matcher ? `${h.evento} · ${h.matcher}` : h.evento,
        origen,
        de,
        descripcion: resumir(h.mensaje),
        activo: !hooksOff,
        conmutable: false,
        clase: h.evento,
        destino: resumir(enmascarar(h.comando), 300),
      }),
    );
  poner("usuario", "", "settings.json", hooksDe(usuario.usuario?.hooks));
  poner("usuario", "", "settings.local.json", hooksDe((await leerJson(path.join(rutas.claude, "settings.local.json")))?.hooks));
  for (const p of proyectos) {
    const a = await ajustesProyecto(p);
    poner("proyecto", p, "settings.json", hooksDe(a.proyecto?.hooks));
    poner("proyecto", p, "settings.local.json", hooksDe(a.local?.hooks));
  }

  return { version: 1, items, proyectos };
}

// --- Prender y apagar -------------------------------------------------------------------------------------------------------------------

/** Lee, cambia y reescribe un JSON de ajustes sin tocar el resto de sus claves; si no se puede leer, no se toca. */
async function cambiarAjustes(ruta: string, cambiar: (j: Json) => void): Promise<void> {
  const crudo = await leerTexto(ruta);
  let j: Json = {};
  if (crudo !== null && crudo.trim()) {
    try {
      const x = JSON.parse(crudo);
      if (!esObj(x)) throw new Error("no es un objeto");
      j = x;
    } catch {
      throw errorT("main.conectoresIlegible", { f: path.basename(ruta) });
    }
  }
  cambiar(j);
  await mkdir(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.trama-${process.pid}.tmp`;
  let modo = 0o644;
  try {
    modo = (await stat(ruta)).mode & 0o777;
  } catch {
    /* nuevo */
  }
  await writeFile(tmp, JSON.stringify(j, null, 2) + "\n", { mode: modo });
  await rename(tmp, ruta);
}

const sinRepetir = (l: string[]) => [...new Set(l)];

/**
 * Prende o apaga un conector por su `id` (el de `inventario`). Sólo plugins y servidores de `.mcp.json`; valida contra lo que hay en disco
 * antes de escribir. Devuelve el inventario nuevo.
 */
export async function alternar(id: unknown, activo: unknown, rutas: Rutas = rutasClaude()): Promise<Inventario> {
  if (typeof id !== "string" || typeof activo !== "boolean") throw errorT("main.conectoresNoExiste");
  const inv = await inventario(rutas);
  const it = inv.items.find((x) => x.id === id);
  if (!it || !it.conmutable) throw errorT("main.conectoresNoExiste");
  if (it.tipo === "plugin") {
    const [, clave, proyecto] = id.split("|");
    const ruta = proyecto ? path.join(proyecto, ".claude", "settings.local.json") : path.join(rutas.claude, "settings.json");
    await cambiarAjustes(ruta, (j) => {
      const e = esObj(j.enabledPlugins) ? j.enabledPlugins : {};
      e[clave] = activo;
      j.enabledPlugins = e;
    });
  } else if (it.tipo === "mcp" && it.origen === "proyecto") {
    const ruta = path.join(it.de, ".claude", "settings.local.json");
    await cambiarAjustes(ruta, (j) => {
      const quitar = (k: string) => (j[k] = lista(j[k]).filter((n) => n !== it.nombre));
      const poner = (k: string) => (j[k] = sinRepetir([...lista(j[k]), it.nombre]));
      if (activo) {
        quitar("disabledMcpjsonServers");
        poner("enabledMcpjsonServers");
      } else {
        quitar("enabledMcpjsonServers");
        poner("disabledMcpjsonServers");
      }
      for (const k of ["enabledMcpjsonServers", "disabledMcpjsonServers"]) if (Array.isArray(j[k]) && !(j[k] as unknown[]).length) delete j[k];
    });
  } else throw errorT("main.conectoresNoExiste");
  return inventario(rutas);
}
