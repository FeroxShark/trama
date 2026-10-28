// Cómo se llama cada grupo de cupo en el idioma de la interfaz: se traduce por el id del grupo (`gemini`, `claude-gpt`…),
// nunca por el `nombre` que manda `reparto` (está en español). Un id que no conocemos cae a ese `nombre`.
import type { GrupoCupo } from "../datos/contrato";
import { t, type ClaveSola } from "../i18n/index.ts";

const NOMBRES: Record<string, { largo: ClaveSola; corto: ClaveSola; que?: ClaveSola }> = {
  gemini: { largo: "cu.g.gemini", corto: "cu.gc.gemini", que: "cu.gd.gemini" },
  "claude-gpt": { largo: "cu.g.claude-gpt", corto: "cu.gc.claude-gpt", que: "cu.gd.claude-gpt" },
  "gemini-4-argon": { largo: "cu.g.gemini-4-argon", corto: "cu.gc.gemini-4-argon", que: "cu.gd.gemini-4-argon" },
  codex: { largo: "cu.g.codex", corto: "cu.gc.codex" },
  "opencode-free": { largo: "cu.g.opencode-free", corto: "cu.gc.opencode-free", que: "cu.gd.opencode-free" },
  "nvidia-nim": { largo: "cu.g.nvidia-nim", corto: "cu.gc.nvidia-nim", que: "cu.gd.nvidia-nim" },
  "opencode-go": { largo: "cu.g.opencode-go", corto: "cu.gc.opencode-go", que: "cu.gd.opencode-go" },
};

/** El nombre entero ("Claude and GPT models"). */
export const nombreGrupo = (g: Pick<GrupoCupo, "id" | "nombre">): string => (NOMBRES[g.id] ? t(NOMBRES[g.id].largo) : g.nombre);
/** El nombre cortito para la barra angosta ("Claude/GPT"). */
export const nombreGrupoCorto = (g: Pick<GrupoCupo, "id" | "nombre">): string => (NOMBRES[g.id] ? t(NOMBRES[g.id].corto) : g.nombre);
/** Qué modelos trae, si lo sabemos. */
export const queGrupo = (g: Pick<GrupoCupo, "id">): string | null => {
  const c = NOMBRES[g.id]?.que;
  return c ? t(c) : null;
};
