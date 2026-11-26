// Sólo-TS (el bash está congelado). Un worker que deja una tarea de fondo corriendo y da su respuesta final vuelve a
// despertar cuando esa tarea termina: `claude -p --output-format json` imprime entonces SÓLO el último `result`
// (`result_index` > 0, `origin.kind` = "task-notification"), con los turnos y la duración de ese mini-turno y un RESULTADO
// que suele decir «nada nuevo; vale lo informado antes». Medido el 2026-11-22: una corrida de 2260 s y 14 commits quedó
// anotada con 1 turno, 2 s y «SIN VERIFICAR». Acá se corrige el `.json` con lo que dice el transcript de toda la corrida.
import { readFileSync, writeFileSync } from "node:fs";
import { campoDe, leerSalida, textoResultado, verificadoDe } from "./resultado-lanzar.ts";

type Obj = Record<string, unknown>;

/** ¿El `.json` final es de un turno que despertó solo después de la respuesta final? */
export function esDespertar(j: Obj | null): boolean {
  if (!j) return false;
  const i = j.result_index;
  if (typeof i === "number" && i > 0) return true;
  const o = j.origin;
  return Boolean(o && typeof o === "object" && (o as Obj).kind === "task-notification");
}

/** Lo que el transcript dice de la corrida desde `desdeMs`: turnos, duración y los textos del worker que traen un RESULTADO. */
export interface ResumenCorrida {
  turnos: number;
  duracionMs: number;
  /** En orden: el último es el más nuevo. */
  resultados: string[];
}

/** Lee el transcript (jsonl de la sesión). null si no se puede leer o no trae nada del worker. */
export function resumenTranscript(f: string, desdeMs = 0): ResumenCorrida | null {
  let texto: string;
  try {
    texto = readFileSync(f, "utf8");
  } catch {
    return null;
  }
  // un mensaje del asistente se guarda en varias líneas (una por bloque) con el mismo id: se cuenta una vez
  const porId = new Map<string, string>();
  let primero = 0;
  let ultimo = 0;
  for (const linea of texto.split("\n")) {
    if (!linea.includes('"timestamp"')) continue;
    let e: Obj;
    try {
      e = JSON.parse(linea) as Obj;
    } catch {
      continue;
    }
    if (e.isSidechain === true) continue;
    const t = typeof e.timestamp === "string" ? Date.parse(e.timestamp) : NaN;
    if (!Number.isFinite(t) || t < desdeMs) continue;
    if (e.type !== "assistant" && e.type !== "user") continue;
    if (!primero) primero = t;
    ultimo = t;
    if (e.type !== "assistant") continue;
    const m = e.message as Obj | undefined;
    const id = typeof m?.id === "string" ? m.id : "";
    if (!id) continue;
    const c = m?.content;
    const bloques = Array.isArray(c) ? (c as Obj[]) : [];
    const txt = bloques.map((b) => (b.type === "text" && typeof b.text === "string" ? b.text : "")).join("");
    porId.set(id, (porId.get(id) ?? "") + txt);
  }
  if (!porId.size) return null;
  const resultados = [...porId.values()].map((s) => s.replace(/\n+$/, "")).filter((s) => s.includes("RESULTADO:"));
  return { turnos: porId.size, duracionMs: Math.max(0, ultimo - primero), resultados };
}

/**
 * Corrige el `.json` de una corrida que despertó sola: turnos y duración de toda la corrida y, si el último RESULTADO no trae
 * verificación y uno anterior sí, vuelve ese (con lo que el worker agregó al despertar en una línea al final). Lo que había
 * queda en `despertar`. Devuelve true si escribió. Nunca tira: sin transcript, el `.json` queda como estaba.
 */
export function corregirDespertar(out: string, transcript: string, desdeMs = 0): boolean {
  const j = leerSalida(out);
  if (!j || !esDespertar(j) || j.despertar !== undefined) return false;
  const r = transcript ? resumenTranscript(transcript, desdeMs) : null;
  if (!r) return false;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  const nuevo: Obj = { ...j, despertar: { num_turns: j.num_turns ?? null, duration_ms: j.duration_ms ?? null } };
  nuevo.num_turns = Math.max(num(j.num_turns), r.turnos);
  nuevo.duration_ms = Math.max(num(j.duration_ms), r.duracionMs);
  const actual = textoResultado(j);
  if (!verificadoDe(actual)) {
    const previo = [...r.resultados].reverse().find((s) => s !== actual && verificadoDe(s));
    if (previo) {
      // sólo el RESULTADO del despertar, en una línea y sin encabezados: los campos (DECISION, SIGUE…) son los del anterior
      const agrego = campoDe("RESULTADO", actual).replace(/\s+/g, " ");
      nuevo.result = previo + (agrego ? `\n\n— Después de este resultado el worker despertó por una tarea de fondo y agregó: ${agrego}` : "");
    }
  }
  try {
    writeFileSync(out, JSON.stringify(nuevo, null, 2) + "\n");
  } catch {
    return false;
  }
  return true;
}
