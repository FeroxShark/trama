// Lanzar un worker de claude: el settings del worker (hooks de latido y guardia), el contrato y el argv de `claude -p`, el
// rastro de la corrida (.sid, .corrida, .hilo, .running, eventos), correr al claude con su salida en `<ts>.json`, clasificar
// cómo terminó (límite de sesión 76, sobrecarga 77, sin turnos 78 con auto-cierre, claude roto 81/84, fallo 1, sin RESULTADO
// 78) y el cierre de `al_salir` (.ultimo, .listo, fin en el .hilo). Port de la parte de motor/bin/pa que va desde «hooks
// propios del worker» hasta el final (etapa 6 de motor/docs/port-windows-plan.md), sólo para el motor `claude`.
//
// Lo de antes (argumentos, política de modelos, puesto, worktree, async) lo arma quien llama y lo pasa en `Corrida`; lo que
// todavía no está portado (medicion.tsv, tablero, estado de la tarea madre, relanzar por cupo con reparto, ramas que se solapan)
// entra por `Ganchos`, y sin gancho no se hace. En Windows no hay SIGTERM: el cierre ordenado entra por `senal` (un AbortSignal
// que el canal de control del lock dispara en `--parar`/`--matar`), y hace lo mismo que el trap TERM/INT del bash.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { agregarLinea, escribirAtomico } from "../base/archivo.ts";
import { enPath, esEjecutable } from "../base/buscar.ts";
import { tomar } from "../base/lock.ts";
import { matarArbol } from "../base/proc.ts";
import { comandoHook, entreComillas, type VarianteHook } from "../hooks.ts";
import { CIERRE_TAREA, CIERRE_TURNOS, CONTRATO, conJefe, SIN_JEFE } from "./contrato.ts";
import { conDueno, type Env, type Pa } from "./entorno.ts";
import {
  campoJson,
  decisionDe,
  decisionEsNada,
  epochReset,
  horaMinuto,
  leerCampo,
  leerSalida,
  mostrarResultado,
  sigueDe,
  statsResultado,
  textoResultado,
  verificadoDe,
  type Solapamiento,
} from "./resultado-lanzar.ts";
import { deltaSucios, limpiarBuild } from "./sucios.ts";

/** Todo lo que `pa` ya decidió antes de lanzar (argumentos, política, puesto, worktree). Los nombres son los del bash. */
export interface Corrida {
  /** El proyecto como lo nombró el jefe (`$proyecto`, el que va en los «pa '<proy>' …» de los mensajes). */
  proyecto: string;
  slug: string;
  /** El id de la corrida (`AAAAMMDD-HHMMSS-pid`). */
  ts: string;
  /** El tree principal. */
  ruta: string;
  rutaTrabajo: string;
  rama: string;
  base: string;
  /** El ts de la corrida que sacó la rama (un --seguir), o "". */
  origen: string;
  /** "" (--leer), "aca" o el número de puesto. */
  puesto: string;
  leer: boolean;
  usaWorktree: boolean;
  /** ¿Tenemos el lock del puesto? (sin él no se escribe el .ultimo: es del que está corriendo). */
  tengoLock: boolean;
  modelo: string;
  /** `--effort` que se pasa ("" = el de settings). */
  esfuerzo: string;
  /** Lo que va al .hilo si no hay effort (`ef_vacio`; default `settings`). */
  efVacio?: string;
  cuenta: string;
  /** El `env -u … CLAUDE_CONFIG_DIR=…` de la cuenta: va SÓLO en el proceso del claude. */
  cuentaEnv?: { poner?: Record<string, string>; quitar?: string[] };
  /** La tarea que se le manda (con los avisos que le sumó pa). */
  tarea: string;
  /** La tarea como la escribió el jefe (la del .hilo). */
  tareaJefe: string;
  /** `PA_ORIGEN` validado (default `jefe`). */
  lanzo: string;
  tipo?: string;
  fase?: string;
  tareaId?: string;
  /** La rúbrica normalizada (`RUB_NORM`). */
  rubrica?: string;
  subtarea?: string;
  /** El session id: el nuevo (uuid) o el que se retoma. */
  sid: string;
  resume: boolean;
  conMcp: boolean;
  /** "" = sin tope. */
  maxTurns: string;
  maxBudget: string;
  /** El test espejo ya colocado (--espejo), o "". */
  espejo?: string;
  /** --actualizar: el HEAD del tree principal sobre el que se rebasea. */
  actualizar?: { shaMain: string };
  /** `--autocompact` que se pasa ("" = la ventana nativa: no se pasa). */
  autocompact: string;
  /** La ficha del proyecto (`tablero ficha --corta`), ya calculada; "" = no va. */
  ficha?: string;
  /** ¿Modelo de poca inteligencia? (reparto --tabla < PA_CALIDAD_BAJA). */
  modeloFlojo?: boolean;
  /** Los otros writers del proyecto, ya formateados («- id (puesto k): tarea», uno por línea). */
  paralelos?: string;
  /** Las líneas porcelain sucias al arrancar (vacío en un worktree). */
  baseDelta: string[];
  /** Horas de la sesión que se retoma (para el aviso del final), o null. */
  edadH?: number | null;
  /** El nombre y el id del jefe (`jefe_nombre`, `jefe_id`). */
  jefe: string;
  jefeId: string;
  /** El que corre en segundo plano (`PA_ASYNC`): deja `.listo`. */
  async: boolean;
}

/** Lo que todavía vive en otras partes del port. Sin el gancho, ese paso no se hace (como si fallara en silencio, `|| true`). */
export interface Ganchos {
  /** `medir`: la fila de medicion.tsv (con el JSON previo de una corrida que se quedó sin turnos). */
  medir?: (out: string, l: Lanzamiento) => Promise<void>;
  /** `anotar_estado`: estado.tsv de la tarea madre (sólo con tarea_id). */
  anotarEstado?: (rc: number, l: Lanzamiento) => Promise<void>;
  /** `anotar_tablero`: DECISION/SIGUE/preguntas al tablero. */
  anotarTablero?: (l: Lanzamiento) => Promise<void>;
  /** Soltar el puesto y el lugar del tope global (el `exec 9>&- 6>&-`). */
  soltar?: () => Promise<void>;
  /** Relanzar con otro modelo por falta de cupo (reparto): true si cambió la corrida y hay que correr de nuevo (hasta 3 veces). */
  relanzarPorCupo?: (l: Lanzamiento, intento: number) => Promise<boolean>;
  /** Las ramas sin integrar que tocan lo mismo (la cola de `linea_rama`). */
  solapamiento?: Solapamiento;
}

export interface OpcionesLanzar {
  ganchos?: Ganchos;
  /** Dispara el cierre ordenado (el trap TERM/INT): mata el árbol del claude y sale 130. */
  senal?: AbortSignal;
  /** Escuchar SIGTERM/SIGINT del proceso (default true fuera de Windows). */
  senalesProceso?: boolean;
  /** Variante de los hooks del settings (default `sh` en Linux/mac, `mjs` en Windows) y el node que corre los `.mjs`. */
  hooks?: { variante?: VarianteHook; node?: string };
  /** La espera antes del reintento por 529 (default 60 s, como el bash). */
  espera529Ms?: number;
  /** El ejecutable de claude (default: `claude` del PATH de `pa.env`). */
  claude?: string;
}

/** El estado vivo de una corrida mientras se lanza: lo que en el bash son variables globales. */
export interface Lanzamiento {
  pa: Pa;
  c: Corrida;
  dir: string;
  out: string;
  err: string;
  run: string;
  hb: string;
  sfile: string;
  ult: string;
  transcript: string;
  settings: string;
  contrato: string;
  nombreWorker: string;
  args: string[];
  /** El env de más para el claude (PA_RECORTE, PA_MAX_TURNS, PA_CIERRE). */
  envClaude: Env;
  inicio: number;
  /** El pid del claude mientras corre. */
  hijo: number | null;
  /** El JSON de la corrida que se quedó sin turnos (lo suma `medir`). */
  jsonPrevio: string;
  eventoInicio: boolean;
}

// ---------------------------------------------------------------- rutas y nombres

/** `suf_puesto`: "" para el puesto 1 (o vacío), `@k` para el resto. */
export const sufPuesto = (p: string) => (!p || p === "1" ? "" : `@${p}`);

/** `escapar`: la carpeta de proyecto de claude para una ruta (todo lo que no es alfanumérico, `-`). */
export const escapar = (s: string) => s.replace(/[^A-Za-z0-9]/g, "-");

/** La carpeta de proyectos de claude (`PA_PROJ`, o `~/.claude/projects`). */
export const carpetaProyectos = (pa: Pa) => pa.env.PA_PROJ || path.join(pa.home, ".claude", "projects");

/** `limite_de`: el archivo del límite de sesión de una cuenta. */
export function limiteDe(pa: Pa, cuenta: string): string {
  const c = cuenta.replace(/[^A-Za-z0-9._-]/g, "-");
  return !c || c === "claude" ? path.join(pa.state, "limite.hasta") : path.join(pa.state, `limite.${c}.hasta`);
}

/** El `.running` y el `.heartbeat` de la corrida (el de un --leer es por corrida; el de un writer, por puesto). */
export function rastroDe(pa: Pa, c: Pick<Corrida, "slug" | "ts" | "leer" | "puesto">): { run: string; hb: string } {
  const base = c.leer ? path.join(pa.state, `${c.slug}.leer-${c.ts}`) : path.join(pa.state, `${c.slug}${sufPuesto(c.puesto)}`);
  return { run: `${base}.running`, hb: `${base}.heartbeat` };
}

// ---------------------------------------------------------------- settings del worker

/** El JSON de `--settings` del worker: latido y guardia como hooks, el plugin caveman apagado y el deny del espejo. */
export function settingsWorker(
  pa: Pa,
  o: { hb: string; leer: boolean; espejo?: string; variante?: VarianteHook; node?: string },
): string {
  const variante = o.variante ?? (pa.plat === "win32" ? "mjs" : "sh");
  const hooks = path.join(path.dirname(pa.bin), "hooks");
  const opc = { node: o.node, plataforma: pa.plat === "win32" ? ("win32" as const) : ("linux" as const) };
  const guard = comandoHook("destructive-guard", variante, hooks, opc);
  const latido = comandoHook("latido", variante, hooks, opc);
  const hb = entreComillas(pa.plat === "win32" ? o.hb.replace(/\\/g, "/") : o.hb);
  const modo = o.leer ? " leer" : "";
  let deny: string[] = [];
  if (o.espejo) {
    const d = path.dirname(o.espejo);
    const r = `~${d.startsWith(pa.home) ? d.slice(pa.home.length) : d}`;
    deny = [`Read(/${d}/**)`, `Bash(*${d}*)`, `Bash(*${r}*)`];
  }
  const s: Record<string, unknown> = {
    crossSessionInbound: "accept",
    claudeMdExcludes: [pa.plat === "win32" ? path.win32.join(pa.home, "CLAUDE.md") : `${pa.home}/CLAUDE.md`],
    enabledPlugins: { "caveman@caveman": false },
    hooks: {
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: guard }] },
        { hooks: [{ type: "command", command: `${latido} ${hb} pre${modo}` }] },
      ],
      PostToolUse: [{ hooks: [{ type: "command", command: `${latido} ${hb} post` }] }],
    },
  };
  if (deny.length) s.permissions = { deny };
  return JSON.stringify(s);
}

// ---------------------------------------------------------------- contrato

/** `lecciones_bloque`: las últimas 12 líneas de lecciones.md (tope 1500 caracteres), con su encabezado; "" si no hay. */
export function leccionesBloque(dir: string): string {
  const f = path.join(dir, "lecciones.md");
  let txt: string;
  try {
    if (!statSync(f).size) return "";
    txt = readFileSync(f, "utf8");
  } catch {
    return "";
  }
  const ls = txt.split("\n");
  if (ls[ls.length - 1] === "") ls.pop();
  let t = ls.slice(-12).join("\n").replace(/\n+$/, "");
  const cs = Array.from(t);
  if (cs.length > 1500) {
    t = cs.slice(-1500).join("");
    const i = t.indexOf("\n");
    if (i >= 0) t = t.slice(i + 1);
  }
  if (!t) return "";
  return `\nLecciones de corridas anteriores en este proyecto (no repitas esos errores):\n${t}`;
}

const TXT_FLOJO =
  'Trabajá en pasos chicos: un cambio por vez, corré la verificación después de CADA cambio y commiteá cuando pase antes de seguir con el próximo. Si algo falla, arreglalo antes de tocar otra cosa. Quedate en los archivos de la tarea: nada de refactors ni de "ya que estoy". Si la tarea es más grande de lo que pinta, hacé la parte que cierra, commiteala y decí en DECISION cómo partir el resto.';
const TXT_LEER =
  "Modo LECTURA: no escribís nada. Bash existe SOLO para git de lectura (log, diff, show, status, rev-list, rev-parse, merge-base, ls-files, ls-tree, blame, shortlog, describe, cat-file, grep, branch --list, worktree list, stash list/show), con -C <ruta> en vez de cd, y a lo sumo un pipe a head/tail/grep/wc/cut. Nada de ;, &&, redirecciones ni $(...): un hook bloquea todo lo demás.";
const TXT_PRO =
  "Modo ahorro (la suscripción es chica): leé SOLO lo que la tarea necesita; si te dieron rutas, empezá por ahí y no recorras el repo. Buscá con Grep/Glob antes de abrir archivos enteros, y leé rangos (offset/limit) en archivos largos. Filtrá la salida de los comandos (`| tail -n 40`, `| grep -E 'FAIL|error'`): todo lo que entra al contexto se vuelve a pagar en cada turno. Verificá con el test más acotado que pruebe tu cambio, no la suite entera, salvo que la tarea lo pida. No lances subagentes. Si la tarea resulta mucho más grande de lo que pinta, hacé la parte que cierra, commiteala y decí en DECISION cómo partir el resto.";
const TXT_ABANICO =
  'Abanico de Haikus: cuando muchos intentos verificables valen más que uno pensado (buscar algo que un grep no encuentra, revisar muchos archivos o candidatos, probar variantes contra un test o chequeo), repartilo en paralelo entre subagentes (Agent con model "haiku" y effort xhigh si se puede; hasta ~10, un pedazo cada uno, que devuelvan algo verificable) y verificá vos. No para diseño, decisiones ni código donde un intento malo cuesta caro. Esos subagentes no son delegar: siguen siendo tu trabajo.';

/** El texto de `--append-system-prompt` de un worker de claude (el `contrato` de `armar_llamada`). */
export function contratoClaude(pa: Pa, c: Corrida): string {
  let k = c.jefe ? `${CONTRATO}\n${conJefe(c.jefe)}` : `${CONTRATO}\n${SIN_JEFE}`;
  k = conDueno(k, pa.env, pa.home).replace(/\n+$/, "");
  if (!c.leer && c.modeloFlojo) k += `\n${TXT_FLOJO}`;
  if (!c.leer) k += leccionesBloque(path.join(pa.state, c.slug));
  if (c.actualizar) {
    const sha = c.actualizar.shaMain;
    k += `\nEstás en la rama ${c.rama} de un worktree propio (${c.rutaTrabajo}). Tu tarea es rebasearla: \`git rebase ${sha}\` está AUTORIZADO, igual que \`git add <archivo>\`, \`git rebase --continue\` y \`git rebase --abort\`. No cambies a otra rama, no mergees, no toques el tree principal: integra el jefe. Los editores de git están apagados (GIT_EDITOR=true): el mensaje de cada commit queda como estaba.`;
  } else if (c.usaWorktree) {
    k += `\nEstás en la rama ${c.rama} de un worktree propio (${c.rutaTrabajo}), sacada del HEAD del tree principal del proyecto. Commiteá ahí, archivo por archivo. No cambies de rama, no mergees, no toques el tree principal: integra el jefe.`;
  }
  const mapa = path.join(pa.env.PA_MAPA_DIR || path.join(pa.env.XDG_CONFIG_HOME || path.join(pa.home, ".config"), "trama", "mapa"), `${c.slug}.md`);
  if (!c.leer && !c.actualizar && existsSync(mapa) && statSync(mapa).isFile()) {
    k += `\nSi tu cambio modificó lo que este proyecto expone, consume o escribe para OTROS proyectos (CLIs, puertos, archivos compartidos, units), actualizá su bloque del mapa en ${mapa} y poné la fecha de hoy en su \`verificado:\`. Sólo ese archivo: no abras el índice general del mapa (es generado) ni los bloques de otros proyectos. Si no cambió nada de eso, no lo toques.`;
  }
  const paralelos = (c.paralelos ?? "").replace(/\n+$/, "");
  if (!c.leer && paralelos) {
    k += `\nEn este mismo proyecto están corriendo AHORA otros workers, cada uno en su worktree y su rama:\n${paralelos}\nComparten con vos el target de cargo, node_modules/.venv y lo que corra en la máquina (puertos, bases locales). No mates procesos que no lanzaste vos. Un puerto ocupado o un "Blocking waiting for file lock" de cargo puede ser el otro: esperá y reintentá, no lo 'arregles'. No instales ni saques dependencias (un hook lo bloquea): si hace falta, decilo en DECISION. No coordines con ellos ni toques sus ramas: si tocan lo mismo, se resuelve al integrar.`;
  }
  if (c.leer) k += `\n${TXT_LEER}`;
  if (pa.plan === "pro") k += `\n${TXT_PRO}`;
  if (pa.plan !== "pro" && !c.leer) k += `\n${TXT_ABANICO}`;
  return k;
}

/** El nombre con el que el jefe le escribe al worker: `pa/<slug>`, `pa/<slug>@k`, `pa/<slug>@aca`. */
export const nombreWorker = (c: Pick<Corrida, "slug" | "leer" | "puesto">) => `pa/${c.slug}${c.leer ? "" : sufPuesto(c.puesto)}`;

/** Lo que el plan agrega al final de los dos argv (corrida y cierre). */
const mcpApagado = ["--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}'];

/** El argv de `claude` para la corrida (el `args` de `armar_llamada`). */
export function argsClaude(pa: Pa, c: Corrida, o: { contrato: string; settings: string; nombre: string }): string[] {
  let prompt = c.tarea;
  if (!c.resume && c.ficha) prompt += `\n\nDónde quedó este proyecto:\n${c.ficha}`;
  const a = ["-p", prompt, "--model", c.modelo];
  if (c.esfuerzo) a.push("--effort", c.esfuerzo);
  a.push("--output-format", "json", "--append-system-prompt", o.contrato, "--permission-mode", "bypassPermissions");
  if (c.autocompact) a.push("--autocompact", c.autocompact);
  a.push("--settings", o.settings, "--name", o.nombre);
  if (!c.conMcp) a.push(...mcpApagado);
  if (c.leer) a.push("--tools", "Read,Grep,Glob,Bash,ToolSearch,ListAgents,SendMessage");
  if (!c.leer && pa.plan === "pro") a.push("--disallowedTools", "Agent");
  if (c.maxTurns) a.push("--max-turns", c.maxTurns);
  if (c.maxBudget) a.push("--max-budget-usd", c.maxBudget);
  if (c.resume) a.push("--resume", c.sid);
  else a.push("--session-id", c.sid);
  return a;
}

/** El argv del auto-cierre de una corrida que se quedó sin turnos: un resume corto con CIERRE_TAREA. */
export function argsCierre(pa: Pa, c: Corrida, o: { contrato: string; settings: string; nombre: string; sid: string }): string[] {
  const a = ["-p", CIERRE_TAREA, "--model", c.modelo];
  if (c.esfuerzo) a.push("--effort", c.esfuerzo);
  a.push("--output-format", "json", "--append-system-prompt", o.contrato, "--permission-mode", "bypassPermissions");
  if (c.autocompact) a.push("--autocompact", c.autocompact);
  a.push("--settings", o.settings, "--name", o.nombre, "--resume", o.sid, "--max-turns", String(CIERRE_TURNOS));
  if (!c.conMcp) a.push(...mcpApagado);
  if (pa.plan === "pro") a.push("--disallowedTools", "Agent");
  if (c.maxBudget) a.push("--max-budget-usd", c.maxBudget);
  return a;
}

/** El env de más para el claude según el plan y el tope de turnos (los `export PA_RECORTE / PA_MAX_TURNS` del bash). */
export function envDeLaLlamada(pa: Pa, c: Corrida): Env {
  const e: Env = { PA_RECORTE: pa.plan === "pro" ? pa.env.PA_RECORTE || "150" : "0" };
  if (c.maxTurns) e.PA_MAX_TURNS = c.maxTurns;
  return e;
}

/** Arma todo lo de la llamada: settings, contrato, nombre, argv y rutas. No escribe nada. */
export function armarLanzamiento(pa: Pa, c: Corrida, o: OpcionesLanzar = {}): Lanzamiento {
  const dir = path.join(pa.state, c.slug);
  const { run, hb } = rastroDe(pa, c);
  const settings = settingsWorker(pa, { hb, leer: c.leer, espejo: c.espejo, variante: o.hooks?.variante, node: o.hooks?.node });
  const contrato = contratoClaude(pa, c);
  const nombre = nombreWorker(c);
  return {
    pa,
    c,
    dir,
    out: path.join(dir, `${c.ts}.json`),
    err: path.join(dir, `${c.ts}.err`),
    run,
    hb,
    sfile: path.join(pa.state, `${c.slug}.session`),
    ult: path.join(pa.state, `${c.slug}.ultimo`),
    transcript: path.join(carpetaProyectos(pa), escapar(c.rutaTrabajo), `${c.sid}.jsonl`),
    settings,
    contrato,
    nombreWorker: nombre,
    args: argsClaude(pa, c, { contrato, settings, nombre }),
    envClaude: envDeLaLlamada(pa, c),
    inicio: 0,
    hijo: null,
    jsonPrevio: "",
    eventoInicio: false,
  };
}

// ---------------------------------------------------------------- rastro en disco

const plano = (s: string) => s.split("\n").join(" ");
const ahoraS = () => Math.floor(Date.now() / 1000);

/** `evento`: una línea en eventos.jsonl (inicio, fin…). Nunca rompe a pa. */
export async function evento(pa: Pa, tipo: string, id: string, proyecto: string, rc?: number | string): Promise<void> {
  const e: Record<string, unknown> = { version: 1, ts: ahoraS(), tipo, id, proyecto };
  if (rc !== undefined && rc !== "") e.rc = typeof rc === "number" ? rc : Number.isFinite(Number(rc)) && /^-?[0-9.eE+]+$/.test(rc) ? Number(rc) : rc;
  try {
    await agregarLinea(path.join(pa.state, "eventos.jsonl"), JSON.stringify(e));
  } catch {
    /* nunca rompe a pa */
  }
}

/** `hilo_poner`: pone (o reemplaza) `campo=valor` en el `.hilo`, aplanado a una línea, bajo lock. */
export async function hiloPoner(dir: string, id: string, campo: string, valor: string): Promise<void> {
  const h = path.join(dir, `${id}.hilo`);
  const lock = await tomar(h, { esperarMs: 10_000 }).catch(() => null);
  try {
    let ls: string[] = [];
    try {
      ls = readFileSync(h, "utf8").split("\n");
      if (ls[ls.length - 1] === "") ls.pop();
    } catch {
      /* lo crea */
    }
    ls = ls.filter((l) => !l.startsWith(`${campo}=`));
    ls.push(`${campo}=${plano(valor)}`);
    writeFileSync(h, ls.join("\n") + "\n");
  } catch {
    /* nunca rompe a pa */
  } finally {
    await lock?.liberar().catch(() => {});
  }
}

/** `anotar_fin`: la hora en que pa vio terminar la corrida (no pisa una ya escrita). */
export async function anotarFin(dir: string, id: string): Promise<void> {
  if (!id || !(existsSync(path.join(dir, `${id}.hilo`)) || existsSync(path.join(dir, `${id}.pid`)))) return;
  if (leerCampo(path.join(dir, `${id}.hilo`), "fin")) return;
  await hiloPoner(dir, id, "fin", String(ahoraS()));
}

/** `anotar_decision`: DECISION, decision_nada, SIGUE y verificado en el `.hilo` (y `verificado` en el `.json`). */
export async function anotarDecision(l: Lanzamiento): Promise<{ decision: string; sigue: string }> {
  let res = "";
  try {
    if (statSync(l.out).size > 0) res = textoResultado(leerSalida(l.out));
  } catch {
    res = "";
  }
  const d = decisionDe(res);
  const s = sigueDe(res);
  await hiloPoner(l.dir, l.c.ts, "decision", d);
  let decision = "";
  if (decisionEsNada(d)) await hiloPoner(l.dir, l.c.ts, "decision_nada", "1");
  else {
    await hiloPoner(l.dir, l.c.ts, "decision_nada", "0");
    decision = decisionDe(res, true);
  }
  await hiloPoner(l.dir, l.c.ts, "sigue", s);
  const sigue = s && !decisionEsNada(s) ? s : "";
  if (!l.c.leer && res.includes("RESULTADO:")) {
    const vv = verificadoDe(res);
    await hiloPoner(l.dir, l.c.ts, "verificado", vv ? "1" : "0");
    const j = leerSalida(l.out);
    if (j) {
      try {
        await escribirAtomico(l.out, JSON.stringify({ ...j, verificado: vv }, null, 2) + "\n");
      } catch {
        /* como el `|| rm -f tmp` */
      }
    }
  }
  return { decision, sigue };
}

/** El `.hilo` de la corrida (si no existe): el registro durable que lee la app. */
export function escribirHilo(l: Lanzamiento): void {
  const f = path.join(l.dir, `${l.c.ts}.hilo`);
  if (existsSync(f)) return;
  const c = l.c;
  const campos: [string, string][] = [
    ["tarea", plano(c.tareaJefe)],
    ["modelo", c.modelo],
    ["effort", c.esfuerzo || c.efVacio || "settings"],
    ["inicio", String(l.inicio)],
    ["proyecto", c.slug],
    ["ruta_trabajo", c.rutaTrabajo],
    ["rama", c.rama],
    ["origen", c.origen],
    ["leer", c.leer ? "1" : "0"],
    ["puesto", c.puesto],
    ["lanzo", c.lanzo],
    ["jefe", c.jefe],
    ["jefe_id", c.jefeId],
    ["tipo", c.tipo ?? ""],
    ["cuenta", c.cuenta],
    ["fase", c.fase ?? ""],
    ["tarea_id", c.tareaId ?? ""],
    ["rubrica", c.rubrica ?? ""],
    ["subtarea", c.subtarea ?? ""],
  ];
  try {
    writeFileSync(f, campos.map(([k, v]) => `${k}=${v}\n`).join(""));
  } catch {
    /* `2>/dev/null || true` */
  }
}

/** `escribir_running`: quién labura (pid = el CLAUDE, no pa), desde cuándo y dónde escribe. Lo lee `workers`. */
export function escribirRunning(l: Lanzamiento): void {
  const c = l.c;
  const campos: [string, string][] = [
    ["pid", l.hijo ? String(l.hijo) : ""],
    ["pa_pid", String(process.pid)],
    ["inicio", String(l.inicio)],
    ["proyecto", c.slug],
    ["id", c.ts],
    ["ruta", c.ruta],
    ["ruta_trabajo", c.rutaTrabajo],
    ["rama", c.rama],
    ["modelo", c.modelo],
    ["cuenta", c.cuenta],
    ["leer", c.leer ? "1" : "0"],
    ["jefe", c.jefe],
    ["jefe_id", c.jefeId],
    ["puesto", c.puesto],
    ["salida", l.out],
    ["sid", c.sid],
    ["transcript", l.transcript],
    ["tarea", plano(c.tarea)],
  ];
  writeFileSync(l.run, campos.map(([k, v]) => `${k}=${v}\n`).join(""));
}

/** `.sid` y `.corrida` de la corrida (el .corrida sólo si no existe: un resume ya tiene el suyo). */
export function escribirCorrida(l: Lanzamiento): void {
  const c = l.c;
  mkdirSync(l.dir, { recursive: true });
  writeFileSync(path.join(l.dir, `${c.ts}.sid`), c.sid);
  const f = path.join(l.dir, `${c.ts}.corrida`);
  if (existsSync(f)) return;
  writeFileSync(
    f,
    `ruta_trabajo=${c.rutaTrabajo}\nrama=${c.rama}\nbase=${c.base}\nproyecto=${c.proyecto}\norigen=${c.origen}\nleer=${c.leer ? 1 : 0}\npuesto=${c.puesto}\njefe=${c.jefe}\njefe_id=${c.jefeId}\n`,
  );
}

/** `guardar_sesion`: el casillero `<slug>.session` (+ `.ts`) para `--seguir`; un --leer no lo toca. */
export function guardarSesion(l: Lanzamiento, sid: string): void {
  if (l.c.leer) return;
  writeFileSync(l.sfile, sid);
  writeFileSync(`${l.sfile}.ts`, l.c.ts);
}

// ---------------------------------------------------------------- correr

/** El env del claude: el de pa, más PA_WORKER y los editores de git apagados, más la cuenta (sólo en este proceso). */
export function entornoClaude(l: Lanzamiento): Env {
  const e: Env = { ...l.pa.env, ...l.envClaude, PA_WORKER: "1", GIT_EDITOR: "true", GIT_SEQUENCE_EDITOR: "true" };
  for (const k of l.c.cuentaEnv?.quitar ?? []) delete e[k];
  Object.assign(e, l.c.cuentaEnv?.poner ?? {});
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return e;
}

const NUM_SENAL: Record<string, number> = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 };

/** Corre el claude con `l.args` en el worktree, stdout a `<ts>.json` y stderr a `<ts>.err`. Devuelve el código (127 si no se pudo lanzar). */
export function correrClaude(l: Lanzamiento, o: { claude?: string; alArrancar?: (pid: number) => void } = {}): Promise<number> {
  const env = entornoClaude(l);
  const bin = o.claude ?? enPath("claude", [], env, l.pa.plat) ?? "claude";
  const fo = openSync(l.out, "w");
  const fe = openSync(l.err, "w");
  return new Promise((resolve) => {
    let listo = false;
    const fin = (rc: number) => {
      if (listo) return;
      listo = true;
      resolve(rc);
    };
    try {
      const h = spawn(bin, l.args, { cwd: l.c.rutaTrabajo, env: env as NodeJS.ProcessEnv, stdio: ["ignore", fo, fe], windowsHide: true });
      h.on("error", (e) => {
        try {
          writeFileSync(l.err, `pa: no pude lanzar ${bin}: ${e.message}\n`, { flag: "a" });
        } catch {
          /* nada */
        }
        fin(127);
      });
      h.on("exit", (code, sig) => fin(code ?? 128 + (sig ? (NUM_SENAL[sig] ?? 0) : 0)));
      if (h.pid) o.alArrancar?.(h.pid);
    } catch (e) {
      try {
        writeFileSync(l.err, `pa: no pude lanzar ${bin}: ${(e as Error).message}\n`, { flag: "a" });
      } catch {
        /* nada */
      }
      fin(127);
    } finally {
      closeSync(fo);
      closeSync(fe);
    }
  });
}

// ---------------------------------------------------------------- claude roto

/** `es_claude_roto`: el error de una instalación rota (auto-update a medias, binario que no está). */
export const esClaudeRoto = (t: string) =>
  t.includes("native binary not installed") || t.includes("claude: not found") || t.includes("claude: No such file") || t.includes("failed to run command 'claude'");

export const CLAUDE_ARREGLO = "node ~/.local/lib/node_modules/@anthropic-ai/claude-code/install.cjs";

/** `claude_rc`: 84 si claude existe pero no está en el PATH de este proceso, 81 si está roto. */
export function claudeRc(pa: Pa): 81 | 84 {
  const conocido = pa.env.CLAUDE_CONOCIDO || path.join(pa.home, ".local", "bin", "claude");
  return !enPath("claude", [], pa.env, pa.plat) && esEjecutable(conocido, pa.plat) ? 84 : 81;
}

/** `claude_falla`: el mensaje de 81 (roto) u 84 (fuera del PATH). */
export function claudeFalla(pa: Pa, rc: 81 | 84, error: string): string {
  const conocido = pa.env.CLAUDE_CONOCIDO || path.join(pa.home, ".local", "bin", "claude");
  if (rc === 84) {
    return (
      `pa: claude no está en el PATH de este proceso (PATH=${pa.env.PATH ?? ""}). No está roto: existe en ${conocido}.\n` +
      `pa: agregá ${path.dirname(conocido)} al PATH del servicio/timer/cron que llama a pa. NO hace falta reinstalar claude.\n`
    );
  }
  let s = "pa: la instalación de claude está ROTA. No es un fallo del worker ni del proyecto.\n";
  if (error)
    s += error
      .split("\n")
      .filter((x) => x !== "")
      .slice(0, 6)
      .map((x) => `    ${x}\n`)
      .join("");
  s += `pa: si fue un auto-update ("native binary not installed"), se arregla con:\n    ${CLAUDE_ARREGLO}\npa: no relances workers hasta que \`claude --version\` ande.\n`;
  return s;
}

// ---------------------------------------------------------------- al salir

/**
 * `al_salir` (el trap de EXIT): fin en el .hilo, medir, estado de la tarea, DECISION/SIGUE, build del puesto, `.ultimo` (si
 * tenemos el lock) y `.listo` (si es async), borra el rastro vivo, suelta el puesto, tablero y el evento `fin`. Nunca tira.
 */
export async function alSalir(l: Lanzamiento, rc: number, g: Ganchos = {}): Promise<void> {
  const nunca = async (f: () => Promise<unknown> | unknown) => {
    try {
      await f();
    } catch {
      /* `|| true` */
    }
  };
  const { pa, c } = l;
  await nunca(() => anotarFin(l.dir, c.ts));
  const hayOut = Boolean(l.out);
  if (hayOut && g.medir) await nunca(() => g.medir!(l.out, l));
  if (hayOut && c.tareaId && g.anotarEstado) await nunca(() => g.anotarEstado!(rc, l));
  if (hayOut) await nunca(() => anotarDecision(l));
  if (c.tengoLock && c.usaWorktree) await nunca(() => limpiarBuild(c.rutaTrabajo, pa.state, pa.env));
  const linea = `salida=${l.out}\nrc=${rc}\nsid=${c.sid}\n`;
  const listo = path.join(l.dir, `${c.ts}.listo`);
  if (c.tengoLock) {
    await nunca(() => escribirAtomico(l.ult, linea));
    if (c.async) await nunca(() => escribirAtomico(listo, linea));
  } else if (c.leer && c.async) {
    await nunca(() => escribirAtomico(listo, linea));
  }
  for (const f of [l.run, l.hb, `${l.hb}.turnos`]) await nunca(() => rmSync(f, { force: true }));
  if (g.soltar) await nunca(() => g.soltar!());
  if (hayOut && g.anotarTablero) await nunca(() => g.anotarTablero!(l));
  if (l.eventoInicio) await evento(pa, "fin", c.ts, c.slug, rc);
}

// ---------------------------------------------------------------- lanzar

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Lanza el worker y lo lleva hasta el final: escribe el rastro, corre al claude, clasifica cómo terminó, muestra el resultado y
 * cierra (al_salir). Devuelve el código de salida de `pa` (el contrato: 0, 1, 76, 77, 78, 81, 84, 130). Lo que el bash manda a
 * stdout/stderr sale por `pa.io`.
 */
export async function lanzarClaude(pa: Pa, c: Corrida, o: OpcionesLanzar = {}): Promise<number> {
  const g = o.ganchos ?? {};
  const l = armarLanzamiento(pa, c, o);
  const { io } = pa;
  rmSync(`${l.hb}.turnos`, { force: true });
  escribirCorrida(l);
  l.inicio = ahoraS();
  escribirHilo(l);
  escribirRunning(l);
  await evento(pa, "inicio", c.ts, c.slug);
  l.eventoInicio = true;

  // TERM/INT (o el pedido de cierre del canal de control): bajar al claude con nosotros y salir 130.
  let matado = false;
  const matar = () => {
    if (matado) return;
    matado = true;
    if (l.hijo) {
      try {
        matarArbol(l.hijo, "SIGTERM", { plat: pa.plat });
      } catch {
        /* ya no estaba */
      }
    }
  };
  const escuchar = o.senalesProceso ?? pa.plat !== "win32";
  if (escuchar) {
    process.on("SIGTERM", matar);
    process.on("SIGINT", matar);
  }
  o.senal?.addEventListener("abort", matar);
  if (o.senal?.aborted) matar();

  const correr = async (): Promise<number> => {
    if (matado) return 130;
    const rc = await correrClaude(l, {
      claude: o.claude,
      alArrancar: (pid) => {
        l.hijo = pid;
        escribirRunning(l);
        if (matado) matar();
      },
    });
    l.hijo = null;
    return rc;
  };

  const salir = async (rc: number) => {
    if (escuchar) {
      process.off("SIGTERM", matar);
      process.off("SIGINT", matar);
    }
    o.senal?.removeEventListener("abort", matar);
    await alSalir(l, rc, g);
    return rc;
  };

  const res = () => textoResultado(leerSalida(l.out));
  const esError = () => leerSalida(l.out)?.is_error === true;
  const fallo = (rc: number) => rc !== 0 || esError();
  const leerErr = () => {
    try {
      return readFileSync(l.err, "utf8");
    } catch {
      return "";
    }
  };
  const proj = carpetaProyectos(pa);
  const delta = () => deltaSucios(c.rutaTrabajo, c.baseDelta, l.inicio, pa.state, pa.env);
  const conPa = (msg: string) =>
    msg
      .split("\n")
      .filter((x, i, a) => x !== "" || i < a.length - 1)
      .map((x) => `pa: ${x}\n`)
      .join("");

  let rc = await correr();
  if (matado) {
    io.err(`pa: matado; el worker de '${c.slug}' también.\n`);
    return salir(130);
  }

  // sin cupo al arrancar: lo decide quien tenga reparto (hasta 3 veces)
  for (let i = 1; i <= 3 && g.relanzarPorCupo && fallo(rc); i++) {
    if (!(await g.relanzarPorCupo(l, i))) break;
    l.args = argsClaude(pa, l.c, { contrato: l.contrato, settings: l.settings, nombre: l.nombreWorker });
    escribirRunning(l);
    rc = await correr();
  }

  if (fallo(rc)) {
    const texto = res();
    // 1. límite de sesión de la suscripción: no se arregla reintentando.
    if (texto.includes("session limit")) {
      const hasta = epochReset(texto, pa.env);
      if (hasta !== null) {
        try {
          writeFileSync(limiteDe(pa, c.cuenta), String(hasta));
        } catch {
          /* nada */
        }
        io.err(`pa: límite de sesión de la suscripción. Se libera ${horaMinuto(hasta, pa.env.TZ)}. Sesión de '${c.slug}' INTACTA.\n`);
      } else {
        io.err(`pa: límite de sesión de la suscripción (no pude parsear la hora de reset). Sesión de '${c.slug}' INTACTA.\n`);
      }
      io.err(`${texto}\n`);
      return salir(76);
    }
    // 2. 529: server-side y temporal. Un reintento, con el MISMO sid.
    if (texto.includes("529") || texto.includes("Overloaded")) {
      io.err("pa: API sobrecargada (529). Reintento único en 60s…\n");
      await dormir(o.espera529Ms ?? 60_000);
      rc = await correr();
      if (fallo(rc)) {
        io.err(`pa: sigue sobrecargada. Sesión de '${c.slug}' INTACTA, reintentá más tarde.\n`);
        io.err(`${res()}\n`);
        return salir(77);
      }
    }
  }

  // 3. la sesión guardada ya no existe: el ÚNICO caso donde relanzar limpio es correcto.
  if (fallo(rc) && c.resume && leerErr().includes("No conversation found with session ID")) {
    io.err(`pa: la sesión guardada de '${c.slug}' ya no existe; arranco una limpia.\n`);
    if (!c.leer) rmSync(l.sfile, { force: true });
    c.resume = false;
    c.sid = randomUUID();
    l.transcript = path.join(proj, escapar(c.rutaTrabajo), `${c.sid}.jsonl`);
    const i = l.args.indexOf("--resume");
    if (i >= 0) l.args.splice(i, 2, "--session-id", c.sid);
    escribirRunning(l);
    rc = await correr();
  }

  // 3b. se quedó sin turnos: auto-cierre con un resume corto, y si no, 78.
  if (campoJson(leerSalida(l.out), "subtype") === "error_max_turns") {
    const nuevoSid = campoJson(leerSalida(l.out), "session_id");
    if (nuevoSid) guardarSesion(l, nuevoSid);
    io.err(`${res()}\n`);
    io.err(statsResultado(leerSalida(l.out), proj));
    io.err(`pa: el worker de '${c.slug}' se quedó sin turnos (tope ${c.maxTurns || "?"}).\n`);
    if (nuevoSid && !pa.env.PA_CIERRE && !c.leer) {
      io.err(`pa: lo cierro solo (resume de hasta ${CIERRE_TURNOS} turnos)…\n`);
      const previo = path.join(l.dir, `${c.ts}.sin-turnos.json`);
      try {
        writeFileSync(previo, readFileSync(l.out));
      } catch {
        /* nada */
      }
      l.jsonPrevio = previo;
      l.args = argsCierre(pa, c, { contrato: l.contrato, settings: l.settings, nombre: l.nombreWorker, sid: nuevoSid });
      l.envClaude = { ...l.envClaude, PA_MAX_TURNS: String(CIERRE_TURNOS), PA_CIERRE: "1" };
      rmSync(`${l.hb}.turnos`, { force: true });
      rc = await correr();
      if (!fallo(rc) && res().includes("RESULTADO:")) {
        io.err("pa: cerrado. (El worker se había quedado sin turnos; esto es el resultado del cierre.)\n");
        io.out(await mostrarResultado(l.out, { proj, env: pa.env, solapamiento: g.solapamiento }));
        const s2 = campoJson(leerSalida(l.out), "session_id");
        if (s2) guardarSesion(l, s2);
        io.err(conPa((await delta()).msg));
        return salir(0);
      }
      io.err("pa: el cierre automático tampoco terminó bien.\n");
    }
    io.err(conPa((await delta()).msg));
    io.err(`pa: para cerrarlo a mano: pa '${c.proyecto}' --seguir --id ${c.ts} 'commiteá lo que hiciste y reportá'.\n`);
    return salir(78);
  }

  // 3c. la instalación de claude se rompió: código propio y el arreglo escrito.
  if (fallo(rc) && (rc === 127 || esClaudeRoto(leerErr()))) {
    const rcC = claudeRc(pa);
    io.err(claudeFalla(pa, rcC, leerErr()));
    return salir(rcC);
  }

  // 4. cualquier otro fallo: el motivo de verdad (.result), sin tocar la sesión guardada.
  if (fallo(rc)) {
    io.err(`pa: el worker de '${c.slug}' falló.\n`);
    const texto = res();
    if (texto) io.err(`${texto}\n`);
    else {
      const ls = leerErr().split("\n");
      if (ls[ls.length - 1] === "") ls.pop();
      io.err(ls.slice(-20).map((x) => `${x}\n`).join(""));
    }
    return salir(1);
  }

  // --- salida
  io.out(await mostrarResultado(l.out, { proj, env: pa.env, solapamiento: g.solapamiento }));
  const nuevoSid = campoJson(leerSalida(l.out), "session_id");
  if (nuevoSid) guardarSesion(l, nuevoSid);

  if (!res().includes("RESULTADO:")) {
    io.err(`pa: el worker de '${c.slug}' terminó SIN el bloque RESULTADO (arriba está lo que dijo).\n`);
    const d = await delta();
    const msg = d.msg.replace(/\n$/, "");
    if (d.hay) io.err(`pa: ${msg} Cerralo con: pa '${c.proyecto}' --seguir --id ${c.ts} 'commiteá lo que hiciste y reportá'.\n`);
    else io.err(`pa: ${msg} No hay nada que cerrar. Si te mandó el resultado por SendMessage, ése es el bueno; si no, pedíselo con: pa '${c.proyecto}' --seguir --id ${c.ts} 'reportá lo que hiciste'.\n`);
    return salir(78);
  }

  if (c.resume && c.edadH != null && c.edadH >= 24) io.out(`— (retomaste una sesión de hace ${c.edadH}h; sin --seguir arranca limpia y pesa menos)\n`);
  return salir(0);
}
