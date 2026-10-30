// Lo que gastó cada subagente que una sesión de Claude Code lanzó con su herramienta Agent (el panel de contexto, la burbuja de la
// llamada y Estadísticas lo muestran). Cada uno escribe su transcript en `<sesión>/subagents/agent-<id>.jsonl`; de ahí salen, exactos y
// sin estimar, los tokens que gastó (entrada, caché escrito, caché leído y salida: la suma del `usage` de cada pedido al modelo, una vez por
// mensaje) y lo que pesa su ventana en el último pedido. El desglose por categoría de un subagente (sistema, mensajes, herramientas…) sale
// de `contexto-desglose.ts` con las mismas líneas (`sinLado`). Node puro salvo `crearGastos`, que lee de a poco los archivos: lo prueba
// `tests/subagentes-gasto.test.ts`.
import { open, stat } from "node:fs/promises";
import path from "node:path";
import { leerCarpeta, modeloCorto, type EstadoSubagente, type Subagente } from "./subagentes.ts";

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

/** Une lo que se sabe de un subagente (su estado, su meta) con lo que gastó. */
export function gastoDe(u: Subagente, a: Acumulado): SubagenteGasto {
  const modeloId = a.modeloId;
  return {
    id: u.id,
    sid: u.sid,
    llamada: u.tool_use_id ?? null,
    descripcion: u.descripcion,
    tipo: u.tipo,
    modelo: modeloId ? modeloCorto(modeloId) : u.modelo,
    modeloId,
    estado: u.estado,
    inicio: u.inicio,
    ultimo_en: u.ultimo_en,
    tokens: a.tokens,
    pedidos: a.pedidos,
    herramientas: a.herramientas,
    contexto: a.contexto,
    ventana: ventanaSub(modeloId ?? u.modelo),
  };
}

export function juntar(sid: string, subagentes: SubagenteGasto[]): GastoSubagentes {
  return { version: 1, sid, subagentes, total: subagentes.reduce((n, s) => sumaTokens(n, s.tokens), vacioTokens()) };
}

/** La carpeta de los subagentes de una sesión a partir del transcript de la sesión. */
export const carpetaDeSubagentes = (transcript: string): string => path.join(transcript.replace(/\.jsonl$/, ""), "subagents");

type Leido = { leido: number; resto: string; acum: Acumulado };

/**
 * Lee de a poco: guarda lo sumado de cada archivo y, cuando crece, sólo lee lo que se agregó. Un archivo que se achicó (se rehízo) se
 * empieza de nuevo. Los archivos de subagentes pueden pesar muchos MB: releerlos enteros en cada refresco no va.
 */
export function crearGastos() {
  const leidos = new Map<string, Leido>();

  async function acumulado(archivo: string): Promise<Acumulado | null> {
    const s = await stat(archivo).catch(() => null);
    if (!s?.isFile()) return null;
    let x = leidos.get(archivo);
    if (!x || s.size < x.leido) leidos.set(archivo, (x = { leido: 0, resto: "", acum: new Acumulado() }));
    if (s.size > x.leido) {
      const fh = await open(archivo, "r");
      try {
        const buf = Buffer.alloc(s.size - x.leido);
        const { bytesRead } = await fh.read(buf, 0, buf.length, x.leido);
        x.leido += bytesRead;
        const trozos = (x.resto + buf.toString("utf8", 0, bytesRead)).split("\n");
        // La última puede estar a medio escribir: queda para la próxima.
        x.resto = trozos.pop() ?? "";
        for (const l of trozos) x.acum.linea(l);
      } finally {
        await fh.close();
      }
    }
    // Un tope: no se guardan archivos de sesiones que ya no se miran.
    if (leidos.size > 400) leidos.delete(leidos.keys().next().value as string);
    return x.acum;
  }

  return {
    /**
     * El gasto de cada subagente de `dir` (la carpeta `subagents/` de la sesión `sid`). `base`: la lista de subagentes que ya tiene el
     * main (con su estado al día); si falta, se lee de la carpeta.
     */
    async listar(dir: string, sid: string, base?: readonly Subagente[]): Promise<GastoSubagentes> {
      const lista = base?.length ? base : await leerCarpeta(dir, sid);
      const filas: SubagenteGasto[] = [];
      for (const u of lista) {
        const a = await acumulado(path.join(dir, `agent-${u.id}.jsonl`));
        if (a) filas.push(gastoDe(u, a));
      }
      return juntar(sid, filas);
    },
  };
}
