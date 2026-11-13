// El tamaño de letra y las fuentes de la interfaz (Ajustes, sección App; el
// tamaño también con Ctrl+= / Ctrl+- / Ctrl+0). Se aplican al toque como
// variables CSS en <html> (`--letra`, `--font-sans`, `--font-mono`: ver
// index.css) y se guardan en preferencias.json. Como el idioma, el main los
// pone en la query: el primer render ya sale con lo elegido.
//
// El tema de color (src/temas.ts), su acento y el tema personalizado ("Mío") viajan con lo mismo.
//
// Sin imports de React ni del DOM a la fuerza: lo prueba `node --test`.
import {
  CLAVE_ACENTO,
  CLAVE_TEMA,
  CLAVE_TEMA_MIO,
  derivarAcento,
  derivarTema,
  esTema,
  leerTemaMioJson,
  normalizarHex,
  resolverTema,
  TEMA_DEF,
  TEMA_MIO,
  validarBaseTema,
  VARS_ACENTO,
  VARS_TEMA_MIO,
  type BaseTema,
  type Tema,
} from "./temas.ts";
import { sincronizarTitulo } from "./titulo.ts";

/** Px del texto base: 13 es la maqueta. */
export const LETRA_DEF = 13;
export const LETRA_MIN = 13;
export const LETRA_MAX = 18;

export type Fuente = {
  id: string;
  /** Como se llama la fuente (no se traduce); `null` es la del sistema. */
  nombre: string | null;
  /** El `font-family` entero. */
  pila: string;
};

// Las que no son Geist llevan a Geist detrás: los .woff2 de Inter, Plex Sans y
// Source Sans son el subconjunto latino, y lo que les falte (flechas, ✓) sale igual que siempre.
const SANS = '"Inter", "Geist", "Adwaita Sans", ui-sans-serif, system-ui, sans-serif';
const MONO = '"JetBrains Mono", "Geist Mono", "Adwaita Mono", ui-monospace, monospace';

/** La fuente de la interfaz. La primera es el default (la del estándar visual). */
export const FUENTES: readonly Fuente[] = [
  { id: "plex", nombre: "IBM Plex Sans", pila: `"IBM Plex Sans", ${SANS}` },
  { id: "inter", nombre: "Inter", pila: `"Inter", ${SANS}` },
  { id: "geist", nombre: "Geist", pila: '"Geist", "Adwaita Sans", Inter, ui-sans-serif, system-ui, sans-serif' },
  { id: "source", nombre: "Source Sans 3", pila: `"Source Sans 3", ${SANS}` },
  { id: "jetbrains", nombre: "JetBrains Mono", pila: `"JetBrains Mono", ${MONO}` },
  { id: "sistema", nombre: null, pila: "system-ui, ui-sans-serif, sans-serif" },
];

/** La fuente del código: bloques, comandos y todo lo que va en mono. */
export const MONOS: readonly Fuente[] = [
  { id: "plex-mono", nombre: "IBM Plex Mono", pila: `"IBM Plex Mono", ${MONO}` },
  { id: "jetbrains", nombre: "JetBrains Mono", pila: MONO },
  { id: "geist-mono", nombre: "Geist Mono", pila: '"Geist Mono", "Adwaita Mono", ui-monospace, monospace' },
  { id: "fira", nombre: "Fira Code", pila: `"Fira Code", ${MONO}` },
  { id: "sistema", nombre: null, pila: "ui-monospace, monospace" },
];

export type Apariencia = { letra: number; fuente: string; mono: string; tema: Tema; acento: string | null; mio: BaseTema | null };

export const APARIENCIA_DEF: Apariencia = { letra: LETRA_DEF, fuente: FUENTES[0].id, mono: MONOS[0].id, tema: TEMA_DEF, acento: null, mio: null };

const entero = (x: unknown): number | null => {
  const n = typeof x === "string" && x.trim() ? Number(x) : x;
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null;
};

const igualMio = (a: BaseTema | null, b: BaseTema | null): boolean =>
  a === b || (!!a && !!b && a.fondo === b.fondo && a.superficie === b.superficie && a.texto === b.texto && a.acento === b.acento);

/** Lo que venga (query, preferencias.json) llevado a algo válido: lo que no se entiende, default. */
export function normalizar(x: { letra?: unknown; fuente?: unknown; mono?: unknown; tema?: unknown; acento?: unknown; mio?: unknown } | null | undefined): Apariencia {
  const n = entero(x?.letra);
  const mio = validarBaseTema(x?.mio);
  const tema: Tema = x?.tema === TEMA_MIO ? (mio ? TEMA_MIO : TEMA_DEF) : esTema(x?.tema) ? x.tema : TEMA_DEF;
  return {
    letra: n === null ? LETRA_DEF : Math.max(LETRA_MIN, Math.min(LETRA_MAX, n)),
    fuente: FUENTES.some((f) => f.id === x?.fuente) ? (x!.fuente as string) : APARIENCIA_DEF.fuente,
    mono: MONOS.some((f) => f.id === x?.mono) ? (x!.mono as string) : APARIENCIA_DEF.mono,
    tema,
    acento: normalizarHex(x?.acento),
    mio,
  };
}

/** Un paso más grande o más chico, sin salirse de la escala. */
export const pasoLetra = (letra: number, d: 1 | -1) => Math.max(LETRA_MIN, Math.min(LETRA_MAX, letra + d));

/** Qué pide una tecla: `1` agrandar, `-1` achicar, `0` volver al default; `null` si no es de acá. */
export function atajoLetra(e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; key: string; code?: string }): 1 | -1 | 0 | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  if (e.key === "=" || e.key === "+" || e.code === "NumpadAdd") return 1;
  if (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract") return -1;
  if (e.key === "0" || e.code === "Numpad0") return 0;
  return null;
}

type Estilo = { setProperty(nombre: string, valor: string): void };

/** Las tres variables CSS de <html>. */
export function aplicar(estilo: Estilo, a: Pick<Apariencia, "letra" | "fuente" | "mono">) {
  estilo.setProperty("--letra", String(a.letra));
  estilo.setProperty("--font-sans", (FUENTES.find((f) => f.id === a.fuente) ?? FUENTES[0]).pila);
  estilo.setProperty("--font-mono", (MONOS.find((f) => f.id === a.mono) ?? MONOS[0]).pila);
}

/** El tema en <html> (y el espejo en localStorage para el primer pintado), con acento y tema propio opcionales. */
export function aplicarTema(tema: Tema, acento: string | null = null, mio: BaseTema | null = null) {
  if (typeof document === "undefined") return;
  const raiz = document.documentElement;
  const estilo = raiz.style;
  const acentoHex = normalizarHex(acento);
  const mioValido = validarBaseTema(mio);
  const temaEfectivo: Tema = tema === TEMA_MIO && !mioValido ? TEMA_DEF : tema;

  const limpiarInline = () => {
    for (const k of VARS_TEMA_MIO) estilo.removeProperty(k);
    for (const k of VARS_ACENTO) estilo.removeProperty(k);
    estilo.removeProperty("color-scheme");
  };

  const pintar = () => {
    limpiarInline();
    if (temaEfectivo === TEMA_MIO && mioValido) {
      const derivado = derivarTema(mioValido);
      estilo.setProperty("color-scheme", derivado.colorScheme);
      for (const [k, v] of Object.entries(derivado.vars)) estilo.setProperty(k, v);
      raiz.setAttribute("data-tema", TEMA_MIO);
    } else {
      const claro = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches;
      raiz.setAttribute("data-tema", resolverTema(temaEfectivo, claro));
    }
    if (acentoHex) {
      for (const [k, v] of Object.entries(derivarAcento(acentoHex))) estilo.setProperty(k, v);
    }
    // Los símbolos de los botones nativos (la carcasa de Windows) siguen al tema que quedó pintado.
    sincronizarTitulo();
  };
  pintar();
  try {
    localStorage.setItem(CLAVE_TEMA, temaEfectivo);
    if (acentoHex) localStorage.setItem(CLAVE_ACENTO, acentoHex);
    else localStorage.removeItem(CLAVE_ACENTO);
    if (mioValido) localStorage.setItem(CLAVE_TEMA_MIO, JSON.stringify(mioValido));
    else localStorage.removeItem(CLAVE_TEMA_MIO);
  } catch {
    // sin almacenamiento (ventana privada, bloqueado): el tema igual rige en esta sesión
  }
  quitarSistema?.();
  quitarSistema = null;
  if (temaEfectivo === "sistema" && typeof matchMedia === "function") {
    const mq = matchMedia("(prefers-color-scheme: light)");
    mq.addEventListener("change", pintar);
    quitarSistema = () => mq.removeEventListener("change", pintar);
  }
}
let quitarSistema: (() => void) | null = null;

/** La de la query (la pone el main desde preferencias.json o `HILOS_LETRA`/`HILOS_FUENTE`/`HILOS_MONO`/`HILOS_TEMA`). */
function inicial(): Apariencia {
  if (typeof location === "undefined") return { ...APARIENCIA_DEF };
  const q = new URLSearchParams(location.search);
  let mio = leerTemaMioJson(q.get("mio"));
  if (!mio) {
    try {
      mio = leerTemaMioJson(localStorage.getItem(CLAVE_TEMA_MIO));
    } catch {
      mio = null;
    }
  }
  let tema = q.get("tema");
  if (!esTema(tema)) {
    try {
      tema = localStorage.getItem(CLAVE_TEMA);
    } catch {
      tema = null;
    }
  }
  let acento = normalizarHex(q.get("acento"));
  if (!acento) {
    try {
      acento = normalizarHex(localStorage.getItem(CLAVE_ACENTO));
    } catch {
      acento = null;
    }
  }
  if (q.get("captura") === "ajustes-tema" && !q.get("tema")) {
    mio = { fondo: "#0d131c", superficie: "#161e2b", texto: "#eef2f7", acento: "#7fd1c7" };
    tema = TEMA_MIO;
    acento = "#7fd1c7";
  }
  return normalizar({ letra: q.get("letra"), fuente: q.get("fuente"), mono: q.get("mono"), tema, acento, mio });
}

let actual: Apariencia = inicial();
if (typeof document !== "undefined") {
  aplicar(document.documentElement.style, actual);
  aplicarTema(actual.tema, actual.acento, actual.mio);
}
const oyentes = new Set<() => void>();

export const apariencia = () => actual;

/**
 * Cambia al toque: pone las variables y avisa a los suscriptos (Ajustes se
 * repinta, la lista virtualizada vuelve a medir sus filas). Devuelve lo que
 * cambió de verdad (para guardarlo) o `null` si quedó todo igual.
 */
export function cambiarApariencia(cambio: Partial<Apariencia>): Partial<Apariencia> | null {
  const nueva = normalizar({ ...actual, ...cambio });
  const dif: Partial<Apariencia> = {};
  if (nueva.letra !== actual.letra) dif.letra = nueva.letra;
  if (nueva.fuente !== actual.fuente) dif.fuente = nueva.fuente;
  if (nueva.mono !== actual.mono) dif.mono = nueva.mono;
  if (nueva.tema !== actual.tema) dif.tema = nueva.tema;
  if (nueva.acento !== actual.acento) dif.acento = nueva.acento;
  if (!igualMio(nueva.mio, actual.mio)) dif.mio = nueva.mio;
  if (!Object.keys(dif).length) return null;
  actual = nueva;
  if (typeof document !== "undefined") {
    aplicar(document.documentElement.style, actual);
    if ("tema" in dif || "acento" in dif || "mio" in dif) aplicarTema(actual.tema, actual.acento, actual.mio);
  }
  for (const f of oyentes) f();
  return dif;
}

export function alCambiarApariencia(f: () => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}
