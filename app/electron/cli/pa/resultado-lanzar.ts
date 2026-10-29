// Lo que `pa` lee del `.json` final de un worker (la salida de `claude -p --output-format json`): el bloque RESULTADO /
// DECISION / SIGUE / VERIFICACION, la línea de stats, la de la rama y la hora de reset de un límite de sesión. Port de
// campo_de, decision_es_nada, verificacion_de/verificado_de, stats_resultado, linea_rama, mostrar_resultado y epoch_reset de
// motor/bin/pa. Contrato del port (motor/docs/port-windows.md, «Lo que es contrato» 2 y 5): lo que sale por stdout se compara
// byte a byte con el del bash (tests/paridad).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { git } from "../base/git.ts";
import type { Env } from "./entorno.ts";

/** El `.json` de una corrida (lo que dejó claude), o null si no es un objeto. */
export function leerSalida(out: string): Record<string, unknown> | null {
  try {
    const j = JSON.parse(readFileSync(out, "utf8")) as unknown;
    return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `jq -r '.result // ""'` (con el `$(…)` del bash: sin los `\n` del final). */
export function textoResultado(j: Record<string, unknown> | null): string {
  const r = j?.result;
  if (r === undefined || r === null || r === false) return "";
  return (typeof r === "string" ? r : JSON.stringify(r)).replace(/\n+$/, "");
}

/** `jq -r '.campo // empty'` como texto. */
export function campoJson(j: Record<string, unknown> | null, k: string): string {
  const x = j?.[k];
  if (x === undefined || x === null || x === false) return "";
  return typeof x === "string" ? x : JSON.stringify(x);
}

/** Corta a `n` caracteres (code points, como el substr de gawk en UTF-8). */
const cortar = (s: string, n: number) => {
  const cs = Array.from(s);
  return cs.length > n ? cs.slice(0, n).join("") : s;
};

const OTRO = /^[*#> \t-]*(RESULTADO|ARCHIVOS|DECISI(O|Ó)N|SIGUE|FREN(O|Ó))[*]*:/;

/**
 * `campo_de`: el valor de un encabezado (`DECISI(O|Ó)N`, `SIGUE`…) del bloque del worker, tolerante a markdown. Con `todo`, el
 * campo entero hasta el próximo encabezado (tope 2000); sin él, la línea (o, si está vacía, el primer párrafo; tope 400).
 */
export function campoDe(re: string, texto: string, todo = false): string {
  const l = texto.split("\n");
  if (l.length > 1 && l[l.length - 1] === "" && texto.endsWith("\n")) l.pop();
  const anc = new RegExp(`^[*#> \\t-]*${re}[*]*:`);
  let a = -1;
  let t = "";
  l.forEach((x, i) => {
    if (anc.test(x)) a = i;
  });
  if (a >= 0) {
    t = l[a]!.replace(new RegExp(`^[*#> \\t-]*${re}[*]*:[*]*`), "");
    if (todo) {
      for (let j = a + 1; j < l.length && !OTRO.test(l[j]!); j++) t += "\n" + l[j];
    } else if (/^[ \t]*$/.test(t)) {
      t = "";
      for (let j = a + 1; j < l.length && !OTRO.test(l[j]!); j++) {
        if (/^[ \t]*$/.test(l[j]!)) {
          if (t !== "") break;
          continue;
        }
        t += (t === "" ? "" : " ") + l[j];
      }
    }
  } else {
    const suelto = new RegExp(`${re}[*]*:[*]*`);
    for (let i = l.length - 1; i >= 0 && t === ""; i--) {
      let s = l[i]!;
      let hay = false;
      for (let m = suelto.exec(s); m; m = suelto.exec(s)) {
        s = s.slice(m.index + m[0].length);
        hay = true;
        if (m[0].length === 0) break;
      }
      if (hay) t = s;
    }
  }
  if (re !== "SIGUE") t = t.replace(/[*#> \t-]*SIGUE[*]*:[\s\S]*$/, "");
  t = t.replace(/^[ \t\n]+|[ \t\n]+$/g, "");
  return cortar(t, todo ? 2000 : 400).replace(/\n+$/, "");
}

export const decisionDe = (texto: string, todo = false) => campoDe("DECISI(O|Ó)N", texto, todo);
export const sigueDe = (texto: string, todo = false) => campoDe("SIGUE", texto, todo);
/** `freno_de`: el FRENÓ del resultado en una línea, sin tabs (la columna `freno` de medicion.tsv). */
export const frenoDe = (texto: string) => campoDe("FREN(O|Ó)", texto).replace(/\t/g, " ");

/** `decision_es_nada`: «nada» estricto (sin asteriscos ni espacios, a lo sumo un punto final). */
export function decisionEsNada(d: string): boolean {
  const x = d.replace(/\*/g, "").replace(/^\s+|\s+$/g, "").replace(/\.$/, "");
  return x.toLowerCase() === "nada";
}

/** `verificacion_de`: el texto de la sección VERIFICACION (sin distinguir mayúsculas). */
export function verificacionDe(texto: string): string {
  let en = false;
  let t = "";
  for (const l of texto.split("\n")) {
    if (!en) {
      const m = /^[*#> \t-]*VERIFICACI[^:*]{1,2}N[*]*:[*]*(.*)$/i.exec(l);
      if (m) {
        en = true;
        t = m[1]!;
      }
      continue;
    }
    if (/^[*#> \t-]*(RESULTADO|ARCHIVOS|DECISI[^:*]{1,2}N|SIGUE|PROBAR|PREGUNTA|FREN(O|Ó))[*]*:/i.test(l)) break;
    t += "\n" + l;
  }
  return t;
}

/** `verificado_de`: ¿el RESULTADO trae evidencia de verificación? (no si falta, está vacía o dice «ninguna»). */
export function verificadoDe(texto: string): boolean {
  const t = verificacionDe(texto)
    .replace(/[`*_]/g, "")
    .replace(/\s/g, " ")
    .replace(/^\s+|\s+$/g, "");
  if (!t) return false;
  return !/^(ninguna|ninguno|nada|n\/?a|no|-+|sin\s+verificar)([\s.:,;-]|$)/i.test(t);
}

/** `transcript_de`: el jsonl de la sesión del `.json`, buscado bajo la carpeta de proyectos de claude (PA_PROJ). */
export function transcriptDe(j: Record<string, unknown> | null, proj: string): string {
  const sid = campoJson(j, "session_id");
  if (!sid) return "";
  let dirs: string[];
  try {
    dirs = readdirSync(proj).sort();
  } catch {
    return "";
  }
  for (const d of dirs) {
    const f = path.join(proj, d, `${sid}.jsonl`);
    if (existsSync(f)) return f;
  }
  return "";
}

/** `contar_compactaciones`: cuántos `compact_boundary` tiene el transcript ("" si no hay archivo). */
export function contarCompactaciones(f: string): string {
  if (!f || !existsSync(f)) return "";
  try {
    return String(readFileSync(f, "utf8").split("\n").filter((l) => l.includes('"subtype":"compact_boundary"')).length);
  } catch {
    return "0";
  }
}

/** Un número como lo imprime jq (enteros sin `.0`). */
const numJq = (n: number) => (Number.isInteger(n) ? String(n) : String(n));

/** `stats_resultado`: la línea «— N turnos · Ns · US$X» (y el aviso si compactó). */
export function statsResultado(j: Record<string, unknown> | null, proj: string): string {
  const comp = contarCompactaciones(transcriptDe(j, proj));
  const extra = /^[0-9]+$/.test(comp) && Number(comp) > 0 ? ` · ${comp} compactación(es)` : "";
  const num = (k: string) => {
    const x = j?.[k];
    return typeof x === "number" ? x : x === undefined || x === null || x === false ? 0 : Number(x);
  };
  const costo = Math.round(num("total_cost_usd") * 10000) / 10000;
  let s = `— ${numJq(num("num_turns"))} turnos · ${Math.floor(num("duration_ms") / 1000)}s · US$${numJq(costo)}${extra}\n`;
  if (extra) s += "  (compactó: la tarea no entró en un contexto. Partila en varias la próxima; un worker que compactó ya no sabe bien qué tocó él.)\n";
  return s;
}

/** `leer_campo`: el valor de `campo=` en un archivo clave=valor ("" si no está). */
export function leerCampo(f: string, campo: string): string {
  try {
    for (const l of readFileSync(f, "utf8").split("\n")) if (l.startsWith(`${campo}=`)) return l.slice(campo.length + 1);
  } catch {
    /* sin archivo */
  }
  return "";
}

/** `git -C repo …` → stdout sin el `\n` final, o null si falló. */
async function g(repo: string, args: string[], env: Env): Promise<string | null> {
  const r = await git(["-C", repo, ...args], { env });
  return r.codigo === 0 ? r.salida.replace(/\n+$/, "") : null;
}

/** Las otras ramas sin integrar que tocan lo mismo (`solapamiento`): lo pone quien porte las ramas; sin él no se dice nada. */
export type Solapamiento = (id: string, archivos: string, ctx: { ruta: string; dir: string; proyecto: string }) => Promise<string>;

/** `linea_rama`: la rama de la corrida (del `.corrida` al lado del `.json`) y cómo integrarla o tirarla. */
export async function lineaRama(out: string, env: Env, solapamiento?: Solapamiento): Promise<string> {
  const c = out.replace(/\.json$/, ".corrida");
  if (!existsSync(c)) return "";
  const r = leerCampo(c, "rama");
  const bc = leerCampo(c, "base");
  const repo = leerCampo(c, "ruta_trabajo");
  if (!r || !repo || !existsSync(repo)) return "";
  if ((await g(repo, ["rev-parse", "-q", "--verify", `refs/heads/${r}`], env)) === null) return "";
  const lista = await g(repo, ["worktree", "list", "--porcelain"], env);
  const ppal = (lista ?? "").split("\n")[0]?.replace(/^worktree /, "") || repo;
  const b = (await g(ppal, ["merge-base", "HEAD", r], env)) ?? bc;
  const n = (await g(repo, ["rev-list", "--count", `${b}..${r}`], env)) ?? "0";
  const t = leerCampo(c, "origen") || path.basename(out, ".json");
  const p = leerCampo(c, "proyecto") || path.basename(path.dirname(out));
  if (n === "0") {
    if (bc && (await g(repo, ["rev-list", "--count", `${bc}..${r}`], env)) !== "0") return `— rama ${r}: sus commits ya están todos en el tree principal. Nada que integrar.\n`;
    return `— rama ${r} sin commits: no cambió nada. Se tira con: pa '${p}' --descartar ${t}\n`;
  }
  let s = `— rama ${r}: ${n} commit(s) sobre ${b.slice(0, 7)}. NO está en main hasta que la integres: pa '${p}' --integrar ${t}\n`;
  if (solapamiento) s += await solapamiento(t, (await g(ppal, ["diff", "--name-only", b, r], env)) ?? "", { ruta: ppal, dir: path.dirname(out), proyecto: p });
  return s;
}

/** `mostrar_resultado`: el resultado del worker, el aviso de SIN VERIFICAR, las stats y la rama. Es lo que va por stdout. */
export async function mostrarResultado(out: string, o: { proj: string; env: Env; solapamiento?: Solapamiento }): Promise<string> {
  const j = leerSalida(out);
  const r = j?.result;
  let s = (r === undefined || r === null || r === false ? "(sin resultado)" : typeof r === "string" ? r : JSON.stringify(r)) + "\n";
  const res = textoResultado(j);
  if (!existsSync(out.replace(/\.json$/, ".leer")) && res.includes("RESULTADO:") && !verificadoDe(res)) {
    s += `— SIN VERIFICAR: el RESULTADO no trae VERIFICACION (comando + salida). No lo des por bueno: pedile la evidencia con pa '${path.basename(path.dirname(out))}' --seguir --id ${path.basename(out, ".json")} 'corré la verificación y pegá la salida'.\n`;
  }
  s += statsResultado(j, o.proj);
  s += await lineaRama(out, o.env, o.solapamiento);
  return s;
}

// ---------------------------------------------------------------- hora de reset de un límite

/** El corrimiento (ms) de la zona `zona` en el instante `t` (local - UTC). */
function corrimiento(t: number, zona: string | undefined): number {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: zona, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - Math.floor(t / 1000) * 1000;
}

/** La zona válida para Intl, o undefined (la del proceso). */
export function zonaValida(z: string | undefined): string | undefined {
  if (!z) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z });
    return z;
  } catch {
    return undefined;
  }
}

/** `HH:MM` del epoch en la zona (`date -d @ep +%H:%M`). */
export function horaMinuto(ep: number, zona: string | undefined): string {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: zonaValida(zona), hourCycle: "h23", hour: "2-digit", minute: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(new Date(ep * 1000)).map((x) => [x.type, x.value]));
  return `${p.hour}:${p.minute}`;
}

/**
 * `epoch_reset`: el epoch de «resets 7pm (Zona)» del texto de un límite de sesión (la próxima vez que sea esa hora), o null.
 * La zona entre paréntesis manda; una que no existe se ignora y vale la local (`TZ`).
 */
export function epochReset(texto: string, env: Env, ahora = Date.now()): number | null {
  const m = /resets[^\S\n]+([0-9]{1,2})(?::([0-9]{2}))?[^\S\n]*([ap])m/.exec(texto);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? "0");
  if (h < 1 || h > 12 || min > 59) return null;
  if (h === 12) h = 0;
  if (m[3] === "p") h += 12;
  const reZona = /.*resets\s+[0-9]{1,2}(?::[0-9]{2})?\s*[ap]m\s*\(([A-Za-z0-9_+/-]+)\).*/;
  const zm = texto.split("\n").map((l) => reZona.exec(l)).find(Boolean);
  let zona = zonaValida(env.TZ);
  const zt = zm?.[1];
  if (zt) {
    const zi = "/usr/share/zoneinfo";
    const existe = existsSync(zi) ? existsSync(path.join(zi, zt)) : true;
    if (existe && zonaValida(zt)) zona = zt;
  }
  // el día de hoy en esa zona, a esa hora
  const off0 = corrimiento(ahora, zona);
  const local = new Date(ahora + off0);
  const guess = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, min, 0);
  let ep = guess - corrimiento(guess - off0, zona);
  ep = Math.floor(ep / 1000);
  if (ep < Math.floor(ahora / 1000)) ep += 86400;
  return ep;
}
