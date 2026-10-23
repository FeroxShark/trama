// `pa --hilo <id> --json` → la forma de `Mensaje` (la misma que arma `conversacionDe`
// con el transcript de un líder, electron/lider-arma.ts). `pa` nombra distinto los
// campos del transcript (`resumen_compact`, `error_api`, `herramientas_det`) y pasa
// `compact_boundary` como `rol: "system"`. Puro: lo prueba `tests/pa-hilo.test.ts`.
import { CORTE } from "../hilo/herramientas.ts";
import type { Herramienta, Mensaje, RespuestaHilo } from "./contrato";

const SINTETICO = "<synthetic>";

function herramientasDe(x: unknown): Herramienta[] | undefined {
  if (!Array.isArray(x)) return undefined;
  return x
    .filter((d) => d && typeof d.nombre === "string")
    .map((d) => {
      const entrada = d.entrada && typeof d.entrada === "object" && !Array.isArray(d.entrada) ? (d.entrada as Record<string, unknown>) : {};
      // `pa` recorta cada texto de la entrada a 2000 caracteres: uno de ese largo vino recortado.
      const cortado = Object.values(entrada).some((v) => typeof v === "string" && v.length >= CORTE);
      // Los resultados no los trae `pa`: el main los pega leyendo el transcript (electron/hilo-resultados.ts).
      const r = d.resultado;
      const resultado = r && typeof r.texto === "string" ? { texto: r.texto, error: r.error === true } : null;
      return { nombre: d.nombre as string, entrada, ...(cortado ? { cortado } : {}), ...(typeof d.id === "string" ? { id: d.id } : {}), ...(resultado ? { resultado } : {}) };
    });
}

/** Un mensaje de `pa --hilo` como lo entiende la vista. */
export function mensajeDePa(m: any): Mensaje {
  const base = {
    i: m.i,
    texto: typeof m.texto === "string" ? m.texto : "",
    herramientas: Array.isArray(m.herramientas) ? m.herramientas : [],
    ts: m.ts ?? null,
    modelo: m.modelo ?? null,
  };
  if (m.rol === "system") {
    // Sólo `compact_boundary` (pa no pasa otros); sin `compactMetadata`: no se sabe si fue auto.
    return { ...base, rol: "assistant", texto: "", herramientas: [], compacto: { auto: null, antes: null } };
  }
  const out: Mensaje = { ...base, rol: m.rol === "user" ? "user" : "assistant" };
  if (m.meta === true) out.meta = true;
  if (m.resumen_compact === true || m.resumen === true) out.resumen = true;
  if (typeof m.origen === "string" && m.origen) out.origen = m.origen;
  // `error` va sólo en un sintético, como en `conversacionDe`: pa lo manda en `null` en todos.
  if (out.rol === "assistant" && (m.error_api === true || out.modelo === SINTETICO))
    out.error = typeof m.error === "string" && m.error ? m.error : m.error_api === true ? "unknown" : null;
  const det = herramientasDe(m.herramientas_det);
  if (det && det.length) out.det = det;
  if (m.compacto) out.compacto = m.compacto;
  return out;
}

/** La página entera (la versión la controla quien llama). */
export function hiloDePa(r: any): RespuestaHilo {
  return { ...r, mensajes: Array.isArray(r?.mensajes) ? r.mensajes.map(mensajeDePa) : [] };
}
