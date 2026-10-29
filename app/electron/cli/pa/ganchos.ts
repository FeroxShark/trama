// Lo que `al_salir` de motor/bin/pa hace después de la corrida y que `lanzarClaude` recibe como `Ganchos` (etapa 11): la fila de
// medicion.tsv (`medir`), el estado de la tarea madre (`anotar_estado`) y lo que la corrida dejó abierto para el dueño en el tablero
// (`anotar_tablero`: preguntas, DECISION, PROBAR y SIGUE). Cada uno es un `|| true` en el bash: nunca tira.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { git } from "../base/git.ts";
import { tomar } from "../base/lock.ts";
import type { Pa } from "./entorno.ts";
import type { Ganchos, Lanzamiento } from "./lanzar.ts";
import type { Llamada } from "./politica.ts";
import { isoSegundos, tableroMudo } from "./ramas.ts";
import { contarCompactaciones, decisionDe, decisionEsNada, frenoDe, leerSalida, sigueDe, textoResultado, transcriptDe } from "./resultado-lanzar.ts";

export const MEDICION_HEADER_VIEJO = "fecha\tid\tproyecto\tmodelo\teffort\tleer\tseguir\tis_error\tnum_turns\tduration_s\ttokens\tcosto_usd\tbien";
export const MEDICION_HEADER = `${MEDICION_HEADER_VIEJO}\tplan\tcompactaciones\tautocompact\torigen\tcache_read\tcache_creation\tephemeral_1h\tephemeral_5m\ttipo\tintegrada\tretrabajo\tcuenta\tfase\ttarea\trubrica\trub_fila\trub_modelo\trub_effort\tfreno\tespera_s`;
export const ESTADO_HEADER = "subtarea\tintento\tid\tmodelo\teffort\texit\tgate\tusd";

type Obj = Record<string, unknown>;
const esObj = (x: unknown): x is Obj => !!x && typeof x === "object" && !Array.isArray(x);
const num = (x: unknown): number | null => (typeof x === "number" ? x : null);

/** `suma(f)` de jq: "" si ninguno trae el dato, si no la suma (los que no lo traen cuentan 0). */
function suma(js: Obj[], f: (j: Obj) => number | null): string {
  const v = js.map(f);
  if (v.every((x) => x === null)) return "";
  return String(v.reduce<number>((a, x) => a + (x ?? 0), 0));
}
/** Suma de un campo sobre los valores de `.modelUsage` (null si la corrida no trae modelUsage). */
const usoModelos = (j: Obj, g: (m: Obj) => number): number | null => {
  const mu = j.modelUsage;
  if (!esObj(mu)) return null;
  return Object.values(mu).reduce<number>((a, m) => a + (esObj(m) ? g(m) : 0), 0);
};
const n0 = (x: unknown) => num(x) ?? 0;
const cc = (j: Obj, k: string): number | null => {
  const u = j.usage;
  const c = esObj(u) ? u.cache_creation : undefined;
  return esObj(c) ? num(c[k]) : null;
};

function leerJson(f: string): Obj | null {
  try {
    if (!statSync(f).size) return null;
    const j = JSON.parse(readFileSync(f, "utf8")) as unknown;
    return esObj(j) ? j : null;
  } catch {
    return null;
  }
}

/** `medicion_header_al_dia`: un header que es prefijo del de hoy se actualiza solo (sobre el mismo archivo). */
function headerAlDia(f: string): void {
  let t: string;
  try {
    t = readFileSync(f, "utf8");
  } catch {
    return;
  }
  if (!t) return;
  const h1 = t.split("\n")[0]!;
  if (h1 === MEDICION_HEADER || !MEDICION_HEADER.startsWith(`${h1}\t`)) return;
  writeFileSync(f, `${MEDICION_HEADER}\n${t.slice(t.indexOf("\n") + 1)}`);
}

/** Lo que el bash saca de variables globales y la rúbrica. */
export interface DatosFila {
  rub?: { fila: string; modelo: string; effort: string };
}

/** `medir`: la fila de medicion.tsv. Devuelve el costo (lo toma `anotar_estado`). */
export async function medir(pa: Pa, l: Lanzamiento, d: DatosFila = {}): Promise<string> {
  const c = l.c;
  const js = [l.jsonPrevio, l.out].map(leerJson).filter((j): j is Obj => j !== null);
  let nums = "\t\t\t\t";
  let cache = "\t\t\t";
  if (js.length) {
    const ultimo = js[js.length - 1]!;
    const ie = ultimo.is_error;
    const dur = js.every((j) => j.duration_ms === undefined || j.duration_ms === null) ? "" : String(Math.floor(js.reduce((a, j) => a + n0(j.duration_ms), 0) / 1000));
    nums = [
      ie === undefined || ie === null ? "" : String(ie),
      suma(js, (j) => num(j.num_turns)),
      dur,
      suma(js, (j) => usoModelos(j, (m) => n0(m.inputTokens) + n0(m.cacheReadInputTokens) + n0(m.outputTokens))),
      suma(js, (j) => num(j.total_cost_usd)),
    ].join("\t");
    cache = [
      suma(js, (j) => usoModelos(j, (m) => n0(m.cacheReadInputTokens))),
      suma(js, (j) => usoModelos(j, (m) => n0(m.cacheCreationInputTokens))),
      suma(js, (j) => cc(j, "ephemeral_1h_input_tokens")),
      suma(js, (j) => cc(j, "ephemeral_5m_input_tokens")),
    ].join("\t");
  }
  const usd = nums.slice(nums.lastIndexOf("\t") + 1);
  // El FRENÓ del último resultado (`freno_de_corrida` del bash): vacío si dice "nada" o no hay.
  const fr = js.length ? frenoDe(textoResultado(js[js.length - 1]!)) : "";
  const freno = decisionEsNada(fr) ? "" : fr;
  const comp = js.length ? contarCompactaciones(transcriptDe(js[js.length - 1]!, path.join(pa.env.PA_PROJ || path.join(pa.home, ".claude", "projects")))) : "";
  const linea = [
    isoSegundos(),
    c.ts,
    c.slug,
    c.modelo,
    c.esfuerzo || c.efVacio || "settings",
    c.leer ? "1" : "0",
    c.resume ? "1" : "0",
  ].join("\t") +
    `\t${nums}\t\t${pa.plan}\t${comp}\t${c.autocompact || "nativo"}\t${c.lanzo || "jefe"}\t${cache}\t${c.tipo ?? ""}\t\t\t${c.cuenta}\t${c.fase ?? ""}\t${c.tareaId ?? ""}\t${c.rubrica ?? ""}\t${d.rub?.fila ?? ""}\t${d.rub?.modelo ?? ""}\t${d.rub?.effort ?? ""}\t${freno}\t${c.espera ?? 0}`;
  const f = path.join(pa.state, "medicion.tsv");
  mkdirSync(pa.state, { recursive: true });
  const lock = await tomar(f, { plat: pa.plat, env: pa.env, esperarMs: 30_000 });
  try {
    if (!existsSync(f) || !statSync(f).size) writeFileSync(f, `${MEDICION_HEADER}\n`);
    else headerAlDia(f);
    appendFileSync(f, `${linea}\n`);
  } finally {
    await lock?.liberar();
  }
  return usd;
}

/** `anotar_estado`: una fila en `<proyecto>/tareas/<tarea>/estado.tsv` (sólo con --tarea). */
export async function anotarEstado(pa: Pa, l: Lanzamiento, rc: number, usd: string): Promise<void> {
  const c = l.c;
  const dir = path.join(l.dir, "tareas", c.tareaId ?? "");
  const est = path.join(dir, "estado.tsv");
  mkdirSync(dir, { recursive: true });
  const sub = c.subtarea || "-";
  const lock = await tomar(est, { plat: pa.plat, env: pa.env, esperarMs: 30_000 });
  try {
    let previas = 0;
    let vacio = true;
    try {
      const t = readFileSync(est, "utf8");
      vacio = t.length === 0;
      previas = t.split("\n").slice(1).filter((x) => x && x.split("\t")[0] === sub).length;
    } catch {
      /* no existe */
    }
    if (vacio) appendFileSync(est, `${ESTADO_HEADER}\n`);
    appendFileSync(est, `${sub}\t${previas + 1}\t${c.ts}\t${c.modelo || "-"}\t${c.esfuerzo || c.efVacio || "settings"}\t${rc}\t-\t${usd || "-"}\n`);
  } finally {
    await lock?.liberar();
  }
}

// ---------------------------------------------------------------- tablero

export interface Pregunta {
  p: string;
  c: string;
  o: string[];
  d: string;
}
export interface Bloque {
  /** null = sin preguntas válidas (sin bloque, o alguna con menos de 2 o más de 4 opciones). */
  preguntas: Pregunta[] | null;
  pruebas: string[];
}

const limpio = (t: string) => t.replace(/^[*_ \t]+|[*_ \t]+$/g, "");
const valor = (s: string) => limpio(s.replace(/^[^:]*:/, ""));

/** `bloque_de` (el awk): las PREGUNTA/CONTEXTO/OPCION/DEFECTO y los PROBAR del RESULTADO. */
export function bloqueDe(res: string): Bloque {
  const ps: { p: string; c: string; o: string[]; d: string }[] = [];
  const pruebas: string[] = [];
  let q: (typeof ps)[number] | null = null;
  let enctx = false;
  let entest = 0;
  const cierra = () => {
    enctx = false;
    entest = 0;
  };
  const lineas = res.split("\n");
  if (lineas[lineas.length - 1] === "") lineas.pop();
  for (const linea of lineas) {
    const s = linea.replace(/^[*#> \t-]+/, "");
    const h = s.toUpperCase();
    if (/^[ \t]*$/.test(s)) {
      cierra();
      continue;
    }
    if (/^(RESULTADO|ARCHIVOS|DECISI(O|Ó)N|SIGUE|FREN(O|Ó))[ \t*_]*:/.test(h)) {
      q = null;
      cierra();
      continue;
    }
    if (/^PROBAR[ \t*_]*:/.test(h)) {
      q = null;
      cierra();
      const v = valor(s);
      entest = 1;
      if (v !== "") pruebas.push(v);
      else entest = 2;
      continue;
    }
    if (entest && !/^(PREGUNTA|CONTEXTO|OPCI(O|Ó)N|DEFECTO)[ \t*_]*:/.test(h)) {
      const v = limpio(s);
      if (entest === 2 || /^[ \t]*[-*•][ \t]/.test(linea)) pruebas.push(v);
      continue;
    }
    if (/^PREGUNTA[ \t*_]*:/.test(h)) {
      cierra();
      q = { p: valor(s), c: "", o: [], d: "" };
      ps.push(q);
      continue;
    }
    if (!q) continue;
    if (/^CONTEXTO[ \t*_]*:/.test(h)) {
      cierra();
      q.c = valor(s);
      enctx = true;
      continue;
    }
    if (/^OPCI(O|Ó)N[ \t*_]*:/.test(h)) {
      cierra();
      q.o.push(valor(s));
      continue;
    }
    if (/^(DEFECTO|POR DEFECTO|DEFAULT)[ \t*_]*:/.test(h)) {
      cierra();
      q.d = valor(s);
      continue;
    }
    if (enctx && q.c !== "") q.c += ` ${limpio(s)}`;
  }
  const defecto = (v0: string, q2: { o: string[] }): string => {
    let v = limpio(v0).toLowerCase();
    v = v.replace(/^opci(o|ó)n[ \t]+/, "").replace(/[.)]$/, "");
    const n = q2.o.length;
    if (/^[0-9]+$/.test(v)) return Number(v) >= 1 && Number(v) <= n ? String(Number(v)) : "";
    if (/^[a-d]$/.test(v)) {
      const i = "abcd".indexOf(v) + 1;
      return i <= n ? String(i) : "";
    }
    for (let i = 0; i < n; i++) if (q2.o[i]!.toLowerCase().replace(/[.]$/, "") === v) return String(i + 1);
    return "";
  };
  const ok = ps.length > 0 && ps.every((x) => x.p !== "" && x.o.length >= 2 && x.o.length <= 4);
  return { preguntas: ok ? ps.map((x) => ({ ...x, d: x.d === "" ? "" : defecto(x.d, x) })) : null, pruebas };
}

/** `prueba_es_comando`: ¿la PROBAR es algo que el worker podría haber corrido él? */
export function pruebaEsComando(texto: string): boolean {
  let t = texto.replace(/^[ \t\n\v\f\r]+/, "");
  t = t.replace(/^\$ /, "").replace(/^`/, "");
  const w = (t.split(/[ \t\n\v\f\r`]/)[0] ?? "").toLowerCase();
  const exactos = "cargo rustc npm npx pnpm yarn bun deno node python python3 pytest uv pip bash sh zsh make just go git curl wget grep rg jq sqlite3 psql systemctl journalctl docker podman".split(" ");
  return exactos.includes(w) || w.startsWith("tests/") || w.startsWith("./") || w.startsWith("bin/") || w.startsWith("scripts/") || w.startsWith("~/") || w.startsWith("/");
}

const corte = (t: string, n: number) => Array.from(t).slice(0, n).join("");

/** `anotar_tablero`: lo que la corrida dejó abierto entra solo al tablero. */
export async function anotarTablero(pa: Pa, l: Lanzamiento): Promise<void> {
  const c = l.c;
  const res = textoResultado(leerSalida(l.out));
  const d = decisionDe(res);
  const decision = decisionEsNada(d) ? "" : decisionDe(res, true);
  const s = sigueDe(res);
  const sigue = s && !decisionEsNada(s) ? s : "";
  const bloque = bloqueDe(res);
  const clave = `pa:${c.origen || c.ts}`;
  const t = (topeS: number, args: string[]) => tableroMudo(pa, topeS, args).catch(() => false);
  let preguntasOk = false;
  if (bloque.preguntas) {
    let ok = 0;
    let n = 0;
    for (const q of bloque.preguntas) {
      n++;
      const a = [`--simple=${q.p}`];
      if (decision) a.push(`--detalle=${decision}`);
      if (q.c) a.push(`--contexto=${q.c}`);
      for (const o of q.o) a.push(`--opcion=${o}`);
      if (q.d) a.push(`--defecto=${q.d}`);
      if (await t(5, ["agregar", corte(q.p, 90), "--columna", "espera-dueno", "--proyecto", c.slug, "--origen", "pa", "--clave", `${clave}:${n}`, "--tipo", "pregunta", ...a])) ok++;
    }
    if (ok) {
      await t(5, ["cerrar", "--clave", clave]);
      preguntasOk = true;
    }
  }
  if (!preguntasOk && decision) {
    const titulo = decision.split("\n")[0]!;
    await t(5, ["agregar", corte(titulo, 90), "--columna", "espera-dueno", "--proyecto", c.slug, "--detalle", decision, "--origen", "pa", "--clave", clave]);
  }
  for (const p of bloque.pruebas) {
    if (!p || pruebaEsComando(p)) continue;
    await t(5, ["agregar", `Probar: ${corte(p, 80)}`, "--columna", "espera-dueno", "--proyecto", c.slug, "--origen", "pa", "--clave", `${clave}:p1`, "--tipo", "prueba", `--prueba=${p}`, `--simple=Probar: ${corte(p, 80)}`]);
    break;
  }
  if (sigue && !c.leer && !c.usaWorktree) {
    const r = await git(["-C", c.ruta, "rev-parse", "-q", "--verify", "HEAD"], { env: pa.env });
    const cabeza = r.codigo === 0 ? r.salida.replace(/\n+$/, "") : "";
    await t(5, ["sigue", c.slug, sigue, ...(cabeza ? ["--head", cabeza] : [])]);
  }
}

/** Los ganchos de `lanzarClaude` con medicion.tsv, estado de la tarea y tablero. */
export function ganchosDe(pa: Pa, l: Llamada, extra: Ganchos = {}): Ganchos {
  let usd = "";
  const rub = l.rub ? { fila: l.rub.fila, modelo: l.rub.modelo, effort: l.rub.effort } : undefined;
  return {
    ...extra,
    medir: async (_out, lz) => {
      usd = await medir(pa, lz, { rub });
    },
    anotarEstado: (rc, lz) => anotarEstado(pa, lz, rc, usd),
    anotarTablero: (lz) => anotarTablero(pa, lz),
  };
}
