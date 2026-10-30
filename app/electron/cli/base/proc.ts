// Procesos: correr con tope (`timeout -k`), árbol, matar, ¿vive?, lanzar desprendido (`setsid nohup … & disown`).
// Todo con la plataforma inyectable. El matar-árbol es el de ../../procesos.ts (una sola implementación).
//
// Liveness y Windows: `process.kill(pid, 0)` es SEGURO en Node también en Windows. La documentación de Node dice que señal 0 sirve
// "como forma independiente de la plataforma de probar la existencia de un proceso" (libuv: OpenProcess + GetExitCodeProcess, no
// termina nada). Lo que MATA en Windows es cualquier señal real (SIGTERM/SIGINT/SIGKILL = TerminateProcess). Es lo que rompía en
// Python (`os.kill(pid, 0)` en Windows manda CTRL_C_EVENT/termina). Aun así: (1) los pid se reciclan rápido en Windows, por eso
// `vivo` acepta la hora de arranque; (2) un proceso que terminó con código 259 (STILL_ACTIVE) se ve vivo; (3) una verificación
// real en Windows queda para la etapa 17 (CI windows-latest): acá sólo se probó la lógica con la plataforma inyectada.
import { execFile, execFileSync, spawn, spawnSync, type ChildProcess, type SpawnOptions } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { matarArbol } from "../../procesos.ts";
import { plataformaActual, type Plataforma } from "../../rutas.ts";

export { matarArbol };

type Env = Record<string, string | undefined>;
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- correr (timeout -k)

export type OpcionesCorrer = {
  /** Tope de tiempo; al vencer se manda TERM al árbol. Sin tope si falta. */
  timeoutMs?: number;
  /** Como `timeout -k N`: pasado este tiempo desde el TERM se manda KILL. Windows: no aplica (taskkill /F ya es seco). */
  killAfterMs?: number;
  cwd?: string;
  env?: Env;
  input?: string;
  plat?: Plataforma;
  /** `matarArbol`, inyectable. */
  matar?: (pid: number, senal: NodeJS.Signals) => void;
  /** `spawn`, inyectable. */
  spawn?: (cmd: string, args: string[], o: SpawnOptions) => ChildProcess;
  /** Windows: los argumentos van tal cual (`windowsVerbatimArguments`); lo pide `paraLanzar` para un `.cmd` que va por cmd.exe. */
  verbatim?: boolean;
};

export type ResultadoCorrer = {
  /** Código de salida. Como `timeout(1)`: 124 si venció el tope, 137 si hubo que mandar KILL; 127 si no se pudo lanzar; 128+n si lo mató la señal n. */
  codigo: number;
  senal: NodeJS.Signals | null;
  salida: string;
  errores: string;
  agotado: boolean;
  error?: Error;
};

const NUM_SENAL: Record<string, number> = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 };

/** Corre `cmd args` (sin shell), captura stdout/stderr, y si pasa `timeoutMs` mata el ÁRBOL (TERM, y KILL tras `killAfterMs`). Nunca tira. */
export function correr(cmd: string, args: string[], o: OpcionesCorrer = {}): Promise<ResultadoCorrer> {
  const plat = o.plat ?? plataformaActual();
  const matar = o.matar ?? ((pid, s) => matarArbol(pid, s, { plat }));
  const lanzar = o.spawn ?? ((c, a, op) => spawn(c, a, op));
  return new Promise((resolve) => {
    let salida = "";
    let errores = "";
    let agotado = false;
    let matadoFuerte = false;
    let listo = false;
    let tTerm: NodeJS.Timeout | undefined;
    let tKill: NodeJS.Timeout | undefined;
    const fin = (r: Omit<ResultadoCorrer, "salida" | "errores" | "agotado">) => {
      if (listo) return;
      listo = true;
      clearTimeout(tTerm);
      clearTimeout(tKill);
      resolve({ ...r, salida, errores, agotado });
    };
    let hijo: ChildProcess;
    try {
      hijo = lanzar(cmd, args, {
        cwd: o.cwd,
        env: (o.env ?? process.env) as NodeJS.ProcessEnv,
        stdio: [o.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
        windowsHide: true,
        ...(o.verbatim ? { windowsVerbatimArguments: true } : {}),
        detached: plat !== "win32", // su propio grupo: se lo mata entero con kill(-pid). Como `timeout`, que se pone en su grupo.
      });
    } catch (e) {
      return fin({ codigo: 127, senal: null, error: e as Error });
    }
    hijo.stdout?.setEncoding("utf8").on("data", (d: string) => (salida += d));
    hijo.stderr?.setEncoding("utf8").on("data", (d: string) => (errores += d));
    hijo.stdin?.on("error", () => {});
    if (o.input !== undefined) hijo.stdin?.end(o.input);
    hijo.once("error", (e) => fin({ codigo: 127, senal: null, error: e }));
    hijo.once("close", (code, senal) => {
      const codigo = agotado ? (matadoFuerte ? 137 : 124) : code ?? 128 + (NUM_SENAL[senal ?? ""] ?? 0);
      fin({ codigo, senal });
    });
    if (o.timeoutMs !== undefined && hijo.pid) {
      const pid = hijo.pid;
      tTerm = setTimeout(() => {
        agotado = true;
        matar(pid, "SIGTERM");
        if (plat !== "win32" && o.killAfterMs !== undefined) {
          tKill = setTimeout(() => {
            matadoFuerte = true;
            matar(pid, "SIGKILL");
          }, o.killAfterMs);
        }
      }, o.timeoutMs);
    }
  });
}

// ---------------------------------------------------------------- árbol

/** Parsea "pid ppid" por línea (tolera `\r\n` y espacios de más). */
export function parsearPares(texto: string): [number, number][] {
  const r: [number, number][] = [];
  for (const l of texto.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(l);
    if (m) r.push([Number(m[1]), Number(m[2])]);
  }
  return r;
}

/** Todos los (pid, ppid) del sistema. Linux: /proc (un stat por pid); Windows: Get-CimInstance (~1 s, usar sólo de último recurso); resto: `ps`. */
export function listarPares(plat: Plataforma = plataformaActual()): [number, number][] {
  if (plat === "linux") {
    const r: [number, number][] = [];
    for (const n of readdirSync("/proc")) {
      if (!/^\d+$/.test(n)) continue;
      try {
        const c = campos(readFileSync(`/proc/${n}/stat`, "utf8"));
        if (c) r.push([Number(n), Number(c[1])]);
      } catch {
        /* murió mientras tanto */
      }
    }
    return r;
  }
  if (plat === "win32") {
    const ps = "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId)\" }";
    return parsearPares(execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", windowsHide: true, timeout: 15_000 }));
  }
  return parsearPares(execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" }));
}

/** `pid` y todos sus descendientes, los padres primero (como `arbol()` de pa). Encuentra también a los que hicieron setsid. */
export function arbol(pid: number, o: { plat?: Plataforma; pares?: [number, number][] } = {}): number[] {
  const pares = o.pares ?? listarPares(o.plat ?? plataformaActual());
  const hijos = new Map<number, number[]>();
  for (const [p, pp] of pares) hijos.set(pp, [...(hijos.get(pp) ?? []), p]);
  const salida: number[] = [];
  const vistos = new Set<number>();
  const cola = [pid];
  while (cola.length) {
    const p = cola.shift()!;
    if (vistos.has(p)) continue;
    vistos.add(p);
    salida.push(p);
    cola.push(...(hijos.get(p) ?? []));
  }
  return salida;
}

// ---------------------------------------------------------------- ¿vive?

/** Los campos de /proc/<pid>/stat a partir de `state` (índice 0 = state, 1 = ppid, 19 = starttime = campo 22). El nombre puede tener espacios y `)`. */
export function campos(stat: string): string[] | null {
  const i = stat.lastIndexOf(")");
  if (i < 0) return null;
  const r = stat.slice(i + 1).trim().split(/\s+/);
  return r.length >= 20 ? r : null;
}

/**
 * La hora de arranque del proceso como texto opaco, comparable con la anotada antes. Linux: campo 22 de /proc/<pid>/stat (ticks desde
 * el boot). Windows: `StartTime` por PowerShell (~300 ms, sólo se llama cuando hay un `inicio` anotado que comparar). Otro: undefined.
 */
export function inicioDe(pid: number, o: { plat?: Plataforma; ejecutar?: (cmd: string, args: string[]) => string; leerStat?: (pid: number) => string } = {}): string | undefined {
  const plat = o.plat ?? plataformaActual();
  try {
    if (plat === "linux") {
      const c = campos((o.leerStat ?? ((p) => readFileSync(`/proc/${p}/stat`, "utf8")))(pid));
      return c ? c[19] : undefined;
    }
    if (plat === "win32") {
      const ej = o.ejecutar ?? ((c, a) => execFileSync(c, a, { encoding: "utf8", windowsHide: true, timeout: 10_000 }));
      const t = ej("powershell", ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToFileTimeUtc()`]).trim();
      return /^\d+$/.test(t) ? t : undefined;
    }
  } catch {
    /* no existe, o sin permiso */
  }
  return undefined;
}

export type OpcionesVivo = {
  plat?: Plataforma;
  /** `process.kill`, inyectable. Con señal 0 nunca mata. */
  kill?: (pid: number, senal: 0) => void;
  inicioDe?: (pid: number) => string | undefined;
  /** Linux: lee /proc/<pid>/stat (para descartar zombies). */
  leerStat?: (pid: number) => string;
};

/**
 * ¿Está vivo `pid`? Con `inicio` (lo que `inicioDe` dio cuando se lo anotó) también exige que sea EL MISMO proceso (los pid se reciclan).
 * Un zombie (Linux, estado Z) no cuenta como vivo. EPERM = existe pero es de otro usuario = vivo.
 */
export function vivo(pid: number | undefined, inicio?: string, o: OpcionesVivo = {}): boolean {
  if (!pid || pid <= 0 || !Number.isInteger(pid)) return false;
  const plat = o.plat ?? plataformaActual();
  try {
    (o.kill ?? ((p, s) => process.kill(p, s)))(pid, 0);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EPERM") return false;
  }
  if (plat === "linux") {
    try {
      const c = campos((o.leerStat ?? ((p) => readFileSync(`/proc/${p}/stat`, "utf8")))(pid));
      if (c?.[0] === "Z" || c?.[0] === "X") return false;
      if (inicio !== undefined && c && c[19] !== inicio) return false;
      return true;
    } catch {
      return false;
    }
  }
  if (inicio !== undefined) {
    const real = (o.inicioDe ?? ((p) => inicioDe(p, { plat })))(pid);
    if (real !== undefined && real !== inicio) return false;
  }
  return true;
}

/** Cierra un árbol: TERM a todos (el árbol se lista ANTES de señalar: un hijo con setsid ya no está en el grupo), espera `graceMs` y KILL a los que sigan. Windows: `taskkill /T /F` directo. */
export async function terminar(pid: number, o: { graceMs?: number; plat?: Plataforma; matar?: (pid: number, senal: NodeJS.Signals) => void; pares?: [number, number][] } = {}): Promise<boolean> {
  const plat = o.plat ?? plataformaActual();
  const matar = o.matar ?? ((p, s) => matarArbol(p, s, { plat }));
  const kill = (p: number, s: NodeJS.Signals) => {
    try {
      process.kill(p, s);
    } catch {
      /* ya no estaba */
    }
  };
  if (plat === "win32") {
    matar(pid, "SIGKILL");
    return true;
  }
  const todos = arbol(pid, { plat, pares: o.pares });
  matar(pid, "SIGTERM");
  for (const p of todos) kill(p, "SIGTERM");
  for (const p of todos) kill(p, "SIGCONT"); // uno parado (T) no atiende el TERM
  const fin = Date.now() + (o.graceMs ?? 2000);
  while (Date.now() < fin && todos.some((p) => vivo(p, undefined, { plat }))) await dormir(50);
  const quedan = todos.filter((p) => vivo(p, undefined, { plat }));
  if (quedan.length) {
    matar(pid, "SIGKILL");
    for (const p of quedan) kill(p, "SIGKILL");
    await dormir(50);
  }
  return !todos.some((p) => vivo(p, undefined, { plat }));
}

// ---------------------------------------------------------------- lanzar suelto

export type OpcionesSuelto = {
  cwd?: string;
  env?: Env;
  /** Archivo donde van stdout y stderr (se abre en append). Sin él, se descartan. */
  log?: string;
  plat?: Plataforma;
  spawn?: (cmd: string, args: string[], o: SpawnOptions) => ChildProcess;
};

/**
 * `setsid nohup cmd args >>log 2>&1 & disown`: el proceso sigue vivo cuando muere el que lo lanzó. Linux: `detached` (Node hace
 * setsid: sin terminal de control, no le llega SIGHUP) + stdin cerrado + `unref`. Windows: `detached` + `windowsHide` (sin consola).
 * Devuelve el pid (puede ser undefined si el spawn falló de forma asíncrona: ENOENT; el 'error' se traga para no tirar el proceso).
 */
export function lanzarSuelto(cmd: string, args: string[], o: OpcionesSuelto = {}): number | undefined {
  const plat = o.plat ?? plataformaActual();
  // Windows de verdad: primero afuera del job de quien nos llama (ver `lanzarFueraDelJob`); si no se pudo, el spawn de siempre.
  if (plat === "win32" && process.platform === "win32" && !o.spawn && process.env.TRAMA_SIN_FUERA_DEL_JOB !== "1") {
    const pid = lanzarFueraDelJob(cmd, args, o);
    if (pid) return pid;
  }
  const lanzar = o.spawn ?? ((c, a, op) => spawn(c, a, op));
  const fd = o.log ? openSync(o.log, "a") : undefined;
  try {
    const hijo = lanzar(cmd, args, {
      cwd: o.cwd,
      env: (o.env ?? process.env) as NodeJS.ProcessEnv,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", fd ?? "ignore", fd ?? "ignore"],
    });
    hijo.on("error", () => {});
    hijo.unref();
    return hijo.pid;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// ---------------------------------------------------------------- lanzar suelto, afuera del job (Windows)

/** Lo que corre el lanzador: lee el pedido (JSON), lo borra, y suelta el proceso con su salida al log; deja el pid en un archivo. */
export const LANZADOR_JS = [
  "const fs=require('fs'),cp=require('child_process');",
  "const f=process.argv[2];const j=JSON.parse(fs.readFileSync(f,'utf8'));try{fs.unlinkSync(f)}catch(e){}",
  "const fd=j.log?fs.openSync(j.log,'a'):'ignore';",
  "const h=cp.spawn(j.cmd,j.args,{cwd:j.cwd||undefined,env:j.env,detached:true,windowsHide:true,stdio:['ignore',fd,fd]});",
  "h.on('error',function(){});fs.writeFileSync(j.pidf,String(h.pid||0));h.unref();",
].join("");

export type PedidoFuera = { cmd: string; args: string[]; cwd?: string; env: Env; log?: string; pidf: string };

/**
 * Los textos que arman el lanzado afuera del job: el pedido en JSON (con la tarea y todo el entorno: NUNCA en la línea de comandos, que pasaría
 * por cmd.exe), el lanzador, la línea de comandos que ejecuta WMI y el script de PowerShell que la pide. Puro: lo prueba tests/base-proc.test.ts.
 * WMI arranca con un entorno nuevo (no el nuestro): `ELECTRON_RUN_AS_NODE` va en la línea por si `node` es el Electron de la app.
 */
export function armarFueraDelJob(node: string, lanzador: string, pedido: string, cwd?: string): { linea: string; ps: string } {
  const linea = `cmd.exe /d /s /c "set ELECTRON_RUN_AS_NODE=1&& "${node}" "${lanzador}" "${pedido}""`;
  const q = (t: string) => `'${t.replaceAll("'", "''")}'`;
  const ps = [
    "$ErrorActionPreference='Stop'",
    "$st=New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ShowWindow=[uint16]0}",
    `$a=@{CommandLine=${q(linea)};ProcessStartupInformation=$st${cwd ? `;CurrentDirectory=${q(cwd)}` : ""}}`,
    "$r=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments $a",
    "if($r.ReturnValue -ne 0){exit 3}",
  ].join("\n");
  return { linea, ps };
}

/**
 * Windows: suelta el proceso AFUERA del job y del árbol de quien lo lanza. La herramienta de comandos de agy (un líder de Gemini) corre cada
 * llamada en un job que se cierra al terminar (o al terminar el turno) y mata TODO lo que quedó adentro, también lo que salió `detached` (que
 * sólo se separa de la consola, no del job): los workers `--async` morían ~1 s después de que `pa` volvía. Lo creado por WMI
 * (`Win32_Process.Create`) cuelga del servicio WMI, no de quien lo pidió. El lanzador (un Node chico) lo suelta con su salida al log.
 * Devuelve el pid del proceso lanzado, o `undefined` si no se pudo (PowerShell/WMI no disponibles): quien llama vuelve al spawn de siempre.
 */
export function lanzarFueraDelJob(cmd: string, args: string[], o: OpcionesSuelto = {}): number | undefined {
  const dir = o.log ? path.dirname(o.log) : os.tmpdir();
  const base = path.join(dir, `.lanzar-${process.pid}-${Date.now().toString(36)}`);
  const pedidoF = `${base}.json`;
  const lanzadorF = `${base}.cjs`;
  const pidF = `${base}.pid`;
  try {
    const pedido: PedidoFuera = { cmd, args, cwd: o.cwd, env: (o.env ?? process.env) as Env, log: o.log, pidf: pidF };
    writeFileSync(pedidoF, JSON.stringify(pedido));
    writeFileSync(lanzadorF, LANZADOR_JS);
    const { ps } = armarFueraDelJob(process.execPath, lanzadorF, pedidoF, o.cwd);
    const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(ps, "utf16le").toString("base64")], { windowsHide: true, timeout: 20_000, stdio: "ignore" });
    if (r.status !== 0) return undefined;
    const fin = Date.now() + 10_000;
    while (Date.now() < fin && !existsSync(pidF)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    const pid = Number(readFileSync(pidF, "utf8").trim());
    return pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  } finally {
    for (const f of [pedidoF, lanzadorF, pidF]) rmSync(f, { force: true });
  }
}

// `execFile` sin shell con callback → promesa. Para los demás módulos de base.
export function ejecutar(cmd: string, args: string[], o: { cwd?: string; env?: Env; timeoutMs?: number; input?: string; plat?: Plataforma } = {}): Promise<{ codigo: number; salida: string; errores: string; error?: Error }> {
  return new Promise((resolve) => {
    const hijo = execFile(cmd, args, { cwd: o.cwd, env: (o.env ?? process.env) as NodeJS.ProcessEnv, timeout: o.timeoutMs, encoding: "utf8", windowsHide: true, maxBuffer: 256 * 1024 * 1024 }, (e, so, se) => {
      const code = e ? ((e as NodeJS.ErrnoException & { code?: number | string }).code) : 0;
      resolve({ codigo: typeof code === "number" ? code : e ? (e.killed ? 124 : 127) : 0, salida: String(so), errores: String(se), error: e ?? undefined });
    });
    if (o.input !== undefined) hijo.stdin?.end(o.input);
  });
}
