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
import { leerSesion, partirMcp, piezasSistema, skillsPorHook, tokensAprox, topar, type FilaSistema, type InfoSesion } from "./contexto-sesion.ts";

export { CHARS_POR_TOKEN, tokensAprox, partirMcp } from "./contexto-sesion.ts";
export type { FilaSistema, InfoSesion, TipoSistema } from "./contexto-sesion.ts";

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
  /** Lo que ESTÁ en la ventana: las definiciones de sus herramientas ya cargadas y sus instrucciones. Nunca más que la categoría; `null` si no se sabe. */
  tokens: number | null;
  usos: number;
  /** Las instrucciones del servidor (ya están dentro de `tokens`). */
  instrucciones: number;
  /** Definiciones que existen pero no están cargadas (se cargan al buscarlas con ToolSearch): NO suman al total. `null`: no se sabe. */
  diferidos: number | null;
  /** Lo que pesan en los mensajes los resultados de sus herramientas (estimado; es parte de "Mensajes", no de esta categoría). `null`: no se midió. */
  resultados: number | null;
  /** `tokens` de una herramienta sin cargar es lo que pesaría su definición: no suma. */
  herramientas: { nombre: string; tokens: number | null; cargada: boolean | null; usos: number }[];
};
export type FilaSkill = {
  nombre: string;
  origen: string | null;
  plugin: string | null;
  /** Sólo la descripción está cargada (el cuerpo entra al usarla). */
  tokens: number | null;
  estimado: boolean;
  usos: number;
  /** Cuántas veces la metió un hook al contexto (por ejemplo, una que se activa en cada mensaje). */
  hook: number;
};
export type FilaMemoria = { ruta: string; tipo: string | null; tokens: number; estimado: boolean };

export type Desglose = {
  version: 1;
  quien: { tipo: "lider" | "worker" | "subagente"; id: string };
  /** `claude`, `gemini`, `dsh`, `opencode`, `ollama` o `local`. */
  motor: string;
  fuente: "claude" | "transcript" | "sin-desglose" | "previa";
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
  /** La versión de `claude` que armó el prompt que se muestra en "sistema"; `null` si el transcript no la anotó. */
  promptVersion?: string | null;
  /** De qué está hecho el "sistema" (prompt de Claude Code, hooks de inicio, lista de herramientas diferidas…); estimado. Lo que falta hasta la categoría es "sin separar". */
  sistema: FilaSistema[];
  /** Lo que se usó en la sesión aunque no figure arriba (por ejemplo, en un desglose estimado). */
  usos: Usos;
  /** Fuente "claude": cuándo se midió (epoch ms). `null` si no aplica. */
  medidoEn: number | null;
  /** La medición exacta es la última que contestó el líder: ahora no contestó. */
  desactualizado: boolean;
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
  /** skill → veces que un hook la metió al contexto. */
  hook: Record<string, number>;
};

/** La ventana de un modelo de Claude cuando nadie la dice: desde los 5.5 es de 1M por defecto. */
export const VENTANA_CLAUDE = 1_000_000;

type J = Record<string, unknown>;
const obj = (x: unknown): x is J => !!x && typeof x === "object" && !Array.isArray(x);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const str = (x: unknown): string | null => (typeof x === "string" && x ? x : null);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

const vaciosUsos = (): Usos => ({ herramientas: {}, skills: {}, mcp: {}, hook: {} });

// --- Usos de la sesión ------------------------------------------------------------------------------------------------------------------

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
    mcp: d.mcp.filter((m) => m.usos === 0 && (m.tokens ?? 0) > 0).map((m) => m.servidor),
    skills: d.skills.filter((s) => s.usos === 0 && s.hook === 0).map((s) => s.nombre),
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
 * Las herramientas integradas cuando la respuesta no trae la lista (`get_context_usage` en modo `summary` la manda vacía): las del primer
 * pedido del transcript, con su peso estimado (las cargadas), y los nombres que se anunciaron como diferidos (sin peso: no están en la ventana).
 */
function herramientasDeSesion(info: InfoSesion | null, usos: Usos): FilaHerramienta[] {
  if (!info) return [];
  const r: FilaHerramienta[] = (info.herramientas ?? [])
    .filter((h) => !h.nombre.startsWith("mcp__"))
    .map((h) => ({ nombre: h.nombre, tokens: h.tokens, diferida: false, usos: usos.herramientas[h.nombre] ?? 0 }));
  for (const n of info.diferidas)
    if (!n.startsWith("mcp__") && !r.some((h) => h.nombre === n)) r.push({ nombre: n, tokens: null, diferida: true, usos: usos.herramientas[n] ?? 0 });
  return r;
}

/** Un número que se puede achicar (para que lo contado nunca pase de su categoría). */
type Ref = { get: () => number; set: (n: number) => void };
const ref = <T extends object>(o: T, k: keyof T): Ref => ({ get: () => (o[k] as number) ?? 0, set: (n) => void ((o[k] as number) = n) });

/**
 * El desglose de un líder de Claude a partir de su respuesta a `get_context_usage`, más los usos de su transcript (si se pudo leer).
 * Lo que no viene en la respuesta (un `claude` viejo, otra forma) queda vacío: nunca se inventa. Las herramientas MCP diferidas (sólo el
 * nombre está en la ventana hasta que se buscan) y los resultados de herramientas no suman a su categoría: se dicen aparte, y lo que sí
 * suma nunca pasa del total que dice la categoría.
 */
export function desdeClaude(resp: unknown, x: { id: string; usos?: Usos; info?: InfoSesion; medidoEn?: number | null; desactualizado?: boolean }): Desglose {
  const r = obj(resp) ? resp : {};
  const info = x.info ?? null;
  const categorias = categoriasDe(r);
  /** Lo que dice la categoría (sin las diferidas); `Infinity` si la respuesta no trae categorías: no hay contra qué topar. */
  const tope = (id: Categoria) => (categorias.length ? categorias.filter((c) => c.id === id && !c.diferido).reduce((n, c) => n + c.tokens, 0) : Infinity);
  const usosBase = x.usos ?? vaciosUsos();
  const deLaRespuesta: FilaHerramienta[] = [
    ...arr(r.systemTools).filter(obj).map((t) => ({ nombre: str(t.name) ?? "?", tokens: num(t.tokens), diferida: false, usos: usosBase.herramientas[str(t.name) ?? ""] ?? 0 })),
    ...arr(r.deferredBuiltinTools).filter(obj).map((t) => ({ nombre: str(t.name) ?? "?", tokens: num(t.tokens), diferida: t.isLoaded !== true, usos: usosBase.herramientas[str(t.name) ?? ""] ?? 0 })),
  ];
  // Sin lista en la respuesta (modo `summary`), la del transcript; los pesos se achican a lo que dice la categoría más abajo (`topar`).
  const herramientas = deLaRespuesta.length ? deLaRespuesta : herramientasDeSesion(info, usosBase);
  const servidores = new Map<string, FilaMcp>();
  const servidor = (s: string) => {
    let f = servidores.get(s);
    if (!f) servidores.set(s, (f = { servidor: s, tokens: 0, usos: usosMcp(usosBase, s), instrucciones: 0, diferidos: 0, resultados: info?.resultadosMcp[s] ?? null, herramientas: [] }));
    return f;
  };
  for (const t of arr(r.mcpTools).filter(obj)) {
    const nombreCompleto = str(t.name) ?? "";
    const p = partirMcp(nombreCompleto);
    const s = str(t.serverName) ?? p?.servidor ?? "?";
    const h = p && p.servidor === s ? p.herramienta : p?.herramienta || nombreCompleto;
    const f = servidor(s);
    const tk = num(t.tokens);
    const cargada = typeof t.isLoaded === "boolean" ? t.isLoaded : null;
    // Una herramienta diferida existe pero su definición no está en la ventana: no suma.
    if (cargada === false) f.diferidos = (f.diferidos ?? 0) + (tk ?? 0);
    else f.tokens = (f.tokens ?? 0) + (tk ?? 0);
    f.herramientas.push({ nombre: h, tokens: tk, cargada, usos: usosBase.mcp[s]?.[h] ?? 0 });
  }
  // Las instrucciones vienen con el nombre sin normalizar (`claude.ai Notion`): se cuentan en el servidor normalizado.
  for (const i of arr(r.mcpInstructions).filter(obj)) {
    const s = (str(i.serverName) ?? "?").replace(/[^A-Za-z0-9_-]/g, "_");
    const f = servidor(s);
    const tk = num(i.tokens) ?? 0;
    f.instrucciones += tk;
    f.tokens = (f.tokens ?? 0) + tk;
  }
  const sk = obj(r.skills) ? r.skills : {};
  const nombresSkills = arr(sk.skillFrontmatter).filter(obj).map((s) => str(s.name) ?? "?");
  const porHook = info ? skillsPorHook(info.hooks, nombresSkills) : {};
  const usos: Usos = { ...usosBase, hook: porHook };
  const skills: FilaSkill[] = arr(sk.skillFrontmatter)
    .filter(obj)
    .map((s) => {
      const nombre = str(s.name) ?? "?";
      return { nombre, origen: str(s.source), plugin: str(s.pluginId) ?? str(s.pluginName), tokens: num(s.tokens), estimado: false, usos: usos.skills[nombre] ?? 0, hook: porHook[nombre] ?? 0 };
    });
  const memoria: FilaMemoria[] = arr(r.memoryFiles)
    .filter(obj)
    .map((m) => ({ ruta: str(m.path) ?? "?", tipo: str(m.type), tokens: num(m.tokens) ?? 0, estimado: false }));
  const sistema = info ? piezasSistema(info) : [];
  // Nada de lo contado pasa de su categoría: si los ítems suman más (cosas medidas por separado), se achican parejo.
  topar(herramientas.filter((h) => !h.diferida), (h) => h.tokens ?? 0, (h, n) => void (h.tokens = n), tope("herramientas"));
  const contadas: Ref[] = [];
  for (const f of servidores.values()) {
    contadas.push(ref(f, "instrucciones"));
    for (const h of f.herramientas) if (h.cargada !== false && h.tokens !== null) contadas.push(ref(h as { tokens: number }, "tokens"));
  }
  topar(contadas, (c) => c.get(), (c, n) => c.set(n), tope("mcp"));
  for (const f of servidores.values()) f.tokens = f.instrucciones + f.herramientas.reduce((n, h) => n + (h.cargada !== false ? (h.tokens ?? 0) : 0), 0);
  topar(skills, (s) => s.tokens ?? 0, (s, n) => void (s.tokens = n), tope("skills"));
  topar(memoria, (m) => m.tokens, (m, n) => void (m.tokens = n), tope("memoria"));
  topar(sistema, (s) => s.tokens, (s, n) => void (s.tokens = n), tope("sistema"));
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
    categorias,
    ...d,
    memoria,
    sistema,
    promptVersion: info?.version ?? null,
    usos,
    medidoEn: x.medidoEn ?? null,
    desactualizado: x.desactualizado ?? false,
    sinUso: sinUsoDe(d),
    motivo: null,
  };
}

// --- La última medición exacta ---------------------------------------------------------------------------------------------------------

export type Medicion = { resp: unknown; en: number };

/** Cuánto vale una medición vieja si el líder ya no contesta: pasado eso es mejor decir que no se sabe. */
export const MEDICION_VIGENTE_MS = 6 * 3600_000;

/**
 * El `/context` de un líder vivo, y si ahora no contesta (está en medio de algo, tardó) la última medición exacta que se tuvo, marcada
 * como vieja: así los números no saltan entre exacto y estimado al refrescar. `null`: no hay ni una ni otra.
 */
export async function medirConRespaldo(
  cache: Map<string, Medicion>,
  sid: string,
  leer: () => Promise<unknown | null>,
  ahora: () => number = Date.now,
): Promise<{ resp: unknown; en: number; viejo: boolean } | null> {
  const nueva = await leer().catch(() => null);
  if (nueva) {
    cache.set(sid, { resp: nueva, en: ahora() });
    // Un tope: no se guardan mediciones de líderes que ya no están.
    if (cache.size > 40) cache.delete(cache.keys().next().value as string);
    return { resp: nueva, en: ahora(), viejo: false };
  }
  const antes = cache.get(sid);
  if (antes && ahora() - antes.en <= MEDICION_VIGENTE_MS) return { resp: antes.resp, en: antes.en, viejo: true };
  return null;
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
 * El desglose estimado desde el transcript. `memoria` y `skills` vienen medidos de los archivos (lo que esa sesión carga; la memoria sale
 * del adjunto de instrucciones del propio transcript si lo trae). Si el transcript trae las definiciones de herramientas del primer pedido,
 * las herramientas integradas, las de MCP ya cargadas (más las que se buscaron después), las instrucciones de MCP y los agentes salen de
 * ahí; lo que sobra de lo fijo queda como "sistema" (prompt, hooks, nombres de herramientas diferidas, entorno y el primer mensaje). Lo que
 * creció después son los mensajes.
 */
export function desdeTranscript(
  lineas: string[],
  x: {
    tipo: "lider" | "worker" | "subagente";
    id: string;
    motor: string;
    memoria: FilaMemoria[];
    skills: { nombre: string; origen: string | null; plugin: string | null; tokens: number }[];
    ventana?: number | null;
    /** `claudeMdExcludes` vigentes: lo excluido no se cuenta aunque ese transcript lo haya cargado. */
    excludes?: string[];
  },
): Desglose {
  const usosBase = usosDe(lineas);
  const info = leerSesion(lineas);
  const pedidos = pedidosDe(lineas);
  const porHook = skillsPorHook(info.hooks, x.skills.map((s) => s.nombre));
  const usos: Usos = { ...usosBase, hook: porHook };
  const skills: FilaSkill[] = x.skills.map((s) => ({ ...s, estimado: true, usos: usos.skills[s.nombre] ?? 0, hook: porHook[s.nombre] ?? 0 }));
  const memoria: FilaMemoria[] = info.instrucciones
    ? info.instrucciones.filter((i) => !excluida(i.ruta, x.excludes ?? [])).map((i) => ({ ruta: i.ruta, tipo: i.tipo, tokens: i.tokens, estimado: true }))
    : x.memoria;
  const modelo = pedidos.length ? pedidos[pedidos.length - 1].modelo : null;

  // Herramientas integradas y de MCP del primer pedido; las de MCP que se buscaron después se suman a su servidor.
  const integradas = (info.herramientas ?? []).filter((h) => !h.nombre.startsWith("mcp__"));
  const definidas = new Map<string, number>();
  for (const h of info.herramientas ?? []) if (h.nombre.startsWith("mcp__")) definidas.set(h.nombre, h.tokens);
  const inicialesMcp = new Set(definidas.keys());
  for (const b of info.buscadas) if (b.nombre.startsWith("mcp__")) definidas.set(b.nombre, Math.max(definidas.get(b.nombre) ?? 0, b.tokens));
  const nombresMcp = new Map<string, FilaMcp>();
  const srv = (s: string) => {
    let f = nombresMcp.get(s);
    if (!f) nombresMcp.set(s, (f = { servidor: s, tokens: 0, usos: usosMcp(usos, s), instrucciones: info.mcpInstrucciones[s] ?? 0, diferidos: null, resultados: info.resultadosMcp[s] ?? null, herramientas: [] }));
    return f;
  };
  for (const [nombre, tk] of definidas) {
    const p = partirMcp(nombre);
    if (!p) continue;
    srv(p.servidor).herramientas.push({ nombre: p.herramienta, tokens: tk, cargada: true, usos: usos.mcp[p.servidor]?.[p.herramienta] ?? 0 });
  }
  // Las diferidas que nadie buscó: se sabe el nombre y nada más.
  for (const n of info.diferidas) {
    const p = partirMcp(n);
    if (p && !definidas.has(n)) srv(p.servidor).herramientas.push({ nombre: p.herramienta, tokens: null, cargada: false, usos: usos.mcp[p.servidor]?.[p.herramienta] ?? 0 });
  }
  for (const [servidor, hs] of Object.entries(usos.mcp)) {
    const f = srv(servidor);
    for (const [nombre, n] of Object.entries(hs)) if (!f.herramientas.some((h) => h.nombre === nombre)) f.herramientas.push({ nombre, tokens: null, cargada: null, usos: n });
  }
  for (const s of Object.keys(info.mcpInstrucciones)) srv(s);
  for (const f of nombresMcp.values()) f.tokens = f.instrucciones + f.herramientas.reduce((n, h) => n + (h.cargada ? (h.tokens ?? 0) : 0), 0);
  const mcp = [...nombresMcp.values()];

  const herramientas: FilaHerramienta[] = integradas.map((h) => ({ nombre: h.nombre, tokens: h.tokens, diferida: false, usos: usos.herramientas[h.nombre] ?? 0 }));
  // Las integradas que se anunciaron diferidas (sólo el nombre está en la ventana) van aparte y no suman.
  for (const n of info.diferidas) if (!n.startsWith("mcp__") && !herramientas.some((h) => h.nombre === n)) herramientas.push({ nombre: n, tokens: null, diferida: true, usos: usos.herramientas[n] ?? 0 });
  for (const [nombre, n] of Object.entries(usos.herramientas).sort((a, b) => b[1] - a[1]))
    if (!herramientas.some((h) => h.nombre === nombre)) herramientas.push({ nombre, tokens: null, diferida: false, usos: n });

  const sistema = piezasSistema(info);
  const base = {
    version: 1 as const,
    quien: { tipo: x.tipo, id: x.id },
    motor: x.motor,
    herramientas,
    mcp,
    skills,
    memoria,
    sistema,
    promptVersion: info.version,
    usos,
    medidoEn: null,
    desactualizado: false,
    sinUso: { herramientas: [] as string[], mcp: [] as string[], skills: skills.filter((s) => s.usos === 0 && s.hook === 0).map((s) => s.nombre) },
  };
  if (!pedidos.length)
    return { ...base, sistema: [], fuente: "transcript", estimado: true, modelo, usado: null, ventana: x.ventana ?? null, ventanaEstimada: x.ventana == null, categorias: [], motivo: "sin-uso" };
  const usado = pedidos[pedidos.length - 1].total;
  const fijo = pedidos[0].total;
  const sumaMem = memoria.reduce((a, m) => a + m.tokens, 0);
  const sumaSk = x.skills.reduce((a, s) => a + s.tokens, 0);
  const sumaHerr = info.herramientas ? integradas.reduce((a, h) => a + h.tokens, 0) : 0;
  const mcpFijo = [...inicialesMcp].reduce((a, n) => a + (definidas.get(n) ?? 0), 0) + Object.values(info.mcpInstrucciones).reduce((a, n) => a + n, 0);
  const mcpBuscado = [...definidas].reduce((a, [n, t]) => a + (inicialesMcp.has(n) ? 0 : t), 0);
  // Cada parte se achica a lo que queda: nunca más de lo que hay en la ventana.
  let resto = usado;
  const tomar = (n: number) => {
    const v = Math.max(0, Math.min(n, resto));
    resto -= v;
    return v;
  };
  const tHerr = tomar(sumaHerr);
  const tMem = tomar(Math.min(sumaMem, fijo));
  const tSk = tomar(Math.min(sumaSk, Math.max(0, fijo - tMem)));
  const tAg = tomar(info.agentes);
  const tMcp = tomar(mcpFijo + mcpBuscado);
  const tSis = tomar(Math.max(0, Math.min(fijo, usado) - tHerr - tMem - tSk - tAg - mcpFijo));
  const tMsj = resto;
  // Los ítems no pasan de su categoría.
  topar(herramientas.filter((h) => h.tokens !== null), (h) => h.tokens ?? 0, (h, n) => void (h.tokens = n), tHerr);
  const contadas: Ref[] = [];
  for (const f of mcp) {
    contadas.push(ref(f, "instrucciones"));
    for (const h of f.herramientas) if (h.cargada && h.tokens !== null) contadas.push(ref(h as { tokens: number }, "tokens"));
  }
  topar(contadas, (c) => c.get(), (c, n) => c.set(n), tMcp);
  for (const f of mcp) f.tokens = f.instrucciones + f.herramientas.reduce((n, h) => n + (h.cargada ? (h.tokens ?? 0) : 0), 0);
  topar(skills, (s) => s.tokens ?? 0, (s, n) => void (s.tokens = n), tSk);
  topar(memoria, (m) => m.tokens, (m, n) => void (m.tokens = n), tMem);
  topar(sistema, (s) => s.tokens, (s, n) => void (s.tokens = n), tSis);
  base.sinUso.herramientas = herramientas.filter((h) => h.usos === 0 && (h.tokens ?? 0) > 0).map((h) => h.nombre);
  base.sinUso.mcp = mcp.filter((m) => m.usos === 0 && (m.tokens ?? 0) > 0).map((m) => m.servidor);
  const categorias: FilaCategoria[] = [
    { id: "sistema", nombre: null, tokens: tSis, estimado: true },
    ...(info.herramientas ? [{ id: "herramientas" as const, nombre: null, tokens: tHerr, estimado: true }] : []),
    ...(tMcp > 0 ? [{ id: "mcp" as const, nombre: null, tokens: tMcp, estimado: true }] : []),
    { id: "memoria", nombre: null, tokens: tMem, estimado: true },
    { id: "skills", nombre: null, tokens: tSk, estimado: true },
    ...(info.agentes ? [{ id: "agentes" as const, nombre: null, tokens: tAg, estimado: true }] : []),
    { id: "mensajes", nombre: null, tokens: tMsj, estimado: true },
  ];
  const ventana = x.ventana ?? (modelo && /^claude-/.test(modelo) ? VENTANA_CLAUDE : null);
  return { ...base, fuente: "transcript", estimado: true, modelo, usado, ventana, ventanaEstimada: x.ventana == null, categorias, motivo: null };
}

/** Un motor sin desglose (Gemini, dsh, OpenCode): sólo quién es y por qué no hay más. */
export function sinDesglose(x: { tipo: "lider" | "worker" | "subagente"; id: string; motor: string; modelo?: string | null; motivo?: Desglose["motivo"] }): Desglose {
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
    sistema: [],
    usos: vaciosUsos(),
    medidoEn: null,
    desactualizado: false,
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
