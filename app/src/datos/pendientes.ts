// El tablero nuevo (docs/estado/tablero-nuevo.md): lo que le toca al usuario, por proyecto. Sale de la columna
// `espera-dueno` del tablero (src/datos/tablero.ts), agrupada por proyecto y nunca mezclada entre proyectos:
// cada item es una pregunta (con botones, si el worker dejó opciones, y siempre un campo libre) o una prueba
// (Anda / No anda). Puro y con extensión en los imports: lo prueba `node --test` (tests/pendientes.test.ts).
import { deDueno } from "./dueno.ts";
import type { RespuestaCli } from "../../electron/tablero.ts";
import type { Item, ItemId, Respuesta, Tablero } from "./tablero.ts";

export type OpcionPend = { id: string; texto: string };
/** Un item de `espera-dueno` como lo ve el usuario: palabras simples si el item las trae, y título y detalle cortos si no. */
export type Pend = {
  id: ItemId;
  tipo: "pregunta" | "prueba";
  titulo: string;
  contexto: string;
  /** Los botones; sin ellos (un item viejo) sólo hay campo libre. */
  opciones: OpcionPend[];
  /** El id de la opción que el worker sugiere: se marca como sugerida, pero no cuenta hasta que el usuario la toca. */
  porDefecto: string | null;
  /** Comando o nombre exacto de lo que hay que probar (vacío en una pregunta). */
  que: string;
  /** Lo que el usuario ya mandó (`tablero responder`): el item sigue en `espera-dueno` hasta que el líder lo cierra. */
  respuesta: Respuesta | null;
  item: Item;
};
export type ProyectoPend = {
  /** Como lo nombra el tablero ("" = sin proyecto). */
  nombre: string;
  /** Horas desde el último movimiento del proyecto (ver `movimiento`). */
  hace: number;
  /** Lo que espera al usuario, sin respuesta. */
  preguntas: Pend[];
  pruebas: Pend[];
  /** Lo que ya contestó y mandó, lo más nuevo primero: no cuenta en "Te esperan". */
  mandadas: Pend[];
};

/** Lo que el usuario tocó en una pregunta: una opción, o `"otra"` con su texto; `null`, sin tocar. */
export type RespPregunta = { op: string | null; otra: string };
export type RespPrueba = { res: "anda" | "no-anda" | null; nota: string };
/** Por id de item. Sólo lo que el usuario TOCÓ: la opción sugerida no figura hasta que la marca. */
export type Respuestas = { q: Record<string, RespPregunta>; p: Record<string, RespPrueba> };

export const OTRA = "otra";
/** Sin movimiento desde hace tanto (horas), un proyecto está parado (decisión del usuario del 2026-10-14: 7 días). */
export const PARADO_H = 7 * 24;
/** Lo más largo que se muestra de un título o de un detalle de un item que no trae palabras simples. */
export const TITULO_MAX = 110;
export const CONTEXTO_MAX = 220;

const HORA_MS = 3_600_000;

/** Una línea, sin espacios de más, cortada en un borde de palabra con `…`. */
export function corto(texto: string, max: number): string {
  const t = texto.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cortado = t.slice(0, max);
  const espacio = cortado.lastIndexOf(" ");
  return `${(espacio > max * 0.6 ? cortado.slice(0, espacio) : cortado).replace(/[\s,;:.-]+$/, "")}…`;
}

export function desdeItem(i: Item): Pend {
  return {
    id: i.id,
    tipo: i.tipo,
    titulo: i.tituloSimple.trim() || corto(i.titulo, TITULO_MAX),
    contexto: i.contexto.trim() || corto(i.detalle, CONTEXTO_MAX),
    opciones: i.tipo === "pregunta" ? i.opciones.map((o) => ({ id: o.id, texto: o.texto })) : [],
    porDefecto: i.tipo === "pregunta" && i.opciones.some((o) => o.id === i.porDefecto) ? i.porDefecto : null,
    que: i.tipo === "prueba" ? i.prueba.trim() : "",
    respuesta: i.respuesta,
    item: i,
  };
}

/**
 * Cuándo se movió un proyecto por última vez (epoch en ms): lo más nuevo entre lo último que se tocó o
 * se cerró de sus items y el último commit de su repo (`tablero proyectos`, en días: sin hora). `null`: nada.
 */
export function movimiento(nombre: string, t: Tablero, ahora: number): number | null {
  let ultimo: number | null = null;
  const ver = (ms: number) => {
    if (Number.isFinite(ms) && ms <= ahora && (ultimo === null || ms > ultimo)) ultimo = ms;
  };
  for (const col of Object.values(t.columnas))
    for (const i of col) if (i.proyecto === nombre) ver(Date.parse(i.tocado) || Date.parse(i.creado));
  for (const i of t.hecho) if (i.proyecto === nombre) ver(Date.parse(i.cerrado ?? "") || Date.parse(i.tocado));
  const dias = t.proyectos.find((p) => p.proyecto === nombre)?.dias;
  if (typeof dias === "number") ver(ahora - dias * 24 * HORA_MS);
  return ultimo;
}

/** Los proyectos con algo en `espera-dueno`, cada uno con lo suyo (el orden es el de `ordenar`). */
export function armarProyectos(t: Tablero, ahora: number): ProyectoPend[] {
  const por = new Map<string, Pend[]>();
  for (const i of t.columnas["espera-dueno"]) por.set(i.proyecto, [...(por.get(i.proyecto) ?? []), desdeItem(i)]);
  return [...por].map(([nombre, ps]) => {
    const ms = movimiento(nombre, t, ahora);
    return {
      nombre,
      // Sin ningún dato cuenta como parado: no hay con qué decir que se movió.
      hace: ms === null ? PARADO_H : Math.max(0, (ahora - ms) / HORA_MS),
      preguntas: ps.filter((p) => !p.respuesta && p.tipo === "pregunta"),
      pruebas: ps.filter((p) => !p.respuesta && p.tipo === "prueba"),
      mandadas: ps.filter((p) => p.respuesta).sort((a, b) => Date.parse(b.respuesta!.fecha) - Date.parse(a.respuesta!.fecha)),
    };
  });
}

export const esperan = (p: ProyectoPend) => p.preguntas.length + p.pruebas.length;
export const totalEsperan = (ps: readonly ProyectoPend[]) => ps.reduce((n, p) => n + esperan(p), 0);
export const esParado = (p: ProyectoPend) => p.hace >= PARADO_H;

/** Arriba los que más esperan (a igual cantidad, el de movimiento más reciente); los parados (7 días o más), aparte. */
export function ordenar(ps: readonly ProyectoPend[]): { activos: ProyectoPend[]; parados: ProyectoPend[] } {
  return {
    activos: ps.filter((p) => !esParado(p)).sort((a, b) => esperan(b) - esperan(a) || a.hace - b.hace),
    parados: ps.filter(esParado).sort((a, b) => a.hace - b.hace),
  };
}

// --- Lo que el usuario tocó -------------------------------------------------------------

export const vacias = (): Respuestas => ({ q: {}, p: {} });

/** Una pregunta cuenta como contestada con una opción marcada o, en "otra", con algo escrito. */
export const preguntaContestada = (r: RespPregunta | undefined): boolean => !!r && r.op !== null && (r.op !== OTRA || r.otra.trim() !== "");
export const pruebaContestada = (r: RespPrueba | undefined): boolean => !!r?.res;

/** Lo tocado, sin lo que ya no está esperando (se cerró, se movió, ya se mandó) ni lo que quedó sin contestar. Si no cambia nada, la misma. */
export function podar(r: Respuestas, ps: readonly ProyectoPend[]): Respuestas {
  const qs = new Set(ps.flatMap((p) => p.preguntas.map((x) => String(x.id))));
  const pr = new Set(ps.flatMap((p) => p.pruebas.map((x) => String(x.id))));
  const q = Object.entries(r.q).filter(([id, x]) => qs.has(id) && preguntaContestada(x));
  const p = Object.entries(r.p).filter(([id, x]) => pr.has(id) && pruebaContestada(x));
  if (q.length === Object.keys(r.q).length && p.length === Object.keys(r.p).length) return r;
  return { q: Object.fromEntries(q), p: Object.fromEntries(p) };
}

export function cuenta(p: ProyectoPend, r: Respuestas): { preguntas: number; pruebas: number; total: number } {
  const preguntas = p.preguntas.filter((q) => preguntaContestada(r.q[q.id])).length;
  const pruebas = p.pruebas.filter((x) => pruebaContestada(r.p[x.id])).length;
  return { preguntas, pruebas, total: preguntas + pruebas };
}

/** Un item tocado listo para mandar: lo que se le dice a `tablero responder` y cómo se dice en el mensaje. */
export type Tocada = { pend: Pend; cli: Exclude<RespuestaCli, null>; dice: string };

/** Lo tocado de un proyecto, preguntas primero, en el orden en que el tablero las trae. */
export function tocadas(p: ProyectoPend, r: Respuestas): Tocada[] {
  const qs = p.preguntas.flatMap((pend): Tocada[] => {
    const x = r.q[pend.id];
    if (!x || !preguntaContestada(x)) return [];
    if (x.op === OTRA) return [{ pend, cli: { tipo: "pregunta", texto: x.otra.trim() }, dice: x.otra.trim() }];
    const o = pend.opciones.find((o) => o.id === x.op);
    return o ? [{ pend, cli: { tipo: "pregunta", opcion: o.id }, dice: o.texto }] : [];
  });
  const ps = p.pruebas.flatMap((pend): Tocada[] => {
    const x = r.p[pend.id];
    if (!x?.res) return [];
    const nota = x.nota.trim();
    return [{ pend, cli: { tipo: "prueba", anda: x.res === "anda", ...(nota ? { nota } : {}) }, dice: `${x.res === "anda" ? "anda" : "NO anda"}${nota ? `. Nota: ${nota}` : ""}` }];
  });
  return [...qs, ...ps];
}

/**
 * El mensaje para el líder. Es una instrucción para Claude, no texto de la UI: va en español y en un solo
 * lugar (como `promptIniciar`). Lleva sólo lo que el usuario tocó, con el id de cada item, y termina pidiendo
 * cerrar cada uno al resolverlo (la respuesta ya quedó guardada en el item: `tablero responder`).
 */
export function armarMensaje(proyecto: string, ts: readonly Tocada[]): string {
  const donde = proyecto || "sin proyecto";
  const lineas: string[] = [`Respuestas ${deDueno()} sobre ${donde} (tablero). Ya quedaron guardadas en cada item (\`tablero ver <id>\` las muestra). Lo que no aparece sigue pendiente:`];
  const qs = ts.filter((x) => x.pend.tipo === "pregunta");
  if (qs.length) {
    lineas.push("", "Preguntas:");
    for (const x of qs) lineas.push(`- #${x.pend.id} ${x.pend.titulo} → ${x.dice}`);
  }
  const ps = ts.filter((x) => x.pend.tipo === "prueba");
  if (ps.length) {
    lineas.push("", "Pruebas:");
    for (const x of ps) lineas.push(`- #${x.pend.id} ${x.pend.titulo}${x.pend.que ? ` (${x.pend.que})` : ""} → ${x.dice}`);
  }
  const ids = ts.map((x) => `#${x.pend.id}`).join(", ");
  lineas.push("", `Cuando resuelvas cada uno, cerralo con \`tablero cerrar <id>\` (${ids}).`);
  return lineas.join("\n");
}

/** Lo ya escrito en una caja, más lo nuevo debajo: mandar no pisa lo que el usuario venía redactando. */
export const sumarAlBorrador = (previo: string, nuevo: string): string => (previo.trim() ? `${previo.replace(/\s+$/, "")}\n\n${nuevo}` : nuevo);
