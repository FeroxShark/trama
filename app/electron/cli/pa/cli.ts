// El CLI de `pa` en TypeScript (etapa 5 del port, motor/docs/port-windows-plan.md): el despacho de los subcomandos globales
// (`pa --estado`, `pa --plan`…), el parseo de `pa <proyecto> [opciones] "<tarea>"`, la política de modelos y lo que pasa antes de
// lanzar (AGENTS.md, lecciones, --olvidar, --actualizar, --auditar, falta la tarea, avisos al jefe). Misma salida y mismos códigos
// que motor/bin/pa.
//
// Lo que hacen las etapas 6-10 (lanzar, puestos y worktrees, async/esperar/parar/matar, hilos/ramas/integrar/lecciones/auditar,
// otros motores) entra por `Deps`: cada subcomando es una función con su firma. Uno que todavía no está portado explica eso por
// stderr y sale 70, sin hacer nada a medias.
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { plataformaActual, type Plataforma } from "../../rutas.ts";
import { enPath } from "../base/buscar.ts";
import { git } from "../base/git.ts";
import { main as proyectoRutaMain, resolverProyecto } from "../proyecto-ruta.ts";
import { AYUDA } from "./ayuda.ts";
import { Salida, conDueno, jefeId, nombreDueno, paqueteApp, prologo, salir, type Env, type Io, type Pa } from "./entorno.ts";
import { Modelos } from "./modelos.ts";
import { correrLista, escanear, legible, opcionesIniciales, parsearOpciones } from "./opciones.ts";
import { aplicarPolitica, leerCampo, llamadaDe, modeloFlojo, slugDe, type DepsPolitica, type Llamada, type Motores } from "./politica.ts";
import { cuentasProceso, repartoProceso, type Cuentas, type Reparto } from "./programas.ts";
import { cmdRubrica } from "./rubrica.ts";

// ------------------------------------------------------------------------------------------- puntos de entrada

/** Un subcomando global (`pa --estado`, `pa --esperar <proy> …`): recibe los argumentos que siguen al flag. Devuelve el código. */
export type Subcomando = (args: string[], pa: Pa) => number | Promise<number>;

/** Los subcomandos globales, por el nombre de su `cmd_*` del bash. */
export interface Globales {
  estado: Subcomando;
  esperar: Subcomando;
  esperarTodos: Subcomando;
  bien: Subcomando;
  bienAuto: Subcomando;
  rinde: Subcomando;
  cupoGemini: Subcomando;
  modelos: Subcomando;
  geminiProyectos: Subcomando;
  revertir: Subcomando;
  parar: Subcomando;
  archivar: Subcomando;
  hilos: Subcomando;
  hilo: Subcomando;
  /** `pa --descartar <id>` (cmd_descartar_id). */
  descartarId: Subcomando;
  traspaso: Subcomando;
  proyectos: Subcomando;
  renombrar: Subcomando;
  limpiar: Subcomando;
}

/** Un proyecto ya resuelto (`fijar_proyecto`): las rutas de estado de `pa <proyecto> …`. */
export interface Proyecto {
  ruta: string;
  slug: string;
  /** `$STATE/<slug>` (ya creada). */
  dir: string;
  sfile: string;
  run: string;
  hb: string;
  ult: string;
  lock: string;
}

/** Un subcomando de `pa <proyecto> …` (ya pasó por el parseo y la política). Devuelve el código. */
export type DeProyecto = (l: Llamada, pa: Pa, p: Proyecto) => number | Promise<number>;

export interface DeProyectoTodos {
  matar: DeProyecto;
  /** `--integrar <id>` (el id está en `l.integrar`; `l.integrarTests`). */
  integrar: DeProyecto;
  /** `<proy> --descartar <id>` (cmd_descartar). */
  descartar: DeProyecto;
  ramas: DeProyecto;
  agentsMd: DeProyecto;
  unificarMd: DeProyecto;
  leccion: DeProyecto;
  lecciones: DeProyecto;
  leccionesPodar: DeProyecto;
  /** Lanzar el worker: todo lo que sigue a «Avisos al jefe» en el bash (--leer --seguir, sesión, async, puesto, worktree, correr…). */
  lanzar: DeProyecto;
}

export interface Deps {
  globales?: Partial<Globales>;
  proyecto?: Partial<DeProyectoTodos>;
  /** `--auditar <id|rama>`: arma la tarea del auditor (o corta con `Salida`). */
  auditar?: (l: Llamada, pa: Pa, p: Proyecto) => string | Promise<string>;
  reparto?: (pa: Pa) => Reparto;
  cuentas?: (pa: Pa) => Cuentas;
  motores?: Partial<Motores> | ((pa: Pa) => Partial<Motores>);
  /** Corre otro `pa` con esos argumentos y variables extra (los intentos de -m a,b,c); devuelve su código. */
  relanzar?: (argv: string[], extra: Env) => number | Promise<number>;
  plat?: Plataforma;
}

/** Lo que dice un subcomando que todavía vive sólo en el bash. */
export function noPortado(pa: Pa, que: string): number {
  pa.io.err(`pa: ${que} todavía no está en el pa de TypeScript (etapas 6-10 del port); por ahora va por el de bash.\n`);
  return 70;
}

// ------------------------------------------------------------------------------------------- piezas chicas del bash

/** La plantilla del brief (`pa --brief`). */
export const BRIEF_PLANTILLA = [
  "Objetivo: <qué tiene que quedar distinto, en 1-2 oraciones>",
  "Archivos: <rutas o carpetas donde trabajar, y qué leer primero>",
  "Listo cuando: <criterio observable de terminado>",
  "Cómo verificar: <comando exacto a correr y qué salida esperás>",
  "No tocar: <archivos, áreas o comportamientos que no se cambian>",
];

const dos = (n: number) => String(n).padStart(2, "0");
/** `date '+%Y-%m-%d %H:%M'`. */
const fechaMinuto = (d = new Date()) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ${dos(d.getHours())}:${dos(d.getMinutes())}`;
/** `date +%Y%m%d-%H%M%S`. */
const sello = (d = new Date()) => `${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}-${dos(d.getHours())}${dos(d.getMinutes())}${dos(d.getSeconds())}`;

/** `notas_de_jefe`: el archivo de notas del jefe de esta sesión. */
export function notasDeJefe(pa: Pa): string {
  const i = jefeId(pa).replace(/[^A-Za-z0-9._-]/g, "-");
  return path.join(pa.state, "jefe", `${i || "sin-jefe"}.notas`);
}

/** `anotar`: una línea con fecha en las notas del jefe (nada si el texto es sólo espacios). */
export function anotar(pa: Pa, texto: string): void {
  if (!texto.replace(/ /g, "")) return;
  const f = notasDeJefe(pa);
  mkdirSync(path.dirname(f), { recursive: true });
  appendFileSync(f, `${fechaMinuto()} · ${`${texto}\n`.replace(/\n/g, " ").replace(/ +$/, "")}\n`);
}

/** `brief_avisar`: lo que le falta al brief, por stderr. Nunca bloquea. */
export function avisarBrief(io: Io, tarea: string): void {
  const falta: string[] = [];
  if (!/listo\s+cuando/iu.test(tarea)) falta.push('"Listo cuando" (cómo se sabe que terminó)');
  if (!/c\S{1,2}mo\s+verificar/iu.test(tarea)) falta.push('"Cómo verificar" (el comando que prueba que anda)');
  if (!falta.length) return;
  io.err(
    `pa: aviso: a la tarea le falta ${falta.join(" y ")}. Sin eso el worker adivina y vos no podés comprobar su trabajo. Brief: Objetivo / Archivos / Listo cuando / Cómo verificar / No tocar (plantilla: pa --brief; desde un archivo: --brief-archivo F). No bloqueo.\n`,
  );
}

/** `ruta="$(proyecto-ruta "$proyecto")"` con `set -e`: la ruta, o el error de proyecto-ruta y `exit` con su código. */
function rutaOSalir(pa: Pa, proyecto: string): string {
  let out = "";
  const rc = proyectoRutaMain([proyecto], pa.env, { out: (s) => (out += s), err: pa.io.err });
  if (rc !== 0) salir(rc);
  return out.replace(/\n+$/, "");
}

/** `fijar_proyecto`. */
export function fijarProyecto(pa: Pa, ruta: string): Proyecto {
  const slug = slugDe(ruta);
  const dir = path.join(pa.state, slug);
  mkdirSync(dir, { recursive: true });
  return {
    ruta,
    slug,
    dir,
    sfile: path.join(pa.state, `${slug}.session`),
    run: path.join(pa.state, `${slug}.running`),
    hb: path.join(pa.state, `${slug}.heartbeat`),
    ult: path.join(pa.state, `${slug}.ultimo`),
    lock: path.join(pa.lockdir, slug),
  };
}

/** `espejo_colocar`: mueve el espejo a `<estado del proyecto>/espejos/<id>/` (donde el worker no lo ve) y devuelve la ruta final. */
function colocarEspejo(pa: Pa, proyecto: string, src: string): string {
  if (!legible(src)) {
    pa.io.err(`pa: --espejo '${src}' no es un archivo legible.\n`);
    salir(2);
  }
  const p = fijarProyecto(pa, rutaOSalir(pa, proyecto));
  if (src.startsWith(`${p.dir}/espejos/`)) return src;
  const dest = path.join(p.dir, "espejos", `${sello()}-${process.pid}`, path.basename(src));
  try {
    mkdirSync(path.dirname(dest), { recursive: true });
  } catch {
    salir(1);
  }
  try {
    try {
      renameSync(src, dest);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
      copyFileSync(src, dest);
      unlinkSync(src);
    }
  } catch {
    pa.io.err(`pa: no pude mover el espejo '${src}' a ${dest}.\n`);
    salir(1);
  }
  pa.io.err(`pa: espejo movido fuera de tareas/: ${dest} (pasale esta ruta al gate).\n`);
  return dest;
}

/** `pa --version`: la de app/package.json. */
function version(): string {
  try {
    const v = (JSON.parse(readFileSync(paqueteApp(), "utf8")) as { version?: unknown }).version;
    if (v !== null && v !== undefined && v !== false && v !== "") return typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    /* sin package.json */
  }
  return "desconocida";
}

// ------------------------------------------------------------------------------------------- main

const GLOBALES: Record<string, keyof Globales> = {
  "--estado": "estado",
  "--esperar": "esperar",
  "--esperar-todos": "esperarTodos",
  "--bien": "bien",
  "--bien-auto": "bienAuto",
  "--rinde": "rinde",
  "--cupo-gemini": "cupoGemini",
  "--modelos": "modelos",
  "--gemini-proyectos": "geminiProyectos",
  "--revertir": "revertir",
  "--parar": "parar",
  "--archivar": "archivar",
  "--hilos": "hilos",
  "--hilo": "hilo",
  "--descartar": "descartarId",
  "--traspaso": "traspaso",
  "--proyectos": "proyectos",
  "--renombrar": "renombrar",
  "--limpiar": "limpiar",
};
/** Los que no reciben argumentos (el bash no hace `shift; cmd "$@"`). */
const SIN_ARGS = new Set(["--estado", "--traspaso"]);

/** `pa …` entero. Devuelve el código de salida (nunca llama a `process.exit`). */
export async function main(argv: string[], env: Env, io: Io, deps: Deps = {}): Promise<number> {
  try {
    return await correrPa(argv, env, io, deps);
  } catch (e) {
    if (e instanceof Salida) return e.codigo;
    throw e;
  }
}

async function correrPa(argv: string[], env: Env, io: Io, deps: Deps): Promise<number> {
  const plat = deps.plat ?? plataformaActual();
  const pa = prologo(argv, env, io, plat);
  const modelos = new Modelos(env, io, pa.home, plat);
  const reparto = (deps.reparto ?? repartoProceso)(pa);
  const global = (k: keyof Globales, flag: string, args: string[]) => {
    const f = deps.globales?.[k];
    return f ? f(args, pa) : noPortado(pa, `pa ${flag}`);
  };

  const a0 = argv[0] ?? "";
  if (a0 in GLOBALES) return global(GLOBALES[a0]!, a0, SIN_ARGS.has(a0) ? [] : argv.slice(1));
  switch (a0) {
    case "--brief":
      io.out(`${BRIEF_PLANTILLA.join("\n")}\n`);
      return 0;
    case "--plan": {
      // `pa --plan max|pro`: lo corre el jefe cuando el dueño cambió de suscripción. Sin argumento dice el vigente.
      if (!argv[1]) {
        io.out(`plan: ${pa.plan}\n`);
        return 0;
      }
      const sub = argv[1].toLowerCase();
      if (["ausente", "presente", "gastar-hoy", "ahorrar-hoy", "ver", "borrar"].includes(sub)) {
        if (!reparto.ejecutable()) {
          io.err(`pa: no encuentro ${reparto.ruta}.\n`);
          return 1;
        }
        return reparto.plan(sub, argv.slice(2));
      }
      if (sub === "pro" || sub === "max") {
        writeFileSync(path.join(pa.state, "plan"), `${sub}\n`);
        io.out(
          `pa: plan ${sub} guardado en ${path.join(pa.state, "plan")}${sub === "pro" ? " (modo ahorro: opus effort medium, tope 100 turnos)" : " (opus con el effort de settings, tope 150)"}.\n`,
        );
        if (env.PA_PLAN && env.PA_PLAN.toLowerCase() !== sub) io.err(`pa: ojo, PA_PLAN=${env.PA_PLAN} en este entorno le gana al archivo.\n`);
        return 0;
      }
      io.err("uso: pa --plan [pro|max] | ausente <fecha>[,..] | gastar-hoy | ahorrar-hoy | ver | borrar\n");
      return 2;
    }
    case "--rubrica":
      return cmdRubrica(argv.slice(1), modelos, io);
    case "--nota":
      if (!argv[1]) {
        io.err(`uso: pa --nota "<texto>"  (pedido de ${nombreDueno(env, pa.home)}, decisión, qué sigue)\n`);
        return 2;
      }
      anotar(pa, argv[1]);
      io.out("pa: anotado.\n");
      return 0;
    case "--version":
      io.out(`pa ${version()}\n`);
      return 0;
    case "-h":
    case "--help":
    case "--ayuda":
      io.out(`${AYUDA.join("\n")}\n`);
      return 0;
  }

  if (argv.length < 1) {
    io.err('uso: pa <proyecto> "<tarea>"  |  pa --estado  |  pa --esperar <proyecto>\n');
    return 2;
  }
  const proyecto = argv[0]!;
  let args = argv.slice(1);
  // Forma documentada `pa <proyecto> --revertir|--parar|--archivar <id>`: resuelven el proyecto por el id.
  if (["--revertir", "--parar", "--archivar"].includes(args[0] ?? "")) return global(GLOBALES[args[0]!]!, args[0]!, args.slice(1));

  // Lo que le queda a una corrida --async de su lista -m (lo pasa el padre; no se hereda a los procesos del worker).
  const fbResto = env.PA_FALLBACK_RESTO ?? "";
  delete env.PA_FALLBACK_RESTO;
  const dueno = nombreDueno(env, pa.home);
  const esc = escanear(args, env, dueno);
  // --espejo se mueve una sola vez, antes de cualquier intento de -m a,b,c (los intentos reciben la ruta ya movida).
  if (esc.esp >= 0) {
    args = [...args];
    args[esc.esp] = colocarEspejo(pa, proyecto, args[esc.esp]!);
  }
  if (esc.ti >= 0 && !legible(args[esc.ti]!)) {
    io.err(`pa: --test-inline '${args[esc.ti]}' no se puede leer.\n`);
    return 2;
  }
  if (esc.m >= 0 && args[esc.m]!.includes(",")) {
    const relanzar = deps.relanzar;
    return correrLista(args, esc, modelos, io, {
      enfriado: (m) => reparto.enfriado(m),
      intento: (a, resto) => (relanzar ? relanzar([proyecto, ...a], { PA_FALLBACK_RESTO: resto }) : noPortado(pa, "relanzar pa (-m a,b,c)")),
    });
  }

  const o = parsearOpciones(args, opcionesIniciales(proyecto, env, pa.plan), { env, io, dueno, anotar: (t) => anotar(pa, t) });
  const l = llamadaDe(o);
  l.fbResto = fbResto;
  const motores = (typeof deps.motores === "function" ? deps.motores(pa) : deps.motores) ?? {};
  const sinMotor = (que: string) => async () => {
    salir(noPortado(pa, que));
    return "";
  };
  const depsPol: DepsPolitica = {
    modelos,
    reparto,
    cuentas: (deps.cuentas ?? cuentasProceso)(pa),
    motores: {
      chequearGemini: motores.chequearGemini ?? sinMotor("el chequeo de agy"),
      chequearCodex: motores.chequearCodex ?? sinMotor("el chequeo de codex"),
      chequearDsh: motores.chequearDsh ?? sinMotor("el chequeo de dsh/opencode"),
      estadoLocal: motores.estadoLocal ?? sinMotor("el chequeo del servidor local"),
    },
    proyectoRuta: (p) => {
      try {
        const r = resolverProyecto(p, env);
        return r.ok ? r.ruta : null;
      } catch {
        return null;
      }
    },
    claudeEnPath: () => enPath("claude", [], env, plat) !== null,
  };
  await aplicarPolitica(l, pa, depsPol);
  // Un líder de agy (Gemini) corta lo que sigue vivo al terminar la llamada de su herramienta de comandos o el turno: un worker en primer plano
  // moría con `error: interrupted` a los 3 min. Desde ahí todo worker sale `--async` (el aviso de Trama le dice al líder cuándo terminó).
  if (liderAgy(env) && l.lanza && !l.leer && !l.actualizar && !l.async && !env.PA_ASYNC) {
    l.async = true;
    io.err("pa: tu líder corre dentro de agy, que corta lo que sigue vivo al terminar la llamada o el turno: el worker sale en background (--async). Traé el resultado con pa --esperar.\n");
  }

  const p = fijarProyecto(pa, rutaOSalir(pa, proyecto));
  const dp = (k: keyof DeProyectoTodos, que: string) => {
    const f = deps.proyecto?.[k];
    return f ? f(l, pa, p) : noPortado(pa, que);
  };
  if (l.matar) return dp("matar", "pa <proyecto> --matar");
  if (l.integrar) return dp("integrar", "pa <proyecto> --integrar");
  if (l.descartar) return dp("descartar", "pa <proyecto> --descartar");
  if (l.ramas) return dp("ramas", "pa <proyecto> --ramas");
  if (l.agentsMd) return dp("agentsMd", "pa <proyecto> --agents-md");
  if (l.unificarMd) return dp("unificarMd", "pa <proyecto> --unificar-md");
  if (l.aplicar) {
    io.err("pa: --aplicar va con --unificar-md: pa <proy> --unificar-md --aplicar\n");
    return 2;
  }
  if (l.leccion) return dp("leccion", "pa <proyecto> --leccion");
  if (l.lecciones) return dp("lecciones", "pa <proyecto> --lecciones");
  if (l.leccionesPodar) return dp("leccionesPodar", "pa <proyecto> --lecciones-podar");
  if (l.olvidar) {
    rmSync(p.sfile, { force: true });
    io.out(`pa: sesión de '${p.slug}' descartada.\n`);
    return 0;
  }

  if (l.actualizar) {
    if (l.seguir || l.leer || l.aca) {
      io.err("pa: --actualizar no va con --seguir, --leer ni --aca: es una corrida limpia sobre la rama de esa corrida.\n");
      return 2;
    }
    const c = path.join(p.dir, `${l.actualizar}.corrida`);
    const rama = leerCampo(c, "rama");
    if (!legible(c) || !rama) {
      io.err(`pa: no hay una corrida '${l.actualizar}' de '${p.slug}' con rama propia (falta ${c} o corrió en el tree principal).\n`);
      return 2;
    }
    if ((await git(["-C", p.ruta, "rev-parse", "-q", "--verify", `refs/heads/${rama}`], { env })).codigo !== 0) {
      io.err(`pa: la rama ${rama} ya no existe (¿integrada o descartada?).\n`);
      return 2;
    }
  } else if (l.auditar) {
    if (!deps.auditar) return noPortado(pa, "pa <proyecto> --auditar");
    l.tarea = await deps.auditar(l, pa, p);
  } else if (!l.tarea) {
    io.err("pa: falta la tarea.\n");
    return 2;
  }

  // Avisos al jefe (stderr, nunca bloquean): brief incompleto y modelo de poca inteligencia. No los repite el hijo de --async.
  const calidad = l.lanza && !l.leer ? await modeloFlojo(pa, depsPol, l.modelo) : null;
  l.flojo = calidad !== null;
  if (l.lanza && !l.leer && !l.actualizar && !env.PA_ASYNC) {
    if (!l.seguir) avisarBrief(io, l.tarea);
    if (calidad !== null)
      io.err(
        `pa: aviso: '${l.modelo}' tiene inteligencia ${calidad} (< ${env.PA_CALIDAD_BAJA || "46"}, reparto --tabla): dale pasos numerados, comandos explícitos, un solo archivo o área, y partí lo grande en varias tareas. El worker recibe además la consigna de trabajar en pasos chicos y verificar tras cada cambio.\n`,
      );
  }
  return dp("lanzar", "lanzar un worker");
}

/** ¿`pa` lo llamó el líder de Gemini (agy-puente.ts pone `TRAMA_LIDER_AGY=1` en el entorno de agy)? */
export const liderAgy = (env: Env): boolean => env.TRAMA_LIDER_AGY === "1";

/** `D` del bash, para los módulos de las otras etapas. */
export const D = (pa: Pa, t: string) => conDueno(t, pa.env, pa.home);
