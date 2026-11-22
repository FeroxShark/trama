// El contexto real de una conversación de codex, leído de su archivo de sesión (el «rollout»).
//
// `codex exec --json` dice en `turn.completed.usage.input_tokens` lo ACUMULADO de todos los pedidos del turno (un worker terminó con
// 3 770 243 cuando su último pedido pesaba 127 650 en una ventana de 475 000): sirve de consumo, no de ocupación. El dato bueno está
// en `<CODEX_HOME>/sessions/AAAA/MM/DD/rollout-<fecha>-<thread_id>.jsonl`: cada `event_msg` con `payload.type === "token_count"` trae
// `info.last_token_usage.input_tokens` (lo que entró en el último pedido: el contexto) e `info.model_context_window` (la ventana real).
//
// Puro salvo el disco (inyectable, para probarlo sin tocar el de verdad). Lo usan procesos propios (el puente de codex y `pa --hilo`),
// no la ventana: por eso es síncrono, y barato: sólo lee la cola del archivo. Si no está el rollout, el contexto queda desconocido
// (`null`): nunca se cae al acumulado.

import { closeSync, fstatSync, openSync, readSync, readdirSync } from "node:fs";
import { caminoDe, homeDe, plataformaActual, type Plataforma } from "./rutas.ts";

type Env = Record<string, string | undefined>;

/** Lo que dice el último `token_count` del rollout. */
export type DatoRollout = {
  /** Lo que entró en el último pedido (con lo cacheado incluido): lo que pesa el contexto ahora. */
  contexto: number;
  /** Cuánto de eso estaba cacheado (0 si no se dice). */
  cacheado: number;
  /** Lo que salió en el último pedido (con el razonamiento). */
  salida: number;
  /** La ventana real del modelo (`model_context_window`), si la dice. */
  ventana: number | null;
};

/** El disco que lee `contextoDeThread` (lo mínimo; en los tests es uno en memoria). */
export type DiscoRollout = {
  /** Los nombres de una carpeta (`[]` si no existe). */
  listar(carpeta: string): string[];
  /** Los últimos `bytes` del archivo y si es el archivo entero; `null` si no se puede leer. */
  cola(archivo: string, bytes: number): { texto: string; entero: boolean } | null;
};

export type OpcionesRollout = { env?: Env; home?: string; plat?: Plataforma; disco?: DiscoRollout };

/** Cuánto se lee de la cola: lo normal alcanza (un `token_count` va después de cada pedido); si no hay, se amplía hasta el tope. */
const COLAS = [256 * 1024, 4 * 1024 * 1024];
/** Cuántas carpetas de día se miran, de la más nueva a la más vieja, antes de rendirse. */
const TOPE_DIAS = 400;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** La carpeta de codex: `CODEX_HOME` o `.codex` en el home (en Windows el home es `USERPROFILE`). */
export function carpetaCodex(env: Env = process.env, plat: Plataforma = plataformaActual(), home?: string): string {
  const c = caminoDe(plat);
  return env.CODEX_HOME || c.join(home ?? homeDe(env, plat), ".codex");
}

const discoReal: DiscoRollout = {
  listar(carpeta) {
    try {
      return readdirSync(carpeta);
    } catch {
      return [];
    }
  },
  cola(archivo, bytes) {
    let fd: number | null = null;
    try {
      fd = openSync(archivo, "r");
      const size = fstatSync(fd).size;
      const desde = Math.max(0, size - bytes);
      const buf = Buffer.alloc(size - desde);
      readSync(fd, buf, 0, buf.length, desde);
      return { texto: buf.toString("utf8"), entero: desde === 0 };
    } catch {
      return null;
    } finally {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          /* ya estaba cerrado */
        }
      }
    }
  },
};

const numerica = (n: string) => /^\d+$/.test(n);
const masNuevoPrimero = (a: string, b: string) => Number(b) - Number(a);

/** El archivo `rollout-*-<thread_id>.jsonl`, buscando de la fecha más nueva a la más vieja; `null` si no está. */
export function hallarRollout(threadId: string, o: OpcionesRollout = {}): string | null {
  if (!/^[0-9a-zA-Z-]{8,}$/.test(threadId)) return null;
  const plat = o.plat ?? plataformaActual();
  const env = o.env ?? process.env;
  const c = caminoDe(plat);
  const disco = o.disco ?? discoReal;
  const raiz = c.join(carpetaCodex(env, plat, o.home), "sessions");
  const final = `-${threadId}.jsonl`;
  let dias = 0;
  for (const anio of (disco.listar(raiz)).filter(numerica).sort(masNuevoPrimero)) {
    for (const mes of (disco.listar(c.join(raiz, anio))).filter(numerica).sort(masNuevoPrimero)) {
      for (const dia of (disco.listar(c.join(raiz, anio, mes))).filter(numerica).sort(masNuevoPrimero)) {
        if (++dias > TOPE_DIAS) return null;
        const carpeta = c.join(raiz, anio, mes, dia);
        const f = (disco.listar(carpeta)).find((n) => n.startsWith("rollout-") && n.endsWith(final));
        if (f) return c.join(carpeta, f);
      }
    }
  }
  return null;
}

/** El último `token_count` con datos de un texto de rollout (líneas JSONL; una cortada o rota se salta); `null` si no hay. */
export function ultimoTokenCount(texto: string): DatoRollout | null {
  const lineas = texto.split("\n");
  for (let i = lineas.length - 1; i >= 0; i--) {
    const l = lineas[i]!;
    if (!l.includes('"token_count"')) continue;
    let o: any;
    try {
      o = JSON.parse(l);
    } catch {
      continue;
    }
    if (o?.type !== "event_msg" || o.payload?.type !== "token_count") continue;
    const info = o.payload.info;
    const u = info?.last_token_usage;
    const contexto = num(u?.input_tokens);
    if (contexto === null) continue;
    return {
      contexto,
      cacheado: Math.min(num(u.cached_input_tokens) ?? 0, contexto),
      salida: num(u.output_tokens) ?? 0,
      ventana: num(info.model_context_window) || null,
    };
  }
  return null;
}

/** El archivo de rollout, leído por la cola: el último `token_count`; `null` si no se puede leer o todavía no hay ninguno. */
export function leerRollout(archivo: string, disco: DiscoRollout = discoReal): DatoRollout | null {
  for (const bytes of COLAS) {
    const c = disco.cola(archivo, bytes);
    if (!c) return null;
    const d = ultimoTokenCount(c.entero ? c.texto : c.texto.slice(c.texto.indexOf("\n") + 1));
    if (d || c.entero) return d;
  }
  return null;
}

/**
 * El contexto de la conversación `threadId` de codex: lo del último pedido del rollout. `null` (desconocido) si no hay `thread_id`,
 * no se encuentra el archivo o no tiene ningún `token_count`: nunca el acumulado de `turn.completed`. No lanza.
 */
export function contextoDeThread(threadId: string | null | undefined, o: OpcionesRollout = {}): DatoRollout | null {
  if (!threadId) return null;
  try {
    const archivo = hallarRollout(threadId, o);
    return archivo ? leerRollout(archivo, o.disco ?? discoReal) : null;
  } catch {
    return null;
  }
}
