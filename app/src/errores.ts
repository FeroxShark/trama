// La red de contención del renderer: lo que salta sin que nadie lo atrape (`error`, `unhandledrejection`)
// y lo que atrapa el ErrorBoundary se reenvía al log del main (`window.hilos.bitacora`, electron/log.ts).
// Sin esto una ventana en blanco no dejaba rastro. Las capturas y mediciones no reportan.
import { MODO } from "./modo";
import { main } from "./puente";

/** Un error (o lo que se haya tirado) como texto, con su stack si lo tiene. */
export function detalleDe(e: unknown): string {
  if (e instanceof Error) return e.stack && e.stack.includes(e.message) ? e.stack : `${e.name}: ${e.message}\n${e.stack ?? ""}`.trimEnd();
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e) ?? String(e);
  } catch {
    return String(e);
  }
}

/** Lo que pasó en una línea (la del cartel): el mensaje, sin el stack, acotado. */
export function lineaDe(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === "string" ? e : detalleDe(e);
  const una = m.split("\n").find((l) => l.trim()) ?? "";
  return una.length > 200 ? `${una.slice(0, 200)}…` : una;
}

const POR_MINUTO = 30;
const IGUAL_MS = 5000;
const vistos = new Map<string, number>();
let desde = 0;
let enviados = 0;

/** Al log del main. Un error que se repite en bucle (un rAF que falla) no inunda: mismo error, uno cada 5 s; y 30 por minuto. */
export function reportar(donde: string, detalle: string, ahora = Date.now()) {
  if (MODO.datosFijos || !main?.bitacora) return;
  if (ahora - desde > 60_000) {
    desde = ahora;
    enviados = 0;
  }
  const clave = `${donde}|${detalle.slice(0, 300)}`;
  if (enviados >= POR_MINUTO || ahora - (vistos.get(clave) ?? -Infinity) < IGUAL_MS) return;
  if (vistos.size > 50) vistos.clear();
  vistos.set(clave, ahora);
  enviados++;
  void main.bitacora({ donde, detalle: detalle.slice(0, 8192) }).catch(() => {});
}

/** `window.onerror` y `unhandledrejection` van al log. Una vez, al arrancar. */
export function armarErrores() {
  window.addEventListener("error", (ev) => {
    reportar("onerror", ev.error ? detalleDe(ev.error) : `${ev.message} (${ev.filename}:${ev.lineno}:${ev.colno})`);
  });
  window.addEventListener("unhandledrejection", (ev) => reportar("unhandledrejection", detalleDe(ev.reason)));
}
