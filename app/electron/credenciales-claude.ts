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

// Otras formas de entrar a Claude Code que no dejan un `.credentials.json` con `claudeAiOauth`. Los nombres salen del binario instalado de
// Claude Code (2.1.330), no de memoria. Sólo se mira que existan, nunca se devuelve ni se guarda su valor.
const VARIABLES_DE_ENTRADA = [
  "ANTHROPIC_API_KEY", // clave de la API
  "ANTHROPIC_AUTH_TOKEN", // token de auth (Authorization: Bearer)
  "CLAUDE_CODE_OAUTH_TOKEN", // token OAuth de larga duración (`claude setup-token`)
  "CLAUDE_CODE_USE_BEDROCK", // Amazon Bedrock
  "AWS_BEARER_TOKEN_BEDROCK", // clave de API de Bedrock
  "CLAUDE_CODE_USE_VERTEX", // Google Vertex AI
  "CLAUDE_CODE_USE_FOUNDRY", // Microsoft Foundry
  "ANTHROPIC_FOUNDRY_API_KEY",
] as const;

/** ¿La variable está puesta con algo? (`0`, `false` y vacío en las `CLAUDE_CODE_USE_*` cuentan como apagado.) */
function variablePuesta(nombre: string, valor: unknown): boolean {
  if (typeof valor !== "string" || valor.trim() === "") return false;
  return !nombre.startsWith("CLAUDE_CODE_USE_") || !/^(0|false|no|off)$/i.test(valor.trim());
}

/**
 * ¿Se entra a Claude Code sin `.credentials.json`? Sí si el entorno trae alguna de las variables de arriba, o si el `settings.json` de la
 * carpeta de configuración trae un `apiKeyHelper` o un `env` con alguna de ellas (un `env` con otras cosas, como un PATH, no cuenta).
 */
export function hayEntradaAlternativaClaude(env: Record<string, string | undefined>, dirClaude: string): boolean {
  if (VARIABLES_DE_ENTRADA.some((v) => variablePuesta(v, env[v]))) return true;
  try {
    const j = JSON.parse(readFileSync(path.join(dirClaude, "settings.json"), "utf8")) as unknown;
    if (!j || typeof j !== "object") return false;
    const s = j as Obj;
    if (typeof s.apiKeyHelper === "string" && s.apiKeyHelper.trim() !== "") return true;
    const e = s.env;
    if (e && typeof e === "object") return VARIABLES_DE_ENTRADA.some((v) => variablePuesta(v, (e as Obj)[v]));
  } catch {
    /* sin settings.json o ilegible */
  }
  return false;
}
