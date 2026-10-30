// El panel de contexto: en qué se va el contexto de un líder o de un worker, por categoría (sistema, herramientas integradas, MCP por
// servidor y por herramienta, skills, memoria por archivo, mensajes) y cuántas veces se usó cada herramienta, skill y servidor MCP en esa
// sesión (para ver lo que pesa y nunca se usa). Dos fuentes:
//   - "claude": el `/context` de un líder de Claude vivo (`get_context_usage`, `lineaContexto` en lider-arma.ts). Exacto salvo lo que el
//     propio Claude Code estima (lo marca él; acá `estimado: false`).
//   - "transcript": lo que se puede sacar del `.jsonl` de la sesión (un worker de `pa`, que corre `claude -p` sin canal de control, o un
//     líder sin proceso vivo): el total sale del `usage` del último pedido; el primer pedido de la sesión da lo fijo (sistema, herramientas,
//     memoria, skills y el primer mensaje) y lo que creció desde ahí son los mensajes. Memoria y skills se miden de los archivos. Todo
//     eso va con `estimado: true`.
// Los motores sin nada de eso (Gemini por agy, dsh, OpenCode) dan "sin-desglose". Node puro: sin Electron ni estado; lo de leer
// archivos y procesos está en contexto-panel.ts.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolverImports } from "./instrucciones-md.ts";

export type Categoria = "sistema" | "herramientas" | "mcp" | "skills" | "memoria" | "agentes" | "mensajes" | "reserva" | "libre" | "otro";

export type FilaCategoria = {
  id: Categoria;
  /** El nombre que le da Claude Code (en inglés), si vino de él. */
  nombre: string | null;
  tokens: number;
  estimado: boolean;
  /** Esquemas de herramientas diferidas (fuera de la ventana hasta que se buscan): no suman al total. */
  diferido?: true;
};

export type FilaHerramienta = { nombre: string; tokens: number | null; diferida: boolean; usos: number };
export type FilaMcp = {
  servidor: string;
  /** Los esquemas de sus herramientas y sus instrucciones; `null` si no se sabe. */
  tokens: number | null;
  usos: number;
  herramientas: { nombre: string; tokens: number | null; cargada: boolean | null; usos: number }[];
};
export type FilaSkill = { nombre: string; origen: string | null; plugin: string | null; tokens: number | null; estimado: boolean; usos: number };
export type FilaMemoria = { ruta: string; tipo: string | null; tokens: number; estimado: boolean };

export type Desglose = {
  version: 1;
  quien: { tipo: "lider" | "worker"; id: string };
  /** `claude`, `gemini`, `dsh`, `opencode`, `ollama` o `local`. */
  motor: string;
  fuente: "claude" | "transcript" | "sin-desglose";
  /** Algo de lo que sigue es una estimación (siempre con fuente "transcript"). */
  estimado: boolean;
  modelo: string | null;
  /** Tokens en la ventana ahora; `null` si no se sabe. */
  usado: number | null;
  ventana: number | null;
  /** La ventana no la dijo nadie: es la de siempre de ese modelo. */
  ventanaEstimada: boolean;
  categorias: FilaCategoria[];
  herramientas: FilaHerramienta[];
  mcp: FilaMcp[];
  skills: FilaSkill[];
  memoria: FilaMemoria[];
  /** Lo que se usó en la sesión aunque no figure arriba (por ejemplo, en un desglose estimado). */
  usos: Usos;
  /** Lo que pesa y no se usó nunca en esta sesión: el candidato a apagar. */
  sinUso: { herramientas: string[]; mcp: string[]; skills: string[] };
  /** Una línea para la vista cuando no hay desglose o es parcial (en español; la vista puede traducirla por `motivo`). */
  motivo: null | "motor-sin-desglose" | "sin-transcript" | "sin-uso";
};

export type Usos = {
  herramientas: Record<string, number>;
  skills: Record<string, number>;
  /** servidor (normalizado, como en `mcp__<servidor>__…`) → herramienta → veces. */
  mcp: Record<string, Record<string, number>>;
};

/** Caracteres por token para estimar texto de instrucciones (inglés y español mezclados, markdown): conservador. */
export const CHARS_POR_TOKEN = 3.5;
export const tokensAprox = (t: string) => Math.ceil(t.length / CHARS_POR_TOKEN);

/** La ventana de un modelo de Claude cuando nadie la dice: desde los 5.5 es de 1M por defecto. */
export const VENTANA_CLAUDE = 1_000_000;

type J = Record<string, unknown>;
const obj = (x: unknown): x is J => !!x && typeof x === "object" && !Array.isArray(x);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const str = (x: unknown): string | null => (typeof x === "string" && x ? x : null);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

const vaciosUsos = (): Usos => ({ herramientas: {}, skills: {}, mcp: {} });

// --- Usos de la sesión ------------------------------------------------------------------------------------------------------------------

/** `mcp__servidor__herramienta` → sus partes; `null` si no es de un MCP. */
export function partirMcp(nombre: string): { servidor: string; herramienta: string } | null {
  if (!nombre.startsWith("mcp__")) return null;
  const resto = nombre.slice(5);
  const i = resto.indexOf("__");
  return i <= 0 ? { servidor: resto, herramienta: "" } : { servidor: resto.slice(0, i), herramienta: resto.slice(i + 2) };
}

const sumar = (r: Record<string, number>, k: string) => (r[k] = (r[k] ?? 0) + 1);

/**
 * Cuántas veces se usó cada cosa en un transcript (`.jsonl` de Claude Code): cada `tool_use` de los mensajes del modelo (una skill por la
 * herramienta `Skill` cuenta para la skill y para `Skill`; una de MCP, para su servidor y su herramienta) y cada `/comando` que escribió
 * el usuario (así se invoca una skill a mano). Lo de los subagentes (`isSidechain`) no cuenta: no es de esta ventana.
 */
export function usosDe(lineas: string[]): Usos {
  const u = vaciosUsos();
  for (const l of lineas) {
    let o: J;
    try {
      const x = JSON.parse(l);
      if (!obj(x)) continue;
      o = x;
    } catch {
      continue;
    }
    if (o.isSidechain === true) continue;
    const m = obj(o.message) ? o.message : null;
    if (o.type === "assistant" && m)
      for (const b of arr(m.content)) {
        if (!obj(b) || b.type !== "tool_use") continue;
        const nombre = str(b.name);
        if (!nombre) continue;
        const mcp = partirMcp(nombre);
        if (mcp) {
          const s = (u.mcp[mcp.servidor] ??= {});
          sumar(s, mcp.herramienta);
          continue;
        }
        sumar(u.herramientas, nombre);
        if (nombre === "Skill" && obj(b.input)) {
          const sk = str(b.input.skill) ?? str(b.input.command) ?? str(b.input.name);
          if (sk) sumar(u.skills, sk.replace(/^\//, ""));
        }
      }
    if (o.type === "user" && m) {
      const textos = typeof m.content === "string" ? [m.content] : arr(m.content).map((b) => (obj(b) && typeof b.text === "string" ? b.text : ""));
      for (const t of textos) {
        const c = /<command-name>\/?([^<\s]+)<\/command-name>/.exec(t);
        if (c) sumar(u.skills, c[1]);
      }
    }
  }
  return u;
}

const usosMcp = (u: Usos, servidor: string) => Object.values(u.mcp[servidor] ?? {}).reduce((a, b) => a + b, 0);

/** Lo que pesa (tokens > 0) y no se usó en la sesión. */
function sinUsoDe(d: Pick<Desglose, "herramientas" | "mcp" | "skills">): Desglose["sinUso"] {
  return {
    herramientas: d.herramientas.filter((h) => h.usos === 0 && (h.tokens ?? 0) > 0 && !h.diferida).map((h) => h.nombre),
    mcp: d.mcp.filter((m) => m.usos === 0).map((m) => m.servidor),
    skills: d.skills.filter((s) => s.usos === 0).map((s) => s.nombre),
  };
}

// --- Fuente "claude": la respuesta a get_context_usage ----------------------------------------------------------------------------------

const POR_ID: Record<string, Categoria> = {
  system_prompt: "sistema",
  system_tools: "herramientas",
  system_tools_deferred: "herramientas",
  mcp_tools: "mcp",
  mcp_instructions: "mcp",
  mcp_tools_deferred: "mcp",
  custom_agents: "agentes",
  memory_files: "memoria",
  skills: "skills",
  messages: "mensajes",
  autocompact_buffer: "reserva",
  compact_buffer: "reserva",
  free_space: "libre",
};
/** Un `claude` anterior a los `id` de categoría: por el nombre en inglés. */
const POR_NOMBRE: [RegExp, Categoria][] = [
  [/^system prompt/i, "sistema"],
  [/^system tools/i, "herramientas"],
  [/^mcp/i, "mcp"],
  [/agents/i, "agentes"],
  [/^memory/i, "memoria"],
  [/^skills/i, "skills"],
  [/^messages/i, "mensajes"],
  [/buffer/i, "reserva"],
  [/^free/i, "libre"],
];

/** Las categorías de la respuesta, juntando las que son lo mismo para el panel (esquemas e instrucciones de MCP, por ejemplo). */
function categoriasDe(r: J): FilaCategoria[] {
  const filas: FilaCategoria[] = [];
  for (const c of arr(r.categories)) {
    if (!obj(c)) continue;
    const tokens = num(c.tokens);
    const nombre = str(c.name);
    if (tokens === null) continue;
    const id = (str(c.id) && POR_ID[c.id as string]) || POR_NOMBRE.find(([re]) => nombre && re.test(nombre))?.[1] || "otro";
    const diferido = c.kind === "deferred" || c.isDeferred === true;
    const ya = filas.find((f) => f.id === id && Boolean(f.diferido) === diferido);
    if (ya) {
      ya.tokens += tokens;
      if (ya.nombre && nombre && !ya.nombre.includes(nombre)) ya.nombre = `${ya.nombre} + ${nombre}`;
    } else filas.push({ id, nombre, tokens, estimado: false, ...(diferido ? { diferido: true as const } : {}) });
  }
  return filas;
}

/**
 * El desglose de un líder de Claude a partir de su respuesta a `get_context_usage`, más los usos de su transcript (si se pudo leer).
 * Lo que no viene en la respuesta (un `claude` viejo, otra forma) queda vacío: nunca se inventa.
 */
export function desdeClaude(resp: unknown, x: { id: string; usos?: Usos }): Desglose {
  const r = obj(resp) ? resp : {};
  const usos = x.usos ?? vaciosUsos();
  const herramientas: FilaHerramienta[] = [
    ...arr(r.systemTools).filter(obj).map((t) => ({ nombre: str(t.name) ?? "?", tokens: num(t.tokens), diferida: false, usos: usos.herramientas[str(t.name) ?? ""] ?? 0 })),
    ...arr(r.deferredBuiltinTools).filter(obj).map((t) => ({ nombre: str(t.name) ?? "?", tokens: num(t.tokens), diferida: t.isLoaded !== true, usos: usos.herramientas[str(t.name) ?? ""] ?? 0 })),
  ];
  const servidores = new Map<string, FilaMcp>();
  const servidor = (s: string) => {
    let f = servidores.get(s);
    if (!f) servidores.set(s, (f = { servidor: s, tokens: 0, usos: usosMcp(usos, s), herramientas: [] }));
    return f;
  };
  for (const t of arr(r.mcpTools).filter(obj)) {
    const nombreCompleto = str(t.name) ?? "";
    const p = partirMcp(nombreCompleto);
    const s = str(t.serverName) ?? p?.servidor ?? "?";
    const h = p && p.servidor === s ? p.herramienta : p?.herramienta || nombreCompleto;
    const f = servidor(s);
    const tk = num(t.tokens);
    f.tokens = (f.tokens ?? 0) + (tk ?? 0);
    f.herramientas.push({ nombre: h, tokens: tk, cargada: typeof t.isLoaded === "boolean" ? t.isLoaded : null, usos: usos.mcp[s]?.[h] ?? 0 });
  }
  // Las instrucciones vienen con el nombre sin normalizar (`claude.ai Notion`): se cuentan en el servidor normalizado.
  for (const i of arr(r.mcpInstructions).filter(obj)) {
    const s = (str(i.serverName) ?? "?").replace(/[^A-Za-z0-9_-]/g, "_");
    const f = servidor(s);
    f.tokens = (f.tokens ?? 0) + (num(i.tokens) ?? 0);
  }
  const sk = obj(r.skills) ? r.skills : {};
  const skills: FilaSkill[] = arr(sk.skillFrontmatter)
    .filter(obj)
    .map((s) => {
      const nombre = str(s.name) ?? "?";
      return { nombre, origen: str(s.source), plugin: str(s.pluginId) ?? str(s.pluginName), tokens: num(s.tokens), estimado: false, usos: usos.skills[nombre] ?? 0 };
    });
  const memoria: FilaMemoria[] = arr(r.memoryFiles)
    .filter(obj)
    .map((m) => ({ ruta: str(m.path) ?? "?", tipo: str(m.type), tokens: num(m.tokens) ?? 0, estimado: false }));
  const ventana = num(r.rawMaxTokens) ?? num(r.maxTokens);
  const d = {
    herramientas,
    mcp: [...servidores.values()],
    skills,
  };
  return {
    version: 1,
    quien: { tipo: "lider", id: x.id },
    motor: "claude",
    fuente: "claude",
    estimado: false,
    modelo: str(r.model),
    usado: num(r.totalTokens),
    ventana,
    ventanaEstimada: false,
    categorias: categoriasDe(r),
    ...d,
    memoria,
    usos,
    sinUso: sinUsoDe(d),
    motivo: null,
  };
}

// --- Fuente "transcript": estimado ------------------------------------------------------------------------------------------------------

type Pedido = { total: number; modelo: string | null };

/** Los pedidos al modelo de un transcript (sin los de subagentes), en orden: cuántos tokens de entrada llevó cada uno. */
export function pedidosDe(lineas: string[]): Pedido[] {
  const r: Pedido[] = [];
  const vistos = new Set<string>();
  for (const l of lineas) {
    let o: J;
    try {
      const x = JSON.parse(l);
      if (!obj(x)) continue;
      o = x;
    } catch {
      continue;
    }
    if (o.type !== "assistant" || o.isSidechain === true || !obj(o.message) || !obj(o.message.usage)) continue;
    // Un mensaje con varios bloques se escribe en varias líneas con el mismo id y el mismo usage: cuenta una vez.
    const id = str(o.message.id);
    if (id && vistos.has(id)) continue;
    if (id) vistos.add(id);
    const u = o.message.usage;
    const total = (num(u.input_tokens) ?? 0) + (num(u.cache_creation_input_tokens) ?? 0) + (num(u.cache_read_input_tokens) ?? 0);
    if (total > 0) r.push({ total, modelo: str(o.message.model) });
  }
  return r;
}

/** La carpeta de trabajo que anotó Claude Code en el transcript (cada línea trae `cwd`): la primera. */
export function cwdDe(lineas: string[]): string | null {
  for (const l of lineas.slice(0, 50)) {
    try {
      const o = JSON.parse(l);
      if (obj(o) && str(o.cwd)) return o.cwd as string;
    } catch {
      /* sigue */
    }
  }
  return null;
}

/**
 * El desglose estimado desde el transcript. `memoria` y `skills` vienen medidos de los archivos (lo que esa sesión carga). Lo fijo es el
 * primer pedido; lo que no es memoria ni skills de eso queda como "sistema" (prompt, herramientas, MCP y el primer mensaje: sin forma de
 * separarlo desde acá). Lo que creció después son los mensajes.
 */
export function desdeTranscript(
  lineas: string[],
  x: { tipo: "lider" | "worker"; id: string; motor: string; memoria: FilaMemoria[]; skills: { nombre: string; origen: string | null; plugin: string | null; tokens: number }[]; ventana?: number | null },
): Desglose {
  const usos = usosDe(lineas);
  const pedidos = pedidosDe(lineas);
  const skills: FilaSkill[] = x.skills.map((s) => ({ ...s, estimado: true, usos: usos.skills[s.nombre] ?? 0 }));
  const herramientas: FilaHerramienta[] = Object.entries(usos.herramientas)
    .sort((a, b) => b[1] - a[1])
    .map(([nombre, n]) => ({ nombre, tokens: null, diferida: false, usos: n }));
  const mcp: FilaMcp[] = Object.entries(usos.mcp).map(([servidor, hs]) => ({
    servidor,
    tokens: null,
    usos: usosMcp(usos, servidor),
    herramientas: Object.entries(hs).map(([nombre, n]) => ({ nombre, tokens: null, cargada: null, usos: n })),
  }));
  const modelo = pedidos.length ? pedidos[pedidos.length - 1].modelo : null;
  const base = {
    version: 1 as const,
    quien: { tipo: x.tipo, id: x.id },
    motor: x.motor,
    herramientas,
    mcp,
    skills,
    memoria: x.memoria,
    usos,
    sinUso: { herramientas: [], mcp: [], skills: skills.filter((s) => s.usos === 0).map((s) => s.nombre) },
  };
  if (!pedidos.length)
    return { ...base, fuente: "transcript", estimado: true, modelo, usado: null, ventana: x.ventana ?? null, ventanaEstimada: x.ventana == null, categorias: [], motivo: "sin-uso" };
  const usado = pedidos[pedidos.length - 1].total;
  const fijo = pedidos[0].total;
  const memoriaT = x.memoria.reduce((a, m) => a + m.tokens, 0);
  const skillsT = x.skills.reduce((a, s) => a + s.tokens, 0);
  // Si lo medido pasa lo fijo (una compactación, archivos que cambiaron), se recorta: nunca más de lo que hay.
  const mem = Math.min(memoriaT, fijo);
  const sk = Math.min(skillsT, fijo - mem);
  const categorias: FilaCategoria[] = [
    { id: "sistema", nombre: null, tokens: Math.max(0, Math.min(fijo, usado) - mem - sk), estimado: true },
    { id: "memoria", nombre: null, tokens: mem, estimado: true },
    { id: "skills", nombre: null, tokens: sk, estimado: true },
    { id: "mensajes", nombre: null, tokens: Math.max(0, usado - fijo), estimado: true },
  ];
  const ventana = x.ventana ?? (modelo && /^claude-/.test(modelo) ? VENTANA_CLAUDE : null);
  return { ...base, fuente: "transcript", estimado: true, modelo, usado, ventana, ventanaEstimada: x.ventana == null, categorias, motivo: null };
}

/** Un motor sin desglose (Gemini, dsh, OpenCode): sólo quién es y por qué no hay más. */
export function sinDesglose(x: { tipo: "lider" | "worker"; id: string; motor: string; modelo?: string | null; motivo?: Desglose["motivo"] }): Desglose {
  return {
    version: 1,
    quien: { tipo: x.tipo, id: x.id },
    motor: x.motor,
    fuente: "sin-desglose",
    estimado: false,
    modelo: x.modelo ?? null,
    usado: null,
    ventana: null,
    ventanaEstimada: false,
    categorias: [],
    herramientas: [],
    mcp: [],
    skills: [],
    memoria: [],
    usos: vaciosUsos(),
    sinUso: { herramientas: [], mcp: [], skills: [] },
    motivo: x.motivo ?? "motor-sin-desglose",
  };
}

// --- Memoria: qué CLAUDE.md carga una sesión ---------------------------------------------------------------------------------------------

/** ¿La ruta cae en algún `claudeMdExcludes`? Ruta exacta o glob (`**` cualquier cosa, `*` dentro de una carpeta). */
export function excluida(ruta: string, excludes: string[]): boolean {
  const r = ruta.replace(/\\/g, "/");
  return excludes.some((e) => {
    const p = e.replace(/\\/g, "/");
    if (!/[*?]/.test(p)) return p === r;
    const re = new RegExp(
      "^" +
        p
          .split(/(\*\*\/?|\*|\?)/)
          .map((t) => (t === "**/" || t === "**" ? ".*" : t === "*" ? "[^/]*" : t === "?" ? "[^/]" : t.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
          .join("") +
        "$",
    );
    return re.test(r);
  });
}

/**
 * Los archivos de memoria que carga una sesión de Claude Code en `cwd` (estimado): el del usuario (`<config de Claude>/CLAUDE.md`) y, de
 * `cwd` hacia arriba, `CLAUDE.md`, `CLAUDE.local.md` y `.claude/CLAUDE.md`, con sus `@imports` de la misma carpeta; menos los excluidos.
 */
export async function memoriaDeSesion(
  x: { cwd: string; claudeDir: string; excludes: string[] },
  leer: (ruta: string) => Promise<string | null> = (r) => readFile(r, "utf8").catch(() => null),
): Promise<FilaMemoria[]> {
  const candidatos: { ruta: string; tipo: string }[] = [{ ruta: path.join(x.claudeDir, "CLAUDE.md"), tipo: "User" }];
  let d = path.resolve(x.cwd);
  for (let i = 0; i < 40; i++) {
    candidatos.push({ ruta: path.join(d, "CLAUDE.md"), tipo: "Project" }, { ruta: path.join(d, ".claude", "CLAUDE.md"), tipo: "Project" }, { ruta: path.join(d, "CLAUDE.local.md"), tipo: "Local" });
    const arriba = path.dirname(d);
    if (arriba === d) break;
    d = arriba;
  }
  const r: FilaMemoria[] = [];
  for (const c of candidatos) {
    if (excluida(c.ruta, x.excludes) || r.some((m) => m.ruta === c.ruta)) continue;
    const t = await leer(c.ruta);
    if (t === null) continue;
    const resuelto = await resolverImports(t, path.dirname(c.ruta)).catch(() => t);
    // Los comentarios HTML no llegan al modelo.
    const limpio = resuelto.replace(/<!--[\s\S]*?-->/g, "").trim();
    if (limpio) r.push({ ruta: c.ruta, tipo: c.tipo, tokens: tokensAprox(limpio), estimado: true });
  }
  return r;
}
