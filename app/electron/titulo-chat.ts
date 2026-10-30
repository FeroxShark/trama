// El título corto de un chat (líder) que nadie nombró: ≤6 palabras que dicen el tema, de una sola llamada barata (Haiku) tras el
// primer intercambio. Se guarda por sesión en `titulos-auto.json` (el estado de la app) y sin modelo o si falla, el título sale del
// primer mensaje recortado (`tituloCorto`, tema.ts). Nunca pisa un título puesto por la persona: eso lo decide `tituloLider`
// (el /rename y el de la barra, `nombres.json`, ganan siempre) y `generarSiHaceFalta` ni llama si ya hay uno propio. Lo puro lo
// prueba `tests/titulo-chat.test.ts`.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ESTADO, escribirAtomico } from "./pa.ts";
import { type Tema, tienePropio, tituloCorto } from "./tema.ts";

export const PALABRAS_MAX = 6;
const TITULO_MAX = 60;
const MODELO_BARATO = "claude-haiku-5-5";
const ESPERA_MS = 30_000;
const INTENTOS_MAX = 2;
/** Cuánto del primer mensaje se le muestra al modelo: el tema se ve en el principio. */
const ENTRADA_MAX = 600;

/** Lo que se le pide al modelo: sólo el título, en el idioma del mensaje, sin herramientas. */
export function pedidoTitulo(primero: string): string {
  return [
    `Escribí un título de ${PALABRAS_MAX} palabras o menos que diga de qué trata esta conversación, en el idioma del mensaje.`,
    "Contestá sólo con el título: sin comillas, sin punto final, sin saludo.",
    "No uses herramientas ni etiquetas: es texto plano, sin llaves ni signos de menor.",
    "",
    "Mensaje:",
    primero.slice(0, ENTRADA_MAX),
  ].join("\n");
}

/** Rastro de una llamada a herramienta o de una plantilla (`<invoke_tool name="Read">`): nunca es un título. */
const RASTRO = /[<{}]|invoke|tool/i;
export const esBasura = (t: string) => RASTRO.test(t);

/** Un título que se puede mostrar: una frase corta de texto, sin rastro de herramienta. */
export const tituloValido = (t: string) => t.length <= TITULO_MAX && t.split(/\s+/).length <= PALABRAS_MAX && !esBasura(t);

/** Lo que dijo el modelo como título, o `null` si no sirve (vacío, una frase larga, una disculpa en varias líneas, una llamada a herramienta). */
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
  if (!t || !tituloValido(t)) return null;
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

/** El título generado de una sesión (`undefined` si todavía no hay, o si lo guardado tiene rastro de herramienta: no se muestra). */
export const generadoDe = (sid: string) => {
  const g = guardados?.[sid];
  return g && !esBasura(g) ? g : undefined;
};
export const cargarGenerados = async () => (guardados ??= await leerTitulosAuto());

type Opciones = { correr?: (prompt: string) => Promise<string>; guardar?: (t: TitulosAuto) => Promise<void> };

/**
 * Si el chat ya tuvo su primer intercambio, nadie lo nombró (ni Claude Code ni la persona) y no hay un título generado, pide
 * uno. Sin esperar: la barra muestra el recorte local hasta que llega. Devuelve la promesa sólo para los tests.
 */
export function generarSiHaceFalta(sid: string, t: Pick<Tema, "custom" | "ai" | "primero" | "respondio">, sesion: string, o: Opciones = {}): Promise<void> | null {
  const guardar = o.guardar ?? ((x: TitulosAuto) => escribirAtomico(RUTA, JSON.stringify(x)));
  // Un título guardado con rastro de herramienta (de antes de validar la salida): vuelve al respaldo, sin llamar al modelo.
  if (guardados?.[sid] !== undefined && esBasura(guardados[sid])) return corregirBasura(sid, t, sesion, guardar);
  if (!t.primero || !t.respondio || tienePropio(t, sesion) || guardados?.[sid] || enCurso.has(sid)) return null;
  if ((intentos.get(sid) ?? 0) >= INTENTOS_MAX) return null;
  intentos.set(sid, (intentos.get(sid) ?? 0) + 1);
  enCurso.add(sid);
  const correr = o.correr ?? correrBarato;
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

/**
 * El título guardado con rastro de herramienta se cambia por el respaldo (el recorte del primer mensaje, `tituloCorto`) y se guarda.
 * Sin primer mensaje todavía no hay respaldo: queda como está (no se muestra, `generadoDe`). Lo que puso la persona (`tienePropio`)
 * no se toca: ni lo reescribe ni lo pisa.
 */
function corregirBasura(sid: string, t: Pick<Tema, "custom" | "ai" | "primero">, sesion: string, guardar: (t: TitulosAuto) => Promise<void>): Promise<void> | null {
  if (!t.primero || tienePropio(t, sesion)) return null;
  const nuevos = { ...(guardados ?? {}), [sid]: tituloCorto(t.primero) };
  guardados = nuevos;
  return guardar(nuevos).catch(() => {});
}

/** Sólo para los tests: vuelve al estado inicial (o al que se le pasa, para probar lo ya guardado). */
export function reiniciarTitulos(inicial: TitulosAuto | null = null): void {
  enCurso.clear();
  intentos.clear();
  guardados = inicial;
}
