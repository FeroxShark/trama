// La vista de worker, lo que no es pintar: la frase de un paso, qué filas salen de los pasos (pensamientos, grupos), la tira en
// tiempo real, lo que es un cambio, el resumen que sale del último mensaje, el chip de tests, las rutas de una salida y el diff de
// una edición. Puro: lo prueba `tests/worker-datos.test.ts`.
import { t } from "../i18n/index.ts";
import type { Cambio, Encabezado, Paso, TipoPaso } from "../datos/pasos";

const base = (ruta: string) => ruta.split(/[\\/]/).filter(Boolean).pop() ?? ruta;
export const nombreDeArchivo = base;

/** Un texto entero que pasa de esto se pliega con "Ver todo" (nunca se corta con «…»): la vista de worker y la tarjeta de actividad. */
export const PLIEGUE = 200;
export const muyLargo = (s: string): boolean => s.length > PLIEGUE;

const mayus = (s: string) => (s ? s[0].toLocaleUpperCase() + s.slice(1) : s);

/** ¿Este paso sigue en curso? Un paso sin resultado en un worker que ya no corre no terminó: no se lo dice en gerundio. */
const enCurso = (p: Paso, vive: boolean) => p.estado === "corriendo" && vive;

/** El verbo en pasado o en gerundio de una frase con forma `wk.f.<clave>.v` / `.e`. */
const f = (p: Paso, vive: boolean, clave: string, vars?: Record<string, string>) => (t as (c: string, v?: Record<string, string>) => string)(`wk.f.${clave}.${enCurso(p, vive) ? "e" : "v"}`, vars);

/**
 * La frase de un paso: lo que hizo, en palabras. De un comando, su descripción tal cual; sin descripción, una frase genérica de su
 * tipo (nunca el comando cortado: el crudo va sólo en el panel). `vive`: si el worker sigue corriendo.
 */
export function frasePaso(p: Paso, vive = true): string {
  const d = p.detalle;
  switch (d.clase) {
    case "correr": {
      const desc = d.descripcion?.trim().split("\n")[0];
      if (desc) return mayus(desc);
      if (esCommit(d.comando.t)) return f(p, vive, "commit");
      if (CORREDORES.test(d.comando.t)) return f(p, vive, "tests");
      return f(p, vive, "comando");
    }
    case "leer":
      return f(p, vive, "leer", { q: base(d.ruta) || t("wk.unArchivo") });
    case "editar":
      return f(p, vive, "editar", { q: base(d.ruta) || t("wk.unArchivo") });
    case "escribir":
      return f(p, vive, "escribir", { q: base(d.ruta) || t("wk.unArchivo") });
    case "buscar": {
      const q = d.patron.trim();
      if (!q) return f(p, vive, "codigo");
      if (d.herramienta === "Glob") return f(p, vive, "glob", { q });
      if (d.herramienta === "WebSearch") return f(p, vive, "web", { q });
      if (d.herramienta === "WebFetch") return f(p, vive, "url", { q });
      return f(p, vive, "buscar", { q });
    }
    case "delegar": {
      const q = d.descripcion?.trim() || d.agente;
      return q ? f(p, vive, "delegar", { q }) : f(p, vive, "delegarSolo");
    }
    case "pensar": {
      const texto = d.texto?.t.trim();
      if (texto) return t("wk.f.pensarTexto", { q: texto });
      return p.dur !== null && p.dur >= 1000 ? t("wk.f.pensarDur", { d: durCorta(p.dur) }) : t("wk.v.pensar");
    }
    case "texto":
      return f(p, vive, "texto");
    default:
      return f(p, vive, "otro", { q: p.titulo });
  }
}

/** Un paso que se junta con los de al lado: leer y buscar que salieron bien. */
export const esChico = (p: Paso) => (p.tipo === "leer" || p.tipo === "buscar") && p.estado === "ok";

/** Por arriba de esto (ms), un pensamiento sin texto también lleva su fila. */
export const PENSAR_LARGO_MS = 30_000;

/** Un pensamiento lleva fila propia si trae texto o si pasó de 30 s; los demás son un nudito en el hilo. */
export function pensarConFila(p: Paso): boolean {
  if (p.detalle.clase !== "pensar") return false;
  return !!p.detalle.texto?.t.trim() || (p.dur ?? 0) > PENSAR_LARGO_MS;
}

/** Los pensamientos sin fila que hubo antes de una fila: cuánto duraron y cuáles fueron (la tira los puede elegir). */
export type Nudo = { ms: number; ns: number[] };

export type ClaseGrupo = "buscar" | "leer" | "mezcla" | "repetido";

export type Fila = { grupo: false; p: Paso; nudo: Nudo | null } | { grupo: true; ps: Paso[]; clase: ClaseGrupo; nudo: Nudo | null; nudos: Record<number, Nudo> };

/** Dos pasos que son el mismo: el mismo comando (bien las dos veces) o la misma herramienta sin más detalle. */
function mismoPaso(a: Paso, b: Paso): boolean {
  if (a.estado !== "ok" || b.estado !== "ok") return false;
  if (a.detalle.clase === "correr" && b.detalle.clase === "correr") return !falla(a) && !falla(b) && !esCommit(a.detalle.comando.t) && a.detalle.comando.t.trim() === b.detalle.comando.t.trim();
  if (a.detalle.clase === "otro" && b.detalle.clase === "otro") return a.titulo === b.titulo;
  return false;
}

/**
 * Las filas de la lista. Un pensamiento sin texto y corto no lleva fila: se vuelve el nudo de la fila que sigue, y no corta un grupo.
 * Las búsquedas y lecturas seguidas se juntan: por tipo si hay dos o más seguidas; si se alternan de a una, en un grupo mezclado. Los
 * comandos idénticos seguidos, también. Lo que falló nunca entra en un grupo.
 */
export function filas(pasos: readonly Paso[]): Fila[] {
  // Primero, los pasos con fila y el nudo de cada uno.
  const con: { p: Paso; nudo: Nudo | null }[] = [];
  let nudo = null as Nudo | null;
  for (const p of pasos) {
    if (p.detalle.clase === "pensar" && !pensarConFila(p)) {
      nudo = { ms: (nudo?.ms ?? 0) + (p.dur ?? 0), ns: [...(nudo?.ns ?? []), p.n] };
      continue;
    }
    con.push({ p, nudo });
    nudo = null;
  }
  const out: Fila[] = [];
  const suelta = (x: (typeof con)[number]) => out.push({ grupo: false, p: x.p, nudo: x.nudo });
  const grupo = (xs: typeof con, clase: ClaseGrupo) => {
    const nudos: Record<number, Nudo> = {};
    xs.slice(1).forEach((x) => {
      if (x.nudo) nudos[x.p.n] = x.nudo;
    });
    out.push({ grupo: true, ps: xs.map((x) => x.p), clase, nudo: xs[0].nudo, nudos });
  };
  for (let i = 0; i < con.length; ) {
    let j = i + 1;
    if (esChico(con[i].p)) {
      while (j < con.length && esChico(con[j].p)) j++;
      const tramo = con.slice(i, j);
      const partes: (typeof con)[] = [];
      for (const x of tramo) {
        const ult = partes[partes.length - 1];
        if (ult && ult[0].p.tipo === x.p.tipo) ult.push(x);
        else partes.push([x]);
      }
      // Los de un mismo tipo, de dos para arriba, van juntos; los que quedan de a uno y seguidos se mezclan; uno solo queda suelto.
      let sueltos: typeof con = [];
      const vaciar = () => {
        if (sueltos.length === 1) suelta(sueltos[0]);
        else if (sueltos.length > 1) grupo(sueltos, "mezcla");
        sueltos = [];
      };
      for (const q of partes) {
        if (q.length === 1) sueltos.push(q[0]);
        else {
          vaciar();
          grupo(q, q[0].p.tipo as "buscar" | "leer");
        }
      }
      vaciar();
    } else {
      while (j < con.length && mismoPaso(con[i].p, con[j].p)) j++;
      if (j - i >= 2) grupo(con.slice(i, j), "repetido");
      else suelta(con[i]);
    }
    i = j;
  }
  return out;
}

/** Cuántos archivos leyó y cuántas veces buscó un grupo: lo que dice su rótulo. */
export function cuenta(ps: readonly Paso[]): { leer: number; buscar: number } {
  return { leer: ps.filter((p) => p.tipo === "leer").length, buscar: ps.filter((p) => p.tipo === "buscar").length };
}

/** El rótulo de un grupo, en palabras. */
export function fraseGrupo(ps: readonly Paso[], clase: ClaseGrupo, vive = true): string {
  const c = cuenta(ps);
  const a = c.leer === 1 ? t("wk.arch1") : t("wk.archN", { n: c.leer });
  const v = c.buscar === 1 ? t("wk.vez1") : t("wk.vezN", { n: c.buscar });
  if (clase === "repetido") return t("wk.gVeces", { q: frasePaso(ps[0], vive), n: ps.length });
  if (clase === "buscar") return t("wk.gBuscoCodigo", { v });
  if (clase === "leer") return t("wk.gLeyo", { a });
  return t("wk.gBuscoLeyo", { v, a });
}

/** Lo que tardó un grupo: la suma de lo que tardó cada paso (sin lo que pensó entre medio). */
export const durGrupo = (ps: readonly Paso[]): number => ps.reduce((a, p) => a + (p.dur ?? 0), 0);

// ---- Lo que es un cambio ------------------------------------------------------------------------------------------

/** `git commit` como comando (no un `echo "git commit"`), con o sin `git -C ruta`, solo o después de otro comando. */
const COMMIT = /(?:^|&&|\|\||;|\n)\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*git\s+(?:-\S+(?:\s+\S+)?\s+)*commit\b/;
export const esCommit = (comando: string): boolean => COMMIT.test(comando);

/** ¿Falló? Un comando que salió con algo distinto de 0 también. */
export function falla(p: Paso): boolean {
  if (p.estado === "fallo") return true;
  return p.detalle.clase === "correr" && p.estado !== "corriendo" && p.detalle.codigo !== null && p.detalle.codigo !== 0;
}

/** El commit de un paso: `{ hash }` (el que imprimió git, si lo imprimió) o `null` si no es un commit o no se hizo. */
export function commitDe(p: Paso): { hash: string | null } | null {
  const d = p.detalle;
  if (d.clase !== "correr" || !esCommit(d.comando.t) || falla(p)) return null;
  return { hash: /^\[[^\]\n]*\s([0-9a-f]{7,40})\]/m.exec(d.salida?.t ?? "")?.[1] ?? null };
}

/** Lo que cambió algo o salió mal: lo que se resalta en la lista y lo único que queda con «Sólo cambios». */
export const esCambio = (p: Paso): boolean => p.tipo === "editar" || p.tipo === "escribir" || falla(p) || commitDe(p) !== null;

/** Las filas con «Sólo cambios»: cada cambio suelto, sin grupos ni nudos. */
export const filasCambios = (pasos: readonly Paso[]): Fila[] => pasos.filter(esCambio).map((p) => ({ grupo: false, p, nudo: null }));

/** Los pasos que van en la lista y la tira: el último mensaje del turno es el resultado, que se ve arriba. */
export const visibles = (pasos: readonly Paso[]): Paso[] => pasos.filter((p) => !(p.detalle.clase === "texto" && p.detalle.final));

/** "38 s", "4 m 11 s", "1 h 05 m". */
export function durCorta(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} m ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} m`;
}

/** Un reloj: "0:38", "13:12", "1:05:00". */
export function relojDe(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

// ---- La tira: cada paso donde pasó, con su tiempo real ------------------------------------------------------------

/** Un paso en la tira: desde cuándo (ms desde el arranque) y cuánto duró. `abierto`: sigue corriendo; su ancho llega hasta el ahora. */
export type Tramo = { p: Paso; t0: number; seg: number; abierto: boolean };

/**
 * Dónde empieza un paso. La hora de un pensamiento es la de cuando terminó (su `dur` es lo que tardó hasta ahí);
 * la de una herramienta, la de cuando se lanzó. `null` si el transcript no trae hora.
 */
function arranca(p: Paso): number | null {
  if (p.t === null) return null;
  return p.tipo === "pensar" ? p.t - (p.dur ?? 0) : p.t;
}

/** El cero de la tira: el arranque del worker o, si hay pasos anteriores que no se muestran, el primero que se ve. */
export function baseTira(pasos: readonly Paso[], inicio: number | null, omitidos: number): number | null {
  const primero = pasos.map(arranca).find((x) => x !== null) ?? null;
  if (inicio !== null && !omitidos && (primero === null || inicio <= primero)) return inicio;
  return primero ?? inicio;
}

/**
 * Los tramos de la tira, en tiempo real: lo que no fue ningún paso (el modelo escribiendo) queda como un hueco, sin inventar a quién darle
 * ese tiempo. Un paso sin duración llega hasta el que sigue o hasta `fin`; uno sin hora, se apoya en el anterior. `fin`: `null` si sigue corriendo.
 */
export function tramos(pasos: readonly Paso[], cero: number, fin: number | null): Tramo[] {
  const out: Tramo[] = [];
  let previo = 0;
  for (let i = 0; i < pasos.length; i++) {
    const p = pasos[i];
    const a = arranca(p);
    const t0 = a === null ? previo : Math.max(0, a - cero);
    let seg: number;
    let abierto = false;
    if (p.dur !== null) seg = p.dur;
    else {
      const sig = pasos.slice(i + 1).map(arranca).find((x) => x !== null);
      if (sig !== undefined && sig !== null) seg = Math.max(0, sig - cero - t0);
      else if (fin !== null) seg = Math.max(0, fin - cero - t0);
      else {
        seg = 0;
        abierto = p.estado === "corriendo";
      }
    }
    out.push({ p, t0, seg, abierto });
    previo = Math.max(previo, t0 + seg);
  }
  return out;
}

const PASOS_REGLA_S = [30, 60, 120, 180, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400];

/** Cada cuánto va una marca en la regla (ms): lo justo para que queden de 2 a 5 marcas. */
export function pasoDeRegla(total: number): number {
  for (const s of PASOS_REGLA_S) if (total / (s * 1000) <= 5) return s * 1000;
  return PASOS_REGLA_S[PASOS_REGLA_S.length - 1] * 1000;
}

/** Las marcas intermedias de la regla (el 0 y el total van aparte): no se pegan al total. */
export function marcasRegla(total: number, paso = pasoDeRegla(total)): number[] {
  const out: number[] = [];
  for (let m = paso; m < total * 0.9; m += paso) out.push(m);
  return out;
}

/** "1 m", "2 h", "1 h 30 m", "30 s": una marca de la regla. */
export function marcaCorta(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} m`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} m` : `${m / 60} h`;
}

/** La leyenda de la tira: sólo los tipos que hay, en este orden; leer y buscar son un color, editar y escribir otro. */
export function leyendaDe(pasos: readonly Paso[]): ("leer" | "editar" | "correr" | "pensar" | "delegar" | "texto" | "otro")[] {
  const hay = new Set(pasos.map((p) => (p.tipo === "buscar" ? "leer" : p.tipo === "escribir" ? "editar" : p.tipo)));
  return (["leer", "editar", "correr", "pensar", "delegar", "texto", "otro"] as const).filter((x) => hay.has(x));
}

// ---- El resultado -------------------------------------------------------------------------------------------------

const CABEZAS = /^(RESULTADO|ARCHIVOS|DECISION|DECISIÓN|SIGUE|PROBAR|PREGUNTA|CONTEXTO|OPCION|OPCIÓN|DEFECTO)\s*:/;
const SUPUESTO = /\bsupuest[oa]s?\b|\bsupuse\b|\bsupuso\b|\bsupongo\b|\bassum(?:ed|ption|ptions|ing)\b/i;

export type Resumen = { resultado: string | null; supuestos: string[] };

/** La sección RESULTADO: del último mensaje del worker; si no trae encabezados, su primer párrafo. */
export function seccionResultado(texto: string): string {
  const ls = texto.split("\n");
  const i = ls.findIndex((l) => /^RESULTADO\s*:/.test(l.trim()));
  if (i < 0) return texto.trim().split(/\n\s*\n/)[0].trim();
  const out = [ls[i].trim().replace(/^RESULTADO\s*:\s*/, "")];
  for (const l of ls.slice(i + 1)) {
    if (CABEZAS.test(l.trim())) break;
    out.push(l.trim());
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

/** Las frases de un texto (cortan en . ! ? seguido de espacio). */
const frases = (s: string) => s.split(/(?<=[.!?])\s+/).map((f) => f.trim()).filter(Boolean);

/** Lo que dice el resultado en una o dos frases, entero (lo largo se pliega en la vista), y aparte los supuestos que declaró (frases con "supuestos", partidas por `;`). */
export function resumenDe(texto: string | null): Resumen {
  if (!texto) return { resultado: null, supuestos: [] };
  const sec = seccionResultado(texto);
  if (!sec) return { resultado: null, supuestos: [] };
  const fs = frases(sec);
  const supuestos: string[] = [];
  const resto: string[] = [];
  for (const f of fs) {
    if (!SUPUESTO.test(f)) {
      resto.push(f);
      continue;
    }
    const sin = f.replace(/^.*?\b(?:supuestos?|supuse|supuso|supongo|assum\w*)\b\s*[:,-]?\s*/i, "").replace(/[.!?]+$/, "");
    for (const s of (sin || f).split(/\s*;\s*/)) if (s.trim()) supuestos.push(mayus(s.trim()));
  }
  const r = resto.slice(0, 2).join(" ");
  return { resultado: r ? mayus(r) : null, supuestos };
}

/** El texto del último mensaje del turno (el resultado), si el worker ya lo escribió. */
export function textoFinal(pasos: readonly Paso[]): string | null {
  for (let i = pasos.length - 1; i >= 0; i--) {
    const d = pasos[i].detalle;
    if (d.clase === "texto" && d.final) return d.texto.t;
  }
  return null;
}

// ---- El chip de tests ---------------------------------------------------------------------------------------------

const CORREDORES = /(?:^|[\s;&|(])(?:npm\s+(?:run\s+)?test|pnpm\s+(?:run\s+)?test|yarn\s+test|node\s+(?:\S+\s+)*--test|pytest|py\.test|cargo\s+test|vitest|jest|go\s+test|bun\s+test|deno\s+test)\b/;

export type Tests = { ok: boolean; n: number | null; paso: Paso };

/** Cuántos tests pasaron según lo que imprimió el corredor (`# pass 9`, `22 pass`, `Tests: 5 passed`); el último que aparezca. */
export function cuantosTests(salida: string): number | null {
  let n: number | null = null;
  for (const re of [/^#\s*pass\s+(\d+)/gim, /\b(\d+)\s+(?:pass(?:ed|ing)?)\b/gi, /\bTests?:\s+(?:\d+\s+failed,\s+)?(\d+)\s+passed/gi]) {
    for (const m of salida.matchAll(re)) n = Number(m[1]);
    if (n !== null) return n;
  }
  return null;
}

/** El último paso que corrió un corredor de tests y ya terminó. */
export function testsDe(pasos: readonly Paso[]): Tests | null {
  for (let i = pasos.length - 1; i >= 0; i--) {
    const p = pasos[i];
    const d = p.detalle;
    if (d.clase !== "correr" || p.estado === "corriendo" || !CORREDORES.test(d.comando.t)) continue;
    const ok = p.estado === "ok" && (d.codigo === null || d.codigo === 0);
    return { ok, n: ok ? cuantosTests(d.salida?.t ?? "") : null, paso: p };
  }
  return null;
}

// ---- Las salidas: rutas clicables y el tono de cada línea ---------------------------------------------------------

const RE_WIN = /^[A-Za-z]:[\\/]/;

/** La ruta de una salida, absoluta si se puede: lo relativo, desde la carpeta donde corría el worker. `null` si no se la puede ubicar. */
export function rutaEnCwd(ruta: string, cwd: string | null): string | null {
  if (ruta.startsWith("/") || RE_WIN.test(ruta) || ruta.startsWith("\\\\")) return ruta;
  if (!cwd) return null;
  const sep = cwd.includes("\\") && !cwd.includes("/") ? "\\" : "/";
  const limpia = ruta.replace(/^\.[\\/]/, "");
  return `${cwd.replace(/[\\/]+$/, "")}${sep}${sep === "\\" ? limpia.replace(/\//g, "\\") : limpia}`;
}

/** Una ruta para leer: sin la carpeta del worker si está adentro (`src/a.ts`, no `/home/…/proy/src/a.ts`). */
export function rutaRelativa(ruta: string, cwd: string | null): string {
  if (!cwd) return ruta;
  const raiz = cwd.replace(/[\\/]+$/, "");
  if (ruta.length > raiz.length + 1 && ruta.startsWith(raiz) && /[\\/]/.test(ruta[raiz.length])) return ruta.slice(raiz.length + 1);
  return ruta;
}

export type LineaGrep = { n: number | null; texto: string };
export type GrupoGrep = { ruta: string; cuenta: number | null; lineas: LineaGrep[] };

/** La ruta de Windows o Unix de adelante de una línea de grep y lo que sigue: `ruta:12:contenido`, `ruta:contenido`, `ruta:3` o `ruta`. */
const LINEA_GREP = /^((?:[A-Za-z]:[\\/])?[^:\n]*?[^:\s])(?::(\d+))?(?::(.*))?$/;
const PARECE_RUTA = /[\\/]|\.[A-Za-z0-9]{1,8}$/;

/**
 * Los resultados de un grep, por archivo. Entiende `ruta:12:contenido`, `ruta:contenido`, `ruta:3` (la cuenta) y `ruta` sola, con rutas de
 * Linux y de Windows. Devuelve `null` si más de la mitad de las líneas no son de grep: entonces esa salida se muestra como texto.
 */
export function partirGrep(texto: string): GrupoGrep[] | null {
  const ls = texto.split("\n").filter((l) => l.trim() && l !== "--" && !/^Found \d+ (?:files?|lines?)/.test(l) && !/^No (?:files|matches) found/.test(l) && !/^\[Showing results with pagination/.test(l));
  if (!ls.length) return null;
  const grupos: GrupoGrep[] = [];
  let malas = 0;
  for (const l of ls) {
    const m = LINEA_GREP.exec(l);
    const ruta = m?.[1];
    if (!m || !ruta || !PARECE_RUTA.test(ruta) || /\s{2,}/.test(ruta) || /^\s/.test(ruta)) {
      malas++;
      continue;
    }
    let g = grupos[grupos.length - 1];
    if (!g || g.ruta !== ruta) {
      g = { ruta, cuenta: null, lineas: [] };
      grupos.push(g);
    }
    if (m[2] !== undefined && m[3] !== undefined) g.lineas.push({ n: Number(m[2]), texto: m[3] });
    else if (m[2] !== undefined) g.cuenta = Number(m[2]);
    else if (m[3] !== undefined) g.lineas.push({ n: null, texto: m[3] });
  }
  return malas * 2 > ls.length || !grupos.length ? null : grupos;
}

/** ¿Este comando es un grep cuya salida se puede partir? Sin tuberías: después de un `|` ya no se sabe qué salió. */
export function comandoEsGrep(comando: string): boolean {
  const c = comando.trim().replace(/^(?:cd\s+\S+\s*(?:&&|;)\s*)+/, "");
  return /^(?:grep|rg|ag|ack)\s/.test(c) && !/[|;&\n]/.test(c.replace(/"[^"]*"|'[^']*'/g, ""));
}

export type Trozo = { t: string } | { t: string; ruta: string; linea: number | null };

const EN_LINEA = /(?:[A-Za-z]:[\\/]|\.{0,2}\/|[\w@.-]+[\\/])[\w@.\\/-]*\.[A-Za-z0-9]{1,8}(?::(\d+)(?::\d+)?)?/g;

/** Una línea de salida partida en texto y rutas con línea (`src/a.ts:52:11`): sólo se vuelve enlace lo que trae su número de línea. */
export function trozosConRutas(linea: string): Trozo[] {
  const out: Trozo[] = [];
  let i = 0;
  for (const m of linea.matchAll(EN_LINEA)) {
    if (m[1] === undefined) continue;
    const ini = m.index;
    if (ini > 0 && /[\w@.:/\\-]/.test(linea[ini - 1])) continue;
    if (ini > i) out.push({ t: linea.slice(i, ini) });
    out.push({ t: m[0], ruta: m[0].replace(/(?::\d+){1,2}$/, ""), linea: Number(m[1]) });
    i = ini + m[0].length;
  }
  if (i < linea.length || !out.length) out.push({ t: linea.slice(i) });
  return out;
}

export type Tono = "ok" | "mal" | "grupo" | "tenue" | "espera" | null;

/** Cómo se pinta una línea de salida de tests o de un comando. Cada tono lo dice también su propio signo (✔ ✖ ▶): el color acompaña. */
export function tonoDeLinea(linea: string): Tono {
  const l = linea.trimStart();
  if (/^(?:✖|✗|not ok\b|AssertionError\b|exit [1-9]|\w*Error\b:?|FAIL\b)/.test(l)) return "mal";
  if (/^(?:✔|✓|ok \d|PASS\b)/.test(l)) return "ok";
  if (/^(?:▶|# Subtest)/.test(l)) return "grupo";
  if (/^⏵/.test(l)) return "espera";
  if (/^(?:> |ℹ|#)/.test(l)) return "tenue";
  return null;
}

// ---- Archivos y chips ---------------------------------------------------------------------------------------------

export type Chip = { ruta: string; nombre: string; mas: number; menos: number };

export const chipsDe = (e: Encabezado): Chip[] => e.archivos.map((a) => ({ ruta: a.ruta, nombre: base(a.ruta), mas: a.mas, menos: a.menos }));

// ---- El diff ------------------------------------------------------------------------------------------------------

export type FilaDiff = { t: "+" | "-" | " " | "~"; a: number | null; b: number | null; x: string };

/** Por arriba de esto (celdas de la tabla) no se calcula el mínimo: todo lo viejo sale y todo lo nuevo entra. */
const TOPE_CELDAS = 4_000_000;

const lineas = (s: string) => {
  if (s === "") return [];
  const ls = s.split("\n");
  if (ls[ls.length - 1] === "") ls.pop();
  return ls;
};

/**
 * El diff unificado de un cambio: lo común (adelante y atrás) como contexto y, en medio, el mínimo de líneas que sacar y poner
 * (subsecuencia común más larga). `desde` es la línea donde empieza lo cambiado: sin él las filas van sin número.
 */
export function diffDe(c: Cambio): FilaDiff[] {
  const v = lineas(c.viejo.t);
  const n = lineas(c.nuevo.t);
  let i0 = 0;
  while (i0 < v.length && i0 < n.length && v[i0] === n[i0]) i0++;
  let fv = v.length;
  let fn = n.length;
  while (fv > i0 && fn > i0 && v[fv - 1] === n[fn - 1]) {
    fv--;
    fn--;
  }
  const num = (k: number) => (c.desde === null ? null : c.desde + k);
  const out: FilaDiff[] = [];
  for (let k = 0; k < i0; k++) out.push({ t: " ", a: num(k), b: num(k), x: v[k] });

  const mv = v.slice(i0, fv);
  const mn = n.slice(i0, fn);
  let a = i0;
  let b = i0;
  const saca = (x: string) => out.push({ t: "-", a: num(a++), b: null, x });
  const pone = (x: string) => out.push({ t: "+", a: null, b: num(b++), x });
  if (!mv.length || !mn.length || (mv.length + 1) * (mn.length + 1) > TOPE_CELDAS) {
    mv.forEach(saca);
    mn.forEach(pone);
  } else {
    const w = mn.length + 1;
    const L = new Uint32Array((mv.length + 1) * w);
    for (let i = mv.length - 1; i >= 0; i--)
      for (let j = mn.length - 1; j >= 0; j--) L[i * w + j] = mv[i] === mn[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    let i = 0;
    let j = 0;
    while (i < mv.length || j < mn.length) {
      if (i < mv.length && j < mn.length && mv[i] === mn[j]) {
        out.push({ t: " ", a: num(a++), b: num(b++), x: mv[i] });
        i++;
        j++;
      } else if (j >= mn.length || (i < mv.length && L[(i + 1) * w + j] >= L[i * w + j + 1])) saca(mv[i++]);
      else pone(mn[j++]);
    }
  }
  for (let k = fv; k < v.length; k++) out.push({ t: " ", a: num(a++), b: num(b++), x: v[k] });
  return out;
}

/** Un archivo nuevo o escrito entero: todo son líneas que entran. */
export const filasEscritas = (contenido: string): FilaDiff[] => lineas(contenido).map((x, i) => ({ t: "+" as const, a: null, b: i + 1, x }));

/** Lo leído, con su numeración desde `desde` (si todas las líneas traen el `cat -n` de Claude Code, se le quita). */
export function filasLeidas(texto: string, desde: number | null): FilaDiff[] {
  let ls = lineas(texto);
  const cat = ls.length > 0 && ls.every((l) => /^\s*\d+\s*[→\t]/.test(l) || l === "");
  if (cat) ls = ls.map((l) => l.replace(/^\s*\d+\s*[→\t]/, ""));
  return ls.map((x, i) => ({ t: " " as const, a: null, b: desde === null ? null : desde + i, x }));
}

/** La extensión de un archivo, para el resaltado ("src/a.ts" → "ts"). */
export const extension = (ruta: string): string => /\.([A-Za-z0-9]+)$/.exec(base(ruta))?.[1]?.toLowerCase() ?? "";

export const TIPOS: readonly TipoPaso[] = ["pensar", "leer", "buscar", "editar", "escribir", "correr", "delegar", "texto", "otro"];
