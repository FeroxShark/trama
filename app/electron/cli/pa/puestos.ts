// Puestos, tope global y admisión por RAM de `pa` (etapa 7 del port, motor/docs/port-windows-plan.md). Copia de motor/bin/pa
// (puesto_libre, otros_writers, avisar_paralelo, describir_puestos, workers_sueltos, mem_disponible_mb, ram_reservada_mb,
// ram_reservar/soltar, ram_alcanza, tomar_lugar, describir_vivos, tope_lleno_75, escribir_cola, esperar_lugar, tomar_puesto);
// los comentarios largos de por qué están allá.
//
// Los flock del bash son locks por socket (base/lock.ts) con la MISMA ruta como clave: `lock/<slug>[@k]` (el puesto, fd 9),
// `lock/@tope` (el candado del tope, fd 5), `lock/@tope@k` (los lugares, fd 6). Se liberan solos si el proceso muere, igual que
// el flock, pero un `pa` bash y uno de TS no se ven entre ellos (motor/docs/port-windows.md, trampa 2). Los archivos se siguen
// creando: el barrido del "máximo k" de los lugares cuenta los `@tope@k` que existen.
// En Windows no hay /proc/meminfo: la RAM disponible sale de `os.freemem()` (salvo PA_MEMINFO, que usan los tests).
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { tomar, probar, type AlMensaje, type Lock } from "../base/lock.ts";
import { salir } from "./entorno.ts";
import { leerCampo, puestoParaRetomar, sufPuesto, tieneHead, tocar, type Proyecto } from "./worktrees.ts";

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** `sleep 0.$(( 5 + RANDOM % 5 ))`: entre 0,5 y 0,9 s. */
const jitterCola = () => 500 + Math.floor(Math.random() * 5) * 100;

/** `kill -0`: existe (EPERM = de otro usuario, existe igual). */
export function existe(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** `vivo`: el pid del `.running` (el del claude, o el de pa si todavía no hay) existe. */
export function runningVivo(run: string): boolean {
  const p = leerCampo(run, "pid") || leerCampo(run, "pa_pid");
  return /^[0-9]+$/.test(p) && existe(Number(p));
}

/** `printf %.Ns` / `${t:0:N}`: los primeros N caracteres. */
const corte = (t: string, n: number) => Array.from(t).slice(0, n).join("");

/** Los `*.running` del estado (todos los proyectos), ordenados como el glob. */
function runnings(state: string, filtro: (nombre: string) => boolean = () => true): string[] {
  let ns: string[];
  try {
    ns = readdirSync(state);
  } catch {
    return [];
  }
  return ns
    .filter((n) => n.endsWith(".running") && filtro(n))
    .sort()
    .map((n) => path.join(state, n));
}

/** `lock_de_puesto`: el lock del puesto k (`lock/<slug>`, `lock/<slug>@k`, `lock/<slug>@aca`). */
export const lockDePuesto = (x: Proyecto, k: string) => path.join(x.pa.lockdir, `${x.slug}${sufPuesto(k)}`);

/** `puesto_libre`: nadie tiene el lock del puesto (sondeo que no toma nada ni estorba a otro sondeo). */
export const puestoLibre = async (x: Proyecto, k: string) => !(await probar(lockDePuesto(x, k), { plat: x.pa.plat, env: x.pa.env }));

/** `otros_writers`: los otros writers vivos del proyecto (`<slug>.running` y `<slug>@*.running`), sin la corrida propia. */
export function otrosWriters(x: Proyecto, tsPropio: string): { id: string; puesto: string; jefe: string; tarea: string }[] {
  const out = [];
  const cands = [path.join(x.pa.state, `${x.slug}.running`), ...runnings(x.pa.state, (n) => n.startsWith(`${x.slug}@`))];
  for (const r of cands) {
    if (!existsSync(r) || !runningVivo(r)) continue;
    const id = leerCampo(r, "id");
    if (id === tsPropio) continue;
    out.push({ id, puesto: leerCampo(r, "puesto") || "1", jefe: leerCampo(r, "jefe"), tarea: leerCampo(r, "tarea") });
  }
  return out;
}

/** `avisar_paralelo`: al jefe, por stderr, con quién comparte el repo esta corrida. */
export function avisarParalelo(x: Proyecto, tsPropio: string): void {
  for (const w of otrosWriters(x, tsPropio)) {
    const p = w.puesto === "aca" ? "tree principal" : `puesto ${w.puesto}`;
    x.pa.io.err(`pa: corre en paralelo con ${w.id} (${p}, jefe ${w.jefe || "?"}): ${corte(w.tarea, 100)}\n`);
  }
}

const nombrePuesto = (k: string) => (k === "aca" ? "tree principal" : `puesto ${k}`);

/** `describir_puestos`: qué corre en cada uno de esos puestos, una línea por puesto (para el 75 y la cola). */
export function describirPuestos(x: Proyecto, puestos: string[]): string {
  let s = "";
  for (const k of puestos) {
    const r = path.join(x.pa.state, `${x.slug}${sufPuesto(k)}.running`);
    if (existsSync(r))
      s += `    ${nombrePuesto(k)}: id ${leerCampo(r, "id")} · jefe ${leerCampo(r, "jefe")} · ${corte(leerCampo(r, "tarea"), 80)}\n`;
    else s += `    ${nombrePuesto(k)}: tomado (arrancando)\n`;
  }
  return s;
}

/** `describir_vivos`: los workers vivos de todos los proyectos (para el 75 del tope). */
export function describirVivos(state: string): string {
  let s = "";
  for (const r of runnings(state)) {
    if (!runningVivo(r)) continue;
    let p: string;
    if (leerCampo(r, "leer") === "1") p = "lectura";
    else {
      p = leerCampo(r, "puesto");
      p = p === "aca" ? "tree principal" : `puesto ${p || "1"}`;
    }
    s += `    ${leerCampo(r, "proyecto")} (${p}): id ${leerCampo(r, "id")} · jefe ${leerCampo(r, "jefe")} · ${corte(leerCampo(r, "tarea"), 80)}\n`;
  }
  return s;
}

/** `workers_sueltos`: claudes vivos cuyo pa ya no está (no tienen lugar tomado pero ocupan RAM, así que cuentan). */
export function workersSueltos(state: string): number {
  let n = 0;
  for (const f of runnings(state)) {
    const c = leerCampo(f, "pid");
    const p = leerCampo(f, "pa_pid");
    if (!/^[0-9]+$/.test(c) || !/^[0-9]+$/.test(p)) continue;
    if (existe(Number(p))) continue;
    if (existe(Number(c))) n++;
  }
  return n;
}

// ---------------------------------------------------------------- RAM

/** `mem_disponible_mb`: MemAvailable en MB (PA_MEMINFO o /proc/meminfo; fuera de Linux, `os.freemem()`). -1 si no se puede leer. */
export function memDisponibleMb(env: Record<string, string | undefined>, plat: string = process.platform): number {
  if (!env.PA_MEMINFO && plat !== "linux") return Math.floor(os.freemem() / 1048576);
  let t: string;
  try {
    t = readFileSync(env.PA_MEMINFO || "/proc/meminfo", "utf8");
  } catch {
    return -1;
  }
  for (const l of t.split("\n")) {
    const [k, v] = l.trim().split(/\s+/);
    if (k === "MemAvailable:") return /^[0-9]+$/.test(v ?? "") ? Math.floor(Number(v) / 1024) : -1;
  }
  return -1;
}

const ahoraS = () => Math.floor(Date.now() / 1000);

/** `ram_reservada_mb`: el costo entero de cada worker admitido hace menos de RAM_RECIEN_MIN minutos con su pa vivo; borra los vencidos. */
export function ramReservadaMb(x: Proyecto): number {
  const d = path.join(x.pa.lockdir, "@ram");
  const vence = x.pa.ramRecienMin * 60;
  let n = 0;
  let ns: string[];
  try {
    ns = readdirSync(d);
  } catch {
    return 0;
  }
  for (const p of ns) {
    const f = path.join(d, p);
    let t = "";
    try {
      t = (readFileSync(f, "utf8").split("\n")[0] ?? "").trim();
    } catch {
      continue;
    }
    if (/^[0-9]+$/.test(t) && ahoraS() - Number(t) < vence && /^[0-9]+$/.test(p) && existe(Number(p))) n += x.pa.ramWorkerMb;
    else rmSync(f, { force: true });
  }
  return n;
}

const archivoRam = (x: Proyecto) => path.join(x.pa.lockdir, "@ram", String(process.pid));
export function ramReservar(x: Proyecto): void {
  mkdirSync(path.dirname(archivoRam(x)), { recursive: true });
  writeFileSync(archivoRam(x), String(ahoraS()));
}
export const ramSoltar = (x: Proyecto) => rmSync(archivoRam(x), { force: true });

export interface Ram {
  disp: number;
  reservada: number;
  haceFalta: number;
  /** Vacío si alcanza. */
  motivo: string;
}

/** `ram_alcanza`: ¿hay RAM para uno más? Con 0 vivos entra siempre (piso 1), y sin dato (-1) no se frena a nadie. */
export function ramAlcanza(x: Proyecto, vivos: number): Ram {
  const disp = memDisponibleMb(x.pa.env, x.pa.plat);
  const reservada = ramReservadaMb(x);
  const haceFalta = x.pa.ramWorkerMb + x.pa.ramReservaMb;
  const r: Ram = { disp, reservada, haceFalta, motivo: "" };
  if (vivos === 0 || disp < 0) return r;
  if (disp - reservada >= haceFalta) return r;
  r.motivo = `RAM: disponible ${disp} MB, reservada ${reservada} MB (workers recién admitidos), hacen falta ${haceFalta} MB (costo ${x.pa.ramWorkerMb} + reserva ${x.pa.ramReservaMb})`;
  return r;
}

// ---------------------------------------------------------------- lugares, puestos y cola

export interface OpcionesPuesto {
  /** --leer: no toma puesto (sólo lugar). */
  leer?: boolean;
  /** --aca / --sucio-mio: el tree principal. */
  aca?: boolean;
  /** El ts de la corrida que se retoma (--seguir), o "-" (sesión guardada sin .ts), o vacío. */
  tsRetomada?: string;
  /** PA_ASYNC: con todo ocupado hace cola en vez de salir 75. */
  async?: boolean;
  /** Canal de control del puesto (`--parar` / `--matar` en Windows, ver base/lock.ts). */
  alMensaje?: AlMensaje;
}

/**
 * La admisión de una corrida: el lugar global (`@tope@k`), el puesto del proyecto y la cola. Guarda lo que el bash tenía en fds y
 * globales (fd 5, 6 y 9; `motivo_tope`, `ocupados_tope`, `cola_clase`).
 */
export class Admision {
  readonly x: Proyecto;
  readonly o: OpcionesPuesto;
  private candadoTope: Lock | null = null;
  private lugarLock: Lock | null = null;
  private puestoLock: Lock | null = null;
  /** El lugar global tomado (k), o "". */
  lugar = "";
  /** El puesto tomado ("1", "2"…, "aca"), o "". */
  puesto = "";
  motivoTope = "";
  ocupadosTope = 0;
  private colaClase = "";
  private colaSeg = 0;

  constructor(x: Proyecto, o: OpcionesPuesto = {}) {
    this.x = x;
    this.o = o;
  }

  private get async() {
    return this.o.async ?? !!this.x.pa.env.PA_ASYNC;
  }
  private lockOpc() {
    return { plat: this.x.pa.plat, env: this.x.pa.env };
  }
  /** `$LOCKDIR/@tope…` */
  private f(n: string) {
    return path.join(this.x.pa.lockdir, n);
  }

  /** ¿Tengo el puesto (el `tengo_lock` del bash)? */
  get tengoLock() {
    return this.puestoLock !== null;
  }
  /** `$lock`, `$run` y `$hb` del puesto tomado. */
  get lock() {
    return lockDePuesto(this.x, this.puesto);
  }
  get run() {
    return path.join(this.x.pa.state, `${this.x.slug}${sufPuesto(this.puesto)}.running`);
  }
  get hb() {
    return path.join(this.x.pa.state, `${this.x.slug}${sufPuesto(this.puesto)}.heartbeat`);
  }

  async soltarTope(): Promise<void> {
    const c = this.candadoTope;
    this.candadoTope = null;
    await c?.liberar();
  }
  async soltarLugar(): Promise<void> {
    const l = this.lugarLock;
    this.lugarLock = null;
    this.lugar = "";
    await l?.liberar();
    ramSoltar(this.x);
  }
  async soltarPuesto(): Promise<void> {
    const l = this.puestoLock;
    this.puestoLock = null;
    await l?.liberar();
  }
  /** `exec 9>&- 6>&-` (y el candado del tope si quedó): al salir. */
  async soltarTodo(): Promise<void> {
    await this.soltarPuesto();
    await this.soltarLugar();
    await this.soltarTope();
  }

  /**
   * `tomar_lugar`: bajo el candado `@tope`, sondea todos los lugares (el máximo k entre PA_TOPE y los `@tope@k` que existen), se
   * queda el primero libre y cuenta los ocupados más los workers sueltos. true = tomó lugar y el candado del tope QUEDA tomado
   * (hay que llamar a soltarTope); false = tope lleno o sin RAM (`motivoTope` dice cuál), nada tomado.
   */
  async tomarLugar(): Promise<boolean> {
    const pa = this.x.pa;
    tocar(this.f("@tope"));
    this.candadoTope = await tomar(this.f("@tope"), { ...this.lockOpc(), esperarMs: 30_000 });
    if (!this.candadoTope) return false;
    let max = pa.tope;
    try {
      for (const n of readdirSync(pa.lockdir)) {
        if (!n.startsWith("@tope@")) continue;
        const k = n.slice(n.lastIndexOf("@") + 1);
        if (/^[0-9]+$/.test(k) && Number(k) > max) max = Number(k);
      }
    } catch {
      /* sin lockdir no hay otros */
    }
    let mio: Lock | null = null;
    let mioK = "";
    let ocupados = 0;
    for (let k = 1; k <= max; k++) {
      tocar(this.f(`@tope@${k}`));
      const l = await tomar(this.f(`@tope@${k}`), this.lockOpc());
      if (!l) ocupados++;
      else if (!mio) {
        mio = l;
        mioK = String(k);
      } else await l.liberar();
    }
    const vivos = ocupados + workersSueltos(pa.state);
    if (mio && vivos < pa.tope) {
      const ram = ramAlcanza(this.x, vivos);
      if (!ram.motivo) {
        this.lugarLock = mio;
        this.lugar = mioK;
        ramReservar(this.x);
        return true;
      }
      this.motivoTope = ram.motivo;
    } else this.motivoTope = `tope global: ${pa.tope} workers vivos`;
    this.ocupadosTope = vivos;
    await mio?.liberar();
    await this.soltarTope();
    return false;
  }

  /** `tope_lleno_75`: en primer plano con el tope lleno o sin RAM. Sale 75. */
  topeLleno75(): never {
    const io = this.x.pa.io;
    if (this.motivoTope.startsWith("RAM:"))
      io.err(`pa: sin RAM para otro worker (${this.ocupadosTope} vivos entre todos los proyectos): ${this.motivoTope}.\n`);
    else
      io.err(`pa: tope global: ya hay ${this.ocupadosTope} worker(s) vivos entre todos los proyectos y el tope es ${this.x.pa.tope} (PA_TOPE):\n`);
    io.err(describirVivos(this.x.pa.state));
    io.err("pa: esperá uno con: pa --esperar <proyecto> --id <id>   o lanzalo con --async (hace cola y arranca solo).\n");
    return salir(75);
  }

  /** `escribir_cola`: el motivo de la cola (`<ts>.cola`), atómico, sólo al cambiar de clase o cada 5 s. */
  escribirCola(motivo: string): void {
    const clase = motivo.split(":")[0]!;
    const ahora = Date.now();
    if (clase === this.colaClase && ahora - this.colaSeg < 5000) return;
    const f = path.join(this.x.dir, `${this.x.ts}.cola`);
    try {
      writeFileSync(`${f}.tmp`, motivo);
      renameSync(`${f}.tmp`, f);
    } catch {
      return;
    }
    this.colaClase = clase;
    this.colaSeg = ahora;
  }
  /** Fuerza la próxima escritura de la cola (`cola_clase=""`). */
  reiniciarCola(): void {
    this.colaClase = "";
  }
  private sacarCola(): void {
    rmSync(path.join(this.x.dir, `${this.x.ts}.cola`), { force: true });
  }

  /** `esperar_lugar`: un --leer no toma puesto pero sí lugar. En primer plano sale 75; con --async hace cola. */
  async esperarLugar(): Promise<void> {
    while (!(await this.tomarLugar())) {
      if (!this.async) this.topeLleno75();
      this.escribirCola(this.motivoTope);
      await dormir(jitterCola());
    }
    await this.soltarTope();
    this.sacarCola();
  }

  /**
   * `tomar_puesto`: el lugar global y después el puesto. Corrida nueva: el primer puesto libre de 1..PA_PUESTOS; --seguir: el de
   * su corrida; --aca: el tree principal; sin git o sin commits: el 1. En primer plano sin lugar o sin puesto sale 75; con --async
   * hace cola. Deja `<ts>.puesto` apenas toma el puesto y limpia el `.running` de un worker muerto de ese puesto.
   */
  async tomarPuesto(): Promise<void> {
    const x = this.x;
    let pedido = "";
    if (!(await tieneHead(x))) pedido = "1";
    else if (this.o.aca) pedido = "aca";
    else if (this.o.tsRetomada) pedido = await puestoParaRetomar(x, this.o.tsRetomada);
    const cands = pedido ? [pedido] : Array.from({ length: x.pa.puestos }, (_, i) => String(i + 1));
    for (;;) {
      let motivo: string;
      if (await this.tomarLugar()) {
        for (const k of cands) {
          tocar(lockDePuesto(x, k));
          const l = await tomar(lockDePuesto(x, k), { ...this.lockOpc(), alMensaje: this.o.alMensaje });
          if (l) {
            this.puestoLock = l;
            this.puesto = k;
            break;
          }
        }
        if (this.puestoLock) {
          await this.soltarTope();
          break;
        }
        await this.soltarLugar();
        await this.soltarTope();
        motivo = pedido ? `esperando ${pedido === "aca" ? "el tree principal" : `el puesto ${pedido}`}` : `los ${cands.length} puestos ocupados`;
      } else {
        if (!this.async) this.topeLleno75();
        motivo = this.motivoTope;
      }
      if (!this.async) {
        const io = x.pa.io;
        if (pedido === "aca") io.err(`pa: ya hay un worker corriendo en el tree principal de '${x.slug}' (--aca o sin worktree):\n`);
        else if (pedido)
          io.err(`pa: ya hay un worker corriendo en el puesto ${pedido} de '${x.slug}', que es donde vive la rama de la corrida ${this.o.tsRetomada}:\n`);
        else io.err(`pa: ya hay un worker corriendo en cada uno de los ${cands.length} puesto(s) de '${x.slug}':\n`);
        io.err(describirPuestos(x, cands));
        io.err(`pa: esperá uno con: pa --esperar '${x.proyecto}' --id <id>   o lanzalo con --async (hace cola y arranca solo).\n`);
        salir(75);
      }
      this.escribirCola(motivo);
      await dormir(jitterCola());
    }
    mkdirSync(x.dir, { recursive: true });
    writeFileSync(path.join(x.dir, `${x.ts}.puesto`), this.puesto);
    this.sacarCola();
    // el .running de un worker anterior de ESTE puesto que murió sin limpiar: tenemos su lock, no hay nadie vivo ahí
    if (existsSync(this.run)) {
      rmSync(this.run, { force: true });
      rmSync(this.hb, { force: true });
    }
  }
}
