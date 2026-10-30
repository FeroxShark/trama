// El título corto de un chat (líder) que nadie nombró: ≤6 palabras que dicen el tema, de una sola llamada barata (Haiku) tras el
// primer intercambio. Se guarda por sesión en `titulos-auto.json` (el estado de la app) y sin modelo o si falla, el título sale del
// primer mensaje recortado (`tituloCorto`, tema.ts). Nunca pisa un título puesto por la persona: eso lo decide `tituloLider`
// (el /rename y el de la barra, `nombres.json`, ganan siempre) y `generarSiHaceFalta` ni llama si ya hay uno propio. Lo puro lo
// prueba `tests/titulo-chat.test.ts`.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ESTADO, escribirAtomico } from "./pa.ts";
import { type Tema, tienePropio } from "./tema.ts";

export const PALABRAS_MAX = 6;
const TITULO_MAX = 60;
const MODELO_BARATO = "claude-haiku-5-5";
const ESPERA_MS = 30_000;
const INTENTOS_MAX = 2;
/** Cuánto del primer mensaje se le muestra al modelo: el tema se ve en el principio. */
const ENTRADA_MAX = 600;

/** Lo que se le pide al modelo: sólo el título, en el idioma del mensaje. */
export function pedidoTitulo(primero: string): string {
  return [
    `Escribí un título de ${PALABRAS_MAX} palabras o menos que diga de qué trata esta conversación, en el idioma del mensaje.`,
    "Contestá sólo con el título: sin comillas, sin punto final, sin saludo.",
    "",
    "Mensaje:",
    primero.slice(0, ENTRADA_MAX),
  ].join("\n");
}

/** Lo que dijo el modelo como título, o `null` si no sirve (vacío, una frase larga, una disculpa en varias líneas). */
export function limpiarTitulo(salida: string): string | null {
  const l = salida
    .split("\n")
    .map((x) => x.trim())
    .find((x) => x !== "");
  if (!l) return null;
  const t = l
    .replace(/^(?:t[ií]tulo|title)\s*:\s*/i, "")
    .replace(/^["'“”«`*#\s]+|["'“”»`*\s]+$/gu, "")
    .replace(/[.!…]+$/u, "")
    .trim();
  if (!t || t.length > TITULO_MAX || t.split(/\s+/).length > PALABRAS_MAX + 2) return null;
  return t[0].toLocaleUpperCase() + t.slice(1);
}

export type TitulosAuto = Record<string, string>;
const RUTA = path.join(ESTADO, "titulos-auto.json");

/** Lo generado por sesión; vacío si no hay archivo o está roto. */
export const leerTitulosAuto = async (ruta = RUTA): Promise<TitulosAuto> => {
  const o = await readFile(ruta, "utf8").then((t) => JSON.parse(t), () => null);
  return o && typeof o === "object" && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "")) : {};
};

/** `claude -p` con Haiku, un turno, sin herramientas ni sesión guardada: lo mínimo que gasta una llamada. Rechaza si falla o tarda. */
export function correrBarato(prompt: string): Promise<string> {
  return new Promise((ok, no) => {
    const p = spawn(process.env.HILOS_CLAUDE ?? "claude", ["-p", "--model", MODELO_BARATO, "--max-turns", "1", "--tools", "", "--no-session-persistence", "--disable-slash-commands"], {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    let out = "";
    const t = setTimeout(() => {
      p.kill();
      no(new Error("sin respuesta"));
    }, ESPERA_MS);
    p.stdout!.setEncoding("utf8");
    p.stdout!.on("data", (x: string) => (out += x));
    p.on("error", (e) => {
      clearTimeout(t);
      no(e);
    });
    p.on("close", (rc) => {
      clearTimeout(t);
      rc === 0 ? ok(out) : no(new Error(`salió ${rc}`));
    });
    p.stdin!.on("error", () => {});
    p.stdin!.end(prompt);
  });
}

const enCurso = new Set<string>();
const intentos = new Map<string, number>();
let guardados: TitulosAuto | null = null;

/** El título generado de una sesión (`undefined` si todavía no hay). */
export const generadoDe = (sid: string) => guardados?.[sid];
export const cargarGenerados = async () => (guardados ??= await leerTitulosAuto());

type Opciones = { correr?: (prompt: string) => Promise<string>; guardar?: (t: TitulosAuto) => Promise<void> };

/**
 * Si el chat ya tuvo su primer intercambio, nadie lo nombró (ni Claude Code ni la persona) y no hay un título generado, pide
 * uno. Sin esperar: la barra muestra el recorte local hasta que llega. Devuelve la promesa sólo para los tests.
 */
export function generarSiHaceFalta(sid: string, t: Pick<Tema, "custom" | "ai" | "primero" | "respondio">, sesion: string, o: Opciones = {}): Promise<void> | null {
  if (!t.primero || !t.respondio || tienePropio(t, sesion) || guardados?.[sid] || enCurso.has(sid)) return null;
  if ((intentos.get(sid) ?? 0) >= INTENTOS_MAX) return null;
  intentos.set(sid, (intentos.get(sid) ?? 0) + 1);
  enCurso.add(sid);
  const correr = o.correr ?? correrBarato;
  const guardar = o.guardar ?? ((x: TitulosAuto) => escribirAtomico(RUTA, JSON.stringify(x)));
  return correr(pedidoTitulo(t.primero))
    .then(async (salida) => {
      const titulo = limpiarTitulo(salida);
      if (!titulo) return;
      guardados = { ...(guardados ?? {}), [sid]: titulo };
      await guardar(guardados);
    })
    .catch(() => {})
    .finally(() => enCurso.delete(sid));
}

/** Sólo para los tests: vuelve al estado inicial. */
export function reiniciarTitulos(): void {
  enCurso.clear();
  intentos.clear();
  guardados = null;
}
