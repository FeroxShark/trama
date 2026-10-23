// Dictar: el audio que grabó la caja de un líder (WAV 16 kHz mono, convertido en el cliente: src/hilo/dictado.ts)
// llega por el RPC de siempre, se deja un momento en `$XDG_RUNTIME_DIR/trama/` y `handy --transcribe-file`
// devuelve el texto. Sin `--model`: Handy usa el modelo que el usuario tiene elegido. El texto vuelve a la caja, no se manda.
// Una transcripción a la vez (un Handy cargando un modelo ya es bastante) y el archivo se borra pase lo que pase.
// Sin `electron`: lo prueba tests/dictado.test.ts con un `handy` falso (`ejecutar`), nunca el de verdad.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolverBinario } from "./binario.ts";
import { errorT } from "./errores.ts";

/** Lo más que se graba (el tope de la caja): 5 min. */
export const DICTADO_MAX_S = 300;
/** Lo que pide `handy --transcribe-file`. */
export const WAV_HZ = 16000;
/** Cuánto se espera a Handy. */
export const DICTADO_TIMEOUT_MS = 120_000;
/** Cabecera de 44 bytes + 5 min de PCM de 16 bits, y un segundo de margen. */
export const WAV_MAX = 44 + WAV_HZ * 2 * (DICTADO_MAX_S + 1);

/** Cómo se corre un programa: lo que se reemplaza en las pruebas. Devuelve su stdout; si falla, rechaza como `execFile`. */
export type Ejecutar = (bin: string, args: string[], o: { timeout: number }) => Promise<string>;

/**
 * Handy es una app Tauri: aun headless levanta GTK y sin pantalla entra en pánico ("Failed to initialize gtk backend").
 * El motor corre bajo systemd sin sesión gráfica, así que su entorno no trae `WAYLAND_DISPLAY` ni `DISPLAY`: se
 * completan con lo que hay en `$XDG_RUNTIME_DIR` (socket `wayland-N`) o en `/tmp/.X11-unix` (X sólo si no hay Wayland).
 */
export function entornoGrafico(env: NodeJS.ProcessEnv = process.env, uid: number = process.getuid?.() ?? 1000, x11 = "/tmp/.X11-unix"): NodeJS.ProcessEnv {
  const salida = { ...env };
  const lista = (d: string) => {
    try {
      return readdirSync(d).sort();
    } catch {
      return [];
    }
  };
  const run = salida.XDG_RUNTIME_DIR || `/run/user/${uid}`;
  if (!salida.XDG_RUNTIME_DIR) salida.XDG_RUNTIME_DIR = run;
  if (!salida.WAYLAND_DISPLAY && !salida.DISPLAY) {
    const wl = lista(run).find((f) => /^wayland-\d+$/.test(f));
    if (wl) salida.WAYLAND_DISPLAY = wl;
    else {
      const x = lista(x11).find((f) => /^X\d+$/.test(f));
      if (x) salida.DISPLAY = `:${x.slice(1)}`;
    }
  }
  return salida;
}

const ejecutarDeVerdad: Ejecutar = (bin, args, o) =>
  new Promise((ok, mal) => {
    execFile(bin, args, { timeout: o.timeout, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024, env: entornoGrafico() }, (e, stdout, stderr) => {
      if (!e) return ok(String(stdout));
      // Lo que dijo Handy sirve para el mensaje: pegado al error, sin las 20 líneas de log.
      (e as Error & { stderr?: string }).stderr = String(stderr).trim().split("\n").slice(-3).join(" ").slice(0, 300);
      mal(e);
    });
  });

/** `handy`: `HILOS_HANDY`, el del PATH o `~/.local/bin/handy`. */
export const binarioHandy = (env: NodeJS.ProcessEnv = process.env) => resolverBinario("handy", "HILOS_HANDY", env, os.homedir());

/** El WAV de un pedido, validado: bytes, PCM de 16 bits, 1 canal, 16 kHz y no más de 5 min. */
export function wavDe(x: unknown): Uint8Array {
  const datos = (x as { datos?: unknown } | null)?.datos;
  if (!(datos instanceof Uint8Array)) throw errorT("main.dictadoRaro");
  if (datos.byteLength > WAV_MAX) throw errorT("main.dictadoLargo", { n: DICTADO_MAX_S / 60 });
  if (datos.byteLength < 44) throw errorT("main.dictadoRaro");
  const v = new DataView(datos.buffer, datos.byteOffset, datos.byteLength);
  const tag = (o: number) => String.fromCharCode(datos[o], datos[o + 1], datos[o + 2], datos[o + 3]);
  const bien =
    tag(0) === "RIFF" && tag(8) === "WAVE" && tag(12) === "fmt " && v.getUint16(20, true) === 1 && v.getUint16(22, true) === 1 && v.getUint32(24, true) === WAV_HZ && v.getUint16(34, true) === 16;
  if (!bien) throw errorT("main.dictadoRaro");
  return datos;
}

/** El texto que dejó Handy: su stdout sin los renglones vacíos; si dijo un JSON con `text`, ése. */
export function textoDe(stdout: string): string {
  const crudo = stdout.trim();
  if (crudo.startsWith("{")) {
    try {
      const j = JSON.parse(crudo) as { text?: unknown; transcription?: unknown };
      const t = typeof j.text === "string" ? j.text : typeof j.transcription === "string" ? j.transcription : null;
      if (t !== null) return t.trim();
    } catch {
      // no era JSON: se toma tal cual
    }
  }
  return crudo
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ");
}

export type OpcionesDictado = {
  /** Dónde se deja el WAV un momento (`$XDG_RUNTIME_DIR/trama/`). */
  dir: string;
  bin?: string;
  ejecutar?: Ejecutar;
  timeoutMs?: number;
};

/** Para que haya una sola a la vez. */
let cola: Promise<unknown> = Promise.resolve();

/** Transcribe el WAV de un pedido (`{ datos }`) y devuelve el texto. Los errores van como clave de `main.dictado*`. */
export function transcribir(x: unknown, o: OpcionesDictado): Promise<string> {
  const datos = wavDe(x);
  const una = cola.then(() => correr(datos, o));
  cola = una.catch(() => {});
  return una;
}

async function correr(datos: Uint8Array, o: OpcionesDictado): Promise<string> {
  await mkdir(o.dir, { recursive: true, mode: 0o700 });
  const archivo = path.join(o.dir, `dictado-${randomUUID()}.wav`);
  await writeFile(archivo, datos, { mode: 0o600 });
  const timeout = o.timeoutMs ?? DICTADO_TIMEOUT_MS;
  try {
    const salida = await (o.ejecutar ?? ejecutarDeVerdad)(o.bin ?? binarioHandy(), ["--transcribe-file", archivo], { timeout });
    const texto = textoDe(salida);
    if (!texto) throw errorT("main.dictadoVacio");
    return texto;
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { killed?: boolean; signal?: string; stderr?: string };
    if (err.message?.startsWith("\u0001")) throw err;
    if (err.code === "ENOENT") throw errorT("main.dictadoFalta");
    if (err.killed || err.signal === "SIGKILL" || err.code === "ETIMEDOUT") throw errorT("main.dictadoTiempo", { n: Math.round(timeout / 1000) });
    throw errorT("main.dictadoFalla", { motivo: err.stderr || err.message || String(e) });
  } finally {
    await rm(archivo, { force: true });
  }
}
