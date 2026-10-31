// Correr a un worker de agy, codex, dsh u opencode (etapa 10-11 del port, motor/docs/port-windows-plan.md): el `correr` de motor/bin/pa
// para esos motores. La política, el puesto, el worktree, el rastro (.running, .hilo, .corrida) y la clasificación de cómo terminó
// son los de `lanzarClaude`; acá sólo va lo que cambia: el programa, su argv y entorno (motores/llamada.ts), a dónde va su salida,
// el latido de los que no tienen hooks (codex, dsh, opencode) y la conversión del stream a `<ts>.json` (agy y codex; dsh y
// opencode lo deja su runner node). Sin bash, ps ni /proc: el runner de dsh/opencode se corre con este mismo node.
import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { enPath } from "../base/buscar.ts";
import type { Env, Pa } from "./entorno.ts";
import { mapaDe, type Corrida, type Lanzamiento, type OpcionesLanzar } from "./lanzar.ts";
import { chequearAgy, chequearCodex, chequearDsh, localEstado, type Local } from "./motores/chequeo.ts";
import { armarLlamada, conCuenta, type EntornoCuenta, type Llamada } from "./motores/llamada.ts";
import { esOpencode, Modelos } from "./modelos.ts";
import type { Llamada as LlamadaPa, Motores } from "./politica.ts";
import { escribirAgyJson, escribirCodexJson, latir } from "./motores/salida.ts";
import { type MotorSkills, sincronizarSkillsParaMotor } from "./skills-motores.ts";

/** Los motores que corren por acá (ollama es el claude de siempre contra el servidor local; ver lanzar.ts). */
export type MotorOtro = "agy" | "codex" | "dsh";
export const esMotorOtro = (m: string | undefined): m is MotorOtro => m === "agy" || m === "codex" || m === "dsh";

/** `cuenta_env` (`env -u A -u B K=V …`) como lo entienden `entornoClaude` y `armarLlamada`. */
export function cuentaEnvDe(a: string[]): { poner: Record<string, string>; quitar: string[] } {
  const poner: Record<string, string> = {};
  const quitar: string[] = [];
  for (let i = a[0] === "env" ? 1 : 0; i < a.length; i++) {
    if (a[i] === "-u" && a[i + 1] !== undefined) quitar.push(a[++i]!);
    else {
      const j = a[i]!.indexOf("=");
      if (j > 0) poner[a[i]!.slice(0, j)] = a[i]!.slice(j + 1);
    }
  }
  return { poner, quitar };
}

/** El `env -u A K=V …` de la cuenta, como lo entiende `armarLlamada`. */
function cuentaDe(c: Corrida): EntornoCuenta | undefined {
  const e = c.cuentaEnv;
  if (!e || (!e.quitar?.length && !Object.keys(e.poner ?? {}).length)) return undefined;
  return { sacar: e.quitar, poner: e.poner };
}

/** La llamada del motor para esta corrida (`armar_llamada`): programa, argv, entorno y rutas. */
export function llamadaDe(l: Lanzamiento): Llamada {
  const { pa, c } = l;
  const prompt = !c.resume && c.ficha ? `${c.tarea}\n\nDónde quedó este proyecto:\n${c.ficha}` : c.tarea;
  return armarLlamada({
    motor: c.motor as MotorOtro,
    modelo: c.modelo,
    contrato: l.contrato,
    prompt,
    rutaTrabajo: c.rutaTrabajo,
    ruta: c.ruta,
    rama: c.rama,
    dir: l.dir,
    ts: c.ts,
    hb: l.hb,
    mapaProy: mapaDe(pa, c.slug),
    leer: c.leer,
    actualizar: Boolean(c.actualizar),
    maxTurns: c.maxTurns,
    ocEffort: c.ocEffort,
    locales: c.locales,
    cuenta: cuentaDe(c),
    // bash exporta PA_RECORTE y PA_MAX_TURNS en el entorno de pa antes de armar la llamada: lo heredan todos los motores
    env: { ...pa.env, ...l.envClaude },
    io: pa.io,
    plat: pa.plat,
  });
}

/**
 * Un `.cmd` de npm (codex.cmd, agy.cmd en Windows) no se ejecuta sin shell, y por el shell la tarea (con saltos de línea y comillas) se
 * rompe: se busca el guion de node al que apunta y se corre con este node. null = no es un shim que se entienda.
 */
export function guionDeShim(bin: string): string | null {
  if (!/\.(cmd|bat)$/i.test(bin)) return null;
  try {
    const m = /%dp0%[\\/]+([^"\r\n]+?\.(?:c|m)?js)/i.exec(readFileSync(bin, "utf8"));
    if (!m) return null;
    const f = path.join(path.dirname(bin), m[1]!.replace(/\\/g, path.sep));
    return existsSync(f) ? f : null;
  } catch {
    return null;
  }
}

/** Qué se lanza: `node` es este node; lo demás, lo que dice el PATH del worker (sin shell). */
export function programaDe(ll: Llamada, plat: Pa["plat"]): { cmd: string; args: string[] } {
  if (ll.cmd === "node") return { cmd: process.execPath, args: ll.args };
  const bin = enPath(ll.cmd, [], ll.env, plat) ?? ll.cmd;
  if (/\.m?js$/i.test(bin)) return { cmd: process.execPath, args: [bin, ...ll.args] };
  const guion = plat === "win32" ? guionDeShim(bin) : null;
  return guion ? { cmd: process.execPath, args: [guion, ...ll.args] } : { cmd: bin, args: ll.args };
}

const limpio = (e: Env): NodeJS.ProcessEnv => {
  const r: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(e)) if (v !== undefined) r[k] = v;
  return r;
};

const NUM_SENAL: Record<string, number> = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 };
const aErr = (f: string, t: string) => {
  try {
    writeFileSync(f, t, { flag: "a" });
  } catch {
    /* nada */
  }
};

/** El motor que no carga las skills de Claude solo (agy, codex, y opencode por el dsh); null para los demás. */
const motorSkillsDe = (motor: string | undefined, modelo: string): MotorSkills | null =>
  motor === "agy" || motor === "codex" ? motor : motor === "dsh" && esOpencode(modelo) ? "opencode" : null;

/** `OpcionesLanzar.ejecutar` para agy, codex y dsh/opencode. */
export const ejecutarOtro: NonNullable<OpcionesLanzar["ejecutar"]> = (l, o) => {
  const ll = llamadaDe(l);
  const { pa, c } = l;
  const t0 = Date.now();
  for (const f of ll.borrarAntes) rmSync(f, { force: true });
  if (ll.tareaArchivo) writeFileSync(ll.tareaArchivo.ruta, ll.tareaArchivo.texto, { mode: 0o600 });
  // agy y codex: el stream crudo es el «transcript» de la corrida; dsh/opencode lo escribe su runner (stdout a la nada)
  const fo = ll.stdout ? openSync(ll.stdout, "w") : null;
  const fe = openSync(ll.stderr, "w");
  // Las skills de Claude que el motor no carga solo: se enlazan (sin las apagadas en Trama) antes de lanzarlo. Si falla, no frena la corrida.
  const motor = motorSkillsDe(c.motor, c.modelo);
  if (motor) {
    try {
      for (const f of sincronizarSkillsParaMotor(motor, pa.env, pa.home, pa.plat).fallidas) aErr(ll.stderr, `pa: no pude enlazar la skill ${f.nombre} para ${motor}: ${f.error}\n`);
    } catch (e) {
      aErr(ll.stderr, `pa: no pude sincronizar las skills para ${motor}: ${(e as Error).message}\n`);
    }
  }
  // opencode lee ~/.claude/skills por su cuenta (sin el apagado de Trama y con las de plugins repetidas): que sólo cuente lo enlazado acá
  const entorno = motor === "opencode" ? { ...ll.env, OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1" } : ll.env;
  return new Promise<number>((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    let listo = false;
    const fin = (rc: number) => {
      if (listo) return;
      listo = true;
      if (timer) clearInterval(timer);
      if (ll.tareaArchivo) rmSync(ll.tareaArchivo.ruta, { force: true });
      try {
        // `>"$out" 2>/dev/null || true`
        if (ll.json === "agy") escribirAgyJson({ transcript: ll.transcript, err: ll.stderr, modelo: c.modelo, rc, out: ll.out });
        if (ll.json === "codex") {
          const ultimo = path.join(l.dir, `${c.ts}.codex-ultimo`);
          escribirCodexJson({ transcript: ll.transcript, err: ll.stderr, modelo: c.modelo, rc, ultimo, segundos: Math.floor((Date.now() - t0) / 1000), out: ll.out });
        }
      } catch {
        /* queda sin .json: la clasificación mira el stderr */
      }
      resolve(rc);
    };
    try {
      const { cmd, args } = programaDe(ll, pa.plat);
      const h = spawn(cmd, args, { cwd: ll.cwd, env: limpio(entorno), stdio: ["ignore", fo ?? "ignore", fe], windowsHide: true });
      h.on("error", (e) => {
        aErr(ll.stderr, `pa: no pude lanzar ${ll.cmd}: ${e.message}\n`);
        fin(127);
      });
      h.on("exit", (code, sig) => fin(code ?? 128 + (sig ? (NUM_SENAL[sig] ?? 0) : 0)));
      if (h.pid) {
        o.alArrancar(h.pid);
        // codex, dsh y opencode no tienen hooks: pa escribe el latido mientras viven (agy lo hace su plugin)
        if (ll.latido) {
          const { tool, cadaS } = ll.latido;
          const vuelta = () => latir(tool, ll.transcript, l.hb);
          vuelta();
          timer = setInterval(vuelta, cadaS * 1000);
          timer.unref();
        }
      }
    } catch (e) {
      aErr(ll.stderr, `pa: no pude lanzar ${ll.cmd}: ${(e as Error).message}\n`);
      fin(127);
    } finally {
      if (fo !== null) closeSync(fo);
      closeSync(fe);
    }
  });
};

/** `locales` de modelos.json (los ollama:* con su url), o null si no hay archivo válido. */
export function localesDe(modelos: Modelos): Local[] | null {
  try {
    return modelos.cargar(true) ? (JSON.parse(modelos.clave("locales") || "[]") as Local[]) : null;
  } catch {
    return null;
  }
}

/** Los chequeos de agy, codex, dsh/opencode y del servidor local: privacidad, el programa, la sesión, la key (motores/chequeo.ts). */
export function motoresDe(pa: Pa): Partial<Motores> {
  const mudo = { out: () => {}, err: () => {} };
  const datos = (l: LlamadaPa) => ({ proyecto: l.proyecto, tarea: l.tarea, env: pa.env, plat: pa.plat });
  return {
    chequearGemini: async (_m, l) => {
      const e = cuentaEnvDe(l.cuentaEnv);
      return chequearAgy({ ...datos(l), envCuenta: conCuenta(pa.env, { sacar: e.quitar, poner: e.poner }) });
    },
    chequearCodex: async (_m, l) => chequearCodex(datos(l)),
    chequearDsh: (m, l) => chequearDsh(m, { ...datos(l), locales: localesDe(new Modelos(pa.env, mudo, pa.home, pa.plat)) }),
    estadoLocal: (url, modelo) => localEstado(url, modelo, pa.env),
  };
}
