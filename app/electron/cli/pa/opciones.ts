// El parseo de `pa <proyecto> [opciones] "<tarea>"`: port del bloque «parseo de argumentos» de motor/bin/pa (el escaneo de -m a,b,c,
// el `while` de las opciones y los chequeos que vienen justo después). Mismos mensajes y códigos de salida: cada error escribe por
// `io.err` y tira `Salida` (el `exit` del bash).
import { accessSync, constants, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { salir, type Env, type Io } from "./entorno.ts";
import type { Modelos } from "./modelos.ts";

/** Los flags que llevan valor (`flags_con_valor` del bash). */
export const FLAGS_CON_VALOR = [
  "--max-turns", "--id", "--integrar", "--descartar", "--actualizar", "--nota", "--max-budget-usd", "-m", "--model", "--effort", "--tipo",
  "--fase", "--tarea", "--subtarea", "--rubrica", "--cuenta", "--brief-archivo", "--leccion", "--auditar", "--decisiones", "--espejo",
  "--test-inline",
];
export const EFFORTS_VALIDOS = /^(low|medium|high|xhigh|max)$/;

/** Todo lo que sale de las opciones (las variables del bash con el mismo nombre, en camelCase). */
export interface Opciones {
  proyecto: string;
  /** -m / --model (vacío = lo decide la política). */
  modelo: string;
  modeloDeM: boolean;
  /** El effort vigente: PA_EFFORT o --effort (en minúscula si vino por flag). */
  esfuerzo: string;
  esfuerzoFlag: boolean;
  /** El --effort que escribió el jefe (un relevo de la lista --async lo reusa). */
  esfuerzoPedido: string;
  leer: boolean;
  seguir: boolean;
  olvidar: boolean;
  matar: boolean;
  conMcp: boolean;
  async: boolean;
  /** "" = sin tope (--max-turns 0). */
  maxTurns: string;
  maxBudget: string;
  runId: string;
  sucioMio: boolean;
  aca: boolean;
  integrar: string;
  integrarTests: boolean;
  descartar: string;
  ramas: boolean;
  actualizar: string;
  force: boolean;
  tarea: string;
  tipo: string;
  fase: string;
  tareaId: string;
  subtarea: string;
  rubrica: string;
  okDueno: boolean;
  cuenta: string;
  briefArchivo: string;
  agentsMd: boolean;
  unificarMd: boolean;
  aplicar: boolean;
  lecciones: boolean;
  leccionesPodar: boolean;
  leccion: string;
  auditar: string;
  decisiones: string;
  espejo: string;
  testInline: string;
  sinJefe: boolean;
}

/** Los valores antes de mirar las opciones (lo que el bash toma del entorno y del plan). */
export function opcionesIniciales(proyecto: string, env: Env, plan: "pro" | "max"): Opciones {
  return {
    proyecto,
    modelo: "",
    modeloDeM: false,
    esfuerzo: env.PA_EFFORT ?? "",
    esfuerzoFlag: false,
    esfuerzoPedido: "",
    leer: false,
    seguir: false,
    olvidar: false,
    matar: false,
    conMcp: false,
    async: false,
    maxTurns: plan === "pro" ? "100" : "150",
    maxBudget: "",
    runId: "",
    sucioMio: false,
    aca: false,
    integrar: "",
    integrarTests: false,
    descartar: "",
    ramas: false,
    actualizar: "",
    force: false,
    tarea: "",
    tipo: env.PA_TIPO ?? "",
    fase: env.PA_FASE ?? "",
    tareaId: env.PA_TAREA ?? "",
    subtarea: env.PA_SUBTAREA ?? "",
    rubrica: "",
    okDueno: false,
    cuenta: "",
    briefArchivo: "",
    agentsMd: false,
    unificarMd: false,
    aplicar: false,
    lecciones: false,
    leccionesPodar: false,
    leccion: "",
    auditar: "",
    decisiones: "",
    espejo: "",
    testInline: "",
    sinJefe: false,
  };
}

/** ¿Es el alias viejo de --ok-dueno? (`--ok-<dueño en minúscula>` o `--ok-$USER`). */
export const esAliasOk = (a: string, dueno: string, env: Env) =>
  a === `--ok-${dueno.replace(/[A-Z]/g, (c) => c.toLowerCase())}` || (!!env.USER && a === `--ok-${env.USER}`);

/** ¿Se puede leer como archivo? (`[[ -r f && -f f ]]`). */
export function legible(f: string): boolean {
  try {
    accessSync(f, constants.R_OK);
    return statSync(f).isFile();
  } catch {
    return false;
  }
}

/** `$(cat f)`: el contenido sin los saltos de línea del final. */
export const leerSinFinal = (f: string) => readFileSync(f, "utf8").replace(/\n+$/, "");

// ------------------------------------------------------------------------------------------- -m a,b,c

export interface Escaneo {
  /** Índice del valor de -m/--model en los argumentos (-1 = no hay). */
  m: number;
  esp: number;
  ti: number;
  /** El effort que va a regir (PA_EFFORT o el --effort, en minúscula). */
  ef: string;
  ok: boolean;
}

/** El primer recorrido (sólo la zona de flags, hasta la tarea): dónde están -m, --espejo y --test-inline, y si vino --ok-dueno. */
export function escanear(args: string[], env: Env, dueno: string): Escaneo {
  const r: Escaneo = { m: -1, esp: -1, ti: -1, ef: env.PA_EFFORT ?? "", ok: false };
  const n = args.length;
  let i = 0;
  while (i < n) {
    const a = args[i]!;
    if (a === "--") break;
    else if (a === "--effort") {
      if (i + 1 >= n) break;
      r.ef = args[i + 1]!.toLowerCase();
      i += 2;
    } else if (a === "--ok-dueno" || esAliasOk(a, dueno, env)) {
      r.ok = true;
      i += 1;
    } else if (a === "-m" || a === "--model" || a === "--espejo" || a === "--test-inline") {
      if (i + 1 >= n) break;
      if (a === "--espejo") r.esp = i + 1;
      else if (a === "--test-inline") r.ti = i + 1;
      else r.m = i + 1;
      i += 2;
    } else if (FLAGS_CON_VALOR.includes(a)) i += 2;
    else if (a.startsWith("-")) i += 1;
    else break;
  }
  return r;
}

/** `IFS=, read -r -a`: los modelos de una lista (un último campo vacío no cuenta, como en bash). */
export function partirLista(v: string): string[] {
  const l = v.split("\n")[0]!.split(",");
  if (l.length > 1 && l[l.length - 1] === "") l.pop();
  return l;
}

export interface DepsLista {
  /** `reparto --enfriado <m>`: hasta cuándo, o null si no está enfriado (o reparto no contesta). */
  enfriado: (modelo: string) => string | null | Promise<string | null>;
  /** Corre este mismo `pa` con esos argumentos (después del proyecto) y PA_FALLBACK_RESTO; devuelve su código. */
  intento: (args: string[], resto: string) => number | Promise<number>;
}

/**
 * -m a,b,c: prueba cada modelo, en orden, como una corrida entera; 76/77/95/96/97 pasan al siguiente y cualquier otro código es el
 * final. Devuelve el código de salida (el bash hace `exit` con él).
 */
export async function correrLista(args: string[], esc: Escaneo, modelos: Modelos, io: Io, deps: DepsLista): Promise<number> {
  const pedido = args[esc.m]!;
  const lista = partirLista(pedido);
  if (lista.some((x) => !x.replace(/\s/g, ""))) {
    io.err(`pa: -m '${pedido}': la lista tiene un modelo vacío (va a,b,c, sin espacios).\n`);
    return 2;
  }
  let rc = 96;
  let corrio = false;
  let apagados = 0;
  const a = [...args];
  for (let k = 1; k <= lista.length; k++) {
    const x = lista[k - 1]!;
    // Los que el dueño apagó en modelos.json (excluir, o el --effort pedido en efforts_permitidos) se saltean, salvo con --ok-dueno.
    if (!esc.ok) {
      const excl = modelos.excluidoPor(x);
      if (excl !== null) {
        io.err(`pa: -m: ${x} está excluido en modelos.json (excluir: ${excl}): lo salteo.\n`);
        apagados++;
        continue;
      }
      const ap = esc.ef ? modelos.effortApagado(x, esc.ef) : null;
      if (ap !== null) {
        io.err(`pa: -m: effort '${esc.ef}' con ${x} está apagado en modelos.json (efforts_permitidos: ${ap.replace(/ /g, ", ")}): lo salteo.\n`);
        apagados++;
        continue;
      }
    }
    const hasta = await deps.enfriado(x);
    if (hasta !== null) {
      io.err(`pa: -m: ${x} sigue enfriado hasta ${hasta} (cortó por límite): lo salteo.\n`);
      continue;
    }
    a[esc.m] = x;
    corrio = true;
    rc = await deps.intento(a, lista.slice(k).join(","));
    if ([76, 77, 95, 96, 97].includes(rc)) {
      if (k < lista.length) io.err(`pa: -m: ${x} salió ${rc} (sin cupo, sobrecargado o no puede correr); sigo con el siguiente de la lista.\n`);
    } else return rc;
  }
  if (!corrio) {
    if (apagados) {
      io.err(
        `pa: -m ${a[esc.m]}: todos los modelos de la lista están apagados en modelos.json (excluir o efforts_permitidos) o enfriados por límite de uso; no lanzo.\n`,
      );
      return 98;
    }
    io.err(`pa: -m ${a[esc.m]}: todos los modelos de la lista están enfriados por límite de uso; no lanzo.\n`);
  }
  return rc;
}

// ------------------------------------------------------------------------------------------- el while de las opciones

export interface CtxParseo {
  env: Env;
  io: Io;
  dueno: string;
  /** `--nota`: la anota al momento (va pegada a esta llamada, antes de cualquier otro chequeo). */
  anotar: (texto: string) => void;
}

/** El `while [[ $# -gt 0 ]]` de las opciones y los chequeos de después (--tests, --brief-archivo, --test-inline, --auditar, --decisiones). */
export function parsearOpciones(args: string[], o: Opciones, ctx: CtxParseo): Opciones {
  const { env, io } = ctx;
  const error = (msg: string): never => {
    io.err(`${msg}\n`);
    return salir(2);
  };
  let i = 0;
  while (i < args.length) {
    const a = args[i]!;
    const valor = args[i + 1] ?? "";
    if (FLAGS_CON_VALOR.includes(a) && args.length - i < 2) error(`pa: ${a} quiere un valor (ej: pa <proyecto> ${a} <valor> "<tarea>"). Mirá pa --help.`);
    const dos = () => (i += 2);
    switch (a) {
      case "--seguir": o.seguir = true; i++; break;
      case "--nuevo": i++; break; // ya es el default; se acepta para no romper scripts viejos
      case "--leer": o.leer = true; i++; break;
      case "--brief-archivo": o.briefArchivo = valor; dos(); break;
      case "--agents-md": o.agentsMd = true; i++; break;
      case "--unificar-md": o.unificarMd = true; i++; break;
      case "--aplicar": o.aplicar = true; i++; break;
      case "--lecciones": o.lecciones = true; i++; break;
      case "--lecciones-podar": o.leccionesPodar = true; i++; break;
      case "--leccion": o.leccion = valor; dos(); break;
      case "--auditar": o.auditar = valor; o.leer = true; dos(); break; // auditar es una corrida --leer
      case "--decisiones": o.decisiones = valor; dos(); break;
      case "--espejo": o.espejo = valor; dos(); break;
      case "--test-inline": o.testInline = valor; dos(); break;
      case "--olvidar": o.olvidar = true; i++; break;
      case "--matar": o.matar = true; i++; break;
      case "--mcp": o.conMcp = true; i++; break;
      case "--async": o.async = true; i++; break;
      case "--sin-jefe":
        o.sinJefe = true;
        env.PA_JEFE = "";
        env.PA_JEFE_ID = "";
        i++;
        break;
      case "--max-turns":
        if (!/^[0-9]+$/.test(valor)) error(`pa: --max-turns quiere un entero (0 = sin tope), no '${valor}'.`);
        o.maxTurns = BigInt(valor).toString();
        if (o.maxTurns === "0") o.maxTurns = "";
        dos();
        break;
      case "--id": o.runId = valor; dos(); break;
      case "--sucio-mio": o.sucioMio = true; o.aca = true; i++; break;
      case "--aca": o.aca = true; i++; break;
      case "--integrar": o.integrar = valor; dos(); break;
      case "--tests": o.integrarTests = true; i++; break;
      case "--descartar": o.descartar = valor; dos(); break;
      case "--actualizar": o.actualizar = valor; dos(); break;
      case "--ramas": o.ramas = true; i++; break;
      case "--force": o.force = true; i++; break;
      case "--nota": ctx.anotar(valor); dos(); break; // la nota del jefe va pegada a esta llamada
      case "--max-budget-usd":
        if (!/^[0-9]+([.][0-9]+)?$/.test(valor)) error(`pa: --max-budget-usd quiere un número en US$ (ej: 2.5), no '${valor}'.`);
        o.maxBudget = valor;
        dos();
        break;
      case "-m":
      case "--model":
        o.modelo = valor;
        o.modeloDeM = true;
        dos();
        break;
      case "--effort": {
        const e = valor.toLowerCase();
        if (!EFFORTS_VALIDOS.test(e)) error(`pa: --effort '${valor}' no va. Válidos: low, medium, high, xhigh, max.`);
        o.esfuerzo = e;
        o.esfuerzoFlag = true;
        o.esfuerzoPedido = e;
        env.PA_EFFORT = e;
        dos();
        break;
      }
      case "--tipo": o.tipo = valor; dos(); break;
      case "--fase": o.fase = valor; dos(); break;
      case "--tarea": o.tareaId = valor; dos(); break;
      case "--subtarea": o.subtarea = valor; dos(); break;
      case "--rubrica": o.rubrica = valor; dos(); break;
      case "--ok-dueno": o.okDueno = true; i++; break;
      case "--cuenta": o.cuenta = valor; dos(); break;
      case "--":
        o.tarea = args.slice(i + 1).join(" ");
        i = args.length;
        break;
      default:
        if (a.startsWith("-")) {
          // alias: --ok-<nombre del dueño en minúscula> (el nombre viejo del flag)
          if (esAliasOk(a, ctx.dueno, env)) {
            o.okDueno = true;
            i++;
          } else error(`pa: opción desconocida: ${a}`);
        } else {
          o.tarea = args.slice(i).join(" ");
          i = args.length;
        }
    }
  }
  if (o.integrarTests && !o.integrar) error("pa: --tests va con --integrar: pa <proy> --integrar <id> --tests");
  // --brief-archivo F: la tarea sale de un archivo; si además vino texto, va después como contexto.
  if (o.briefArchivo) {
    if (!legible(o.briefArchivo)) error(`pa: --brief-archivo '${o.briefArchivo}' no se puede leer.`);
    const brief = leerSinFinal(o.briefArchivo);
    if (!brief.replace(/\s/g, "")) error(`pa: --brief-archivo '${o.briefArchivo}' está vacío.`);
    o.tarea = o.tarea ? `${brief}\n\nContexto del jefe: ${o.tarea}` : brief;
  }
  // --test-inline F: el test congelado va pegado al final de la tarea (la cerca se alarga si el test trae backticks).
  if (o.testInline) {
    if (!legible(o.testInline)) error(`pa: --test-inline '${o.testInline}' no se puede leer.`);
    const test = leerSinFinal(o.testInline);
    let cerca = "```";
    while (test.includes(cerca)) cerca += "`";
    const base = path.basename(o.testInline);
    const lang = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : "";
    const bloque = `Test que tiene que pasar, no lo modifiques:\n${cerca}${lang}\n${test}\n${cerca}`;
    o.tarea = o.tarea ? `${o.tarea}\n\n${bloque}` : bloque;
  }
  // Auditar es una corrida de lectura: si el jefe no clasificó, es `lectura`.
  if (o.auditar && !o.tipo) o.tipo = "lectura";
  if (o.auditar && (o.seguir || o.aca || o.actualizar || o.integrar || o.descartar))
    error("pa: --auditar no va con --seguir, --aca, --actualizar, --integrar ni --descartar: es una corrida --leer nueva.");
  if (o.decisiones && !o.auditar) error("pa: --decisiones sólo va con --auditar (lo lee el auditor).");
  return o;
}
