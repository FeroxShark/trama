// Ajustes > Conectores > Descubrir: un catálogo para encontrar skills y conectores MCP sin salir de Trama. Dos fuentes públicas, sin clave:
//  · el registro MCP oficial (`registry.modelcontextprotocol.io/v0/servers`, paginado con `nextCursor`), y
//  · `github.com/anthropics/skills` (una carpeta por skill con su `SKILL.md`; `docx`, `pdf`, `pptx` y `xlsx` quedan afuera: no son open source).
// Todo se baja como DATOS (JSON y texto): nada se evalúa ni se ejecuta, y cada respuesta tiene tope de tamaño y de tiempo. Se baja sólo cuando la
// persona abre la sección sin caché de hoy o aprieta «Actualizar» (nunca por sondeo) y queda en `$HILOS_STATE/descubrir.json`.
// Instalar siempre es una acción aparte, que la interfaz confirma diciendo qué pasa:
//  · skill → copia su carpeta a `~/.claude/skills/<nombre>` (nombre y rutas validados, sin pisar una existente, cada archivo verificado contra
//    el hash que dio GitHub);
//  · MCP remoto → lo agrega a los conectores propios (`mcp-config.ts`), sólo si la URL es `https`;
//  · MCP de paquete → NUNCA ejecuta nada: la interfaz muestra el comando y el enlace del paquete para que la persona decida.
// La interfaz sólo manda un `id`: las URLs y los nombres que se instalan salen de lo que este módulo guardó, nunca de lo que diga el renderer.
// Node puro: los tests pasan un `fetch` y las URLs de un servidor falso en 127.0.0.1, y un HOME temporal.
import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { errorT } from "./errores.ts";
import { guardarServidor, leerMcp, rutaMcp } from "./mcp-config.ts";
import { estadoHilos } from "./rutas.ts";

type Env = Record<string, string | undefined>;

export const ORIGEN_SKILLS = "anthropics/skills";
export const ORIGEN_MCP = "registry.modelcontextprotocol.io";
/** Las skills de Anthropic que NO son open source (source-available): no se ofrecen. */
export const SKILLS_EXCLUIDAS: readonly string[] = ["docx", "pdf", "pptx", "xlsx"];

const URLS = { registro: "https://registry.modelcontextprotocol.io", api: "https://api.github.com", raw: "https://raw.githubusercontent.com" };

export type Limites = {
  /** Milisegundos por pedido (cuenta también la lectura del cuerpo). */
  tiempo: number;
  /** Bytes de una página del registro MCP. */
  pagina: number;
  /** Páginas del registro que se piden como mucho (100 servidores cada una). */
  paginas: number;
  /** Servidores que se guardan como mucho. */
  servidores: number;
  /** Bytes del árbol de archivos de GitHub. */
  arbol: number;
  /** Bytes de un SKILL.md leído para la descripción. */
  skillMd: number;
  /** Bytes de un archivo de una skill al instalar. */
  archivo: number;
  /** Bytes de toda una skill al instalar. */
  skillTotal: number;
  /** Archivos de una skill al instalar. */
  archivos: number;
  /** Bytes del archivo de caché que se lee. */
  cache: number;
};
export const LIMITES: Limites = { tiempo: 15_000, pagina: 1_500_000, paginas: 6, servidores: 600, arbol: 8_000_000, skillMd: 131_072, archivo: 10_000_000, skillTotal: 40_000_000, archivos: 400, cache: 6_000_000 };

/** Cuánto vale la caché al abrir la sección sin apretar «Actualizar». */
const VIGENCIA_MS = 24 * 3_600_000;

export type DepsDescubrir = {
  env?: Env;
  home: string;
  /** Carpeta de estado (`$HILOS_STATE`); por defecto la de `rutas.ts`. */
  estado?: string;
  urls?: Partial<typeof URLS>;
  fetch?: typeof fetch;
  ahora?: () => number;
  limites?: Partial<Limites>;
};

// --- Tipos que ve la interfaz ---------------------------------------------------------------------------------------------------------

export type ItemSkill = {
  id: string;
  tipo: "skill";
  nombre: string;
  descripcion: string | null;
  origen: string;
  enlace: string;
  /** El árbol de GitHub no trae fechas: queda `null` («sin dato»). */
  fecha: string | null;
  archivos: number;
  scripts: boolean;
  instalado: boolean;
};

export type PaqueteMcp = { tipo: string; identificador: string; version: string | null; comando: string; enlace: string | null };
export type RemotoMcp = { url: string; dominio: string; seguro: boolean };

export type ItemMcp = {
  id: string;
  tipo: "mcp";
  /** El nombre del registro (`io.github.usuario/servidor`). */
  nombre: string;
  titulo: string | null;
  descripcion: string | null;
  origen: string;
  enlace: string | null;
  /** `updatedAt` / `publishedAt` del registro; `null` si falta o no es una fecha. */
  fecha: string | null;
  version: string | null;
  remoto: RemotoMcp | null;
  /** Nombres de las cabeceras que el servidor pide (sin valores). */
  cabeceras: string[];
  paquete: PaqueteMcp | null;
  agregado: boolean;
};

export type ErrorFuente = string | null;

export type CatalogoDescubrir = {
  skills: ItemSkill[];
  mcp: ItemMcp[];
  /** Cuándo se bajó (ms); `null` si nunca. */
  actualizado: number | null;
  /** Texto traducible por fuente si la última bajada falló (se conserva lo viejo si había). */
  errores: { skills: ErrorFuente; mcp: ErrorFuente };
};

export type PreviaSkill = { tipo: "skill"; id: string; nombre: string; destino: string; archivos: { ruta: string; tam: number }[]; total: number; scripts: string[]; huella: string };
export type PreviaMcp = { tipo: "mcp"; id: string; nombre: string; url: string; dominio: string; cabeceras: string[] };
export type Previa = PreviaSkill | PreviaMcp;

export type ResultadoInstalar = { tipo: "skill"; nombre: string; carpeta: string; archivos: number } | { tipo: "mcp"; nombre: string };

// --- Red con topes --------------------------------------------------------------------------------------------------------------------

const lim = (d: DepsDescubrir): Limites => ({ ...LIMITES, ...d.limites });
const urls = (d: DepsDescubrir) => ({ ...URLS, ...d.urls });

/** Baja una URL como bytes: sin seguir redirecciones, con tiempo total y con tope (corta apenas se pasa, sin leer el resto). */
async function traer(d: DepsDescubrir, url: string, max: number): Promise<Buffer> {
  const f = d.fetch ?? fetch;
  let r: Response;
  try {
    r = await f(url, { signal: AbortSignal.timeout(lim(d).tiempo), redirect: "error", headers: { accept: "application/json, text/plain, */*", "user-agent": "Trama" } });
  } catch (x) {
    throw errorT(esTiempo(x) ? "main.descubrirTiempo" : "main.descubrirRed");
  }
  if (!r.ok) {
    await r.body?.cancel().catch(() => {});
    throw errorT("main.descubrirHttp", { c: r.status });
  }
  const largo = Number(r.headers.get("content-length"));
  if (Number.isFinite(largo) && largo > max) {
    await r.body?.cancel().catch(() => {});
    throw errorT("main.descubrirGrande");
  }
  const partes: Buffer[] = [];
  let n = 0;
  try {
    const lector = r.body?.getReader();
    for (;;) {
      const p = await lector?.read();
      if (!p || p.done) break;
      n += p.value.byteLength;
      if (n > max) {
        await lector!.cancel().catch(() => {});
        throw errorT("main.descubrirGrande");
      }
      partes.push(Buffer.from(p.value));
    }
  } catch (x) {
    if (x instanceof Error && x.message.includes("descubrirGrande")) throw x;
    throw errorT(esTiempo(x) ? "main.descubrirTiempo" : "main.descubrirRed");
  }
  return Buffer.concat(partes);
}

const esTiempo = (x: unknown) => x instanceof Error && (x.name === "TimeoutError" || x.name === "AbortError");

/** Bytes → JSON; lo que no es JSON es «respuesta rara», nunca una excepción de JSON.parse suelta. */
function aJson(b: Buffer): unknown {
  try {
    return JSON.parse(b.toString("utf8"));
  } catch {
    throw errorT("main.descubrirMalformado");
  }
}

// --- Validaciones ---------------------------------------------------------------------------------------------------------------------

const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
const txt = (x: unknown, max = 600): string | null => {
  if (typeof x !== "string") return null;
  // Texto plano: sin caracteres de control (salvo saltos), recortado.
  const s = x.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};
const fechaIso = (x: unknown): string | null => {
  if (typeof x !== "string") return null;
  const t = Date.parse(x);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** Nombre de una carpeta de skill: minúsculas, números, guion y guion bajo. Nada de puntos, barras ni `..`. */
export const NOMBRE_SKILL = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const RESERVADOS_WIN = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** Un tramo de una ruta dentro de una skill: nada de `..`, `.git`, separadores, `:` ni nombres reservados de Windows. */
export function tramoSeguro(s: string): boolean {
  if (!s || s.length > 120 || s === "." || s === "..") return false;
  if (!/^[A-Za-z0-9._@+=~#() -]+$/.test(s)) return false;
  if (/[. ]$/.test(s) || s.startsWith(" ")) return false;
  if (s.toLowerCase() === ".git" || RESERVADOS_WIN.test(s)) return false;
  return true;
}

/** Una ruta relativa dentro de una skill (con `/`), tramo por tramo. */
export const rutaSegura = (r: string): boolean => r.length <= 240 && r.split("/").every(tramoSeguro);

/** Sólo `https:` y sin usuario ni contraseña en la URL; devuelve la URL normalizada. */
export function urlHttps(x: unknown): string | null {
  if (typeof x !== "string" || x.length > 600) return null;
  try {
    const u = new URL(x);
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const dominioDe = (url: string): string | null => {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
};

// --- Registro MCP ---------------------------------------------------------------------------------------------------------------------

const comandoDe = (tipo: string, id: string, version: string | null): string | null => {
  const seguro = /^[A-Za-z0-9@/._:-]{1,200}$/.test(id) && (!version || /^[A-Za-z0-9._+-]{1,60}$/.test(version));
  if (!seguro) return null;
  if (tipo === "npm") return `npx -y ${id}${version ? `@${version}` : ""}`;
  if (tipo === "pypi") return `uvx ${id}${version ? `==${version}` : ""}`;
  if (tipo === "oci") return `docker run -i --rm ${id}`;
  if (tipo === "nuget") return `dnx ${id}${version ? `@${version}` : ""}`;
  return null;
};
const enlaceDePaquete = (tipo: string, id: string): string | null => {
  const e = encodeURIComponent(id).replace(/%2F/gi, "/");
  if (tipo === "npm") return `https://www.npmjs.com/package/${e}`;
  if (tipo === "pypi") return `https://pypi.org/project/${encodeURIComponent(id)}/`;
  if (tipo === "nuget") return `https://www.nuget.org/packages/${encodeURIComponent(id)}`;
  return null;
};

/** Un renglón del registro → un item; `null` si no sirve (sin nombre, dado de baja, sin remoto ni paquete que mostrar). */
export function itemMcpDe(x: unknown): ItemMcp | null {
  const e = obj(x);
  const s = obj(e.server);
  const oficial = obj(obj(e._meta)["io.modelcontextprotocol.registry/official"]);
  const nombre = txt(s.name, 200);
  if (!nombre || !/^[A-Za-z0-9][A-Za-z0-9._/@:-]*$/.test(nombre)) return null;
  const estado = typeof oficial.status === "string" ? oficial.status : "active";
  if (estado !== "active") return null;
  let remoto: RemotoMcp | null = null;
  let cabeceras: string[] = [];
  for (const r of Array.isArray(s.remotes) ? s.remotes : []) {
    const o = obj(r);
    if (o.type !== "streamable-http" && o.type !== "sse") continue;
    const url = typeof o.url === "string" ? o.url.trim() : "";
    // Una URL con {variables} es una plantilla: no se puede instalar tal cual.
    if (!url || /[{}]/.test(url)) continue;
    const seguro = urlHttps(url);
    const dom = dominioDe(url);
    if (!dom || !/^https?:$/.test(new URL(url).protocol)) continue;
    // Se prefiere un remoto seguro a uno que no lo es.
    if (remoto && (remoto.seguro || !seguro)) continue;
    remoto = { url: seguro ?? url, dominio: dom, seguro: !!seguro };
    cabeceras = (Array.isArray(o.headers) ? o.headers : [])
      .map((h) => obj(h))
      .filter((h) => h.isRequired === true && typeof h.name === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(h.name))
      .map((h) => h.name as string);
  }
  let paquete: PaqueteMcp | null = null;
  for (const p of Array.isArray(s.packages) ? s.packages : []) {
    const o = obj(p);
    const tipo = txt(o.registryType, 20)?.toLowerCase();
    const id = txt(o.identifier, 200);
    if (!tipo || !id) continue;
    const version = txt(o.version, 60);
    const comando = comandoDe(tipo, id, version);
    if (!comando) continue;
    paquete = { tipo, identificador: id, version, comando, enlace: enlaceDePaquete(tipo, id) };
    break;
  }
  if (!remoto && !paquete) return null;
  const enlace = urlHttps(s.websiteUrl) ?? urlHttps(obj(s.repository).url) ?? paquete?.enlace ?? null;
  return {
    id: `mcp:${nombre}`,
    tipo: "mcp",
    nombre,
    titulo: txt(s.title, 120),
    descripcion: txt(s.description),
    origen: ORIGEN_MCP,
    enlace,
    fecha: fechaIso(oficial.updatedAt) ?? fechaIso(oficial.publishedAt),
    version: txt(s.version, 60),
    remoto,
    cabeceras,
    paquete,
    agregado: false,
  };
}

/** Las páginas del registro → un item por servidor (la última versión; los dados de baja y los repetidos no entran). */
export function itemsMcpDe(entradas: unknown[], maximo = LIMITES.servidores): ItemMcp[] {
  const porNombre = new Map<string, { item: ItemMcp; ultima: boolean }>();
  for (const e of entradas) {
    const item = itemMcpDe(e);
    if (!item) continue;
    const ultima = obj(obj(obj(e)._meta)["io.modelcontextprotocol.registry/official"]).isLatest === true;
    const previo = porNombre.get(item.nombre);
    if (!previo || (ultima && !previo.ultima) || (ultima === previo.ultima && (item.fecha ?? "") > (previo.item.fecha ?? ""))) porNombre.set(item.nombre, { item, ultima });
  }
  return [...porNombre.values()].map((v) => v.item).slice(0, maximo);
}

async function bajarMcp(d: DepsDescubrir): Promise<ItemMcp[]> {
  const l = lim(d);
  const base = urls(d).registro.replace(/\/+$/, "");
  const entradas: unknown[] = [];
  let cursor = "";
  for (let i = 0; i < l.paginas; i++) {
    const q = `limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const j = obj(aJson(await traer(d, `${base}/v0/servers?${q}`, l.pagina)));
    if (!Array.isArray(j.servers)) throw errorT("main.descubrirMalformado");
    entradas.push(...j.servers);
    const sig = obj(j.metadata).nextCursor;
    if (typeof sig !== "string" || !sig || sig === cursor || entradas.length >= l.servidores * 2) break;
    cursor = sig;
  }
  return itemsMcpDe(entradas, l.servidores);
}

// --- Skills de GitHub -----------------------------------------------------------------------------------------------------------------

export type ArchivoSkill = { ruta: string; tam: number; sha: string; ejecutable: boolean };
const EXTENSIONES_SCRIPT = /\.(py|sh|bash|zsh|js|mjs|cjs|ts|rb|pl|php|ps1|bat|cmd|exe|dll|so|jar)$/i;
/** Un archivo que ejecutaría algo: está en `scripts/`, tiene bit de ejecución o extensión de programa. */
export const esScript = (a: ArchivoSkill): boolean => a.ejecutable || /(^|\/)scripts?\//i.test(a.ruta) || EXTENSIONES_SCRIPT.test(a.ruta);

/**
 * El árbol de GitHub → las skills con sus archivos. Sólo `skills/<nombre>/…`; una skill necesita su `SKILL.md`; una con UNA ruta rara
 * (`..`, barra invertida, enlace simbólico) se descarta entera: mejor no ofrecerla que copiarla a medias.
 */
export function skillsDeArbol(arbol: unknown, max: Pick<Limites, "archivos" | "archivo" | "skillTotal"> = LIMITES): Map<string, ArchivoSkill[]> {
  const lista = obj(arbol).tree;
  if (!Array.isArray(lista)) throw errorT("main.descubrirMalformado");
  const porSkill = new Map<string, ArchivoSkill[]>();
  const malas = new Set<string>();
  for (const x of lista) {
    const e = obj(x);
    if (typeof e.path !== "string" || !e.path.startsWith("skills/")) continue;
    const [, nombre, ...resto] = e.path.split("/");
    if (!nombre || !resto.length) continue;
    if (!NOMBRE_SKILL.test(nombre) || SKILLS_EXCLUIDAS.includes(nombre)) {
      continue;
    }
    if (e.type === "tree") continue;
    const rel = resto.join("/");
    const modo = typeof e.mode === "string" ? e.mode : "";
    if (e.type !== "blob" || (modo !== "100644" && modo !== "100755") || typeof e.size !== "number" || !Number.isSafeInteger(e.size) || e.size < 0 || typeof e.sha !== "string" || !/^[0-9a-f]{40}$/.test(e.sha) || !rutaSegura(rel)) {
      malas.add(nombre);
      continue;
    }
    const l = porSkill.get(nombre) ?? [];
    l.push({ ruta: rel, tam: e.size, sha: e.sha, ejecutable: modo === "100755" });
    porSkill.set(nombre, l);
  }
  for (const [nombre, l] of porSkill) {
    const total = l.reduce((a, f) => a + f.tam, 0);
    if (malas.has(nombre) || !l.some((f) => f.ruta === "SKILL.md") || l.length > max.archivos || total > max.skillTotal || l.some((f) => f.tam > max.archivo)) porSkill.delete(nombre);
  }
  return porSkill;
}

/** `name` y `description` del encabezado (frontmatter) de un SKILL.md; entiende comillas y los bloques `>` / `|`. Sólo texto, sin YAML completo. */
export function encabezadoSkill(md: string): { nombre: string | null; descripcion: string | null } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md.replace(/^﻿/, ""));
  const r: Record<string, string> = {};
  if (m) {
    const lineas = m[1]!.split(/\r?\n/);
    for (let i = 0; i < lineas.length; i++) {
      const k = /^([A-Za-z_-]+):\s*(.*)$/.exec(lineas[i]!);
      if (!k) continue;
      let v = k[2]!.trim();
      if (/^[>|][+-]?$/.test(v) || v === "") {
        const trozos: string[] = [];
        while (i + 1 < lineas.length && /^\s+\S/.test(lineas[i + 1]!)) trozos.push(lineas[++i]!.trim());
        v = trozos.join(" ");
      }
      r[k[1]!.toLowerCase()] = v.replace(/^(["'])([\s\S]*)\1$/, "$2");
    }
  }
  return { nombre: txt(r.name, 80), descripcion: txt(r.description, 400) };
}

async function bajarSkills(d: DepsDescubrir): Promise<{ nombre: string; descripcion: string | null; archivos: ArchivoSkill[] }[]> {
  const l = lim(d);
  const u = urls(d);
  const j = obj(aJson(await traer(d, `${u.api.replace(/\/+$/, "")}/repos/${ORIGEN_SKILLS}/git/trees/main?recursive=1`, l.arbol)));
  // Un árbol cortado por GitHub sería un catálogo a medias: mejor avisar.
  if (j.truncated === true) throw errorT("main.descubrirGrande");
  const porSkill = skillsDeArbol(j, l);
  const nombres = [...porSkill.keys()].sort();
  const salida: { nombre: string; descripcion: string | null; archivos: ArchivoSkill[] }[] = [];
  let i = 0;
  const obrero = async () => {
    for (let n = i++; n < nombres.length; n = i++) {
      const nombre = nombres[n]!;
      let descripcion: string | null = null;
      try {
        const md = await traer(d, rawDe(u.raw, nombre, "SKILL.md"), l.skillMd);
        descripcion = encabezadoSkill(md.toString("utf8")).descripcion;
      } catch {
        /* sin descripción: «sin dato» */
      }
      salida.push({ nombre, descripcion, archivos: porSkill.get(nombre)! });
    }
  };
  await Promise.all([obrero(), obrero(), obrero(), obrero()]);
  return salida.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

const rawDe = (raw: string, nombre: string, ruta: string) => `${raw.replace(/\/+$/, "")}/${ORIGEN_SKILLS}/main/skills/${nombre}/${ruta.split("/").map(encodeURIComponent).join("/")}`;

// --- Caché ----------------------------------------------------------------------------------------------------------------------------

type SkillGuardada = { nombre: string; descripcion: string | null; archivos: ArchivoSkill[] };
type Cache = { version: 1; actualizado: number | null; skills: SkillGuardada[]; mcp: ItemMcp[]; errores: CatalogoDescubrir["errores"] };

const vacia = (): Cache => ({ version: 1, actualizado: null, skills: [], mcp: [], errores: { skills: null, mcp: null } });
const rutaCache = (d: DepsDescubrir) => path.join(d.estado ?? estadoHilos(d.env ?? process.env, d.home), "descubrir.json");
const carpetaSkills = (d: DepsDescubrir) => path.join(d.home, ".claude", "skills");

/** La caché del disco, vuelta a validar renglón por renglón: un archivo roto o a mano nunca entra tal cual. */
export async function leerCache(d: DepsDescubrir): Promise<Cache> {
  let j: Record<string, unknown>;
  try {
    const b = await readFile(rutaCache(d));
    if (b.length > lim(d).cache) return vacia();
    j = obj(JSON.parse(b.toString("utf8")));
  } catch {
    return vacia();
  }
  const skills: SkillGuardada[] = [];
  for (const x of Array.isArray(j.skills) ? j.skills : []) {
    const o = obj(x);
    if (typeof o.nombre !== "string" || !NOMBRE_SKILL.test(o.nombre) || SKILLS_EXCLUIDAS.includes(o.nombre)) continue;
    const archivos: ArchivoSkill[] = [];
    for (const a of Array.isArray(o.archivos) ? o.archivos : []) {
      const f = obj(a);
      if (typeof f.ruta === "string" && rutaSegura(f.ruta) && typeof f.tam === "number" && Number.isSafeInteger(f.tam) && f.tam >= 0 && typeof f.sha === "string" && /^[0-9a-f]{40}$/.test(f.sha)) archivos.push({ ruta: f.ruta, tam: f.tam, sha: f.sha, ejecutable: f.ejecutable === true });
    }
    if (archivos.some((a) => a.ruta === "SKILL.md")) skills.push({ nombre: o.nombre, descripcion: txt(o.descripcion, 400), archivos });
  }
  const mcp: ItemMcp[] = [];
  for (const x of Array.isArray(j.mcp) ? j.mcp : []) {
    // Se rearma desde la forma del registro: las mismas reglas que al bajar.
    const o = obj(x);
    const e = itemMcpDe({ server: { name: o.nombre, title: o.titulo, description: o.descripcion, version: o.version, websiteUrl: o.enlace, remotes: o.remoto ? [{ type: "streamable-http", url: obj(o.remoto).url, headers: (Array.isArray(o.cabeceras) ? o.cabeceras : []).map((n) => ({ name: n, isRequired: true })) }] : [], packages: o.paquete ? [{ registryType: obj(o.paquete).tipo, identifier: obj(o.paquete).identificador, version: obj(o.paquete).version }] : [] }, _meta: { "io.modelcontextprotocol.registry/official": { updatedAt: o.fecha } } });
    if (e) mcp.push(e);
  }
  const err = obj(j.errores);
  return {
    version: 1,
    actualizado: typeof j.actualizado === "number" && Number.isFinite(j.actualizado) ? j.actualizado : null,
    skills,
    mcp,
    errores: { skills: typeof err.skills === "string" ? err.skills.slice(0, 300) : null, mcp: typeof err.mcp === "string" ? err.mcp.slice(0, 300) : null },
  };
}

async function guardarCache(d: DepsDescubrir, c: Cache) {
  const ruta = rutaCache(d);
  await mkdir(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(c), { mode: 0o600 });
  await rename(tmp, ruta);
}

const existe = (p: string) => lstat(p).then(() => true, () => false);

async function vista(d: DepsDescubrir, c: Cache): Promise<CatalogoDescubrir> {
  const propios = await leerMcp(rutaMcp(d.env ?? process.env)).catch(() => []);
  const urlsPropias = new Set(propios.map((s) => s.url).filter(Boolean));
  const skills: ItemSkill[] = [];
  for (const s of c.skills)
    skills.push({
      id: `skill:${s.nombre}`,
      tipo: "skill",
      nombre: s.nombre,
      descripcion: s.descripcion,
      origen: ORIGEN_SKILLS,
      enlace: `https://github.com/${ORIGEN_SKILLS}/tree/main/skills/${s.nombre}`,
      fecha: null,
      archivos: s.archivos.length,
      scripts: s.archivos.some(esScript),
      instalado: await existe(path.join(carpetaSkills(d), s.nombre)),
    });
  const mcp = c.mcp.map((m) => ({ ...m, agregado: !!m.remoto && urlsPropias.has(m.remoto.url) }));
  return { skills, mcp, actualizado: c.actualizado, errores: c.errores };
}

/**
 * Lo que muestra la sección. Sin `actualizar` usa la caché si es de las últimas 24 h (y baja sólo si no hay o está vencida); con `actualizar`
 * baja siempre. Cada fuente falla por separado: si una falla se conserva lo que había y se anota el motivo.
 */
export async function catalogo(actualizar: unknown, d: DepsDescubrir): Promise<CatalogoDescubrir> {
  const ahora = (d.ahora ?? Date.now)();
  let c = await leerCache(d);
  const vigente = c.actualizado !== null && ahora - c.actualizado < VIGENCIA_MS && c.actualizado <= ahora + 60_000;
  if (actualizar === true || !vigente) {
    const [sk, mc] = await Promise.allSettled([bajarSkills(d), bajarMcp(d)]);
    const motivo = (r: PromiseRejectedResult) => (r.reason instanceof Error ? r.reason.message : String(r.reason)).slice(0, 300);
    c = {
      version: 1,
      actualizado: sk.status === "fulfilled" || mc.status === "fulfilled" ? ahora : c.actualizado,
      skills: sk.status === "fulfilled" ? sk.value : c.skills,
      mcp: mc.status === "fulfilled" ? mc.value : c.mcp,
      errores: { skills: sk.status === "rejected" ? motivo(sk) : null, mcp: mc.status === "rejected" ? motivo(mc) : null },
    };
    await guardarCache(d, c).catch(() => {});
  }
  return vista(d, c);
}

// --- Instalar -------------------------------------------------------------------------------------------------------------------------

const huellaDe = (archivos: ArchivoSkill[]) =>
  createHash("sha256")
    .update([...archivos].sort((a, b) => a.ruta.localeCompare(b.ruta)).map((a) => `${a.ruta}\0${a.sha}\0${a.tam}`).join("\n"))
    .digest("hex")
    .slice(0, 16);

/** El nombre de una skill que viene del renderer: o es uno bien armado, o se rechaza (nada de `../`, barras ni mayúsculas raras). */
function nombreSkill(x: unknown): string {
  const n = typeof x === "string" ? x.trim() : "";
  if (!NOMBRE_SKILL.test(n) || SKILLS_EXCLUIDAS.includes(n)) throw errorT("main.descubrirNombre");
  return n;
}

/** Las skills como las ve GitHub AHORA (un pedido): para la confirmación y para instalar justo lo que se confirmó. */
async function archivosActuales(d: DepsDescubrir, nombre: string): Promise<ArchivoSkill[]> {
  const l = lim(d);
  const j = aJson(await traer(d, `${urls(d).api.replace(/\/+$/, "")}/repos/${ORIGEN_SKILLS}/git/trees/main?recursive=1`, l.arbol));
  if (obj(j).truncated === true) throw errorT("main.descubrirGrande");
  const a = skillsDeArbol(j, l).get(nombre);
  if (!a) throw errorT("main.descubrirNoExiste");
  return a;
}

function conocida(c: Cache, id: unknown): { skill: SkillGuardada } | { mcp: ItemMcp } {
  const s = typeof id === "string" ? id : "";
  if (s.startsWith("skill:")) {
    const nombre = nombreSkill(s.slice(6));
    const skill = c.skills.find((x) => x.nombre === nombre);
    if (skill) return { skill };
  } else if (s.startsWith("mcp:")) {
    const mcp = c.mcp.find((x) => x.id === s);
    if (mcp) return { mcp };
  }
  throw errorT("main.descubrirNoExiste");
}

/** Qué pasaría al instalar, para que la interfaz lo diga antes de pedir el sí. Una skill pide a GitHub la lista de archivos de ahora. */
export async function previa(id: unknown, d: DepsDescubrir): Promise<Previa> {
  const x = conocida(await leerCache(d), id);
  if ("skill" in x) {
    const archivos = await archivosActuales(d, x.skill.nombre);
    return {
      tipo: "skill",
      id: `skill:${x.skill.nombre}`,
      nombre: x.skill.nombre,
      destino: `~/.claude/skills/${x.skill.nombre}`,
      archivos: archivos.map((a) => ({ ruta: a.ruta, tam: a.tam })).sort((a, b) => a.ruta.localeCompare(b.ruta)),
      total: archivos.reduce((n, a) => n + a.tam, 0),
      scripts: archivos.filter(esScript).map((a) => a.ruta).sort(),
      huella: huellaDe(archivos),
    };
  }
  const m = x.mcp;
  if (!m.remoto || !m.remoto.seguro || !urlHttps(m.remoto.url)) throw errorT("main.descubrirHttps");
  return { tipo: "mcp", id: m.id, nombre: m.nombre, url: m.remoto.url, dominio: m.remoto.dominio, cabeceras: m.cabeceras };
}

/** Un nombre válido para `mcp.json` a partir del del registro (`io.github.usuario/servidor` → `servidor`), sin repetir uno que ya hay. */
export function nombreConector(registro: string, ocupados: string[]): string {
  const ultimo = registro.split("/").pop() || registro;
  let base = ultimo.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "").replace(/-+$/, "").slice(0, 36);
  if (!base) base = "conector";
  const bajos = new Set(ocupados.map((o) => o.toLowerCase()));
  let n = base;
  for (let i = 2; bajos.has(n.toLowerCase()); i++) n = `${base.slice(0, 36)}-${i}`;
  return n;
}

async function instalarSkill(item: SkillGuardada, huella: unknown, d: DepsDescubrir): Promise<ResultadoInstalar> {
  const nombre = nombreSkill(item.nombre);
  const l = lim(d);
  const raiz = carpetaSkills(d);
  const destino = path.join(raiz, nombre);
  // Defensa extra: el destino tiene que quedar adentro de la carpeta de skills.
  if (path.relative(raiz, destino) !== nombre) throw errorT("main.descubrirNombre");
  if (await existe(destino)) throw errorT("main.descubrirSkillExiste", { n: nombre });
  const archivos = await archivosActuales(d, nombre);
  // Se instala lo que se confirmó: si GitHub cambió la skill entre la confirmación y el sí, se vuelve a confirmar.
  if (typeof huella !== "string" || huella !== huellaDe(archivos)) throw errorT("main.descubrirCambio");
  await mkdir(raiz, { recursive: true });
  const tmp = path.join(raiz, `.trama-instalando-${randomBytes(6).toString("hex")}`);
  await mkdir(tmp);
  try {
    for (const a of archivos) {
      const bytes = await traer(d, rawDe(urls(d).raw, nombre, a.ruta), Math.min(l.archivo, a.tam + 1));
      // Lo bajado tiene que ser exactamente lo que GitHub dijo (mismo hash de blob de git): nada se instala alterado.
      const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
      if (bytes.length !== a.tam || blob !== a.sha) throw errorT("main.descubrirCorrupto", { r: a.ruta });
      const fin = path.join(tmp, ...a.ruta.split("/"));
      if (path.relative(tmp, fin).split(path.sep).includes("..")) throw errorT("main.descubrirNombre");
      await mkdir(path.dirname(fin), { recursive: true });
      await writeFile(fin, bytes, { mode: a.ejecutable ? 0o755 : 0o644 });
    }
    // Otra vez antes de mover: si apareció una con ese nombre mientras se bajaba, no se pisa.
    if (await existe(destino)) throw errorT("main.descubrirSkillExiste", { n: nombre });
    await rename(tmp, destino);
  } catch (x) {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
    throw x;
  }
  return { tipo: "skill", nombre, carpeta: `~/.claude/skills/${nombre}`, archivos: archivos.length };
}

async function instalarMcp(m: ItemMcp, d: DepsDescubrir): Promise<ResultadoInstalar> {
  // El paquete nunca se ejecuta desde acá: sólo hay remotos https.
  const url = m.remoto ? urlHttps(m.remoto.url) : null;
  if (!m.remoto || !url) throw errorT("main.descubrirHttps");
  const ruta = rutaMcp(d.env ?? process.env);
  const nombre = nombreConector(m.nombre, (await leerMcp(ruta)).map((s) => s.nombre));
  await guardarServidor({ nombre, tipo: "http", url, variables: [] }, { mcp: ruta });
  return { tipo: "mcp", nombre };
}

/** Instala lo que dice el `id` (sólo ids que este módulo ofreció). Una skill pide además la `huella` de la confirmación. */
export async function instalar(id: unknown, huella: unknown, d: DepsDescubrir): Promise<ResultadoInstalar> {
  const x = conocida(await leerCache(d), id);
  return "skill" in x ? instalarSkill(x.skill, huella, d) : instalarMcp(x.mcp, d);
}
