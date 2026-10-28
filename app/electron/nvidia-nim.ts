// NVIDIA NIM (build.nvidia.com): modelos gratis con una API compatible con OpenAI (https://integrate.api.nvidia.com/v1), ~40 pedidos por
// minuto por modelo y sin tope diario publicado; para desarrollo y prototipos. Los workers los corren por el programa `opencode`
// (`pa -m opencode:nvidia/<modelo>`). Acá: qué modelos se ofrecen (`nvidia_modelos` de modelos.json, que lee `reparto`), el estado que ve
// Ajustes y la prueba de la clave. La key (`NVIDIA_API_KEY`) vive en claves.env y nunca sale de acá. Sin Electron.
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { leerClaves, hayClaves, type NombreClave } from "./claves.ts";
import { errorT, textoT } from "./errores.ts";
import { rutaModelosOc } from "./opencode.ts";

type Env = Record<string, string | undefined>;

export const URL_NIM = "https://integrate.api.nvidia.com/v1";
/** Donde se saca la clave gratis. */
export const URL_CLAVE_NIM = "https://build.nvidia.com";
/** El modelo base (el mismo que reparto ofrece sin configurar nada). */
export const MODELO_NIM_BASE = "deepseek-ai/deepseek-v4.1-flash";
/** Pedidos por minuto y por modelo que NVIDIA da gratis. */
export const TOPE_NIM_MIN = 40;
/** Cuántos modelos como máximo (que la lista no crezca sin fin). */
export const MAX_MODELOS_NIM = 20;

/** Un id de modelo de NIM: `organizacion/modelo`; la misma forma que acepta `reparto`. */
export const esIdModeloNim = (v: unknown): v is string => typeof v === "string" && v.length <= 120 && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(v);

export type EstadoNim = {
  version: 1;
  /** Si hay una NVIDIA_API_KEY (guardada o en el entorno); el valor nunca viaja. */
  hayClave: boolean;
  /** Los modelos que reparto ofrece (los prendidos). */
  modelos: string[];
  base: string;
  tope: number;
};

/** Los modelos prendidos que dice modelos.json; sin archivo o sin la clave, el base. `[]` es «todos apagados». */
export function modelosNim(env: Env = process.env, home: string = os.homedir()): string[] {
  try {
    const m = JSON.parse(readFileSync(rutaModelosOc(env, home), "utf8"))?.nvidia_modelos;
    if (Array.isArray(m)) return m.filter(esIdModeloNim);
  } catch {
    /* sin archivo o roto: el base */
  }
  return [MODELO_NIM_BASE];
}

export async function estadoNim(env: Env = process.env, home: string = os.homedir(), claves?: Partial<Record<NombreClave, string>>): Promise<EstadoNim> {
  const guardadas = claves ?? (await leerClaves());
  return { version: 1, hayClave: hayClaves(guardadas, env).NVIDIA_API_KEY, modelos: modelosNim(env, home), base: MODELO_NIM_BASE, tope: TOPE_NIM_MIN };
}

/**
 * Guarda la lista de modelos prendidos en `nvidia_modelos` de modelos.json sin tocar lo demás (tmp + rename). Sin repetidos; valida antes de
 * escribir. La lista base sin cambios saca la clave (el archivo queda como antes). No escribe encima de un archivo roto o de otra versión.
 */
export async function guardarModelosNim(lista: unknown, env: Env = process.env, home: string = os.homedir()): Promise<string[]> {
  if (!Array.isArray(lista) || lista.length > MAX_MODELOS_NIM) throw errorT("main.nimModelos");
  const ids: string[] = [];
  for (const m of lista) {
    if (!esIdModeloNim(m)) throw errorT("main.nimModeloId", { v: String(m).slice(0, 40) });
    if (!ids.includes(m)) ids.push(m);
  }
  const ruta = rutaModelosOc(env, home);
  let texto: string | null = null;
  try {
    texto = await readFile(ruta, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw errorT("main.noLeo", { ruta, e: (e as Error).message });
  }
  let obj: Record<string, unknown> = { version: 1 };
  if (texto !== null) {
    try {
      const j = JSON.parse(texto);
      if (!j || typeof j !== "object" || Array.isArray(j) || j.version !== 1) throw new Error("no es un modelos.json v1");
      obj = j;
    } catch (e) {
      throw errorT("main.modelosRoto", { ruta, e: (e as Error).message });
    }
  }
  const esBase = ids.length === 1 && ids[0] === MODELO_NIM_BASE;
  if (esBase) delete obj.nvidia_modelos;
  else obj.nvidia_modelos = ids;
  if (esBase && texto === null) return ids; // sin archivo y con el base: no se crea nada
  const nuevo = JSON.stringify(obj, null, 2) + "\n";
  if (nuevo !== texto) {
    await mkdir(path.dirname(ruta), { recursive: true });
    const real = texto === null ? ruta : await realpath(ruta);
    const tmp = `${real}.trama-${process.pid}.tmp`;
    await writeFile(tmp, nuevo);
    await rename(tmp, real);
  }
  return ids;
}

export type PruebaNim = { ok: true; modelo: string } | { ok: false; motivo: string };

/**
 * Una llamada mínima (`max_tokens: 1`) a `chat/completions` con la clave (la del entorno gana) y el primer modelo prendido (o el base).
 * Nunca tira por no contestar: devuelve el motivo, que nunca repite la clave. Un 429 también prueba que la clave sirve.
 */
export async function probarNim(
  x: { fetch?: typeof fetch; env?: Env; home?: string; claves?: Partial<Record<NombreClave, string>>; espera_ms?: number } = {},
): Promise<PruebaNim> {
  const env = x.env ?? process.env;
  const clave = env.NVIDIA_API_KEY || (x.claves ?? (await leerClaves())).NVIDIA_API_KEY;
  if (!clave) return { ok: false, motivo: textoT("main.nimSinClave") };
  const modelo = modelosNim(env, x.home)[0] ?? MODELO_NIM_BASE;
  try {
    const r = await (x.fetch ?? fetch)(`${URL_NIM}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${clave}`, "content-type": "application/json" },
      body: JSON.stringify({ model: modelo, messages: [{ role: "user", content: "hola" }], max_tokens: 1 }),
      signal: AbortSignal.timeout(x.espera_ms ?? 20000),
    });
    if (r.ok || r.status === 429) return { ok: true, modelo };
    if (r.status === 401 || r.status === 403) return { ok: false, motivo: textoT("main.nimClaveMala") };
    if (r.status === 404) return { ok: false, motivo: textoT("main.nimModeloNo", { m: modelo }) };
    return { ok: false, motivo: textoT("main.nimHttp", { n: r.status }) };
  } catch (e) {
    const timeout = (e as Error).name === "TimeoutError" || (e as Error).name === "AbortError";
    return { ok: false, motivo: textoT(timeout ? "main.nimTarda" : "main.nimRed") };
  }
}
