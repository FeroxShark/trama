// Qué clase de acción es una llamada a una herramienta y su ícono: un solo mapa para las pastillas del trabajo («Corrió un comando,
// leyó un archivo · 21 s») y las filas de cada llamada (`Llamada.tsx`). Sin React: lo prueba `tests/accion-tipo.test.ts`.
import { FilePen, FilePlus, FileText, Globe, Hourglass, Layers, ListChecks, Plug, Search, Sparkles, SquareTerminal, Users, Wrench, type LucideIcon } from "lucide-react";
import type { Uso } from "./herramientas.ts";
import { enFondo } from "./resumen-pasos.ts";

export type TipoAccion = "leer" | "editar" | "escribir" | "comando" | "buscar" | "skill" | "agente" | "esperar" | "web" | "mcp" | "fondo" | "tareas" | "otra";

/** El mapa único tipo → ícono (lucide, el trazo y el tamaño los pone quien lo dibuja). `otra` es el respaldo de lo desconocido. */
export const ICONO_ACCION: Record<TipoAccion, LucideIcon> = {
  leer: FileText,
  editar: FilePen,
  escribir: FilePlus,
  comando: SquareTerminal,
  buscar: Search,
  skill: Sparkles,
  agente: Users,
  esperar: Hourglass,
  web: Globe,
  mcp: Plug,
  fondo: Layers,
  tareas: ListChecks,
  otra: Wrench,
};

/** El ícono de un tipo; lo que no esté en el mapa (un tipo nuevo, un valor suelto) cae en el de «otra herramienta». */
export const iconoAccion = (tipo: string): LucideIcon => (Object.hasOwn(ICONO_ACCION, tipo) ? ICONO_ACCION[tipo as TipoAccion] : ICONO_ACCION.otra);

/**
 * El color de un tipo (tokens `--tipo-*` de tokens.css, todos apagados): leer y buscar en azul, escribir y editar en ámbar, comandos
 * en verde, web en violeta y el resto gris. Nunca va solo: el ícono, el nombre o el detalle de la fila dicen lo mismo con palabras.
 */
export type ClaseAccion = "leer" | "escribir" | "comando" | "web" | "neutro";

export const CLASE_ACCION: Record<TipoAccion, ClaseAccion> = {
  leer: "leer",
  buscar: "leer",
  editar: "escribir",
  escribir: "escribir",
  comando: "comando",
  web: "web",
  skill: "neutro",
  agente: "neutro",
  esperar: "neutro",
  mcp: "neutro",
  fondo: "neutro",
  tareas: "neutro",
  otra: "neutro",
};

/** La clase de color de un tipo; lo desconocido es gris. */
export const claseAccion = (tipo: string): ClaseAccion => (Object.hasOwn(CLASE_ACCION, tipo) ? CLASE_ACCION[tipo as TipoAccion] : "neutro");

/**
 * Las claves propias de la tarjeta de actividad (`Icono`) y del recorrido del worker (`TipoPaso`) → el tipo de este mapa, para que
 * un `Bash` tenga el mismo ícono y color en todos lados. Las que no son una herramienta (pensar, texto, permiso) no están: cada vista pone el suyo.
 */
export const TIPO_DE_CLAVE: Readonly<Record<string, TipoAccion>> = {
  leer: "leer",
  buscar: "buscar",
  editar: "editar",
  escribir: "escribir",
  correr: "comando",
  web: "web",
  delegar: "agente",
  otro: "otra",
};

const LEER = new Set(["Read", "NotebookRead"]);
const EDITAR = new Set(["Edit", "MultiEdit", "NotebookEdit"]);
const BUSCAR = new Set(["Grep", "Glob", "ToolSearch"]);
const WEB = new Set(["WebSearch", "WebFetch"]);
const TAREAS = new Set(["TodoWrite", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet"]);
const AGENTE = new Set(["Task", "Agent", "SendMessage"]);
const ESPERAR = new Set(["TaskOutput", "Monitor", "ScheduleWakeup", "Sleep"]);
/** `pa --esperar …` o `sleep N` por Bash: se espera a un worker o al reloj, no se corre nada. */
const BASH_ESPERA = /(?:^|&&|;|\|\||\n)\s*(?:\S*\/)?(?:pa\b[^\n;&|]*--esperar|sleep\s)/;
/** `pa <proyecto> "<tarea>"` (sin las formas de gestión) lanza un worker: es delegar. */
const BASH_LANZA = /(?:^|&&|;|\|\||\n)\s*(?:\S*\/)?pa\s+(?!-)[\w.-]+\s+\S/;

/** La clase de acción de una llamada. Una tarea en segundo plano (`run_in_background`) manda sobre el resto, como en el resumen de la pastilla. */
export function tipoAccion(u: Pick<Uso, "nombre" | "det">): TipoAccion {
  const n = u.nombre;
  if (enFondo(u as Uso)) return "fondo";
  if (n.startsWith("mcp__")) return "mcp";
  if (n === "Skill") return "skill";
  if (LEER.has(n)) return "leer";
  if (n === "Write") return "escribir";
  if (EDITAR.has(n)) return "editar";
  if (BUSCAR.has(n)) return "buscar";
  if (WEB.has(n)) return "web";
  if (TAREAS.has(n)) return "tareas";
  if (AGENTE.has(n)) return "agente";
  if (ESPERAR.has(n)) return "esperar";
  if (n === "Bash") {
    const c = u.det?.entrada?.command;
    if (typeof c === "string") {
      if (BASH_ESPERA.test(c)) return "esperar";
      if (BASH_LANZA.test(c) && !/--(?:integrar|hilos?|parar|revertir|nota|rinde|leer|tests|archivar|descartar|retomar|ayuda|json)\b/.test(c)) return "agente";
    }
    return "comando";
  }
  return "otra";
}

/** Cuántos íconos de acción entran en una pastilla. */
export const MAX_ICONOS = 3;

/**
 * Los tipos presentes en un grupo de llamadas, los más usados primero (a igual cantidad, el que apareció antes), hasta `max`.
 * Una pastilla con un solo tipo muestra uno; con varios, hasta tres: a 12 px se leen bien y la palabra del resumen dice el resto.
 */
export function tiposDe(usos: Pick<Uso, "nombre" | "det">[], max = MAX_ICONOS): TipoAccion[] {
  const cuenta = new Map<TipoAccion, number>();
  for (const u of usos) {
    const k = tipoAccion(u);
    cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
  }
  return [...cuenta.entries()]
    .map(([k, n], orden) => ({ k, n, orden }))
    .sort((a, b) => b.n - a.n || a.orden - b.orden)
    .slice(0, max)
    .map((x) => x.k);
}
