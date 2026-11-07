// Ajustes > Conectores como tienda (estilo «Customize» de claude.ai): una sola forma de tarjeta para skills, conectores MCP, plugins y hooks,
// con lo que se hace antes de dibujarla: armarlas desde las fuentes de siempre (el inventario de Claude Code, los conectores propios de Trama,
// los catálogos de plugins y el catálogo de Descubrir), buscar, filtrar por categoría, ordenar y repartir «Descubrir» en secciones.
// Puro (sin React ni puente): lo prueba tests/tienda-logica.test.ts. Nada se inventa: lo que una fuente no trae es `null` («sin dato»).
import type { Conector } from "../../electron/conectores-claude";
import type { ItemMcp, ItemSkill } from "../../electron/descubrir";
import type { VistaServidorMcp } from "../../electron/mcp-config";
import type { Catalogo } from "../../electron/plugins-claude";
import { pluginDe } from "../../electron/usos-historial.ts";
import { deDonde, esDeTrama, nombreHook, SIN_DATO, type UsoConector } from "./conectores-vista.ts";

export type Pestana = "skills" | "mcp" | "plugins" | "hooks";
export const PESTANAS: readonly Pestana[] = ["skills", "mcp", "plugins", "hooks"];
export type Vista = "tuyos" | "descubrir";
export const VISTAS: readonly Vista[] = ["tuyos", "descubrir"];

/** De quién es: Anthropic, un autor, tuyo, de Trama, un plugin, un proyecto o tu cuenta de claude.ai. `n` es el nombre del autor, plugin o proyecto. */
export type Origen = { clase: "anthropic" } | { clase: "autor"; n: string } | { clase: "tuyo" } | { clase: "trama" } | { clase: "plugin"; n: string } | { clase: "proyecto"; n: string } | { clase: "claudeai" };

/** Qué hace el «+» de una tarjeta de Descubrir: instalar una skill o un plugin, agregar un conector remoto, mostrar el comando de un paquete, o nada. */
export type Accion = "instalar" | "agregar" | "comando" | "ninguna";

/** Qué trae un plugin (de lo que hay en el inventario). */
export type Trae = { skills: number; mcp: number; hooks: number };

/** De qué fuente sale una tarjeta: lo que hace falta para actuar sobre ella (prender, quitar, instalar). */
export type Fuente =
  | { tipo: "conector"; id: string }
  | { tipo: "propio"; nombre: string }
  | { tipo: "descubrir"; id: string }
  | { tipo: "plugin"; plugin: string; catalogo: string };

export type Tarjeta = {
  /** Único dentro de su lista. */
  clave: string;
  pestana: Pestana;
  vista: Vista;
  nombre: string;
  /** Qué hace, tal como lo trae la fuente (si viene en inglés queda en inglés); `null` si no trae. */
  descripcion: string | null;
  /** Lo que se ejecuta o a dónde apunta (comando o URL de un conector, comando de un hook), ya enmascarado por la fuente. */
  destino: string | null;
  origen: Origen;
  categoria: string | null;
  /** Instalaciones únicas (sólo los plugins, de la caché de Claude Code); `null` = sin dato. */
  instalaciones: number | null;
  /** Veces que se usó en 30 días; `null` = sin dato, 0 = sin uso en esos días. */
  veces: number | null;
  /** Último día de uso (`AAAA-MM-DD`) dentro de esos 30 días. */
  ultimoUso: string | null;
  /** Última actualización o publicación (ms); `null` = sin dato. */
  fecha: number | null;
  /** Skills de Descubrir: cuántos archivos trae y si alguno es un script. */
  archivos: number | null;
  scripts: boolean;
  /** Ya está instalado o agregado (el ✓). En Tuyos, siempre. */
  puesto: boolean;
  /** Tuyos: prendido o apagado; `null` si no aplica (lo de Descubrir). */
  activo: boolean | null;
  /** Se puede prender y apagar desde acá. */
  conmutable: boolean;
  accion: Accion;
  /** Dónde vive (carpeta, archivo, URL o `plugin@catálogo`); `null` si no se sabe. */
  donde: string | null;
  /** Una página para saber más (sólo http/https); `null` si la fuente no trae. */
  enlace: string | null;
  trae: Trae | null;
  fuente: Fuente;
};

// --- Armar las tarjetas -----------------------------------------------------------------------------------------------------------------------

const TIPO_DE: Record<Pestana, Conector["tipo"]> = { skills: "skill", mcp: "mcp", plugins: "plugin", hooks: "hook" };
const PESTANA_DE: Record<Conector["tipo"], Pestana> = { skill: "skills", mcp: "mcp", plugin: "plugins", hook: "hooks" };

/** Sin tildes ni mayúsculas, para buscar. */
const plano = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** El dueño de un repo de GitHub (`usuario/repo` → `usuario`); `anthropics` es Anthropic. */
export function origenDeRepo(repo: string): Origen {
  const dueno = repo.split("/")[0]?.trim();
  if (!dueno) return { clase: "tuyo" };
  return dueno.toLowerCase() === "anthropics" ? { clase: "anthropic" } : { clase: "autor", n: dueno };
}

/** El autor de un conector del registro MCP por su espacio de nombres: `io.github.ana/notas` → `ana`, `com.example/agenda` → `example`. */
export function autorDeNombreMcp(nombre: string): string {
  const ns = nombre.split("/")[0] ?? "";
  const partes = ns.split(".").filter(Boolean);
  if (ns.startsWith("io.github.") && partes[2]) return partes.slice(2).join(".");
  return (partes.length > 1 ? partes[1] : partes[0]) ?? nombre;
}

/** Sólo se ofrece un enlace http/https (lo que trae un catálogo de terceros no es de fiar). */
const enlaceWeb = (u: string | null | undefined): string | null => (u && /^https?:\/\//i.test(u) ? u : null);

const nombreComando = (s: VistaServidorMcp) => (s.tipo === "stdio" ? [s.comando, ...(s.args ?? [])].filter(Boolean).join(" ") : (s.url ?? ""));

type Extras = {
  /** Los conectores propios de Trama (`~/.config/trama/mcp.json`). */
  propios?: VistaServidorMcp[];
  /** Los catálogos de plugins: aportan categoría e instalaciones a los plugins que ya tenés. */
  catalogos?: Catalogo[];
};

function origenDeConector(c: Conector, catalogos: Catalogo[]): Origen {
  if (esDeTrama(c)) return { clase: "trama" };
  if (c.origen === "claudeai") return { clase: "claudeai" };
  if (c.origen === "proyecto") return { clase: "proyecto", n: deDonde(c) };
  if (c.origen === "plugin") return { clase: "plugin", n: c.de.split("@")[0] || c.de };
  // Un plugin instalado dice de qué catálogo vino (`de`): si es de Anthropic o de un autor, se nota.
  if (c.tipo === "plugin") {
    const cat = catalogos.find((x) => x.id === c.de);
    if (cat?.repo) return origenDeRepo(cat.repo);
  }
  return { clase: "tuyo" };
}

function dondeDeConector(c: Conector): string | null {
  if (c.tipo === "skill") return c.origen === "usuario" ? `~/.claude/skills/${c.nombre}` : c.origen === "proyecto" ? c.de : c.origen === "plugin" ? c.de : null;
  if (c.tipo === "plugin") return c.de ? `${c.nombre}@${c.de}` : c.nombre;
  return c.destino ?? null;
}

/** Las tarjetas de «Tuyos» de una pestaña. `todos` es el inventario entero (de ahí sale lo que trae cada plugin). `uso`: el uso de 30 días por id, o `null` si el registro no llegó. */
export function tarjetasTuyos(pestana: Pestana, todos: Conector[], uso: Map<string, UsoConector> | null, extras: Extras = {}): Tarjeta[] {
  const catalogos = extras.catalogos ?? [];
  const r: Tarjeta[] = [];
  for (const c of todos) {
    if (c.tipo !== TIPO_DE[pestana]) continue;
    const u = uso ? (uso.get(c.id) ?? SIN_DATO) : SIN_DATO;
    const delCatalogo = c.tipo === "plugin" ? catalogos.find((x) => x.id === c.de)?.plugins.find((p) => p.nombre === c.nombre) ?? catalogos.flatMap((x) => x.plugins).find((p) => p.nombre === c.nombre) : undefined;
    let trae: Trae | null = null;
    if (c.tipo === "plugin") {
      trae = { skills: 0, mcp: 0, hooks: 0 };
      for (const x of todos) if (x.tipo !== "plugin" && pluginDe(x) === c.nombre) trae[x.tipo === "skill" ? "skills" : x.tipo === "mcp" ? "mcp" : "hooks"]++;
    }
    r.push({
      clave: c.id,
      pestana,
      vista: "tuyos",
      nombre: c.tipo === "hook" ? nombreHook(c) : c.nombre,
      descripcion: c.descripcion.trim() || null,
      destino: c.tipo === "mcp" || c.tipo === "hook" ? (c.destino ?? null) : null,
      origen: origenDeConector(c, catalogos),
      categoria: delCatalogo?.categoria.trim() || null,
      instalaciones: delCatalogo?.instalaciones ?? null,
      veces: u.veces,
      ultimoUso: u.ultimo,
      fecha: delCatalogo?.actualizado ?? null,
      archivos: null,
      scripts: false,
      puesto: true,
      activo: c.activo,
      conmutable: c.conmutable,
      accion: "ninguna",
      donde: dondeDeConector(c),
      enlace: null,
      trae,
      fuente: { tipo: "conector", id: c.id },
    });
  }
  if (pestana === "mcp") {
    for (const s of extras.propios ?? []) {
      r.push({
        clave: `propio|${s.nombre}`,
        pestana,
        vista: "tuyos",
        nombre: s.nombre,
        descripcion: null,
        destino: nombreComando(s) || null,
        origen: { clase: "tuyo" },
        categoria: null,
        instalaciones: null,
        veces: null,
        ultimoUso: null,
        fecha: null,
        archivos: null,
        scripts: false,
        puesto: true,
        activo: true,
        conmutable: false,
        accion: "ninguna",
        donde: "~/.config/trama/mcp.json",
        enlace: null,
        trae: null,
        fuente: { tipo: "propio", nombre: s.nombre },
      });
    }
  }
  return r;
}

/** Cuántas tarjetas de «Tuyos» hay en cada pestaña (para el número de la pestaña). */
export function conteoTuyos(todos: Conector[], propios: VistaServidorMcp[] = []): Record<Pestana, number> {
  const r: Record<Pestana, number> = { skills: 0, mcp: propios.length, plugins: 0, hooks: 0 };
  for (const c of todos) r[PESTANA_DE[c.tipo]]++;
  return r;
}

const ms = (iso: string | null): number | null => {
  const n = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(n) ? null : n;
};

export function tarjetasDescubrirSkills(items: ItemSkill[]): Tarjeta[] {
  return items.map((i) => ({
    clave: i.id,
    pestana: "skills",
    vista: "descubrir",
    nombre: i.nombre,
    descripcion: i.descripcion?.trim() || null,
    destino: null,
    origen: origenDeRepo(i.origen),
    categoria: null,
    instalaciones: null,
    veces: null,
    ultimoUso: null,
    fecha: ms(i.fecha),
    archivos: i.archivos,
    scripts: i.scripts,
    puesto: i.instalado,
    activo: null,
    conmutable: false,
    accion: "instalar",
    donde: `~/.claude/skills/${i.nombre}`,
    enlace: enlaceWeb(i.enlace),
    trae: null,
    fuente: { tipo: "descubrir", id: i.id },
  }));
}

export function tarjetasDescubrirMcp(items: ItemMcp[]): Tarjeta[] {
  return items.map((i) => ({
    clave: i.id,
    pestana: "mcp",
    vista: "descubrir",
    nombre: i.titulo?.trim() || i.nombre,
    descripcion: i.descripcion?.trim() || null,
    destino: i.remoto?.url ?? i.paquete?.comando ?? null,
    origen: { clase: "autor", n: autorDeNombreMcp(i.nombre) },
    categoria: null,
    instalaciones: null,
    veces: null,
    ultimoUso: null,
    fecha: ms(i.fecha),
    archivos: null,
    scripts: false,
    puesto: i.agregado,
    activo: null,
    conmutable: false,
    accion: i.remoto?.seguro ? "agregar" : i.paquete ? "comando" : "ninguna",
    donde: i.remoto?.seguro ? i.remoto.url : (i.paquete?.comando ?? null),
    enlace: enlaceWeb(i.paquete?.enlace ?? i.enlace),
    trae: null,
    fuente: { tipo: "descubrir", id: i.id },
  }));
}

/** Los plugins de los catálogos que Claude Code ya tiene agregados (los que no se agregaron no traen plugins hasta agregarlos). */
export function tarjetasDescubrirPlugins(catalogos: Catalogo[]): Tarjeta[] {
  const r: Tarjeta[] = [];
  for (const c of catalogos) {
    if (!c.agregado) continue;
    for (const p of c.plugins) {
      r.push({
        clave: `${p.nombre}@${c.id}`,
        pestana: "plugins",
        vista: "descubrir",
        nombre: p.nombre,
        descripcion: p.descripcion.trim() || null,
        destino: null,
        origen: c.repo ? origenDeRepo(c.repo) : { clase: "tuyo" },
        categoria: p.categoria.trim() || null,
        instalaciones: typeof p.instalaciones === "number" && Number.isFinite(p.instalaciones) ? p.instalaciones : null,
        veces: null,
        ultimoUso: null,
        fecha: typeof p.actualizado === "number" && Number.isFinite(p.actualizado) ? p.actualizado : null,
        archivos: null,
        scripts: false,
        puesto: p.instalado,
        activo: null,
        conmutable: false,
        accion: "instalar",
        donde: `${p.nombre}@${c.id}`,
        enlace: null,
        trae: null,
        fuente: { tipo: "plugin", plugin: p.nombre, catalogo: c.id },
      });
    }
  }
  return r;
}

// --- Buscar, filtrar por categoría, ordenar ----------------------------------------------------------------------------------------------------

/** Cada palabra tiene que estar en el nombre, la descripción, el origen, la categoría o el destino (sin tildes ni mayúsculas). */
export function buscarTarjetas(ts: Tarjeta[], consulta: string): Tarjeta[] {
  const palabras = plano(consulta).split(/\s+/).filter(Boolean);
  if (!palabras.length) return ts;
  return ts.filter((x) => {
    const origen = "n" in x.origen ? x.origen.n : x.origen.clase;
    const pajar = plano([x.nombre, x.descripcion ?? "", origen, x.categoria ?? "", x.destino ?? ""].join(" "));
    return palabras.every((p) => pajar.includes(p));
  });
}

/** Las categorías que hay entre las tarjetas, con cuántas tiene cada una: la más poblada primero, después por nombre. */
export function categoriasDeTarjetas(ts: Tarjeta[]): { nombre: string; n: number }[] {
  const cuenta = new Map<string, number>();
  for (const x of ts) if (x.categoria) cuenta.set(x.categoria, (cuenta.get(x.categoria) ?? 0) + 1);
  return [...cuenta].map(([nombre, n]) => ({ nombre, n })).sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre));
}

/** Las de una categoría; `null` = todas. */
export const filtrarCategoria = (ts: Tarjeta[], categoria: string | null): Tarjeta[] => (categoria === null ? ts : ts.filter((x) => x.categoria === categoria));

export type Orden = "origen" | "mas" | "menos" | "ultimo" | "instalados" | "recientes" | "nombre";

/** Los órdenes que tienen sentido en cada pestaña y vista (sólo los que tienen dato de dónde sacarse). El primero es el de entrada. */
export function ordenesDe(pestana: Pestana, vista: Vista): readonly Orden[] {
  if (vista === "tuyos") return pestana === "hooks" ? ["origen"] : ["origen", "mas", "menos", "ultimo"];
  if (pestana === "plugins") return ["instalados", "recientes", "nombre"];
  if (pestana === "mcp") return ["recientes", "nombre"];
  if (pestana === "skills") return ["nombre"];
  return [];
}

const ORDEN_ORIGEN: Record<Origen["clase"], number> = { tuyo: 0, trama: 1, proyecto: 2, plugin: 3, anthropic: 4, autor: 5, claudeai: 6 };
const porNombre = (a: Tarjeta, b: Tarjeta) => a.nombre.localeCompare(b.nombre) || a.clave.localeCompare(b.clave);

/** Un número que puede faltar: lo que falta va siempre al final (nunca se mezcla con un cero). `sentido` 1 = de más a menos. */
const numero = (x: number | null, y: number | null, sentido: 1 | -1): number => {
  if ((x === null) !== (y === null)) return x === null ? 1 : -1;
  if (x === null || y === null) return 0;
  return (y - x) * sentido;
};

/**
 * Ordena sin tocar la lista que llega. Lo que no trae el dato del orden pedido va al final, por nombre.
 * - `origen`: lo tuyo primero, después Trama, proyectos, plugins, Anthropic, autores y claude.ai; por nombre dentro de cada uno.
 * - `mas` / `menos`: por veces de uso en 30 días (los de cero uso son los primeros de `menos`); `ultimo`: el de uso más reciente primero.
 * - `instalados`: por instalaciones; `recientes`: por última actualización.
 */
export function ordenarTarjetas(ts: Tarjeta[], orden: Orden): Tarjeta[] {
  return [...ts].sort((a, b) => {
    switch (orden) {
      case "origen":
        return ORDEN_ORIGEN[a.origen.clase] - ORDEN_ORIGEN[b.origen.clase] || porNombre(a, b);
      case "mas":
        return numero(a.veces, b.veces, 1) || (b.ultimoUso ?? "").localeCompare(a.ultimoUso ?? "") || porNombre(a, b);
      case "menos":
        return numero(a.veces, b.veces, -1) || (a.ultimoUso ?? "").localeCompare(b.ultimoUso ?? "") || porNombre(a, b);
      case "ultimo":
        if ((a.veces === null) !== (b.veces === null)) return a.veces === null ? 1 : -1;
        return (b.ultimoUso ?? "").localeCompare(a.ultimoUso ?? "") || numero(a.veces, b.veces, 1) || porNombre(a, b);
      case "instalados":
        return numero(a.instalaciones, b.instalaciones, 1) || porNombre(a, b);
      case "recientes":
        return numero(a.fecha, b.fecha, 1) || porNombre(a, b);
      default:
        return porNombre(a, b);
    }
  });
}

// --- Descubrir por secciones -------------------------------------------------------------------------------------------------------------------

export type SeccionId = "paraVos" | "nuevos" | "masInstalados";
export type Seccion = { id: SeccionId; /** Las primeras, para la tira de la sección. */ items: Tarjeta[]; /** Cuántas tiene en total («Ver todo»). */ total: number };

/** Cuántas tarjetas lleva cada sección antes de «Ver todo». */
export const TOPE_SECCION = 4;

/**
 * La lista completa de una sección, ya en su orden:
 * - `paraVos`: lo que todavía no tenés en las categorías de lo que ya tenés, de más a menos instalado. Sin base (nada instalado con categoría) no hay sección.
 * - `nuevos`: lo que tiene fecha, de lo más reciente a lo más viejo.
 * - `masInstalados`: lo que tiene dato de instalaciones, de más a menos.
 */
export function listaDeSeccion(ts: Tarjeta[], id: SeccionId): Tarjeta[] {
  if (id === "nuevos") return ordenarTarjetas(ts.filter((x) => x.fecha !== null), "recientes");
  if (id === "masInstalados") return ordenarTarjetas(ts.filter((x) => x.instalaciones !== null), "instalados");
  const base = new Set(ts.filter((x) => x.puesto && x.categoria).map((x) => x.categoria as string));
  return ordenarTarjetas(ts.filter((x) => !x.puesto && x.categoria !== null && base.has(x.categoria)), "instalados");
}

/** Las secciones de Descubrir de una pestaña (las que tienen algo) y sus categorías con conteo. */
export function seccionesDescubrir(ts: Tarjeta[], tope = TOPE_SECCION): { secciones: Seccion[]; categorias: { nombre: string; n: number }[] } {
  const secciones: Seccion[] = [];
  for (const id of ["paraVos", "nuevos", "masInstalados"] as const) {
    const lista = listaDeSeccion(ts, id);
    if (lista.length) secciones.push({ id, items: lista.slice(0, tope), total: lista.length });
  }
  return { secciones, categorias: categoriasDeTarjetas(ts) };
}
