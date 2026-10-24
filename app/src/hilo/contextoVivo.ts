// Lo que sabe el anillo de contexto (B16) de cada líder: el `usage` del último
// mensaje (del stream mientras responde; del transcript al releerlo), cuántas
// veces compactó y la ventana que dijo cada modelo. Vive fuera de la vista y
// avisa por frame, sólo cuando cambia algo: la salida que va llegando con cada
// delta se guarda aparte y entra al cerrar el turno, así el anillo no repinta
// con el streaming. También el umbral: `autoCompactWindow`.
import type { EventoLider, RespuestaHilo, Tokens } from "../datos/contrato";
import { fuente, type Umbrales } from "../datos/fuente";

export type ContextoVivo = {
  /** `null`: todavía no se sabe (líder nuevo, o recién compactó). */
  usage: Tokens | null;
  compactaciones: number;
  /** modelo → ventana de contexto, como la dijo el `result`. */
  ventanas: Record<string, number> | null;
};

const VACIO: ContextoVivo = { usage: null, compactaciones: 0, ventanas: null };

const estados = new Map<string, ContextoVivo>();
/** Los tokens de salida del mensaje que corre (no repintan: entran con el `fin`). */
const salidas = new Map<string, number>();
const oyentes = new Map<string, Set<() => void>>();
const sucios = new Set<string>();
let cuadro = 0;

function avisar(sid: string) {
  sucios.add(sid);
  if (cuadro) return;
  cuadro = requestAnimationFrame(() => {
    cuadro = 0;
    const ss = [...sucios];
    sucios.clear();
    for (const s of ss) oyentes.get(s)?.forEach((f) => f());
  });
}

const CAMPOS = ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"] as const;
const igualUso = (a: Tokens | null, b: Tokens | null) => a === b || (!!a && !!b && CAMPOS.every((k) => (a[k] ?? 0) === (b[k] ?? 0)));
const igualEntrada = (a: Tokens | null, b: Tokens | null) => !!a && !!b && CAMPOS.slice(0, 3).every((k) => (a[k] ?? 0) === (b[k] ?? 0));
const igualVentanas = (a: Record<string, number> | null, b: Record<string, number>) =>
  !!a && Object.keys(a).length === Object.keys(b).length && Object.entries(b).every(([k, v]) => a[k] === v);

/** Cambia el estado si `f` devuelve otro objeto; sólo entonces avisa. */
function cambiar(sid: string, f: (e: ContextoVivo) => ContextoVivo) {
  const e = estados.get(sid) ?? VACIO;
  const x = f(e);
  if (x === e) return;
  estados.set(sid, x);
  avisar(sid);
}

function alEvento(sid: string, ev: EventoLider) {
  switch (ev.tipo) {
    case "contexto":
      if (ev.usage) salidas.set(sid, ev.usage.output_tokens ?? 0);
      return cambiar(sid, (e) => {
        const usage = ev.usage && !igualUso(e.usage, ev.usage) ? ev.usage : e.usage;
        const ventanas = ev.ventanas && !igualVentanas(e.ventanas, ev.ventanas) ? ev.ventanas : e.ventanas;
        return usage === e.usage && ventanas === e.ventanas ? e : { ...e, usage, ventanas };
      });
    case "tokens":
      // El total (acumulado) del mensaje que corre: se anota sin avisar.
      if (!ev.nuevo) salidas.set(sid, ev.salida);
      return;
    case "aviso":
      // Compactó: lo que pesaba ya no vale; el mensaje que sigue trae el peso nuevo.
      if (ev.aviso.clase === "compacto") {
        salidas.delete(sid);
        cambiar(sid, (e) => ({ ...e, usage: null, compactaciones: e.compactaciones + 1 }));
      }
      return;
    case "fin":
    case "salio": {
      const salida = salidas.get(sid);
      salidas.delete(sid);
      if (salida === undefined) return;
      return cambiar(sid, (e) => (e.usage && (e.usage.output_tokens ?? 0) !== salida ? { ...e, usage: { ...e.usage, output_tokens: salida } } : e));
    }
  }
}

let suscripto = false;

/** Empezar a escuchar (al cargar el módulo: los eventos de un líder nuevo llegan antes que su vista). */
export function escucharContexto() {
  if (suscripto) return;
  suscripto = true;
  fuente.alEventoLider(alEvento);
}

/** Lo que hay de un líder (el mismo objeto mientras no cambie). */
export const contextoDe = (sid: string): ContextoVivo => estados.get(sid) ?? VACIO;

/** Para `useSyncExternalStore`. */
export function suscribirContexto(sid: string, fn: () => void) {
  escucharContexto();
  let s = oyentes.get(sid);
  if (!s) oyentes.set(sid, (s = new Set()));
  s.add(fn);
  return () => void s.delete(fn);
}

/**
 * Se releyó el transcript de un líder: manda lo que dice (el `usage` de su
 * último mensaje y cuántas veces compactó). Si compactó después de ese
 * mensaje (`compactada`), el `usage` es de antes y no cuenta.
 */
export function transcriptLeido(sid: string, r: Pick<RespuestaHilo, "usage" | "compactaciones" | "compactada">) {
  if (!sid) return;
  cambiar(sid, (e) => {
    // Mismo mensaje que el del stream, o un transcript que todavía no lo tiene:
    // se queda el del stream (su salida es la final).
    const usage = r.compactada ? null : !r.usage || igualEntrada(e.usage, r.usage) ? e.usage : r.usage;
    // Nunca baja: una lectura vieja del transcript no desdice al stream.
    const compactaciones = Math.max(e.compactaciones, r.compactaciones ?? 0);
    return usage === e.usage && compactaciones === e.compactaciones ? e : { ...e, usage, compactaciones };
  });
}

// --- El umbral de autocompact ---------------------

const SIN_UMBRALES: Umbrales = { autoCompact: null };
let umbrales = SIN_UMBRALES;
const oyentesUmbral = new Set<() => void>();

export const umbralLeido = (): Umbrales => umbrales;

export function suscribirUmbral(fn: () => void) {
  oyentesUmbral.add(fn);
  return () => void oyentesUmbral.delete(fn);
}

/** Relee los umbrales (al montar el anillo y al abrir su detalle; nunca por timer). */
export function leerUmbral() {
  void fuente.umbralContexto().then((u) => {
    if (u.autoCompact === umbrales.autoCompact) return;
    umbrales = u;
    oyentesUmbral.forEach((f) => f());
  });
}
