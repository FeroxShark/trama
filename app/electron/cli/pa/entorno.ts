// Lo que `pa` arma antes de mirar los argumentos (el prólogo de motor/bin/pa): dónde está el estado, el plan, los topes, los
// candados de worker y de modelo local, y quién es el dueño y el jefe. Sin estado global: todo cuelga de un `Pa` que se arma una
// vez por llamada y se pasa a los subcomandos.
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { caminoDe, carpetaApp, carpetaBin, estadoPa, homeDe, plataformaActual, type Plataforma } from "../../rutas.ts";
import { campos, listarPares } from "../base/proc.ts";

export type Env = Record<string, string | undefined>;
export type Io = { out: (s: string) => void; err: (s: string) => void };

/** Un `exit N` del bash: lo tira un subcomando para cortar todo con ese código (el mensaje ya salió por `io`). */
export class Salida extends Error {
  codigo: number;
  constructor(codigo: number) {
    super(`salida ${codigo}`);
    this.codigo = codigo;
  }
}

/** Corta la ejecución con ese código (el `exit` del bash). */
export const salir = (codigo: number): never => {
  throw new Salida(codigo);
};

/** Dónde están las herramientas y los hooks del motor que `pa` lanza (`reparto`, `tablero`, `cuentas`, `latido`…) y cómo se los encontró. */
export interface Motor {
  /** La raíz: `motor/` (checkout, árbol exportado) o la carpeta de instalación (Windows nativo). */
  dir: string;
  /** Donde están `reparto`, `tablero`, `cuentas`, `repos-empujar` (Windows: los `.cmd` de `bin\`). */
  bin: string;
  /** Donde están `latido` y `destructive-guard` (`.sh` o `.mjs`). */
  hooks: string;
  /** De dónde salió: `TRAMA_MOTOR_DIR`, `checkout`, `payload`, `fuente`, `checkout anotado`, `enlace de pa` o `instalación`. */
  via: string;
  /** `bin` existe y trae `pa` o `reparto`. */
  binOk: boolean;
  /** `hooks` existe y trae `latido`. */
  hooksOk: boolean;
  /** Las carpetas que se miraron, en orden (para el aviso cuando no aparece ninguna). */
  buscado: string[];
}

export interface OpcionesMotor {
  /** La carpeta de este archivo (`…/app/electron/cli/pa` o `…/app/dist-electron/cli/pa`). */
  desde?: string;
  plat?: Plataforma;
  home?: string;
  existe?: (ruta: string) => boolean;
  /** Primera línea de un archivo de texto, o null. */
  leer?: (ruta: string) => string | null;
  /** `readlink -f`, o null si no se puede. */
  real?: (ruta: string) => string | null;
}

const BIN_MARCAS = ["pa", "pa.cmd", "reparto", "reparto.cmd"];
const HOOKS_MARCAS = ["latido.mjs", "latido.sh"];

/**
 * Dónde está el motor, en todas las formas de instalar. `electron/cli/pa/` y `dist-electron/cli/pa/` están a la misma profundidad
 * dentro de `app/`, pero lo de al lado de `app/` cambia: en un checkout (y en un worktree) es `motor/`; en la instalación de
 * escritorio de Linux la app compilada vive en `~/.local/share/trama/app` y el motor en `~/.local/share/trama/fuente/motor`; en el
 * payload nativo de Windows no hay `motor/` (`<raíz>\{app,bin,node}`: los `.cmd` en `bin\`, los hooks en `app\hooks`). Gana la
 * primera forma que tiene lo que `pa` necesita (`bin` con `pa`/`reparto` y `hooks` con `latido`); si ninguna lo tiene vuelve la
 * primera con `bin` y, si tampoco, la del checkout, con `binOk`/`hooksOk` en false para que quien llama lo avise.
 * `TRAMA_MOTOR_DIR` manda sin buscar más.
 */
export function resolverMotor(env: Env = process.env, o: OpcionesMotor = {}): Motor {
  const plat = o.plat ?? plataformaActual();
  const c = caminoDe(plat);
  const home = o.home ?? homeDe(env, plat);
  const existe = o.existe ?? existsSync;
  const leer =
    o.leer ??
    ((f: string) => {
      try {
        return (readFileSync(f, "utf8").split("\n")[0] ?? "").trim() || null;
      } catch {
        return null;
      }
    });
  const real =
    o.real ??
    ((f: string) => {
      try {
        return realpathSync(f);
      } catch {
        return null;
      }
    });
  const desde = o.desde ?? path.dirname(fileURLToPath(import.meta.url));
  const app = c.join(desde, "..", "..", "..");
  const raiz = c.dirname(app);
  const cand: { via: string; dir: string; bin: string; hooks: string }[] = [];
  const delMotor = (via: string, m: string) => cand.push({ via, dir: m, bin: c.join(m, "bin"), hooks: c.join(m, "hooks") });
  if (env.TRAMA_MOTOR_DIR) delMotor("TRAMA_MOTOR_DIR", env.TRAMA_MOTOR_DIR);
  else {
    delMotor("checkout", c.join(raiz, "motor"));
    cand.push({ via: "payload", dir: raiz, bin: c.join(raiz, "bin"), hooks: c.join(app, "hooks") });
    delMotor("fuente", c.join(raiz, "fuente", "motor"));
    if (plat === "win32") cand.push({ via: "instalación", dir: c.dirname(carpetaApp(env, home, plat)), bin: carpetaBin(env, home, plat), hooks: c.join(carpetaApp(env, home, plat), "hooks") });
    else {
      // lo que dejó instalar-producto.sh: el checkout anotado y el enlace de ~/.local/bin/pa
      const conf = env.XDG_CONFIG_HOME || c.join(home, ".config");
      const anotado = leer(c.join(conf, "trama", "checkout"));
      if (anotado) delMotor("checkout anotado", c.join(anotado, "motor"));
      const enlace = real(c.join(carpetaBin(env, home, plat), "pa"));
      if (enlace) delMotor("enlace de pa", c.dirname(c.dirname(enlace)));
    }
  }
  const tiene = (d: string, marcas: string[]) => marcas.some((m) => existe(c.join(d, m)));
  const lista = cand.map((x) => ({ ...x, binOk: tiene(x.bin, BIN_MARCAS), hooksOk: tiene(x.hooks, HOOKS_MARCAS) }));
  const buscado = lista.map((x) => x.bin);
  const elegida = lista.find((x) => x.binOk && x.hooksOk) ?? lista.find((x) => x.binOk) ?? lista[0]!;
  return { dir: elegida.dir, bin: elegida.bin, hooks: elegida.hooks, via: elegida.via, binOk: elegida.binOk, hooksOk: elegida.hooksOk, buscado };
}

/** La raíz del motor (ver `resolverMotor`): de acá salen `opencode/`, `dsh/`, `codex/` y `datos/`. */
export function carpetaMotor(env: Env = process.env): string {
  return resolverMotor(env).dir;
}

/** Texto para decir dónde se buscó y no se encontró (`pa: no encuentro …`). */
export const dondeSeBusco = (m: Motor): string => m.buscado.join(", ");

const avisados = new WeakMap<object, Set<string>>();

/**
 * Una pieza del motor que `pa` necesita y no está (`reparto`, `tablero`, `cuentas`, los hooks del worker): lo dice por stderr, una vez por
 * corrida y por pieza, con dónde se buscó. Nunca se cae callado a lo de siempre.
 */
export function avisarFalta(pa: Pick<Pa, "io" | "motor" | "bin">, que: string, ruta: string): void {
  let ya = avisados.get(pa);
  if (!ya) avisados.set(pa, (ya = new Set()));
  if (ya.has(que)) return;
  ya.add(que);
  const m = pa.motor;
  pa.io.err(`pa: no encuentro ${que} (${ruta}).${m ? ` Motor: ${m.dir} (vía ${m.via}); busqué en ${dondeSeBusco(m)}. TRAMA_MOTOR_DIR lo fuerza.` : ""}\n`);
}

/** `app/package.json` (la versión de Trama). */
export const paqueteApp = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "package.json");

export interface Pa {
  env: Env;
  io: Io;
  plat: Plataforma;
  home: string;
  esEjecutable?: (f: string) => boolean;
  /** `$STATE`: PA_STATE o el estado de pa de la plataforma. */
  state: string;
  lockdir: string;
  /** `motor/bin` (el `_BIN` del bash). */
  bin: string;
  /** Donde están los hooks del worker (`latido`, `destructive-guard`); sin él, `bin/../hooks`. */
  hooks?: string;
  /** Cómo se encontró el motor (para avisar cuando falta algo). */
  motor?: Motor;
  plan: "pro" | "max";
  /** Tokens de `PA_AUTOCOMPACT` si valen (`null`: no pisa nada, el de modelos.json o la ventana nativa; `"nativo"` fuerza sin tope). */
  autocompact: number | "nativo" | null;
  puestos: number;
  tope: number;
  ramWorkerMb: number;
  ramReservaMb: number;
  ramRecienMin: number;
}

/** El valor de una variable como la ve bash con `${X:-defecto}` (vacía = la de por defecto). */
export const v = (env: Env, k: string, defecto = ""): string => (env[k] ? env[k]! : defecto);

/** `head -n1 archivo | tr -d '[:space:]'` (vacío si no se puede leer). */
function primeraLinea(f: string): string {
  try {
    return (readFileSync(f, "utf8").split("\n")[0] ?? "").replace(/\s/g, "");
  } catch {
    return "";
  }
}

/** `${p,,}` de bash (minúsculas; para lo que es ASCII alcanza con toLowerCase). */
export const minus = (s: string) => s.toLowerCase();

/** El plan de la suscripción: PA_PLAN, si no `$STATE/plan`, si no `pro`; uno inválido avisa y sigue como pro. */
export function planDe(env: Env, state: string, io: Io): "pro" | "max" {
  let p = env.PA_PLAN ?? "";
  if (!p && existsSync(path.join(state, "plan"))) p = primeraLinea(path.join(state, "plan"));
  p = minus(p) || "pro";
  if (p === "pro" || p === "max") return p;
  io.err(`pa: plan '${p}' no existe (PA_PLAN o ${state}/plan: pro o max); sigo como pro.\n`);
  return "pro";
}

/** ¿La sesión que llama corre contra un modelo LOCAL? (claude-local: CLAUDE_LOCAL=1 o un ANTHROPIC_BASE_URL a 127.0.0.1). */
export const modeloLocal = (env: Env) =>
  env.CLAUDE_LOCAL === "1" || /^([a-zA-Z]+:\/\/)?(localhost|127\.[0-9.]+|\[::1\]|::1)([:/]|$)/.test(env.ANTHROPIC_BASE_URL ?? "");

/** Lo que pasa con un modelo local: las consultas que no lanzan ni retoman nada. */
export function pasaConModeloLocal(argv: string[]): boolean {
  const [a, b] = argv;
  if (["--estado", "--brief", "--hilos", "--hilo", "--modelos", "--version", "-h", "--help", "--ayuda"].includes(a ?? "")) return true;
  if (a === "--plan") return !b || b === "ver";
  return argv.length === 2 && b === "--ramas";
}

/**
 * El prólogo: crea el estado, valida PA_PUESTOS / PA_TOPE / PA_RAM_*, y los candados de worker (sale 1) y de modelo local (88).
 * Tira `Salida` si el bash habría salido acá.
 */
export function prologo(argv: string[], env: Env, io: Io, plat: Plataforma = plataformaActual()): Pa {
  const home = homeDe(env, plat);
  const state = estadoPa(env, home, plat);
  const lockdir = path.join(state, "lock");
  mkdirSync(lockdir, { recursive: true });
  const plan = planDe(env, state, io);

  let autocompact: number | "nativo" | null = null;
  const ac = v(env, "PA_AUTOCOMPACT");
  if (ac.toLowerCase() === "nativo") autocompact = "nativo";
  else if (ac && /^[0-9]+$/.test(ac) && Number(ac) >= 100000 && Number(ac) <= 1000000) autocompact = Number(ac);
  else if (ac) io.err(`pa: PA_AUTOCOMPACT='${ac}' no va (tokens, entre 100000 y 1000000, o nativo); lo ignoro y sigo con modelos.json.\n`);

  const puestos = v(env, "PA_PUESTOS", "3");
  if (!/^[1-9][0-9]*$/.test(puestos)) {
    io.err(`pa: PA_PUESTOS tiene que ser un número >= 1 (vino '${puestos}').\n`);
    salir(2);
  }

  let tope = env.PA_TOPE ?? "";
  if (!tope && existsSync(path.join(state, "tope"))) {
    try {
      tope = (readFileSync(path.join(state, "tope"), "utf8").split("\n")[0] ?? "").replace(/\s/g, "");
    } catch {
      tope = "";
    }
  }
  tope ||= "10";
  if (!/^[1-9][0-9]*$/.test(tope)) {
    io.err(`pa: PA_TOPE (o ${state}/tope) tiene que ser un número >= 1 (vino '${tope}').\n`);
    salir(2);
  }

  const ram: Record<string, number> = {};
  for (const [k, d] of [["RAM_WORKER_MB", "2048"], ["RAM_RESERVA_MB", "6144"], ["RAM_RECIEN_MIN", "3"]] as const) {
    const x = v(env, `PA_${k}`, d);
    if (!/^[0-9]+$/.test(x)) {
      io.err(`pa: PA_${k} tiene que ser un número >= 0 (vino '${x}').\n`);
      salir(2);
    }
    ram[k] = Number(x);
  }

  if (env.PA_WORKER) {
    io.err("pa: sos un worker delegado, no podés delegar de nuevo. Hacé la tarea vos.\n");
    salir(1);
  }
  if (modeloLocal(env) && !pasaConModeloLocal(argv)) {
    io.err(
      `pa: esta sesión corre contra un modelo LOCAL (CLAUDE_LOCAL=${env.CLAUDE_LOCAL ?? ""} ANTHROPIC_BASE_URL=${env.ANTHROPIC_BASE_URL ?? ""}); no delego. La GPU no entra dos modelos locales a la vez, y el worker heredaría el BASE_URL local o pediría otro modelo. Delegá desde una sesión normal de claude. (Pasan sólo pa --estado, pa --plan, pa --hilos/--hilo, pa <proy> --ramas.)\n`,
    );
    salir(88);
  }

  const motor = resolverMotor(env, { plat, home });
  return {
    env,
    io,
    plat,
    home,
    state,
    lockdir,
    bin: motor.bin,
    hooks: motor.hooks,
    motor,
    plan,
    autocompact,
    puestos: Number(puestos),
    tope: Number(tope),
    ramWorkerMb: ram.RAM_WORKER_MB!,
    ramReservaMb: ram.RAM_RESERVA_MB!,
    ramRecienMin: ram.RAM_RECIEN_MIN!,
  };
}

// ---------------------------------------------------------------- dueño y jefe

/** El nombre del dueño: TRAMA_DUENO → `dueno` de perfil.json → el usuario con mayúscula inicial → "el usuario". */
export function nombreDueno(env: Env, home: string = homeDe(env)): string {
  let n = env.TRAMA_DUENO ?? "";
  if (!n) {
    const p = env.TRAMA_PERFIL || path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "trama", "perfil.json");
    try {
      const d = (JSON.parse(readFileSync(p, "utf8")) as { dueno?: unknown } | null)?.dueno;
      if (d !== undefined && d !== null && d !== false) n = typeof d === "string" ? d : JSON.stringify(d);
    } catch {
      /* sin perfil */
    }
  }
  if (!n) {
    let u = env.USER || env.USERNAME || "";
    if (!u) {
      try {
        u = os.userInfo().username;
      } catch {
        u = "";
      }
    }
    if (u) n = u.charAt(0).toUpperCase() + u.slice(1);
  }
  return n || "el usuario";
}

/** `D`: un texto con @DUENO@ reemplazado (y «a el usuario» → «al usuario»). */
export function conDueno(t: string, env: Env, home?: string): string {
  return t.split("@DUENO@").join(nombreDueno(env, home)).split(" a el usuario").join(" al usuario").split(" de el usuario").join(" del usuario");
}

/** El ppid de un proceso (Linux: /proc; el resto: la lista de pares, que se pide una sola vez). */
function padreDe(pid: number, plat: Plataforma, cache: { pares?: [number, number][] }): number | null {
  if (plat === "linux") {
    try {
      const c = campos(readFileSync(`/proc/${pid}/stat`, "utf8"));
      return c ? Number(c[1]) : null;
    } catch {
      return null;
    }
  }
  try {
    cache.pares ??= listarPares(plat);
  } catch {
    return null;
  }
  return cache.pares.find(([p]) => p === pid)?.[1] ?? null;
}

/** Un campo (name | sessionId) de la sesión de Claude que está arriba nuestro en el árbol de procesos (`jefe_campo`). */
export function jefeCampo(campo: "name" | "sessionId", _env: Env, home: string, plat: Plataforma = plataformaActual(), ppid = process.ppid): string {
  const dir = path.join(home, ".claude", "sessions");
  if (!existsSync(dir)) return "";
  const cache: { pares?: [number, number][] } = {};
  let p: number | null = ppid;
  for (let vueltas = 0; p && p !== 1 && p !== 0 && vueltas < 256; vueltas++) {
    const f = path.join(dir, `${p}.json`);
    if (existsSync(f)) {
      try {
        const x = (JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>)[campo];
        return x === undefined || x === null || x === false ? "" : typeof x === "string" ? x : JSON.stringify(x);
      } catch {
        return "";
      }
    }
    p = padreDe(p, plat, cache);
  }
  return "";
}

/** `jefe_nombre`: PA_JEFE (aunque sea vacío) o el nombre de la sesión de arriba. */
export const jefeNombre = (pa: Pa) => (pa.env.PA_JEFE !== undefined ? pa.env.PA_JEFE : jefeCampo("name", pa.env, pa.home, pa.plat));
/** `jefe_id`: PA_JEFE_ID, si no PA_JEFE, si no el sessionId de la sesión de arriba. */
export const jefeId = (pa: Pa) =>
  pa.env.PA_JEFE_ID !== undefined ? pa.env.PA_JEFE_ID : pa.env.PA_JEFE !== undefined ? pa.env.PA_JEFE : jefeCampo("sessionId", pa.env, pa.home, pa.plat);
