// Quién tiene la GPU y cómo liberarla, para el aviso de "no entra" de un modelo local (src/hilo/LiberarVram.tsx). Todo lo hace la
// CLI `vram` de `~/Proyectos/modos` (`vram --json`: la lista; `vram liberar <id> --json`: baja UNO): acá sólo se lee su JSON, se
// descarta lo que no se debe ofrecer y se la llama con el id que el usuario tocó. Liberar para un servicio de verdad (Handy, el TTS),
// así que sólo corre con su clic y sobre un id que la lista de AHORA ofrece; nunca se prueba con la CLI real (tests/vram.test.ts
// le pasa `Deps` falsos). Sin `electron`.
import path from "node:path";
import { resolverBinario } from "./binario.ts";
import { errorT } from "./errores.ts";
import { depsDeVerdad, type Deps } from "./locales.ts";

/** Los servicios con menos que esto no cambian si un modelo entra o no: no se ofrecen (ruido en la lista). */
export const MIN_MIB = 256;
/** `vram liberar` espera hasta 15 s a que los procesos se vayan de la GPU. */
const LIBERAR_ESPERA_MS = 40_000;

export type ConsumidorVram = {
  /** El que entiende `vram liberar` (`handy.service`, `pid:123`). */
  id: string;
  nombre: string;
  miB: number;
  tipo: string;
  /** Cómo lo libera la CLI: `stop`, `restart` (el TTS Qwen: carga perezosa, sigue disponible), `term`. */
  accion: string;
};
export type EstadoVram = { totalMiB: number; libreMiB: number; consumidores: ConsumidorVram[] };
export type ResultadoLiberar = {
  ok: boolean;
  id: string;
  nombre: string;
  liberadoMiB: number | null;
  libreMiB: number | null;
  /** Lo que dijo la CLI (tal cual, no se traduce) o una clave `main.*` ya armada con `errorT`. */
  error: string | null;
};

async function binario(d: Deps): Promise<string> {
  if (d.env.HILOS_VRAM) return d.env.HILOS_VRAM;
  const propio = path.join(d.home, "Proyectos", "modos", "vram");
  return (await d.tamano(propio)) != null ? propio : resolverBinario("vram", "HILOS_VRAM", d.env, d.home);
}

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
const texto = (x: unknown) => (typeof x === "string" ? x : "");

/** Lo mismo que trama: parar `trama-motor` o el proceso que corre esto cortaría a los líderes y al celular. */
const esTrama = (c: { unit?: unknown; id?: unknown; pids?: unknown }) =>
  /^trama(-|\.|$)/.test(texto(c.unit) || texto(c.id)) ||
  (Array.isArray(c.pids) && c.pids.some((p) => p === process.pid || p === process.ppid));

/**
 * La salida de `vram --json` → lo que se ofrece: sólo lo liberable, sin el llama-server (es el que el modelo reemplaza: la cuenta
 * del contexto ya no lo cuenta), sin trama misma y sin lo diminuto. De mayor a menor. `null` si no es lo que la CLI dice que devuelve.
 */
export function parsearVram(salida: string): EstadoVram | null {
  let j: { gpu?: Record<string, unknown>; consumidores?: unknown } | null;
  try {
    j = JSON.parse(salida);
  } catch {
    return null;
  }
  if (!j || typeof j !== "object" || !j.gpu || !Array.isArray(j.consumidores)) return null;
  const consumidores: ConsumidorVram[] = [];
  for (const c of j.consumidores as Record<string, unknown>[]) {
    if (!c || c.liberable !== true || c.tipo === "llama-server" || esTrama(c) || !texto(c.id)) continue;
    const miB = num(c.mib);
    if (miB < MIN_MIB) continue;
    consumidores.push({ id: texto(c.id), nombre: texto(c.nombre) || texto(c.id), miB, tipo: texto(c.tipo), accion: texto(c.accion) });
  }
  consumidores.sort((a, b) => b.miB - a.miB);
  return { totalMiB: num(j.gpu.total_mib), libreMiB: num(j.gpu.libre_mib), consumidores };
}

/** Lista lo que se puede liberar ahora. No toca nada. */
export async function leerVram(d: Deps = depsDeVerdad()): Promise<EstadoVram> {
  let salida: string;
  try {
    salida = await d.ejecutar(await binario(d), ["--json"], { timeout: 15_000 });
  } catch {
    throw errorT("main.vramSinCli");
  }
  const e = parsearVram(salida);
  if (!e) throw errorT("main.vramSalidaRara");
  return e;
}

let liberando = false;

/** El JSON que escribe `vram liberar --json`, también cuando sale con 1, 2 o 3 (`execFile` rechaza pero trae el stdout). */
const jsonDe = (x: unknown): Record<string, unknown> | null => {
  const s = typeof x === "string" ? x : String((x as { stdout?: unknown } | null)?.stdout ?? "");
  try {
    const j = JSON.parse(s);
    return j && typeof j === "object" ? j : null;
  } catch {
    return null;
  }
};

/**
 * Libera UN servicio (`vram liberar <id>`): sólo si la lista de ahora lo ofrece (un id que no está, o que es de trama, no llega a la
 * CLI), de a uno. SÓLO con el clic del usuario: para o reinicia un servicio de verdad.
 */
export async function liberarVram(x: unknown, d: Deps = depsDeVerdad()): Promise<ResultadoLiberar> {
  const id = typeof (x as { id?: unknown } | null)?.id === "string" ? (x as { id: string }).id : "";
  if (!id) throw errorT("main.vramNoLiberable");
  if (liberando) throw errorT("main.vramOcupado");
  liberando = true;
  try {
    const ofrece = (await leerVram(d)).consumidores.find((c) => c.id === id);
    if (!ofrece) throw errorT("main.vramNoLiberable");
    const bin = await binario(d);
    let j: Record<string, unknown> | null;
    try {
      j = jsonDe(await d.ejecutar(bin, ["liberar", id, "--json"], { timeout: LIBERAR_ESPERA_MS }));
    } catch (e) {
      j = jsonDe(e);
      if (!j) throw errorT("main.vramSinCli");
    }
    const ok = j?.ok === true;
    return {
      ok,
      id,
      nombre: texto(j?.nombre) || ofrece.nombre,
      liberadoMiB: ok ? num(j?.liberado_mib) : null,
      libreMiB: j && "libre_mib" in j ? num(j.libre_mib) : null,
      error: ok ? null : texto(j?.error) || null,
    };
  } finally {
    liberando = false;
  }
}
