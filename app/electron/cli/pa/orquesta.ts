// Lanzar un worker de punta a punta (etapa 11 del port, motor/docs/port-windows-plan.md): lo que motor/bin/pa hace entre «Avisos al
// jefe» y `claude`, que las piezas de las etapas 6-8 no cubren solas: las comprobaciones de --seguir (conversación ya corriendo,
// caché frío, sesión compactada), el límite de sesión, la sesión (nueva o retomada), `claude --version`, --async, el lugar y el
// puesto, el worktree, los archivos sucios, --actualizar, y el armado de la `Corrida` que recibe `lanzarClaude`.
//
// Todos los motores: claude y ollama (el mismo claude CLI) por lanzarClaude; agy, codex y dsh/opencode por `ejecutarOtro`
// (otros-motores.ts). Lo que todavía no está en TS (relanzar por falta de cupo con reparto; esperar cupo con sin_cupo=esperar)
// corta ANTES de dejar rastro con `noPortado` (código 70): el envoltorio de motor/bin/pa vuelve al bash.
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { escribirAtomico } from "../base/archivo.ts";
import { correr } from "../base/proc.ts";
import { enPath, esEjecutable } from "../base/buscar.ts";
import { entornoCmd } from "../../binario.ts";
import { prefijoDe, repartoProceso } from "./programas.ts";
import { noPortado, type DeProyecto, type Proyecto as ProyectoCli } from "./cli.ts";
import { argsHijo, lanzarAsync } from "./async.ts";
import { armarActualizar } from "./auditar.ts";
import { esArchivo, idCorrida, leerCampo, leerTexto, listar } from "./corridas.ts";
import { jefeId, jefeNombre, type Env, type Pa } from "./entorno.ts";
import { carpetaProyectos, claudeFalla, claudeRc, escapar, limiteDe, lanzarClaude, type Corrida, type Ganchos, type OpcionesLanzar } from "./lanzar.ts";
import { TIPOS_VALIDOS } from "./modelos.ts";
import { Admision, avisarParalelo, otrosWriters, runningVivo } from "./puestos.ts";
import { ganchosDe } from "./ganchos.ts";
import { fijarProyecto as fijarProy } from "./ramas-base.ts";
import { campoJson, contarCompactaciones, horaMinuto, leerSalida, textoResultado } from "./resultado-lanzar.ts";
import { edadSucios, suciosDe } from "./sucios.ts";
import { prepararWorktree, type Proyecto as ProyectoWt } from "./worktrees.ts";
import type { Llamada } from "./politica.ts";
import { ORDEN_PARAR } from "./matar.ts";
import { Modelos } from "./modelos.ts";
import { dshProveedor, esOpencode } from "./motores/modelos.ts";
import { cuentaEnvDe, ejecutarOtro, esMotorOtro, localesDe } from "./otros-motores.ts";

export interface OpcionesOrquesta extends OpcionesLanzar {
  /** Ganchos que se suman a los propios (medir, tablero…). */
  ganchos?: Ganchos;
  /** Cuántas veces mirar (cada `pausaMs`) si el hijo de --async ya tomó puesto (default 100 × 100 ms). */
  vueltasAsync?: number;
  pausaAsyncMs?: number;
  /** Con qué se relanza `pa` para el hijo de --async (default: este node con este script). */
  comandoAsync?: string[];
}

const ahoraS = () => Math.floor(Date.now() / 1000);
const mtimeS = (f: string): number | null => {
  try {
    return Math.floor(statSync(f).mtimeMs / 1000);
  } catch {
    return null;
  }
};
const hay = (f: string) => existsSync(f);
/** `[[ -f f ]]`. */
const esArch = (f: string) => esArchivo(f);

/** Los transcripts `<sid>.jsonl` de la sesión bajo cualquier carpeta de proyecto, en el orden del glob. */
function transcriptsDe(pa: Pa, sid: string): string[] {
  const proj = carpetaProyectos(pa);
  return listar(proj)
    .map((d) => path.join(proj, d, `${sid}.jsonl`))
    .filter((f) => esArch(f));
}

/** `sesion_edad_min`: minutos desde el último uso de la sesión (mtime del transcript, o del archivo que guarda su id). "" si no hay. */
export function sesionEdadMin(pa: Pa, sid: string, archivo: string): number | null {
  let mejor: number | null = null;
  for (const f of transcriptsDe(pa, sid)) {
    const m = mtimeS(f);
    if (m !== null && (mejor === null || m > mejor)) mejor = m;
  }
  if (mejor === null) mejor = mtimeS(archivo);
  if (mejor === null) return null;
  return Math.floor((ahoraS() - mejor) / 60);
}

/** `seguir_compactada`: [cuántas veces compactó, si la última corrida de esa conversación terminó bien] o null. */
export function seguirCompactada(pa: Pa, dir: string, sfile: string, runId: string): { comp: number; terminada: boolean } | null {
  const sid = leerTexto(runId ? path.join(dir, `${runId}.sid`) : sfile);
  if (!sid) return null;
  let comp = "";
  for (const f of transcriptsDe(pa, sid)) {
    comp = contarCompactaciones(f);
    break;
  }
  if (!/^[0-9]+$/.test(comp) || Number(comp) <= 0) return null;
  let ultima = "";
  for (const n of listar(dir, (x) => x.endsWith(".sid"))) {
    const f = path.join(dir, n);
    if (esArch(f) && leerTexto(f) === sid) ultima = f.slice(0, -".sid".length);
  }
  let terminada = false;
  if (ultima && esArch(`${ultima}.json`)) {
    const j = leerSalida(`${ultima}.json`);
    if (j && campoJson(j, "subtype") === "success" && j.is_error !== true && textoResultado(j).split("\n").some((l) => l.includes("RESULTADO:"))) terminada = true;
  }
  return { comp: Number(comp), terminada };
}

/** `claude_sano`: `claude --version` (30 s). Devuelve el error si no anda. */
export async function claudeSano(pa: Pa, claude?: string): Promise<{ ok: boolean; error: string }> {
  const bin = claude ?? enPath("claude", [], pa.env, pa.plat) ?? "claude";
  const r = await correr(bin, ["--version"], { env: pa.env, timeoutMs: 30_000, killAfterMs: 1000, plat: pa.plat });
  return { ok: r.codigo === 0, error: `${r.salida}${r.errores}`.replace(/\n+$/, "") };
}

/** `tablero_mudo 2 ficha <slug> --corta`: la ficha del proyecto, o "" (sin tablero, si falla, si tarda más de 2 s). */
async function fichaDe(pa: Pa, slug: string): Promise<string> {
  const tb = prefijoDe(pa, "tablero", pa.env.PA_TABLERO, pa.env.PA_TABLERO || path.join(pa.bin, "tablero"));
  if (!esEjecutable(tb[tb.length - 1]!, pa.plat)) return "";
  if (!pa.env.TABLERO_DIR && pa.env.PA_STATE) return "";
  try {
    const r = await correr(tb[0]!, [...tb.slice(1), "ficha", slug, "--corta"], { env: entornoCmd(tb, pa.env), timeoutMs: 2000, killAfterMs: 1000, plat: pa.plat });
    return r.codigo === 0 ? r.salida.replace(/\n+$/, "") : "";
  } catch {
    return "";
  }
}

const corteBytes120 = (t: string) => {
  let s = "";
  let b = 0;
  for (const c of t) {
    b += Buffer.byteLength(c);
    if (b > 120) break;
    s += c;
  }
  return s;
};

/** `DeProyecto.lanzar`: ver el encabezado. */
export function lanzarProyecto(o: OpcionesOrquesta = {}): DeProyecto {
  return (l, pa, p) => orquestar(l, pa, p, o);
}

async function orquestar(l: Llamada, pa: Pa, p: ProyectoCli, o: OpcionesOrquesta): Promise<number> {
  const { io, state } = pa;
  const env = pa.env;
  const slug = p.slug;
  const dir = p.dir;
  const ruta = p.ruta;
  const sfile = p.sfile;
  const leer = l.leer;
  const modelos = new Modelos(env, io, pa.home, pa.plat);

  // --- lo que el pa de TS todavía no hace: corta antes de dejar rastro, y el envoltorio vuelve al bash
  const motor = l.motor;
  const conClaude = motor === "claude" || motor === "ollama";
  if (l.repartoTipoRelanzable || l.repartoEsperar || l.fbResto) return noPortado(pa, "relanzar por falta de cupo (reparto, -m a,b,c)");

  // --- --leer --seguir
  if (leer && l.seguir) {
    if (!l.runId) {
      io.err("pa: --leer --seguir necesita --id <corrida>: las corridas --leer no guardan un casillero de sesión (es del worker que escribe). El id lo imprime pa --async; ver también: pa --estado.\n");
      return 2;
    }
    const c = path.join(dir, `${l.runId}.corrida`);
    if (esArch(c) && leerCampo(c, "rama")) {
      io.err(`pa: la corrida ${l.runId} de '${slug}' escribió en su worktree (rama ${leerCampo(c, "rama")}); un --leer corre en el tree principal y no la ve. Retomala sin --leer.\n`);
      return 2;
    }
  }
  // La conversación que ya está corriendo en otro proceso no se retoma.
  if (l.seguir) {
    let sidPedido = "";
    if (l.runId) sidPedido = leerTexto(path.join(dir, `${l.runId}.sid`));
    else if (!leer) sidPedido = leerTexto(sfile);
    if (sidPedido) {
      const mios = listar(state, (n) => n === `${slug}.running` || (n.startsWith(`${slug}@`) && n.endsWith(".running")) || (n.startsWith(`${slug}.leer-`) && n.endsWith(".running")));
      for (const n of mios) {
        const f = path.join(state, n);
        if (!esArch(f) || !runningVivo(f) || leerCampo(f, "sid") !== sidPedido) continue;
        io.err(`pa: esa conversación ya está corriendo (${n}). Esperala con: pa --esperar '${l.proyecto}' --id ${leerCampo(f, "id")}\n`);
        return 75;
      }
    }
  }
  // El casillero `<slug>.session` es del último writer que terminó bien; si es de otro jefe se pide --id.
  if (l.seguir && !leer && !l.runId && esArch(`${sfile}.ts`)) {
    const tsCas = leerTexto(`${sfile}.ts`);
    const cc = path.join(dir, `${tsCas}.corrida`);
    if (tsCas && esArch(cc)) {
      const jCas = leerCampo(cc, "jefe_id");
      const yo = jefeId(pa);
      if (jCas && yo && jCas !== yo) {
        io.err(`pa: la última sesión guardada de '${slug}' (corrida ${tsCas}) es de otro jefe (${leerCampo(cc, "jefe")}). No la retomo sin --id: pa '${l.proyecto}' --seguir --id <tu corrida> '...'\n`);
        return 2;
      }
    }
  }

  // --- --seguir sobre una sesión de caché frío
  let frio = false;
  let frioMin = Number(/^[0-9]+$/.test(env.PA_CACHE_FRIO_MIN || "55") ? env.PA_CACHE_FRIO_MIN || "55" : "55");
  if (!Number.isFinite(frioMin)) frioMin = 55;
  if (l.seguir && frioMin > 0) {
    let fsid = "";
    let farch = "";
    if (l.runId) {
      farch = path.join(dir, `${l.runId}.sid`);
      fsid = leerTexto(farch);
    } else if (!leer) {
      farch = sfile;
      fsid = leerTexto(sfile);
    }
    if (fsid) {
      const edad = sesionEdadMin(pa, fsid, farch);
      if (edad !== null && edad > frioMin) {
        frio = true;
        io.err(`pa: sesión de hace ${edad >= 120 ? `${Math.floor(edad / 60)}h` : `${edad}min`}: caché frío, arranco nueva.\n`);
      }
    }
  }

  // --- --seguir sobre una sesión que ya compactó
  if (l.seguir && !frio) {
    const c = seguirCompactada(pa, dir, sfile, l.runId);
    if (c) {
      if (c.terminada && !l.force) {
        io.err(`pa: NO retomo: esa sesión de '${slug}' ya compactó ${c.comp} vez/veces. Retomarla arranca con el contexto casi lleno y vuelve a compactar enseguida (una tarea chica costó 5 compactaciones).\n`);
        io.err("pa: lanzá una corrida limpia con la tarea autocontenida (sin --seguir). Si de verdad necesitás ese hilo: agregá --force.\n");
        return 2;
      }
      if (!c.terminada) io.err(`pa: (esa sesión ya compactó ${c.comp} vez/veces; la retomo igual porque la corrida quedó sin cerrar)\n`);
    }
  }

  // --- límite de sesión conocido
  const limite = limiteDe(pa, l.cuentaUsada);
  if (motor === "claude" && esArch(limite)) {
    const hasta = leerTexto(limite);
    if (/^[0-9]+$/.test(hasta) && Number(hasta) > ahoraS()) {
      io.err(`pa: límite de sesión de la suscripción hasta las ${horaMinuto(Number(hasta), env.TZ)}. No lanzo.\n`);
      io.err(`pa: si creés que ya se liberó: rm ${limite}\n`);
      return 76;
    }
    rmSync(limite, { force: true });
  }

  // --- sesión: limpia por default
  let sid = "";
  let resume = false;
  let edadH: number | null = null;
  if (l.seguir && l.runId) {
    const f = path.join(dir, `${l.runId}.sid`);
    if (!esArch(f)) {
      io.err(`pa: no tengo el session_id de la corrida '${l.runId}' de '${slug}' (falta ${f}).\n`);
      return 1;
    }
    sid = leerTexto(f);
    resume = true;
    edadH = Math.floor((ahoraS() - (mtimeS(f) ?? ahoraS())) / 3600);
  } else if (l.seguir && esArch(sfile)) {
    sid = leerTexto(sfile);
    resume = true;
    edadH = Math.floor((ahoraS() - (mtimeS(sfile) ?? ahoraS())) / 3600);
  }
  let retomaTrabajo = resume;
  if (frio) {
    resume = false;
    retomaTrabajo = true;
  }
  if (!resume) sid = randomUUID();
  let tsRetomada = "";
  if (retomaTrabajo) {
    tsRetomada = l.runId || leerTexto(`${sfile}.ts`);
    if (!tsRetomada) tsRetomada = "-";
  }
  if (l.actualizar) tsRetomada = l.actualizar;

  // --- claude instalado y sano (el hijo de --async no lo repite)
  if (!env.PA_ASYNC && conClaude) {
    const s = await claudeSano(pa, o.claude);
    if (!s.ok) {
      const rc = claudeRc(pa);
      io.err(claudeFalla(pa, rc, s.error));
      return rc;
    }
  }

  // --- async: relanzarse desacoplado y volver
  if (l.async) {
    const x0: ProyectoWt = { pa, proyecto: l.proyecto, ruta, slug, dir, ts: "", motor };
    await lanzarAsync(pa, {
      proyecto: l.proyecto,
      slug,
      dir,
      leer,
      hijoArgs: argsHijo({
        proyecto: l.proyecto,
        modelo: l.modelo,
        tarea: l.tarea,
        leer,
        seguir: l.seguir,
        mcp: l.conMcp,
        maxTurns: l.maxTurns || 0,
        maxBudget: l.maxBudget,
        runId: l.runId,
        actualizar: l.actualizar,
        sucioMio: l.sucioMio,
        aca: l.aca,
        force: l.force,
        tipo: l.tipo,
        fase: l.fase,
        tareaId: l.tareaId,
        subtarea: l.subtarea,
        rubrica: l.rubrica,
        okDueno: l.okDueno,
        cuenta: l.cuenta,
        espejo: l.espejo,
        effortPedido: l.esfuerzoPedido,
      }),
      repartoTipo: l.repartoTipoRelanzable,
      fallbackResto: l.fbResto,
      comando: o.comandoAsync,
      avisarParalelo: (ts) => avisarParalelo({ ...x0, ts }, ts),
      vueltas: o.vueltasAsync,
      pausaMs: o.pausaAsyncMs,
    });
    return 0;
  }

  // --- puesto
  const ts = env.PA_TS || idCorrida();
  const tareaJefe = l.tarea;
  const lanzo = /^[a-z0-9_-]+$/.test(env.PA_ORIGEN || "jefe") ? env.PA_ORIGEN || "jefe" : "jefe";
  const xw: ProyectoWt = { pa, proyecto: l.proyecto, ruta, slug, dir, ts, motor };
  const parar = new AbortController();
  const adm = new Admision(xw, {
    leer,
    aca: l.aca,
    tsRetomada,
    async: Boolean(env.PA_ASYNC),
    alMensaje: (m) => {
      if (m.orden === ORDEN_PARAR.orden) parar.abort();
    },
  });
  let tengoLock = false;
  if (leer) {
    await adm.esperarLugar();
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${ts}.leer`), "");
    // sin lock nadie limpia el .running de un --leer que murió a lo bruto: cada --leer barre los muertos de su proyecto
    for (const n of listar(state, (x) => x.startsWith(`${slug}.leer-`) && x.endsWith(".running"))) {
      const f = path.join(state, n);
      if (esArch(f) && !runningVivo(f)) for (const g of [f, f.replace(/\.running$/, ".heartbeat"), `${f.replace(/\.running$/, ".heartbeat")}.turnos`]) rmSync(g, { force: true });
    }
  } else {
    await adm.tomarPuesto();
    tengoLock = adm.tengoLock;
  }
  const puesto = leer ? "" : adm.puesto;
  const run = leer ? path.join(state, `${slug}.leer-${ts}.running`) : adm.run;
  const hb = leer ? path.join(state, `${slug}.leer-${ts}.heartbeat`) : adm.hb;
  rmSync(`${hb}.turnos`, { force: true });

  // Todo camino de salida de acá para abajo deja el .ultimo (y el .listo de --async): es el trap de EXIT del bash.
  const salidaTemprana = async (rc: number): Promise<number> => {
    const linea = `salida=\nrc=${rc}\nsid=${sid}\n`;
    if (tengoLock) {
      await escribirAtomico(p.ult, linea).catch(() => {});
      if (env.PA_ASYNC) await escribirAtomico(path.join(dir, `${ts}.listo`), linea).catch(() => {});
    } else if (leer && env.PA_ASYNC) await escribirAtomico(path.join(dir, `${ts}.listo`), linea).catch(() => {});
    for (const f of [run, hb, `${hb}.turnos`]) rmSync(f, { force: true });
    await adm.soltarTodo();
    return rc;
  };

  try {
    // --- worktree
    const t = await prepararWorktree(xw, tsRetomada, puesto, { leer });
    if (t.codigo !== 0) return await salidaTemprana(t.codigo);
    if (!leer) avisarParalelo(xw, ts);

    // --- archivos sucios que ya había
    let sucios: string[] = [];
    if (!(l.seguir || l.sucioMio || leer)) sucios = await suciosDe(ruta, state, env);
    const baseDelta = t.usaWorktree ? [] : sucios;
    let tarea = l.tarea;
    if (sucios.length > 0 && t.usaWorktree) {
      io.err(`pa: el tree principal de '${slug}' tiene ${sucios.length} archivo(s) sin commitear${edadSucios(ruta, sucios)}. El worker no los ve: trabaja aislado en su worktree.\n`);
    } else if (sucios.length > 0) {
      tarea = `${tarea}\n\nAVISO DEL ORQUESTADOR: cuando arrancaste, el repo YA tenía ${sucios.length} archivos sin commitear\nde otra sesión. No son tuyos:\n${sucios.slice(0, 20).map((x) => `  ${x}\n`).join("")}No los toques ni los metas en tus commits: commiteá SOLO los archivos que tocaste, uno por\nuno. Si tu cambio cae encima de uno de esos, trabajá arriba de lo que hay y decilo en DECISION\nen vez de bundlearlo o revertirlo.`;
      io.err(`pa: '${slug}' arranca SUCIO: ${sucios.length} archivo(s) sin commitear que NO son de este worker${edadSucios(ruta, sucios)}.\n`);
      io.err("    Los va a esquivar, y gastar turnos en eso. Si es trabajo huérfano: commitealo, mandalo a una rama, o tiralo.\n");
    }

    // --- el transcript de una sesión retomada tiene que verse desde el cwd de la corrida
    const transcript = path.join(carpetaProyectos(pa), escapar(t.rutaTrabajo), `${sid}.jsonl`);
    if (resume && !hay(transcript)) {
      for (const f of transcriptsDe(pa, sid)) {
        if (lstatSync(f).isSymbolicLink()) continue;
        try {
          mkdirSync(path.dirname(transcript), { recursive: true });
          symlinkSync(f, transcript);
          io.err(`pa: el transcript de la sesión vivía en ${path.dirname(f)}; lo enlacé para retomarla desde ${t.rutaTrabajo}.\n`);
        } catch {
          /* `ln -s … 2>/dev/null` */
        }
        break;
      }
    }

    // --- --actualizar: la tarea es fija
    let actualizar: Corrida["actualizar"];
    if (l.actualizar) {
      const r = await armarActualizar(fijarProy(pa, l.proyecto, ruta), l.actualizar, { rama: t.rama, base: t.base, extra: tarea });
      tarea = r.tarea;
      actualizar = { shaMain: r.shaMain };
    }

    // --- lo que hereda un --seguir (o --actualizar) de la corrida que retoma
    let origen = "";
    const cRet = path.join(dir, `${tsRetomada}.corrida`);
    if (tsRetomada && tsRetomada !== "-" && esArch(cRet)) origen = leerCampo(cRet, "origen");
    if (!origen) origen = tsRetomada;
    if (origen === "-") origen = "";
    let tipo = l.tipo;
    let fase = l.fase;
    let tareaId = l.tareaId;
    let subtarea = l.subtarea;
    let rubrica = l.rub?.norm ?? "";
    const hRet = path.join(dir, `${tsRetomada}.hilo`);
    if (tsRetomada && esArch(hRet)) {
      if (!tipo) {
        tipo = leerCampo(hRet, "tipo");
        if (!new RegExp(`^(${TIPOS_VALIDOS})$`).test(tipo)) tipo = "";
      }
      fase ||= leerCampo(hRet, "fase");
      tareaId ||= leerCampo(hRet, "tarea_id");
      subtarea ||= leerCampo(hRet, "subtarea");
      if (!l.rubrica && !rubrica) rubrica = leerCampo(hRet, "rubrica");
    }

    // --- la ficha va en la TAREA (no en el contrato: el contrato es el prefijo del caché)
    // (a un agy, codex u opencode no: son los pendientes del dueño y lo que va a otra empresa no se recupera; dsh:ollama es local)
    const conFicha = motor === "claude" || motor === "ollama" || (motor === "dsh" && !esOpencode(l.modelo) && dshProveedor(l.modelo) === "ollama");
    const ficha = !resume && conFicha ? await fichaDe(pa, slug) : "";
    const paralelos = leer
      ? ""
      : otrosWriters(xw, ts)
          .map((w) => `- ${w.id} (${w.puesto === "aca" ? "tree principal" : `puesto ${w.puesto}`}): ${corteBytes120(w.tarea)}`)
          .join("\n");

    const cuentaEnv = cuentaEnvDe(l.cuentaEnv);
    const c: Corrida = {
      proyecto: l.proyecto,
      slug,
      ts,
      ruta,
      rutaTrabajo: t.rutaTrabajo,
      rama: t.rama,
      base: t.base,
      origen,
      puesto,
      leer,
      usaWorktree: t.usaWorktree,
      tengoLock,
      modelo: l.modelo,
      esfuerzo: l.esfuerzo,
      efVacio: l.efVacio,
      cuenta: l.cuentaUsada,
      cuentaEnv,
      tarea,
      tareaJefe,
      lanzo,
      tipo,
      fase,
      tareaId,
      rubrica,
      subtarea,
      sid,
      resume,
      conMcp: l.conMcp,
      maxTurns: l.maxTurns,
      maxBudget: l.maxBudget,
      espejo: l.espejo || undefined,
      actualizar,
      autocompact: conClaude ? modelos.autocompactDe(l.modelo, pa.autocompact) : "",
      ficha,
      modeloFlojo: !leer && Boolean(l.flojo),
      paralelos,
      baseDelta,
      edadH,
      jefe: jefeNombre(pa),
      jefeId: jefeId(pa),
      async: Boolean(env.PA_ASYNC),
      motor,
      local: motor === "ollama" ? { url: l.localUrl, modelo: l.localModelo } : undefined,
      ocEffort: l.ocEffort,
      locales: motor === "dsh" ? localesDe(modelos) : undefined,
    };
    const paRun: Pa = t.cargoTargetDir ? { ...pa, env: { ...env, CARGO_TARGET_DIR: t.cargoTargetDir } as Env } : pa;
    const g: Ganchos = ganchosDe(pa, l, {
      enfriar: (m) => repartoProceso(pa).enfriar?.(m, env.PA_ENFRIAR_HORAS) ?? Promise.resolve(),
      ...o.ganchos,
      soltar: async () => {
        await adm.soltarTodo();
        await o.ganchos?.soltar?.();
      },
    });
    // pa --parar / --matar: en Windows por el canal de control del lock; en Linux, SIGTERM
    const rc = await lanzarClaude(paRun, c, { ...o, ganchos: g, senal: o.senal ?? parar.signal, ejecutar: o.ejecutar ?? (esMotorOtro(motor) ? ejecutarOtro : undefined) });
    return rc;
  } finally {
    await adm.soltarTodo();
  }
}
