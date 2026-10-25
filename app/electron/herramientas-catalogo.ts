// Catálogo de Herramientas, Skills y MCPs para Trama.
// Escanea los MCPs instalados en Claude y Antigravity, las skills en ~/.claude/skills/
// y provee una lista enriquecida con búsqueda reactiva y sección 'Descubrir'.
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
}

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, ".claude");
const CLAUDE_JSON = path.join(HOME, ".claude.json");
const WIN_USER = process.env.USERPROFILE || HOME;
const WIN_CLAUDE_JSON = path.join(WIN_USER, ".claude.json");

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
        items.push({
          id: `skill:${d.name}`,
          nombre: meta.nombre,
          tipo: "skill",
          descripcion: meta.desc || `Skill de trabajo para ${d.name}`,
          instalado: true,
          activo: true,
          origen: c.includes(".gemini") ? "Antigravity" : "Claude Skills",
          categoria: d.name.includes("blender") || d.name.includes("3d") || d.name.includes("vrchat") ? "3D y VRChat" : "Desarrollo",
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
        items.push({
          id: `mcp:${nom}`,
          nombre: nom,
          tipo: "mcp",
          descripcion: `Servidor MCP (${tipoServer}) configurado para comunicación con Claude y Gemini.`,
          instalado: true,
          activo: true,
          origen: "Configuración MCP",
          categoria: nom.toLowerCase().includes("unity") ? "Unity" : nom.toLowerCase().includes("painter") ? "Substance" : "Herramientas",
        });
      }
    } catch {}
  }

  return items;
}

/** Herramientas del sistema y de proyectos. */
function herramientasSistema(): ItemCatalogo[] {
  return [
    {
      id: "tool:pa",
      nombre: "pa (Orquestador)",
      tipo: "herramienta",
      descripcion: "Orquestador de workers y gestión de hilos en puestos Git worktrees.",
      instalado: true,
      activo: true,
      origen: "Trama Motor",
      categoria: "Sistema",
      comando: "pa <proyecto> <tarea>",
    },
    {
      id: "tool:tablero",
      nombre: "tablero",
      tipo: "herramienta",
      descripcion: "Gestión atómica de pendientes, esperas, ideas y tareas del usuario en JSONL.",
      instalado: true,
      activo: true,
      origen: "Trama Motor",
      categoria: "Sistema",
      comando: "tablero resumen",
    },
    {
      id: "tool:proyecto-ruta",
      nombre: "proyecto-ruta",
      tipo: "herramienta",
      descripcion: "Resolución de rutas de proyectos registrados en registry.json.",
      instalado: true,
      activo: true,
      origen: "Trama Motor",
      categoria: "Sistema",
    },
    {
      id: "lider:gemini-flash",
      nombre: "Gemini 3.8 Flash (High)",
      tipo: "lider",
      descripcion: "Líder de alta velocidad y 1M tokens de ventana de contexto ejecutado con agy.",
      instalado: true,
      activo: true,
      origen: "Antigravity CLI",
      categoria: "Modelos",
    },
    {
      id: "lider:claude-sonnet",
      nombre: "Claude Sonnet 4.6 (Thinking)",
      tipo: "lider",
      descripcion: "Modelo de razonamiento analítico y generación de código de alta precisión.",
      instalado: true,
      activo: true,
      origen: "Claude Code",
      categoria: "Modelos",
    },
  ];
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
  },
];

/** Devuelve la lista completa de elementos instalados y descubiertos. */
export function listarCatalogo(): { instalados: ItemCatalogo[]; descubrir: ItemCatalogo[] } {
  const instalados = [...escanearSkills(), ...escanearMcps(), ...herramientasSistema()];
  return {
    instalados,
    descubrir: CATALOGO_DESCUBRIR,
  };
}
