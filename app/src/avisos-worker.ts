// Los avisos de los workers en el renderer: el main (electron/avisos-worker.ts) dice que uno terminó, falló o se colgó; acá se
// guarda lo que el dueño tiene que ver (fallas y colgados, con su ✕), se cuentan los terminados que no vio (el punto de la
// bandeja) y se decide a quién se le hace una notificación y con qué palabras. Sin React ni DOM a la fuerza: lo prueba
// `node --test` (tests/avisos-worker-cliente.test.ts).
import type { AvisoWorker } from "./datos/contrato";
import { t } from "./i18n/index.ts";
import { cuandoFuturo } from "./tiempo.ts";

const q = typeof location === "undefined" ? null : new URLSearchParams(location.search);
/** Lo pone el main en la query (preferencias.json o `HILOS_AVISAR_WORKERS`); default, prendido. */
let prendido = q?.get("avisarw") !== "0";
const oyentes = new Set<() => void>();
const avisar = () => {
  for (const f of oyentes) f();
};

export const avisarWorkers = () => prendido;
export function cambiarAvisarWorkers(si: boolean) {
  if (si === prendido) return;
  prendido = si;
  avisar();
}
export function alCambiarAvisarWorkers(f: () => void): () => void {
  oyentes.add(f);
  return () => void oyentes.delete(f);
}

// --- Lo que se queda a la vista (fallas y colgados) y lo que se cuenta (terminados) ---

const TOPE = 30;
let pendientes: readonly AvisoWorker[] = [];
let terminados = 0;
const alCambiar = new Set<() => void>();
const cambio = () => {
  for (const f of alCambiar) f();
};

export const suscribirAvisos = (f: () => void) => (alCambiar.add(f), () => void alCambiar.delete(f));
/** Las fallas que el dueño todavía no descartó, las más nuevas primero. */
export const avisosPendientes = (): readonly AvisoWorker[] => pendientes;
/** Los workers que terminaron bien desde la última vez que se miró la ventana. */
export const terminadosSinVer = (): number => terminados;

/** Lo que llega con más antigüedad que esto es un reenvío de un aviso viejo (un celular que se reconecta): no se vuelve a avisar. */
const VIEJO_MS = 10 * 60_000;
const vistas = new Set<string>();

/** Anota un aviso del main. `true`: es nuevo (no se había visto esa clave y no es un reenvío viejo). */
export function recibirAviso(a: AvisoWorker, ahora = Date.now()): boolean {
  if (vistas.has(a.clave) || ahora - a.ts > VIEJO_MS) return false;
  vistas.add(a.clave);
  if (vistas.size > 500) vistas.delete(vistas.values().next().value as string);
  if (a.tipo === "fin") terminados++;
  else if (a.tipo !== "tanda") pendientes = [a, ...pendientes].slice(0, TOPE);
  cambio();
  return true;
}
export function descartarAviso(clave: string) {
  if (!pendientes.some((p) => p.clave === clave)) return;
  pendientes = pendientes.filter((p) => p.clave !== clave);
  cambio();
}
/** El dueño miró la ventana: los terminados dejan de contar. */
export function verTerminados() {
  if (!terminados) return;
  terminados = 0;
  cambio();
}
/** Para las pruebas. */
export function reiniciarAvisos() {
  vistas.clear();
  pendientes = [];
  terminados = 0;
}

/** ¿Se le hace una notificación de escritorio? Los terminados normales no: sólo el punto. */
export function debeNotificar(a: AvisoWorker, o: { avisar: boolean; enfocada: boolean }): boolean {
  return a.tipo !== "fin" && o.avisar && !o.enfocada;
}

// --- Las palabras ---

/** Por qué falló, en una línea y en el idioma de la app. */
export function textoMotivo(a: AvisoWorker, ahoraS = Date.now() / 1000): string {
  if (a.tipo === "cupo") {
    const sin = t("avisoW.cupo", { proveedor: a.proveedor ?? "?" });
    return `${sin} ${a.vuelve ? t("avisoW.cupoVuelve", { cuando: cuandoFuturo(a.vuelve, ahoraS) }) : t("avisoW.cupoSinHora")}`;
  }
  if (a.tipo === "colgado") return t("avisoW.colgado", { min: a.minutos ?? 15 });
  if (a.motivo) return a.motivo;
  if (a.sinArrancar) return t("avisoW.sinArrancar");
  if (a.rc) return t("avisoW.rc", { rc: a.rc });
  return t("avisoW.sinMotivo");
}

/** El título y el cuerpo de la notificación de un aviso. */
export function textoAviso(a: AvisoWorker, ahoraS = Date.now() / 1000): { titulo: string; cuerpo: string } {
  if (a.tipo === "tanda") return { titulo: t("avisoW.tTanda"), cuerpo: a.fallas ? t("avisoW.cTandaFallas", { n: a.n ?? 0, f: a.fallas }) : t("avisoW.cTanda", { n: a.n ?? 0 }) };
  const titulo = t(a.tipo === "cupo" ? "avisoW.tCupo" : a.tipo === "colgado" ? "avisoW.tColgado" : a.tipo === "fin" ? "avisoW.tFin" : "avisoW.tFalla");
  const motivo = a.tipo === "fin" ? (a.decision ? t("avisoW.decision") : "") : textoMotivo(a, ahoraS);
  return { titulo, cuerpo: [a.tarea, motivo].filter(Boolean).join(": ") };
}
