// Ajustes > Modelos > «Modelos para workers»: la tabla de `reparto --tabla --json` (todos los modelos que reparto conoce, con su
// inteligencia, si son gratis, el cupo libre y cuándo se reinicia, y si modelos.json los permite). Es EL lector de esa salida;
// el puntaje no se recalcula acá: lo que se muestra sale de las mismas funciones que `reparto --tipo`. Node puro.
import { homedir } from "node:os";
import { entornoPa, lanzarCmd, resolverComando } from "./binario.ts";

/** Una ventana de cupo de un modelo: cuánto queda libre (0..100) y cuándo vuelve (epoch ms, `null`: no se sabe). */
export type VentanaTabla = { id: string; libre: number; vuelve: number | null };

export const ORIGENES_CALIDAD = ["usuario", "artificial-analysis", "defecto", "estimada"] as const;
export type OrigenCalidad = (typeof ORIGENES_CALIDAD)[number];

export type FilaTabla = {
  id: string;
  nombre: string;
  /** `claude`, `google`, `openai`, `opencode`, `ollama`, `deepseek` o `local`. */
  proveedor: string;
  /** La familia de reparto (`opus`, `sonnet`, `flash`, `dsh`, `local`…): la clave de `calidad` de los modelos de Claude, Google y ChatGPT. */
  familia: string;
  /** La familia con la que `excluir` compara este id (`opencode` para los de OpenCode, `dsh`, `local`, o la misma `familia`). */
  familiaExcluir: string;
  /** La cuenta cuando hay varias del mismo proveedor; `null` si no aplica. */
  cuenta: string | null;
  /** Inteligencia 0–100 y si es una estimación por el nombre (nadie la fijó en `calidad`). */
  calidad: number;
  /** Inteligencia por effort (`low`…`max`) donde se conoce (Artificial Analysis o el dueño); `{}` si no hay desglose. `calidad` es la mejor. */
  calidadPorEffort: Partial<Record<EffortCalidad, number>>;
  estimada: boolean;
  /** De dónde sale la cifra (`reparto` ya aplicó la precedencia): lo que fijó el dueño, Artificial Analysis, los defaults o la estimación por el nombre. */
  origen: OrigenCalidad;
  /** Día (`AAAA-MM-DD`) en que se bajó el dato de Artificial Analysis; sólo con `origen` `artificial-analysis`. */
  aaFecha: string | null;
  gratis: boolean;
  /** El cupo libre más ajustado (0..100) y cuándo vuelve; `null`: sin dato (o no tiene cupo que agotar). */
  libre: number | null;
  vuelve: number | null;
  ventanas: VentanaTabla[];
  /** 0..1: cuánto cupo libre se pierde pronto si no se usa. */
  urgencia: number;
  /** Ninguna regla de `excluir` lo saca. */
  permitido: boolean;
  /** La regla de `excluir` que lo saca (`opus`, el id exacto, `agy:*`…). */
  excluidoPor: string | null;
  agotado: boolean;
};

import { EFFORTS_CALIDAD, type EffortCalidad } from "./efforts-calidad.ts";
export { EFFORTS_CALIDAD, type EffortCalidad };

export type TablaReparto = { version: 1; leido: number; modelos: FilaTabla[] };

const texto = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pct = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.max(0, Math.min(100, Math.round(n * 100)));
};
const iso = (v: unknown): number | null => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};

const porEffort = (v: unknown): Partial<Record<EffortCalidad, number>> => {
  const out: Partial<Record<EffortCalidad, number>> = {};
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  for (const e of EFFORTS_CALIDAD) {
    const n = num(o[e]);
    if (n !== null) out[e] = Math.max(0, Math.min(100, Math.round(n)));
  }
  return out;
};

/** Parsea la salida de `reparto --tabla --json`; `null` si no es el contrato (JSON roto, otra versión, un `reparto` viejo). */
export function parsearTabla(salida: string, ahoraMs = Date.now()): TablaReparto | null {
  let raw: unknown;
  try {
    raw = JSON.parse(salida);
  } catch {
    return null;
  }
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || r.version !== 1 || !Array.isArray(r.modelos)) return null;
  const modelos: FilaTabla[] = [];
  for (const x of r.modelos) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const id = texto(o.id);
    const calidad = num(o.calidad);
    if (!id || calidad === null) continue;
    const ventanas: VentanaTabla[] = [];
    if (Array.isArray(o.ventanas)) {
      for (const w of o.ventanas) {
        const wo = w as Record<string, unknown> | null;
        const libre = pct(wo?.libre);
        if (wo && texto(wo.id) && libre !== null) ventanas.push({ id: texto(wo.id), libre, vuelve: iso(wo.vuelve) });
      }
    }
    modelos.push({
      id,
      nombre: texto(o.nombre) || id,
      proveedor: texto(o.proveedor) || "otro",
      familia: texto(o.familia),
      familiaExcluir: texto(o.familia_excluir) || texto(o.familia),
      cuenta: texto(o.cuenta) || null,
      calidad: Math.max(0, Math.min(100, Math.round(calidad))),
      calidadPorEffort: porEffort(o.calidad_por_effort),
      estimada: o.estimada === true,
      origen: (ORIGENES_CALIDAD as readonly string[]).includes(texto(o.origen)) ? (texto(o.origen) as OrigenCalidad) : o.estimada === true ? "estimada" : "defecto",
      aaFecha: /^\d{4}-\d{2}-\d{2}/.test(texto(o.aa_fecha)) ? texto(o.aa_fecha).slice(0, 10) : null,
      gratis: o.gratis === true,
      libre: pct(o.cupo_libre),
      vuelve: iso(o.vuelve),
      ventanas,
      urgencia: num(o.urgencia) ?? 0,
      permitido: o.permitido !== false,
      excluidoPor: texto(o.excluido_por) || null,
      agotado: o.agotado === true,
    });
  }
  return { version: 1, leido: iso(r.leido) ?? ahoraMs, modelos };
}

/** Corre `reparto --tabla --json`; `null` si no hay `reparto` (o es uno viejo que no conoce `--tabla`): el panel muestra el aviso. */
export async function leerTabla(): Promise<TablaReparto | null> {
  // Como los cupos: en pruebas, capturas y bench no se mira el `reparto` de la máquina (salvo que el test ponga uno falso).
  const aislado = process.env.HILOS_PRUEBA === "1" || process.env.HILOS_CAPTURA === "1" || process.env.HILOS_BENCH === "1";
  if (aislado && !process.env.HILOS_REPARTO) return null;
  try {
    const env = entornoPa(process.env, homedir()) as NodeJS.ProcessEnv;
    const cmd = resolverComando("reparto", "HILOS_REPARTO", process.env, homedir());
    const stdout = await new Promise<string>((ok, mal) => lanzarCmd(cmd, ["--tabla", "--json"], { env, timeout: 15000, maxBuffer: 2 * 1024 * 1024 }, (e, o) => (e ? mal(e) : ok(o))));
    return parsearTabla(stdout);
  } catch {
    return null;
  }
}

/**
 * El lector de la tabla que usa el panel: devuelve la tabla de la caché de Artificial Analysis que ya hay, sin esperar a que se
 * refresque. Si la caché venció, `refrescar` corre de fondo (una sola a la vez aunque abran el panel varias veces) y, si bajó datos
 * nuevos, `alRefrescar` avisa para que el panel vuelva a pedir la tabla. Un fallo del refresco no rompe nada: queda la caché de antes.
 */
export function crearLectorTabla(d: {
  leer: () => Promise<TablaReparto | null>;
  refrescar: () => Promise<{ ok: boolean; vigente?: boolean } | null | undefined>;
  alRefrescar: () => void;
}): () => Promise<TablaReparto | null> {
  let enCurso: Promise<void> | null = null;
  return () => {
    enCurso ??= (async () => {
      try {
        const r = await d.refrescar();
        if (r && r.ok && r.vigente === false) d.alRefrescar();
      } catch {
        /* sin red, sin key, límite diario: se sigue con lo que hay */
      } finally {
        enCurso = null;
      }
    })();
    return d.leer();
  };
}
