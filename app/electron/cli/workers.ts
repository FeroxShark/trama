// workers — ver los Claude que están trabajando ahora y espiarles el chat en vivo. Port a TypeScript de motor/bin/workers
// (misma CLI, misma salida; lee los mismos rastros que deja `pa`).
//
//   <estado de pa>/<slug>.running    QUIÉN labura, desde cuándo, y en qué archivo escribe
//   <estado de pa>/<slug>.heartbeat  QUÉ herramienta corre AHORA y desde hace cuánto
//
// Las corridas --leer no toman el lock del proyecto, así que puede haber varias a la vez: cada una deja su par propio
// `<slug>.leer-<id>.running` / `<slug>.leer-<id>.heartbeat`. El heartbeat se deriva de la ruta del .running, no del slug.
// El `.running` trae `transcript=` con la ruta exacta del jsonl (pa le pasa a Claude un `--session-id` propio).
//
// Uso: workers [lista|ls] | --json | ver [--todo] [proyecto] | ultimo <proyecto> | abrir [proyecto] | ayuda
import { spawn } from "node:child_process";
import { existsSync, lstatSync, openSync, readFileSync, readSync, closeSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { estadoPa, homeDe } from "../rutas.ts";
import { enPath } from "./base/buscar.ts";
import { git } from "./base/git.ts";
import { esPrincipal } from "./base/principal.ts";
import { vivo as pidVivo } from "./base/proc.ts";
import { resolverProyecto } from "./proyecto-ruta.ts";
import { CON_COLOR, SIN_COLOR, crearFormateador, formatoDe, type Colores, type Formato } from "./workers-formato.ts";

type Env = Record<string, string | undefined>;
export type Io = { out: (s: string) => void; err: (s: string) => void; tty: boolean };

const COLGADO = 600; // segundos sin ningún evento de herramienta => sospechoso
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const AYUDA: string[] = [
  "workers — ver los Claude que están trabajando ahora y espiarles el chat en vivo.",
  "",
  "Existe porque `pa` corre headless: el JSON del worker recién aparece cuando termina, así",
  "que mientras trabaja no se ve nada. `pa` deja dos rastros que este script junta:",
  "",
  "  ~/.local/state/pa/<slug>.running    QUIÉN labura, desde cuándo, y en qué archivo escribe",
  "  ~/.local/state/pa/<slug>.heartbeat  QUÉ herramienta corre AHORA y desde hace cuánto",
  "",
  "Las corridas --leer no toman el lock del proyecto, así que puede haber varias a la vez (y",
  "con un worker que escribe): cada una deja su par propio `<slug>.leer-<id>.running` /",
  "`<slug>.leer-<id>.heartbeat`. Por eso el heartbeat se deriva de la ruta del .running, no del slug.",
  "",
  "El `.running` trae `transcript=` con la ruta exacta del jsonl, porque `pa` le pasa a Claude",
  "un `--session-id` propio: la ruta se conoce antes de arrancar. Antes había que adivinarla",
  "(el jsonl más nuevo del cwd, o el del sid guardado) y cualquier otra sesión abierta en esa",
  "carpeta le ganaba al worker.",
  "",
  "El `.heartbeat` lo escribe un hook en cada PreToolUse/PostToolUse. Es lo que arregla el",
  "problema real: sin la EDAD del último paso, \"compilando hace 4 minutos\" y \"colgado hace 22\"",
  "se veían idénticos en la lista.",
  "",
  "Uso:",
  "  workers                    qué hay corriendo ahora (pa + subagentes)",
  "  workers --json             lo mismo que el default, en JSON (sólo workers vivos; sin huérfanos",
  "                             ni sesiones guardadas), para que otro script lo consuma sin parsear texto",
  "  workers ver [proyecto]     seguir el chat en vivo (sin proyecto: si hay uno solo, ese)",
  "  workers ver --todo <proy>  igual pero desde el principio de la conversación",
  "  workers ultimo <proyecto>  releer el chat del último worker que terminó",
  "  workers abrir [proyecto]   lo mismo que `ver` pero en una ventana de terminal aparte ($TERMINAL, o la que haya)",
];

export type Contexto = {
  estado: string;
  proyectos: string; // ~/.claude/projects
  env: Env;
  c: Colores;
  io: Io;
  /** Epoch en segundos; inyectable para los tests. */
  ahora: () => number;
};

export function contextoDe(env: Env, io: Io, ahora = () => Math.floor(Date.now() / 1000)): Contexto {
  return { estado: estadoPa(env), proyectos: path.join(homeDe(env), ".claude", "projects"), env, c: io.tty ? CON_COLOR : SIN_COLOR, io, ahora };
}

// ------------------------------------------------------------------------------------------------ utilidades

/** Campos `clave=valor` de un .running/.heartbeat/.corrida/.hilo: el primero que haya de cada clave (`sed -n "s/^k=//p" | head -1`). */
export function leerCampos(archivo: string): (k: string) => string {
  let lineas: string[] = [];
  try {
    lineas = readFileSync(archivo, "utf8").split("\n");
  } catch {
    /* sin archivo: todos vacíos */
  }
  return (k) => {
    const pre = `${k}=`;
    const l = lineas.find((x) => x.startsWith(pre));
    return l === undefined ? "" : l.slice(pre.length);
  };
}

const cps = (s: string) => Array.from(s);
const padFin = (s: string, n: number) => s + " ".repeat(Math.max(0, n - cps(s).length)); // %-Ns
const padIni = (s: string, n: number) => " ".repeat(Math.max(0, n - cps(s).length)) + s; // %Ns
const recortar = (s: string, n: number) => cps(s).slice(0, n).join(""); // %.Ns
const entero = (s: string) => (/^\s*-?\d+\s*$/.test(s) ? Number(s) : 0);

/** `s` segundos como «42s», «3m05s» o «1h02m». */
export function transcurrido(ahora: number, inicio: number): string {
  let s = ahora - inicio;
  if (s < 0) s = 0;
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

/** El pid del `.running` es el del CLAUDE, no el de `pa`; vacío = el .running de antes del fork: vale el pid de pa. */
function pidDe(f: (k: string) => string): string {
  return f("pid") || f("pa_pid");
}
function estaVivo(f: (k: string) => string): boolean {
  const p = pidDe(f);
  return /^\d+$/.test(p) && pidVivo(Number(p));
}

const escapar = (s: string) => s.replace(/[^A-Za-z0-9]/g, "-");

const archivosCon = (dir: string, sufijo: string): string[] => {
  try {
    return readdirSync(dir).filter((n) => n.endsWith(sufijo) && !n.startsWith(".")).sort().map((n) => path.join(dir, n));
  } catch {
    return [];
  }
};

/** `ls -t` (más nuevo primero; empate por nombre). */
function porFechaDesc(archivos: string[]): string[] {
  return archivos
    .map((a) => {
      try {
        return { a, t: statSync(a, { bigint: true }).mtimeNs };
      } catch {
        return null;
      }
    })
    .filter((x): x is { a: string; t: bigint } => x !== null)
    .sort((x, y) => (x.t === y.t ? (x.a < y.a ? -1 : 1) : x.t > y.t ? -1 : 1))
    .map((x) => x.a);
}

// ------------------------------------------------------------------------------------------------ listar

/** Una línea con qué está haciendo el worker AHORA, sacada del latido (nada de abrir el transcript). */
export function estadoLatido(archivo: string, x: Contexto): string {
  const { D, R, C_TOOL, C_TXT, C_WARN } = x.c;
  if (!existsSync(archivo)) return `${D}(arrancando, sin herramientas todavía)${R}`;
  const f = leerCampos(archivo);
  const ep = entero(f("epoch"));
  const tool = f("tool");
  const desc = f("desc");
  const edad = x.ahora() - ep;
  if (f("envuelo") === "1") return `${C_TOOL}${tool}${R} ${D}${recortar(desc, 60)}${R} ${edad > COLGADO ? C_WARN : ""}en curso hace ${transcurrido(x.ahora(), ep)}${R}`;
  if (edad > COLGADO) return `${C_WARN}sin eventos hace ${transcurrido(x.ahora(), ep)}, nada en vuelo (¿colgado? ¿esperando la API?)${R}`;
  return `${C_TXT}pensando${R} ${D}(último: ${tool} ${recortar(desc, 40)}, hace ${transcurrido(x.ahora(), ep)})${R}`;
}

/** « ·puesto 2» / « ·tree principal» para un writer; nada para un --leer. */
function etiquetaPuesto(f: (k: string) => string): string {
  if (f("leer") === "1") return "";
  const p = f("puesto");
  return p === "aca" ? " ·tree principal" : ` ·puesto ${p || "1"}`;
}

/** Último paso de un transcript, para los subagentes (que no dejan latido). */
export function ultimoPaso(archivo: string): string {
  let texto = "";
  try {
    const st = statSync(archivo);
    const max = 8 << 20;
    const fd = openSync(archivo, "r");
    try {
      const n = Math.min(st.size, max);
      const b = Buffer.alloc(n);
      readSync(fd, b, 0, n, st.size - n);
      texto = b.toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return "";
  }
  const lineas = texto.split("\n");
  if (lineas[lineas.length - 1] === "") lineas.pop();
  const ultimas = lineas.slice(-80).reverse();
  try {
    for (const l of ultimas) {
      const e: unknown = JSON.parse(l);
      if (typeof e !== "object" || e === null || Array.isArray(e)) throw new Error("tipo");
      const ev = e as Record<string, unknown>;
      if (ev.type !== "assistant") continue;
      const msg = ev.message as Record<string, unknown> | null | undefined;
      const cont = msg && typeof msg === "object" ? msg.content : null;
      if (!Array.isArray(cont)) continue;
      for (const b of cont) {
        if (typeof b !== "object" || b === null || Array.isArray(b)) throw new Error("tipo");
        const bl = b as Record<string, unknown>;
        let salida: string | null = null;
        if (bl.type === "tool_use") {
          const inp = bl.input && typeof bl.input === "object" && !Array.isArray(bl.input) ? (bl.input as Record<string, unknown>) : {};
          const d = [inp.description, inp.command, inp.file_path].find((v) => v !== null && v !== undefined && v !== false) ?? "";
          salida = `${typeof bl.name === "string" ? bl.name : JSON.stringify(bl.name ?? null)} ${typeof d === "string" ? d : JSON.stringify(d)}`;
        } else if (bl.type === "text") {
          if (typeof bl.text !== "string") throw new Error("tipo");
          salida = bl.text.replace(/\n/g, " ");
        }
        if (salida !== null) return recortar(salida.split("\n")[0]!, 70);
      }
    }
  } catch {
    /* jq abortó: queda lo que hubiera salido antes (nada, porque salimos al primero) */
  }
  return "";
}

/** Subagentes de las sesiones interactivas: los que escribieron en los últimos 2 minutos (máx. 8). */
function subagentesActivos(x: Contexto): string[] {
  const res: string[] = [];
  const corte = x.ahora() - 120;
  const caminar = (d: string) => {
    let ents;
    try {
      ents = readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    } catch {
      return;
    }
    for (const e of ents) {
      if (res.length >= 8) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) caminar(p);
      else if (e.isFile() && /[\\/]subagents[\\/]agent-.*\.jsonl$/.test(p)) {
        try {
          if (lstatSync(p).mtimeMs / 1000 > corte) res.push(p);
        } catch {
          /* se fue */
        }
      }
    }
  };
  caminar(x.proyectos);
  return res;
}

export async function listar(x: Contexto): Promise<void> {
  const { D, B, R, C_TOOL, C_OK, C_WARN } = x.c;
  let hubo = false;
  for (const archivo of archivosCon(x.estado, ".running")) {
    const f = leerCampos(archivo);
    const slug = f("proyecto");
    hubo = true;
    if (!estaVivo(f)) {
      x.io.out(`${B}${padFin(slug, 18)}${R} ${C_WARN}HUÉRFANO${R}  (el claude murió; el próximo \`pa ${slug}\` lo limpia solo)\n`);
      continue;
    }
    const leer = f("leer");
    const rama = f("rama");
    const info = `${f("modelo")}${leer === "1" ? ` ·lectura ${f("id")}` : ""}${etiquetaPuesto(f)}${rama ? ` ·${rama}` : ""}`;
    x.io.out(`${B}${padFin(slug, 18)}${R} ${C_OK}${padIni(transcurrido(x.ahora(), entero(f("inicio"))), 7)}${R}  ${D}${info}${R}  ${recortar(f("tarea"), 70)}\n`);
    x.io.out(`   ↳ ${estadoLatido(archivo.replace(/\.running$/, ".heartbeat"), x)}\n`);
  }

  let primero = true;
  for (const s of subagentesActivos(x)) {
    if (primero) {
      x.io.out(`\n${D}subagentes activos${R}\n`);
      primero = false;
      hubo = true;
    }
    x.io.out(`${B}${padFin(recortar(path.basename(s, ".jsonl"), 18), 18)}${R} ${C_TOOL}${ultimoPaso(s)}${R}\n`);
    x.io.out(`   ${D}${s}${R}\n`);
  }
  if (!hubo) x.io.out("no hay workers corriendo.\n");

  // Ramas de workers que nadie integró todavía: el trabajo NO está en main hasta que el jefe corra `pa <proyecto> --integrar <id>`.
  // Cuenta las que tienen commits que le FALTAN al HEAD del tree principal (no las refs vivas). Misma medida que `ramas_sin_integrar` de pa.
  let resumen = "";
  let carpetas: string[] = [];
  try {
    carpetas = readdirSync(x.estado, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name).sort();
  } catch {
    /* sin estado */
  }
  for (const nombre of carpetas) {
    const p = path.join(x.estado, nombre);
    let cnt = 0;
    for (const c of archivosCon(p, ".corrida")) {
      const f = leerCampos(c);
      if (f("origen") !== "") continue;
      const r = f("rama");
      const repo = f("ruta_trabajo");
      if (!r || !repo || !esCarpeta(repo)) continue;
      if ((await git(["-C", repo, "rev-parse", "-q", "--verify", `refs/heads/${r}`])).codigo !== 0) continue;
      const wt = await git(["-C", repo, "worktree", "list", "--porcelain"]);
      const l1 = wt.codigo === 0 ? wt.salida.split("\n")[0]! : "";
      const ppal = l1.startsWith("worktree ") ? l1.slice(9) : "";
      const rl = await git(["-C", ppal || repo, "rev-list", "--count", `HEAD..${r}`]);
      const n = rl.codigo === 0 ? rl.salida.trim() : "0";
      if (/^\d+$/.test(n) && Number(n) > 0) cnt++;
    }
    if (cnt) resumen += ` ${nombre}(${cnt})`;
  }
  if (resumen) x.io.out(`\n${D}ramas sin integrar:${R}${resumen}  (ver: pa <proyecto> --ramas)\n`);
}

function esCarpeta(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Mismos campos que `listar`, en JSON. Sólo workers vivos (nada de huérfanos ni de lo que quedó guardado de una corrida anterior). */
export function listarJson(x: Contexto): void {
  const ahora = x.ahora();
  const objetos: unknown[] = [];
  for (const archivo of archivosCon(x.estado, ".running")) {
    const f = leerCampos(archivo);
    if (!estaVivo(f)) continue;
    const leer = f("leer") === "1";
    // puesto: "1".."N" o "aca" (tree principal) para un writer; null para un --leer
    const puesto = leer ? "" : f("puesto") || "1";
    const hb = archivo.replace(/\.running$/, ".heartbeat");
    let herramienta = "";
    let hace: number | null = null;
    let colgado = false;
    if (existsSync(hb)) {
      const h = leerCampos(hb);
      const edad = ahora - entero(h("epoch"));
      herramienta = h("tool");
      hace = edad;
      colgado = edad > COLGADO;
    }
    const nn = (s: string) => (s === "" ? null : s);
    objetos.push({
      slug: f("proyecto"),
      arranco_hace_s: ahora - entero(f("inicio")),
      tarea: nn(f("tarea")),
      herramienta: nn(herramienta),
      herramienta_hace_s: hace,
      colgado,
      rama: nn(f("rama")),
      leer,
      id: nn(f("id")),
      jefe: f("jefe"),
      puesto: nn(puesto),
      // cuenta: la de la suscripción con la que corre (claude, google o el id de bin/cuentas); null si es un local o un .running viejo
      cuenta: nn(f("cuenta")),
    });
  }
  x.io.out(objetos.length ? JSON.stringify(objetos, null, 2) + "\n" : "[]\n");
}

// ------------------------------------------------------------------------------------------------ ver / ultimo

export type Elegido = { ok: true; archivo: string } | { ok: false; codigo: 1 | 2 };

/** El .running del proyecto (o id de corrida) pedido, o el único que haya. */
export function elegirRunning(pedido: string, x: Contexto): Elegido {
  const encontrados: { archivo: string; f: (k: string) => string }[] = [];
  for (const archivo of archivosCon(x.estado, ".running")) {
    const f = leerCampos(archivo);
    if (!estaVivo(f)) continue;
    if (pedido) {
      if (f("proyecto").includes(pedido.toLowerCase()) || f("id") === pedido) encontrados.push({ archivo, f });
    } else encontrados.push({ archivo, f });
  }
  if (encontrados.length === 0) return { ok: false, codigo: 1 };
  if (encontrados.length === 1) return { ok: true, archivo: encontrados[0]!.archivo };
  if (!pedido) {
    x.io.err("hay varios workers; decí cuál:\n");
    for (const e of encontrados) x.io.err(`  ${e.f("proyecto")}${e.f("leer") === "1" ? `   (lectura, id: ${e.f("id")})` : ""}\n`);
    return { ok: false, codigo: 2 };
  }
  // Un proyecto puede tener al que escribe y varios --leer: `workers ver <proyecto>` mira al que escribe; a un --leer se lo
  // pide por id. Con puestos puede haber VARIOS que escriben: ahí no se elige uno al azar, se pide el id.
  const writers = encontrados.filter((e) => e.f("leer") !== "1");
  if (writers.length > 1) {
    x.io.err(`hay ${writers.length} workers escribiendo en '${pedido}'; decí cuál por id:\n`);
    for (const e of writers) x.io.err(`  workers ver ${e.f("id")}   #${etiquetaPuesto(e.f)} · ${recortar(e.f("tarea"), 60)}\n`);
    return { ok: false, codigo: 2 };
  }
  return { ok: true, archivo: (writers[0] ?? encontrados[0]!).archivo };
}

function primeraLineaDe(archivo: string): string {
  try {
    const fd = openSync(archivo, "r");
    try {
      const b = Buffer.alloc(4096);
      const n = readSync(fd, b, 0, 4096, 0);
      return b.subarray(0, n).toString("utf8").split("\n")[0]!;
    } finally {
      closeSync(fd);
    }
  } catch {
    return "";
  }
}

export async function ver(args: string[], x: Contexto, o: { pollMs?: number; esperaMaxSeg?: number } = {}): Promise<number> {
  const { D, R, C_HEAD } = x.c;
  const todo = args.includes("--todo");
  const resto = args.filter((a) => a !== "--todo");
  const pedido = resto[0] ?? "";
  const el = elegirRunning(pedido, x);
  if (!el.ok) {
    if (el.codigo === 2) return 1;
    x.io.err(`no hay ningún worker corriendo${pedido ? ` para '${pedido}'` : ""}. Probá: workers ultimo ${pedido || "<proyecto>"}\n`);
    return 1;
  }
  const f = leerCampos(el.archivo);
  const slug = f("proyecto");
  const inicio = f("inicio");
  const tr = f("transcript");
  x.io.out(`${C_HEAD}── ${slug} ──${R} ${transcurrido(x.ahora(), entero(inicio))}\n${D}${f("tarea")}${R}\n\n`);

  // La ruta ya la sabemos (pa la fijó con --session-id); sólo hay que esperar que Claude cree el archivo, que tarda un par de segundos.
  if (!tr) {
    x.io.err("este .running es de un pa viejo, sin transcript=. Matalo y relanzá.\n");
    return 1;
  }
  let i = 0;
  while (!existsSync(tr)) {
    if (++i > (o.esperaMaxSeg ?? 30)) {
      x.io.err(`el transcript de '${slug}' no apareció: ${tr}\n`);
      return 1;
    }
    await dormir(1000);
  }

  // El filtro por fecha importa sólo en sesiones retomadas (--seguir), donde el mismo jsonl tiene los turnos de las corridas
  // anteriores. --todo lo saca.
  const formato = formatoDe(f("modelo"), primeraLineaDe(tr));
  let desde = "";
  if (!todo && formato === "claude" && /^\s*-?\d+\s*$/.test(inicio)) {
    const d = new Date(Number(inicio) * 1000);
    if (!Number.isNaN(d.getTime())) desde = d.toISOString().slice(0, 19);
  }
  await seguir(tr, pidDe(f), crearFormateador(formato, x.c, { desde, pensar: x.env.WORKERS_PENSAR === "1" }), x, o.pollMs ?? 200);
  x.io.out(`\n${C_HEAD}── terminó (${transcurrido(x.ahora(), entero(inicio))}) ──${R}\n`);
  return 0;
}

/** `tail -F --pid=<pid> -n +1 archivo | formatear`: desde el principio, siguiendo, hasta que muera el CLAUDE. */
async function seguir(archivo: string, pid: string, fmt: ReturnType<typeof crearFormateador>, x: Contexto, pollMs: number): Promise<void> {
  const dec = new StringDecoder("utf8");
  let pos = 0;
  let pendiente = "";
  const emitir = (ls: string[]) => {
    if (ls.length) x.io.out(ls.map((l) => l + "\n").join(""));
  };
  const leerNuevo = () => {
    let size: number;
    try {
      size = statSync(archivo).size;
    } catch {
      return;
    }
    if (size < pos) pos = 0; // truncado: tail -F lo vuelve a leer desde el principio
    if (size === pos) return;
    const fd = openSync(archivo, "r");
    try {
      const b = Buffer.alloc(size - pos);
      const n = readSync(fd, b, 0, b.length, pos);
      pos += n;
      pendiente += dec.write(b.subarray(0, n));
    } finally {
      closeSync(fd);
    }
    const partes = pendiente.split("\n");
    pendiente = partes.pop()!;
    for (const l of partes) emitir(fmt.linea(l.replace(/\r$/, "")));
  };
  for (;;) {
    leerNuevo();
    if (!(/^\d+$/.test(pid) && pidVivo(Number(pid)))) {
      leerNuevo();
      break;
    }
    await dormir(pollMs);
  }
  pendiente += dec.end();
  if (pendiente) emitir(fmt.linea(pendiente));
  emitir(fmt.fin());
}

export async function ultimo(args: string[], x: Contexto): Promise<number> {
  const { R, C_HEAD, D } = x.c;
  const proy = args[0] ?? "";
  if (!proy) {
    x.io.err("uso: workers ultimo <proyecto>\n");
    return 2;
  }
  const r = resolverProyecto(proy, x.env);
  if (!r.ok) {
    x.io.err(r.mensaje);
    return 1;
  }
  const ruta = r.ruta;
  // Mismo slug que `pa` (slug_de): sin sanear, un proyecto con espacio en la carpeta no encontraba su .session.
  const slug = path.basename(ruta).replace(/[^A-Za-z0-9._-]/g, "-").toLowerCase();
  const dir = path.join(x.proyectos, escapar(ruta));
  let tr = "";

  // Primero el sid que dejó `pa`: identifica el transcript DEL WORKER, no el de cualquier sesión abierta en esa carpeta.
  const sfile = path.join(x.estado, `${slug}.session`);
  try {
    const sid = readFileSync(sfile, "utf8").replace(/\n+$/, "");
    if (existsSync(path.join(dir, `${sid}.jsonl`))) tr = path.join(dir, `${sid}.jsonl`);
  } catch {
    /* sin .session */
  }
  if (!tr) tr = porFechaDesc(archivosCon(dir, ".jsonl"))[0] ?? "";
  // Si el último worker fue de agy, codex, dsh u opencode, su transcript es el stream de pa (no hay jsonl de Claude para él).
  const st = porFechaDesc(archivosCon(path.join(x.estado, slug), ".stream.jsonl"))[0] ?? "";
  if (st && (!tr || statSync(st, { bigint: true }).mtimeNs > statSync(tr, { bigint: true }).mtimeNs)) tr = st;
  if (!tr) {
    x.io.err(`no hay transcripts en ${dir}\n`);
    return 1;
  }
  x.io.out(`${C_HEAD}── ${path.basename(ruta)} ──${R} ${D}${tr}${R}\n`);
  // Si la última corrida que escribió terminó sin VERIFICACION (comando + salida), se dice acá (lo anota pa en el .hilo).
  let uh = "";
  for (const h of porFechaDesc(archivosCon(path.join(x.estado, slug), ".hilo")).slice(0, 20)) {
    if (!readFileSync(h, "utf8").split("\n").includes("leer=1")) {
      uh = h;
      break;
    }
  }
  if (uh && readFileSync(uh, "utf8").split("\n").includes("verificado=0")) {
    x.io.out(`${C_HEAD}sin verificar${R}: el RESULTADO de ${path.basename(uh, ".hilo")} no trae VERIFICACION; no lo des por bueno sin comprobarlo.\n`);
  }
  x.io.out("\n");
  const fmt = crearFormateador(formatoDe("", primeraLineaDe(tr)) as Formato, x.c, { pensar: x.env.WORKERS_PENSAR === "1" });
  const texto = readFileSync(tr, "utf8");
  const lineas = texto.split("\n");
  if (lineas[lineas.length - 1] === "") lineas.pop();
  for (const l of lineas) {
    const sal = fmt.linea(l.replace(/\r$/, ""));
    if (sal.length) x.io.out(sal.map((s) => s + "\n").join(""));
  }
  const fin = fmt.fin();
  if (fin.length) x.io.out(fin.map((s) => s + "\n").join(""));
  return 0;
}

// ------------------------------------------------------------------------------------------------ abrir

/** La terminal para `abrir`: $TERMINAL, o la primera que haya, con los flags previos al comando a correr; null si no hay ninguna. */
export function terminalPara(env: Env, buscar: (n: string) => string | null = (n) => enPath(n, [], env)): string[] | null {
  for (const x of [env.TERMINAL ?? "", "x-terminal-emulator", "gnome-terminal", "konsole", "kitty", "alacritty", "foot", "xterm"]) {
    if (!x) continue;
    const partes = x.split(/\s+/).filter(Boolean); // $TERMINAL puede traer argumentos («alacritty -o x=y»)
    if (!partes.length || !buscar(partes[0]!)) continue;
    const base = path.basename(partes[0]!);
    const flags = base === "kitty" ? ["--class", "workers", "--hold", "--title", "workers"] : base === "gnome-terminal" ? ["--title", "workers", "--"] : base === "foot" ? [] : ["-e"];
    return [...partes, ...flags];
  }
  return null;
}

export function abrir(args: string[], x: Contexto): number {
  const term = terminalPara(x.env);
  if (!term) {
    x.io.err(`no encontré una terminal (probé $TERMINAL, x-terminal-emulator, gnome-terminal, konsole, kitty, alacritty, foot, xterm). Corré: workers ver ${args.join(" ")}\n`);
    return 1;
  }
  const yo = fileURLToPath(import.meta.url); // este mismo programa, esté donde esté instalado
  const hijo = spawn(term[0]!, [...term.slice(1), process.execPath, yo, "ver", ...args], { detached: true, stdio: "ignore", env: x.env as NodeJS.ProcessEnv });
  hijo.on("error", () => {});
  hijo.unref();
  x.io.out("abrí la ventana.\n");
  return 0;
}

// ------------------------------------------------------------------------------------------------ main

export async function main(argv: string[], env: Env = process.env, io: Io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s), tty: !!process.stdout.isTTY }, ahora?: () => number): Promise<number> {
  const x = contextoDe(env, io, ahora);
  const [cmd = "", ...resto] = argv;
  switch (cmd) {
    case "":
    case "lista":
    case "ls":
      await listar(x);
      return 0;
    case "--json":
      listarJson(x);
      return 0;
    case "ver":
    case "seguir":
      return ver(resto, x);
    case "ultimo":
    case "último":
      return ultimo(resto, x);
    case "abrir":
      return abrir(resto, x);
    case "-h":
    case "--help":
    case "ayuda":
      io.out(AYUDA.map((l) => l + "\n").join(""));
      return 0;
    default:
      io.err(`no conozco '${cmd}'. Probá: workers | workers ver | workers ultimo <p>\n`);
      return 2;
  }
}

if (esPrincipal(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
