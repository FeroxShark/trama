// Etapa 8 del port (motor/docs/port-windows-plan.md): lo que maneja corridas sin ser la corrida.
//   --async            relanzarse desacoplado (`lanzarAsync`) y volver apenas el hijo tomó puesto o hizo cola
//   --esperar          bloquear hasta que termine la corrida (o la más vieja del jefe) y entregar su resultado
//   --esperar-todos    cobrar todas las corridas async del jefe, de todos los proyectos
//   --estado           qué corre, qué está en cola, la RAM, las sesiones guardadas, lo sin verificar y los límites
//   --parar / --matar  en matar.ts
// Port de cmd_estado, cmd_esperar, cmd_esperar_todos y el bloque «async: relanzarse desacoplado» de motor/bin/pa: mismos textos,
// mismos códigos y los mismos archivos de estado. Lo prueban tests/cli-pa-async.test.ts y los casos `pa-async` de paridad.
//
// Corre suelto (`node async.ts --estado`, `--esperar …`, `--esperar-todos …`, `--parar <id>`, `<proyecto> --parar <id>`,
// `<proyecto> --matar [--leer] [--id ID]`) hasta que el despachador de `pa` en TS llame a estas funciones.
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { probar } from "../base/lock.ts";
import { lanzarSuelto } from "../base/proc.ts";
import { esPrincipal } from "../base/principal.ts";
import {
  ahoraS,
  carpetasDeProyecto,
  dormir,
  esArchivo,
  fechaHora,
  horaMinuto,
  idCorrida,
  kill0,
  leerCampo,
  leerTexto,
  listar,
  masViejoQue,
  ramAlcanza,
  rutaDeProyecto,
  runningVivo,
  slugCrudo,
  slugDe,
  transcurrido,
  workersSueltos,
} from "./corridas.ts";
import { Salida, jefeId, jefeNombre, prologo, salir, type Env, type Io, type Pa } from "./entorno.ts";
import { cmdParar, matarProyecto } from "./matar.ts";
import { claudeFalla, mostrarResultado } from "./resultado.ts";

/** Interno entre `--esperar-todos` y su `--esperar --id`: el resultado ya lo entregó otra espera. Nunca sale de pa. */
export const OTRA_ESPERA = 94;

const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - [...s].length));

// ============================================================================ --estado

/** `pa --estado`. */
export async function cmdEstado(pa: Pa): Promise<void> {
  const { state, io } = pa;
  let hubo = false;
  for (const n of listar(state, (x) => x.endsWith(".running"))) {
    const f = path.join(state, n);
    if (!esArchivo(f)) continue;
    hubo = true;
    const slug = leerCampo(f, "proyecto");
    const leer = leerCampo(f, "leer") === "1";
    if (runningVivo(f)) {
      // el .heartbeat va al lado del .running (uno por writer, uno por cada --leer)
      const hb = f.replace(/\.running$/, ".heartbeat");
      let l = `CORRIENDO  ${pad(slug, 20)} hace ${transcurrido(leerCampo(f, "inicio"))}`;
      if (leer) l += `  · lectura (id: ${leerCampo(f, "id")})`;
      else {
        const p = leerCampo(f, "puesto");
        l += `  · ${p === "aca" ? "tree principal" : `puesto ${p || "1"}`} (id: ${leerCampo(f, "id")})`;
      }
      if (existsSync(hb)) l += `  · ${leerCampo(hb, "envuelo") === "1" ? "en" : "último"} ${leerCampo(hb, "tool")} hace ${transcurrido(leerCampo(hb, "epoch"))}`;
      io.out(l + "\n");
    } else {
      io.out(`HUÉRFANO   ${pad(slug, 20)} (el claude murió; se limpia solo en el próximo pa${leer ? " --leer" : ""}, o: rm ${f})\n`);
    }
  }
  // Corridas --async ENCOLADAS: sin `.running` todavía, pero con su pid en `$ts.pid` desde que arrancan. Sin `.puesto` (se
  // escribe apenas toman el lock) siguen esperando; con el pid muerto y sin `.listo`, murieron en cola (el 82 de `--esperar --id`).
  for (const slug of carpetasDeProyecto(state)) {
    const d = path.join(state, slug);
    for (const n of listar(d, (x) => x.endsWith(".pid"))) {
      const ts = n.slice(0, -4);
      const x = (e: string) => path.join(d, `${ts}.${e}`);
      if (existsSync(x("puesto")) || existsSync(x("corrida"))) continue;
      if (existsSync(x("listo")) || existsSync(x("entregado"))) continue;
      const pid = leerTexto(path.join(d, n));
      if (existsSync(x("leer"))) {
        // --leer no toma puesto: espera lugar del tope (`.cola`), está arrancando (ya sale como CORRIENDO) o murió antes de arrancar
        if (kill0(pid)) {
          if (existsSync(path.join(state, `${slug}.leer-${ts}.running`))) continue;
          if (!existsSync(x("cola"))) continue;
          hubo = true;
          io.out(`EN COLA    ${pad(slug, 20)} (--leer id: ${ts}, ${leerTexto(x("cola"))})\n`);
          continue;
        }
        hubo = true;
        io.out(`MURIÓ      ${pad(slug, 20)} (--leer id: ${ts}, murió antes de arrancar; mirá ${x("log")})\n`);
        continue;
      }
      hubo = true;
      if (kill0(pid)) io.out(`EN COLA    ${pad(slug, 20)} (id: ${ts}, ${existsSync(x("cola")) ? leerTexto(x("cola")) : "esperando un puesto libre"})\n`);
      else io.out(`MURIÓ EN COLA ${pad(slug, 17)} (id: ${ts}, nunca tomó puesto; mirá ${x("log")})\n`);
    }
  }
  if (!hubo) io.out("no hay workers corriendo.\n");

  // RAM: lo que decide si entra otro worker; sin lugares tomados entra siempre
  const vivos = (await lugaresTomados(pa)) + workersSueltos(state);
  const ram = ramAlcanza(pa, vivos);
  io.out(
    `\nRAM        disponible ${ram.disp >= 0 ? ram.disp : "?"} MB · reservada ${ram.reservada} MB (workers recién admitidos, ${pa.ramRecienMin} min) · hacen falta ${ram.haceFalta} MB (${pa.ramWorkerMb} + ${pa.ramReservaMb}) · ${vivos} vivos de ${pa.tope} (tope)\n`,
  );
  if (ram.motivo) io.out(`           un worker nuevo haría cola: ${ram.motivo.replace(/^RAM: /, "")}\n`);
  else if (vivos >= pa.tope) io.out(`           un worker nuevo haría cola: tope global (${pa.tope} vivos)\n`);
  else io.out("           un worker nuevo entra ahora.\n");

  io.out("\n");
  const sesiones = listar(state, (x) => x.endsWith(".session")).filter((x) => esArchivo(path.join(state, x)));
  for (const n of sesiones) {
    const f = path.join(state, n);
    io.out(`sesión     ${pad(n.slice(0, -".session".length), 20)} ${leerTexto(f)}  (guardada ${fechaHora(statSync(f).mtime)})\n`);
  }
  if (!sesiones.length) io.out("no hay sesiones guardadas.\n");

  // Corridas de los últimos 3 días sin evidencia de verificación (`verificado=0` en su .hilo, no archivadas), y proyectos cuyas
  // lecciones pasaron el tope (lecciones.necesita-poda).
  let sv = 0;
  for (const slug of carpetasDeProyecto(state)) {
    const d = path.join(state, slug);
    for (const n of listar(d, (x) => x.endsWith(".hilo"))) {
      const f = path.join(d, n);
      let t: string;
      try {
        if (Date.now() - statSync(f).mtimeMs >= 3 * 86400_000) continue;
        t = readFileSync(f, "utf8");
      } catch {
        continue;
      }
      const lineas = t.split("\n");
      if (!lineas.includes("verificado=0")) continue;
      if (lineas.some((l) => /^archivado=./.test(l))) continue;
      if (sv++ >= 15) continue;
      const id = n.slice(0, -".hilo".length);
      io.out(`SIN VERIFICAR ${pad(slug, 17)} (id: ${id}, el RESULTADO no trae VERIFICACION; pa ${slug} --seguir --id ${id} "corré la verificación y pegá la salida")\n`);
    }
  }
  for (const slug of carpetasDeProyecto(state)) {
    const f = path.join(state, slug, "lecciones.necesita-poda");
    if (esArchivo(f)) io.out(`NECESITA-PODA ${pad(slug, 17)} (lecciones.md: ${leerTexto(f)}; pa ${slug} --lecciones-podar)\n`);
  }

  for (const n of ["limite.hasta", ...listar(state, (x) => /^limite\..+\.hasta$/.test(x))]) {
    const f = path.join(state, n);
    if (!esArchivo(f)) continue;
    const lh = leerTexto(f);
    if (!/^[0-9]+$/.test(lh) || Number(lh) <= ahoraS()) continue; // vacío o basura = sin límite
    const cuenta = n.replace(/^limite/, "").replace(/\.hasta$/, "").replace(/^\./, "");
    io.out(`\nLÍMITE de sesión${cuenta ? ` (cuenta ${cuenta})` : ""} hasta las ${horaMinuto(new Date(Number(lh) * 1000))}: los workers no van a arrancar hasta entonces.\n`);
  }
  if (pa.plan === "pro") io.out("\nplan pro (modo ahorro): opus con effort medium por default, tope 100 turnos, sin subagentes, resultado por --esperar.\n");
  else io.out("\nplan max.\n");
}

/**
 * Cuántos lugares del tope global están tomados: `lock/@tope@<k>`, de 1 al tope (o al k más alto que haya dejado un pa con otro
 * PA_TOPE). Se sondea sin tomar nada (`probar`), así no le hace ver a nadie un lugar ocupado.
 */
async function lugaresTomados(pa: Pa): Promise<number> {
  let max = pa.tope;
  for (const n of listar(pa.lockdir, (x) => x.startsWith("@tope@"))) {
    const k = n.slice("@tope@".length);
    if (/^[0-9]+$/.test(k) && Number(k) > max) max = Number(k);
  }
  const ks = Array.from({ length: max }, (_, i) => i + 1);
  const tomados = await Promise.all(ks.map((k) => probar(path.join(pa.lockdir, `@tope@${k}`), { plat: pa.plat, env: pa.env, timeoutMs: 1000 })));
  return tomados.filter(Boolean).length;
}

// ============================================================================ --esperar

export type OpcionesEsperar = {
  /** Cada cuánto se mira (ms). El bash: 500 (y 200 antes de dar por muerta una corrida con --id). */
  pausaMs?: number;
};

/** `pa --esperar <proyecto> [--timeout N] [--id ID]`. Devuelve el rc de la corrida entregada (o tira `Salida`). */
export async function cmdEsperar(pa: Pa, args: string[], oe: OpcionesEsperar = {}): Promise<number> {
  const { io, state, lockdir } = pa;
  const pausa = oe.pausaMs ?? 500;
  const [proy = "", ...resto] = args;
  let timeout = 0;
  let id = "";
  for (let i = 0; i < resto.length; ) {
    const a = resto[i]!;
    const b = resto[i + 1];
    if (a === "--timeout") {
      if (!/^[0-9]+$/.test(b ?? "")) {
        io.err("pa --esperar: --timeout quiere un número de segundos.\n");
        salir(2);
      }
      timeout = Number(b);
      i += 2;
    } else if (a === "--id") {
      if (!b) {
        io.err("pa --esperar: --id quiere el id de la corrida.\n");
        salir(2);
      }
      id = b!;
      i += 2;
    } else {
      io.err(`pa --esperar: opción desconocida: ${a}\n`);
      salir(2);
    }
  }
  if (!proy) {
    io.err("uso: pa --esperar <proyecto> [--timeout SEGUNDOS] [--id <id-de-corrida>]\n");
    salir(2);
  }

  // El slug es el basename de la ruta REAL y no siempre un nombre del registry: como `pa --async` imprime el slug, se acepta tal
  // cual si ya corrió algo con ese nombre. Con el bash eso lo decía el archivo de lock (flock lo crea); los locks de TS no dejan
  // archivo, así que también cuentan las marcas de corrida en `$STATE/<slug>/`.
  const yaCorrio = (s: string) =>
    existsSync(path.join(lockdir, s)) ||
    listar(lockdir, (n) => n.startsWith(`${s}@`)).length > 0 ||
    listar(path.join(state, s), (n) => /\.(leer|pid|listo|entregado|corrida|puesto|hilo|json)$/.test(n)).length > 0;
  let slug = slugCrudo(proy);
  if (!yaCorrio(slug)) {
    const ruta = rutaDeProyecto(pa, proy);
    if (ruta === null) salir(1);
    slug = slugDe(ruta!);
  }
  if (!yaCorrio(slug)) {
    io.err(`pa: nunca corrió un worker en '${slug}'.\n`);
    salir(1);
  }

  // Cada corrida deja su `<slug>/<ts>.listo` y acá se entrega el más viejo sin entregar, renombrándolo a `.entregado`: dos
  // --esperar seguidos traen dos resultados distintos, en orden. Sin --id: sólo los del que ESCRIBE (no los --leer), sólo los de
  // MI jefe, y los de más de un día se saltean (`--id` los trae igual).
  const d = path.join(state, slug);
  const yo = jefeId(pa);
  let f = "";
  let vencidos = 0;
  const jefeDe = (t: string) => leerCampo(path.join(d, `${t}.corrida`), "jefe_id") || leerCampo(path.join(d, `${t}.jefe`), "jefe_id");
  const esMia = (t: string) => {
    if (!yo) return true;
    const j = jefeDe(t);
    return !j || j === yo;
  };
  const pendiente = (): boolean => {
    if (id) {
      f = path.join(d, `${id}.listo`);
      return existsSync(f);
    }
    f = "";
    vencidos = 0;
    for (const n of listar(d, (x) => x.endsWith(".listo"))) {
      const c = path.join(d, n);
      const t = n.slice(0, -".listo".length);
      if (existsSync(path.join(d, `${t}.leer`))) continue;
      if (!esMia(t)) continue;
      if (masViejoQue(c, 1440)) {
        vencidos++;
        continue;
      }
      f = c;
      break;
    }
    return f !== "";
  };
  const avisoVencidos = () => {
    if (vencidos <= 0) return;
    io.err(`pa: (salteé ${vencidos} resultado(s) de '${slug}' de más de un día; están en ${d}, traelos con --esperar --id <corrida> si los querés)\n`);
    vencidos = 0;
  };
  const yaEntregada = (t: string): never => {
    io.err(`pa: la corrida ${t} de '${slug}' ya se entregó (${path.join(d, `${t}.entregado`)}): la cobró otra espera, no la entrego de nuevo.\n`);
    return salir(pa.env.PA_ESPERA_TODOS ? OTRA_ESPERA : 1);
  };
  const entregar = async (): Promise<number> => {
    // El rename decide quién la entrega: con dos esperas sobre el mismo .listo, la que pierde no muestra nada.
    let e = f.replace(/\.listo$/, ".entregado");
    for (;;) {
      try {
        renameSync(f, e);
        break;
      } catch {
        if (id) yaEntregada(id);
        if (!pendiente()) {
          io.err(`pa: nada pendiente en '${slug}': el resultado que había se lo llevó otra espera.\n`);
          salir(1);
        }
        e = f.replace(/\.listo$/, ".entregado");
      }
    }
    const rc = leerCampo(e, "rc");
    const out = leerCampo(e, "salida");
    if (out && esArchivo(out)) await mostrarResultado(pa, out);
    if (rc === "81" || rc === "84") claudeFalla(pa, rc);
    // el id va visible: si este resultado ya había llegado por mensaje, acá se nota
    io.out(`— corrida ${path.basename(f).replace(/\.listo$/, "")} · rc=${rc || "0"}\n`);
    return (Number(rc) || 0) & 255;
  };

  pendiente();
  avisoVencidos();
  if (id) {
    if (existsSync(path.join(d, `${id}.entregado`))) yaEntregada(id);
    if (!["log", "corrida", "puesto"].some((e) => existsSync(path.join(d, `${id}.${e}`)))) {
      io.err(`pa: no existe la corrida ${id} de '${slug}' (sin ${path.join(d, `${id}.log`)}).\n`);
      salir(1);
    }
  }
  // Las corridas --leer que el pelado no entrega: se avisan, con el comando para cobrarlas.
  const notaLeer = () => {
    const ids: string[] = [];
    for (const n of listar(d, (x) => x.endsWith(".listo"))) {
      const t = n.slice(0, -".listo".length);
      if (existsSync(path.join(d, `${t}.leer`))) ids.push(`${t} (terminada)`);
    }
    for (const n of listar(state, (x) => x.startsWith(`${slug}.leer-`) && x.endsWith(".running"))) {
      const r = path.join(state, n);
      if (runningVivo(r)) ids.push(`${leerCampo(r, "id")} (corriendo)`);
    }
    if (!ids.length) return;
    io.err(`pa: '${slug}' tiene ${ids.length} corrida(s) --leer que \`--esperar\` sin --id no entrega (es del que escribe):\n`);
    for (const r of ids) io.err(`    pa --esperar '${proy}' --id ${r.slice(0, r.indexOf(" "))}   # ${r.slice(r.indexOf(" ") + 1)}\n`);
  };
  const runnings = (conLeer: boolean) => [
    `${slug}.running`,
    ...listar(state, (n) => n.startsWith(`${slug}@`) && n.endsWith(".running")),
    ...(conLeer ? listar(state, (n) => n.startsWith(`${slug}.leer-`) && n.endsWith(".running")) : []),
  ].map((n) => path.join(state, n));
  // Viva = su `$ts.pid` (async: en cola o corriendo) vive, o hay un `.running` vivo con ese id (primer plano).
  const corridaViva = (t: string) => {
    if (kill0(leerTexto(path.join(d, `${t}.pid`)))) return true;
    return runnings(true).some((r) => esArchivo(r) && leerCampo(r, "id") === t && runningVivo(r));
  };
  // Writers de MI jefe que siguen vivos (corriendo o en cola): lo que espera el pelado.
  const hayWritersMios = () => {
    for (const r of runnings(false)) {
      if (!esArchivo(r) || !runningVivo(r)) continue;
      if (yo) {
        const j = leerCampo(r, "jefe_id") || jefeDe(leerCampo(r, "id"));
        if (j && j !== yo) continue;
      }
      return true;
    }
    for (const n of listar(d, (x) => x.endsWith(".pid"))) {
      const t = n.slice(0, -".pid".length);
      if (["leer", "listo", "entregado"].some((e) => existsSync(path.join(d, `${t}.${e}`)))) continue;
      if (!kill0(leerTexto(path.join(d, n)))) continue;
      if (!esMia(t)) continue;
      return true;
    }
    return false;
  };

  const fin = timeout > 0 ? ahoraS() + timeout : 0;
  if (id) {
    for (;;) {
      if (pendiente()) return entregar();
      if (!corridaViva(id)) {
        await dormir((pausa * 2) / 5);
        if (pendiente()) return entregar(); // alcanzó a terminar entre el chequeo y acá
        // terminó y otra espera se llevó el .listo mientras ésta esperaba
        if (existsSync(path.join(d, `${id}.entregado`))) yaEntregada(id);
        if (existsSync(path.join(d, `${id}.pid`))) {
          const log = path.join(d, `${id}.log`);
          if (existsSync(path.join(d, `${id}.leer`))) io.err(`pa: la corrida --leer ${id} de '${slug}' murió sin dejar resultado (el proceso ya no vive). Mirá ${log}.\n`);
          else if (existsSync(path.join(d, `${id}.puesto`)) || existsSync(path.join(d, `${id}.corrida`)))
            io.err(`pa: la corrida ${id} de '${slug}' murió corriendo (ya había tomado puesto) sin dejar resultado. Mirá ${log}.\n`);
          else io.err(`pa: la corrida ${id} de '${slug}' murió en cola (el proceso ya no vive) sin dejar resultado. Mirá ${log}.\n`);
          salir(82);
        }
        // sin .pid: corrió en primer plano (su resultado salió por stdout, no deja .listo)
        io.err(`pa: la corrida ${id} de '${slug}' no dejó resultado para entregar (¿corrió en primer plano? mirá ${path.join(d, `${id}.json`)}).\n`);
        salir(1);
      }
      if (fin > 0 && ahoraS() >= fin) {
        io.err(`pa: la corrida ${id} de '${slug}' sigue trabajando después de ${timeout}s.\n`);
        salir(75);
      }
      await dormir(pausa);
    }
  }
  for (;;) {
    if (pendiente()) return entregar();
    if (!hayWritersMios()) {
      await dormir(pausa);
      if (pendiente()) return entregar();
      io.err(`pa: nada pendiente en '${slug}': ni worker tuyo corriendo ni resultado tuyo sin entregar.\n`);
      avisoVencidos();
      notaLeer();
      salir(1);
    }
    if (fin > 0 && ahoraS() >= fin) {
      io.err(`pa: '${slug}' sigue trabajando después de ${timeout}s.\n`);
      salir(75);
    }
    await dormir(pausa);
  }
}

// ============================================================================ --esperar-todos

/** `pa --esperar-todos [--timeout N]`: cobra todas las corridas async del jefe; sale con el primer rc distinto de 0. */
export async function cmdEsperarTodos(pa: Pa, args: string[], oe: OpcionesEsperar = {}): Promise<number> {
  const { io, state } = pa;
  let timeout = 0;
  for (let i = 0; i < args.length; ) {
    if (args[i] === "--timeout") {
      if (!/^[0-9]+$/.test(args[i + 1] ?? "")) {
        io.err("pa --esperar-todos: --timeout quiere un número de segundos.\n");
        salir(2);
      }
      timeout = Number(args[i + 1]);
      i += 2;
    } else {
      io.err(`pa --esperar-todos: opción desconocida: ${args[i]}\n`);
      salir(2);
    }
  }
  const yo = jefeId(pa);
  const fin = timeout > 0 ? ahoraS() + timeout : 0;
  const cola: [string, string][] = [];
  for (const slug of carpetasDeProyecto(state)) {
    const d = path.join(state, slug);
    for (const n of listar(d, (x) => x.endsWith(".pid"))) {
      const p = path.join(d, n);
      if (!esArchivo(p)) continue;
      const t = n.slice(0, -".pid".length);
      if (existsSync(path.join(d, `${t}.entregado`))) continue;
      const listo = path.join(d, `${t}.listo`);
      if (existsSync(listo)) {
        if (masViejoQue(listo, 1440)) continue; // vencido
      } else if (!kill0(leerTexto(p))) continue; // ni resultado ni vivo
      if (yo) {
        const j = leerCampo(path.join(d, `${t}.corrida`), "jefe_id") || leerCampo(path.join(d, `${t}.jefe`), "jefe_id");
        if (j && j !== yo) continue;
      }
      cola.push([slug, t]);
    }
  }
  if (!cola.length) {
    io.err("pa: nada pendiente tuyo (ninguna corrida async viva ni sin cobrar).\n");
    return 1;
  }
  io.err(`pa: esperando ${cola.length} corrida(s)…\n`);
  let rc = 0;
  let n = 0;
  let otras = 0;
  for (const [slug, t] of cola) {
    const extra: string[] = [];
    if (fin) extra.push("--timeout", String(Math.max(1, fin - ahoraS())));
    // Cada una con el `--esperar --id` de siempre; su stdout se junta y sale con su encabezado.
    let sal = "";
    const hijo: Pa = { ...pa, env: { ...pa.env, PA_ESPERA_TODOS: "1" }, io: { out: (s) => (sal += s), err: io.err } };
    let rc1: number;
    try {
      rc1 = await cmdEsperar(hijo, [slug, "--id", t, ...extra], oe);
    } catch (e) {
      if (!(e instanceof Salida)) throw e;
      rc1 = e.codigo;
    }
    if (rc1 === OTRA_ESPERA) {
      otras++;
      continue;
    }
    n++;
    io.out(`\n══ ${slug} (corrida ${t}) ══\n`);
    sal = sal.replace(/\n+$/, "");
    if (sal) io.out(sal + "\n");
    if (rc === 0 && rc1 !== 0) rc = rc1;
  }
  io.out(`\n— ${n} corrida(s) cobradas${otras ? ` (${otras} ya las había entregado otra espera)` : ""} · rc=${rc}\n`);
  return rc;
}

// ============================================================================ --async

/** Lo que el hijo de `--async` recibe en la línea de comandos (el `hijo_args` del bash), sacado de lo que se parseó. */
export interface OpcionesHijo {
  proyecto: string;
  modelo: string;
  tarea: string;
  leer?: boolean;
  seguir?: boolean;
  mcp?: boolean;
  /** "" o 0 = sin tope: va SIEMPRE (si no, el hijo se aplicaría el default y `--max-turns 0` no apagaría nada). */
  maxTurns?: string | number;
  maxBudget?: string;
  runId?: string;
  actualizar?: string;
  sucioMio?: boolean;
  aca?: boolean;
  force?: boolean;
  tipo?: string;
  fase?: string;
  tareaId?: string;
  subtarea?: string;
  rubrica?: string;
  okDueno?: boolean;
  cuenta?: string;
  /** Ya movido a espejos/ (el hijo sólo arma el deny). */
  espejo?: string;
  /** El --effort que pidió el jefe (no el que salió de modelos.json). */
  effortPedido?: string;
}

/** `hijo_args`: en el mismo orden que el bash. */
export function argsHijo(o: OpcionesHijo): string[] {
  const a = [o.proyecto, "-m", o.modelo];
  if (o.leer) a.push("--leer");
  if (o.seguir) a.push("--seguir");
  if (o.mcp) a.push("--mcp");
  a.push("--max-turns", String(o.maxTurns || 0));
  if (o.maxBudget) a.push("--max-budget-usd", o.maxBudget);
  if (o.runId) a.push("--id", o.runId);
  if (o.actualizar) a.push("--actualizar", o.actualizar);
  if (o.sucioMio) a.push("--sucio-mio");
  if (o.aca) a.push("--aca");
  if (o.force) a.push("--force");
  if (o.tipo) a.push("--tipo", o.tipo);
  if (o.fase) a.push("--fase", o.fase);
  if (o.tareaId) a.push("--tarea", o.tareaId);
  if (o.subtarea) a.push("--subtarea", o.subtarea);
  if (o.rubrica) a.push("--rubrica", o.rubrica);
  if (o.okDueno) a.push("--ok-dueno");
  if (o.cuenta) a.push("--cuenta", o.cuenta);
  if (o.espejo) a.push("--espejo", o.espejo);
  if (o.effortPedido) a.push("--effort", o.effortPedido);
  a.push("--", o.tarea);
  return a;
}

export interface PedidoAsync {
  /** El nombre que escribió el jefe (va en el «para esperarlo»). */
  proyecto: string;
  slug: string;
  /** `$STATE/<slug>`. */
  dir: string;
  leer: boolean;
  /** De `argsHijo`. */
  hijoArgs: string[];
  /** PA_REPARTO_TIPO / PA_FALLBACK_RESTO para el hijo (lo que eligió el padre). */
  repartoTipo?: string;
  fallbackResto?: string;
  /** Con qué se relanza `pa` (default: este mismo node con este mismo script). */
  comando?: string[];
  /** `avisar_paralelo ts puesto` (etapa 7): avisa si hay otros writers en el proyecto. */
  avisarParalelo?: (ts: string, puesto: string) => void | Promise<void>;
  /** Cuántas veces mirar (cada `pausaMs`) si el hijo ya tomó puesto. El bash: 100 × 100 ms. */
  vueltas?: number;
  pausaMs?: number;
}

/**
 * `--async`: relanzarse desacoplado (setsid + nohup en Linux, `detached` sin consola en Windows) y volver. El Bash tool del
 * orquestador tiene tope de 10 min; con --async el pa real vive fuera de esa sesión y el resultado se recoge con `--esperar`.
 * Antes del fork quedan `.leer`, `.log` y `.jefe`; después, `.pid`. No vuelve hasta que el hijo tomó puesto, hizo cola o terminó
 * (si no, un `--esperar` pegado atrás podría no ver nada vivo). Devuelve el id de la corrida; tira `Salida(1)` si el hijo murió
 * antes de tomar puesto.
 */
export async function lanzarAsync(pa: Pa, p: PedidoAsync): Promise<string> {
  const { io, state } = pa;
  // el pid va en el id: dos corridas del mismo proyecto en el mismo segundo no comparten archivos
  const ts = idCorrida();
  const x = (e: string) => path.join(p.dir, `${ts}.${e}`);
  const log = x("log");
  // la marca de --leer y el .log van ANTES del fork: `--esperar --id` los mira y puede llegar antes que el hijo
  if (p.leer) writeFileSync(x("leer"), "");
  writeFileSync(log, "");
  // de quién es la corrida, ANTES del fork: mientras espera en cola no tiene `.corrida`
  const jefe = jefeNombre(pa);
  const jefeIdV = jefeId(pa);
  if (!p.leer) writeFileSync(x("jefe"), `jefe=${jefe}\njefe_id=${jefeIdV}\n`);
  const cmd = p.comando ?? [process.execPath, process.argv[1]!];
  const env: Env = { ...pa.env, PA_TS: ts, PA_JEFE: jefe, PA_JEFE_ID: jefeIdV, PA_ASYNC: "1", PA_REPARTO_TIPO: p.repartoTipo ?? "", PA_FALLBACK_RESTO: p.fallbackResto ?? "" };
  let lanzado: number | undefined;
  try {
    lanzado = lanzarSuelto(cmd[0]!, [...cmd.slice(1), ...p.hijoArgs], { env, log, plat: pa.plat });
  } catch {
    lanzado = undefined;
  }
  // el pid del hijo, ya: mientras espera en cola es la ÚNICA señal de que sigue vivo
  writeFileSync(x("pid"), lanzado ? String(lanzado) : "");
  let murio = false;
  const vueltas = p.vueltas ?? 100;
  for (let i = 0; i < vueltas; i++) {
    if (!kill0(lanzado)) {
      murio = true;
      break;
    }
    if (existsSync(x("listo"))) break;
    if (p.leer) {
      // --leer no toma puesto: arrancó cuando su .running tiene el pid del claude (así un --matar inmediato lo encuentra)
      if (leerCampo(path.join(state, `${p.slug}.leer-${ts}.running`), "pid")) break;
      if (existsSync(x("cola"))) break;
    } else if (existsSync(x("puesto")) || existsSync(x("cola"))) break;
    await dormir(p.pausaMs ?? 100);
  }
  // kill0 solo no alcanza: uno que tomó puesto, corrió y salió en <0,1 s se ve igual que uno que nunca llegó. El .listo lo
  // deja la salida del hijo SÓLO después de tomar puesto: su ausencia distingue «murió antes de arrancar».
  if (murio && !existsSync(x("listo"))) {
    io.err(p.leer ? `pa: '${p.slug}' (id: ${ts}) murió antes de arrancar. Mirá el log: ${log}\n` : `pa: '${p.slug}' (id: ${ts}) murió antes de tomar el lock de un puesto. Mirá el log: ${log}\n`);
    salir(1);
  }
  const enCola = () => `pa: '${p.slug}' lanzado en background, EN COLA: ${leerTexto(x("cola"))} (id: ${ts}, log: ${log}). Arranca solo cuando se libere.\n`;
  if (!p.leer && existsSync(x("puesto"))) {
    const pst = leerTexto(x("puesto"));
    await p.avisarParalelo?.(ts, pst);
    io.out(`pa: '${p.slug}' lanzado en background en ${pst === "aca" ? "el tree principal" : `el puesto ${pst}`} (id: ${ts}, log: ${log}).\n`);
  } else if (existsSync(x("cola"))) io.out(enCola());
  else io.out(`pa: '${p.slug}' lanzado en background (id: ${ts}, log: ${log}).\n`);
  io.out(`pa: para esperarlo: pa --esperar '${p.proyecto}' --id ${ts}\n`);
  return ts;
}

// ============================================================================ entrada suelta

/** Lo de esta etapa, con el prólogo de pa. Lo que no es de acá sale 2 (lo atiende el `pa` bash hasta que esté todo portado). */
export async function main(argv: string[], env: Env = process.env, io: Io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }): Promise<number> {
  try {
    const pa = prologo(argv, env, io);
    const [a = "", ...resto] = argv;
    switch (a) {
      case "--estado":
        await cmdEstado(pa);
        return 0;
      case "--esperar":
        return await cmdEsperar(pa, resto);
      case "--esperar-todos":
        return await cmdEsperarTodos(pa, resto);
      case "--parar":
        return await cmdParar(pa, resto[0]);
    }
    if (resto[0] === "--parar") return await cmdParar(pa, resto[1]);
    if (a && !a.startsWith("-") && resto.includes("--matar")) {
      let runId = "";
      let leer = false;
      for (let i = 0; i < resto.length; i++) {
        const r = resto[i]!;
        if (r === "--matar") continue;
        else if (r === "--leer") leer = true;
        else if (r === "--id") runId = resto[++i] ?? "";
        else if (r === "--sin-jefe") pa.env = { ...pa.env, PA_JEFE: "", PA_JEFE_ID: "" };
        else {
          io.err(`pa: opción desconocida: ${r}\n`);
          return 2;
        }
      }
      const ruta = rutaDeProyecto(pa, a);
      if (ruta === null) return 1;
      return await matarProyecto(pa, a, ruta, { runId, leer });
    }
    io.err(`pa (TS): '${argv.join(" ")}' todavía no está portado; usá el pa de bash.\n`);
    return 2;
  } catch (e) {
    if (e instanceof Salida) return e.codigo;
    throw e;
  }
}

if (esPrincipal(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (c) => {
      process.exitCode = c;
    },
    (e: unknown) => {
      process.stderr.write(`pa: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
      process.exitCode = 1;
    },
  );
}
