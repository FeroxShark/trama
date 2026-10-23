// El markdown de un mensaje, partido sin librería (puro: lo pinta Texto.tsx):
// párrafos, listas (anidadas, con casillas), bloques ``` con su lenguaje, títulos
// con "#" y su nivel, citas, separadores, tablas GFM y, adentro de un renglón,
// `código`, **negrita**, *cursiva*, ~~tachado~~, [enlaces](https://…) y las URLs
// sueltas. Lo demás va tal cual.
//
// `vivo`: el texto todavía está llegando (el stream de un líder). Lo que quedó a
// medias se pinta ya como lo que va a ser (la negrita sin cerrar, el encabezado de
// una tabla, el enlace sin su paréntesis): así no cambia de forma al completarse.

/** Cómo se alinea una columna: lo dice su celda del separador (`:---`, `:---:`, `---:`). */
export type Alineacion = "l" | "c" | "r" | null;

/** Un ítem de lista: su texto, la casilla si es `- [ ]` / `- [x]`, los bloques con sangría que cuelgan de él (código, tablas) y la lista que cuelga después. */
export type Item = { texto: string; hecho?: boolean; bloques?: Bloque[]; sub?: Lista };
export type Lista = { tipo: "ol" | "ul"; items: Item[]; desde?: number };

/** Un renglón de terminal pegada: `prompt` es el signo ("❯", "$") si es un comando; si no, salida. */
export type Renglon = { prompt: string; texto: string };

export type Bloque =
  | { tipo: "p"; texto: string }
  | { tipo: "h"; texto: string; nivel: number }
  | { tipo: "pre"; texto: string; lang: string }
  | Lista
  | { tipo: "cita"; bloques: Bloque[] }
  | { tipo: "hr" }
  | { tipo: "term"; lineas: Renglon[] }
  | { tipo: "tabla"; cabeza: string[]; alinea: Alineacion[]; filas: string[][] };

export type Trozo =
  | { tipo: "texto" | "code" | "b" | "i" | "s"; texto: string }
  /** `url` vacía: un enlace que todavía está llegando (`vivo`). */
  | { tipo: "link"; texto: string; url: string };

export type Opciones = {
  /** El texto está llegando: lo que quedó a medias no cambia de forma al completarse. */
  vivo?: boolean;
  /** Un mensaje del usuario: lo que pegó de una terminal ("❯ comando" y su salida) va como terminal. */
  terminal?: boolean;
};

const NUM = /^\s*(\d+)[.)]\s+/;
const GUION = /^\s*[-*+•]\s+/;
const TITULO = /^\s{0,3}(#{1,6})\s+/;
const CERCA = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/;
const CITA = /^\s{0,3}>\s?/;
const REGLA = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const CASILLA = /^\[([ xX])\]\s+/;
/** El signo de un prompt al principio del renglón, con su comando (o solo, esperando). */
const PROMPT = /^\s*([❯➜$])(?:\s+(.*))?$/;
/** Una barra que parte celdas: la escapada (`\|`) es texto. */
const BARRA = /(?<!\\)\|/;
const SEPARADOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
/** Un separador que todavía se está escribiendo (`|--`, `|---|:`). */
const SEPARADOR_A_MEDIAS = /^\s*\|[\s:|-]*$/;
/** Lo que abre un bloque y todavía no dice nada: mientras llega, no se pinta. */
const SUELTO = /^\s*(#{1,6}|`{1,2}|~{1,2}|[-*_+•]{1,2}|\d+[.)])\s*$/;

const sangria = (l: string) => l.length - l.trimStart().length;

/** Las celdas de un renglón de tabla: sin las barras de las puntas, `\|` → `|` y `<br>` → salto. */
function celdas(l: string): string[] {
  let s = l.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (/(?<!\\)\|$/.test(s)) s = s.slice(0, -1);
  return s.split(BARRA).map((c) =>
    c
      .trim()
      .replace(/\\\|/g, "|")
      .replace(/<br\s*\/?>/gi, "\n"),
  );
}

/** La alineación de cada columna si el renglón es el separador de una tabla; si no, null. */
function separador(l: string | undefined): Alineacion[] | null {
  if (l === undefined || !l.includes("|") || !SEPARADOR.test(l)) return null;
  return celdas(l).map((c) => {
    const izq = c.startsWith(":");
    const der = c.endsWith(":");
    return izq && der ? "c" : der ? "r" : izq ? "l" : null;
  });
}

const esMarca = (l: string) => NUM.test(l) || GUION.test(l);
/** El renglón `i` abre una tabla: tiene barras y el siguiente es su separador, con tantas celdas. */
function abreTabla(lineas: string[], i: number): boolean {
  const alinea = BARRA.test(lineas[i]) ? separador(lineas[i + 1]) : null;
  return !!alinea && celdas(lineas[i]).length === alinea.length;
}

const abreBloque = (l: string) => CERCA.test(l) || esMarca(l) || TITULO.test(l) || CITA.test(l) || REGLA.test(l);

type Marca = { sangria: number; tipo: "ol" | "ul"; num: number; texto: string; bloques: Bloque[] };

/** Los renglones de una lista (ya leídos, con su sangría) armados en árbol: más sangría cuelga del ítem de arriba. */
function arbol(marcas: Marca[]): Lista[] {
  const raices: Lista[] = [];
  let pila: { sangria: number; lista: Lista }[] = [];
  for (const m of marcas) {
    const casilla = CASILLA.exec(m.texto);
    const item: Item = casilla ? { texto: m.texto.slice(casilla[0].length), hecho: casilla[1] !== " " } : { texto: m.texto };
    if (m.bloques.length) item.bloques = m.bloques;
    const nueva = (): Lista => (m.tipo === "ol" && m.num !== 1 ? { tipo: m.tipo, items: [item], desde: m.num } : { tipo: m.tipo, items: [item] });
    while (pila.length > 1 && m.sangria < pila[pila.length - 1].sangria) pila.pop();
    const arriba = pila[pila.length - 1];
    if (arriba && m.sangria > arriba.sangria + 1) {
      // Más adentro que la de arriba: cuelga de su último ítem.
      const lista = nueva();
      arriba.lista.items[arriba.lista.items.length - 1].sub = lista;
      pila.push({ sangria: m.sangria, lista });
    } else if (arriba && (pila.length > 1 || arriba.lista.tipo === m.tipo)) {
      arriba.lista.items.push(item);
    } else {
      // En la raíz, pasar de números a guiones (o al revés) es otra lista.
      const lista = nueva();
      raices.push(lista);
      pila = [{ sangria: m.sangria, lista }];
    }
  }
  return raices;
}

export function bloques(texto: string, op: Opciones = {}): Bloque[] {
  const out: Bloque[] = [];
  let p: string[] = [];
  const cortar = () => {
    if (p.length) out.push({ tipo: "p", texto: p.join("\n") });
    p = [];
  };
  const lineas = texto.replace(/\r/g, "").split("\n");
  // Hasta dónde llega lo pegado de una terminal: el párrafo del último prompt.
  let finTerm = -1;
  if (op.terminal) {
    let cerca = false;
    let ultimo = -1;
    for (let i = 0; i < lineas.length; i++) {
      if (CERCA.test(lineas[i])) cerca = !cerca;
      else if (!cerca && PROMPT.test(lineas[i])) ultimo = i;
    }
    for (finTerm = ultimo; finTerm >= 0 && finTerm + 1 < lineas.length && lineas[finTerm + 1].trim(); ) finTerm++;
  }
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    const ultima = i === lineas.length - 1;
    const cerca = CERCA.exec(l);
    if (cerca) {
      cortar();
      const codigo: string[] = [];
      // Adentro de un ítem de lista viene con sangría: se le saca la de su cerca.
      const s = sangria(l);
      const quita = (x: string) => x.slice(Math.min(s, sangria(x)));
      const cierra = (x: string) => x.trim().startsWith(cerca[1]) && x.trim().replace(/[`~]/g, "") === "";
      while (++i < lineas.length && !cierra(lineas[i])) codigo.push(quita(lineas[i]));
      out.push({ tipo: "pre", texto: codigo.join("\n"), lang: cerca[2].toLowerCase() });
      continue;
    }
    if (op.terminal && i <= finTerm && PROMPT.test(l)) {
      cortar();
      const term: Renglon[] = [];
      for (; i <= finTerm; i++) {
        const m = PROMPT.exec(lineas[i]);
        term.push(m ? { prompt: m[1], texto: m[2] ?? "" } : { prompt: "", texto: lineas[i] });
      }
      i--;
      out.push({ tipo: "term", lineas: term });
      continue;
    }
    // Lo que abre un bloque y todavía no trae nada ("#", "-", "1.", "`"): se espera a lo que sigue.
    if (op.vivo && ultima && SUELTO.test(l)) break;
    if (REGLA.test(l)) {
      cortar();
      out.push({ tipo: "hr" });
      continue;
    }
    if (esMarca(l)) {
      cortar();
      const marcas: Marca[] = [];
      /** El renglón `j` abre un bloque (código o tabla) más adentro que el último ítem. */
      const engancha = (j: number) => {
        const ult = marcas[marcas.length - 1];
        return ult !== undefined && sangria(lineas[j]) > ult.sangria && (CERCA.test(lineas[j]) || abreTabla(lineas, j));
      };
      for (; i < lineas.length; i++) {
        const x = lineas[i];
        const n = NUM.exec(x);
        if (n || GUION.test(x)) {
          if (REGLA.test(x)) break;
          marcas.push({ sangria: sangria(x), tipo: n ? "ol" : "ul", num: n ? Number(n[1]) : 0, texto: x.replace(n ? NUM : GUION, ""), bloques: [] });
        } else if (!x.trim()) {
          // Un renglón vacío entre ítems no corta la lista; antes de otra cosa, sí
          // (salvo un bloque del ítem: su código o su tabla, con más sangría).
          const sig = lineas[i + 1];
          if (!(sig !== undefined && ((esMarca(sig) && !REGLA.test(sig)) || engancha(i + 1)))) break;
        } else if (engancha(i)) {
          // Un código o una tabla con más sangría que su ítem cuelga de él, también entre ítems.
          const desde = i;
          if (CERCA.test(x)) {
            const cerca = CERCA.exec(x)![1];
            while (++i < lineas.length && !(lineas[i].trim().startsWith(cerca) && lineas[i].trim().replace(/[`~]/g, "") === "")) {}
            if (i >= lineas.length) i = lineas.length - 1;
          } else {
            for (i++; i + 1 < lineas.length && BARRA.test(lineas[i + 1]) && !abreBloque(lineas[i + 1]); ) i++;
          }
          const quita = sangria(x);
          const trozo = lineas.slice(desde, i + 1).map((r) => r.slice(Math.min(quita, sangria(r)))).join("\n");
          marcas[marcas.length - 1].bloques.push(...bloques(trozo, { vivo: op.vivo && i === lineas.length - 1 }));
        } else if (sangria(x) > marcas[marcas.length - 1].sangria && !abreBloque(x) && lineas[i - 1].trim() && !(op.vivo && i === lineas.length - 1 && SUELTO.test(x))) {
          // Con más sangría que su ítem y sin marca: sigue el ítem de arriba (o, tras su código, un párrafo suyo).
          const ult = marcas[marcas.length - 1];
          const cola = ult.bloques[ult.bloques.length - 1];
          if (!cola) ult.texto += "\n" + x.trim();
          else if (cola.tipo === "p") cola.texto += "\n" + x.trim();
          else ult.bloques.push({ tipo: "p", texto: x.trim() });
        } else break;
      }
      i--;
      out.push(...arbol(marcas));
      continue;
    }
    const titulo = TITULO.exec(l);
    if (titulo) {
      cortar();
      out.push({ tipo: "h", texto: l.replace(TITULO, "").replace(/\s+#+\s*$/, ""), nivel: titulo[1].length });
      continue;
    }
    if (CITA.test(l)) {
      cortar();
      const cita: string[] = [];
      for (; i < lineas.length && CITA.test(lineas[i]); i++) cita.push(lineas[i].replace(CITA, ""));
      i--;
      out.push({ tipo: "cita", bloques: bloques(cita.join("\n"), { vivo: op.vivo && i === lineas.length - 1 }) });
      continue;
    }
    // Una tabla empieza recién cuando llegó su separador entero (tantas celdas como
    // el encabezado): si no, el encabezado es texto.
    const alinea = BARRA.test(l) ? separador(lineas[i + 1]) : null;
    const cabeza = alinea ? celdas(l) : null;
    if (alinea && cabeza && cabeza.length === alinea.length) {
      cortar();
      const filas: string[][] = [];
      i++;
      // Hasta el primer renglón vacío, sin barras o que abre otro bloque; a cada fila
      // le sobran o le faltan celdas según el encabezado (la última puede venir a medias).
      while (i + 1 < lineas.length && BARRA.test(lineas[i + 1]) && !abreBloque(lineas[i + 1])) {
        const f = celdas(lineas[++i]).slice(0, cabeza.length);
        while (f.length < cabeza.length) f.push("");
        filas.push(f);
      }
      out.push({ tipo: "tabla", cabeza, alinea, filas });
      continue;
    }
    // Mientras llega, un renglón que empieza con "|" ya es el encabezado de una tabla
    // (con su separador a medias debajo): no pasa de texto a tabla al completarse.
    if (op.vivo && l.trimStart().startsWith("|") && (ultima || (i === lineas.length - 2 && (!lineas[i + 1].trim() || SEPARADOR_A_MEDIAS.test(lineas[i + 1]))))) {
      cortar();
      const c = celdas(l);
      out.push({ tipo: "tabla", cabeza: c, alinea: c.map(() => null), filas: [] });
      break;
    }
    if (!l.trim()) cortar();
    else p.push(l);
  }
  cortar();
  return out;
}

const URL_SUELTA = /https?:\/\/[^\s<>`]+/;
// Un enlace sólo con esquema: `a[i](x)` en medio de la prosa no es un enlace. La cursiva,
// sólo entre bordes de palabra: `2*3*4` y `mi_variable_larga` quedan como están.
const EN_LINEA = new RegExp(
  "(" +
    [
      "`[^`\\n]+`",
      "\\*\\*\\*[^*\\n]+\\*\\*\\*",
      "\\*\\*[^*\\n]+\\*\\*",
      "~~[^~\\n]+~~",
      "\\[[^\\]\\n]+\\]\\((?:https?:\\/\\/|mailto:)[^)\\s]+\\)",
      "<https?:\\/\\/[^\\s<>]+>",
      URL_SUELTA.source,
      // Un comodín no es cursiva: `docs/*.md y src/*.ts` (ni pegado a "/", ni delante de un punto).
      "(?<![\\w*/])\\*[^\\s*.](?:[^*\\n]*[^\\s*/])?\\*(?![\\w*])",
      "(?<![\\w_])_[^\\s_](?:[^_\\n]*[^\\s_])?_(?![\\w_])",
    ].join("|") +
    ")",
);
const ENLACE = /^\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)$/;
/** Un enlace a medio llegar, al final del texto: `[texto](https://exam`. */
const ENLACE_A_MEDIAS = /\[([^\]\n]+)\]\([^)\s]*$/;

/** Un renglón de terminal: sólo sus URLs sueltas son enlaces; lo demás, tal cual (nada de markdown). */
export function sueltas(t: string): Trozo[] {
  const out: Trozo[] = [];
  t.split(new RegExp(`(${URL_SUELTA.source})`)).forEach((x, n) => {
    if (!x) return;
    if (n % 2 === 0) return void out.push({ tipo: "texto", texto: x });
    const [url, resto] = recortar(x);
    out.push({ tipo: "link", texto: url, url });
    if (resto) out.push({ tipo: "texto", texto: resto });
  });
  return out;
}

/** La puntuación del final de una URL suelta no es de la URL ("mirá https://x.com."), ni el paréntesis que la encierra. */
function recortar(url: string): [string, string] {
  let fin = url.length;
  for (;;) {
    const c = url[fin - 1] ?? "";
    if (/[.,;:!?'"*_~]/.test(c)) fin--;
    else if (c === ")" && !url.slice(0, fin).includes("(")) fin--;
    else break;
  }
  return [url.slice(0, fin), url.slice(fin)];
}

/**
 * Un renglón partido en texto, `código`, **negrita**, *cursiva*, ~~tachado~~ y enlaces.
 * Lo de adentro de la negrita, la cursiva, el tachado y el texto de un enlace viene crudo:
 * el que pinta lo vuelve a partir (`enlaces: false` adentro de un enlace).
 */
export function trozos(t: string, op: { vivo?: boolean; enlaces?: boolean } = {}): Trozo[] {
  const out: Trozo[] = [];
  const texto = (x: string) => {
    const ult = out[out.length - 1];
    if (!x) return;
    if (ult?.tipo === "texto") ult.texto += x;
    else out.push({ tipo: "texto", texto: x });
  };
  const enlaces = op.enlaces !== false;
  // Con un grupo que captura, `split` deja lo que coincidió en los lugares impares.
  t.split(EN_LINEA).forEach((x, n) => {
    if (!x) return;
    if (n % 2 === 0) return texto(x);
    const c = x[0];
    const m = c === "[" ? ENLACE.exec(x) : null;
    if (c === "`") out.push({ tipo: "code", texto: x.slice(1, -1) });
    else if (x.startsWith("***")) out.push({ tipo: "b", texto: x.slice(3, -3) });
    else if (x.startsWith("**")) out.push({ tipo: "b", texto: x.slice(2, -2) });
    else if (c === "~") out.push({ tipo: "s", texto: x.slice(2, -2) });
    else if (c === "*" || c === "_") out.push({ tipo: "i", texto: x.slice(1, -1) });
    else if (m) enlaces ? out.push({ tipo: "link", texto: m[1], url: m[2] }) : texto(m[1]);
    else if (c === "<") enlaces ? out.push({ tipo: "link", texto: x.slice(1, -1), url: x.slice(1, -1) }) : texto(x.slice(1, -1));
    else {
      const [url, resto] = recortar(x);
      if (enlaces && url.length > 8) out.push({ tipo: "link", texto: url, url });
      else texto(url);
      texto(resto);
    }
  });
  if (op.vivo) aMedias(out, enlaces);
  return out;
}

/** Lo que quedó abierto al final de un texto que está llegando: código, negrita o un enlace sin cerrar. */
function aMedias(out: Trozo[], enlaces: boolean) {
  const ult = out[out.length - 1];
  const previo = out[out.length - 2];
  // `[texto](https://exam`: la URL a medias ya salió como suelta; es la de ese enlace.
  const abre = ult?.tipo === "link" && ult.texto === ult.url && previo?.tipo === "texto" ? /\[([^\]\n]+)\]\($/.exec(previo.texto) : null;
  if (abre && previo) {
    out.splice(-2, 2);
    if (abre.index > 0) out.push({ tipo: "texto", texto: previo.texto.slice(0, abre.index) });
    if (enlaces) out.push({ tipo: "link", texto: abre[1], url: "" });
    else out.push({ tipo: "texto", texto: abre[1] });
    return;
  }
  if (ult?.tipo !== "texto") return;
  const t = ult.texto;
  const partir = (en: number, nuevo: Trozo) => {
    out.pop();
    if (en > 0) out.push({ tipo: "texto", texto: t.slice(0, en) });
    if (nuevo.texto) out.push(nuevo);
  };
  // Sólo lo que se abrió en el último renglón: lo de arriba ya no se va a cerrar.
  const renglon = t.lastIndexOf("\n") + 1;
  const codigo = t.lastIndexOf("`");
  if (codigo >= renglon) return partir(codigo, { tipo: "code", texto: t.slice(codigo + 1) });
  const negrita = t.lastIndexOf("**");
  if (negrita >= renglon) return partir(negrita, { tipo: "b", texto: t.slice(negrita + 2).replace(/\*$/, "") });
  const enlace = enlaces ? ENLACE_A_MEDIAS.exec(t) : null;
  if (enlace && enlace.index >= renglon) return partir(enlace.index, { tipo: "link", texto: enlace[1], url: "" });
}

const EXTENSIONES =
  "md|txt|ts|tsx|js|jsx|mjs|cjs|json|jsonl|toml|ya?ml|css|html|sh|py|rs|go|lua|qml|conf|service|png|svg|jpg|lock|log|sql|c|h|cpp|rb|java|kt|swift|ini|env|csv|pdf";
const ARCHIVO = new RegExp(`^[\\w.@+-]+\\.(?:${EXTENSIONES})(?::\\d+(?:[:-]\\d+)?)?$`, "i");
const CARPETAS = /^(?:~|\.{1,2})?\/?[\w.@+-]+(?:\/[\w.@+*-]+)+\/?(?::\d+(?:[:-]\d+)?)?$/;

/** Un `código` en línea que es una ruta de archivo (`src/hilo/Texto.tsx:12`, `~/x`, `package.json`): se pinta distinto. */
export function esRuta(t: string): boolean {
  if (t.length > 200 || /\s/.test(t) || t.includes("://") || !/[a-z]/i.test(t)) return false;
  return ARCHIVO.test(t) || CARPETAS.test(t) || /^~\/?$/.test(t) || /^(?:~|\.{1,2})\/[\w.@+-]+\/?$/.test(t);
}
