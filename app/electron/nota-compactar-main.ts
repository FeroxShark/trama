// Lógica de «nota-compactar» del lado del main (electron/lider.ts, nucleo.ts y agy-puente.ts):
//   - Decisión pura (`debeAutoCompactar`) de cuándo encolar `/compact` automático tras escribir la nota.
//   - Lectura / escritura de `<estado>/notas/<sid>.md` y renombrado a `<sid>.devuelta.md` al devolverla en motores sin hooks (Gemini).
// Sin imports de Electron: lo prueban tests/nota-compactar-main.test.ts.
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SESION_NOTA_OK = /^[A-Za-z0-9._-]{1,128}$/;

export type UmbralesNota = { fuerte: number; suave: number | null };

export type EntradaAutoCompactar = {
  /** Tokens de contexto vistos en el turno (`null` si no se sabe). */
  uso: number | null;
  /** Umbrales calculados para el modelo del líder (`umbralesNota`). */
  umbrales: UmbralesNota;
  /** `mtimeMs` de `<estado>/notas/<sid>.md`, o `null` si no hay nota guardada. */
  notaMs: number | null;
  /** Cuándo ocurrió la última compactación conocida (`0` si nunca compactó). */
  compactadoMs: number;
  /** Si ya se encoló `/compact` en este ciclo (después de `compactadoMs`). */
  yaEncolado: boolean;
};

/**
 * Decisión pura: si corresponde encolar `/compact` automático al terminar el turno.
 * Se encola UNA vez por ciclo cuando el contexto pasó el umbral efectivo (`suave ?? fuerte`)
 * y existe una nota escrita después de la última compactación.
 */
export function debeAutoCompactar(o: EntradaAutoCompactar): boolean {
  if (o.yaEncolado) return false;
  if (o.uso === null || !Number.isFinite(o.uso)) return false;
  const limite = o.umbrales.suave ?? o.umbrales.fuerte;
  if (!Number.isFinite(limite) || limite <= 0 || o.uso < limite) return false;
  if (o.notaMs === null || !Number.isFinite(o.notaMs)) return false;
  return o.notaMs > o.compactadoMs;
}

const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);

/** Tokens de contexto de un `usage` de la API (`input_tokens + cache_read_input_tokens + cache_creation_input_tokens`). */
export function tokensDeUso(u: unknown): number | null {
  if (!u || typeof u !== "object") return null;
  const r = u as Record<string, unknown>;
  const tiene = ["input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"].some(
    (k) => typeof r[k] === "number" && Number.isFinite(r[k]) && (r[k] as number) >= 0,
  );
  if (!tiene) return null;
  return num(r.input_tokens) + num(r.cache_read_input_tokens) + num(r.cache_creation_input_tokens);
}

/** Tokens de contexto de una línea `stream-json` del líder (ignora subagentes y mensajes sintéticos). */
export function usoDeLineaStream(linea: string): number | null {
  let o: Record<string, any>;
  try {
    o = JSON.parse(linea);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object" || o.parent_tool_use_id) return null;
  if (o.type === "stream_event" && o.event?.type === "message_start") return tokensDeUso(o.event.message?.usage);
  if (o.type === "assistant") {
    if (o.isApiErrorMessage === true || o.message?.model === "<synthetic>") return null;
    return tokensDeUso(o.message?.usage);
  }
  if (o.type === "result") return tokensDeUso(o.usage);
  return null;
}

const RE_NOTA = /\[\[nota-compactar\]\]([\s\S]*?)\[\[\/nota-compactar\]\]/gi;

/** Último bloque `[[nota-compactar]]…[[/nota-compactar]]` no vacío en texto libre; `null` si no hay. */
export function extraerNotaDeTexto(texto: string): string | null {
  if (typeof texto !== "string" || !texto.includes("[[nota-compactar]]")) return null;
  let hallada: string | null = null;
  RE_NOTA.lastIndex = 0;
  for (const m of texto.matchAll(RE_NOTA)) {
    const limpio = m[1].trim();
    if (limpio) hallada = limpio;
  }
  return hallada;
}

export const rutaNota = (estadoDir: string, sid: string): string => path.join(estadoDir, "notas", `${sid}.md`);
export const rutaNotaDevuelta = (estadoDir: string, sid: string): string => path.join(estadoDir, "notas", `${sid}.devuelta.md`);

/** `mtimeMs` de `<estado>/notas/<sid>.md` si existe y no está vacío; si no, `null`. */
export function mtimeNota(estadoDir: string, sid: string): number | null {
  if (!SESION_NOTA_OK.test(sid)) return null;
  try {
    const st = statSync(rutaNota(estadoDir, sid));
    return st.size > 0 ? st.mtimeMs : null;
  } catch {
    return null;
  }
}

/** Escribe `<estado>/notas/<sid>.md` (0600, atómico) sólo si cambió respecto a lo guardado. */
export function guardarNotaSiCambia(estadoDir: string, sid: string, nota: string): boolean {
  if (!SESION_NOTA_OK.test(sid)) return false;
  const limpio = nota.trim();
  if (!limpio) return false;
  const dirNotas = path.join(estadoDir, "notas");
  const destino = rutaNota(estadoDir, sid);
  let actual: string | null = null;
  try {
    actual = readFileSync(destino, "utf8");
  } catch {
    actual = null;
  }
  if (actual === limpio) return false;
  mkdirSync(dirNotas, { recursive: true });
  const tmp = path.join(dirNotas, `.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    writeFileSync(tmp, limpio, { mode: 0o600 });
    try {
      chmodSync(tmp, 0o600);
    } catch {
      /* en Windows el modo POSIX no aplica */
    }
    renameSync(tmp, destino);
  } catch (e) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* nada */
    }
    throw e;
  }
  return true;
}

/**
 * Lee `<estado>/notas/<sid>.md` tras compactar y la renombra a `<sid>.devuelta.md` (pisando una anterior)
 * para que ningún ciclo siguiente vuelva a consumirla por accidente.
 */
export function consumirNotaParaDevolver(
  estadoDir: string,
  sid: string,
  ahoraMs: number = Date.now(),
): { nota: string; minutos: number | null; archivo: string } | null {
  if (!SESION_NOTA_OK.test(sid)) return null;
  const origen = rutaNota(estadoDir, sid);
  const devuelta = rutaNotaDevuelta(estadoDir, sid);
  let nota = "";
  let mtimeMs: number | null = null;
  try {
    nota = readFileSync(origen, "utf8").trim();
    try {
      mtimeMs = statSync(origen).mtimeMs;
    } catch {
      mtimeMs = null;
    }
  } catch {
    return null;
  }
  if (!nota) {
    try {
      rmSync(origen, { force: true });
    } catch {
      /* nada */
    }
    return null;
  }
  let archivo = origen;
  try {
    rmSync(devuelta, { force: true });
    renameSync(origen, devuelta);
    archivo = devuelta;
  } catch {
    /* si falló el rename dejamos archivo apuntando al origen */
  }
  const minutos = mtimeMs !== null ? Math.max(0, Math.floor((ahoraMs - mtimeMs) / 60_000)) : null;
  return { nota, minutos, archivo };
}

/** El idioma de la app (`preferencias.json` de su estado); sin él, el de la terminal; por defecto `es`. */
export function idiomaDeEstado(estadoDir: string, env: NodeJS.ProcessEnv = process.env): "es" | "en" {
  try {
    const p = JSON.parse(readFileSync(path.join(estadoDir, "preferencias.json"), "utf8")) as { idioma?: unknown };
    if (p?.idioma === "es" || p?.idioma === "en") return p.idioma;
  } catch {
    /* nada */
  }
  return /^en/i.test(env.LC_ALL || env.LANG || "") ? "en" : "es";
}

export type TextosNotaMod = {
  TOPE_NOTA: number;
  textoPedidoNota: (o?: { idioma?: string }) => string;
  textoDevolucionNota: (o: { idioma?: string; nota: string; minutos?: number | null; archivo?: string; tope?: number }) => string;
};

let moduloTextos: TextosNotaMod | null = null;
const promesasTextos = new Map<string, Promise<TextosNotaMod>>();

/** Carga `motor/hooks/nota-compactar-textos.mjs` una sola vez por carpeta y lo deja disponible sincrónicamente. */
export function cargarTextosNota(hooksDir: string): Promise<TextosNotaMod> {
  let p = promesasTextos.get(hooksDir);
  if (!p) {
    p = (import(pathToFileURL(path.join(hooksDir, "nota-compactar-textos.mjs")).href) as Promise<TextosNotaMod>).then((m) => {
      moduloTextos = m;
      return m;
    });
    p.catch(() => promesasTextos.delete(hooksDir));
    promesasTextos.set(hooksDir, p);
  }
  return p;
}

/** Lo ya cargado por `cargarTextosNota` (`null` si todavía no se cargó). */
export const textosNotaCargados = (): TextosNotaMod | null => moduloTextos;
