// El resumen de traspaso de "seguir con otro modelo": de las líneas del transcript de un líder o de un worker (jsonl de Claude Code)
// arma un texto corto (objetivo, qué se pidió después, decisiones, archivos tocados, estado y qué sigue) que el modelo nuevo lee
// como primer mensaje de la MISMA conversación. `resumenTraspaso` es pura (sin disco ni reloj) y con tope de tamaño; la usan `pa
// --seguir-con` (electron/cli/pa/seguir-con.ts) y la acción del hilo de la app. Sin Electron: la prueba `tests/resumen-traspaso.test.ts`.
import { leerTranscript } from "./contexto-jsonl.ts";

export type OpcionesResumen = {
  /** Tope de caracteres del texto entero (default 6000; mínimo 800). */
  tope?: number;
  /** El modelo que se cortó (sólo para la presentación). */
  modeloAnterior?: string;
  /** Por qué se corta ("sin cupo", "cambio de motor"…). */
  motivo?: string;
  /** Lo que el jefe o el usuario le suma al pedido para el modelo nuevo. */
  pedido?: string;
};

export const TOPE_RESUMEN = 6000;
const TOPE_MIN = 800;

/** Una sola línea: espacios juntos y cortada a `n` (con «…» si se pasó). */
const linea = (s: string, n: number): string => corte(s.replace(/\s+/g, " ").trim(), n);
function corte(s: string, n: number): string {
  const a = [...s];
  return a.length <= n ? s : `${a.slice(0, Math.max(1, n - 1)).join("").trimEnd()}…`;
}

/** Lo que el sistema le mete al usuario y no es un pedido suyo. */
const RUIDO = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const NO_ES_PEDIDO = /^(<command-|<local-command|<task-notification|Caveat:|\[Request interrupted)/;

type Bloque = { type?: string; text?: unknown; name?: unknown; input?: unknown };
type Reg = { type?: string; isSidechain?: boolean; isMeta?: boolean; message?: { content?: unknown } };

function textoDe(c: unknown): string {
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  return (c as Bloque[])
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
}

const EDITORES = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const VERIFICA = /\b(test|tests|tsc|build|check|lint|pytest|vitest|jest|cargo (test|check|build)|npm run|npx|node --test|make)\b/i;
const DECISION = /^[\s>*_-]*(decisi[oó]n|decid[ií]|decidimos|supuesto|eleg[ií]|opt[eé]|acordamos|quedamos en)\b/i;
const SIGUE = /^[\s>*_-]*(sigue|falta|faltan|pendiente|pendientes|pr[oó]ximo|pr[oó]ximos|siguiente|todo|queda)\b/i;

type Todo = { content?: unknown; status?: unknown };

export type Datos = {
  objetivo: string;
  pedidos: string[];
  decisiones: string[];
  archivos: string[];
  verificaciones: string[];
  commits: number;
  hechos: string[];
  pendientes: string[];
  estado: string;
  ultimaAccion: string;
  sigue: string[];
};

/** Lo que sale del transcript, sin darle formato. Exportada para las pruebas. */
export function extraerDatos(lineas: string[]): Datos {
  const pedidos: string[] = [];
  const decisiones: string[] = [];
  const archivos: string[] = [];
  const verificaciones: string[] = [];
  let commits = 0;
  let todos: Todo[] | null = null;
  let ultimoTexto = "";
  let ultimaAccion = "";
  for (const crudo of lineas) {
    let r: Reg;
    try {
      r = JSON.parse(crudo) as Reg;
    } catch {
      continue;
    }
    if (!r || typeof r !== "object" || r.isSidechain) continue;
    const c = r.message?.content;
    if (r.type === "user") {
      if (r.isMeta) continue;
      // un mensaje que sólo trae tool_result no es un pedido
      const t = textoDe(c).replace(RUIDO, "").trim();
      if (t && !NO_ES_PEDIDO.test(t)) pedidos.push(t);
    } else if (r.type === "assistant" && Array.isArray(c)) {
      for (const b of c as Bloque[]) {
        if (!b || typeof b !== "object") continue;
        if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
          ultimoTexto = b.text.trim();
          for (const l of ultimoTexto.split("\n")) if (DECISION.test(l)) decisiones.push(linea(l.replace(/^[\s>*_-]+/, ""), 220));
        } else if (b.type === "tool_use" && typeof b.name === "string") {
          const inp = (b.input && typeof b.input === "object" ? b.input : {}) as Record<string, unknown>;
          if (EDITORES.has(b.name)) {
            const f = inp.file_path ?? inp.notebook_path;
            if (typeof f === "string" && f) {
              if (!archivos.includes(f)) archivos.push(f);
              ultimaAccion = `editó ${f}`;
            }
          } else if (b.name === "Bash" && typeof inp.command === "string") {
            const cmd = linea(inp.command, 160);
            if (/\bgit\s+commit\b/.test(cmd)) commits++;
            else if (VERIFICA.test(cmd) && !verificaciones.includes(cmd)) verificaciones.push(cmd);
            ultimaAccion = `corrió \`${cmd}\``;
          } else if (b.name === "TodoWrite" && Array.isArray(inp.todos)) todos = inp.todos as Todo[];
        }
      }
    }
  }
  const hechos: string[] = [];
  const pendientes: string[] = [];
  for (const t of todos ?? []) {
    const txt = typeof t?.content === "string" ? linea(t.content, 160) : "";
    if (!txt) continue;
    (t.status === "completed" ? hechos : pendientes).push(txt);
  }
  const sigue: string[] = [];
  for (const l of ultimoTexto.split("\n")) if (SIGUE.test(l)) sigue.push(linea(l.replace(/^[\s>*_-]+/, ""), 220));
  return {
    objetivo: pedidos[0] ?? "",
    pedidos: pedidos.slice(1),
    decisiones: [...new Set(decisiones)],
    archivos,
    verificaciones,
    commits,
    hechos,
    pendientes,
    estado: ultimoTexto,
    ultimaAccion,
    sigue,
  };
}

type Seccion = { titulo: string; cuerpo: string[] };

/** Las secciones con cada tope multiplicado por `k` (1 = lo normal). */
function secciones(d: Datos, k: number): Seccion[] {
  const n = (x: number) => Math.max(40, Math.floor(x * k));
  const lista = (xs: string[], max: number, ancho: number, resto = "más"): string[] => {
    const cuantos = Math.max(1, Math.floor(max * k));
    const v = xs.slice(0, cuantos).map((x) => `- ${linea(x, n(ancho))}`);
    if (xs.length > cuantos) v.push(`- … y ${xs.length - cuantos} ${resto}`);
    return v;
  };
  const s: Seccion[] = [];
  s.push({ titulo: "Objetivo", cuerpo: [corte(d.objetivo || "(el transcript no trae el pedido original)", n(1500))] });
  if (d.pedidos.length) s.push({ titulo: "Pedidos posteriores (los últimos)", cuerpo: lista(d.pedidos.slice(-3).reverse(), 3, 300) });
  const sigue = d.pendientes.length ? d.pendientes : d.sigue;
  s.push({ titulo: "Qué sigue", cuerpo: sigue.length ? lista(sigue, 8, 200) : ["(no quedó anotado: seguí desde el estado de abajo y confirmá con `git status` y `git log`)"] });
  const estado: string[] = [];
  if (d.estado) estado.push(corte(d.estado, n(1200)));
  if (d.ultimaAccion) estado.push(`Lo último que hizo: ${linea(d.ultimaAccion, n(200))}.`);
  if (d.commits) estado.push(`Hizo ${d.commits} commit(s) en este trabajo.`);
  if (d.hechos.length) estado.push(`Hecho según su lista de pasos: ${d.hechos.slice(-6).map((x) => linea(x, 80)).join("; ")}.`);
  s.push({ titulo: "Estado", cuerpo: estado.length ? estado : ["(sin mensajes del modelo anterior)"] });
  if (d.decisiones.length) s.push({ titulo: "Decisiones ya tomadas (no las revisites)", cuerpo: lista(d.decisiones.slice(-8), 8, 220) });
  if (d.archivos.length) s.push({ titulo: "Archivos que tocó", cuerpo: lista(d.archivos, 25, 200, "archivo(s) más") });
  if (d.verificaciones.length) s.push({ titulo: "Verificaciones que corrió", cuerpo: lista(d.verificaciones.slice(-5), 5, 160) });
  return s;
}

const render = (cabeza: string, ss: Seccion[], pedido: string): string =>
  [cabeza, ...ss.map((s) => `## ${s.titulo}\n${s.cuerpo.join("\n")}`), ...(pedido ? [`## Pedido para vos\n${pedido}`] : [])].join("\n\n");

/**
 * El texto de traspaso a partir de las líneas (strings JSON) de un transcript. Si no entra en `tope`, achica los topes de cada sección
 * y, como última salida, corta el final con una marca. Nunca devuelve más de `tope` caracteres.
 */
export function resumenTraspaso(lineas: string[], o: OpcionesResumen = {}): string {
  const tope = Math.max(TOPE_MIN, Math.floor(o.tope ?? TOPE_RESUMEN));
  const d = extraerDatos(lineas);
  const de = o.modeloAnterior ? ` (${linea(o.modeloAnterior, 60)})` : "";
  const porque = o.motivo ? `: ${linea(o.motivo, 80)}` : "";
  const cabeza =
    `# Traspaso: seguís una conversación que cortó el modelo anterior${de}${porque}\n` +
    "Este es el resumen de lo que hizo hasta acá; el repositorio y la rama están como los dejó. Antes de tocar nada mirá `git status` y `git log` para confirmar el estado real, no rehagas lo que ya está hecho y seguí desde «Qué sigue».";
  const pedido = o.pedido ? corte(o.pedido.trim(), Math.floor(tope / 4)) : "";
  let k = 1;
  let txt = render(cabeza, secciones(d, k), pedido);
  for (let i = 0; i < 6 && [...txt].length > tope; i++) {
    k = Math.max(0.05, (k * tope * 0.9) / [...txt].length);
    txt = render(cabeza, secciones(d, k), pedido);
  }
  if ([...txt].length > tope) txt = `${[...txt].slice(0, tope - 24).join("").trimEnd()}\n…(resumen recortado)`;
  return txt;
}

/** Lo mismo, leyendo el transcript con el lector incremental (`null` si no existe o está vacío). */
export async function resumenDeTranscript(ruta: string, o: OpcionesResumen = {}): Promise<string | null> {
  const t = await leerTranscript(ruta);
  if (!t || t.lineas.length === 0) return null;
  return resumenTraspaso(t.lineas, o);
}
