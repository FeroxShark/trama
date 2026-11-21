// Selección pura del modelo barato para compactar desde DialogoCache (chats fríos y grandes).
// Sin imports de React ni Electron: la prueban directo `tests/cache-compactar.test.ts` y la usa `DialogoCache.tsx`.
import { esClaudeOficial } from "../../electron/esfuerzo-extras.ts";
import { PRECIOS_PUBLICOS, precioDe } from "../paneles/precios.ts";
import { ventanaDe, ventanaDicha } from "./contexto-logica.ts";
import { esAgy, esLocal, type ModeloDef } from "./modelos.ts";

export type ModeloCandidatoBase = Pick<ModeloDef, "id" | "nombre" | "empresa" | "local" | "anterior" | "relleno" | "sinConectar">;

export type CandidatoCompactar = {
  id: string;
  nombre: string;
  ventana: number;
  entrada: number;
};

export type OpcionCompactarCache =
  | { tipo: "claude"; elegidoDefecto: CandidatoCompactar; candidatos: CandidatoCompactar[] }
  | { tipo: "gemini"; modelo: string }
  | null;

const ORDEN_FAMILIA_CLAUDE: Record<string, number> = {
  haiku: 0.5,
  sonnet: 2,
  opus: 4,
  fable: 10,
};

function familiaClaudeDe(id: string): "haiku" | "sonnet" | "opus" | "fable" | null {
  const m = id.toLowerCase();
  if (m.includes("haiku")) return "haiku";
  if (m.includes("sonnet")) return "sonnet";
  if (m.includes("opus")) return "opus";
  if (m.includes("fable") || m.includes("mythos")) return "fable";
  return null;
}

function precioEntrada(id: string): number {
  const p = precioDe(id, PRECIOS_PUBLICOS);
  if (p) return p.entrada;
  const fam = familiaClaudeDe(id);
  return fam ? ORDEN_FAMILIA_CLAUDE[fam] : Number.POSITIVE_INFINITY;
}

/** Misma lógica que Ajustes > Modelos (`reglaQueExcluye`): exacto, familia, prefijo `-` o comodín `*`. */
export function modeloExcluido(id: string, excluir: readonly string[] = [], effortsPermitidos?: Readonly<Record<string, readonly string[]>> | null): boolean {
  const permitidos = effortsPermitidos?.[id];
  if (Array.isArray(permitidos) && permitidos.length === 0) return true;
  if (!excluir.length) return false;
  const m = id.toLowerCase();
  const fam = familiaClaudeDe(m);
  return excluir.some((p) => {
    const r = p.toLowerCase();
    return (fam !== null && r === fam) || r === m || m.startsWith(`${r}-`) || (r.endsWith("*") && m.startsWith(r.slice(0, -1)));
  });
}

/**
 * Lista los modelos oficiales de Claude conectados, no excluidos, estrictamente más baratos que `modeloActual`
 * y en los que entra la conversación (`tokens <= ventana`), ordenados del más barato al menos barato.
 */
export function candidatosCompactarClaude({
  modeloActual,
  modelos,
  excluir = [],
  effortsPermitidos = null,
  tokens,
  claudeConectado = true,
  ventanas = null,
}: {
  modeloActual: string;
  modelos: readonly ModeloCandidatoBase[];
  excluir?: readonly string[];
  effortsPermitidos?: Readonly<Record<string, readonly string[]>> | null;
  tokens: number;
  claudeConectado?: boolean;
  ventanas?: Readonly<Record<string, number>> | null;
}): CandidatoCompactar[] {
  if (!claudeConectado || !esClaudeOficial(modeloActual) || esLocal(modeloActual)) return [];
  const entradaActual = precioEntrada(modeloActual);
  const vistos = new Set<string>();
  const lista: CandidatoCompactar[] = [];

  for (const m of modelos) {
    if (!m.id || vistos.has(m.id)) continue;
    vistos.add(m.id);
    if (!esClaudeOficial(m.id) || m.local || m.anterior || m.relleno) continue;
    if (m.empresa && m.empresa !== "anthropic") continue;
    if (m.sinConectar) continue;
    if (modeloExcluido(m.id, excluir, effortsPermitidos)) continue;

    const entrada = precioEntrada(m.id);
    if (!(entrada < entradaActual) || m.id === modeloActual) continue;

    const ventana = ventanaDicha(ventanas, m.id) ?? ventanaDe(m.id);
    if (tokens > ventana) continue;

    lista.push({ id: m.id, nombre: m.nombre, ventana, entrada });
  }

  return lista.sort((a, b) => a.entrada - b.entrada || b.ventana - a.ventana);
}

/**
 * Decide qué 3ª opción ofrece `DialogoCache`:
 * - Líderes de Claude oficiales: «Compactar con {barato} y seguir con {modelo}» si hay un Claude más barato disponible.
 * - Líderes de Gemini (`agy`): «Compactar y seguir» con el mismo modelo si Gemini está conectado y entra por ventana.
 * - Codex, DeepSeek, OpenCode y modelos locales: `null` (no la muestran).
 */
export function opcionCompactarCache({
  modeloLider,
  modeloDestino,
  modelos,
  excluir = [],
  effortsPermitidos = null,
  tokens,
  claudeConectado = true,
  agyConectado = true,
  ventanas = null,
}: {
  modeloLider: string | null | undefined;
  modeloDestino?: string | null;
  modelos: readonly ModeloCandidatoBase[];
  excluir?: readonly string[];
  effortsPermitidos?: Readonly<Record<string, readonly string[]>> | null;
  tokens: number;
  claudeConectado?: boolean;
  agyConectado?: boolean;
  ventanas?: Readonly<Record<string, number>> | null;
}): OpcionCompactarCache {
  if (!modeloLider || esLocal(modeloLider)) return null;
  const destino = modeloDestino || modeloLider;

  if (esAgy(modeloLider)) {
    if (!agyConectado || !esAgy(destino)) return null;
    const def = modelos.find((m) => m.id === destino);
    if (def?.sinConectar) return null;
    const ventana = ventanaDicha(ventanas, destino) ?? ventanaDe(destino);
    if (tokens > ventana) return null;
    return { tipo: "gemini", modelo: destino };
  }

  if (esClaudeOficial(modeloLider)) {
    const candidatos = candidatosCompactarClaude({
      modeloActual: destino,
      modelos,
      excluir,
      effortsPermitidos,
      tokens,
      claudeConectado,
      ventanas,
    });
    if (!candidatos.length) return null;
    return { tipo: "claude", elegidoDefecto: candidatos[0], candidatos };
  }

  // Codex, DeepSeek, OpenCode u otros motores sin soporte de `/compact`.
  return null;
}
