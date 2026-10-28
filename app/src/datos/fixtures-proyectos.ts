// Los proyectos de mentira para las capturas y el modo sin main (Ajustes > Proyectos, nombres para mostrar, unificar instrucciones).
import type { ProyectoNombre } from "../../electron/proyectos-alias";
import type { EstadoMd, PlanMd } from "../../electron/unificar-md";
import { MODO } from "../modo";

export const PROYECTOS_FALSOS: ProyectoNombre[] = [
  { nombre: "asistente-voz", slug: "asistente-voz", ruta: "~/Proyectos/asistente-voz", titulo: "Shark", existe: true, alias: [], logo: false },
  { nombre: "atlas", slug: "atlas", ruta: "~/Proyectos/atlas", titulo: null, existe: true, alias: [], logo: true },
  { nombre: "duna", slug: "duna", ruta: "~/Proyectos/duna", titulo: "Duna Studio", existe: true, alias: [], logo: false },
  { nombre: "hilos", slug: "hilos", ruta: "~/Proyectos/hilos", titulo: "trama", existe: true, alias: [], logo: false },
  { nombre: "baliza", slug: "baliza", ruta: "~/Proyectos/baliza", titulo: "Baliza Android", existe: false, alias: [], logo: false },
];

const fila = (archivo: "AGENTS.md" | "CLAUDE.md" | "GEMINI.md", tipo: EstadoMd["archivos"][number]["tipo"], caracteres = 0) => ({ archivo, tipo, bytes: caracteres, caracteres });

/** Qué hay en la carpeta de cada proyecto de mentira. */
export const ESTADOS_MD_FALSOS: Record<string, EstadoMd> = {
  "asistente-voz": { ruta: "~/Proyectos/asistente-voz", archivos: [fila("AGENTS.md", "falta"), fila("CLAUDE.md", "real", 2140), fila("GEMINI.md", "real", 980)], caracteres: 2140, tope: 20000, truncado: false, unificado: false, porUnificar: true },
  atlas: { ruta: "~/Proyectos/atlas", archivos: [fila("AGENTS.md", "real", 3120), fila("CLAUDE.md", "stub"), fila("GEMINI.md", "falta")], caracteres: 3120, tope: 20000, truncado: false, unificado: true, porUnificar: false },
  duna: { ruta: "~/Proyectos/duna", archivos: [fila("AGENTS.md", "real", 26400), fila("CLAUDE.md", "falta"), fila("GEMINI.md", "falta")], caracteres: 26400, tope: 20000, truncado: true, unificado: false, porUnificar: true },
  hilos: { ruta: "~/Proyectos/hilos", archivos: [fila("AGENTS.md", "falta"), fila("CLAUDE.md", "real", 5230), fila("GEMINI.md", "falta")], caracteres: 5230, tope: 20000, truncado: false, unificado: false, porUnificar: true },
  baliza: { ruta: "~/Proyectos/baliza", archivos: [fila("AGENTS.md", "falta"), fila("CLAUDE.md", "falta"), fila("GEMINI.md", "falta")], caracteres: 0, tope: 20000, truncado: false, unificado: false, porUnificar: false },
};

if (MODO.variante === "proyectos-trabajando") {
  ESTADOS_MD_FALSOS.duna.tareaEnCurso = "acortar";
}

const CLAUDE_FALSO = "# Shark\n\nAsistente de escritorio por voz.\n\n## Build\n- `pnpm install`\n- `pnpm dev`\n\n## Tests\n- `pnpm test`\n\n## No tocar\n- `vendor/whisper/`";
const GEMINI_FALSO = "# Shark (Gemini)\n\n- Usá `pnpm`, nunca npm.\n- El micrófono se prueba con `pnpm mic:check`.";
const STUB = "<!-- Editá AGENTS.md, no este archivo: acá sólo se importa para que cada modelo (Claude, Gemini, …) lea las mismas instrucciones. -->\n@AGENTS.md\n";

export function planFalso(slug: string): PlanMd {
  const base = { ruta: `~/Proyectos/${slug}`, avisos: [], tope: 20000, huella: `falsa-${slug}` };
  if (slug === "asistente-voz") {
    const nuevo = `# AGENTS.md\n\n<!-- Unificado desde CLAUDE.md y GEMINI.md, que decían cosas distintas: revisá y juntá lo repetido. -->\n\n## Desde CLAUDE.md\n\n${CLAUDE_FALSO}\n\n## Desde GEMINI.md\n\n${GEMINI_FALSO}\n`;
    return {
      ...base,
      acciones: [{ archivo: "AGENTS.md", que: "crea", de: "ambos" }, { archivo: "CLAUDE.md", que: "stub" }, { archivo: "GEMINI.md", que: "stub" }],
      antes: { "AGENTS.md": null, "CLAUDE.md": `${CLAUDE_FALSO}\n`, "GEMINI.md": `${GEMINI_FALSO}\n` },
      despues: { "AGENTS.md": nuevo, "CLAUDE.md": STUB, "GEMINI.md": STUB },
      nada: null,
      caracteres: nuevo.length,
      truncado: false,
    };
  }
  if (slug === "hilos") {
    return {
      ...base,
      acciones: [{ archivo: "AGENTS.md", que: "crea", de: "CLAUDE.md" }, { archivo: "CLAUDE.md", que: "stub" }],
      antes: { "AGENTS.md": null, "CLAUDE.md": `${CLAUDE_FALSO}\n` },
      despues: { "AGENTS.md": `${CLAUDE_FALSO}\n`, "CLAUDE.md": STUB },
      nada: null,
      caracteres: CLAUDE_FALSO.length,
      truncado: false,
    };
  }
  if (slug === "duna") {
    return { ...base, acciones: [{ archivo: "CLAUDE.md", que: "crea-stub" }], antes: { "CLAUDE.md": null }, despues: { "CLAUDE.md": STUB }, nada: null, caracteres: 26400, truncado: true };
  }
  return { ...base, acciones: [], antes: {}, despues: {}, nada: slug === "atlas" ? "unificado" : "sin-contenido", caracteres: 0, truncado: false };
}

export const AGENTS_FALSO = "# AGENTS.md\n\n## Qué es\nAtlas: mapas offline para el equipo de campo.\n\n## Build y arranque\n- Instalar: `npm ci`\n- Correr: `npm run dev`\n\n## Tests y verificación\n- Todos: `npm test`\n";
