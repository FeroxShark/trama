// Lo que comparten las pruebas de dsh (acp, puente, runner): encontrar un `dsh` de verdad, un servidor OpenAI falso
// (scripts/openai-falso.mjs) y un HOME/DSH_HOME de mentira. Nunca toca el `~` ni el `~/.dsh` reales. No es una prueba.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import zlib from "node:zlib";

/** El `dsh` para las pruebas: `TRAMA_DSH_BIN`, el de `app/node_modules`, o el del PATH. `null`: se saltean. */
export function buscarDsh(): string | null {
  const candidatos = [
    process.env.TRAMA_DSH_BIN,
    path.join(import.meta.dirname, "..", "node_modules", ".bin", "dsh"),
    ...(process.env.PATH ?? "").split(path.delimiter).map((d) => path.join(d, "dsh")),
  ];
  return candidatos.find((c): c is string => !!c && existsSync(c)) ?? null;
}

export const DSH = buscarDsh();
/** Para `{ skip: SIN_DSH }`: el motivo si no hay dsh, `false` si lo hay. */
export const SIN_DSH: string | false = DSH ? false : "no hay un binario `dsh` (npm i @deepseek-ai/dsh, o TRAMA_DSH_BIN=<ruta>)";

export const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function hasta(f: () => boolean, ms = 30_000, que = "no pasó a tiempo") {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error(que);
    await espera(25);
  }
}

export type Falso = { baseURL: string; log: string; pedidos: () => any[]; cerrar: () => void };

/** Arranca scripts/openai-falso.mjs en un puerto libre; `extra` se suma a su entorno (OPENAI_FALSO_MS_LENTO…). */
export async function arrancarFalso(dir: string, extra: Record<string, string> = {}): Promise<Falso> {
  const log = path.join(dir, `pedidos-${Math.random().toString(36).slice(2, 8)}.jsonl`);
  const p: ChildProcess = spawn(process.execPath, [path.join(import.meta.dirname, "..", "scripts", "openai-falso.mjs")], {
    env: { ...process.env, OPENAI_FALSO_LOG: log, OPENAI_FALSO_MODELO: "fake-model", ...extra },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const baseURL = await new Promise<string>((ok, mal) => {
    const rl = createInterface({ input: p.stdout! });
    rl.once("line", (l) => ok(JSON.parse(l).baseURL));
    p.once("error", mal);
    p.once("exit", () => mal(new Error("el servidor falso se fue")));
  });
  return {
    baseURL,
    log,
    // Sólo los pedidos de chat del agente (los que llevan herramientas); el del título de sesión no.
    pedidos: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []).filter((r) => Array.isArray(r.body?.tools) && r.body.tools.length),
    cerrar: () => p.kill("SIGKILL"),
  };
}

/** Un HOME y un DSH_HOME de mentira, y una carpeta de trabajo (el cwd del agente). */
export function entornoTmp(prefijo: string) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), `${prefijo}-`));
  const home = path.join(tmp, "home");
  const trabajo = path.join(tmp, "trabajo");
  mkdirSync(trabajo, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { tmp, home, trabajo, dshHome: path.join(home, ".dsh") };
}

/** El texto de lo que se le pidió al modelo (los mensajes de usuario del último pedido, sin el contexto que dsh agrega). */
export function usuarios(pedido: any): string[] {
  const aTexto = (c: any) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((p: any) => (p?.type === "text" ? p.text : p?.type === "image_url" ? "[imagen]" : "")).join("") : "");
  return (pedido.body.messages as any[]).filter((m) => m.role === "user").map((m) => aTexto(m.content)).filter((t) => !t.startsWith("Current runtime context"));
}

/** Un PNG de verdad (8x8 rojo, con CRC y zlib válidos): dsh decodifica las imágenes con sharp y rechaza uno armado a mano. */
export function pngValido(): Buffer {
  const trozo = (tipo: string, datos: Buffer) => {
    const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(datos.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(cuerpo));
    return Buffer.concat([len, cuerpo, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(8, 0);
  ihdr.writeUInt32BE(8, 4);
  ihdr[8] = 8; // profundidad
  ihdr[9] = 2; // RGB
  const fila = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: 8 }, () => [255, 0, 0]).flat())]);
  const crudo = Buffer.concat(Array.from({ length: 8 }, () => fila));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), trozo("IHDR", ihdr), trozo("IDAT", zlib.deflateSync(crudo)), trozo("IEND", Buffer.alloc(0))]);
}
