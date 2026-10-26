// El tamaño de letra y las fuentes de la interfaz (Ajustes, sección App; el
// tamaño también con Ctrl+= / Ctrl+- / Ctrl+0). Se aplican al toque como
// variables CSS en <html> (`--letra`, `--font-sans`, `--font-mono`: ver
// index.css) y se guardan en preferencias.json. Como el idioma, el main los
// pone en la query: el primer render ya sale con lo elegido.
//
// Sin imports de React ni del DOM a la fuerza: lo prueba `node --test`.

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

/** La fuente de la interfaz. La primera es el default (la del estándar visual: docs/maquetas/lavado/ (dirección 1, "estándar pulido")). */
export const FUENTES: readonly Fuente[] = [
  { id: "inter", nombre: "Inter", pila: `"Inter", ${SANS}` },
  { id: "geist", nombre: "Geist", pila: `"Geist", "Adwaita Sans", Inter, ui-sans-serif, system-ui, sans-serif` },
  { id: "plex", nombre: "IBM Plex Sans", pila: `"IBM Plex Sans", ${SANS}` },
  { id: "source", nombre: "Source Sans 3", pila: `"Source Sans 3", ${SANS}` },
  { id: "jetbrains", nombre: "JetBrains Mono", pila: `"JetBrains Mono", ${MONO}` },
  { id: "sistema", nombre: null, pila: "system-ui, ui-sans-serif, sans-serif" },
];

/** La fuente del código: bloques, comandos y todo lo que va en mono. */
export const MONOS: readonly Fuente[] = [
  { id: "jetbrains", nombre: "JetBrains Mono", pila: MONO },
  { id: "geist-mono", nombre: "Geist Mono", pila: `"Geist Mono", "Adwaita Mono", ui-monospace, monospace` },
  { id: "plex-mono", nombre: "IBM Plex Mono", pila: `"IBM Plex Mono", ${MONO}` },
  { id: "fira", nombre: "Fira Code", pila: `"Fira Code", ${MONO}` },
  { id: "sistema", nombre: null, pila: "ui-monospace, monospace" },
];

export type Apariencia = { letra: number; fuente: string; mono: string };

export const APARIENCIA_DEF: Apariencia = { letra: LETRA_DEF, fuente: FUENTES[0].id, mono: MONOS[0].id };

const entero = (x: unknown): number | null => {
  const n = typeof x === "string" && x.trim() ? Number(x) : x;
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null;
};

/** Lo que venga (query, preferencias.json) llevado a algo válido: lo que no se entiende, default. */
export function normalizar(x: { letra?: unknown; fuente?: unknown; mono?: unknown } | null | undefined): Apariencia {
  const n = entero(x?.letra);
  return {
    letra: n === null ? LETRA_DEF : Math.max(LETRA_MIN, Math.min(LETRA_MAX, n)),
    fuente: FUENTES.some((f) => f.id === x?.fuente) ? (x!.fuente as string) : APARIENCIA_DEF.fuente,
    mono: MONOS.some((f) => f.id === x?.mono) ? (x!.mono as string) : APARIENCIA_DEF.mono,
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
export function aplicar(estilo: Estilo, a: Apariencia) {
  estilo.setProperty("--letra", String(a.letra));
  estilo.setProperty("--font-sans", (FUENTES.find((f) => f.id === a.fuente) ?? FUENTES[0]).pila);
  estilo.setProperty("--font-mono", (MONOS.find((f) => f.id === a.mono) ?? MONOS[0]).pila);
}

/** La de la query (la pone el main desde preferencias.json o `HILOS_LETRA`/`HILOS_FUENTE`/`HILOS_MONO`). */
function inicial(): Apariencia {
  if (typeof location === "undefined") return { ...APARIENCIA_DEF };
  const q = new URLSearchParams(location.search);
  return normalizar({ letra: q.get("letra"), fuente: q.get("fuente"), mono: q.get("mono") });
}

let actual: Apariencia = inicial();
if (typeof document !== "undefined") aplicar(document.documentElement.style, actual);
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
  if (!Object.keys(dif).length) return null;
  actual = nueva;
  if (typeof document !== "undefined") aplicar(document.documentElement.style, actual);
  for (const f of oyentes) f();
  return dif;
}

export function alCambiarApariencia(f: () => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}
