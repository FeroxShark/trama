// «Te dejé esto en el tablero»: cuando un líder carga en el tablero algo que le toca a la persona (una pregunta, una prueba, algo en
// `espera-dueno`) o un worker suyo deja una DECISION / PROBAR, el chat lo dice con una tarjeta discreta que abre ese item. Puro y con
// extensión en los imports: lo prueba `node --test` (tests/tablero-dejado.test.ts).
//
// De dónde sale cada uno:
//  - el líder: una llamada a Bash del transcript que corrió `tablero agregar` con `--tipo pregunta|prueba`, `--prueba` o
//    `--columna espera-dueno` Y devolvió un id (el CLI imprime sólo el id del item). Una llamada que falló, que aún corre, o que sólo
//    nombra el comando (un `echo`, un `grep`, un `--help`) no devolvió id y no cuenta: así no hay falsos;
//  - un worker suyo: el aviso que Trama le manda al líder cuando el worker termina (se enruta por `jefe_id`, electron/avisos-worker.ts)
//    trae el id del worker, y `pa` anota sus items con clave `pa:<id>` (DECISION), `pa:<id>:<n>` (preguntas) y `pa:<id>:p1` (PROBAR).
// Qué dice el item hoy (abierto, respondido, cerrado) lo da el tablero leído, nunca la llamada.
import type { Herramienta } from "../datos/contrato";
import type { AvisoTexto } from "../../electron/avisos-worker.ts";
import { corto, TITULO_MAX } from "../datos/pendientes.ts";
import type { Item, ItemId, Tablero } from "../datos/tablero.ts";

/** Lo que el chat sabe de un item sin mirar el tablero: la llamada del líder (con el id que devolvió) o el id de un worker suyo. */
export type RefDejado = { por: "llamada"; id: number; titulo: string } | { por: "worker"; worker: string };

export type EstadoDejado =
  /** Sigue esperando a la persona. */
  | "abierto"
  /** Ya contestó (el item sigue ahí hasta que el líder lo cierre). */
  | "respondido"
  /** Se cerró (o ya no está en el tablero). */
  | "cerrado"
  /** Un renglón de prueba que la persona ya tildó (el item puede seguir abierto por los demás renglones). */
  | "probado"
  /** Todavía no se leyó el tablero: se muestra el título sin decir nada del estado. */
  | "sin-leer";

/** El renglón de la prueba «Probar <proyecto> (…)» que es de este worker: su número (posición, desde 1) y si ya se tildó. El `titulo` de la carta es su texto. */
export type RenglonCarta = { n: number; hecho: boolean };

export type Carta = { key: string; id: ItemId; titulo: string; tipo: "pregunta" | "prueba"; proyecto: string; estado: EstadoDejado; renglon?: RenglonCarta };

// --- La llamada del líder -------------------------------------------------------------

/**
 * Parte un comando de shell en sentencias (`;`, `&&`, `||`, `|`, `&`, salto de línea fuera de comillas) y cada una en palabras, con las comillas
 * simples y dobles quitadas. Sin expansiones: sólo hace falta ver qué comando es y con qué flags. Una `\` al final de línea sigue la sentencia.
 */
export function sentencias(cmd: string): string[][] {
  const fuera: string[][] = [];
  let pal: string[] = [];
  let cur = "";
  let hay = false;
  let q: string | null = null;
  const palabra = () => {
    if (hay) pal.push(cur);
    cur = "";
    hay = false;
  };
  const sentencia = () => {
    palabra();
    if (pal.length) fuera.push(pal);
    pal = [];
  };
  const s = cmd.replace(/\\\r?\n/g, " ");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = null;
      else if (c === "\\" && q === '"' && i + 1 < s.length) cur += s[++i];
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') {
      q = c;
      hay = true;
    } else if (c === "\\" && i + 1 < s.length) {
      cur += s[++i];
      hay = true;
    } else if (c === ";" || c === "|" || c === "&" || c === "\n" || c === "(" || c === ")") sentencia();
    else if (c === " " || c === "\t" || c === "\r") palabra();
    else {
      cur += c;
      hay = true;
    }
  }
  sentencia();
  return fuera;
}

/** Los flags de `tablero agregar` que llevan valor (el título es el primer argumento que no es de ésos). */
const CON_VALOR = new Set(["--columna", "--proyecto", "--detalle", "--detalle-archivo", "--prueba", "--prueba-archivo", "--origen", "--clave", "--hasta", "--tipo", "--simple", "--contexto", "--opcion", "--defecto"]);
const ENVOLTORIOS = new Set(["env", "sudo", "command", "exec", "time", "nohup"]);

/** `tablero`, `/usr/bin/tablero`, `~/.local/bin/tablero.cmd`: el nombre del programa sin carpeta ni extensión de Windows. */
const esTablero = (p: string) => /^tablero(?:\.(?:cmd|exe|ps1|js|mjs))?$/i.test(p.split(/[\\/]/).pop() ?? "");

type Agregar = { tipoPide: boolean; titulo: string };

/** Si la sentencia es `tablero agregar …` y pide algo para la persona: su flag y el título que se le dio. */
function agregarDe(pal: string[]): Agregar | null {
  let i = 0;
  while (i < pal.length && (ENVOLTORIOS.has(pal[i]) || /^[A-Za-z_]\w*=/.test(pal[i]))) i++;
  if (!pal[i] || !esTablero(pal[i]) || pal[i + 1] !== "agregar") return null;
  let pide = false;
  let simple = "";
  let titulo = "";
  const resto = pal.slice(i + 2);
  for (let k = 0; k < resto.length; k++) {
    const a = resto[k];
    if (a === "--") {
      titulo ||= resto[k + 1] ?? "";
      break;
    }
    const eq = a.startsWith("--") ? a.indexOf("=") : -1;
    const flag = eq > 0 ? a.slice(0, eq) : a;
    if (!a.startsWith("--")) {
      titulo ||= a;
      continue;
    }
    const valor = eq > 0 ? a.slice(eq + 1) : CON_VALOR.has(flag) ? (resto[++k] ?? "") : "";
    if (flag === "--tipo" && (valor === "pregunta" || valor === "prueba")) pide = true;
    else if ((flag === "--prueba" || flag === "--prueba-archivo") && valor.trim()) pide = true;
    else if (flag === "--columna" && valor === "espera-dueno") pide = true;
    else if (flag === "--simple") simple = valor;
  }
  return pide ? { tipoPide: true, titulo: (simple || titulo).replace(/\s+/g, " ").trim() } : null;
}

/** El id que imprimió `tablero agregar`: su salida es sólo ese número. */
const idDeSalida = (texto: string): number | null => {
  const m = /^\s*(\d{1,9})\s*$/.exec(texto);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * ¿Esta llamada dejó algo en el tablero para la persona? Una de Bash que corrió `tablero agregar` con `--tipo pregunta|prueba`,
 * `--prueba` o `--columna espera-dueno` y devolvió el id. Sin resultado todavía (corre), con error, o con una salida que no es un
 * id, no: no se sabe que haya quedado nada.
 */
export function dejadoDeLlamada(h: Pick<Herramienta, "nombre" | "entrada" | "resultado">): RefDejado | null {
  if (h.nombre !== "Bash") return null;
  const cmd = h.entrada?.command;
  if (typeof cmd !== "string" || !/tablero/i.test(cmd) || !h.resultado || h.resultado.error) return null;
  const id = idDeSalida(h.resultado.texto);
  if (id === null) return null;
  for (const s of sentencias(cmd)) {
    const a = agregarDe(s);
    if (a) return { por: "llamada", id, titulo: a.titulo };
  }
  return null;
}

/** Lo que dejó un mensaje del líder en el tablero, por sus llamadas (sin repetir un id). */
export function dejadosDeMensaje(det: readonly Herramienta[] | undefined): RefDejado[] {
  const vistos = new Set<number>();
  const fuera: RefDejado[] = [];
  for (const h of det ?? []) {
    const r = dejadoDeLlamada(h);
    if (r?.por === "llamada" && !vistos.has(r.id)) {
      vistos.add(r.id);
      fuera.push(r);
    }
  }
  return fuera;
}

// --- Los workers ----------------------------------------------------------------------

/** Los workers de un aviso que pueden haber dejado algo (los que fallaron no pasan por ahí: `pa` anota al terminar bien). */
export function dejadosDeAviso(a: Pick<AvisoTexto, "trabajos">): RefDejado[] {
  const vistos = new Set<string>();
  const fuera: RefDejado[] = [];
  for (const w of a.trabajos) {
    if (w.falla || vistos.has(w.id)) continue;
    vistos.add(w.id);
    fuera.push({ por: "worker", worker: w.id });
  }
  return fuera;
}

/**
 * ¿Es de este worker la clave de un item? `pa:<id>`, `pa:<id>:<n>` o `pa:<id>:p1`. Los PROBAR nuevos ya no son items sino renglones del
 * item agrupado «Probar <proyecto> (Linux|Windows)» (clave `probar:…`): ahí la clave `pa:<id>:p1` vive en el renglón (`renglonesDelWorker`).
 */
export const esDelWorker = (clave: string, worker: string): boolean => clave === `pa:${worker}` || clave.startsWith(`pa:${worker}:`);

/** Los renglones de un item agrupado que dejó este worker (por la clave del renglón), con su número. Un item sin renglones: ninguno. */
export const renglonesDelWorker = (i: Pick<Item, "renglones">, worker: string): { n: number; texto: string; hecho: boolean }[] =>
  i.renglones.flatMap((r, k) => (esDelWorker(r.clave, worker) ? [{ n: k + 1, texto: r.texto, hecho: r.hecho }] : []));

// --- Qué dice el tablero hoy ----------------------------------------------------------

const tituloDe = (i: Item) => i.tituloSimple.trim() || corto(i.titulo, TITULO_MAX);
const sinEstado = (i: Item) => (i.respuesta ? "respondido" : "abierto");

/** Todos los items que se conocen, con si siguen abiertos (en una columna) o ya se cerraron. */
function todos(t: Tablero): { i: Item; cerrado: boolean }[] {
  const abiertos = Object.values(t.columnas).flat();
  return [...abiertos.map((i) => ({ i, cerrado: false })), ...t.pospuestosLista.map((i) => ({ i, cerrado: false })), ...t.hecho.map((i) => ({ i, cerrado: true }))];
}

/**
 * Las tarjetas de un conjunto de referencias, con el estado que dice el tablero. Un item de la llamada del líder que ya no está en el
 * tablero (cerrado hace más de lo que se guarda, o tirado) sale «cerrado»; el de un worker que no se encuentra no sale (no hay nada que
 * decir de algo que no se sabe que existió). Sin tablero leído (`null`), las del líder salen con su título y sin estado.
 */
export function cartas(refs: readonly RefDejado[], t: Tablero | null): Carta[] {
  const fuera: Carta[] = [];
  const vistas = new Set<string>();
  const poner = (c: Carta) => {
    if (vistas.has(c.key)) return;
    vistas.add(c.key);
    fuera.push(c);
  };
  const lista = t ? todos(t) : [];
  for (const r of refs) {
    if (r.por === "llamada") {
      const f = lista.find((x) => x.i.id === r.id && !x.i.maquina);
      if (f) poner({ key: `i${f.i.id}`, id: f.i.id, titulo: tituloDe(f.i) || r.titulo, tipo: f.i.tipo, proyecto: f.i.proyecto, estado: f.cerrado ? "cerrado" : sinEstado(f.i) });
      else poner({ key: `i${r.id}`, id: r.id, titulo: r.titulo, tipo: "pregunta", proyecto: "", estado: t ? "cerrado" : "sin-leer" });
    } else {
      for (const x of lista) {
        if (x.i.maquina) continue;
        // Un item de worker que aún está en el tablero sólo cuenta si le toca a la persona (en `espera-dueno`) o ya se cerró.
        if (!x.cerrado && x.i.columna !== "espera-dueno") continue;
        // Su PROBAR como renglón del item agrupado: la carta es el renglón y dice si ya está tildado.
        for (const g of renglonesDelWorker(x.i, r.worker)) {
          poner({ key: `i${x.i.id}r${g.n}`, id: x.i.id, titulo: g.texto, tipo: "prueba", proyecto: x.i.proyecto, estado: g.hecho ? "probado" : x.cerrado ? "cerrado" : "abierto", renglon: { n: g.n, hecho: g.hecho } });
        }
        if (!esDelWorker(x.i.clave, r.worker)) continue;
        poner({ key: `i${x.i.id}`, id: x.i.id, titulo: tituloDe(x.i), tipo: x.i.tipo, proyecto: x.i.proyecto, estado: x.cerrado ? "cerrado" : sinEstado(x.i) });
      }
    }
  }
  return fuera;
}
