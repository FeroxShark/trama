// Cómo se muestra el resultado de una corrida (lo que entrega `pa --esperar`): el `.result` del JSON de claude, el aviso de SIN
// VERIFICAR, la línea de turnos/tiempo/costo y la de la rama (con el aviso de solapamiento con otras ramas sin integrar). Port de
// mostrar_resultado, verificacion_de, verificado_de, stats_resultado, linea_rama, solapamiento, ramas_sin_integrar y claude_falla
// de motor/bin/pa.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { git } from "../base/git.ts";
import { esCarpeta, leerCampo, listar } from "./corridas.ts";
import { type Pa } from "./entorno.ts";

const ENCABEZADO = /^[*#> \t-]*(RESULTADO|ARCHIVOS|DECISI[^:*]{1,2}N|SIGUE|PROBAR|PREGUNTA|FREN(O|Ó))[*]*:/i;

/** `verificacion_de`: la sección VERIFICACION de un RESULTADO (hasta el próximo encabezado conocido). */
export function verificacionDe(texto: string): string {
  let en = false;
  let t = "";
  const lineas = texto.split("\n");
  if (lineas[lineas.length - 1] === "") lineas.pop();
  for (const l of lineas) {
    if (!en) {
      const m = /^[*#> \t-]*VERIFICACI[^:*]{1,2}N[*]*:[*]*(.*)$/i.exec(l);
      if (m) {
        en = true;
        t = m[1]!;
      }
      continue;
    }
    if (ENCABEZADO.test(l)) break;
    t += "\n" + l;
  }
  return t;
}

/** `verificado_de`: el RESULTADO trae evidencia de verificación (no falta, no está vacía, no dice "ninguna"). */
export function verificadoDe(texto: string): boolean {
  const t = verificacionDe(texto).replace(/[`*_]/g, "").replace(/\s/g, " ").trim();
  if (!t) return false;
  return !/^(ninguna|ninguno|nada|n\/?a|no|-+|sin\s+verificar)([\s.:,;-]|$)/i.test(t);
}

/** `jq -r` de un valor: los textos tal cual, el resto como JSON. */
const jqTexto = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
/** `// x` de jq: null y false caen al alternativo. */
const o = <T>(v: unknown, alt: T) => (v === undefined || v === null || v === false ? alt : v);

/** El JSON de salida de claude, o null si no se puede leer. */
function leerSalida(f: string): Record<string, unknown> | null {
  try {
    const j = JSON.parse(readFileSync(f, "utf8")) as unknown;
    return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `transcript_de`: el jsonl de la conversación de esa salida (por su session_id, en PA_PROJ o ~/.claude/projects). */
export function transcriptDe(pa: Pa, j: Record<string, unknown>): string {
  const sid = j.session_id;
  if (typeof sid !== "string" || !sid) return "";
  const proj = pa.env.PA_PROJ || path.join(pa.home, ".claude", "projects");
  for (const d of listar(proj)) {
    const f = path.join(proj, d, `${sid}.jsonl`);
    if (existsSync(f)) return f;
  }
  return "";
}

/** `contar_compactaciones`: cuántas veces compactó el worker (líneas con `"subtype":"compact_boundary"`). */
export function contarCompactaciones(transcript: string): number {
  if (!transcript) return 0;
  try {
    return readFileSync(transcript, "utf8").split("\n").filter((l) => l.includes('"subtype":"compact_boundary"')).length;
  } catch {
    return 0;
  }
}

/** Un número como lo imprime jq (enteros sin decimales, el resto con la representación más corta). */
const jqNum = (n: number) => (Number.isFinite(n) ? String(n) : "null");

/** `stats_resultado`: «— N turnos · Ns · US$X» (y el aviso si compactó). */
export function statsResultado(pa: Pa, j: Record<string, unknown>): string {
  const comp = contarCompactaciones(transcriptDe(pa, j));
  const extra = comp > 0 ? ` · ${comp} compactación(es)` : "";
  const turnos = o(j.num_turns, 0);
  const dur = Math.floor(Number(o(j.duration_ms, 0)) / 1000);
  const usd = Math.round(Number(o(j.total_cost_usd, 0)) * 10000) / 10000;
  let s = `— ${jqTexto(turnos)} turnos · ${jqNum(dur)}s · US$${jqNum(usd)}${extra}\n`;
  if (extra) s += "  (compactó: la tarea no entró en un contexto. Partila en varias la próxima; un worker que compactó ya no sabe bien qué tocó él.)\n";
  return s;
}

const gitSal = async (args: string[], env: Pa["env"]) => {
  const r = await git(args, { env });
  return r.codigo === 0 ? r.salida.replace(/\n$/, "") : null;
};

/** `tree_principal`: el primer worktree de la lista (el tree principal), o "". */
export async function treePrincipal(repo: string, env: Pa["env"]): Promise<string> {
  const s = await gitSal(["-C", repo, "worktree", "list", "--porcelain"], env);
  const l = (s ?? "").split("\n")[0] ?? "";
  return l.startsWith("worktree ") ? l.slice("worktree ".length) : "";
}

/** `ramas_sin_integrar`: «id \t rama \t commits pendientes \t asunto» de las corridas del proyecto con trabajo sin integrar. */
export async function ramasSinIntegrar(dir: string, env: Pa["env"]): Promise<[string, string, string, string][]> {
  const r: [string, string, string, string][] = [];
  for (const n of listar(dir, (x) => x.endsWith(".corrida"))) {
    const c = path.join(dir, n);
    if (leerCampo(c, "origen")) continue;
    const rama = leerCampo(c, "rama");
    const repo = leerCampo(c, "ruta_trabajo");
    if (!rama || !esCarpeta(repo)) continue;
    if ((await git(["-C", repo, "rev-parse", "-q", "--verify", `refs/heads/${rama}`], { env })).codigo !== 0) continue;
    const ppal = (await treePrincipal(repo, env)) || repo;
    const pend = (await gitSal(["-C", ppal, "rev-list", "--count", `HEAD..${rama}`], env)) ?? "0";
    if (!/^[0-9]+$/.test(pend) || Number(pend) === 0) continue;
    r.push([n.replace(/\.corrida$/, ""), rama, pend, (await gitSal(["-C", repo, "log", "-1", "--format=%s", rama], env)) ?? ""]);
  }
  return r;
}

/** `solapamiento`: otras ramas sin integrar del proyecto que tocan alguno de estos archivos. */
export async function solapamiento(pa: Pa, ruta: string, dir: string, proyecto: string, propio: string, mios: string, verbo = "toca"): Promise<string> {
  const lista = mios.split("\n").filter(Boolean);
  if (!lista.length) return "";
  let s = "";
  for (const [t, r] of await ramasSinIntegrar(dir, pa.env)) {
    if (t === propio) continue;
    const b = await gitSal(["-C", ruta, "merge-base", "HEAD", r], pa.env);
    if (b === null) continue;
    const suyos = ((await gitSal(["-C", ruta, "diff", "--name-only", b, r], pa.env)) ?? "").split("\n");
    const comun = suyos.filter((x) => lista.includes(x)).slice(0, 5).join(" ");
    if (!comun) continue;
    if (verbo === "entró a main") s += `— ojo: la corrida ${t} (sin integrar) toca lo mismo que acaba de entrar (${comun}): al integrarla puede chocar; si da 80, pa '${proyecto}' --actualizar ${t}.\n`;
    else s += `— ojo: la corrida ${t} (sin integrar) también toca ${comun}: la que se integre segunda puede chocar.\n`;
  }
  return s;
}

/** `linea_rama`: la rama de la corrida y cómo integrarla (si la corrida tiene `.corrida` y la rama existe). */
export async function lineaRama(pa: Pa, json: string): Promise<string> {
  const c = json.replace(/\.json$/, "") + ".corrida";
  if (!existsSync(c)) return "";
  const r = leerCampo(c, "rama");
  const bc = leerCampo(c, "base");
  const repo = leerCampo(c, "ruta_trabajo");
  if (!r || !esCarpeta(repo)) return "";
  if ((await git(["-C", repo, "rev-parse", "-q", "--verify", `refs/heads/${r}`], { env: pa.env })).codigo !== 0) return "";
  const ppal = (await treePrincipal(repo, pa.env)) || repo;
  // la base real es el merge-base con el HEAD (una rama rebaseada con --actualizar ya no sale de `base=`)
  const b = (await gitSal(["-C", ppal, "merge-base", "HEAD", r], pa.env)) ?? bc;
  const n = (await gitSal(["-C", repo, "rev-list", "--count", `${b}..${r}`], pa.env)) ?? "0";
  const t = leerCampo(c, "origen") || path.basename(json.replace(/\.json$/, ""));
  const p = leerCampo(c, "proyecto") || path.basename(path.dirname(json));
  if (n === "0") {
    if (bc && (await gitSal(["-C", repo, "rev-list", "--count", `${bc}..${r}`], pa.env)) !== "0") return `— rama ${r}: sus commits ya están todos en el tree principal. Nada que integrar.\n`;
    return `— rama ${r} sin commits: no cambió nada. Se tira con: pa '${p}' --descartar ${t}\n`;
  }
  let s = `— rama ${r}: ${n} commit(s) sobre ${b.slice(0, 7)}. NO está en main hasta que la integres: pa '${p}' --integrar ${t}\n`;
  s += await solapamiento(pa, ppal, path.dirname(json), p, t, (await gitSal(["-C", ppal, "diff", "--name-only", b, r], pa.env)) ?? "");
  return s;
}

/** `mostrar_resultado`: todo lo que se imprime de una corrida terminada (por stdout). */
export async function mostrarResultado(pa: Pa, json: string): Promise<void> {
  const j = leerSalida(json);
  if (!j) return;
  const res = j.result;
  pa.io.out(`${jqTexto(o(res, "(sin resultado)"))}\n`);
  const resV = jqTexto(o(res, ""));
  const base = json.replace(/\.json$/, "");
  if (!existsSync(`${base}.leer`) && resV.includes("RESULTADO:") && !verificadoDe(resV)) {
    pa.io.out(
      `— SIN VERIFICAR: el RESULTADO no trae VERIFICACION (comando + salida). No lo des por bueno: pedile la evidencia con pa '${path.basename(path.dirname(json))}' --seguir --id ${path.basename(base)} 'corré la verificación y pegá la salida'.\n`,
    );
  }
  pa.io.out(statsResultado(pa, j));
  pa.io.out(await lineaRama(pa, json));
}

/** `claude_falla`: el mensaje de claude fuera del PATH (84) o de claude roto (81). */
export function claudeFalla(pa: Pa, rc: string, error = ""): void {
  const conocido = pa.env.CLAUDE_CONOCIDO || path.join(pa.home, ".local", "bin", "claude");
  if (rc === "84") {
    pa.io.err(`pa: claude no está en el PATH de este proceso (PATH=${pa.env.PATH ?? ""}). No está roto: existe en ${conocido}.\n`);
    pa.io.err(`pa: agregá ${path.dirname(conocido)} al PATH del servicio/timer/cron que llama a pa. NO hace falta reinstalar claude.\n`);
    return;
  }
  pa.io.err("pa: la instalación de claude está ROTA. No es un fallo del worker ni del proyecto.\n");
  const lineas = error.split("\n").filter((l) => l !== "").slice(0, 6);
  for (const l of lineas) pa.io.err(`    ${l}\n`);
  pa.io.err('pa: si fue un auto-update ("native binary not installed"), se arregla con:\n');
  pa.io.err("    node ~/.local/lib/node_modules/@anthropic-ai/claude-code/install.cjs\n");
  pa.io.err("pa: no relances workers hasta que `claude --version` ande.\n");
}
