// pa — el `pa` de TypeScript (dist-electron/cli/pa.js; en Windows lo busca binario.ts). Etapa 11: despacha cada modo a su pieza
// (lanzar en primer plano y --async, esperar, parar, matar, integrar, descartar, ramas, lecciones, auditar, estado). Lo que todavía
// vive sólo en motor/bin/pa (hilos, rinde, bien, modelos, otros motores…) explica eso por stderr y sale 70 SIN haber hecho nada: el
// envoltorio de motor/bin/pa (TRAMA_PA=ts) vuelve entonces al bash.
import { spawnSync } from "node:child_process";
import { esPrincipal } from "./base/principal.ts";
import { cmdArchivar } from "./pa/archivar.ts";
import { prepararAuditar } from "./pa/auditar.ts";
import { main, type Deps } from "./pa/cli.ts";
import { cmdEsperar, cmdEsperarTodos, cmdEstado } from "./pa/async.ts";
import { salir, type Env } from "./pa/entorno.ts";
import { cmdHilo } from "./pa/hilo.ts";
import { cmdHilos } from "./pa/hilos.ts";
import { cmdBien, cmdBienAuto } from "./pa/medicion.ts";
import { cmdLeccion, cmdLecciones, cmdLeccionesPodar } from "./pa/lecciones.ts";
import { cmdLimpiar } from "./pa/limpiar.ts";
import { cmdParar, matarProyecto } from "./pa/matar.ts";
import { lanzarProyecto } from "./pa/orquesta.ts";
import { cmdProyectos, cmdRenombrar } from "./pa/proyectos.ts";
import { cmdDescartar, cmdDescartarId, cmdIntegrar, cmdRamas } from "./pa/ramas.ts";
import { fijarProyecto } from "./pa/ramas-base.ts";
import { cmdRevertir } from "./pa/revertir.ts";
import { cmdTraspaso } from "./pa/traspaso.ts";
import { cmdRinde } from "./pa/rinde.ts";
import { cmdCupoGemini, cmdGeminiProyectos, cmdModelos } from "./pa/tabla-modelos.ts";

/** Otro `pa` igual a éste (los intentos de -m a,b,c), con la salida a la vista. */
function relanzar(argv: string[], extra: Env): number {
  const r = spawnSync(process.execPath, [...process.execArgv, process.argv[1]!, ...argv], {
    env: { ...process.env, ...extra } as NodeJS.ProcessEnv,
    stdio: "inherit",
  });
  return r.status ?? (r.signal ? 128 + 15 : 1);
}

export const deps: Deps = {
  relanzar,
  globales: {
    estado: async (_a, pa) => {
      await cmdEstado(pa);
      return 0;
    },
    esperar: (a, pa) => cmdEsperar(pa, a),
    esperarTodos: (a, pa) => cmdEsperarTodos(pa, a),
    parar: (a, pa) => cmdParar(pa, a[0]),
    descartarId: (a, pa) => cmdDescartarId(pa, a[0]),
    hilos: (a, pa) => cmdHilos(pa, a),
    hilo: (a, pa) => cmdHilo(pa, a),
    archivar: (a, pa) => cmdArchivar(pa, a[0]),
    revertir: (a, pa) => cmdRevertir(pa, a[0]),
    renombrar: (a, pa) => cmdRenombrar(pa, a),
    traspaso: (_a, pa) => cmdTraspaso(pa),
    proyectos: (a, pa) => cmdProyectos(pa, a),
    limpiar: (a, pa) => cmdLimpiar(pa, a),
    bien: (a, pa) => cmdBien(pa, a),
    bienAuto: (_a, pa) => cmdBienAuto(pa),
    rinde: (a, pa) => cmdRinde(pa, a),
    modelos: (a, pa) => cmdModelos(pa, a),
    cupoGemini: (a, pa) => cmdCupoGemini(pa, a),
    geminiProyectos: (a, pa) => cmdGeminiProyectos(pa, a),
  },
  proyecto: {
    matar: (l, pa, p) => matarProyecto(pa, l.proyecto, p.ruta, { runId: l.runId, leer: l.leer }),
    integrar: (l, pa, p) => cmdIntegrar(fijarProyecto(pa, l.proyecto, p.ruta), l.integrar, { tests: l.integrarTests }),
    descartar: (l, pa, p) => cmdDescartar(fijarProyecto(pa, l.proyecto, p.ruta), l.descartar),
    ramas: (l, pa, p) => cmdRamas(fijarProyecto(pa, l.proyecto, p.ruta)),
    leccion: (l, pa, p) => cmdLeccion(fijarProyecto(pa, l.proyecto, p.ruta), l.leccion),
    lecciones: async (l, pa, p) => cmdLecciones(fijarProyecto(pa, l.proyecto, p.ruta)),
    leccionesPodar: async (l, pa, p) => cmdLeccionesPodar(fijarProyecto(pa, l.proyecto, p.ruta)),
    lanzar: lanzarProyecto(),
  },
  auditar: async (l, pa, p) => {
    const r = await prepararAuditar(fijarProyecto(pa, l.proyecto, p.ruta), l.auditar, l.decisiones, l.tarea);
    if (!r.ok) {
      pa.io.err(r.mensaje);
      return salir(r.codigo);
    }
    return r.tarea;
  },
  // motores (agy, codex, dsh, opencode, ollama), agents-md, unificar-md, hilos y el resto: siguen en el bash (70).
};

if (esPrincipal(import.meta.url)) {
  const io = { out: (s: string) => void process.stdout.write(s), err: (s: string) => void process.stderr.write(s) };
  main(process.argv.slice(2), process.env, io, deps).then(
    (rc) => {
      process.exitCode = rc;
    },
    (e: unknown) => {
      process.stderr.write(`pa: ${(e as Error)?.stack ?? String(e)}\n`);
      process.exitCode = 1;
    },
  );
}
