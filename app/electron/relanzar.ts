// Un build más nuevo que el proceso que corre: trama NO se relanza sola. Lo avisa (el cartel "Hay una
// actualización disponible" de la barra, y en el celular) y se reinicia cuando el usuario toca Reiniciar; y
// ni así a mitad de algo: si hay un líder respondiendo o esperando a sus workers, o una integración
// corriendo, el pedido queda anotado y sale cuando terminen. Hasta 2026-10-12 se relanzaba sola al
// quedar libre y sin foco: El usuario lo vivió como un crash.
// Puro (sin `electron` ni imports locales): lo prueba tests/relanzar.test.ts. Lo arma main.ts.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";

/** Sin cambios en el build durante esto, se lo da por terminado (tapa el hueco entre `vite build` y el `tsc` de electron/). */
const QUIETO_MS = 10_000;
/**
 * `npm run build` deja `dist-electron/.listo` como lo último que escribe (scripts/build-listo.mjs): con eso el build
 * está terminado de verdad y alcanza una pausa corta (lo que tarda en asentarse el inotify) en vez de los 10 s de arriba.
 * Sin esa marca (un build a mano, a medias) vale la quietud de siempre.
 */
export const LISTO = ".listo";
const LISTO_MS = 600;
/** Al quedar libre se espera esto: la cola (electron/cola.ts) manda lo que esperaba apenas termina el turno. */
const GRACIA_MS = 1500;
/** Lo que espera un reinicio sin un solo evento durante esto se da por colgado: el cartel ofrece "Reiniciar igual". */
export const COLGADO_MS = 20 * 60_000;
/** Con el relanzo pendiente y algo a medias, se vuelve a mirar cada tanto por si nadie avisó que terminó. */
const REPASO_MS = 30_000;

/**
 * La huella del build: lo que carga el main (`dist-electron/*.js|cjs`) y la página (`dist/index.html`,
 * que nombra sus assets con hash). Por contenido, no por fecha: un build que deja lo mismo no
 * relanza nada. `null` si falta algo (build a medias o sin hacer).
 */
export function selloDe(raiz: string): string | null {
  try {
    const dir = path.join(raiz, "dist-electron");
    const h = createHash("sha1");
    for (const f of readdirSync(dir).filter((f) => /\.c?js$/.test(f)).sort()) h.update(`${f}\n`).update(readFileSync(path.join(dir, f)));
    h.update(readFileSync(path.join(raiz, "dist", "index.html")));
    return h.digest("hex");
  } catch {
    return null;
  }
}

/**
 * Mira el build con inotify (sin polling) y avisa cada cambio. `dist/` y `dist-electron/` se miran
 * de a una; la raíz, sólo para volver a mirarlas si las borran enteras (su inotify muere con ellas).
 * Devuelve cómo dejar de mirar.
 */
export function mirarBuild(raiz: string, alCambiar: (nombre?: string) => void): () => void {
  const carpetas = ["dist-electron", "dist"];
  const mirando = new Map<string, FSWatcher>();
  const armar = (d: string) => {
    mirando.get(d)?.close();
    mirando.delete(d);
    try {
      const w = watch(path.join(raiz, d), (_t, nombre) => alCambiar(nombre ?? undefined));
      w.on("error", () => {});
      mirando.set(d, w);
    } catch {
      // Todavía no existe: la raíz avisa cuando aparezca.
    }
  };
  carpetas.forEach(armar);
  let arriba: FSWatcher | null = null;
  try {
    arriba = watch(raiz, (_t, nombre) => {
      if (!nombre || !carpetas.includes(nombre)) return;
      armar(nombre);
      alCambiar();
    });
    arriba.on("error", () => {});
  } catch {}
  return () => {
    arriba?.close();
    for (const w of mirando.values()) w.close();
  };
}

/**
 * Cuántos líderes de la app (los `sids` con proceso de trama: lanzados o traídos) tienen workers de
 * `pa` vivos colgando de ellos (`jefe_id`, de `pa --hilos`). Un líder así terminó su turno pero suele
 * tener un `pa --esperar` en segundo plano adentro de su `claude`: relanzar lo mata, los workers siguen
 * y nadie cobra el resultado. El de una terminal no cuenta: trama no es su padre, no le corta nada.
 */
export function esperandoWorkers(hilos: readonly { estado?: unknown; en_cola?: unknown; jefe_id?: unknown }[], sids: Iterable<string>): number {
  return lideresConWorkers(hilos, sids).length;
}

/** Cuáles son esos líderes (el cartel dice sus nombres). */
export function lideresConWorkers(hilos: readonly { estado?: unknown; en_cola?: unknown; jefe_id?: unknown }[], sids: Iterable<string>): string[] {
  const mios = new Set(sids);
  const con = new Set<string>();
  for (const h of hilos)
    if (typeof h.jefe_id === "string" && mios.has(h.jefe_id) && (h.estado === "trabajando" || h.estado === "colgado" || h.en_cola === true))
      con.add(h.jefe_id);
  return [...con];
}

/** Hace cuánto no pasa nada (`ultima`, ms) como para ofrecer "Reiniciar igual". */
export const sinEventos = (ultima: number, ahora: number, ms: number = COLGADO_MS) => ahora - ultima >= ms;

/**
 * Cuántos workers de `pa` vivos cuelgan de esos líderes: las "tareas corriendo" que dice el cartel
 * mientras espera (la misma cuenta de vivos que `esperandoWorkers`, por worker y no por líder).
 */
export function workersEsperados(hilos: readonly { estado?: unknown; en_cola?: unknown; jefe_id?: unknown }[], sids: Iterable<string>): number {
  const mios = new Set(sids);
  return hilos.filter((h) => typeof h.jefe_id === "string" && mios.has(h.jefe_id) && (h.estado === "trabajando" || h.estado === "colgado" || h.en_cola === true)).length;
}

/**
 * Los ids de los workers de `pa` vivos (trabajando, colgados o en cola) que cuelgan de esos líderes (`jefe_id`): lo que
 * "Cerrar y parar todo" frena. Sólo los de los líderes que trama conoce: nunca uno de otro jefe ni por patrón de nombre.
 */
export function workersVivosDe(hilos: readonly { id?: unknown; estado?: unknown; en_cola?: unknown; jefe_id?: unknown }[], sids: Iterable<string>): string[] {
  const mios = new Set(sids);
  const ids = new Set<string>();
  for (const h of hilos)
    if (typeof h.id === "string" && typeof h.jefe_id === "string" && mios.has(h.jefe_id) && (h.estado === "trabajando" || h.estado === "colgado" || h.en_cola === true)) ids.add(h.id);
  return [...ids];
}

export type Relanzador = {
  /** Algo cambió en el build (`nombre`: el archivo, si se sabe): cuando se quede quieto se compara con el del arranque. */
  cambio(nombre?: string): void;
  /** Algo que estaba a medias terminó (un turno, una integración, un worker): si el reinicio está pedido, se vuelve a mirar. */
  libre(): void;
  /**
   * El usuario tocó Reiniciar: ya mismo si no corta nada; si no, cuando terminen. Sin build nuevo no hace nada.
   * `igual` ("Reiniciar igual"): sin esperar, pero sólo si lo que espera lleva 20 min sin un evento (`colgado`).
   */
  pedir(igual?: boolean): void;
  /** Se arrepintió mientras esperaba: el build nuevo sigue avisado, pero ya no se reinicia solo. */
  cancelar(): void;
  /** Hay un build nuevo sin tomar. */
  hay(): boolean;
  /** Hay un build nuevo y el usuario ya pidió reiniciar: espera a que no corte nada. */
  pedido(): boolean;
  parar(): void;
};

export function crearRelanzador(x: {
  /** La huella del build que hay en disco ahora (`selloDe`). */
  sello: () => string | null;
  /** Hay algo que un reinicio cortaría: mientras, se espera. */
  ocupado: () => boolean;
  /** Lo que espera un reinicio no tuvo eventos en `COLGADO_MS`: deja reiniciar sin esperarlo. */
  colgado?: () => boolean;
  /** Reiniciar de verdad. Se llama una sola vez, y sólo después de `pedir`. */
  relanzar: () => void;
  /** Cambió lo que hay que mostrar: apareció (o se deshizo) un build nuevo, o se pidió o canceló el reinicio. */
  avisar?: () => void;
  /** Se dio por terminado un build nuevo: cuánto esperó quieto (`quietoMs`) y desde el primer cambio (`buildMs`). Para medirlo. */
  visto?: (x: { quietoMs: number; buildMs: number; conMarca: boolean }) => void;
  quietoMs?: number;
  listoMs?: number;
  graciaMs?: number;
  repasoMs?: number;
}): Relanzador {
  const quietoMs = x.quietoMs ?? QUIETO_MS;
  const listoMs = x.listoMs ?? Math.min(LISTO_MS, quietoMs);
  const graciaMs = x.graciaMs ?? GRACIA_MS;
  const repasoMs = x.repasoMs ?? REPASO_MS;
  // El build con que arrancó este proceso.
  let inicial = x.sello();
  let nuevo = false;
  let pedido = false;
  let hecho = false;
  let quieto: NodeJS.Timeout | null = null;
  // El primer cambio de este build y cuánto se esperó la última vez: para medir (`visto`).
  let primero = 0;
  let esperado = quietoMs;
  let conMarca = false;
  let espera: NodeJS.Timeout | null = null;

  const en = (ms: number, fn: () => void) => {
    if (espera) clearTimeout(espera);
    espera = setTimeout(fn, ms);
    espera.unref?.();
  };
  const soltar = () => {
    if (espera) clearTimeout(espera);
    espera = null;
  };

  function intentar() {
    if (!nuevo || !pedido || hecho) return;
    // Nunca se corta un turno por esto: se vuelve a mirar cuando avisen (`libre`) o al rato.
    if (x.ocupado()) return en(repasoMs, intentar);
    hecho = true;
    x.relanzar();
  }

  function revisar() {
    quieto = null;
    const desde = primero;
    primero = 0;
    const s = x.sello();
    // A medias (falta algo): el build sigue y va a llegar otro cambio.
    if (s === null || hecho) return;
    if (inicial === null) return void (inicial = s);
    const antes = nuevo;
    nuevo = s !== inicial;
    // Otro build encima del que ya se avisó: sigue siendo un solo aviso.
    if (nuevo === antes) return;
    if (!nuevo) {
      // El build nuevo se deshizo: no queda nada que tomar, ni pedido que cumplir.
      pedido = false;
      soltar();
    }
    if (nuevo) x.visto?.({ quietoMs: esperado, buildMs: Date.now() - desde, conMarca });
    x.avisar?.();
  }

  return {
    cambio(nombre) {
      if (quieto) clearTimeout(quieto);
      if (!primero) primero = Date.now();
      conMarca = nombre === LISTO;
      esperado = conMarca ? listoMs : quietoMs;
      quieto = setTimeout(revisar, esperado);
      quieto.unref?.();
    },
    libre() {
      if (nuevo && pedido && !hecho) en(graciaMs, intentar);
    },
    pedir(igual = false) {
      if (!nuevo || hecho) return;
      const antes = pedido;
      pedido = true;
      if (igual && x.colgado?.()) {
        hecho = true;
        soltar();
        return x.relanzar();
      }
      intentar();
      if (!antes && !hecho) x.avisar?.();
    },
    cancelar() {
      if (!pedido || hecho) return;
      pedido = false;
      soltar();
      x.avisar?.();
    },
    hay: () => nuevo && !hecho,
    pedido: () => nuevo && pedido && !hecho,
    parar() {
      if (quieto) clearTimeout(quieto);
      soltar();
      hecho = true;
    },
  };
}
