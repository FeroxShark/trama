// Qué está haciendo un líder de la app, clasificado para la tarjeta del chat (src/hilo/Actividad.tsx, dirección C de
// referencias/maquetas/actividad): el tipo de escena (pensando, web, código, editando, comando, delegando, permiso,
// escribiendo), el verbo, lo concreto en una pastilla y los pasos que ya pasaron. Sin React: devuelve claves
// (`hz.*`) y textos ya limpios; los traduce la vista.
import type { HaceLider } from "../datos/contrato";
import { t, type Clave } from "../i18n/index.ts";

// Los contadores del pie de la tarjeta, con el plural bien: una clave para el 1 y otra para el resto (como directo.espera / directo.esperaN).
export const cuentaPasos = (n: number) => (n === 1 ? t("hz.paso1") : t("hz.pasos", { n }));
export const cuentaMas = (n: number) => (n === 1 ? t("hz.mas1") : t("hz.mas", { n }));
/** `escrito`: el número ya como se muestra ("1,2k"); sólo exactamente 1 usa el singular. */
export const cuentaTokens = (n: number, escrito: string) => (n === 1 ? t("hace.token1") : t("hace.tokens", { n: escrito }));

export type Tipo = "pensando" | "web" | "codigo" | "editando" | "comando" | "delegando" | "permiso" | "escribiendo";

export type Actividad = {
  tipo: Tipo;
  /** Clave de i18n del verbo ("Leyendo"). */
  verbo: string;
  /** Lo concreto, ya limpio y corto (para la pastilla mono). Si es una clave de i18n, `detalleClave` la nombra. */
  detalle: string;
  /** Si la pastilla es una frase fija: su clave de i18n (con `detalle` de variable `d`, si hay). */
  detalleClave?: string;
  /** El dibujo de lo concreto (Bash → terminal, Read → archivo…). */
  icono: Icono;
};

/** Un paso que ya pasó: lo que hacía y cuánto tardó (en s; sólo importa para el razonamiento). */
export type Paso = { hace: HaceLider; seg: number };

/** Lo que dicen los pasos: la clave de i18n (`hz.p.*`) y su variable `d` (o `s`). */
export type TextoPaso = { clave: string; d: string; s?: number };

/** Los pasos de atrás que se muestran de entrada (el más reciente primero); el resto, tras "+N pasos". */
export const PASOS = 3;
/** Los pasos que se guardan del turno (los más viejos se pierden; `n` sigue contando). */
export const MAX_PASOS = 40;

/** En qué anda el líder, para el punto de color de la tarjeta. */
export type Estado = "espera" | "piensa" | "herramienta" | "escribe" | "permiso";

/** El estado de una actividad: esperando al modelo, razonando, con una herramienta, redactando o esperando al usuario. */
export function estadoDe(a: Actividad): Estado {
  if (a.tipo === "permiso") return "permiso";
  if (a.tipo === "escribiendo") return "escribe";
  if (a.tipo === "pensando") return a.detalleClave === "hz.d.esperando" ? "espera" : "piensa";
  return "herramienta";
}

/** La clase de icono de lo que hace o hizo (la vista elige el dibujo). */
export type Icono = "pensar" | "leer" | "buscar" | "editar" | "escribir" | "correr" | "web" | "delegar" | "texto" | "permiso" | "otro";

export function iconoDe(h: HaceLider): Icono {
  if (h.que === "pensando" || h.que === "pidiendo") return "pensar";
  if (h.que === "escribiendo") return "texto";
  if (h.que !== "herramienta") return "otro";
  const p = partes(h);
  switch (p.tipo) {
    case "web":
      return "web";
    case "editando":
      return h.nombre === "Write" ? "escribir" : "editar";
    case "delegando":
      return "delegar";
    case "permiso":
      return "permiso";
    case "codigo":
      return LEER.has(h.nombre) ? "leer" : "buscar";
    case "comando":
      return h.nombre === "Bash" ? "correr" : "otro";
    default:
      return "otro";
  }
}

/** Lo largo se pliega en la tarjeta (con "Ver todo"), nunca se corta: a partir de estos caracteres. */
export const PLIEGUE = 200;

/** ¿Pasa de `PLIEGUE`? La vista lo muestra plegado con un botón para desplegarlo. */
export const muyLargo = (s: string): boolean => s.length > PLIEGUE;

/** Una línea, sin espacios de más. Entera: lo largo lo pliega la vista, no lo corta acá. */
export function unaLinea(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Una ruta con el home como `~`. Entera: se lee de punta a punta (con wrap). */
export function rutaLegible(r: string): string {
  return r.trim().replace(/^\/(?:home|Users)\/[^/]+(?=\/|$)/, "~");
}

/** `cd /algún/lado && npm test` → `npm test` (lo que importa es el comando, no dónde se paró). */
export function limpiarComando(cmd: string): string {
  let c = cmd.trim();
  for (;;) {
    const m = c.match(/^cd\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+)\s*(?:&&|;)\s*/);
    if (!m) break;
    c = c.slice(m[0].length);
  }
  return unaLinea(c || cmd);
}

/** El dominio de una URL (`developer.mozilla.org`), o la URL acortada si no se entiende. */
export function dominio(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    const h = url.match(/^(?:[a-z]+:\/\/)?(?:www\.)?([^/\s?#]+)/i)?.[1];
    return h ?? unaLinea(url);
  }
}

// `pa <proyecto> "<tarea>"` lanza un worker: es delegar. Las demás formas (integrar, ver la lista, esperar…) son un comando más.
const PA_GESTION = new Set(["--integrar", "--hilos", "--hilo", "--esperar", "--parar", "--revertir", "--nota", "--rinde", "--leer", "--tests", "--archivar", "--descartar", "--retomar", "--ayuda", "-h", "--help", "--json"]);
const PA_VALOR = new Set(["--tipo", "--modelo", "--model", "--effort", "--esfuerzo", "--jefe", "--rama", "--en"]);

/** A quién delega un `pa …` del Bash ("hilos · arreglar el índice"), o `null` si no es lanzar un worker. */
export function delegaPa(cmd: string): string | null {
  const c = limpiarComando(cmd);
  if (!/^pa\s/.test(c)) return null;
  const toks = c.slice(2).match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const libres: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const x = toks[i];
    if (PA_GESTION.has(x.split("=")[0])) return null;
    if (x === "--") {
      libres.push(...toks.slice(i + 1));
      break;
    }
    if (x.startsWith("-")) {
      if (PA_VALOR.has(x)) i++;
      continue;
    }
    libres.push(x);
  }
  const [proy, ...tarea] = libres;
  if (!proy || !/^[\w.-]+$/.test(proy)) return null;
  const t = tarea.join(" ").replace(/^["']|["']$/g, "");
  return t ? `${proy} · ${t}` : proy;
}

const LEER = new Set(["Read", "NotebookRead"]);
const EDITAR = new Set(["Edit", "MultiEdit", "NotebookEdit"]);
const DELEGAR = new Set(["Task", "Agent"]);

/** Un Grep: «patrón» en la carpeta. */
const buscando = (d: string, extra: string | undefined) => unaLinea(extra ? `«${d}» ${t("hz.d.enCarpeta", { e: rutaLegible(extra) })}` : `«${d}»`);

type Partes = { tipo: Tipo; verbo: string; paso: string; d: string | null; fija?: string };

function partes(h: HaceLider): Partes {
  if (h.que === "pidiendo") return { tipo: "pensando", verbo: "hz.pensando", paso: "hz.p.penso", d: null, fija: "hz.d.esperando" };
  if (h.que === "pensando") return { tipo: "pensando", verbo: "hz.pensando", paso: "hz.p.penso", d: null, fija: "hz.d.oculto" };
  if (h.que === "escribiendo") return { tipo: "escribiendo", verbo: "hz.escribiendo", paso: "hz.p.escribio", d: null, fija: "hz.d.respuesta" };
  if (h.que !== "herramienta") return { tipo: "pensando", verbo: "hz.pensando", paso: "hz.p.uso", d: null }; // compactando
  const { nombre: n, detalle: d, extra } = h;
  if (n === "ExitPlanMode") return { tipo: "permiso", verbo: "hz.permiso", paso: "hz.p.uso", d: null, fija: "hz.d.plan" };
  if (n === "AskUserQuestion") return { tipo: "permiso", verbo: "hz.permiso", paso: "hz.p.uso", d: null, fija: "hz.d.pregunta" };
  if (n === "WebSearch") return { tipo: "web", verbo: "hz.web.buscar", paso: "hz.p.webBusco", d: d ? unaLinea(`«${d}»`) : n };
  if (n === "WebFetch") return { tipo: "web", verbo: "hz.web.leer", paso: "hz.p.leyo", d: d ? dominio(d) : n };
  if (LEER.has(n)) return { tipo: "codigo", verbo: "hz.leer", paso: "hz.p.leyo", d: d ? rutaLegible(d) : n };
  if (n === "Grep") return { tipo: "codigo", verbo: "hz.buscar", paso: "hz.p.busco", d: d ? buscando(d, extra) : n };
  if (n === "Glob") return { tipo: "codigo", verbo: "hz.buscarArchivos", paso: "hz.p.busco", d: d ? buscando(d, extra) : n };
  if (EDITAR.has(n)) return { tipo: "editando", verbo: "hz.editar", paso: "hz.p.edito", d: d ? rutaLegible(d) : n };
  if (n === "Write") return { tipo: "editando", verbo: "hz.escribirArchivo", paso: "hz.p.escribioArchivo", d: d ? rutaLegible(d) : n };
  if (DELEGAR.has(n)) return { tipo: "delegando", verbo: "hz.delegar", paso: "hz.p.delego", d: d ? unaLinea(extra ? `${extra} · ${d}` : d) : (extra ?? n) };
  if (n === "Bash") {
    const pa = d ? delegaPa(d) : null;
    if (pa) return { tipo: "delegando", verbo: "hz.delegar", paso: "hz.p.delego", d: unaLinea(pa) };
    return { tipo: "comando", verbo: "hz.correr", paso: "hz.p.corrio", d: d ? limpiarComando(d) : n };
  }
  return { tipo: "comando", verbo: "hz.usar", paso: "hz.p.uso", d: unaLinea(d ? `${n}: ${d}` : n) };
}

/** Lo que hace el líder ahora, a la vista de la tarjeta. */
export function clasificar(h: HaceLider): Actividad {
  const p = partes(h);
  const icono = iconoDe(h);
  if (p.fija) return { tipo: p.tipo, verbo: p.verbo, detalle: p.d ?? "", detalleClave: p.fija, icono };
  return { tipo: p.tipo, verbo: p.verbo, detalle: p.d ?? "", icono };
}

/** Un pedido de permiso sin contestar (`Pedido` de vivo.ts): "Te necesita", con qué. */
export function clasificarPedido(p: { herramienta: string; detalle: string | null; plan: string | null; preguntas: { question: string }[] | null }): Actividad {
  if (p.plan !== null || p.herramienta === "ExitPlanMode") return { tipo: "permiso", verbo: "hz.permiso", detalle: "", detalleClave: "hz.d.plan", icono: "permiso" };
  if (p.preguntas?.length) return { tipo: "permiso", verbo: "hz.permiso", detalle: unaLinea(p.preguntas[0].question), detalleClave: "hz.d.pregunta", icono: "permiso" };
  const d = p.detalle ? (p.herramienta === "Bash" ? limpiarComando(p.detalle) : unaLinea(p.detalle)) : "";
  return { tipo: "permiso", verbo: "hz.permiso", detalle: unaLinea(d ? `${p.herramienta}: ${d}` : p.herramienta), detalleClave: "hz.d.permiso", icono: "permiso" };
}

/** El paso ya pasado, en palabras ("Leyó src/x.ts", "Pensó 6 s"), o `null` si no vale la pena mostrarlo. */
export function textoPaso(p: Paso): TextoPaso | null {
  if (p.hace.que === "pensando") return p.seg >= 1 ? { clave: "hz.p.penso", d: "", s: Math.round(p.seg) } : null;
  if (p.hace.que !== "herramienta") return null;
  const x = partes(p.hace);
  if (x.fija) return { clave: x.paso, d: p.hace.nombre };
  return { clave: x.paso, d: x.d ?? p.hace.nombre };
}

/** El seguimiento de los pasos de un turno (vive en el indicador de vivo.ts). */
export type Seguimiento = { hace: HaceLider | null; inicio: number; pasos: Paso[]; /** Cuántos pasos lleva el turno (los guardados son los últimos `MAX_PASOS`). */ n: number };

const SIN: Seguimiento = { hace: null, inicio: 0, pasos: [], n: 0 };
export const sinPasos = SIN;

/** Es la misma cosa que ya corría: igual, o la misma herramienta cuando todavía no se sabía su detalle (el stream la anuncia y después la completa). */
export function mismo(a: HaceLider, b: HaceLider): boolean {
  if (a.que !== b.que) return false;
  if (a.que !== "herramienta" || b.que !== "herramienta") return true;
  return a.nombre === b.nombre && (a.detalle === null || (a.detalle === b.detalle && a.extra === b.extra));
}

/**
 * Lo que `Indicador` guarda al cambiar lo que hace el líder: cuándo empezó esta cosa y los pasos de atrás. Lo que ya
 * corría y sólo se completa no es un paso nuevo; lo que se pasa de largo (pidiendo, escribiendo, compactar, un
 * razonamiento de menos de un segundo) no se cuenta. `nuevo: null` (terminó el turno) lo borra todo.
 */
export function avanzar(s: Seguimiento, nuevo: HaceLider | null, ahora: number): Seguimiento {
  if (nuevo === null) return s.hace === null && s.pasos.length === 0 ? s : SIN;
  if (s.hace && mismo(s.hace, nuevo)) return { ...s, hace: nuevo };
  let pasos = s.pasos;
  let n = s.n;
  if (s.hace && (s.hace.que === "herramienta" || s.hace.que === "pensando")) {
    const paso: Paso = { hace: s.hace, seg: Math.max(0, (ahora - s.inicio) / 1000) };
    if (textoPaso(paso)) {
      pasos = [paso, ...pasos].slice(0, MAX_PASOS);
      n++;
    }
  }
  return { hace: nuevo, inicio: ahora, pasos, n };
}

/** La primera línea con texto de un pensamiento, sin `#` de título ni `**` de negrita: lo que dice la línea plegada. */
export const primeraLineaPensada = (texto: string): string =>
  texto
    .split("\n")
    .map((l) => l.trim().replace(/^#+\s*/, "").replace(/^\*\*(.+?)\*\*:?$/, "$1"))
    .find(Boolean) ?? "";

/** La última frase de lo que lleva escrito un pensamiento que todavía llega, sin `#` ni `**`: lo que dice la línea plegada mientras corre. */
export const ultimaFrasePensada = (texto: string): string => {
  const linea = texto
    .split("\n")
    .map((l) => l.trim().replace(/^#+\s*/, "").replace(/\*\*/g, ""))
    .filter(Boolean)
    .at(-1);
  return linea?.split(/(?<=[.!?:;])\s+/).filter(Boolean).at(-1) ?? "";
};

// --- La tarjeta del líder trabajando (src/hilo/Actividad.tsx, propuesta Frase de maquetas/rediseno-0.4) ---------------------------------

/** Una clave de este módulo (viaja como texto) ya traducida. */
const tx = (clave: string, vars?: Record<string, string | number>) => (t as (k: Clave, v?: Record<string, string | number>) => string)(clave as Clave, vars);

/** Sin salida ni tokens durante este rato (ms), la tarjeta se tiñe y dice "Sin novedades hace 2 m". */
export const SIN_NOVEDADES_MS = 2 * 60_000;

/** ¿Hace `SIN_NOVEDADES_MS` que no llega nada? `novedad` 0: todavía no empezó. */
export const sinNovedades = (novedad: number, ahora: number): boolean => novedad > 0 && ahora - novedad >= SIN_NOVEDADES_MS;

/** Lo que devolvió un comando: su última línea y si dio error. */
export type Salida = { linea: string; error: boolean };

const TOPE_LINEA = 400;
const ANSI = new RegExp("\\u001b\\[[0-9;?]*[ -/]*[@-~]|\\u001b\\][^\\u0007]*\\u0007", "g");

/** La última línea con texto de una salida, sin colores de terminal; un `\\r` (una barra de progreso) cuenta como renglón. */
export function ultimaLinea(texto: string): string {
  const l =
    texto
      .replace(ANSI, "")
      .split(/\r\n|\n|\r/)
      .map((x) => x.trim())
      .filter(Boolean)
      .at(-1) ?? "";
  return l.length > TOPE_LINEA ? l.slice(0, TOPE_LINEA) : l;
}

/** Lo concreto: una frase fija (con su variable, si la lleva, y con mayúscula) o el comando / archivo / patrón tal cual. */
export const textoDetalle = (a: Actividad) => {
  if (!a.detalleClave) return a.detalle;
  const x = tx(a.detalleClave, { d: a.detalle });
  return x.charAt(0).toUpperCase() + x.slice(1);
};

/** Un paso ya pasado en palabras, o `null` si no vale la pena mostrarlo. */
export function lineaPaso(p: Paso): string | null {
  const x = textoPaso(p);
  return x ? tx(x.clave, { d: x.d, s: x.s ?? 0 }) : null;
}

const conMayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const nombreArchivo = (r: string) => r.split(/[\\/]/).filter(Boolean).at(-1) ?? r;

/** De qué va una herramienta en pocas palabras: el archivo sin su carpeta, el patrón o el sitio. `null`: no hay nada corto que decir. */
function sujetoDe(h: Extract<HaceLider, { que: "herramienta" }>): string | null {
  if (!h.detalle) return null;
  if (LEER.has(h.nombre) || EDITAR.has(h.nombre) || h.nombre === "Write") return nombreArchivo(h.detalle);
  if (h.nombre === "Grep" || h.nombre === "Glob" || h.nombre === "WebSearch") return `«${unaLinea(h.detalle)}»`;
  if (h.nombre === "WebFetch") return dominio(h.detalle);
  return null;
}

/** Lo recién hecho, corto, para la miga de al lado de la frase ("Leyó Actividad.tsx"); un comando con descripción, la descripción. `null`: pensar no va. */
export function pasoCorto(p: Paso): string | null {
  if (p.hace.que !== "herramienta") return null;
  if (p.hace.desc) return conMayuscula(p.hace.desc);
  const x = textoPaso(p);
  return x ? tx(x.clave, { d: sujetoDe(p.hace) ?? x.d, s: x.s ?? 0 }) : null;
}

/** Cuántos pasos de atrás entran en la miga. */
export const MIGA = 3;

/** Lo que dice la tarjeta en palabras. `verbo`: "Corriendo" o "Corrió", si hace falta decirlo; `linea`: la salida, el comando o la frase de abajo. */
export type Frase = { titulo: string; verbo: string | null; linea: string; mono: boolean; antes: string[] };

/**
 * El título y la línea de abajo. El título es lo que el modelo dijo que hace (la descripción del comando); sin descripción, "Corriendo Bash".
 * Abajo: la última línea que devolvió el comando con "Corrió" y, mientras corre (`claude` no manda la salida hasta terminar), el comando con
 * "Corriendo", salvo que el título ya lo diga. `fallo`: el turno terminó mal, y el título lo cuenta con lo último que hacía.
 */
export function fraseDe({ act, hace, pasos, salida = null, pensando = "", fallo = false }: { act: Actividad; hace: HaceLider | null; pasos: Paso[]; salida?: Salida | null; pensando?: string; fallo?: boolean }): Frase {
  const antes = fallo ? [] : pasos.slice(0, MIGA).map(pasoCorto).filter((x): x is string => x !== null).reverse();
  const conSalida = salida?.linea ? salida : null;
  // En un turno fallado el estado ya dice "Falló": abajo no se repite.
  const verboSalida = salida?.error && !fallo ? t("hz.t.error") : t("hz.corrio");
  if (act.tipo === "permiso") return { titulo: tx(act.verbo), verbo: null, linea: textoDetalle(act), mono: false, antes };
  if (hace?.que === "herramienta") {
    const comando = hace.nombre === "Bash" && act.tipo === "comando";
    const sujeto = sujetoDe(hace);
    const desc = hace.desc ? conMayuscula(hace.desc) : null;
    const base = desc ?? (comando ? t("hace.correr", { h: "Bash" }) : act.tipo === "comando" ? t("hace.usar", { h: hace.nombre }) : sujeto ? `${tx(act.verbo)} ${sujeto}` : tx(act.verbo));
    const titulo = fallo ? t("hz.f.noTermino", { d: base }) : base;
    const hizo = fallo ? lineaPaso({ hace, seg: 0 }) : null;
    if (comando && salida && conSalida) return { titulo, verbo: verboSalida, linea: conSalida.linea, mono: true, antes };
    if (hizo && !comando) return { titulo, verbo: null, linea: hizo, mono: false, antes };
    const crudo = act.detalle === hace.nombre || act.detalle === sujeto ? "" : act.detalle;
    if (crudo) return { titulo, verbo: comando && salida ? verboSalida : fallo && comando ? t("hz.corrio") : desc ? tx(act.verbo) : null, linea: crudo, mono: true, antes };
    return { titulo, verbo: null, linea: pasos.length ? (lineaPaso(pasos[0]) ?? "") : "", mono: false, antes };
  }
  const titulo = fallo ? t("hz.f.noTerminoSolo") : tx(act.verbo);
  const frase = pensando.trim() ? ultimaFrasePensada(pensando) : "";
  if (frase) return { titulo, verbo: null, linea: frase, mono: false, antes };
  if (conSalida) return { titulo, verbo: verboSalida, linea: conSalida.linea, mono: true, antes };
  const ultimo = pasos.length ? lineaPaso(pasos[0]) : null;
  if (ultimo) return { titulo, verbo: null, linea: ultimo, mono: false, antes };
  return { titulo, verbo: null, linea: fallo ? "" : textoDetalle(act), mono: false, antes };
}
