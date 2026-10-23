// Cuánto tarda el reinicio por un build nuevo, paso por paso. Cada proceso que participa (el motor, la
// ventana que se va, la que llega, y la página) anota una marca en `$HILOS_STATE/reinicio-marcas` con la hora,
// quién y qué paso, y la deja también en su log (`[reinicio] +1234 ms motor lideres-cerrados`). El tiempo
// corre desde `inicio`: el momento en que el reinicio deja de esperar y sale. Sin cargar nada: una línea por
// marca, y las del arranque sólo existen si hay un reinicio en marcha (de hace menos de `VALE_MS` y sin `lista`).
// La misma marca le dice a la ventana que llega que viene de una actualización (muestra el cartel desde el primer
// cuadro: `src/actualizando.ts`) y, con `via`, si tiene que esperar al motor antes de decidir cómo arrancar.
// Puro (sólo `node:fs`, el log y el estado): lo prueba tests/reinicio-marcas.test.ts; lo lee scripts/medir-reinicio.mjs.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ESTADO } from "./estado.js";
import { log } from "./log.js";

export const MARCAS = path.join(ESTADO, "reinicio-marcas");
/** Un reinicio más viejo que esto no cuenta: es de otro día, no de la ventana que está arrancando. */
const VALE_MS = 2 * 60_000;

export type Quien = "motor" | "ventana" | "pagina";
/** `motor`: lo reinicia el motor (la ventana es su cliente y vuelve sola); `ventana`: todo en uno. */
export type Via = "motor" | "ventana";
export type Marca = { t: number; quien: string; pid: number; paso: string };
export type Corrida = { t0: number; via: Via; marcas: Marca[]; lista: boolean };

/** Lo que dice el archivo: la corrida más reciente (empieza en el último `inicio`). */
export function analizar(texto: string): Corrida | null {
  let corrida: Corrida | null = null;
  for (const linea of texto.split("\n")) {
    const [t, quien, pid, paso, extra] = linea.trim().split(/\s+/);
    if (!paso || !Number.isFinite(Number(t))) continue;
    const m: Marca = { t: Number(t), quien, pid: Number(pid) || 0, paso };
    if (paso === "inicio") corrida = { t0: m.t, via: extra === "ventana" ? "ventana" : "motor", marcas: [m], lista: false };
    else if (corrida) {
      corrida.marcas.push(m);
      if (paso === "lista") corrida.lista = true;
    }
  }
  return corrida;
}

function leer(archivo: string): Corrida | null {
  try {
    return analizar(readFileSync(archivo, "utf8"));
  } catch {
    return null;
  }
}

/** El reinicio en marcha, si lo hay: empezó hace poco y todavía no llegó a `lista`. */
export function enMarcha(archivo = MARCAS, ahora = Date.now()): Corrida | null {
  const c = leer(archivo);
  return c && !c.lista && ahora - c.t0 < VALE_MS ? c : null;
}

function anotar(archivo: string, quien: string, paso: string, t: number, extra = "") {
  try {
    mkdirSync(path.dirname(archivo), { recursive: true });
    appendFileSync(archivo, `${t} ${quien} ${process.pid} ${paso}${extra ? ` ${extra}` : ""}\n`);
  } catch {
    // Medir no puede romper un reinicio.
  }
}

/** El reinicio deja de esperar y sale: empieza una corrida nueva (la anterior se borra). */
export function empezar(quien: Quien, via: Via, archivo = MARCAS, t = Date.now()) {
  try {
    mkdirSync(path.dirname(archivo), { recursive: true });
    writeFileSync(archivo, "");
  } catch {}
  anotar(archivo, quien, "inicio", t, via);
  log.escribir("info", "reinicio", `+0 ms ${quien} inicio (${via})`);
}

/**
 * Una marca de un reinicio en marcha; sin ninguno no hace nada. Devuelve los ms desde `inicio` (o `null`).
 * `t` es la hora de verdad del paso si se sabe de antes (cuándo arrancó el proceso).
 */
export function marcar(quien: Quien, paso: string, archivo = MARCAS, t = Date.now()): number | null {
  const c = enMarcha(archivo, t);
  if (!c) return null;
  anotar(archivo, quien, paso, t);
  const ms = t - c.t0;
  log.escribir("info", "reinicio", `+${ms} ms ${quien} ${paso}`);
  if (paso === "lista") log.escribir("info", "reinicio", resumen({ ...c, lista: true, marcas: [...c.marcas, { t, quien, pid: process.pid, paso }] }));
  return ms;
}

/** Una línea por paso con lo que tardó desde el anterior: lo que se lee en el log y en scripts/medir-reinicio.mjs. */
export function resumen(c: Corrida): string {
  const ms = c.marcas.map((m, i) => ({ ...m, desde: m.t - (c.marcas[i - 1]?.t ?? m.t), total: m.t - c.t0 }));
  return `reinicio completo en ${ms.at(-1)?.total ?? 0} ms: ${ms.map((m) => `${m.paso} +${m.desde}`).join(", ")}`;
}
