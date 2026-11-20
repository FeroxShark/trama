// El modo debate, la lógica de la ventana sin React (la prueba tests/debate-vista.test.ts): cuándo un debate sigue vivo, qué botones
// corresponden a cada fase, quién habla ahora, cuánto lleva y cuántas llamadas puede costar. Lo dibuja `TarjetaDebate.tsx`; el estado
// viene del main (electron/debate-trabajo.ts) por el evento `debate:turno` y vive en `debate-vivo.ts`.
import { parsearTurno, type EstadoDebate, type FaseDebate, type LineaDebate, type MotivoDebate, type ParticipanteVisto, type Postura } from "../../electron/debate-texto.ts";
import type { PasoRevision } from "../../electron/revision-plan-texto.ts";

/** ¿Sigue trabajando (los modelos, la conclusión o la entrega)? Mientras sí, no se puede lanzar otra revisión ni otro debate en ese chat. */
export const debateVivo = (e: Pick<EstadoDebate, "fase"> | null | undefined): boolean =>
  e?.fase === "corriendo" || e?.fase === "esperando" || e?.fase === "concluyendo" || e?.fase === "entregando";

/** Qué botones ofrece cada fase: «Cortar y concluir» sólo mientras se debate; «Cancelar» hasta que empieza la entrega (después ya no se puede). */
export function accionesDebate(fase: FaseDebate): { cortar: boolean; cancelar: boolean; ver: boolean; cerrar: boolean } {
  const debatiendo = fase === "corriendo" || fase === "esperando";
  return { cortar: debatiendo, cancelar: debatiendo || fase === "concluyendo", ver: fase === "hecho", cerrar: !debateVivo({ fase }) };
}

/** Cuánto lleva el debate: hasta ahora si sigue, hasta que terminó si no. */
export const duracionDebate = (e: Pick<EstadoDebate, "inicio" | "fin">, ahora: number): number => Math.max(0, (e.fin ?? ahora) - e.inicio);

/** Quién habla ahora: el primero de los que siguen que todavía no habló en esta ronda (`null`: nadie, o se está concluyendo). */
export function quienHabla(e: Pick<EstadoDebate, "fase" | "ronda" | "participantes">): ParticipanteVisto | null {
  if (e.fase !== "corriendo" || e.ronda < 1) return null;
  return e.participantes.find((p) => p.activo && p.turnos < e.ronda) ?? null;
}

/** El peor caso en llamadas a modelos: cada uno habla una vez por ronda (tope 3) y uno concluye. */
export const peorCasoLlamadas = (modelos: number, rondas: number): number => modelos * Math.min(3, rondas) + 1;

/** Cuánto falta para que la pregunta pendiente siga sin respuesta, en minutos (redondeado hacia arriba, nunca menos de 1). */
export const minutosQueFaltan = (hasta: number, ahora: number): number => Math.max(1, Math.ceil((hasta - ahora) / 60_000));

/** La clave de i18n de la frase que cuenta por qué terminó el debate. */
export const claveMotivo = (m: MotivoDebate | null): string => `debate.motivo.${m ?? "tope"}`;

// ───────────────────────── La mesa de columnas: una por modelo ─────────────────────────

/** En qué está una columna: la postura de su turno, o lo que hace mientras tanto. */
export type EstadoColumna = Postura | "escribiendo" | "espera" | "salio" | "sinTurno";

export type ColumnaDebate = {
  modelo: string;
  nombre: string;
  effort: string;
  /** La inicial del nombre, para el avatar. */
  inicial: string;
  estado: EstadoColumna;
  /** Lo que dijo (o lo que va saliendo, si está escribiendo). */
  texto: string;
  /** Lo que leyó: el paso más nuevo primero. */
  leyo: PasoRevision[];
  /** Lo que usó que no es una lectura (herramientas, skills), sin repetir. */
  uso: string[];
  /** Mientras escribe: el último archivo que está leyendo. */
  leyendo: PasoRevision | null;
  /** El plan que propone en este turno, si propone uno. */
  plan: string | null;
};

/** Lo que dijo un modelo, sin los encabezados: mientras llega a medias no se ven los títulos (`## Postura`) sino lo que argumenta. */
export function textoVivoLegible(crudo: string): string {
  const limpio = crudo.replace(/\r\n/g, "\n").trim();
  if (!limpio) return "";
  const leido = parsearTurno(limpio);
  if (leido.libre !== undefined) return leido.libre;
  return leido.argumento;
}

/** Las rondas que ya empezaron, para los chips de arriba («Ronda 1», «Ronda 2»); al menos la primera. */
export const rondasDebate = (e: Pick<EstadoDebate, "ronda" | "lineas">): number[] => {
  const hasta = Math.max(1, e.ronda, ...e.lineas.filter((l) => l.tipo === "turno").map((l) => l.ronda));
  return Array.from({ length: hasta }, (_, i) => i + 1);
};

/** La ronda que se mira por defecto: la que está en curso, o la última si el debate terminó. */
export const rondaVista = (e: Pick<EstadoDebate, "ronda" | "lineas">): number => rondasDebate(e).at(-1)!;

/**
 * Las columnas de la mesa para una ronda: una por modelo, en el orden en que hablan. Con el turno de esa ronda ya dicho muestra su
 * postura y su argumento; si está hablando, lo que va saliendo; si salió del debate, «salió»; si todavía no le toca, «espera».
 */
export function columnasDebate(e: Pick<EstadoDebate, "fase" | "ronda" | "participantes" | "lineas">, ronda: number): ColumnaDebate[] {
  const pasosDe = (l: LineaDebate | undefined, v: PasoRevision[] | undefined) => {
    const todos = [...(l?.pasos ?? v ?? [])].reverse();
    return {
      leyo: todos.filter((x) => x.k !== "otro"),
      uso: [...new Set(todos.filter((x) => x.k === "otro").map((x) => x.v))],
    };
  };
  return e.participantes.map((p) => {
    const l = e.lineas.find((x) => x.tipo === "turno" && x.modelo === p.modelo && x.ronda === ronda);
    const nombre = { modelo: p.modelo, nombre: p.nombre, effort: p.effort, inicial: [...p.nombre.trim()][0]?.toUpperCase() ?? "?" };
    if (l) return { ...nombre, estado: l.postura ?? "cambio", texto: l.argumento, ...pasosDe(l, undefined), leyendo: null, plan: l.plan };
    const concluye = e.fase === "concluyendo" && p.vivo !== undefined;
    if (p.vivo && (concluye || ronda === e.ronda)) {
      const { leyo, uso } = pasosDe(undefined, p.vivo.pasos);
      const ultimo = p.vivo.pasos.filter((x) => x.k !== "otro").at(-1) ?? null;
      return { ...nombre, estado: "escribiendo", texto: textoVivoLegible(p.vivo.texto), leyo, uso, leyendo: ultimo, plan: null };
    }
    const vacio = { texto: "", leyo: [], uso: [], leyendo: null, plan: null };
    if (!p.activo) return { ...nombre, ...vacio, estado: "salio" };
    return { ...nombre, ...vacio, estado: ronda < e.ronda || !debateVivo(e) ? "sinTurno" : "espera" };
  });
}

/** Una sección de la conclusión como renglones: viñetas si las trae, o el párrafo entero; «Ninguno» y parecidos no son renglones. */
export function renglones(texto: string | null | undefined): string[] {
  const t = (texto ?? "").replace(/\r\n/g, "\n").trim();
  if (!t || /^(?:[-*•]\s*)?(?:ning[uú]n[oa]s?|nada|n\/a|-|—)\.?$/i.test(t)) return [];
  const items = t.split("\n").filter((x) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(x)).map((x) => x.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim());
  return items.length ? items : [t.replace(/\s*\n\s*/g, " ")];
}

/** La primera oración de un argumento, recortada: lo que cada modelo aportó, en una línea. */
export function aporte(argumento: string, max = 160): string {
  const limpio = argumento.replace(/\s+/g, " ").trim();
  if (!limpio) return "";
  const corte = /^.+?[.!?](?=\s|$)/.exec(limpio)?.[0] ?? limpio;
  return corte.length > max ? `${corte.slice(0, max - 1).trimEnd()}…` : corte;
}

export type ResumenDebate = {
  /** Lo que quedó acordado. */
  acordado: string[];
  /** Lo que cada modelo dijo, en una línea (su último turno). */
  quien: { modelo: string; nombre: string; inicial: string; dijo: string }[];
  /** Lo que sigue sin acuerdo. */
  sinAcuerdo: string[];
  rondas: number;
  nombres: string[];
};

/** «Qué se acordó»: el resumen de un debate terminado, antes de aprobar el plan. `null` si no hay conclusión (cancelado, fallo, simple). */
export function resumenDebate(e: Pick<EstadoDebate, "fase" | "motivo" | "ronda" | "participantes" | "lineas">): ResumenDebate | null {
  if (e.fase !== "hecho" || e.motivo === "simple") return null;
  const c = e.lineas.findLast((l) => l.tipo === "conclusion");
  if (!c) return null;
  const quien = e.participantes.flatMap((p) => {
    const ultimo = e.lineas.findLast((l) => l.tipo === "turno" && l.modelo === p.modelo);
    const dijo = ultimo ? aporte(ultimo.argumento) : "";
    return dijo ? [{ modelo: p.modelo, nombre: p.nombre, inicial: [...p.nombre.trim()][0]?.toUpperCase() ?? "?", dijo }] : [];
  });
  return { acordado: renglones(c.argumento), quien, sinAcuerdo: renglones(c.desacuerdos), rondas: e.ronda, nombres: e.participantes.map((p) => p.nombre) };
}
