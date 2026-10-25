import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { entornoPa, resolverBinario, resolverPa } from "./binario.js";
import { ESTADO } from "./estado.js";

const execFileP = promisify(execFile);

export type IdGrupoCupo = "gemini" | "claude-gpt" | "argon";

export interface VentanaCupo {
  pct: number;
  /** Epoch ms en que se reinicia la ventana. */
  resetea?: number;
  /** Segundos restantes al momento de medir. */
  vuelveEnS?: number;
}

export interface GrupoCupo {
  id: IdGrupoCupo;
  semanal: VentanaCupo;
  cincoH?: VentanaCupo;
  /** Fecha ISO corta (YYYY-MM-DD) si el grupo vence en una fecha conocida. */
  hasta?: string;
}

export interface CuposLeidos {
  ts: number;
  claude?: {
    cincoH: number;
    sieteD: number;
    reseteaCincoH?: number;
    reseteaSieteD?: number;
  };
  google: GrupoCupo[];
}

const ORDEN_GRUPOS: IdGrupoCupo[] = ["gemini", "claude-gpt", "argon"];

function clampPct(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function parseIsoMs(s: unknown): number | undefined {
  if (typeof s !== "string" || !s.trim()) return undefined;
  const limpio = s.trim().replace(" ", "T");
  const ms = Date.parse(limpio);
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

function ventanaDe(raw: unknown, ahoraMs: number): VentanaCupo | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const pct = clampPct(r.usado_pct ?? r.pct);
  if (pct === null) return undefined;
  const resetea = parseIsoMs(r.vuelve_iso) ?? (typeof r.resetea === "number" ? r.resetea : undefined);
  let vuelveEnS = typeof r.vuelve_en_s === "number" && Number.isFinite(r.vuelve_en_s)
    ? Math.max(0, Math.round(r.vuelve_en_s))
    : undefined;
  if (vuelveEnS === undefined && resetea !== undefined) {
    vuelveEnS = Math.max(0, Math.round((resetea - ahoraMs) / 1000));
  }
  return {
    pct,
    ...(resetea !== undefined ? { resetea } : {}),
    ...(vuelveEnS !== undefined ? { vuelveEnS } : {}),
  };
}

function grupoDeModelo(id: string): IdGrupoCupo | null {
  const k = id.toLowerCase();
  if (k === "gemini" || k.startsWith("gemini-3")) return "gemini";
  if (k === "argon" || k === "gemini-4-argon" || k.startsWith("gemini-4-argon")) return "argon";
  if (
    k === "claude-gpt" ||
    k === "claude_gpt" ||
    k.startsWith("claude-") ||
    k.startsWith("gpt-") ||
    k.startsWith("agy:claude-") ||
    k.startsWith("agy:gpt-")
  ) {
    return "claude-gpt";
  }
  return null;
}

function normalizarIdGrupo(id: string): IdGrupoCupo | null {
  const k = id.toLowerCase();
  if (k === "gemini" || k === "flash" || k === "gemini-3.8-flash") return "gemini";
  if (k === "claude-gpt" || k === "claude_gpt" || k === "claudegpt" || k === "claude") return "claude-gpt";
  if (k === "argon" || k === "gemini-4-argon") return "argon";
  return grupoDeModelo(id);
}

function leerHastaConfig(): Partial<Record<IdGrupoCupo, string>> {
  const dir = process.env.HILOS_CONFIG_DIR || join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "trama");
  for (const arch of [join(dir, "modelos.json"), join(homedir(), ".config", "pa", "modelos.json")]) {
    if (!existsSync(arch)) continue;
    try {
      const raw = JSON.parse(readFileSync(arch, "utf8")) as Record<string, unknown>;
      const cupos = raw.cupos as Record<string, unknown> | undefined;
      const g = (cupos?.google ?? raw.google_hasta) as Record<string, unknown> | undefined;
      if (g && typeof g === "object") {
        const out: Partial<Record<IdGrupoCupo, string>> = {};
        for (const [k, v] of Object.entries(g)) {
          const id = normalizarIdGrupo(k);
          if (id && typeof v === "string" && v.trim()) out[id] = v.trim();
        }
        if (Object.keys(out).length > 0) return out;
      }
    } catch {
      // ignorar
    }
  }
  return { "claude-gpt": "2026-11-02" };
}

function armarGrupos(
  acum: Map<IdGrupoCupo, { semanal?: VentanaCupo; cincoH?: VentanaCupo; hasta?: string }>,
  hastaExtra: Partial<Record<IdGrupoCupo, string>>,
): GrupoCupo[] {
  const res: GrupoCupo[] = [];
  for (const id of ORDEN_GRUPOS) {
    const item = acum.get(id);
    if (!item || !item.semanal) continue;
    const hasta = item.hasta ?? hastaExtra[id];
    res.push({
      id,
      semanal: item.semanal,
      ...(id !== "argon" && item.cincoH ? { cincoH: item.cincoH } : {}),
      ...(hasta ? { hasta } : {}),
    });
  }
  return res;
}

function combinarVentana(a: VentanaCupo | undefined, b: VentanaCupo | undefined): VentanaCupo | undefined {
  if (!a) return b;
  if (!b) return a;
  return b.pct > a.pct ? b : a;
}

/** Parsea la salida JSON de `reparto --cupos --json`. Acepta `grupos` o `modelos` en `suscripciones.google`. */
export function parsearCuposReparto(
  texto: string,
  ahoraMs = Date.now(),
  hastaPorGrupo: Partial<Record<IdGrupoCupo, string>> = { "claude-gpt": "2026-11-02" },
): CuposLeidos | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(texto) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const ts = parseIsoMs(raw.ts) ?? ahoraMs;
  const susc = (raw.suscripciones ?? raw) as Record<string, unknown>;

  let claude: CuposLeidos["claude"];
  const claudeRaw = susc.claude as Record<string, unknown> | undefined;
  if (claudeRaw && typeof claudeRaw === "object" && claudeRaw.ok !== false) {
    const c5 = ventanaDe(claudeRaw.cinco_h ?? claudeRaw.cincoH, ahoraMs);
    const c7 = ventanaDe(claudeRaw.semanal ?? claudeRaw.sieteD ?? claudeRaw.siete_d, ahoraMs);
    if (c5 && c7) {
      claude = {
        cincoH: c5.pct,
        sieteD: c7.pct,
        ...(c5.resetea !== undefined ? { reseteaCincoH: c5.resetea } : {}),
        ...(c7.resetea !== undefined ? { reseteaSieteD: c7.resetea } : {}),
      };
    }
  }

  const googleRaw = susc.google as Record<string, unknown> | undefined;
  const acum = new Map<IdGrupoCupo, { semanal?: VentanaCupo; cincoH?: VentanaCupo; hasta?: string }>();

  if (googleRaw && typeof googleRaw === "object" && googleRaw.ok !== false) {
    const fuenteGrupos = googleRaw.grupos as Record<string, unknown> | unknown[] | undefined;
    if (Array.isArray(fuenteGrupos)) {
      for (const item of fuenteGrupos) {
        if (!item || typeof item !== "object") continue;
        const obj = item as Record<string, unknown>;
        const id = normalizarIdGrupo(String(obj.id ?? obj.grupo ?? ""));
        if (!id) continue;
        const sem = ventanaDe(obj.semanal ?? obj.siete_d, ahoraMs);
        const c5 = ventanaDe(obj.cinco_h ?? obj.cincoH, ahoraMs);
        const hasta = typeof obj.hasta === "string" && obj.hasta.trim() ? obj.hasta.trim() : undefined;
        const prev = acum.get(id) ?? {};
        acum.set(id, {
          semanal: combinarVentana(prev.semanal, sem),
          cincoH: combinarVentana(prev.cincoH, c5),
          hasta: hasta ?? prev.hasta,
        });
      }
    } else if (fuenteGrupos && typeof fuenteGrupos === "object") {
      for (const [k, val] of Object.entries(fuenteGrupos)) {
        const id = normalizarIdGrupo(k);
        if (!id || !val || typeof val !== "object") continue;
        const obj = val as Record<string, unknown>;
        const sem = ventanaDe(obj.semanal ?? obj.siete_d, ahoraMs);
        const c5 = ventanaDe(obj.cinco_h ?? obj.cincoH, ahoraMs);
        const hasta = typeof obj.hasta === "string" && obj.hasta.trim() ? obj.hasta.trim() : undefined;
        const prev = acum.get(id) ?? {};
        acum.set(id, {
          semanal: combinarVentana(prev.semanal, sem),
          cincoH: combinarVentana(prev.cincoH, c5),
          hasta: hasta ?? prev.hasta,
        });
      }
    }

    const modelosRaw = googleRaw.modelos as Record<string, unknown> | undefined;
    if (acum.size === 0 && modelosRaw && typeof modelosRaw === "object") {
      for (const [modeloId, val] of Object.entries(modelosRaw)) {
        const id = grupoDeModelo(modeloId);
        if (!id || !val || typeof val !== "object") continue;
        const obj = val as Record<string, unknown>;
        const sem = ventanaDe(obj.semanal ?? obj.siete_d, ahoraMs);
        const c5 = ventanaDe(obj.cinco_h ?? obj.cincoH, ahoraMs);
        const hasta = typeof obj.hasta === "string" && obj.hasta.trim() ? obj.hasta.trim() : undefined;
        const prev = acum.get(id) ?? {};
        acum.set(id, {
          semanal: combinarVentana(prev.semanal, sem),
          cincoH: combinarVentana(prev.cincoH, c5),
          hasta: hasta ?? prev.hasta,
        });
      }
    }
  }

  const google = armarGrupos(acum, hastaPorGrupo);
  if (!claude && google.length === 0) return null;
  return { ts, ...(claude ? { claude } : {}), google };
}

const RE_LINEA_CUPO = new RegExp("^\\s*([a-z0-9._:-]+?)\\s+(\\d+)%\\s+(.+)$", "i");
const RE_SEMANAL = new RegExp("weekly\\s+(\\d+)%(?:\\s*\\(vuelve\\s+([^)]+)\\))?", "i");
const RE_CINCO_H = new RegExp("5h\\s+(\\d+)%(?:\\s*\\(vuelve\\s+([^)]+)\\))?", "i");

/** Parsea la salida de texto de `pa --cupo-gemini` como fallback. */
export function parsearCupoGemini(
  texto: string,
  ahoraMs = Date.now(),
  hastaPorGrupo: Partial<Record<IdGrupoCupo, string>> = { "claude-gpt": "2026-11-02" },
): CuposLeidos | null {
  const acum = new Map<IdGrupoCupo, { semanal?: VentanaCupo; cincoH?: VentanaCupo; hasta?: string }>();
  for (const linea of texto.split("\n")) {
    const m = RE_LINEA_CUPO.exec(linea);
    if (!m) continue;
    const [, modeloId, pctGralStr, resto] = m;
    const id = grupoDeModelo(modeloId);
    if (!id) continue;
    const mSem = RE_SEMANAL.exec(resto);
    const m5h = RE_CINCO_H.exec(resto);
    const pctSem = mSem ? Number(mSem[1]) : Number(pctGralStr);
    const resSem = mSem?.[2] ? parseIsoMs(mSem[2]) : undefined;
    const semanal: VentanaCupo = {
      pct: Math.max(0, Math.min(100, pctSem)),
      ...(resSem !== undefined
        ? { resetea: resSem, vuelveEnS: Math.max(0, Math.round((resSem - ahoraMs) / 1000)) }
        : {}),
    };
    let cincoH: VentanaCupo | undefined;
    if (m5h) {
      const pct5 = Number(m5h[1]);
      const res5 = m5h[2] ? parseIsoMs(m5h[2]) : undefined;
      cincoH = {
        pct: Math.max(0, Math.min(100, pct5)),
        ...(res5 !== undefined
          ? { resetea: res5, vuelveEnS: Math.max(0, Math.round((res5 - ahoraMs) / 1000)) }
          : {}),
      };
    }
    const prev = acum.get(id) ?? {};
    acum.set(id, {
      semanal: combinarVentana(prev.semanal, semanal),
      cincoH: combinarVentana(prev.cincoH, cincoH),
    });
  }
  const google = armarGrupos(acum, hastaPorGrupo);
  if (google.length === 0) return null;
  return { ts: ahoraMs, google };
}

function binReparto(): string {
  return resolverBinario("reparto", "HILOS_REPARTO", process.env, homedir());
}

function binPa(): string {
  return resolverPa(process.env, homedir());
}

const TTL_CUPOS_MS = 180_000;
let cacheCupos: CuposLeidos | null = null;
let ultimoIntentoMs = 0;
let enVuelo: Promise<CuposLeidos | null> | null = null;
const oyentes = new Set<() => void>();

export function alCambiarCupos(fn: () => void): () => void {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

function notificarCupos(): void {
  for (const fn of oyentes) fn();
}

function modoAisladoSinCupos(): boolean {
  if (process.env.HILOS_REPARTO || process.env.PA_FALSO_CUPO_GEMINI) return false;
  return (
    process.env.HILOS_PRUEBA === "1" ||
    process.env.HILOS_CAPTURA === "1" ||
    process.env.HILOS_BENCH === "1"
  );
}

async function consultarCupos(): Promise<CuposLeidos | null> {
  if (modoAisladoSinCupos()) return null;
  const hasta = leerHastaConfig();
  try {
    const env = entornoPa(process.env, homedir()) as NodeJS.ProcessEnv;
    const { stdout } = await execFileP(binReparto(), ["--cupos", "--json"], {
      env,
      timeout: 6000,
      maxBuffer: 512 * 1024,
    });
    const parsed = parsearCuposReparto(stdout, Date.now(), hasta);
    if (parsed && parsed.google.length > 0) return parsed;
  } catch {
    // fallback a pa --cupo-gemini
  }
  try {
    const env = entornoPa(process.env, homedir()) as NodeJS.ProcessEnv;
    const { stdout } = await execFileP(binPa(), ["--cupo-gemini"], {
      env,
      timeout: 6000,
      maxBuffer: 512 * 1024,
    });
    const parsed = parsearCupoGemini(stdout, Date.now(), hasta);
    if (parsed && parsed.google.length > 0) return parsed;
  } catch {
    // sin cupos disponibles
  }

  // Fallback reactivo con el uso real de Gemini 3.8 Flash desde los transcripts de agy
  const geminiReal = leerUsoGeminiDesdeTranscripts(Date.now());
  if (geminiReal) {
    return {
      ts: Date.now(),
      google: [geminiReal],
    };
  }

  return null;
}

function leerUsoGeminiDesdeTranscripts(ahoraMs: number): GrupoCupo | null {
  const dir = join(ESTADO, "gemini");
  if (!existsSync(dir)) return null;

  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    if (files.length === 0) return null;

    let tokensHoy = 0;
    let tokens5h = 0;
    const medianoche = new Date(ahoraMs);
    medianoche.setHours(0, 0, 0, 0);
    const medianocheMs = medianoche.getTime();
    const cincoHorasAtrasMs = ahoraMs - 5 * 3600 * 1000;

    for (const f of files) {
      const full = join(dir, f);
      const st = statSync(full);
      if (st.mtimeMs < medianocheMs && st.mtimeMs < cincoHorasAtrasMs) continue;

      const lines = readFileSync(full, "utf8").split("\n");
      for (const line of lines) {
        if (!line.includes('"usage"')) continue;
        try {
          const obj = JSON.parse(line);
          const u = obj?.message?.usage || obj?.usage;
          const ts = obj?.timestamp ? new Date(obj.timestamp).getTime() : st.mtimeMs;
          if (u) {
            const tok = (Number(u.input_tokens) || 0) + (Number(u.output_tokens) || 0);
            if (ts >= medianocheMs) tokensHoy += tok;
            if (ts >= cincoHorasAtrasMs) tokens5h += tok;
          }
        } catch {}
      }
    }

    // Cuota estimada para Gemini 3.8 Flash (50M tokens diarios / 15M en ventana de 5h)
    const pctSem = Math.max(1, Math.min(100, Math.round((tokensHoy / 50_000_000) * 100)));
    const pct5h = Math.max(1, Math.min(100, Math.round((tokens5h / 15_000_000) * 100)));
    const msHastaFin = Math.max(1000, 86400000 - (ahoraMs - medianocheMs));
    const vuelveEnS = Math.round(msHastaFin / 1000);

    return {
      id: "gemini",
      semanal: { pct: pctSem, resetea: ahoraMs + msHastaFin, vuelveEnS },
      cincoH: { pct: pct5h, vuelveEnS: Math.min(vuelveEnS, 5 * 3600) },
    };
  } catch {
    return null;
  }
}

/** Dispara un refresco en segundo plano si venció el TTL o si `forzar` es true. */
export function refrescarCupos(forzar = false): Promise<CuposLeidos | null> {
  if (modoAisladoSinCupos()) return Promise.resolve(null);
  const ahora = Date.now();
  if (!forzar && ultimoIntentoMs > 0 && ahora - ultimoIntentoMs < TTL_CUPOS_MS) {
    return Promise.resolve(cacheCupos);
  }
  if (enVuelo) return enVuelo;
  ultimoIntentoMs = ahora;
  enVuelo = consultarCupos()
    .then((res) => {
      enVuelo = null;
      if (res) {
        const previo = JSON.stringify(cacheCupos?.google ?? null);
        const nuevo = JSON.stringify(res.google);
        cacheCupos = res;
        if (previo !== nuevo) notificarCupos();
      }
      return cacheCupos;
    })
    .catch(() => {
      enVuelo = null;
      return cacheCupos;
    });
  return enVuelo;
}

/** Devuelve la última lectura de cupos en caché y dispara un refresco asíncrono si venció el TTL. */
export function cuposGoogleActuales(): CuposLeidos | null {
  if (modoAisladoSinCupos()) return null;
  const ahora = Date.now();
  if (ultimoIntentoMs === 0 || ahora - ultimoIntentoMs >= TTL_CUPOS_MS) {
    void refrescarCupos(false);
  }
  return cacheCupos;
}
