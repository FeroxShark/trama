// Parser puro de la nota para compactar (`[[nota-compactar]]…[[/nota-compactar]]`) y puente liviano
// para abrirla, scrollear hasta ella y resaltarla desde el divisor de compactación.
// Sin imports de DOM/Node obligatorios: la prueba `tests/nota-compactar.test.ts` corre esto directo en Node.

export const TAG_NOTA_ABRE = "[[nota-compactar]]";
export const TAG_NOTA_CIERRA = "[[/nota-compactar]]";

export interface NotaCompactar {
  antes: string;
  nota: string;
  despues: string;
  cerrada: boolean;
  secciones: number;
  palabras: number;
}

interface Cerca {
  char: "`" | "~";
  largo: number;
}

function abrirCerca(linea: string): Cerca | null {
  const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(linea);
  if (!m) return null;
  const char = m[1][0] as "`" | "~";
  // En CommonMark una cerca con comillas invertidas no puede tener otra comilla invertida en el lenguaje.
  if (char === "`" && m[2].includes("`")) return null;
  return { char, largo: m[1].length };
}

function cierraCerca(linea: string, cerca: Cerca): boolean {
  const esc = cerca.char === "`" ? "`" : "~";
  return new RegExp(`^ {0,3}${esc}{${cerca.largo},}[ \\t]*$`).test(linea);
}

/** Busca `objetivo` a partir de `desde`, ignorando cercas de código (```` / ~~~) y spans inline (`` `...` ``). */
function buscarTagFueraDeCodigo(texto: string, objetivo: string, desde = 0): number {
  let i = desde;
  let cerca: Cerca | null = null;
  while (i < texto.length) {
    const enInicioLinea = i === 0 || texto[i - 1] === "\n";
    if (enInicioLinea) {
      const finLinea = texto.indexOf("\n", i);
      const corte = finLinea === -1 ? texto.length : finLinea;
      const linea = texto.slice(i, corte);
      if (cerca) {
        if (cierraCerca(linea, cerca)) cerca = null;
        i = finLinea === -1 ? texto.length : finLinea + 1;
        continue;
      }
      const nueva = abrirCerca(linea);
      if (nueva) {
        cerca = nueva;
        i = finLinea === -1 ? texto.length : finLinea + 1;
        continue;
      }
    }

    if (!cerca && texto[i] === "`") {
      let largo = 1;
      while (i + largo < texto.length && texto[i + largo] === "`") largo++;
      let j = i + largo;
      let encontroCierre = false;
      while (j < texto.length) {
        if (texto[j] === "`") {
          let cierreLargo = 1;
          while (j + cierreLargo < texto.length && texto[j + cierreLargo] === "`") cierreLargo++;
          if (cierreLargo === largo) {
            i = j + cierreLargo;
            encontroCierre = true;
            break;
          }
          j += cierreLargo;
          continue;
        }
        j++;
      }
      if (encontroCierre) continue;
      i += largo;
      continue;
    }

    if (texto.startsWith(objetivo, i)) return i;
    i++;
  }
  return -1;
}

/** Cuenta secciones y palabras reales de la nota (ignorando encabezados dentro de cercas de código). */
export function contarNota(nota: string): { secciones: number; palabras: number } {
  const limpio = nota.trim();
  if (!limpio) return { secciones: 0, palabras: 0 };

  let encabezados = 0;
  let vinetasNegrita = 0;
  let titulosNegrita = 0;
  let cerca: Cerca | null = null;

  for (const linea of limpio.split("\n")) {
    if (cerca) {
      if (cierraCerca(linea, cerca)) cerca = null;
      continue;
    }
    const nueva = abrirCerca(linea);
    if (nueva) {
      cerca = nueva;
      continue;
    }
    if (/^\s{0,3}#{1,6}\s+\S/.test(linea)) encabezados++;
    else if (/^\s*[-*]\s+\*\*[^*\n]+\*\*(?:\s*:|\s*$)/.test(linea)) vinetasNegrita++;
    else if (/^\s*\*\*[^*\n]{2,60}\*\*:?\s*$/.test(linea)) titulosNegrita++;
  }

  const secciones = encabezados > 0 ? encabezados : vinetasNegrita > 0 ? vinetasNegrita : titulosNegrita;
  const palabras = limpio.split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p)).length;
  return { secciones, palabras };
}

/**
 * Separa un mensaje del asistente en `(antes, nota, despues)` si trae `[[nota-compactar]]`.
 * En streaming (`vivo: true`), una etiqueta abierta todavía sin cerrar devuelve `cerrada: false`.
 */
export function partirNotaCompactar(texto: string, opciones?: { vivo?: boolean }): NotaCompactar | null {
  if (!texto) return null;
  const inicio = buscarTagFueraDeCodigo(texto, TAG_NOTA_ABRE, 0);
  if (inicio === -1) return null;

  const despuesAbre = inicio + TAG_NOTA_ABRE.length;
  const fin = buscarTagFueraDeCodigo(texto, TAG_NOTA_CIERRA, despuesAbre);

  if (fin === -1) {
    if (!opciones?.vivo) return null;
    const antes = texto.slice(0, inicio).trim();
    const nota = texto.slice(despuesAbre).trim();
    const { secciones, palabras } = contarNota(nota);
    return { antes, nota, despues: "", cerrada: false, secciones, palabras };
  }

  const nota = texto.slice(despuesAbre, fin).trim();
  if (!nota) return null;

  const antes = texto.slice(0, inicio).trim();
  const despues = texto.slice(fin + TAG_NOTA_CIERRA.length).trim();
  const { secciones, palabras } = contarNota(nota);
  return { antes, nota, despues, cerrada: true, secciones, palabras };
}

/** Dice si un turno del asistente tiene al menos una nota cerrada (`Lineal` o `Intercalado`). */
export function turnoTieneNota(turno: { texto?: string | null; orden?: { texto: string }[] }): boolean {
  if (turno.texto && partirNotaCompactar(turno.texto)?.cerrada) return true;
  return turno.orden?.some((p) => Boolean(partirNotaCompactar(p.texto)?.cerrada)) ?? false;
}

// --- Puente para abrir + ir + resaltar la tarjeta desde el divisor de compactación ---

const pendientesAbrirNota = new Set<string>();
const oyentesAbrirNota = new Map<string, Set<() => void>>();

/** Registra la tarjeta de un turno (`key`) para abrirse cuando el usuario pulse "Ver la nota". */
export function suscribirAbrirNota(key: string, fn: () => void): () => void {
  if (!key) return () => {};
  if (pendientesAbrirNota.delete(key)) fn();
  let set = oyentesAbrirNota.get(key);
  if (!set) {
    set = new Set();
    oyentesAbrirNota.set(key, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) oyentesAbrirNota.delete(key);
  };
}

/** Avisa a la tarjeta del turno `key` que debe desplegarse. */
export function pedirAbrirNota(key: string): void {
  if (!key) return;
  const set = oyentesAbrirNota.get(key);
  if (set && set.size > 0) {
    set.forEach((fn) => fn());
  } else {
    pendientesAbrirNota.add(key);
  }
}

/** Abre la tarjeta del turno `key`, scrollea hasta ella y la resalta un instante (`data-resalta`). */
export function irANota(origen: HTMLElement | null, key: string): void {
  if (!key) return;
  pedirAbrirNota(key);
  if (typeof document === "undefined" || typeof requestAnimationFrame === "undefined") return;

  const conv = origen?.closest(".conv") ?? document;
  const buscarTarjeta = (): HTMLElement | null => {
    for (const el of conv.querySelectorAll<HTMLElement>(".nota-comp[data-nota]")) {
      if (el.dataset.nota === key) return el;
    }
    return null;
  };

  requestAnimationFrame(() => {
    const tarjeta = buscarTarjeta();
    if (!tarjeta) return;
    tarjeta.scrollIntoView({ block: "center", behavior: "smooth" });
    delete tarjeta.dataset.resalta;
    void tarjeta.offsetWidth;
    tarjeta.dataset.resalta = "";
    setTimeout(() => delete tarjeta.dataset.resalta, 1400);
  });
}
