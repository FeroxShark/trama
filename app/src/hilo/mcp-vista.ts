// `/mcp` de la caja de un líder, la parte que no es de React (PanelMcp.tsx): cómo se llama cada conector para una persona, qué ícono le toca,
// y en qué grupo va según su estado. Puro: lo prueba tests/mcp-vista.test.ts.
import type { EstadoMcp } from "../datos/paneles";

export type ServidorVisto = NonNullable<EstadoMcp["claude"]>["servidores"][number];
export type EstadoServidor = ServidorVisto["estado"];

/** Dónde se configura un conector: la cuenta de claude.ai, un plugin o la config de Claude Code. */
export type Origen = { tipo: "claudeai" | "plugin" | "config"; de: string };

/** Adónde lleva «Iniciar sesión»: la pantalla de conectores de claude.ai, donde se autoriza cada uno. */
export const URL_CONECTORES = "https://claude.ai/settings/connectors";

/** `claude.ai Google Calendar` → «Google Calendar» (claude.ai); `plugin:design:figma` → «figma» (plugin design); lo demás, tal cual. */
export function nombreVisible(nombre: string): { titulo: string; origen: Origen } {
  const ai = /^claude\.ai\s+(.+)$/i.exec(nombre);
  if (ai) return { titulo: ai[1].trim(), origen: { tipo: "claudeai", de: "" } };
  const pl = /^plugin:([^:]+):(.+)$/.exec(nombre);
  if (pl) return { titulo: pl[2], origen: { tipo: "plugin", de: pl[1] } };
  return { titulo: nombre, origen: { tipo: "config", de: "" } };
}

export type ClaveIcono = "correo" | "calendario" | "documentos" | "archivos" | "figma" | "codigo" | "chat" | "tareas" | "pagos" | "datos" | "web";

const ICONOS: [RegExp, ClaveIcono][] = [
  [/gmail|mail|correo|outlook/i, "correo"],
  [/calendar|calendario/i, "calendario"],
  [/notion|confluence|docs|wiki/i, "documentos"],
  [/drive|dropbox|box|onedrive|sharepoint|filesystem|archivos/i, "archivos"],
  [/figma/i, "figma"],
  [/github|gitlab|bitbucket/i, "codigo"],
  [/slack|discord|teams|chat/i, "chat"],
  [/linear|jira|asana|trello|todoist|tareas|tablero/i, "tareas"],
  [/stripe|paypal|mercado ?pago|pagos/i, "pagos"],
  [/postgres|mysql|sqlite|supabase|database|base|sql/i, "datos"],
  [/browser|playwright|puppeteer|chrome|web|fetch/i, "web"],
];

/** El ícono del servicio, por su nombre; `null` si no se reconoce (entonces va la inicial). */
export function claveIcono(titulo: string): ClaveIcono | null {
  return ICONOS.find(([re]) => re.test(titulo))?.[1] ?? null;
}

/** La inicial para el recuadro cuando no hay ícono. */
export const inicial = (titulo: string): string => (titulo.trim().match(/[\p{L}\p{N}]/u)?.[0] ?? "·").toUpperCase();

export type Fila = { nombre: string; titulo: string; origen: Origen; servidor: ServidorVisto | null };

export type Grupos = {
  conectados: Fila[];
  auth: Fila[];
  fallan: Fila[];
  /** Los apagados para el proyecto (con o sin dato de `claude mcp list`). */
  apagados: Fila[];
};

const aFila = (nombre: string, servidor: ServidorVisto | null): Fila => ({ nombre, servidor, ...nombreVisible(nombre) });

/**
 * Reparte lo que dijo `claude mcp list` y los apagados del proyecto: conectados, los que piden sesión, los que no conectan (caídos, sin configurar o
 * de estado desconocido) y los apagados. Uno apagado va sólo en «apagados», aunque `claude` también lo nombre.
 */
export function agrupar(servidores: ServidorVisto[], apagados: string[]): Grupos {
  const g: Grupos = { conectados: [], auth: [], fallan: [], apagados: [] };
  const off = new Set(apagados);
  for (const s of servidores) {
    if (off.has(s.nombre)) continue;
    (s.estado === "ok" ? g.conectados : s.estado === "auth" ? g.auth : g.fallan).push(aFila(s.nombre, s));
  }
  for (const n of apagados) g.apagados.push(aFila(n, servidores.find((s) => s.nombre === n) ?? null));
  return g;
}

