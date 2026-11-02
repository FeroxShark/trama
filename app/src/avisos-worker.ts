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

// Cómo se avisa al líder (Ajustes > General): lo pone el main en la query (`avisolider=worker` sólo cuando es por worker). Sólo lo
// muestra Ajustes: quien decide qué sale al líder es el main (electron/avisos-worker.ts).
export type ModoAvisoLider = "tanda" | "worker";
let modoLider: ModoAvisoLider = q?.get("avisolider") === "worker" ? "worker" : "tanda";
const oyentesLider = new Set<() => void>();
export const avisoLider = (): ModoAvisoLider => modoLider;
export function cambiarAvisoLider(m: ModoAvisoLider) {
  if (m === modoLider) return;
  modoLider = m;
  for (const f of oyentesLider) f();
}
export function alCambiarAvisoLider(f: () => void): () => void {
  oyentesLider.add(f);
  return () => void oyentesLider.delete(f);
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
  // Una muerte ya avisada (aunque sea de antes de recargar la ventana o de reiniciar la app) no vuelve a salir.
  if (a.tipo === "falla" && muertesAvisadas().has(a.clave)) return false;
  vistas.add(a.clave);
  if (vistas.size > 500) vistas.delete(vistas.values().next().value as string);
  if (a.tipo === "fin") terminados++;
  // La muerte no pide nada al dueño: se dice una vez, en un cartelito que se va solo. Su estado queda en la fila del worker.
  else if (a.tipo === "falla") anotarMuerte(a);
  else if (a.tipo !== "tanda") pendientes = [a, ...pendientes].slice(0, TOPE);
  cambio();
  return true;
}

// --- El cartelito de las muertes: una vez, juntas y se va solo ---

/** Cuánto dura a la vista un cartelito de muerte (cada muerte que se suma lo vuelve a contar). */
export const VIDA_MUERTE_MS = 7_000;
const CLAVE_MUERTES = "trama.muertesAvisadas";
const TOPE_MUERTES = 300;

/** Lo que dice el cartelito: cuántas muertes junta y, si es una sola, de qué worker. */
export type CartelMuertes = { readonly n: number; readonly tarea: string; readonly motivo: string };

let cartel: CartelMuertes | null = null;
let temporizador: ReturnType<typeof setTimeout> | null = null;
let pausado = false;
let avisadas: Set<string> | null = null;
let almacen: Pick<Storage, "getItem" | "setItem"> | null = typeof localStorage === "undefined" ? null : localStorage;

/** Las claves de muerte ya avisadas, guardadas en el almacén local de la ventana (sobreviven a un reinicio o a recargar). */
function muertesAvisadas(): Set<string> {
  if (avisadas) return avisadas;
  avisadas = new Set();
  try {
    const crudo = almacen?.getItem(CLAVE_MUERTES);
    const lista: unknown = crudo ? JSON.parse(crudo) : [];
    if (Array.isArray(lista)) for (const c of lista) if (typeof c === "string") avisadas.add(c);
  } catch {
    // Sin almacén o con algo ilegible: se parte de cero; a lo sumo se repite un aviso, nunca se pierde el estado de la fila.
  }
  return avisadas;
}
function guardarMuertes(a: Set<string>) {
  if (a.size > TOPE_MUERTES) for (const k of [...a].slice(0, a.size - TOPE_MUERTES)) a.delete(k);
  try {
    almacen?.setItem(CLAVE_MUERTES, JSON.stringify([...a]));
  } catch {
    // Almacén lleno o bloqueado: igual que arriba.
  }
}
function programarCartel() {
  if (temporizador) clearTimeout(temporizador);
  temporizador = null;
  if (!cartel || pausado) return;
  temporizador = setTimeout(cerrarCartelMuertes, VIDA_MUERTE_MS);
  (temporizador as { unref?: () => void }).unref?.();
}
/** Suma una muerte al cartelito que esté a la vista (así varias seguidas son un solo cartel) o abre uno. */
function anotarMuerte(a: AvisoWorker) {
  const m = muertesAvisadas();
  m.add(a.clave);
  guardarMuertes(m);
  cartel = cartel ? { n: cartel.n + 1, tarea: "", motivo: "" } : { n: 1, tarea: a.tarea || a.id, motivo: textoMotivo(a) };
  programarCartel();
}
/** El cartelito de muertes que está a la vista, o `null`. */
export const cartelMuertes = (): CartelMuertes | null => cartel;
export function cerrarCartelMuertes() {
  if (temporizador) clearTimeout(temporizador);
  temporizador = null;
  // El cartel que se va ya no tiene puntero encima: el próximo arranca sin pausa.
  pausado = false;
  if (!cartel) return;
  cartel = null;
  cambio();
}
/** El puntero (o el foco) está encima: no se va mientras tanto. Al soltarlo cuenta de nuevo su tiempo entero. */
export function pausarCartelMuertes(si: boolean) {
  if (si === pausado) return;
  pausado = si;
  programarCartel();
}
/** Las palabras del cartelito. */
export const textoCartelMuertes = (c: CartelMuertes): string => (c.n === 1 ? t("avisoW.muerte1", { tarea: c.tarea }) : t("avisoW.muertes", { n: c.n }));
/** Para las pruebas: otro almacén (o ninguno) y desde cero. */
export function usarAlmacenMuertes(a: Pick<Storage, "getItem" | "setItem"> | null) {
  almacen = a;
  avisadas = null;
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
  if (temporizador) clearTimeout(temporizador);
  temporizador = null;
  cartel = null;
  pausado = false;
  avisadas = null;
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
