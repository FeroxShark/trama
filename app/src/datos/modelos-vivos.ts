// Mantiene viva la tabla de modelos de los selectores (src/hilo/opciones.tsx): la lee al arrancar y la vuelve a leer cuando puede
// haber cambiado (catálogo nuevo del `claude`, Ajustes, un proveedor que se instala), sin reiniciar. Es la misma fuente que
// Ajustes (`modelos:config` del main: catálogo de Claude, agy, DeepSeek Harness, OpenCode y `modelos.json`).
// Lo que tarda (el `agy models` del main) no se pierde: el arranque no espera más de `tope`, pero la respuesta tardía se aplica igual.
import { main } from "../puente";
import { MODO } from "../modo";
import { aplicarModelos } from "../hilo/opciones";
import { configValida, pedirModelos } from "./modelos-config";
import type { ConfigModelos } from "../hilo/modelos";

/** Cada cuánto se vuelve a mirar con la ventana a la vista (el catálogo de `claude` lo baja él solo, sin avisar). */
export const CADA_MS = 60_000;
/** Entre dos lecturas por enfocar la ventana: no más seguido. */
const MIN_ENTRE_MS = 5_000;

let enCurso: Promise<void> | null = null;
let ultima = 0;

/** La lectura sin tope de espera (los pedidos tardíos también valen); `null` si no hay main o contesta algo raro. */
async function leerCompleto(): Promise<ConfigModelos | null> {
  const m = main?.modelos;
  if (!m) return null;
  return m.config().then(configValida, () => null);
}

/**
 * Lee la config y la aplica. Un fallo (el motor reconectando, una respuesta rara) NUNCA pisa la tabla buena que ya hay.
 * Devuelve cuando quedó aplicada. Un pedido en el aire se comparte.
 */
export function refrescarModelos(ahora = Date.now()): Promise<void> {
  ultima = ahora;
  if (enCurso) return enCurso;
  enCurso = (MODO.fixtures ? pedirModelos() : leerCompleto())
    .then((c) => {
      if (c) aplicarModelos(c);
    })
    .finally(() => {
      enCurso = null;
    });
  return enCurso;
}

/**
 * Arranque: espera la config hasta `tope` ms (para pintar con los modelos de verdad) y, si tardó más, la sigue esperando y la aplica
 * cuando llega. Después se mantiene sola: al enfocar la ventana, al volverse visible y cada `CADA_MS`.
 */
export async function arrancarModelosVivos(tope = 1500): Promise<void> {
  const completo = MODO.fixtures ? pedirModelos(tope) : leerCompleto();
  const espera = new Promise<"tarde">((ok) => setTimeout(() => ok("tarde"), tope));
  const primera = await Promise.race([completo, espera]);
  if (primera === "tarde") {
    // Sin la config se pinta con la tabla de siempre, pero la respuesta que viene en camino se aplica cuando llega.
    aplicarModelos(null);
    void completo.then((c) => c && aplicarModelos(c));
  } else aplicarModelos(primera);
  if (MODO.fixtures || typeof window === "undefined") return;
  const mirar = () => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - ultima >= MIN_ENTRE_MS) void refrescarModelos();
  };
  window.addEventListener("focus", mirar);
  document.addEventListener("visibilitychange", mirar);
  setInterval(mirar, CADA_MS);
}
