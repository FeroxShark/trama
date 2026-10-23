// Volver como estaba: qué conversación (o panel) había abierto, en qué punto de cada conversación y lo escrito
// sin mandar en cada caja.
// - La ventana, en TODO arranque (Ctrl+Q, apagón, el reinicio del cartel): con cada cambio, demorado ~500 ms, le
//   manda al main lo abierto (`volver.json`, electron/volver.ts) y lo escrito sin mandar (`borradores.json`,
//   electron/borradores.ts); la trama nueva lo trae antes del primer render. Nada se guarda hasta haber traído lo
//   de la vez anterior: la foto vacía lo pisaría.
// - El navegador (el celular): la página se recarga sola cuando la trama de la PC vuelve; se lo guarda
//   ella misma en `sessionStorage` al irse o esconderse, así que también vale para una recarga a mano.
import { agregarAdjuntos, fotoArchivos } from "./hilo/adjuntos";
import { fotoBorradores, ponerBorrador, restaurarBorrador } from "./hilo/borradores";
import { alHaberCambios } from "./hilo/cambios";
import { fotoScrolls, ponerScrolls } from "./hilo/scrollGuardado";
import { MODO } from "./modo";

export type Vuelta = {
  activa: string | null;
  panel: string | null;
  abierta: boolean;
  scrolls: Record<string, number>;
  borradores: [string, { texto: string; extra?: Record<string, string> }][];
};
type Vista = Pick<Vuelta, "activa" | "panel" | "abierta">;

const CLAVE = "trama:volver";
/** La ventana de Electron (el `preload` de verdad); si no, un navegador por la tailnet. */
const ventana = /\bElectron\//.test(navigator.userAgent);
/** Cuánto espera el primer render a que el main diga cómo estaba. */
const ESPERA_MS = 400;
/** Desde el último cambio hasta escribir en disco (varios seguidos, como un scroll o teclear, hacen una sola escritura). */
const DEMORA_MS = 500;

let vuelta: Vuelta | null = null;
let leerVista: (() => Vista) | null = null;

/** Cómo estaba la vista antes de reiniciar (o de recargar), o `null`: la barra arranca de ahí. */
export const vueltaInicial = () => vuelta;
/** La barra dice qué tiene abierto ahora. */
export function alLeerVista(fn: () => Vista) {
  leerVista = fn;
  return () => {
    if (leerVista === fn) leerVista = null;
  };
}

const foto = (): Vuelta | null => (leerVista ? { ...leerVista(), scrolls: fotoScrolls(), borradores: fotoBorradores() } : null);

const cadena = (x: unknown): x is string => typeof x === "string";
function valida(x: unknown): Vuelta | null {
  const v = x as Partial<Vuelta> | null;
  if (!v || typeof v !== "object") return null;
  const borradores: Vuelta["borradores"] = [];
  for (const b of Array.isArray(v.borradores) ? v.borradores : []) {
    if (!Array.isArray(b) || !cadena(b[0]) || !b[1] || !cadena(b[1].texto)) continue;
    const extra = b[1].extra && typeof b[1].extra === "object" ? Object.fromEntries(Object.entries(b[1].extra).filter((e): e is [string, string] => cadena(e[1]))) : undefined;
    borradores.push([b[0], extra ? { texto: b[1].texto, extra } : { texto: b[1].texto }]);
  }
  const scrolls = v.scrolls && typeof v.scrolls === "object" && !Array.isArray(v.scrolls) ? v.scrolls : {};
  return { activa: cadena(v.activa) ? v.activa : null, panel: cadena(v.panel) ? v.panel : null, abierta: v.abierta !== false, scrolls, borradores };
}

function aplicar(x: unknown) {
  vuelta = valida(x);
  for (const [clave, b] of vuelta?.borradores ?? []) ponerBorrador(clave, b);
  ponerScrolls(vuelta?.scrolls);
}

// --- La ventana: a disco ---------------------------------------------------------------

type Guardado = { texto: string; extra?: Record<string, string>; archivos?: { nombre: string; ruta: string }[] };

/** Lo escrito sin mandar en todas las cajas, y los archivos adjuntos (por ruta) de cada una. */
function fotoDisco(): Record<string, Guardado> {
  const r: Record<string, Guardado> = {};
  for (const [clave, b] of fotoBorradores()) r[clave] = { ...b };
  for (const [clave, archivos] of Object.entries(fotoArchivos())) r[clave] = { ...(r[clave] ?? { texto: "" }), archivos };
  return r;
}

/** Lo que dejó el main de la vez anterior: borradores con sus adjuntos que todavía existen (el main ya filtró los perdidos). */
function aplicarBorradores(x: unknown) {
  const b = (x as { borradores?: Record<string, Guardado & { archivos?: unknown }> } | null)?.borradores;
  if (!b || typeof b !== "object") return;
  for (const [clave, g] of Object.entries(b)) {
    if (!g || typeof g.texto !== "string") continue;
    const extra = g.extra && typeof g.extra === "object" ? Object.fromEntries(Object.entries(g.extra).filter((e): e is [string, string] => cadena(e[1]))) : undefined;
    if (g.texto || (extra && Object.keys(extra).length)) restaurarBorrador(clave, g.texto, extra && Object.keys(extra).length ? extra : undefined);
    const archivos = Array.isArray(g.archivos) ? g.archivos.filter((a): a is { nombre: string; ruta: string } => !!a && cadena(a.nombre) && cadena(a.ruta)) : [];
    if (archivos.length) agregarAdjuntos(clave, archivos);
  }
}

/**
 * Antes del primer render: trae cómo estaba y deja listos los borradores. Devuelve una promesa sólo si
 * hay que esperar al main (la ventana); en capturas y mediciones no hace nada.
 */
export function traerVuelta(): Promise<void> | null {
  const m = window.hilos;
  if (MODO.datosFijos || !m?.volver) return null;
  if (!ventana) {
    try {
      const crudo = sessionStorage.getItem(CLAVE);
      sessionStorage.removeItem(CLAVE);
      if (crudo) aplicar(JSON.parse(crudo));
    } catch {}
    const guardar = () => {
      try {
        const f = foto();
        if (f) sessionStorage.setItem(CLAVE, JSON.stringify(f));
      } catch {}
    };
    // `pagehide`: la recarga. Escondida: el teléfono puede descartar la pestaña sin avisar más.
    addEventListener("pagehide", guardar);
    document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && guardar());
    return null;
  }
  m.volver.alPedir(() => void m.volver.guardar(foto()).catch(() => {}));

  // Lo escrito sin mandar vuelve en cualquier arranque. Si el main tarda más que la espera del primer render, igual se
  // aplica cuando llega (a la caja que siga vacía); hasta entonces no se guarda nada.
  let cargado = false;
  let ultimoBorradores = "";
  let ultimaVista = "";
  const guardar = () => {
    if (!cargado) return;
    const b = JSON.stringify(fotoDisco());
    if (b !== ultimoBorradores) {
      ultimoBorradores = b;
      void m.borradores.guardar(JSON.parse(b)).catch(() => {});
    }
    const f = leerVista ? { ...leerVista(), scrolls: fotoScrolls() } : null;
    const v = JSON.stringify(f);
    if (f && v !== ultimaVista) {
      ultimaVista = v;
      void m.volver.anotar(f).catch(() => {});
    }
  };
  let reloj: ReturnType<typeof setTimeout> | null = null;
  const parar = () => {
    if (reloj) clearTimeout(reloj);
    reloj = null;
  };
  alHaberCambios(() => {
    reloj ??= setTimeout(() => (parar(), guardar()), DEMORA_MS);
  });
  // Al irse (Ctrl+Q esconde la ventana antes de salir) no se espera la demora.
  const ya = () => (parar(), guardar());
  addEventListener("pagehide", ya);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && ya());
  const lectura = m.borradores.leer().then(
    (x) => {
      aplicarBorradores(x);
      cargado = true;
      ultimoBorradores = JSON.stringify(fotoDisco());
    },
    () => {
      cargado = true;
    },
  );
  return Promise.race([Promise.all([m.volver.leer().then(aplicar, () => {}), lectura]).then(() => {}), new Promise<void>((r) => setTimeout(r, ESPERA_MS))]);
}
