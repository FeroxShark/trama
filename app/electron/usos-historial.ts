// Qué se usó de lo conectado (skills, plugins, servidores MCP) en las sesiones recientes de Claude, sacado de lo que indexó el registro histórico
// (electron/historial.ts, canal `historial:consultar`). Sólo nombres, cantidades y días: nunca texto de una sesión. Puro y sin Node: lo usan el
// catálogo de skills del panel de contexto (skills-catalogo.ts) y Ajustes > Conectores (src/paneles/conectores-vista.ts).

/** Los días que miran los usos del catálogo. */
export const DIAS_USOS = 30;

/** Lo mínimo de un conector (o una skill del catálogo) para ubicar sus usos. */
export type ItemUso = { clave: string; nombre: string; origen: "usuario" | "proyecto" | "plugin" | "claudeai"; de: string };

/** Qué skills y servidores MCP se usaron en las sesiones recientes de Claude de la persona (todas, no sólo la abierta). */
export type UsosCatalogo = {
  dias: number;
  /** Sesiones con actividad en esos días. */
  sesiones: number;
  /** skill (por su clave o su nombre, como la invocó la persona o el modelo) → veces: la herramienta Skill más los `/comandos`. */
  skills: Record<string, number>;
  /** Claves de skills que un hook mete al contexto solo (un plugin con hooks activos cuya skill lleva su nombre). */
  porHook: string[];
  /** Servidor MCP (como lo nombran sus herramientas, `nombreMcp`) → veces que se usó una herramienta suya. Ausente en lo viejo. */
  mcp?: Record<string, number>;
  /** El último día (`AAAA-MM-DD`) en que se usó cada skill (con los `/comandos`) y cada servidor MCP. Un nombre ausente no se usó en esos días. */
  ultimo?: { skills: Record<string, string>; mcp: Record<string, string> };
};

/** El plugin de un conector que viene de uno (lo que va antes de `@`), o `null`. */
export function pluginDe(c: { origen: ItemUso["origen"]; de: string }): string | null {
  if (c.origen === "plugin") return c.de.split("@")[0] || null;
  if (c.origen === "claudeai") return c.de || null;
  return null;
}

/** El nombre con que Claude Code lista una skill y la clave de su apagado: `plugin:skill` si viene de un plugin. */
export function claveSkill(c: { nombre: string; origen: ItemUso["origen"]; de: string }): string {
  const p = pluginDe(c);
  return p && !c.nombre.includes(":") ? `${p}:${c.nombre}` : c.nombre;
}

/** El nombre de un servidor como lo llevan sus herramientas (`mcp__servidor__herramienta`): "claude.ai Calendar" → `claude_ai_Calendar`. */
export const nombreServidor = (x: string): string => x.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 96).replace(/[^A-Za-z0-9_-]/g, "_");

const dias = (x: unknown): Record<string, string> => {
  const r: Record<string, string> = {};
  if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) if (typeof v === "string") r[k] = v;
  return r;
};
const mayor = (a: string | undefined, b: string | undefined) => ((a ?? "") >= (b ?? "") ? a : b);

/** De lo que indexó el historial a lo que usa el catálogo. Una consulta con error o vacía no dice nada: `null`, nunca "no se usó". */
export function usosDeHistorial(c: unknown, lista: Pick<ItemUso, "clave" | "nombre" | "origen" | "de">[]): UsosCatalogo | null {
  const q = c as {
    sesiones?: unknown;
    piezas?: { clase: string; nombre: string; usos: number | null; ganchos: number }[];
    comandos?: Record<string, number>;
    ultimo?: { skills?: unknown; comandos?: unknown; mcp?: unknown };
    error?: unknown;
  } | null;
  if (!q || q.error || typeof q.sesiones !== "number" || !Array.isArray(q.piezas) || q.sesiones <= 0) return null;
  const skills: Record<string, number> = {};
  const mcp: Record<string, number> = {};
  for (const p of q.piezas) {
    if (p.clase === "skill" && (p.usos ?? 0) > 0) skills[p.nombre] = (skills[p.nombre] ?? 0) + (p.usos ?? 0);
    if (p.clase === "mcp" && (p.usos ?? 0) > 0) mcp[p.nombre] = (mcp[p.nombre] ?? 0) + (p.usos ?? 0);
  }
  for (const [n, v] of Object.entries(q.comandos ?? {})) skills[n] = (skills[n] ?? 0) + v;
  const ganchos = new Set(q.piezas.filter((p) => p.clase === "plugin" && p.ganchos > 0).map((p) => p.nombre));
  const porHook = lista
    .filter((s) => (s.origen === "plugin" || s.origen === "claudeai") && ganchos.has(s.de.split("@")[0]) && s.nombre.split(":").pop() === s.de.split("@")[0])
    .map((s) => s.clave);
  // Una skill se usa por la herramienta Skill o por su /comando: vale el día más reciente de los dos.
  const porSkill = dias(q.ultimo?.skills);
  const ultSkills = { ...porSkill };
  for (const [n, d] of Object.entries(dias(q.ultimo?.comandos))) ultSkills[n] = mayor(ultSkills[n], d) ?? d;
  return { dias: DIAS_USOS, sesiones: q.sesiones, skills, porHook, mcp, ultimo: { skills: ultSkills, mcp: dias(q.ultimo?.mcp) } };
}
