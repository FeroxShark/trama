// El modo Objetivo (`pa <proy> --objetivo "<meta>" --verificar "<comando>" [--intentos N] [--tope-cupo P]`): lanza un worker con la meta;
// cuando termina, corre el comando verificador en SU worktree; si falla, relanza el worker con --seguir pasándole las últimas ~80 líneas
// de la salida y «el verificador falló, arreglalo»; repite hasta que pase, hasta N intentos (default 3) o hasta que el cupo libre de su
// modelo baje de P % (default 10). Deja un RESULTADO final con los intentos y la salida del último verificador.
//
// Cada intento es un `pa` entero (el que ya sabe de puestos, ramas y límites): acá sólo se arman sus argumentos y se lo relanza
// (`Deps.relanzar`). El primero lleva el id de la corrida (PA_TS), así que el log, el .corrida y el .listo de ese id son los del objetivo.
// Con --async el bucle corre desacoplado como cualquier worker (lanzarAsync) y su stdout es el `<id>.log`; en primer plano el mismo
// rastro se agrega a `<id>.log`. TypeScript puro: en Windows no hay bash (el verificador va por cmd.exe).
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { escribirAtomico } from "../base/archivo.ts";
import { correr } from "../base/proc.ts";
import { lanzarAsync } from "./async.ts";
import { idCorrida } from "./corridas.ts";
import type { Env, Pa } from "./entorno.ts";
import { cupoLibreDe, leerCampo, type Llamada } from "./politica.ts";
import type { Proyecto } from "./cli.ts";
import type { Reparto } from "./programas.ts";

/** Salida de `pa`: se agotaron los intentos sin que el verificador pasara / el cupo del modelo bajó del tope. */
export const RC_INTENTOS_AGOTADOS = 94;
export const RC_CUPO_BAJO = 99;

/** Cuántas líneas de la salida del verificador se le pasan al worker (y van al RESULTADO). */
export const LINEAS_VERIFICADOR = 80;
const MAX_CHARS = 12_000;

export interface DepsObjetivo {
  /** Corre otro `pa` con esos argumentos y variables extra; devuelve su código (el `Deps.relanzar` de cli.ts). */
  relanzar?: (argv: string[], extra: Env) => number | Promise<number>;
  reparto: Reparto;
  /** Con qué se relanza `pa` para --async (default: este mismo node con este mismo script) y cuánto esperar a que tome puesto. */
  comando?: string[];
  /** Integra la rama de un intento (`--integrar <id> --tests`); default: relanza este mismo `pa` con eso. Los tests lo inyectan. */
  integrar?: (id: string) => number | Promise<number>;
  vueltasAsync?: number;
  pausaAsyncMs?: number;
}

/** Las últimas `n` líneas de un texto (y no más de MAX_CHARS caracteres), sin líneas vacías al final. */
export function ultimasLineas(texto: string, n = LINEAS_VERIFICADOR): string {
  const ls = texto.replace(/\r/g, "").replace(/\s+$/, "").split("\n");
  let t = ls.slice(-n).join("\n");
  if (t.length > MAX_CHARS) t = `…${t.slice(-MAX_CHARS)}`;
  return t;
}

/** Los flags de la llamada (sin la tarea ni el modo Objetivo) que se le pasan a cada intento. */
function banderas(l: Llamada): string[] {
  const a: string[] = [l.proyecto];
  if (l.modeloDeM && l.modelo) a.push("-m", l.modelo);
  if (l.exacto) a.push("--exacto");
  if (l.esfuerzoPedido) a.push("--effort", l.esfuerzoPedido);
  a.push("--max-turns", l.maxTurns || "0");
  if (l.conMcp) a.push("--mcp");
  if (l.maxBudget) a.push("--max-budget-usd", l.maxBudget);
  if (l.actualizar) a.push("--actualizar", l.actualizar);
  if (l.sucioMio) a.push("--sucio-mio");
  else if (l.aca) a.push("--aca");
  if (l.force) a.push("--force");
  if (l.tipo) a.push("--tipo", l.tipo);
  if (l.indivisible) a.push("--indivisible", l.indivisible);
  if (l.fase) a.push("--fase", l.fase);
  if (l.tareaId) a.push("--tarea", l.tareaId);
  if (l.subtarea) a.push("--subtarea", l.subtarea);
  if (l.rubrica) a.push("--rubrica", l.rubrica);
  if (l.okDueno) a.push("--ok-dueno");
  if (l.cuenta) a.push("--cuenta", l.cuenta);
  if (l.espejo) a.push("--espejo", l.espejo);
  if (l.sinJefe) a.push("--sin-jefe");
  return a;
}

/** Los argumentos del hijo desacoplado de --async: lo mismo, con el modo Objetivo y sin --async. */
export function argvObjetivo(l: Llamada): string[] {
  return [
    ...banderas(l),
    "--objetivo", l.objetivo,
    "--verificar", l.verificar,
    "--intentos", String(l.intentos),
    "--tope-cupo", String(l.topeCupo),
    ...(l.integrarSiPasa ? ["--integrar-si-pasa"] : []),
    ...(l.tarea ? ["--", l.tarea] : []),
  ];
}

/** La tarea del primer intento: la meta, con el «Listo cuando» y el «Cómo verificar» del brief (el comando es el del verificador). */
export function tareaDelObjetivo(l: Llamada): string {
  const brief = `${l.objetivo.trim()}\n\nListo cuando: el comando de verificación sale con código 0.\nCómo verificar: ${l.verificar.trim()}`;
  return l.tarea ? `${brief}\n\nContexto del jefe: ${l.tarea}` : brief;
}

/** Lo que se le dice al worker cuando el verificador falló. */
export function mensajeDeFalla(l: Llamada, rc: number, salida: string): string {
  return [
    `El verificador falló (código ${rc}), arreglalo.`,
    `Meta: ${l.objetivo.trim()}`,
    `Comando que verifica (corre en tu worktree): ${l.verificar.trim()}`,
    `Salida (últimas ${LINEAS_VERIFICADOR} líneas):`,
    "```",
    salida || "(sin salida)",
    "```",
    "Corregí lo que haga falta, corré ese comando hasta que salga 0, commiteá y reportá con el formato de siempre.",
  ].join("\n");
}

/** Los argumentos de un `--seguir` sobre el intento anterior: mismo modelo (la sesión es de ése) y mismo esfuerzo. */
function argvSeguir(l: Llamada, previo: string, modelo: string, effort: string, mensaje: string): string[] {
  const a: string[] = [l.proyecto, "--seguir", "--id", previo];
  if (modelo) a.push("-m", modelo, "--exacto");
  if (effort && effort !== "settings" && effort !== "-") a.push("--effort", effort);
  a.push("--max-turns", l.maxTurns || "0");
  if (l.conMcp) a.push("--mcp");
  if (l.maxBudget) a.push("--max-budget-usd", l.maxBudget);
  if (l.okDueno) a.push("--ok-dueno");
  if (l.sinJefe) a.push("--sin-jefe");
  a.push("--", mensaje);
  return a;
}

/** Corre el comando verificador en `cwd` por el intérprete de la plataforma (sh en Linux; cmd.exe en Windows: nada de bash). */
async function correrVerificador(pa: Pa, cmd: string, cwd: string): Promise<{ rc: number; salida: string }> {
  const win = pa.plat === "win32";
  const tope = Number(pa.env.PA_OBJETIVO_TOPE_S || "1800") * 1000;
  const r = await correr(win ? pa.env.ComSpec || "cmd.exe" : "/bin/sh", win ? ["/d", "/s", "/c", `"${cmd}"`] : ["-c", cmd], {
    cwd,
    env: pa.env,
    timeoutMs: tope,
    killAfterMs: 5000,
    plat: pa.plat,
    verbatim: win,
  });
  const extra = r.error ? `\n${r.error.message}` : r.agotado ? `\n(el verificador pasó el tope de ${Math.round(tope / 1000)} s y se cortó)` : "";
  return { rc: r.codigo, salida: `${r.salida}${r.errores}${extra}` };
}

/** Un id libre para el intento siguiente (el pid de este proceso se repite dentro del mismo segundo). */
function idNuevo(dir: string, usados: Set<string>): string {
  let k = process.pid;
  for (;;) {
    const id = idCorrida(k++);
    if (!usados.has(id) && !existsSync(path.join(dir, `${id}.sid`)) && !existsSync(path.join(dir, `${id}.corrida`))) return id;
  }
}

/** `pa <proy> --objetivo …`: devuelve el código de salida de `pa`. */
export async function correrObjetivo(l: Llamada, pa: Pa, p: Proyecto, d: DepsObjetivo): Promise<number> {
  const { io } = pa;
  const hijoAsync = Boolean(pa.env.PA_ASYNC);
  if (!d.relanzar) {
    io.err("pa: el modo Objetivo necesita relanzar pa y este entorno no puede.\n");
    return 70;
  }
  if (l.async && !hijoAsync) {
    await lanzarAsync(pa, {
      proyecto: l.proyecto,
      slug: p.slug,
      dir: p.dir,
      leer: false,
      hijoArgs: argvObjetivo(l),
      comando: d.comando,
      vueltas: d.vueltasAsync,
      pausaMs: d.pausaAsyncMs,
    });
    return 0;
  }

  mkdirSync(p.dir, { recursive: true });
  const id = pa.env.PA_TS || idCorrida();
  const archivoLog = path.join(p.dir, `${id}.log`);
  // En el hijo de --async el stdout YA es el .log; en primer plano el rastro se copia ahí.
  const decir = (t: string) => {
    io.out(t);
    if (!hijoAsync) {
      try {
        appendFileSync(archivoLog, t);
      } catch {
        /* sin log no se corta el objetivo */
      }
    }
  };

  const usados = new Set<string>([id]);
  const intentos: { ts: string; rc: number }[] = [];
  let ts = id;
  let ultimo: { rc: number; salida: string; cwd: string } | null = null;
  let motivo = "";
  let codigo = 0;
  let cumplido = false;
  let modelo = l.modeloDeM ? l.modelo : "";
  let effort = l.esfuerzoPedido;

  for (let n = 1; n <= l.intentos; n++) {
    const argv =
      n === 1
        ? // --actualizar tiene su tarea fija (rebasear): la meta sólo guía los reintentos y lo del jefe va de contexto
          [...banderas(l), ...(l.actualizar ? (l.tarea ? ["--", l.tarea] : []) : ["--", tareaDelObjetivo(l)])]
        : argvSeguir(l, intentos[n - 2]!.ts, modelo, effort, mensajeDeFalla(l, ultimo!.rc, ultimaSalida(ultimo!.salida)));
    decir(`— objetivo: intento ${n} de ${l.intentos} (corrida ${ts})\n`);
    // PA_ASYNC vacío: el intento corre en primer plano dentro de este bucle (el .listo de este id lo deja el bucle, no el intento).
    const rc = await d.relanzar(argv, { PA_TS: ts, PA_ASYNC: "" });
    intentos.push({ ts, rc });
    const hilo = path.join(p.dir, `${ts}.hilo`);
    modelo = leerCampo(hilo, "modelo") || modelo;
    effort = leerCampo(hilo, "effort") || effort;
    if (rc !== 0) {
      decir(`— objetivo: el intento ${n} terminó con código ${rc}: no corro el verificador.\n`);
      motivo = `el intento ${n} del worker terminó con código ${rc} antes de verificar`;
      codigo = rc;
      break;
    }
    const trabajo = leerCampo(path.join(p.dir, `${ts}.corrida`), "ruta_trabajo");
    const cwd = trabajo && existsSync(trabajo) ? trabajo : p.ruta;
    const v = await correrVerificador(pa, l.verificar, cwd);
    ultimo = { rc: v.rc, salida: v.salida, cwd };
    decir(`— objetivo: verificador del intento ${n}: código ${v.rc}\n${ultimaSalida(v.salida)}\n`);
    if (v.rc === 0) {
      cumplido = true;
      break;
    }
    if (n === l.intentos) {
      motivo = `se agotaron los ${l.intentos} intentos sin que el verificador pasara`;
      codigo = RC_INTENTOS_AGOTADOS;
      break;
    }
    const libre = await cupoDe(d.reparto, modelo);
    if (libre !== null && libre < l.topeCupo) {
      motivo = `el cupo libre de ${modelo} (${Math.round(libre)} %) bajó del tope de ${l.topeCupo} %: no relanzo`;
      codigo = RC_CUPO_BAJO;
      break;
    }
    ts = idNuevo(p.dir, usados);
    usados.add(ts);
  }

  let linea = "";
  if (l.integrarSiPasa) {
    const r = cumplido ? await integrarIntento(l, d, intentos[intentos.length - 1]!.ts) : { rc: codigo, motivo: "el objetivo no se cumplió" };
    linea = lineaIntegracion(r.rc, r.motivo, cumplido);
    if (cumplido) codigo = r.rc;
  }
  const texto = resultadoFinal(l, { cumplido, motivo, intentos, ultimo }) + linea;
  decir(`${texto}\n`);
  // Para `pa --esperar`: el resultado como un .json de una línea y el .listo con el código (sólo el hijo de --async tiene quien lo espere).
  if (hijoAsync) {
    const out = path.join(p.dir, `${id}.objetivo.json`);
    try {
      writeFileSync(out, JSON.stringify({ result: texto }));
      await escribirAtomico(path.join(p.dir, `${id}.listo`), `salida=${out}\nrc=${codigo}\nsid=\n`);
    } catch {
      /* sin .listo la espera se entera por el pid muerto */
    }
  }
  return codigo;
}

/** Por qué se negó `--integrar` según su código de salida (los de `pa --ayuda`). */
export function motivoIntegracion(rc: number): string {
  switch (rc) {
    case 93: return "los tests del registry dieron rojo sobre la rama rebaseada";
    case 79: return "--integrar se negó";
    case 80: return "--integrar chocó con lo que entró a la rama principal";
    case 83: return "la rama trae un symlink peligroso";
    case 86: return "la corrida dejó trabajo sin commitear en su worktree";
    default: return "--integrar no terminó bien (el motivo está en su salida de arriba)";
  }
}

/** Integra con lo existente: `pa <proy> --integrar <id> --tests` (inyectable). */
async function integrarIntento(l: Llamada, d: DepsObjetivo, id: string): Promise<{ rc: number; motivo: string }> {
  const integrar = d.integrar ?? ((i: string) => d.relanzar!([l.proyecto, "--integrar", i, "--tests"], { PA_TS: "", PA_ASYNC: "" }));
  let rc: number;
  try {
    rc = await integrar(id);
  } catch (e) {
    return { rc: 1, motivo: `--integrar falló: ${e instanceof Error ? e.message : String(e)}` };
  }
  return { rc, motivo: rc === 0 ? "" : motivoIntegracion(rc) };
}

/** La última línea: «integrada» o «no integrada: rc N, motivo». */
export function lineaIntegracion(rc: number, motivo: string, cumplido = true): string {
  return rc === 0 && cumplido ? "\nintegrada" : `\nno integrada: rc ${rc}, ${motivo}`;
}

const ultimaSalida = (s: string) => ultimasLineas(s, LINEAS_VERIFICADOR);

async function cupoDe(reparto: Reparto, modelo: string): Promise<number | null> {
  if (!modelo || !reparto.ejecutable()) return null;
  try {
    return cupoLibreDe(await reparto.tabla(), modelo);
  } catch {
    return null;
  }
}

/** El RESULTADO del objetivo: cuántos intentos hizo y la salida del último verificador (con VERIFICACION, para que no salga «SIN VERIFICAR»). */
export function resultadoFinal(
  l: Llamada,
  r: { cumplido: boolean; motivo: string; intentos: { ts: string; rc: number }[]; ultimo: { rc: number; salida: string; cwd: string } | null },
): string {
  const n = r.intentos.length;
  const cuantos = `${n} ${n === 1 ? "intento" : "intentos"} de ${l.intentos}`;
  const ids = r.intentos.map((i) => i.ts).join(", ");
  const verif = r.ultimo
    ? `VERIFICACION: \`${l.verificar.trim()}\` en ${r.ultimo.cwd} → código ${r.ultimo.rc}\n${ultimaSalida(r.ultimo.salida) || "(sin salida)"}`
    : `VERIFICACION: ninguna, el verificador no llegó a correr (\`${l.verificar.trim()}\`)`;
  const cabeza = r.cumplido
    ? `RESULTADO: objetivo cumplido, el verificador pasó (${cuantos}). Meta: ${l.objetivo.trim()}`
    : `RESULTADO: objetivo NO cumplido: ${r.motivo} (${cuantos}). Meta: ${l.objetivo.trim()}`;
  return `${cabeza}\nINTENTOS: ${ids}\n${verif}`;
}
