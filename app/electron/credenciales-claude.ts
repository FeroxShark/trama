// Lo que se lee, sin red y de forma síncrona, de las credenciales de Claude Code (`~/.claude/.credentials.json`, o `<dir>/.credentials.json`
// de una cuenta agregada): SÓLO el tipo de suscripción (`claudeAiOauth.subscriptionType` y `rateLimitTier`) y si hay sesión. Los tokens
// nunca se devuelven, ni se guardan ni se loguean. Lo usan `pa` (cupos según el plan) y `reparto` (no ofrecer un Claude sin sesión).
import { readFileSync } from "node:fs";
import path from "node:path";
import { planDeClaude } from "./costo-planes-texto.ts";

type Obj = Record<string, unknown>;

/** El bloque `claudeAiOauth` del credentials, o null si el texto no es JSON o no lo trae. Quien llama no debe tocar más que los dos campos de plan. */
function oauthDe(texto: string): Obj | null {
  try {
    const j = JSON.parse(texto) as unknown;
    const o = j && typeof j === "object" ? (j as Obj).claudeAiOauth : null;
    return o && typeof o === "object" ? (o as Obj) : null;
  } catch {
    return null;
  }
}

/** El plan de Claude (misma lectura que `planClaudeDetectado`) de un texto de credentials; `null` si no es un plan conocido. */
export function planDeCredenciales(texto: string): string | null {
  const o = oauthDe(texto);
  return o ? planDeClaude(o.subscriptionType, o.rateLimitTier) : null;
}

/** El plan para `pa`: `pro` (Claude Pro) o `max` (Max 5x / Ultra) según el credentials de la carpeta de configuración; `null` si no se sabe. */
export function planPaDeClaude(dirClaude: string): "pro" | "max" | null {
  try {
    const p = planDeCredenciales(readFileSync(path.join(dirClaude, ".credentials.json"), "utf8"));
    return p === "Claude Pro" ? "pro" : p ? "max" : null;
  } catch {
    return null;
  }
}

/** ¿Hay una sesión de Claude en esa carpeta? Sólo mira que el credentials tenga el bloque `claudeAiOauth`, sin devolver nada de adentro. */
export function haySesionClaude(dirClaude: string): boolean {
  try {
    return oauthDe(readFileSync(path.join(dirClaude, ".credentials.json"), "utf8")) !== null;
  } catch {
    return false;
  }
}
