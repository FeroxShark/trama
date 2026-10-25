// Catálogo de Herramientas, Skills y MCPs para Trama.
// Escanea los MCPs instalados en Claude y Antigravity, las skills en ~/.claude/skills/
// y provee una lista enriquecida con búsqueda reactiva y sección 'Descubrir'.
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { exec } from "node:child_process";
import os from "node:os";
import path from "node:path";

export type TipoItem = "mcp" | "skill" | "herramienta" | "lider";

export interface ItemCatalogo {
  id: string;
  nombre: string;
  tipo: TipoItem;
  descripcion: string;
  instalado: boolean;
  activo: boolean;
  origen: string;
  categoria?: string;
  autor?: string;
  comando?: string;
  ruta?: string;
  url?: string;
  repoUrl?: string;
}

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, ".claude");
const CLAUDE_JSON = path.join(HOME, ".claude.json");
const WIN_USER = process.env.USERPROFILE || HOME;
const WIN_CLAUDE_JSON = path.join(WIN_USER, ".claude.json");
const TRAMA_CONFIG = path.join(HOME, ".config", "trama");
const DESACTIVADAS_JSON = path.join(TRAMA_CONFIG, "herramientas-desactivadas.json");
const INSTALADAS_JSON = path.join(TRAMA_CONFIG, "herramientas-instaladas.json");

function asegurarConfigDir() {
  if (!existsSync(TRAMA_CONFIG)) {
    try {
      mkdirSync(TRAMA_CONFIG, { recursive: true });
    } catch {}
  }
}

function leerDesactivadas(): Set<string> {
  if (!existsSync(DESACTIVADAS_JSON)) return new Set();
  try {
    const arr = JSON.parse(readFileSync(DESACTIVADAS_JSON, "utf8"));
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function guardarDesactivadas(des: Set<string>) {
  asegurarConfigDir();
  try {
    writeFileSync(DESACTIVADAS_JSON, JSON.stringify([...des], null, 2), "utf8");
  } catch {}
}

function leerInstaladasCustom(): ItemCatalogo[] {
  if (!existsSync(INSTALADAS_JSON)) return [];
  try {
    const arr = JSON.parse(readFileSync(INSTALADAS_JSON, "utf8"));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function guardarInstaladasCustom(items: ItemCatalogo[]) {
  asegurarConfigDir();
  try {
    writeFileSync(INSTALADAS_JSON, JSON.stringify(items, null, 2), "utf8");
  } catch {}
}

/** Parsea el frontmatter de un archivo SKILL.md. */
function leerMetadataSkill(skillDir: string): { nombre: string; desc: string } {
  const mdPath = path.join(skillDir, "SKILL.md");
  const fallback = path.basename(skillDir);
  if (!existsSync(mdPath)) return { nombre: fallback, desc: "" };

  try {
    const raw = readFileSync(mdPath, "utf8");
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
    let desc = "";
    let nombre = fallback;
    if (m) {
      const lineas = m[1].split(/\r?\n/);
      for (const l of lineas) {
        const nomMatch = /^name:\s*(.+)$/i.exec(l);
        if (nomMatch) nombre = nomMatch[1].trim();
        const descMatch = /^description:\s*(.+)$/i.exec(l);
        if (descMatch) desc = descMatch[1].trim();
      }
    }
    if (!desc) {
      // Tomar primer párrafo que no sea título
      const parrafos = raw.replace(/^#+.*$/gm, "").trim().split(/\n\s*\n/);
      desc = parrafos[0]?.replace(/\n/g, " ").slice(0, 200).trim() || "";
    }
    return { nombre, desc };
  } catch {
    return { nombre: fallback, desc: "" };
  }
}

/** Escanea skills instaladas en ~/.claude/skills y ~/.gemini/antigravity-cli/builtin/skills. */
function escanearSkills(): ItemCatalogo[] {
  const items: ItemCatalogo[] = [];
  const carpetas = [
    path.join(CLAUDE_DIR, "skills"),
    path.join(WIN_USER, ".claude", "skills"),
    path.join(HOME, ".gemini", "antigravity-cli", "builtin", "skills"),
  ];

  const desactivadas = leerDesactivadas();
  const vistos = new Set<string>();

  for (const c of carpetas) {
    if (!existsSync(c)) continue;
    try {
      const dirs = readdirSync(c, { withFileTypes: true });
      for (const d of dirs) {
        if (!d.isDirectory() && !d.isSymbolicLink()) continue;
        if (d.name.startsWith(".") || vistos.has(d.name)) continue;
        vistos.add(d.name);

        const fullPath = path.join(c, d.name);
        const meta = leerMetadataSkill(fullPath);
        const id = `skill:${d.name}`;
        items.push({
          id,
          nombre: meta.nombre,
          tipo: "skill",
          descripcion: meta.desc || `Skill de trabajo para ${d.name}`,
          instalado: true,
          activo: !desactivadas.has(id),
          origen: c.includes(".gemini") ? "Antigravity" : "Claude Skills",
          categoria: d.name.includes("blender") || d.name.includes("3d") || d.name.includes("vrchat") ? "3D y VRChat" : "Desarrollo",
          ruta: fullPath,
        });
      }
    } catch {}
  }

  return items;
}

/** Escanea servidores MCP configurados en .claude.json y settings. */
function escanearMcps(): ItemCatalogo[] {
  const items: ItemCatalogo[] = [];
  const vistos = new Set<string>();
  const desactivadas = leerDesactivadas();

  const archs = [CLAUDE_JSON, WIN_CLAUDE_JSON, path.join(CLAUDE_DIR, "settings.json")];

  for (const a of archs) {
    if (!existsSync(a)) continue;
    try {
      const j = JSON.parse(readFileSync(a, "utf8"));
      const mcps = j?.mcpServers || {};
      for (const [nom, cfg] of Object.entries(mcps)) {
        if (vistos.has(nom)) continue;
        vistos.add(nom);
        const c = cfg as Record<string, unknown>;
        const tipoServer = typeof c.type === "string" ? c.type : typeof c.command === "string" ? "stdio" : "http";
        const id = `mcp:${nom}`;
        items.push({
          id,
          nombre: nom,
          tipo: "mcp",
          descripcion: `Servidor MCP (${tipoServer}) configurado para comunicación con Claude y Gemini.`,
          instalado: true,
          activo: !desactivadas.has(id),
          origen: "Configuración MCP",
          categoria: nom.toLowerCase().includes("unity") ? "Unity" : nom.toLowerCase().includes("painter") ? "Substance" : "Herramientas",
          comando: typeof c.command === "string" ? `${c.command} ${(Array.isArray(c.args) ? c.args : []).join(" ")}`.trim() : undefined,
          ruta: a,
        });
      }
    } catch {}
  }

  return items;
}

/** Herramientas del sistema y de proyectos. */
function herramientasSistema(): ItemCatalogo[] {
  const desactivadas = leerDesactivadas();
  const herramientas: ItemCatalogo[] = [
    {
      id: "tool:pa",
      nombre: "pa (Orquestador)",
      tipo: "herramienta",
      descripcion: "Orquestador de workers y gestión de hilos en puestos Git worktrees.",
      instalado: true,
      activo: !desactivadas.has("tool:pa"),
      origen: "Trama Motor",
      categoria: "Sistema",
      comando: "pa <proyecto> <tarea>",
      ruta: path.join(HOME, ".local", "bin", "pa"),
    },
    {
      id: "tool:tablero",
      nombre: "tablero",
      tipo: "herramienta",
      descripcion: "Gestión atómica de pendientes, esperas, ideas y tareas del usuario en JSONL.",
      instalado: true,
      activo: !desactivadas.has("tool:tablero"),
      origen: "Trama Motor",
      categoria: "Sistema",
      comando: "tablero resumen",
      ruta: path.join(HOME, ".local", "bin", "tablero"),
    },
    {
      id: "tool:proyecto-ruta",
      nombre: "proyecto-ruta",
      tipo: "herramienta",
      descripcion: "Resolución de rutas de proyectos registrados en registry.json.",
      instalado: true,
      activo: !desactivadas.has("tool:proyecto-ruta"),
      origen: "Trama Motor",
      categoria: "Sistema",
      ruta: path.join(HOME, ".config", "proyectos", "registry.json"),
    },
    {
      id: "lider:gemini-flash",
      nombre: "Gemini 3.8 Flash (High)",
      tipo: "lider",
      descripcion: "Líder de alta velocidad y 1M tokens de ventana de contexto ejecutado con agy.",
      instalado: true,
      activo: !desactivadas.has("lider:gemini-flash"),
      origen: "Antigravity CLI",
      categoria: "Modelos",
      ruta: path.join(HOME, ".gemini"),
    },
    {
      id: "lider:claude-sonnet",
      nombre: "Claude Sonnet 4.6 (Thinking)",
      tipo: "lider",
      descripcion: "Modelo de razonamiento analítico y generación de código de alta precisión.",
      instalado: true,
      activo: !desactivadas.has("lider:claude-sonnet"),
      origen: "Claude Code",
      categoria: "Modelos",
      ruta: path.join(HOME, ".claude"),
    },
  ];
  return herramientas;
}

/** Catálogo curado para la pestaña 'Descubrir'. */
const CATALOGO_DESCUBRIR: ItemCatalogo[] = [
  {
    id: "descubrir:unity-avatar-optimizer",
    nombre: "Unity Avatar Optimizer",
    tipo: "skill",
    descripcion: "Fusión de materiales, atlas UV automáticos y reducción de draw calls para VRChat.",
    instalado: false,
    activo: false,
    origen: "Catálogo VRChat",
    categoria: "3D y VRChat",
    autor: "Comunidad 3D",
    url: "https://github.com/anatawa12/AvatarOptimizer",
    repoUrl: "https://github.com/anatawa12/AvatarOptimizer",
  },
  {
    id: "descubrir:blender-geo-nodes",
    nombre: "Blender Geometry Nodes Generator",
    tipo: "skill",
    descripcion: "Generación procedural de cadenas, pelaje, cables y accesorios con nodos en Blender 5.x.",
    instalado: false,
    activo: false,
    origen: "Catálogo Blender",
    categoria: "3D y VRChat",
    autor: "Blender Studio",
    url: "https://docs.blender.org/manual/en/latest/modeling/geometry_nodes/",
    repoUrl: "https://docs.blender.org/manual/en/latest/modeling/geometry_nodes/",
  },
  {
    id: "descubrir:texture-baker-pbr",
    nombre: "PBR Texture Baker Pro",
    tipo: "skill",
    descripcion: "Bakeado automatizado de mapas de normales, curvatura, ambient occlusion y roughness.",
    instalado: false,
    activo: false,
    origen: "Catálogo Substance",
    categoria: "3D y VRChat",
    autor: "Substance Tools",
    url: "https://substance3d.adobe.com/documentation/spdoc/baking-144048232.html",
    repoUrl: "https://substance3d.adobe.com/documentation/spdoc/baking-144048232.html",
  },
  {
    id: "descubrir:poiyomi-toon-automator",
    nombre: "Poiyomi Toon Shader Automator",
    tipo: "skill",
    descripcion: "Configuración automatizada de propiedades de sombreado e iluminación Poiyomi 9.3.",
    instalado: false,
    activo: false,
    origen: "Catálogo Unity",
    categoria: "3D y VRChat",
    autor: "Poiyomi Shaders",
    url: "https://github.com/poiyomi/PoiyomiToonShader",
    repoUrl: "https://github.com/poiyomi/PoiyomiToonShader",
  },
  {
    id: "descubrir:vrcfury-installer",
    nombre: "VRCFury Auto-Installer",
    tipo: "skill",
    descripcion: "Creación de menús radiales, toggles de ropa y props sincronizados sin tocar animadores a mano.",
    instalado: false,
    activo: false,
    origen: "Catálogo VRChat",
    categoria: "3D y VRChat",
    autor: "VRCFury Team",
    url: "https://vrcfury.com",
    repoUrl: "https://vrcfury.com",
  },
  {
    id: "descubrir:git-worktrees-manager",
    nombre: "Git Worktrees Manager Pro",
    tipo: "herramienta",
    descripcion: "Gestión ágil de ramas y puestos de trabajo aislados para equipos de múltiples agentes.",
    instalado: false,
    activo: false,
    origen: "DevTools",
    categoria: "Desarrollo",
    autor: "Git CLI Tools",
    url: "https://git-scm.com/docs/git-worktree",
    repoUrl: "https://git-scm.com/docs/git-worktree",
  },
  {
    id: "descubrir:web-docs-scraper",
    nombre: "Web Docs Scraper & Cache",
    tipo: "mcp",
    descripcion: "Servidor MCP para descargar y consultar documentación técnica offline.",
    instalado: false,
    activo: false,
    origen: "MCP Hub",
    categoria: "Herramientas",
    autor: "Anthropic MCP",
    url: "https://github.com/modelcontextprotocol/servers",
    repoUrl: "https://github.com/modelcontextprotocol/servers",
  },
];

/** Devuelve la lista completa de elementos instalados y descubiertos. */
export function listarCatalogo(): { instalados: ItemCatalogo[]; descubrir: ItemCatalogo[] } {
  const customInstalados = leerInstaladasCustom();
  const instalados = [...escanearSkills(), ...escanearMcps(), ...herramientasSistema(), ...customInstalados];
  const idsInstalados = new Set(instalados.map((i) => i.id));

  const descubrir = CATALOGO_DESCUBRIR.map((d) => ({
    ...d,
    instalado: idsInstalados.has(d.id),
  }));

  return {
    instalados,
    descubrir,
  };
}

/** Instala un nuevo MCP, Skill o herramienta. */
export async function instalarItem(item: any): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!item || !item.nombre) return { ok: false, error: "Datos del elemento incompletos." };
    const custom = leerInstaladasCustom();
    const id = item.id || `${item.tipo || "mcp"}:${item.nombre.toLowerCase().replace(/[^a-z0-9_-]/g, "-")}`;

    const nuevo: ItemCatalogo = {
      id,
      nombre: item.nombre,
      tipo: item.tipo || "mcp",
      descripcion: item.descripcion || "Instalado manualmente en Trama",
      instalado: true,
      activo: true,
      origen: item.origen || "Manual",
      categoria: item.categoria || "Personalizado",
      comando: item.comando,
      url: item.url || item.repoUrl,
      repoUrl: item.repoUrl || item.url,
      ruta: item.ruta || (item.tipo === "skill" ? path.join(CLAUDE_DIR, "skills", id.replace(/^skill:/, "")) : CLAUDE_JSON),
    };

    const filtrados = custom.filter((c) => c.id !== id);
    filtrados.push(nuevo);
    guardarInstaladasCustom(filtrados);

    // Aseguramos que no esté en desactivadas
    const des = leerDesactivadas();
    if (des.has(id)) {
      des.delete(id);
      guardarDesactivadas(des);
    }

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/** Desinstala un MCP o Skill. */
export async function desinstalarItem(id: string, _tipo: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const custom = leerInstaladasCustom();
    const nuevos = custom.filter((c) => c.id !== id);
    guardarInstaladasCustom(nuevos);

    const des = leerDesactivadas();
    des.delete(id);
    guardarDesactivadas(des);

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/** Alterna el estado activo/inactivo de una herramienta. */
export async function alternarItem(id: string, _tipo: string, activo: boolean): Promise<{ ok: boolean; error?: string }> {
  try {
    const des = leerDesactivadas();
    if (activo) {
      des.delete(id);
    } else {
      des.add(id);
    }
    guardarDesactivadas(des);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/** Abre la ubicación en el explorador de archivos o enlace en el navegador. */
export async function abrirItem(id: string, tipo: string, ruta?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    let destino = ruta;
    if (!destino) {
      if (tipo === "skill") {
        const idLimpio = id.replace(/^skill:/, "").replace(/^descubrir:/, "");
        const candidatas = [
          path.join(CLAUDE_DIR, "skills", idLimpio),
          path.join(WIN_USER, ".claude", "skills", idLimpio),
          path.join(HOME, ".gemini", "antigravity-cli", "builtin", "skills", idLimpio),
        ];
        destino = candidatas.find((p) => existsSync(p)) || path.join(CLAUDE_DIR, "skills");
      } else if (tipo === "mcp") {
        destino = existsSync(CLAUDE_JSON) ? CLAUDE_JSON : existsSync(WIN_CLAUDE_JSON) ? WIN_CLAUDE_JSON : CLAUDE_DIR;
      } else {
        destino = HOME;
      }
    }

    if (destino.startsWith("http://") || destino.startsWith("https://")) {
      const cmd = process.platform === "win32" ? `start "" "${destino}"` : process.platform === "darwin" ? `open "${destino}"` : `xdg-open "${destino}"`;
      exec(cmd);
      return { ok: true };
    }

    const target = existsSync(destino) ? destino : path.dirname(destino);
    const cmd = process.platform === "win32" ? `explorer.exe "${target}"` : process.platform === "darwin" ? `open "${target}"` : `xdg-open "${target}"`;
    exec(cmd);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export {
  abrirItem as abrirUbicacionHerramienta,
  alternarItem as alternarHerramienta,
  desinstalarItem as desinstalarHerramienta,
  instalarItem as instalarHerramienta,
};
