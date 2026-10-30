// Lo que gastó cada subagente que una sesión de Claude Code lanzó con su herramienta Agent (el panel de contexto, la burbuja de la
// llamada y Estadísticas lo muestran). Cada uno escribe su transcript en `<sesión>/subagents/agent-<id>.jsonl`; de ahí salen, exactos y
// sin estimar, los tokens que gastó (entrada, caché escrito, caché leído y salida: la suma del `usage` de cada pedido al modelo, una vez por
// mensaje) y lo que pesa su ventana en el último pedido. El desglose por categoría de un subagente (sistema, mensajes, herramientas…) sale
// de `contexto-desglose.ts` con las mismas líneas (`sinLado`). Node puro, sin fs (lo importa también la interfaz): lo de leer los archivos está en
// subagentes-gasto-disco.ts. Lo prueba `tests/subagentes-gasto.test.ts`.
import type { EstadoSubagente } from "./subagentes.ts";

export type GastoTokens = { entrada: number; cacheCreado: number; cacheLeido: number; salida: number; total: number };

export type SubagenteGasto = {
  id: string;
  /** La sesión que lo lanzó. */
  sid: string;
  /** El `tool_use_id` de la llamada Agent que lo lanzó (de su `.meta.json`): con él la burbuja de la conversación lo encuentra. `null`: no se sabe. */
  llamada: string | null;
  descripcion: string;
  /** El tipo de agente ("general-purpose", "Explore"…), si lo dice. */
  tipo: string | null;
  /** Lindo ("Haiku 5.5"); `null` si todavía no contestó nadie. */
  modelo: string | null;
  /** El id crudo del último modelo que contestó ("claude-haiku-5-5"). */
  modeloId: string | null;
  estado: EstadoSubagente;
  inicio: number;
  ultimo_en: number;
  /** Todo lo que gastó en toda su vida. */
  tokens: GastoTokens;
  /** Pedidos al modelo y herramientas que llamó. */
  pedidos: number;
  herramientas: number;
  /** Lo que pesa su ventana en su último pedido (entrada + caché); `null` si no hizo ninguno. */
  contexto: number | null;
  /** La ventana de su modelo (la de siempre: 200 mil en Haiku, 1 millón en los demás). */
  ventana: number;
};

export type GastoSubagentes = {
  version: 1;
  sid: string;
  /** Los más nuevos primero. */
  subagentes: SubagenteGasto[];
  /** Lo gastado por todos juntos. */
  total: GastoTokens;
};

const vacioTokens = (): GastoTokens => ({ entrada: 0, cacheCreado: 0, cacheLeido: 0, salida: 0, total: 0 });
const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : 0);

export const sumaTokens = (a: GastoTokens, b: GastoTokens): GastoTokens => ({
  entrada: a.entrada + b.entrada,
  cacheCreado: a.cacheCreado + b.cacheCreado,
  cacheLeido: a.cacheLeido + b.cacheLeido,
  salida: a.salida + b.salida,
  total: a.total + b.total,
});

/** La ventana de un modelo cuando nadie la dice: 200 mil en Haiku, 1 millón en los demás. */
export const ventanaSub = (modelo: string | null | undefined): number => (/haiku/i.test(modelo ?? "") ? 200_000 : 1_000_000);

/** Lo que se va sumando de un transcript de subagente, línea por línea. */
export class Acumulado {
  tokens = vacioTokens();
  pedidos = 0;
  herramientas = 0;
  contexto: number | null = null;
  modeloId: string | null = null;
  private vistos = new Set<string>();

  /** Una línea del `.jsonl`; lo que no se reconoce se saltea. */
  linea(l: string): void {
    if (!l.includes('"usage"')) return;
    let o: any;
    try {
      o = JSON.parse(l);
    } catch {
      return;
    }
    const m = o?.type === "assistant" ? o.message : null;
    if (!m || typeof m !== "object") return;
    if (Array.isArray(m.content)) for (const b of m.content) if (b?.type === "tool_use") this.herramientas++;
    const u = m.usage;
    if (!u || typeof u !== "object") return;
    // Un mensaje con varios bloques se escribe en varias líneas con el mismo id y el mismo usage: cuenta una vez.
    const id = typeof m.id === "string" ? m.id : null;
    if (id) {
      if (this.vistos.has(id)) return;
      this.vistos.add(id);
    }
    const entrada = num(u.input_tokens);
    const cacheCreado = num(u.cache_creation_input_tokens);
    const cacheLeido = num(u.cache_read_input_tokens);
    const salida = num(u.output_tokens);
    const peso = entrada + cacheCreado + cacheLeido;
    if (peso + salida <= 0) return;
    this.tokens = sumaTokens(this.tokens, { entrada, cacheCreado, cacheLeido, salida, total: peso + salida });
    this.pedidos++;
    if (peso > 0) this.contexto = peso;
    if (typeof m.model === "string" && m.model && !m.model.startsWith("<")) this.modeloId = m.model;
  }
}

/** Las líneas de un subagente sin la marca de "subagente" (`isSidechain`): para que el desglose por categoría las lea como una sesión. */
export const sinLado = (lineas: string[]): string[] => lineas.map((l) => (l.includes('"isSidechain":true') ? l.replace('"isSidechain":true', '"isSidechain":false') : l));

export function juntar(sid: string, subagentes: SubagenteGasto[]): GastoSubagentes {
  return { version: 1, sid, subagentes, total: subagentes.reduce((n, s) => sumaTokens(n, s.tokens), vacioTokens()) };
}
