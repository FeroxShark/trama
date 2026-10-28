// Bajar corridas: `pa --parar <id>` (corriendo o en cola) y `pa <proyecto> --matar [--leer | --id ID]`. Port de matar_arbol,
// matar_run, cmd_matar y cmd_parar de motor/bin/pa.
//
// Linux/macOS: como el bash. El árbol (pid y descendientes, también los que hicieron setsid) se lista ANTES de mandar ninguna
// señal, más los claude -p de la conversación (por su --session-id/--resume, aunque ya estén colgados de init); TERM + CONT a
// todos, TERM a lo que nació mientras tanto, KILL a los 5 s. El `pa` de la corrida (el "paciente") tiene 3 s más: su salida es
// la que deja el `.ultimo`/`.listo`.
// Windows no tiene SIGTERM (cualquier señal es TerminateProcess): al pa se le pide que pare por el canal de control de su lock de
// puesto (`{ orden: "parar" }`, ver base/lock.ts), se le dan los mismos 3 s para que salga solo, y lo que quede se corta con
// `taskkill /T /F`.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { plataformaActual, type Plataforma } from "../../rutas.ts";
import { consultar } from "../base/lock.ts";
import { arbol, listarPares } from "../base/proc.ts";
import { anotarFin, dormir, esArchivo, evento, fijarProyecto, leerCampo, leerTexto, listar, runningVivo, usarId, vive } from "./corridas.ts";
import { jefeId, salir, type Pa } from "./entorno.ts";

/** El mensaje que el pa de una corrida atiende en el canal de control de su lock de puesto para salir por las suyas. */
export const ORDEN_PARAR = { orden: "parar" } as const;

/** Las líneas de comando de los procesos (Linux: /proc; Windows: Win32_Process; el resto: ps). Sin el propio. */
function lineasDeComando(plat: Plataforma): { pid: number; args: string[]; linea: string }[] {
  const r: { pid: number; args: string[]; linea: string }[] = [];
  try {
    if (plat === "linux") {
      for (const n of readdirSync("/proc")) {
        if (!/^\d+$/.test(n) || Number(n) === process.pid) continue;
        try {
          const args = readFileSync(`/proc/${n}/cmdline`, "utf8").split("\0");
          if (args[args.length - 1] === "") args.pop();
          r.push({ pid: Number(n), args, linea: args.join(" ") });
        } catch {
          /* murió */
        }
      }
      return r;
    }
    const salida =
      plat === "win32"
        ? execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId) $($_.CommandLine)\" }"], { encoding: "utf8", windowsHide: true, timeout: 15_000 })
        : execFileSync("ps", ["-A", "-o", "pid=,args="], { encoding: "utf8" });
    for (const l of salida.split(/\r?\n/)) {
      const m = /^\s*(\d+)\s(.*)$/.exec(l);
      if (!m || Number(m[1]) === process.pid) continue;
      r.push({ pid: Number(m[1]), args: m[2]!.split(/\s+/), linea: m[2]! });
    }
  } catch {
    /* sin lista: nada que agregar por sid */
  }
  return r;
}

/**
 * `pids_del_sid`: los claude -p/--print de UNA conversación (`--session-id SID` o `--resume SID`), estén colgados de quien estén. Por
 * argumento y no con una regex sobre la línea: la tarea viaja en el argv y puede contener « -p ». Un `claude --resume SID`
 * interactivo (sin -p) no es el worker y no se toca.
 */
export function pidsDelSid(sid: string, plat: Plataforma = plataformaActual(), procesos = lineasDeComando(plat)): number[] {
  if (!sid) return [];
  const r: number[] = [];
  for (const p of procesos) {
    const conSid = p.args.some((a, i) => (a === "--session-id" || a === "--resume") && p.args[i + 1] === sid);
    if (conSid && p.args.some((a) => a === "-p" || a === "--print")) r.push(p.pid);
  }
  return r;
}

export type OpcionesMatar = {
  plat?: Plataforma;
  /** Lock de puesto del paciente: en Windows se le pide que pare por ahí antes de cortarlo. */
  canal?: string;
  /** Inyectables (tests). */
  senal?: (pid: number, s: NodeJS.Signals) => void;
  vive?: (pid: number) => boolean;
  arbolDe?: (pids: number[]) => number[];
  delSid?: (sid: string) => number[];
  cortar?: (pid: number) => void;
  /** Escala de los tiempos (1 = los del bash: 5 s, 3 s y 1 s). */
  escala?: number;
};

const unicos = (xs: number[]) => [...new Set(xs.filter((x) => Number.isInteger(x) && x > 0))];

/**
 * `matar_arbol sid paciente pids…`: baja el árbol de los pids (más lo que lleve el sid). Devuelve los que quedaron vivos (vacío =
 * no quedó nadie).
 */
export async function matarArbolPa(sid: string, paciente: number | undefined, pids: number[], o: OpcionesMatar = {}): Promise<number[]> {
  const plat = o.plat ?? plataformaActual();
  const esc = o.escala ?? 1;
  const viveP = o.vive ?? ((p: number) => vive(p, plat));
  const senal =
    o.senal ??
    ((p: number, s: NodeJS.Signals) => {
      try {
        process.kill(p, s);
      } catch {
        /* ya no estaba */
      }
    });
  const arbolDe =
    o.arbolDe ??
    ((ps: number[]) => {
      if (!ps.length) return [];
      let pares: [number, number][] = [];
      try {
        pares = listarPares(plat);
      } catch {
        return ps;
      }
      return ps.flatMap((p) => arbol(p, { plat, pares }));
    });
  const delSid = o.delSid ?? ((s: string) => pidsDelSid(s, plat));
  const vivos = (ps: number[]) => ps.filter(viveP);

  let todos = unicos([...arbolDe(unicos(pids)), ...delSid(sid)]);
  if (!todos.length) return [];

  if (plat === "win32") {
    const cortar =
      o.cortar ??
      ((p: number) => {
        try {
          execFileSync("taskkill", ["/T", "/F", "/PID", String(p)], { windowsHide: true, stdio: "ignore", timeout: 15_000 });
        } catch {
          /* ya no estaba */
        }
      });
    if (paciente && o.canal && viveP(paciente)) {
      await consultar(o.canal, ORDEN_PARAR, { plat, timeoutMs: 2000 * esc });
      for (let i = 0; i < 30 && viveP(paciente); i++) await dormir(100 * esc);
    }
    for (const p of vivos(todos)) cortar(p);
  } else {
    for (const p of todos) senal(p, "SIGTERM");
    for (const p of todos) senal(p, "SIGCONT"); // uno parado (T) no atiende el TERM
    // Lo que alcanzó a nacer entre la lista y el TERM. Sólo a los NUEVOS: un segundo TERM al pa lo mataba sin su salida ordenada.
    const ya = new Set(todos);
    const nuevos = unicos([...arbolDe(vivos(todos)), ...delSid(sid)]).filter((p) => !ya.has(p));
    for (const p of nuevos) senal(p, "SIGTERM");
    todos = [...todos, ...nuevos];
    const otros = todos.filter((p) => p !== paciente);
    for (let i = 0; i < 50 && vivos(otros).length; i++) await dormir(100 * esc);
    for (const p of vivos(otros)) senal(p, "SIGKILL");
    if (paciente) {
      for (let i = 0; i < 30 && viveP(paciente); i++) await dormir(100 * esc);
      if (viveP(paciente)) senal(paciente, "SIGKILL");
    }
  }
  // verificación: por pid y por sid
  for (let i = 0; i < 10; i++) {
    if (!vivos(unicos([...todos, ...delSid(sid)])).length) return [];
    await dormir(100 * esc);
  }
  return vivos(unicos([...todos, ...delSid(sid)])).sort((a, b) => a - b);
}

const num = (s: string) => (/^[0-9]+$/.test(s) ? Number(s) : undefined);

/** El lock de un puesto (`lock_de_puesto`): `lock/<slug>` el 1, `lock/<slug>@N` los demás. */
export const lockDePuesto = (lockdir: string, slug: string, puesto: string) => path.join(lockdir, `${slug}${!puesto || puesto === "1" ? "" : `@${puesto}`}`);

/** `matar_run`: baja la corrida de ese `.running`. 0 si no quedó nadie, 85 si sí (el `.running` se queda). */
export async function matarRun(pa: Pa, run: string, o: OpcionesMatar = {}): Promise<number> {
  const slug = leerCampo(run, "proyecto");
  const pid = leerCampo(run, "pid");
  const paPid = leerCampo(run, "pa_pid");
  const sid = leerCampo(run, "sid");
  const leer = leerCampo(run, "leer") === "1";
  const que = leer ? `worker --leer ${leerCampo(run, "id")}` : "worker";
  const puesto = leerCampo(run, "puesto");
  const canal = !leer && puesto !== "aca" ? lockDePuesto(pa.lockdir, slug, puesto) : undefined;
  // el pa primero (padres primero): matar sólo al claude hacía que el pa viejo lo relanzara
  const quedan = await matarArbolPa(sid, num(paPid), [num(paPid), num(pid)].filter((x): x is number => x !== undefined), { plat: pa.plat, canal, ...o });
  if (!quedan.length) {
    await anotarFin(path.join(pa.state, slug), leerCampo(run, "id"));
    const base = run.replace(/\.running$/, "");
    for (const f of [run, `${base}.heartbeat`, `${base}.heartbeat.turnos`]) rmSync(f, { force: true });
    pa.io.out(`pa: ${que} de '${slug}' matado (claude ${pid} y su árbol).\n`);
    return 0;
  }
  const mirar = pa.plat === "win32" ? `tasklist /FI "PID eq ${quedan[0]}"` : `ps -o pid,stat,args -p ${quedan.join(",")}`;
  pa.io.err(`pa: NO pude bajar el ${que} de '${slug}': siguen vivos ${quedan.join(" ")} — mirá con: ${mirar}\n`);
  return 85;
}

/** `running_de_id`: el `.running` vivo de esa corrida en ese proyecto (writer, puesto N o --leer), o "". */
export function runningDeId(pa: Pa, slug: string, id: string): string {
  const cands = [`${slug}.running`, ...listar(pa.state, (n) => n.startsWith(`${slug}@`) && n.endsWith(".running")), `${slug}.leer-${id}.running`];
  for (const c of cands) {
    const r = path.join(pa.state, c);
    if (leerCampo(r, "id") === id && runningVivo(r)) return r;
  }
  return "";
}

/** `pa --parar <id>`: baja esa corrida, esté corriendo o en cola (el pa hijo de --async que espera puesto). */
export async function cmdParar(pa: Pa, id: string | undefined, o: OpcionesMatar = {}): Promise<number> {
  if (!id) {
    pa.io.err("uso: pa --parar <id-de-corrida>\n");
    return 2;
  }
  const p = usarId(pa, id);
  const r = runningDeId(pa, p.slug, id);
  if (r) {
    const rc = await matarRun(pa, r, o);
    if (rc === 0) await evento(pa, "parar", id, p.slug);
    return rc;
  }
  const enCola = leerTexto(path.join(p.dir, `${id}.pid`));
  if (enCola && vive(enCola, pa.plat)) {
    const quedan = await matarArbolPa("", undefined, [Number(enCola)], { plat: pa.plat, ...o });
    if (!quedan.length) {
      await anotarFin(p.dir, id);
      await evento(pa, "parar", id, p.slug);
      pa.io.out(`pa: corrida ${id} de '${p.slug}' bajada (estaba en cola).\n`);
      return 0;
    }
    pa.io.err(`pa: NO pude bajar la corrida ${id} de '${p.slug}': siguen vivos ${quedan.join(" ")}.\n`);
    return 85;
  }
  pa.io.err(`pa: la corrida ${id} de '${p.slug}' no está corriendo ni en cola.\n`);
  return 1;
}

/**
 * `cmd_matar`: `--matar` a secas baja al worker que ESCRIBE (si hay varios vivos, el único de tu jefe; si no se puede decidir sale 2
 * con los ids) y no toca a los --leer; `--leer` baja todos los --leer; `--id` baja esa corrida.
 */
export async function cmdMatar(pa: Pa, slug: string, a: { runId?: string; leer?: boolean }, o: OpcionesMatar = {}): Promise<number> {
  const st = (n: string) => path.join(pa.state, n);
  const todosLeer = listar(pa.state, (n) => n.startsWith(`${slug}.leer-`) && n.endsWith(".running")).map(st);
  const vivosLeer = todosLeer.filter(runningVivo);
  const writers = [`${slug}.running`, ...listar(pa.state, (n) => n.startsWith(`${slug}@`) && n.endsWith(".running"))].map(st).filter(esArchivo);
  const writersVivos = writers.filter(runningVivo);
  let objetivos: string[] = [];
  if (a.runId) {
    const l = st(`${slug}.leer-${a.runId}.running`);
    if (todosLeer.includes(l)) objetivos.push(l);
    for (const f of writers) if (leerCampo(f, "id") === a.runId) objetivos.push(f);
    if (!objetivos.length) {
      pa.io.err(`pa: no hay ninguna corrida viva '${a.runId}' en '${slug}'.\n`);
      salir(1);
    }
  } else if (a.leer) {
    objetivos = todosLeer;
    if (!objetivos.length) {
      pa.io.err(`pa: no hay --leer corriendo en '${slug}'.\n`);
      salir(1);
    }
  } else {
    if (!writers.length) {
      if (vivosLeer.length) {
        pa.io.err(`pa: no hay worker que escriba corriendo en '${slug}', pero hay ${vivosLeer.length} --leer vivo(s):\n`);
        for (const f of vivosLeer) pa.io.err(`    id ${leerCampo(f, "id")}\n`);
        pa.io.err(`pa: \`--matar\` a secas no las toca. Bajalas con: pa '${slug}' --matar --leer  (todas)  o  pa '${slug}' --matar --id <id>.\n`);
      } else {
        pa.io.err(`pa: no hay worker corriendo en '${slug}'.\n`);
      }
      salir(1);
    }
    if (writersVivos.length <= 1) {
      // uno vivo (o ninguno: .running colgados de un pa matado con -9, que matarRun limpia)
      objetivos = writersVivos.length === 1 ? writersVivos : writers;
    } else {
      const yo = jefeId(pa);
      const mios = yo ? writersVivos.filter((f) => leerCampo(f, "jefe_id") === yo) : [];
      if (mios.length === 1) objetivos = mios;
      else {
        pa.io.err(`pa: hay ${writersVivos.length} workers escribiendo en '${slug}'${mios.length ? ` (${mios.length} tuyos)` : ""}; decime cuál con --id:\n`);
        for (const f of writersVivos) {
          const tarea = Buffer.from(leerCampo(f, "tarea")).subarray(0, 70).toString(); // %.70s: bytes, no caracteres
          pa.io.err(`    pa ${citar(slug)} --matar --id ${leerCampo(f, "id")}   # puesto ${leerCampo(f, "puesto")} · jefe ${leerCampo(f, "jefe")} · ${tarea}\n`);
        }
        salir(2);
      }
    }
  }
  let rc = 0;
  for (const r of objetivos) {
    const x = await matarRun(pa, r, o);
    if (x !== 0) rc = x;
  }
  return rc;
}

/** `printf %q` para un slug (sólo `[a-z0-9._-]`: sale tal cual salvo que empiece raro). */
const citar = (s: string) => (/^[A-Za-z0-9._\-@%+=:,/]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);

/** `pa <proyecto> --matar …` con el proyecto ya resuelto a su ruta. */
export async function matarProyecto(pa: Pa, proyecto: string, ruta: string, a: { runId?: string; leer?: boolean }, o: OpcionesMatar = {}): Promise<number> {
  const p = fijarProyecto(pa, proyecto, ruta);
  return cmdMatar(pa, p.slug, a, o);
}
