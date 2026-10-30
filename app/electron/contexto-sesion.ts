// Lo que se puede leer del transcript (`.jsonl` de Claude Code) de una sesión para el panel de contexto, además del uso de herramientas:
// el prompt de sistema, las definiciones de herramientas del primer pedido, las que se buscaron después (MCP diferidas que pasaron a estar
// cargadas), las salidas de los hooks, lo que se anunció al arrancar (herramientas diferidas, instrucciones de MCP, agentes, entorno), los
// CLAUDE.md que cargó y cuánto pesan en los mensajes los resultados de cada servidor MCP. Todo en tokens estimados (caracteres / 3,5).
// Node puro: sin Electron ni fs. El formato del transcript no es un contrato: lo que no se reconoce se saltea, nunca se inventa.

/** Caracteres por token para estimar texto de instrucciones (inglés y español mezclados, markdown): conservador. */
export const CHARS_POR_TOKEN = 3.5;
export const tokensAprox = (t: string) => Math.ceil(t.length / CHARS_POR_TOKEN);
const tokensDe = (chars: number) => Math.ceil(chars / CHARS_POR_TOKEN);

/** Cuánto texto de cada pieza viaja a la vista (para leerlo): el resto se corta y se avisa. */
export const TEXTO_MAX = 4000;

type J = Record<string, unknown>;
const obj = (x: unknown): x is J => !!x && typeof x === "object" && !Array.isArray(x);
const str = (x: unknown): string | null => (typeof x === "string" && x ? x : null);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const largo = (x: unknown): number => (typeof x === "string" ? x.length : x == null ? 0 : (JSON.stringify(x) ?? "").length);

/** `mcp__servidor__herramienta` → sus partes; `null` si no es de un MCP. */
export function partirMcp(nombre: string): { servidor: string; herramienta: string } | null {
  if (!nombre.startsWith("mcp__")) return null;
  const resto = nombre.slice(5);
  const i = resto.indexOf("__");
  return i <= 0 ? { servidor: resto, herramienta: "" } : { servidor: resto.slice(0, i), herramienta: resto.slice(i + 2) };
}

export type TipoSistema = "prompt" | "hook" | "diferidas" | "entorno";

/** Un pedazo del "sistema" de una sesión: lo que se pudo separar, con su peso estimado y, si hace falta, su texto. */
export type FilaSistema = {
  clave: string;
  tipo: TipoSistema;
  nombre: string;
  /** Un dato corto para distinguirla (de un hook, el evento). */
  detalle: string | null;
  tokens: number;
  estimado: true;
  /** El texto (recortado a `TEXTO_MAX`), para leerlo; `null` si no se guardó. */
  texto: string | null;
  /** El texto estaba cortado. */
  truncado: boolean;
};

export type HookSesion = { nombre: string; evento: string; comando: string; texto: string; veces: number; alInicio: boolean };

export type InfoSesion = {
  /** El prompt de sistema de Claude Code tal como se mandó (partes unidas); `null` si el transcript no lo trae. */
  prompt: string | null;
  /** Definiciones de herramientas del primer pedido (integradas y MCP ya cargadas), con su peso. `null`: este transcript no las trae. */
  herramientas: { nombre: string; tokens: number }[] | null;
  hooks: HookSesion[];
  /** Los nombres que se anunciaron como diferidos (sin definición). */
  diferidas: string[];
  /** Definiciones MCP que se fueron a buscar (ahora viajan enteras), por herramienta completa. */
  buscadas: { nombre: string; tokens: number }[];
  /** Los CLAUDE.md y la memoria que cargó al arrancar. `null`: el transcript no trae el adjunto. */
  instrucciones: { ruta: string; tipo: string | null; tokens: number }[] | null;
  /** Instrucciones de los servidores MCP (servidor normalizado → tokens). */
  mcpInstrucciones: Record<string, number>;
  agentes: number;
  entorno: number;
  /** Tokens (estimados) de los resultados de herramientas MCP que siguen en los mensajes, por servidor. */
  resultadosMcp: Record<string, number>;
};

const vacia = (): InfoSesion => ({ prompt: null, herramientas: null, hooks: [], diferidas: [], buscadas: [], instrucciones: null, mcpInstrucciones: {}, agentes: 0, entorno: 0, resultadosMcp: {} });

const normalizarServidor = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_");

/** El texto de un `tool_result` (un string o una lista de bloques de texto). */
const textoResultado = (c: unknown): number => (typeof c === "string" ? c.length : arr(c).reduce<number>((n, b) => n + (obj(b) ? largo(b.text) : 0), 0));

/** Lo que dice el transcript de la estructura de la sesión. Nunca tira: una línea rota se saltea. */
export function leerSesion(lineas: string[]): InfoSesion {
  const r = vacia();
  const usoDe = new Map<string, string>();
  const buscadas = new Map<string, number>();
  const diferidas = new Set<string>();
  let arranco = false;
  for (const l of lineas) {
    if (!l.startsWith("{")) continue;
    let o: J;
    try {
      const x = JSON.parse(l);
      if (!obj(x)) continue;
      o = x;
    } catch {
      continue;
    }
    if (o.isSidechain === true) continue;
    if (o.type === "api-request-shape" && r.herramientas === null && obj(o.shape)) {
      const sh = o.shape;
      const partes = arr(sh.system).map((s) => (obj(s) ? str(s.text) : null)).filter((s): s is string => !!s);
      if (partes.length && r.prompt === null) r.prompt = partes.join("\n");
      r.herramientas = arr(sh.tools)
        .filter(obj)
        .map((t) => ({ nombre: str(t.name) ?? "?", tokens: tokensDe(largo(t)) }));
      continue;
    }
    if (o.type === "system" && o.subtype === "compact_boundary") {
      // Tras compactar, los resultados viejos ya no están en la ventana.
      r.resultadosMcp = {};
      continue;
    }
    if (o.type === "assistant") {
      arranco = true;
      const m = obj(o.message) ? o.message : null;
      for (const b of arr(m?.content)) if (obj(b) && b.type === "tool_use" && str(b.id) && str(b.name)?.startsWith("mcp__")) usoDe.set(b.id as string, b.name as string);
      continue;
    }
    if (o.type === "user") {
      const m = obj(o.message) ? o.message : null;
      for (const b of arr(m?.content)) {
        if (!obj(b) || b.type !== "tool_result") continue;
        const nombre = usoDe.get(str(b.tool_use_id) ?? "");
        const p = nombre ? partirMcp(nombre) : null;
        if (p) r.resultadosMcp[p.servidor] = (r.resultadosMcp[p.servidor] ?? 0) + tokensDe(textoResultado(b.content));
      }
      continue;
    }
    if (o.type !== "attachment" || !obj(o.attachment)) continue;
    const a = o.attachment;
    switch (a.type) {
      case "prompt_snapshot": {
        // Sin el pedido (api-request-shape), el snapshot trae el prompt en partes.
        if (r.prompt === null) {
          const partes = arr(a.systemPrompt).filter((s): s is string => typeof s === "string" && s !== "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__");
          if (partes.length) r.prompt = partes.join("\n");
        }
        break;
      }
      case "instructions":
        if (r.instrucciones === null)
          r.instrucciones = arr(a.files)
            .filter(obj)
            .filter((f) => str(f.path))
            .map((f) => ({ ruta: f.path as string, tipo: str(f.type), tokens: tokensDe(largo(f.content)) }));
        break;
      case "hook_success": {
        const texto = str(a.content);
        if (!texto) break;
        const nombre = str(a.hookName) ?? str(a.hookEvent) ?? "hook";
        const comando = str(a.command) ?? "";
        const ya = r.hooks.find((h) => h.nombre === nombre && h.comando === comando && h.texto === texto);
        if (ya) ya.veces++;
        else r.hooks.push({ nombre, evento: str(a.hookEvent) ?? nombre.split(":")[0], comando, texto, veces: 1, alInicio: !arranco });
        break;
      }
      case "hook_additional_context": {
        const texto = arr(a.content).filter((x): x is string => typeof x === "string").join("\n");
        if (!texto) break;
        const nombre = str(a.hookName) ?? str(a.hookEvent) ?? "hook";
        const ya = r.hooks.find((h) => h.nombre === nombre && h.texto === texto);
        if (ya) ya.veces++;
        else r.hooks.push({ nombre, evento: str(a.hookEvent) ?? nombre.split(":")[0], comando: "", texto, veces: 1, alInicio: !arranco });
        break;
      }
      case "mcp_instructions_delta": {
        const bloques = arr(a.addedBlocks);
        arr(a.addedNames).forEach((n, i) => {
          if (typeof n === "string") {
            const s = normalizarServidor(n);
            r.mcpInstrucciones[s] = Math.max(r.mcpInstrucciones[s] ?? 0, tokensDe(largo(bloques[i])));
          }
        });
        for (const n of arr(a.removedNames)) if (typeof n === "string") delete r.mcpInstrucciones[normalizarServidor(n)];
        break;
      }
      case "deferred_tools_delta":
        for (const n of arr(a.addedNames)) if (typeof n === "string") diferidas.add(n);
        for (const n of arr(a.removedNames)) if (typeof n === "string") diferidas.delete(n);
        break;
      case "deferred_tools_record":
        for (const e of arr(a.entries).filter(obj)) {
          const n = str(e.name);
          if (n) buscadas.set(n, Math.max(buscadas.get(n) ?? 0, tokensDe(largo(e))));
        }
        break;
      case "agent_listing_delta":
        r.agentes += arr(a.addedLines).reduce<number>((n, x) => n + tokensDe(largo(x) + 1), 0);
        break;
      case "environment":
      case "date":
      case "model":
      case "session_context":
        if (!arranco) r.entorno += arr(o.rendered).reduce<number>((n, x) => n + tokensDe(obj(x) ? largo(x.content) : 0), 0);
        break;
      default:
        break;
    }
  }
  r.diferidas = [...diferidas];
  r.buscadas = [...buscadas].map(([nombre, tokens]) => ({ nombre, tokens }));
  return r;
}

const recorte = (t: string): { texto: string; truncado: boolean } => (t.length > TEXTO_MAX ? { texto: t.slice(0, TEXTO_MAX), truncado: true } : { texto: t, truncado: false });

/** Los hooks que cargaron texto al empezar la sesión, sin repetir los de cada mensaje (esos van a los mensajes). */
export const hooksDeInicio = (i: InfoSesion) => i.hooks.filter((h) => h.alInicio && h.evento !== "UserPromptSubmit");

/**
 * Las piezas del sistema que se pueden separar: el prompt de Claude Code, cada salida de hook de inicio, la lista de herramientas diferidas
 * y el entorno. Lo que no se separa queda en la diferencia con la categoría (la vista lo muestra como "sin separar").
 */
export function piezasSistema(i: InfoSesion): FilaSistema[] {
  const r: FilaSistema[] = [];
  if (i.prompt) r.push({ clave: "prompt", tipo: "prompt", nombre: "prompt", detalle: null, tokens: tokensAprox(i.prompt), estimado: true, ...rec(i.prompt) });
  for (const h of hooksDeInicio(i)) {
    r.push({ clave: `hook:${h.nombre}:${h.comando.slice(0, 40)}`, tipo: "hook", nombre: h.nombre, detalle: h.evento, tokens: tokensAprox(h.texto), estimado: true, ...rec(h.texto) });
  }
  if (i.diferidas.length) {
    const t = i.diferidas.join("\n");
    r.push({ clave: "diferidas", tipo: "diferidas", nombre: "diferidas", detalle: String(i.diferidas.length), tokens: tokensAprox(t), estimado: true, ...rec(t) });
  }
  if (i.entorno > 0) r.push({ clave: "entorno", tipo: "entorno", nombre: "entorno", detalle: null, tokens: i.entorno, estimado: true, texto: null, truncado: false });
  return r.filter((x) => x.tokens > 0);
}
const rec = (t: string) => {
  const c = recorte(t);
  return { texto: c.texto, truncado: c.truncado };
};

/** Reparte `tope` entre las piezas si juntas lo pasan (cada una se achica en la misma proporción): nunca suman más que su categoría. */
export function topar<T>(xs: T[], get: (x: T) => number, set: (x: T, n: number) => void, tope: number): void {
  const suma = xs.reduce((n, x) => n + get(x), 0);
  if (suma <= tope) return;
  const k = tope <= 0 ? 0 : tope / suma;
  for (const x of xs) set(x, Math.floor(get(x) * k));
}

/**
 * Las veces que un hook metió a cada skill en el contexto: la skill se nombra en lo que el hook mostró como cartel (su comando) o en el
 * comienzo de lo que devolvió ("CAVEMAN MODE ACTIVE"). Nombres de menos de 4 letras no se buscan (darían falsos).
 */
export function skillsPorHook(hooks: HookSesion[], nombres: string[]): Record<string, number> {
  const r: Record<string, number> = {};
  for (const n of nombres) {
    const corto = n.includes(":") ? n.slice(n.lastIndexOf(":") + 1) : n;
    if (corto.length < 4) continue;
    const parte = corto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[-_ ]+/g, "[-_ ]");
    const re = new RegExp(`(^|[^a-z0-9])${parte}([^a-z0-9]|$)`, "i");
    for (const h of hooks) if (re.test(`${h.nombre} ${h.comando} ${h.texto.slice(0, 200)}`)) r[n] = (r[n] ?? 0) + h.veces;
  }
  return r;
}
