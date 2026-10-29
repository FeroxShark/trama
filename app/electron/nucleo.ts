// El núcleo de trama, sin Electron: lo que el frontend le puede pedir (por el preload,
// `window.hilos`, o por red): hilos, conversaciones, statusline (uso y líderes), leídos y las
// acciones (Cerrar, Parar, Escribirle, Nueva tarea). Lo que cambia se avisa mirando archivos con
// inotify (nada de polling) y sale a quienes escuchan (`escuchar`): la ventana, el celular.
// La ventana lo usa por ipc.ts, que le suma lo que es sólo de la pantalla de la PC.
import { guardarArchivo, limpiarAdjuntos } from "./archivos.js";
import { leerImagenLocal } from "./imagen-local.js";
import { modelosDictado, transcribir } from "./dictado.ts";
import { MODELO_TURBO } from "./dictado-modelos.ts";
import { guardarLocal, leerLocales, probarLocal } from "./locales.ts";
import { vistaLocales } from "./locales-config.ts";
import { controlarServidorLocal, detectarLocales } from "./locales-deteccion.ts";
import { leerVram, liberarVram } from "./vram.ts";
import { leerEntornoOllama } from "./ollama-entorno.ts";
import { carpetaLocal } from "./local.ts";
import { existsSync } from "node:fs";
import { readFile, stat as statArchivo } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { almacenBorradores } from "./borradores.js";
import { alCambiarAuto, barrer, cambioPrendido, estadoAuto } from "./autointegrar.js";
import { alCambiarSalud, barrerSalud, cortarChequeos, estadoSalud, integrando, integrandoDesde, mientrasIntegra } from "./salud.js";
import { actualizar, alCambiarAviso, descartar, leerAviso } from "./actualizacion.js";
import { actualizarAgy, alCambiarAvisoAgy, descartarAgy, leerAvisoAgy } from "./actualizacion-agy.js";
import { alCambiarActualizacionTrama, alCambiarAvisoTrama, armarActualizacionTrama, buscarTrama, cancelarEsperaTrama, descartarTrama, estadoActualizacionTrama, leerAvisoTrama, limpiarTrama, ocupacionTrama, pedirTrama, retomarTrama, type Ocupacion } from "./actualizacion-trama.js";
import { crearCompactando } from "./compactando.js";
import { crearSubagentes } from "./subagentes.js";
import { crearConsumo, TRANSCRIPTS } from "./consumo.ts";
import { crearPasos } from "./pasos-worker.ts";
import { crearArranque } from "./arranque.ts";
import { crearHistorial } from "./historial.ts";
import { crearIndiceClaudeCode, sidsDePa, vistaConvs } from "./claude-code.ts";
import { cuentasClaude } from "./uso-cuentas.ts";
import { leerUmbrales } from "./contexto.js";
import { iconosDe } from "./iconos.js";
import { guardarYa, leerLeidos, marcarLeido } from "./leidos.js";
import { almacenNombres } from "./nombres.js";
import { almacenPendientes } from "./pendientes.js";
import { guardarApariencia, guardarAutoIntegrar, guardarAvisarEspera, guardarAvisarWorkers, guardarAvisoLider, avisoLiderGuardado, bienvenidaPendiente, guardarBienvenida, guardarConsumo, guardarDictadoModelo, guardarEffort, guardarGuias, guardarIdioma, guardarTerminalAgentes, guardarTiernos, guardarVista, guiasEstado, guardarLimpieza, leerLimpieza, leerPreferencias } from "./preferencias.js";
import { aplicarLimpieza, pasadaAutomatica, programarPasadas, verLimpieza } from "./limpieza-pa.js";
import { accionRama, arreglarDatos, briefRamas, enCola, ejecutar, lanzarRama, lanzarTareaMd, leerAjustes, leerMedicion, pasarALider, relanzarWorker, retomarDatos, tareaMdEnCurso, type AccionRama, type TipoTareaMd } from "./paneles.js";
import { guardarRouting, type Cambio } from "./routing.js";
import { argvAuditar, datosAgentsMd, guardarLecciones, leccionesPendientes, leerLecciones, textoPoda } from "./orquestacion.ts";
import { aplicarUnificar, estadoMd, guardarAgents, leerAgents, planUnificar } from "./unificar-md.ts";
import { listarProyectos, logoProyecto, renombrarProyecto } from "./proyectos-alias.ts";
import { guardarAjustes } from "./ajustes-editar.js";
import { crearBajadas } from "./ollama-bajar.ts";
import { agyOfrecidos } from "./agy-ofrecidos.ts";
import { efectivoDePa, guardarModelos, leerModelos, modelosConfig, sondearOllama, vistaModelos } from "./modelos-config.ts";
import { accesos } from "./celular-accesos.js";
import { guardarConfig, leerEditable } from "./remoto-config.js";
import { sesionesVistas, vive } from "./sesiones.js";
import { crearVigia, vivoEnPa } from "./vigia.js";
import { crearEmisor } from "./hilos-dif.js";
import { conLider } from "./cola-pa.js";
import { alLeerHilos, anotarFrenados, nombrePa, cerrar, conversacion, ESTADO, escribirAtomico, hilosGuardados, leerHilos, leyendoHilos, mirarEventos, PA_STATE, parar, releerHilos, type Cerrable } from "./pa.js";
import { esperandoWorkers, lideresConWorkers, workersEsperados, workersVivosDe } from "./relanzar.js";
import * as lider from "./lider.js";
import { nombreDueno } from "./dueno.ts";
import { entornoLider } from "./lider-arma.js";
import { crearCola } from "./cola.js";
import { crearEspera } from "./espera.js";
import { crearAvisosWorker, REVISAR_MS, textoParaLider, type AvisoWorker } from "./avisos-worker.js";
import { procesoVivoDe, rastroDeWorker } from "./avisos-worker-disco.js";
import { errorT, textoT } from "./errores.ts";
import { destinos, real, registro, slugsPorNombre } from "./registro.js";
import { plataformaActual, registroProyectos } from "./rutas.ts";
import { capacidades, hayAgy, hayDsh } from "./capacidades.js";
import { estadoDsh, instalarDsh, probarProveedor } from "./dsh-ajustes.ts";
import { estadoMcp } from "./mcp.ts";
import { alternar as alternarConector, inventario as inventarioConectores } from "./conectores-claude.ts";
import { agregarCatalogo, estadoCatalogos, instalarPlugin, quitarPlugin, type DepsPlugins } from "./plugins-claude.ts";
import { guardarServidor, quitarServidor, vistaMcp } from "./mcp-config.ts";
import { crearLectorTabla, leerTabla } from "./reparto-tabla.ts";
import { actualizarOpencode, effortsOpencode, modelosOpencode, vistaOpencode } from "./opencode-ajustes.ts";
import { estadoNim, guardarModelosNim, probarNim } from "./nvidia-nim.ts";
import { guardarPlanOpencode, mantenerTopesGo, planOpencode, vistaPlanGo } from "./opencode-go.ts";
import { guardarClave, leerClaves } from "./claves.ts";
import { estadoAA, refrescarAA } from "./artificial-analysis.ts";
import { descartarSetup, setupDeEstaMaquina } from "./setup.ts";
import { cuentasDeEstaMaquina } from "./cuentas.ts";
import { enTerminal } from "./actualizador.ts";
import { cuentasVarias } from "./cuentas-varias-canales.ts";
import { cuentasDeEstaMaquinaVarias } from "./cuentas-varias.ts";
import { alCambiarCupos, cuposActuales, refrescarCupos } from "./cupos.js";
import { esLoopback, modoLocal } from "./modo-local.js";
import { DIR, leerStatusline, SESIONES, type Statusline } from "./statusline.js";
import * as tablero from "./tablero.js";
import { proximoReinicio } from "./uso.ts";
import { log, silencio } from "./log.js";
import { mirarCarpeta, type Mirada } from "./mirar.ts";
import { identidadDe } from "./identidad.ts";
import { leerMaquinas, SOLA } from "./maquinas-config.ts";
import { HUELLA, PROTOCOLO, RUTAS, type Saludo } from "./maquinas-contrato.ts";
import { SOLO_VENTANA as SOLO_VENTANA_CONTRATO, SOLO_VENTANA_LOCAL as SOLO_VENTANA_LOCAL_CONTRATO } from "./canales/contrato.ts";
import { crearMaquinas, type Maquinas } from "./maquinas.ts";
import { crearPc, type Pc } from "./pc-estado.ts";
export { compatible, EVENTOS, PROTOCOLO, RUTAS, type Ruta, type Saludo } from "./maquinas-contrato.ts";

const DEBOUNCE_MS = 150;
/** Un cambio que sólo mueve los `ts` se reenvía como mucho cada tanto (alcanza para "hace X"). */
const REFRESCO_TS_S = 60;
/** Con algo vivo en la lista, `pa --hilos` se repite a lo sumo cada esto aunque nadie avise. */
const RESPALDO_MS = 5 * 60_000;

/** Quién pide: la ventana (el evento del IPC, un objeto cualquiera), un cliente por red (remoto.ts) o uno por el socket local (local.ts). */
export type Origen = object;
export type Manejador = (e: Origen, ...args: any[]) => unknown;
export const quien = (e: Origen) => ("remoto" in e ? String(e.remoto) : "local" in e ? `local:${String(e.local)}` : "ventana");
/**
 * ¿Llegó por la tailnet? En modo local (TRAMA_LOCAL=1) o por loopback (127.0.0.0/8, ::1) el `/rpc` también viene como `remoto`, pero es esta
 * misma máquina. El servidor de la tailnet (aun en modo local, donde también hay uno) se marca con `tailnet`; y en modo local una IP que no
 * es loopback tampoco es de acá.
 */
const tailnet = (e: Origen) => {
  if (!("remoto" in e)) return false;
  if ("tailnet" in e) return true;
  const ip = "ip" in e && typeof e.ip === "string" ? e.ip : null;
  return ip !== null ? !esLoopback(ip) : !modoLocal();
};
/** ¿Es la PC la que pide (la ventana, o el navegador del modo local con su token)? Sólo así se lee y se guarda el acceso desde el celular. */
const esPc = (e: Origen) => !("remoto" in e) || ("navegador" in e && modoLocal() && !tailnet(e));

/** Los manejadores, por canal: los mismos para la ventana y para quien entra por red. */
const manejadores = new Map<string, Manejador>();
/**
 * Lo que cambia la máquina (reescribe `~/CLAUDE.md`, los ajustes, borra una cuenta, libera la GPU, actualiza `claude`): desde la
 * tailnet (el celular) no. Los `modelos:*` y `remoto:guardar` tienen su propio chequeo, con su mensaje, en el manejador.
 */
export const SOLO_PC_TAILNET: ReadonlySet<string> = new Set(["routing:guardar", "ajustes:guardar", "orq:leccionesGuardar", "limpieza:guardar", "limpieza:aplicar", "orq:mdAplicar", "orq:agentsGuardar", "orq:mdFusionar", "proyectos:renombrar", "proyectos:logo", "cuentas:quitar", "vram:liberar", "locales:prender", "locales:apagar", "claude:actualizar", "trama:actualizar", "trama:cancelarEspera", "trama:limpiar", "dsh:clave", "dsh:instalar", "dsh:probar", "aa:refrescar", "mcp:guardar", "mcp:quitar", "conectores:alternar", "plugins:agregarCatalogo", "plugins:instalar", "plugins:quitar", "opencode:planGuardar", "nvidia:modelos", "nvidia:probar"]);

/** Anota (o reemplaza) el manejador de un canal. */
export function manejar(canal: string, fn: Manejador) {
  manejadores.set(
    canal,
    SOLO_PC_TAILNET.has(canal)
      ? (e, ...args) => {
          // TODO i18n: no hay clave genérica en src/i18n (app/src es de otro dueño por ahora); mientras, el texto va en español.
          if (tailnet(e)) throw errorT("main.soloPc");
          return fn(e, ...args);
        }
      : fn,
  );
}
/** Los canales anotados con su manejador, en el orden en que se anotaron (ipc.ts registra cada uno). */
export const manejadoresAnotados = (): [string, Manejador][] => [...manejadores];

/** Lo que por red no se puede: salir de trama, y lo que abre o enfoca cosas en la pantalla de la PC (la lista está en canales/contrato.ts). */
export const SOLO_VENTANA: ReadonlySet<string> = new Set(SOLO_VENTANA_CONTRATO);

/**
 * Lo que sigue vedado al navegador del modo local (`TRAMA_LOCAL=1`, ya con su token): ahí el navegador es la interfaz
 * principal de esta misma máquina, así que consumo y borradores (que son suyos) sí; salir, elegir carpeta y demás no.
 */
export const SOLO_VENTANA_LOCAL: ReadonlySet<string> = new Set(SOLO_VENTANA_LOCAL_CONTRATO);

/**
 * Un pedido que llegó por red (ya con la identidad comprobada): el mismo manejador que usa la ventana. `ip` es la dirección real del socket.
 * `local` = el servidor del modo local (modo-local.ts), no la tailnet: usa `SOLO_VENTANA_LOCAL`. `tailnet` = el servidor de la tailnet (el celular),
 * también cuando el motor está en modo local.
 */
export async function llamarRemoto(canal: string, args: unknown[], cliente: string, ip?: string, opts?: { local?: boolean; tailnet?: boolean }): Promise<unknown> {
  const fn = (opts?.local ? SOLO_VENTANA_LOCAL : SOLO_VENTANA).has(canal) ? undefined : manejadores.get(canal);
  if (!fn) throw new Error(`canal desconocido: ${canal}`);
  return fn({ remoto: cliente, ...(ip !== undefined ? { ip } : {}), ...(opts?.local ? { navegador: true } : {}), ...(opts?.tailnet ? { tailnet: true } : {}) }, ...args);
}

/**
 * El servidor de la tailnet (remoto-armar.ts) se anota acá para que Ajustes pueda decirle "releé remoto.json" y preguntarle
 * dónde escucha, sin que el núcleo lo importe. Sin servidor (bench, captura, motor sin armar) no hay enlace: no escucha nada.
 */
export type EnlaceRemoto = { recargar(): Promise<void>; escuchando(): string[] };
let enlaceRemoto: EnlaceRemoto | null = null;
export const ponerEnlaceRemoto = (e: EnlaceRemoto | null) => void (enlaceRemoto = e);

/** Un cliente por red se fue: se deja de mirar el transcript que tenía abierto. */
export const soltarRemoto = (cliente: string) => {
  void mirarTranscript(cliente, null);
  pasos.soltar(cliente);
  maquinas?.soltar(cliente);
};

/** El pedido por el socket local que devuelve los canales del núcleo (no es un canal: por red no existe). */
export const CANALES = "local:canales";

/**
 * Un pedido por el socket local (local.ts: sólo esta máquina y este usuario, la ventana en modo cliente):
 * todo canal del núcleo, también los de `SOLO_VENTANA` que viven acá (borradores, consumo). Los que son
 * de la pantalla de la PC (`app:salir`, `volver:*`, `lider:ir`…) no están en el núcleo: "canal desconocido".
 */
export async function llamarLocal(canal: string, args: unknown[], cliente: string): Promise<unknown> {
  // La ventana cliente (ventana-cliente.ts) pregunta qué canales anotar en su IPC.
  if (canal === CANALES) return [...manejadores.keys()];
  const fn = manejadores.get(canal);
  if (!fn) throw new Error(`canal desconocido: ${canal}`);
  return fn({ local: cliente }, ...args);
}
export const soltarLocal = (cliente: string) => {
  void mirarTranscript(quien({ local: cliente }), null);
  pasos.soltar(quien({ local: cliente }));
  maquinas?.soltar(quien({ local: cliente }));
};

/** Lo que contesta `maquina:saludo`: la primera pregunta de quien junta a otra máquina. */
export function saludo(): Saludo {
  const c = leerMaquinas(ARCHIVO_MAQUINAS);
  return { version: 1, protocolo: PROTOCOLO, huella: HUELLA, maquina: "error" in c ? SOLA.esta : c.esta };
}
/** `$HILOS_STATE/maquinas.json`: las otras máquinas (maquinas-config.ts). */
export const ARCHIVO_MAQUINAS = path.join(ESTADO, "maquinas.json");
/**
 * Lo que la barra sabe de las máquinas (`maquinas:leer`, `maquinas:cambio`): esta y las otras con cómo están.
 * Sin otra máquina configurada `otras` viene vacía y la barra no muestra nada de esto.
 */
export type EstadoMaquinas = {
  esta: { id: string; nombre: string };
  otras: { id: string; nombre: string; fase: "conectando" | "conectada" | "caida"; acceso: "si" | "leer" | "no" }[];
};
let esta: EstadoMaquinas["esta"] = { id: SOLA.esta, nombre: "PC" };
export const estadoMaquinas = (): EstadoMaquinas => ({ esta, otras: maquinas?.estados() ?? [] });
let maquinasDicho = "";
function avisarMaquinas() {
  const e = estadoMaquinas();
  const dicho = JSON.stringify(e);
  if (dicho === maquinasDicho) return;
  maquinasDicho = dicho;
  enviar("maquinas:cambio", e);
}
/** Las otras máquinas cuyas filas se juntan a las de acá (maquinas.ts); sin `maquinas.json` (lo de siempre), null. */
let maquinas: Maquinas | null = null;
/** La PC que se prende desde acá (sólo en la otra máquina: `prender` en su entrada de `maquinas.json`; pc-estado.ts); en la PC, null. */
let pc: Pc | null = null;

/** Quien recibe lo que cambia (canal y dato): la ventana, los clientes por red. */
export type Oyente = (canal: string, dato: unknown) => void;
const oyentes = new Set<Oyente>();
/** Suma un oyente; devuelve con qué quitarlo. */
export function escuchar(fn: Oyente): () => void {
  oyentes.add(fn);
  return () => void oyentes.delete(fn);
}
/** Le avisa a cada oyente, en el orden en que llegaron; uno que falla no les saca el aviso a los demás. */
export function difundir(canal: string, dato: unknown) {
  for (const o of [...oyentes]) {
    try {
      o(canal, dato);
    } catch (e) {
      silencio("nucleo")(e);
    }
  }
}
const enviar = difundir;

/**
 * Quién cuenta cuántos clientes están mirando (la ventana, el socket local, la tailnet): los trabajos de fondo que sólo sirven
 * para mostrar algo (los cupos, cada minuto) se saltean si no hay nadie. Sin ninguna fuente anotada (bench, tests) se asume que sí.
 */
const fuentesClientes = new Set<() => number>();
export function contarClientes(fn: () => number): () => void {
  fuentesClientes.add(fn);
  return () => void fuentesClientes.delete(fn);
}
const hayClientes = () => fuentesClientes.size === 0 || [...fuentesClientes].some((f) => f() > 0);

/** Lo que se hace al salir de trama (guardar, cortar), en el orden en que se anotó: lo corre quien sale (ipc.ts, en `before-quit`). */
const ganchosSalida: (() => void)[] = [];
export function alSalir(fn: () => void) {
  ganchosSalida.push(fn);
}
export function correrSalida() {
  for (const g of ganchosSalida) {
    try {
      g();
    } catch (e) {
      silencio("salida")(e);
    }
  }
}

let cambioLider: () => void = () => {};
/** Un líder de la app cambió de estado (terminó su turno, salió) o llegó otra lista de workers: main.ts mira si ya puede relanzarse. */
export function alCambiarLider(fn: () => void) {
  cambioLider = fn;
}

/** El panel de consumo: sólo trabaja mientras está a la vista (consumo.ts). */
const consumo = crearConsumo({ proyectos: TRANSCRIPTS, paState: PA_STATE, alCambiar: (c) => enviar("consumo:cambio", c) });
/** Los pasos del worker abierto (ventana y celular): sólo trabaja mientras alguien lo mira (pasos-worker.ts). */
// Las bajadas de modelos de Ollama (Ajustes > Modelos): el progreso va a la ventana como `modelos:bajando`.
const bajadas = crearBajadas((b) => enviar("modelos:bajando", b));
const pasos = crearPasos({ proyectos: TRANSCRIPTS, paState: PA_STATE, alCambiar: (c) => enviar("pasos:cambio", c) });
/**
 * El registro histórico de en qué se van los tokens (historial.ts): se indexa solo, de fondo,
 * como mucho una vez por hora. Con fixtures, bench o captura no corre (`HILOS_HISTORIAL=0` lo apaga).
 */
const historial = crearHistorial({ proyectos: TRANSCRIPTS, paState: PA_STATE, carpeta: path.join(ESTADO, "historial") });
/** Las conversaciones de Claude Code que no son de Trama (claude-code.ts): índice cacheado por mtime en `$HILOS_STATE/claude-code.json`. */
const claudeCode = crearIndiceClaudeCode({
  raices: () => [TRANSCRIPTS, path.join(os.homedir(), ".claude", "projects"), ...cuentasClaude().map((c) => path.join(c.dir, "projects"))],
  propia: () => TRANSCRIPTS,
  cache: path.join(ESTADO, "claude-code.json"),
});
/** "Medir exacto" el peso de arrancar (arranque.ts): a pedido, con el mismo `claude` y entorno que los líderes. */
const arranque = crearArranque({ claude: process.env.HILOS_CLAUDE ?? "claude", cwd: os.homedir(), env: entornoLider(process.env, os.homedir()), estado: ESTADO });
const sinHistorial =
  process.env.HILOS_HISTORIAL === "0" ||
  !!(process.env.HILOS_BENCH || process.env.HILOS_CAPTURA || process.env.HILOS_CAPTURA_PNG || (process.env.HILOS_FIXTURES && process.env.HILOS_FIXTURES !== "0"));

// --- La cola de los líderes --------------------------------------------------------

/**
 * Lo que el usuario le manda a un líder a mitad de un turno (cola.ts): espera acá, en el
 * main y en disco, y sale cuando el líder queda libre. Saliendo de trama no sale nada: queda
 * guardado para la próxima.
 */
const ARCHIVO_COLA = path.join(ESTADO, "cola.json");
const NO_TRAE: Record<string, string> = {
  abierto: textoT("lider.noTraer"),
  sinSesion: textoT("lider.noSesion"),
  sinCarpeta: textoT("lider.noCarpeta"),
};
const cola = crearCola({
  disponible: async (sid) => (saliendo ? "ocupado" : lider.disponible(sid)),
  traer: (sid, x, cortar) => lider.traer({ sid, modelo: x.modelo, effort: x.effort, nombre: x.nombre, modo: x.modo, cortar }),
  mandar: (sid, x) => lider.mandar({ sid, texto: x.texto, imagenes: x.imagenes, modelo: x.modelo, effort: x.effort }),
  total: async (sid) => (await lider.conversacionLider({ sid, n: 1 })).total,
  // A mitad de un turno todo lo encolado entra junto en el próximo límite de herramienta (sin interrumpir); sin canal, al terminar el turno.
  puedeEnTurno: (sid) => !saliendo && lider.puedeEnTurno(sid),
  enTurno: (sid, x) => lider.mandarDirecto({ sid, texto: x.texto, imagenes: x.imagenes, modelo: x.modelo, effort: x.effort }),
  textoError: (x) => ("motivo" in x ? (NO_TRAE[x.motivo] ?? NO_TRAE.abierto) : String((x.error as Error)?.message ?? x.error)),
  guardar: (json) => escribirAtomico(ARCHIVO_COLA, json).catch(silencio("cola")),
  avisar: (a) => (movio(a.sid), enviar("lider:cola", a)),
});
/** La última lista buena de `pa --hilos` que pasó por acá. */
let ultimosHilos: readonly { id?: unknown; estado?: unknown; en_cola?: unknown; jefe_id?: unknown }[] = [];

// Los avisos de los workers (avisos-worker.ts): terminó, falló por cupo o por lo que sea, o se colgó. Al líder que lo lanzó le
// llega por la cola (sale en su próxima pausa): al terminar su tanda, un mensaje con una línea por worker; o uno por worker si
// lo eligió en Ajustes. La ventana y el celular reciben cada aviso para la notificación.
const avisosW = crearAvisosWorker({
  leerRastro: async (h) => {
    // Un corte por cupo dice cuándo vuelve en los cupos de `reparto`: se los pone al día antes de armar el aviso.
    await refrescarCupos(false).catch(() => null);
    return rastroDeWorker(PA_STATE, h);
  },
  procesoVivo: (h) => procesoVivoDe(PA_STATE, h),
  cupos: () => cuposActuales(),
  emitir: (a) => enviar("workers:aviso", a),
  alLider: (a) => avisarAlLider(a),
  avisoLider: () => avisoLiderGuardado(),
});
/**
 * El aviso al líder de la app que lanzó al worker (o la tanda entera). Un fin, o una tanda que sólo tuvo fines, sólo entra a mitad
 * de un turno (a un líder ocioso no se lo despierta por eso: su `pa --esperar` lo cobra); una falla sí, aunque esté ocioso: nadie
 * más se entera. Los líderes de una terminal no reciben nada (no se los trae por un aviso): se enteran por la notificación del dueño.
 */
function avisarAlLider(a: AvisoWorker) {
  const texto = textoParaLider(a);
  const sid = a.jefe_id;
  const sel = sid ? lider.seleccionDe(sid) : null;
  if (!texto || !sid || !sel) return;
  const soloFines = a.tipo === "tanda" ? (a.lineas ?? []).every((l) => l.tipo === "fin") : a.tipo === "fin";
  if (soloFines && !lider.puedeEnTurno(sid)) return;
  void leerCola().then(() => cola.encolar(sid, { texto, modelo: sel.modelo, effort: sel.effort, aviso: true }), silencio("cola"));
}
let relojAvisosW: NodeJS.Timeout | null = null;
/** Mientras haya un worker colgado a la vista, cada tanto se mira si ya cruzó el umbral. */
function vigilarAvisosW() {
  if (relojAvisosW || !avisosW.vigilando()) return;
  relojAvisosW = setTimeout(() => {
    relojAvisosW = null;
    avisosW.revisar();
    vigilarAvisosW();
  }, REVISAR_MS);
  relojAvisosW.unref();
}
/**
 * Los líderes de la app con workers vivos (su `pa --esperar` moriría con ellos): main.ts no relanza
 * trama mientras tanto. Con la lista releyéndose no se sabe (un worker recién lanzado todavía no
 * está): cuenta cualquier líder con proceso, hasta que la lectura termine.
 */
export const lideresEsperando = () => {
  const sids = lider.conProceso();
  return leyendoHilos() ? sids.length : esperandoWorkers(ultimosHilos, sids);
};
// Al traer un líder de una terminal, su primer mensaje avisa cuántos workers vivos le quedan por recoger.
lider.ponerWorkersVivos((sid) => workersEsperados(ultimosHilos, [sid]));
/** Los líderes con un mensaje de la cola saliendo ahora: main.ts no relanza trama en el medio. */
export const colaEnCamino = () => cola.enCamino();
/**
 * Las "tareas corriendo" que dice el cartel de la actualización mientras espera para reiniciar: líderes
 * respondiendo, integraciones y workers vivos de los líderes de la app. Con la lista releyéndose, los
 * workers no se saben: cuentan los líderes con proceso (lo mismo que frena el reinicio).
 */
export const tareasCorriendo = () => {
  const sids = lider.conProceso();
  return lider.respondiendo() + integrando() + (leyendoHilos() ? sids.length : workersEsperados(ultimosHilos, sids));
};

/**
 * Lo que reiniciar el motor (Actualizar de Trama) cortaría ahora: líderes con un turno o un mensaje saliendo, TODOS los
 * workers de `pa` vivos (cuelguen de quien cuelguen: ninguno tiene que quedarse sin quien cobre su resultado) y una integración
 * corriendo. Con la lista de workers releyéndose no se sabe: `leyendo` cuenta como ocupado.
 */
export const ocupacionDeTrama = (): Ocupacion => ({
  lideres: new Set([...lider.respondiendoSids(), ...cola.enCaminoSids()]).size,
  workers: ultimosHilos.filter((h) => h.estado === "trabajando" || h.estado === "colgado" || h.en_cola === true).length,
  otras: integrando(),
  leyendo: leyendoHilos(),
});

/** Cuándo arrancó este proceso (ms): lo que nadie movió desde entonces cuenta desde acá. */
const ARRANQUE = Date.now();
/** líder (sid) → cuándo (ms) pasó algo suyo o de sus workers: eventos del stream, de la cola, de `pa`. Lo lee `queEspera`. */
const actividad = new Map<string, number>();
const movio = (sid: string | null | undefined) => void (sid && actividad.set(sid, Date.now()));

/**
 * Quién frena un reinicio de trama, para decirlo en el cartel: los nombres de los líderes de la app que
 * responden, que tienen un mensaje de la cola saliendo o que esperan a workers vivos, si hay una
 * integración corriendo, y `ultima`: cuándo (ms) fue el último evento de cualquiera de ellos. Lo que no
 * tuvo ninguno en 20 min (`COLGADO_MS`) se da por colgado y el cartel ofrece "Reiniciar igual".
 */
export function queEspera(): { nombres: string[]; integrando: boolean; ultima: number } {
  const procesos = lider.conProceso();
  const sids = new Set<string>([...lider.respondiendoSids(), ...cola.enCaminoSids(), ...(leyendoHilos() ? procesos : lideresConWorkers(ultimosHilos, procesos))]);
  let ultima = integrandoDesde();
  for (const sid of sids) {
    let u = Math.max(actividad.get(sid) ?? 0, ARRANQUE);
    for (const h of ultimosHilos) {
      const w = h as { jefe_id?: unknown; inicio?: unknown; estado?: unknown };
      if (w.jefe_id === sid && (w.estado === "trabajando" || w.estado === "colgado") && typeof w.inicio === "number") u = Math.max(u, w.inicio * 1000);
    }
    ultima = Math.max(ultima, u);
  }
  return { nombres: [...sids].map((sid) => lider.nombreDe(sid) ?? sid.slice(0, 8)), integrando: integrandoDesde() > 0, ultima };
}

// --- La actualización de trama (relanzar.ts, lo arma main.ts) ----------------

/**
 * Lo que muestra el cartel: hay un build nuevo, el usuario ya pidió reiniciar (espera a `tareas`, que son los
 * líderes de `espera`: sus nombres, o una integración), o ya se está yendo. `colgado`: lo que espera lleva
 * 20 min sin un evento y se puede "Reiniciar igual".
 */
export type Reinicio = { hay: boolean; pedido: boolean; tareas: number; saliendo: boolean; espera: string[]; integrando: boolean; colgado: boolean };
const SIN_REINICIO: Reinicio = { hay: false, pedido: false, tareas: 0, saliendo: false, espera: [], integrando: false, colgado: false };
let reinicio: { estado(): Reinicio; pedir(igual: boolean): void; cancelar(): void } | null = null;
let reinicioDicho = JSON.stringify(SIN_REINICIO);
/** main.ts trae el relanzador: de acá salen los canales del cartel. */
export function ponerReinicio(r: NonNullable<typeof reinicio>) {
  reinicio = r;
}
/** Le dice a las vistas cómo está el cartel, si cambió. */
export function avisarReinicio() {
  const e = reinicio?.estado() ?? SIN_REINICIO;
  const dicho = JSON.stringify(e);
  if (dicho === reinicioDicho) return;
  reinicioDicho = dicho;
  enviar("reinicio:cambio", e);
}

const borradores = almacenBorradores(
  () => readFile(path.join(ESTADO, "borradores.json"), "utf8").catch(() => null),
  (json) => escribirAtomico(path.join(ESTADO, "borradores.json"), json),
);
/** Lo que quedó de la vez anterior, leído una sola vez. */
let colaLeida: Promise<void> | null = null;
let enviarEventos: Promise<unknown> = Promise.resolve();
const leerCola = () => (colaLeida ??= readFile(ARCHIVO_COLA, "utf8").then(cola.cargar, () => {}));

// --- Statusline -----------------------------------------------------------------

let mirandoSl = false;
let ultimoSl = "";
let ultimoTs = 0;

/** El mismo statusline sin lo que se mueve en cada turno de un jefe. */
function sinTs(s: Statusline) {
  return JSON.stringify({
    ...s,
    uso: s.uso && "ts" in s.uso ? { ...s.uso, ts: 0, suscripciones: s.uso.suscripciones?.map((x) => ({ ...x, ts: 0 })) } : s.uso,
    lideres: { ...s.lideres, lideres: s.lideres.lideres.map((l) => ({ ...l, actividad: 0 })) },
  });
}

/** Lo más nuevo que se vio del uso (Claude o cualquier suscripción): un dato releído sin cambios igual se avisa cada tanto. */
function tsDelUso(s: Statusline): number {
  const u = s.uso;
  return u && "ts" in u ? Math.max(u.ts, ...(u.suscripciones ?? []).map((x) => x.ts)) : 0;
}

/** Qué líderes esperan al usuario (espera.ts): se deriva de cada lectura, sin reloj propio. */
const espera = crearEspera();
/** Anota `espera` en cada líder de la lectura; lo que tiene algo en cola no espera (sale solo al terminar). */
function marcarEspera(s: Statusline) {
  espera.aplicar(s.lideres.lideres, new Set(cola.todas().filter((a) => a.lista.length > 0).map((a) => a.sid)));
}
/** El usuario abrió esa conversación o le escribió: deja de esperar (y las vistas se enteran). */
function verEspera(sid: string) {
  if (espera.visto(sid)) void avisarSl();
}

/** Los procesos de las sesiones vivas: si a uno lo matan, nadie avisa (vigia.ts). */
const vigia = crearVigia(
  (p) => vive(p.pid, p.procStart),
  () => {
    // Un líder menos (o caído) cambia los líderes; un worker menos, la lista: `pa` dice cuál murió.
    void avisarSl();
    if (mirandoEv) releerHilos();
  },
);
let mirandoEv = false;

/**
 * Una ventana del uso que se reinicia deja de valer sin que nada cambie en disco: a esa hora se
 * relee, una vez (no es un reloj: sin uso a la vista no hay nada armado).
 */
let alReinicio: NodeJS.Timeout | null = null;
function esperarReinicio(s: Statusline) {
  if (alReinicio) clearTimeout(alReinicio);
  alReinicio = null;
  const r = s.uso && "ts" in s.uso ? proximoReinicio(s.uso) : null;
  if (r === null) return;
  alReinicio = setTimeout(() => void avisarSl(), Math.max(1000, r * 1000 - Date.now() + 1000));
  alReinicio.unref();
}

// Los subagentes que lanzan las sesiones con proceso (subagentes.ts): se siguen mientras la sesión viva.
const subagentes = crearSubagentes({
  transcript: (sid) => lider.transcriptDe(sid),
  alCambiar: (todos) => enviar("subagentes:cambio", todos),
});
const vivosDe = (s: { lideres: { lideres: { id: string; vivo: boolean }[] } }) => s.lideres.lideres.filter((l) => l.vivo).map((l) => l.id);

async function avisarSl() {
  // Un líder de la terminal que terminó su turno, o uno que cambió de manos: lo que esperaba en su cola puede salir.
  void leerCola().then(cola.revisar);
  const s = await leerStatusline();
  marcarEspera(s);
  consumo.faltantes();
  pasos.faltantes();
  vigia.mirar(sesionesVistas());
  void subagentes.sincronizar(vivosDe(s)).catch(silencio("subagentes"));
  esperarReinicio(s);
  const ts = tsDelUso(s);
  const clave = sinTs(s);
  if (clave === ultimoSl && ts - ultimoTs < REFRESCO_TS_S) return;
  ultimoSl = clave;
  ultimoTs = ts;
  enviar("statusline:cambio", maquinas ? maquinas.statusline(s) : s);
}

function mirarSl() {
  if (mirandoSl) return;
  mirandoSl = true;
  let timer: NodeJS.Timeout | null = null;
  const avisar = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void avisarSl(), DEBOUNCE_MS);
  };
  // Los statusline (uso y caché) y las sesiones de Claude Code (un líder que abre o cierra).
  // Sin directorio no hay nada que mirar (y no se reintenta: sería polling); si el watcher cae, se rearma.
  for (const dir of [DIR, SESIONES]) mirarCarpeta(dir, avisar, { donde: "statusline", alRearmar: avisar });
  alCambiarCupos(avisar);
  // Los cupos de las demás suscripciones (reparto): se releen cada minuto desde acá, no desde la vista.
  setInterval(() => {
    if (hayClientes()) {
      void lider.pedirUsoCuentas().then((nuevo) => { if (nuevo) void refrescarCupos(true); });
      void refrescarCupos(true);
      avisar(); // el uso gratis de OpenCode lo anota el puente (otro proceso) en agotado.json: se relee acá
    }
  }, 60_000).unref();
}

// --- Líderes -------------------------------------------------------------------

/**
 * El transcript del líder abierto: cada vista mira uno solo (el suyo), su directorio. Las vistas
 * son la ventana y cada cliente por red (`quien`): que el celular abra otro líder no le saca el suyo a la PC.
 */
const mirandoT = new Map<string, { sid: string; w: Mirada }>();
/** El último sid que pidió cada vista: si cambió de líder mientras se buscaba el transcript, gana el último. */
const pedidoT = new Map<string, string | null>();
/** El aviso pendiente de cada transcript: dos vistas en el mismo líder reciben uno solo. */
const avisoT = new Map<string, NodeJS.Timeout>();

async function mirarTranscript(vista: string, sid: string | null) {
  // Sin sid, nunca se sale antes de anotar el pedido: si no, uno en vuelo (buscando el transcript) de un cliente que ya se fue armaba el watcher igual.
  if (sid && mirandoT.get(vista)?.sid === sid) return;
  pedidoT.set(vista, sid);
  mirandoT.get(vista)?.w.cerrar();
  mirandoT.delete(vista);
  if (!sid) return void pedidoT.delete(vista);
  const dir = path.dirname((await lider.transcriptDe(sid)) ?? lider.transcriptPorDefecto(sid));
  if (pedidoT.get(vista) !== sid) return;
  // Otra llamada con el mismo sid pudo haber armado el suyo mientras tanto.
  mirandoT.get(vista)?.w.cerrar();
  mirandoT.delete(vista);
  const archivo = `${sid}.jsonl`;
  const avisar = () => {
    clearTimeout(avisoT.get(sid));
    avisoT.set(
      sid,
      setTimeout(() => {
        avisoT.delete(sid);
        enviar("lider:transcript", sid);
      }, DEBOUNCE_MS),
    );
  };
  // Sin directorio todavía (`null`): el primer turno lo crea y el `fin` del stream ya avisa. Si el watcher cae, se rearma.
  const w = mirarCarpeta(
    dir,
    (_t, nombre) => {
      if (!nombre || nombre === archivo) avisar();
    },
    { donde: "transcript", alRearmar: avisar },
  );
  if (w) mirandoT.set(vista, { sid, w });
}

/**
 * Salir de verdad (Ctrl+Q; cerrar la ventana sólo la esconde, ver main.ts).
 * Si hay líderes respondiendo y no es `forzar`, no sale: devuelve cuántos son
 * y la barra pide confirmación en línea (otro Ctrl+Q corta y sale). Los
 * ociosos se cierran solos (stdin cerrado). Con 0, quien llama sale del proceso
 * (ipc.ts: `app.quit`); `alIrse` va antes de cerrar a los líderes (esconder la ventana).
 */
let saliendo = false;
export async function salir(forzar: boolean, alIrse: () => void = () => {}): Promise<number> {
  const n = lider.ocupados();
  if (n > 0 && !forzar) return n;
  saliendo = true;
  alIrse();
  await lider.cerrarTodos(forzar);
  return 0;
}

/**
 * "Cerrar y parar todo": lo de `salir` más parar los workers de `pa` vivos que cuelgan de los líderes de trama (los de ahora y los que
 * lideres.json recuerda), cada uno por su id con `pa --parar`: nunca por patrón ni a un proceso que trama no conozca. Los workers van
 * primero (el `pa --esperar` de un líder moriría con él y nadie cobraría el resultado) y después se cierran los líderes. A diferencia de
 * `salir`, no marca que el proceso se va: en el motor, que sigue vivo, el próximo cierre de verdad tiene que poder esperar a los líderes.
 * Con líderes respondiendo y sin `forzar` no hace nada y devuelve cuántos son.
 */
export async function pararTodo(
  forzar: boolean,
  alIrse: () => void = () => {},
  o: { hilos?: () => ReturnType<typeof hilosAhora>; pararWorker?: (x: { id: string }) => Promise<void> } = {},
): Promise<number> {
  const n = lider.ocupados();
  if (n > 0 && !forzar) return n;
  alIrse();
  const sids = new Set([...lider.conProceso(), ...(await lider.lideresApp()).map((g) => g.sid)]);
  const ids = workersVivosDe((o.hilos ?? hilosAhora)(), sids);
  const frenar = o.pararWorker ?? parar;
  let fallaron = 0;
  await Promise.all(
    ids.map((id) =>
      frenar({ id }).catch((e) => {
        fallaron++;
        log.escribir("aviso", "salida", `no se pudo parar al worker ${id}: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
      }),
    ),
  );
  log.escribir("info", "salida", `parar todo: ${ids.length - fallaron} de ${ids.length} worker(s) parados, ${lider.vivos()} líder(es) a cerrar`);
  // Pidió parar todo: los líderes no quedan `dormido`, así que `reanudarDormidos` no los relanza al próximo arranque.
  await lider.cerrarTodos(forzar, undefined, false);
  return 0;
}
const hilosAhora = () => ultimosHilos;

/**
 * Un quit que no pasó por Ctrl+Q (p. ej. la sesión que se cierra): espera a los que responden, pero
 * nunca más de `TOPE_SALIDA_MS` (10 s): el 13/10 un cierre de sesión esperó a un líder 120 s y systemd
 * mató a trama con SIGKILL. El estado (`volver.json`) ya se guardó en el `before-quit` de main.ts; lo que
 * no cerró a tiempo se corta (su conversación sigue en disco) y queda en el log (`cerrarTodos`).
 * `null`: no hay a quién esperar, se sale ya. Si no, quien sale frena el quit, espera esto y sale.
 */
export function esperarSalida(alIrse: () => void = () => {}): Promise<unknown> | null {
  if (saliendo || lider.vivos() === 0) return null;
  saliendo = true;
  alIrse();
  return lider.cerrarTodos(false);
}
/** El tope de `cerrarTodos` (lider.ts): quien sale agrega su red de última instancia encima. */
export const TOPE_SALIDA_MS = lider.TOPE_SALIDA_MS;

// --- Armado ---------------------------------------------------------------------

/** Anota los manejadores de todos los canales del núcleo y arranca lo que corre solo (la cola). Una vez. */
export function armarNucleo() {
  // Las otras máquinas: se lee una vez. Sin el archivo, nada se arma y todo es como siempre.
  const cfg = leerMaquinas(ARCHIVO_MAQUINAS);
  if ("error" in cfg) log.escribir("error", "maquinas", cfg.error);
  else {
    for (const m of cfg.malas) log.escribir("error", "maquinas", m);
    esta = { id: cfg.esta, nombre: identidadDe(cfg).nombre };
    // Una máquina con `prender` es sólo para prenderla: nunca se conecta a su motor (la otra máquina no manda en la PC).
    const prendible = cfg.maquinas.find((m) => m.prender);
    if (prendible) {
      pc = crearPc({ maquina: prendible, alCambio: (e) => enviar("pc:cambio", e) });
      alSalir(() => pc?.cerrar());
    }
    maquinas = crearMaquinas({
      config: { ...cfg, maquinas: cfg.maquinas.filter((m) => !m.prender) },
      alEvento: enviar,
      alEstado: avisarMaquinas,
      alCambio(que) {
        const m = maquinas!;
        if (que === "hilos") {
          const l = m.ultimaHilos();
          if (l) enviar("hilos:cambio", hilosEmisor.siguiente(m.hilos(l)));
        } else if (que === "statusline") {
          const s = m.ultimo("sl");
          if (s) enviar("statusline:cambio", m.statusline(s));
        } else if (que === "compactando") {
          const c = m.ultimo("comp");
          if (c) enviar("compactando:cambio", m.compactando(c));
        } else if (que === "tablero") enviar("tablero:cambio", null);
      },
    });
    if (maquinas) alSalir(() => maquinas?.cerrar());
  }
  alSalir(() => subagentes.cerrar());
  // Los que tenían proceso cuando trama se cortó sin cerrarlos (la PC, la app) murieron: Retomar los levanta.
  void lider.marcarCortados().catch(silencio("lider"));
  // Los líderes que tenían proceso cuando trama se cerró (reinicio, salida) vuelven a tenerlo, sin que nadie escriba.
  void lider.reanudarDormidos().catch(silencio("lider"));
  // Las carpetas donde ya trabajan líderes (nuevos, retomados, traídos de Claude Code) quedan como proyectos, sin pasos manuales.
  void lider.anotarProyectosDeLideres().catch(silencio("proyectos"));
  // Los adjuntos de hace más de una semana no sirven más.
  void limpiarAdjuntos(path.join(ESTADO, "adjuntos")).catch(silencio("adjuntos"));
  // Trama que arranca con algo en la cola (aunque nadie abra la ventana): lo que ya puede salir, sale.
  void leerCola().then(cola.revisar);
  const leerSl = async () => {
    mirarSl();
    // Y al abrir una vista: lo que esperaba a un líder de terminal que ya terminó.
    void leerCola().then(cola.revisar);
    const s = await leerStatusline();
    marcarEspera(s);
    vigia.mirar(sesionesVistas());
    void subagentes.sincronizar(vivosDe(s)).catch(silencio("subagentes"));
    esperarReinicio(s);
    ultimoSl = sinTs(s);
    ultimoTs = tsDelUso(s);
    return s;
  };
  manejar("statusline:leer", leerSl);
  manejar("maquina:saludo", () => saludo());
  manejar("maquinas:leer", () => estadoMaquinas());
  // "Actualizar límites": antes de releer, el uso como lo dice claude.ai (`get_usage`, por `claude`
  // mismo). Si no contesta queda lo que había, con su "visto hace". Las otras vistas se enteran.
  manejar("statusline:sincronizar", async () => {
    await Promise.all([lider.pedirUsoOficial(), lider.pedirUsoCuentas(true)]);
    await refrescarCupos(true);
    await avisarSl();
    return leerSl();
  });

  // Por las dudas (algo que murió en cola, sin sesión que mirar): mientras `pa` dé algo por
  // vivo, la lista se relee sola cada tanto. Sin nada vivo no hay reloj.
  let respaldo: NodeJS.Timeout | null = null;
  let hayVivos = false;
  // A la ventana y al celular la lista va por diferencias (hilos-dif.ts); quien pierde el hilo pide la entera.
  const hilosEmisor = crearEmisor();
  /** La lectura de acá con las filas de las otras máquinas (si hay). */
  const juntas = (l: Awaited<ReturnType<typeof leerHilos>>) => (maquinas ? maquinas.hilos(l) : l);
  alLeerHilos((l) => {
    enviar("hilos:cambio", hilosEmisor.siguiente(juntas(l)));
    // "Integrar solo lo seguro" (B22): cada lista buena se barre.
    const d = "datos" in l ? (l.datos as { version?: unknown; hilos?: unknown }) : null;
    if (d?.version === 1 && Array.isArray(d.hilos)) {
      hayVivos = d.hilos.some(vivoEnPa);
      ultimosHilos = d.hilos;
    }
    if (d?.version === 1 && Array.isArray(d.hilos)) void avisosW.hilos(d.hilos as Parameters<typeof avisosW.hilos>[0]).then(vigilarAvisosW, silencio("ipc"));
    consumo.repasar();
    if (!sinHistorial) historial.pedir();
    // Terminó un worker (o la lectura): main.ts mira si ya puede relanzarse.
    cambioLider();
    if (respaldo) clearTimeout(respaldo);
    respaldo = hayVivos ? setTimeout(releerHilos, RESPALDO_MS) : null;
    respaldo?.unref();
    if (d?.version === 1 && Array.isArray(d.hilos)) {
      void barrer(d.hilos).catch(silencio("ipc"));
      // B25: lo que pasó a integrado se chequea con los `tests` sobre main.
      void barrerSalud(d.hilos).catch(silencio("ipc"));
    }
  });
  alCambiarSalud((e) => enviar("salud:cambio", e));
  manejar("salud:leer", () => estadoSalud());
  manejar("salud:arreglar", (_e, h: Parameters<typeof arreglarDatos>[0]) =>
    arreglarDatos({ id: h?.id, proyecto: h?.proyecto, rama: h?.rama ?? null }),
  );
  alSalir(cortarChequeos);
  alCambiarAuto((e) => enviar("auto:cambio", e));
  manejar("auto:leer", () => estadoAuto());
  manejar("auto:prender", async (_e, si: unknown) => {
    if (await guardarAutoIntegrar(si)) cambioPrendido();
  });
  manejar("hilos:leer", () => {
    if (!mirandoEv) {
      mirandoEv = true;
      // Cada tanda de eventos relee la lista y le avisa al frontend qué hilos nombró
      // (la vista abierta relee su conversación si es uno de esos) y qué dijo cada línea
      // (un worker que arranca o se frena se pinta ya, sin esperar a la lista).
      mirarEventos((ids, eventos) => {
        for (const id of ids) movio((ultimosHilos.find((h) => (h as { id?: unknown }).id === id) as { jefe_id?: string } | undefined)?.jefe_id);
        // Antes de releer: los `parar` tienen que estar anotados para marcar la lista nueva.
        void anotarFrenados(eventos)
          .catch(silencio("ipc"))
          .then(releerHilos);
        avisosW.eventos(eventos);
        enviar("eventos:ids", ids);
        // En cadena: los eventos salen en el orden en que `pa` los escribió aunque uno espere su lectura.
        if (eventos.length) enviarEventos = enviarEventos.then(() => conLider(eventos, PA_STATE)).then((es) => enviar("eventos:pa", es), silencio("ipc"));
      });
    }
    return leerHilos().then(juntas);
  });
  manejar("hilos:completa", () => hilosEmisor.completa() ?? leerHilos().then(juntas));
  manejar("hilos:guardados", () => hilosGuardados());

  // Los paneles del pie: Ajustes, Estadísticas y las acciones de Ramas.
  // Con agy, los modelos son los que ofrece SU cuenta (`reparto --agy-modelos`, con caché); se calienta al arrancar para que el primer pedido no espere.
  if (hayAgy()) void agyOfrecidos();
  manejar("modelos:config", async () => vistaModelos(modelosConfig(), hayAgy(), vistaLocales(), hayDsh(), modelosOpencode(), effortsOpencode(), planOpencode(), hayAgy() ? ((await agyOfrecidos()) ?? []) : []));
  manejar("dueno:nombre", () => nombreDueno());
  manejar("ajustes:leer", () => leerAjustes());
  // Ajustes editable: el plan y la red de seguridad (ajustes-editar.ts) y el acceso desde el celular (remoto-config.ts).
  manejar("ajustes:guardar", async (_e, cambio: unknown) => {
    await guardarAjustes(cambio, ejecutar);
    return leerAjustes();
  });
  // Quién entra por la tailnet no lo cambia nadie que haya entrado por ella: por red se contesta que no es editable.
  manejar("remoto:leer", async (e) => {
    // Por red (el celular, o un navegador sin ser el local) no hay acceso por la tailnet que editar. En la PC sin Tailscale se explica cómo instalarlo.
    if (!esPc(e)) return { version: 1, editable: false };
    if (!capacidades().tailscale) return { version: 1, editable: false, sinTailscale: plataformaActual() };
    return { version: 1, editable: true, ...(await leerEditable()), escuchando: enlaceRemoto?.escuchando() ?? [], accesos: await accesos.leer() };
  });
  manejar("remoto:guardar", async (e, config: unknown) => {
    if (!esPc(e)) throw errorT("main.remotoSoloPc");
    const c = await guardarConfig(config);
    await accesos.olvidar(c.dispositivos);
    await enlaceRemoto?.recargar();
    return { version: 1, editable: true, ...c, escuchando: enlaceRemoto?.escuchando() ?? [], accesos: await accesos.leer() };
  });
  // Los umbrales del anillo de contexto (B16): el relevo del líder y el autocompact.
  manejar("contexto:umbral", () => leerUmbrales());
  manejar("medicion:leer", () => leerMedicion());
  manejar("claudeCode:listar", async () => {
    const { convs } = await claudeCode.listar();
    const [apps, pa, reg] = await Promise.all([lider.lideresApp(), sidsDePa(PA_STATE), registro()]);
    return vistaConvs(convs, {
      excluidas: new Set([...apps.map((l) => l.sid), ...pa]),
      rutas: reg.map((p): [string, string] => [p.ruta, p.slug]),
      casa: await real(os.homedir()),
      real,
      existe: (p) => statArchivo(p).then((s) => s.isDirectory(), () => false),
    });
  });
  manejar("historial:consultar", (_e, dias: unknown, rol: unknown) => historial.ultimos(dias, rol));
  manejar("historial:arranque", () => arranque.leer());
  manejar("historial:medir", () => arranque.medir());
  manejar("pa:rama", (_e, accion: AccionRama, h: { id: string; proyecto: string }) =>
    accionRama(accion, { id: h?.id, proyecto: h?.proyecto }),
  );
  // Un worker de rama (Actualizar) con el modelo y el effort que eligió el usuario en el paso previo.
  // "Relanzar con otro modelo" de un aviso de cupo: la misma tarea, sin modelo fijo, colgada del mismo líder. La tarea sale de la lista, no del renderer.
  manejar("workers:relanzar", (_e, x: { id?: unknown }) => {
    const h = (ultimosHilos as readonly unknown[]).find((f) => (f as { id?: unknown }).id === x?.id) as Parameters<typeof relanzarWorker>[0] | undefined;
    if (!h) throw errorT("main.idRaro", { v: String(x?.id) });
    return relanzarWorker(h);
  });
  manejar("pa:lanzar", (_e, x: Parameters<typeof lanzarRama>[0]) =>
    lanzarRama({ accion: x?.accion, id: x?.id, proyecto: x?.proyecto, modelo: x?.modelo, effort: x?.effort, texto: x?.texto }),
  );
  // La orquestación de `pa` (orquestacion.ts): lecciones que piden poda, auditar una rama y la plantilla de AGENTS.md.
  // La limpieza de worktrees y ramas viejos de `pa` (limpieza-pa.ts): lo que se quitaría, quitarlo y la config (la pasada automática nace apagada).
  manejar("limpieza:leer", () => leerLimpieza());
  manejar("limpieza:guardar", (_e, cambio: unknown) => guardarLimpieza(cambio));
  manejar("limpieza:ver", (_e, dias: unknown) => verLimpieza(ejecutar, dias));
  manejar("limpieza:aplicar", (_e, dias: unknown) => aplicarLimpieza(ejecutar, dias));
  if (!process.env.HILOS_BENCH && !process.env.HILOS_CAPTURA && !process.env.HILOS_CAPTURA_PNG) programarPasadas(() => pasadaAutomatica(leerLimpieza, ejecutar));
  manejar("orq:lecciones", () => leccionesPendientes(PA_STATE));
  manejar("orq:podaTexto", async (_e, slug: unknown) => textoPoda(await nombrePa(slug), ejecutar));
  manejar("orq:leccionesLeer", (_e, slug: unknown) => leerLecciones(PA_STATE, slug));
  manejar("orq:leccionesGuardar", (_e, slug: unknown, texto: unknown) => guardarLecciones(PA_STATE, slug, texto));
  // Un revisor de sólo lectura sobre la rama de un worker, desacoplado (`pa --auditar … --async`): vuelve en cuanto `pa` lo deja corriendo.
  manejar("orq:auditar", async (_e, x: { id: string; proyecto: string; modelo: string }) => {
    const args = argvAuditar({ id: x?.id, proyecto: x?.proyecto, modelo: x?.modelo }, await nombrePa(x?.proyecto));
    return enCola(String(x.proyecto), () => ejecutar(args)).then(({ rc, dijo }) => ({ rc, dijo }));
  });
  manejar("orq:agentsMd", async (_e, slug: unknown) => {
    const nombre = await nombrePa(slug);
    const p = (await registro()).find((r) => r.nombre === nombre);
    return { ...(await datosAgentsMd(nombre, ejecutar)), proyecto: nombre, ruta: p?.ruta ?? null };
  });
  // Unificar instrucciones (unificar-md.ts): AGENTS.md como fuente única de CLAUDE.md / GEMINI.md. El renderer pasa un slug, nunca una ruta:
  // la carpeta sale del registry (y el nombre de los archivos es fijo), así no hay forma de apuntar a otro lado.
  const carpetaDe = async (slug: unknown) => {
    const s = String(slug ?? "");
    const p = (await registro()).find((r) => r.slug === s);
    if (!p) throw errorT("main.proyectoRaro", { v: s });
    return p;
  };
  manejar("orq:mdEstado", async (_e, slug: unknown) => {
    const p = await carpetaDe(slug);
    const st = await estadoMd(p.ruta);
    st.tareaEnCurso = tareaMdEnCurso(p.slug, ultimosHilos);
    return st;
  });
  manejar("orq:mdPlan", async (_e, slug: unknown) => planUnificar((await carpetaDe(slug)).ruta));
  manejar("orq:mdAplicar", async (_e, slug: unknown, huella: unknown) => {
    const p = await carpetaDe(slug);
    return aplicarUnificar(p.ruta, path.join(PA_STATE, p.slug), huella);
  });
  manejar("orq:agentsLeer", async (_e, slug: unknown) => leerAgents((await carpetaDe(slug)).ruta));
  manejar("orq:agentsGuardar", async (_e, slug: unknown, texto: unknown) => {
    const p = await carpetaDe(slug);
    return guardarAgents(p.ruta, path.join(PA_STATE, p.slug), texto);
  });
  manejar("orq:mdFusionar", async (_e, slug: unknown, tipo: unknown) => {
    const p = await carpetaDe(slug);
    const t: TipoTareaMd = tipo === "acortar" ? "acortar" : "fusionar";
    return lanzarTareaMd(p.slug, t, { hilos: ultimosHilos as any[] });
  });
  // El nombre para mostrar de cada proyecto (proyectos-alias.ts; `pa --renombrar` hace lo mismo): cambia sólo ese texto del registry.
  manejar("proyectos:lista", () => listarProyectos(registroProyectos()));
  manejar("proyectos:renombrar", (_e, slug: unknown, nombre: unknown) => renombrarProyecto(registroProyectos(), slug, nombre));
  // El logo elegido a mano (ya achicado por la ventana; `null`: vuelve al automático): se guarda en el registry, junto al nombre propio.
  manejar("proyectos:logo", (_e, slug: unknown, logo: unknown) => logoProyecto(registroProyectos(), slug, logo));
  manejar("routing:guardar", (_e, cambios: Cambio[]) =>
    guardarRouting((Array.isArray(cambios) ? cambios : []).map((c) => ({ rol: c?.rol, modelo: c?.modelo ?? null, effort: c?.effort ?? null }))),
  );
  // La config de modelos que comparten pa y trama (`~/.config/trama/modelos.json`, modelos-config.ts): leerla, guardarla y preguntarle a un Ollama qué modelos tiene.
  // `leer` y `guardar` devuelven enseguida (sin `efectivo`): lo que elegiría `reparto` hoy sale de `pa --modelos --json`, que corre `reparto`
  // por cada tipo y tarda; el panel lo pide aparte (`modelos:efectivo`) para no hacer esperar a todo lo demás.
  manejar("modelos:leer", () => leerModelos());
  manejar("modelos:efectivo", () => efectivoDePa(ejecutar));
  // Quién entra por la tailnet no cambia a dónde mandan los prompts ni sondea direcciones desde la PC: guardar y sondear, sólo en la PC.
  manejar("modelos:guardar", async (e, config: unknown) => {
    if (tailnet(e)) throw errorT("main.modelosSoloPc");
    return guardarModelos(config);
  });
  manejar("modelos:sondear", (e, url: unknown) => {
    if (tailnet(e)) throw errorT("main.modelosSoloPc");
    return sondearOllama(url);
  });
  // Bajar un modelo de Ollama por su nombre (`/api/pull`): sólo desde la PC, con progreso por `modelos:bajando`.
  manejar("modelos:bajar", (e, url: unknown, modelo: unknown) => {
    if (tailnet(e)) throw errorT("main.modelosSoloPc");
    return bajadas.bajar(url, modelo);
  });
  manejar("modelos:cancelarBajada", (e, url: unknown, modelo: unknown) => {
    if (tailnet(e)) throw errorT("main.modelosSoloPc");
    bajadas.cancelar(url, modelo);
  });
  manejar("modelos:bajadas", () => bajadas.lista());
  // Qué hay en esta máquina para Ollama (instalado, distro, GPU y VRAM, y los comandos de instalar y arrancar): sólo lee, no instala ni arranca nada.
  manejar("modelos:entorno", () => leerEntornoOllama());
  // DeepSeek Harness (Ajustes > Modelos): si está instalado, instalarlo, qué keys hay (nunca su valor), guardar o borrar una key y probar un proveedor.
  // Instalar, guardar una key y probar (que usa la key guardada) son sólo de la PC: `SOLO_PC_TAILNET`.
  manejar("dsh:estado", () => estadoDsh());
  manejar("dsh:instalar", () => instalarDsh());
  manejar("dsh:clave", async (_e, nombre: unknown, valor: unknown) => {
    await guardarClave(nombre, valor === null || valor === undefined ? null : String(valor));
    return estadoDsh();
  });
  manejar("dsh:probar", (_e, proveedor: unknown, url: unknown) => probarProveedor(proveedor, url));
  // Conectores (Ajustes > Conectores y el `/mcp` de un líder): los servidores MCP propios de Trama (`mcp.json`; los valores secretos van a `claves.env` y no vuelven)
  // y lo que ve un líder de cada motor. Guardar y quitar son sólo de la PC: `SOLO_PC_TAILNET`.
  manejar("mcp:estado", (_e, x: { motor?: unknown; local?: unknown; fresco?: unknown } | undefined) => estadoMcp(x?.motor, x?.local === true, x?.fresco === true));
  manejar("mcp:lista", () => vistaMcp());
  manejar("mcp:guardar", (_e, entrada: unknown) => guardarServidor(entrada));
  manejar("mcp:quitar", (_e, nombre: unknown) => quitarServidor(nombre));
  // Lo que tiene conectado Claude Code (skills, plugins, MCP, hooks) y prender o apagar lo que deja: de esta máquina, nunca los secretos.
  manejar("conectores:inventario", () => inventarioConectores());
  manejar("conectores:alternar", (_e, id: unknown, activo: unknown) => alternarConector(id, activo));
  // Catálogos de plugins (Ajustes > Conectores): leer los catálogos y agregar, instalar o quitar con el `claude plugin …` de la cuenta elegida.
  const depsPlugins = (): DepsPlugins => ({ env: process.env, home: os.homedir() });
  manejar("plugins:catalogos", () => estadoCatalogos(depsPlugins()));
  manejar("plugins:agregarCatalogo", (_e, repo: unknown, cuenta: unknown) => agregarCatalogo(repo, cuenta, depsPlugins()));
  manejar("plugins:instalar", (_e, plugin: unknown, catalogo: unknown, cuenta: unknown) => instalarPlugin(plugin, catalogo, cuenta, depsPlugins()));
  manejar("plugins:quitar", (_e, plugin: unknown, catalogo: unknown, cuenta: unknown) => quitarPlugin(plugin, catalogo, cuenta, depsPlugins()));
  // OpenCode (el programa `opencode`: los modelos gratis sólo andan por él): instalado, versión, login y modelos; «Actualizar modelos» vuelve a listarlos.
  // La tabla de `reparto --tabla --json` (Ajustes > Modelos > Modelos para workers): sólo lee. Guardar el permitido y la inteligencia
  // va por `modelos:guardar` (excluir / calidad de modelos.json), que ya rechaza a quien entra por la tailnet.
  // Inteligencia de Artificial Analysis (la key se guarda por `dsh:clave`): el estado de la caché, y bajar la lista a pedido. Al leer la
  // tabla se refresca sola (de fondo) si la caché tiene más de un día (sin key, en pruebas y capturas no se llama a nadie salvo con AA_URL).
  const claveAA = async () => process.env.ARTIFICIAL_ANALYSIS_API_KEY || (await leerClaves()).ARTIFICIAL_ANALYSIS_API_KEY;
  const aislado = () => (process.env.HILOS_PRUEBA === "1" || process.env.HILOS_CAPTURA === "1" || process.env.HILOS_BENCH === "1") && !process.env.AA_URL;
  // `soloPc`: el refresco es sólo de la PC (`SOLO_PC_TAILNET`): por la tailnet Ajustes lo dice en el botón, no falla con un error de red.
  manejar("aa:estado", async (e) => ({ ...(await estadoAA(!!(await claveAA()))), soloPc: tailnet(e) }));
  manejar("aa:refrescar", async () => {
    const clave = await claveAA();
    const resultado = await refrescarAA(clave, { forzar: true, baseUrl: process.env.AA_URL });
    return { resultado, estado: await estadoAA(!!clave) };
  });
  // La tabla sale de la caché que ya hay; si hace falta bajar Artificial Analysis se hace de fondo y, cuando termina, avisa (`reparto:tablaNueva`).
  const tablaReparto = crearLectorTabla({
    leer: leerTabla,
    refrescar: async () => (aislado() ? null : refrescarAA(await claveAA(), { baseUrl: process.env.AA_URL })),
    alRefrescar: () => enviar("reparto:tablaNueva", null),
  });
  manejar("reparto:tabla", () => tablaReparto());
  manejar("opencode:estado", () => vistaOpencode());
  manejar("opencode:actualizar", () => actualizarOpencode());
  // OpenCode Go (plan pago, apagado por defecto): el plan y los topes por modelo; elegir el plan es sólo de la PC (`SOLO_PC_TAILNET`).
  // Los topes se leen de opencode.ai/go al arrancar y cada día (caché en el estado de trama; sin red queda el respaldo go-topes.json).
  if (!aislado()) mantenerTopesGo();
  manejar("opencode:plan", () => vistaPlanGo());
  manejar("opencode:planGuardar", async (_e, plan: unknown) => {
    await guardarPlanOpencode(plan);
    return vistaPlanGo();
  });
  // NVIDIA NIM (gratis, con clave propia; la clave se guarda por `dsh:clave`): el estado, qué modelos ofrece reparto y la prueba mínima.
  manejar("nvidia:estado", () => estadoNim());
  manejar("nvidia:modelos", async (_e, lista: unknown) => {
    await guardarModelosNim(lista);
    return estadoNim();
  });
  manejar("nvidia:probar", () => probarNim());
  manejar("ramas:brief", (_e, hs: Parameters<typeof briefRamas>[0]) => briefRamas(hs));
  manejar("hilo:retomar", (_e, h: Parameters<typeof retomarDatos>[0]) =>
    retomarDatos({
      id: h?.id,
      proyecto: h?.proyecto,
      rama: h?.rama ?? null,
      commits: h?.commits,
      tarea: h?.tarea,
      resultado: h?.resultado ?? null,
      decision: h?.decision ?? null,
      estado: h?.estado,
    }),
  );
  manejar("hilo:pasar", (_e, h: Parameters<typeof pasarALider>[0]) =>
    pasarALider({
      id: h?.id,
      proyecto: h?.proyecto,
      rama: h?.rama ?? null,
      commits: h?.commits,
      tarea: h?.tarea,
      resultado: h?.resultado ?? null,
      decision: h?.decision ?? null,
    }),
  );

  manejar("leidos:leer", () => leerLeidos());
  manejar("leidos:marcar", (_e, id: string, ts: number) => marcarLeido(id, ts));
  alSalir(guardarYa);
  // B20: títulos, carpetas de líderes y carpetas con los terminados ocultos (nombres.json).
  const nombres = almacenNombres(path.join(ESTADO, "nombres.json"), escribirAtomico);
  manejar("nombres:leer", () => nombres.leer());
  manejar("nombres:titulo", (_e, id: unknown, titulo: unknown) => nombres.titulo(id, titulo));
  manejar("nombres:proyecto", (_e, sid: unknown, slug: unknown) => nombres.proyecto(sid, slug));
  manejar("nombres:oculto", (_e, slug: unknown, si: unknown) => nombres.oculto(slug, si));
  // El orden que se puso arrastrando: se le avisa a la ventana y al celular, así ninguno pisa al otro con uno viejo.
  manejar("nombres:orden", async (_e, orden: unknown) => enviar("nombres:orden", (await nombres.orden(orden)).orden));
  // Las carpetas a las que se puede mover un líder: los proyectos del registry.
  manejar("proyectos:carpetas", destinos);
  // Cómo se ve cada carpeta que trae `titulo` en el registry (slug → título); a `pa` va el nombre.
  // Con qué nombre anota el tablero cada carpeta (nombre del registry, alias incluidos → slug): para Iniciar una tarea.
  manejar("proyectos:nombres", () => slugsPorNombre());
  manejar("proyectos:titulos", async () => Object.fromEntries((await registro()).flatMap((p) => (p.titulo ? [[p.slug, p.titulo]] : []))));
  manejar("preferencias:leer", () => leerPreferencias());
  manejar("preferencias:effort", (_e, modelo: string, effort: string) => guardarEffort(modelo, effort));
  manejar("preferencias:idioma", (_e, idioma: unknown) => guardarIdioma(idioma));
  manejar("preferencias:apariencia", (_e, a: unknown) => guardarApariencia(a));
  manejar("preferencias:tiernos", (_e, si: unknown) => guardarTiernos(si));
  manejar("preferencias:avisarEspera", (_e, si: unknown) => guardarAvisarEspera(si));
  manejar("preferencias:avisarWorkers", (_e, si: unknown) => guardarAvisarWorkers(si));
  manejar("preferencias:terminalAgentes", (_e, t: unknown) => guardarTerminalAgentes(t));
  manejar("preferencias:avisoLider", (_e, v: unknown) => guardarAvisoLider(v));
  manejar("preferencias:vista", (_e, vista: unknown) => guardarVista(vista));
  manejar("preferencias:consumo", (_e, si: unknown) => guardarConsumo(si));
  manejar("preferencias:bienvenidaPendiente", () => bienvenidaPendiente());
  manejar("preferencias:bienvenida", (_e, si: unknown) => guardarBienvenida(si));
  manejar("preferencias:guias", () => guiasEstado());
  manejar("preferencias:guiasOp", (_e, op: unknown) => guardarGuias(op));
  // El panel de consumo: qué líderes y workers mira; al ocultarlo se suelta todo.
  manejar("consumo:mirar", (_e, pedido: unknown) => consumo.mirar(pedido));
  manejar("consumo:soltar", () => consumo.soltar());
  // La vista de un worker: sus pasos, del transcript. Cada vista (la ventana, cada celular) mira uno; los cambios llegan por "pasos:cambio".
  manejar("pasos:mirar", (e, id: unknown) => pasos.mirar(quien(e), id));
  manejar("pasos:soltar", (e) => pasos.soltar(quien(e)));

  // Sólo los campos que hacen falta: el resto del hilo no cruza.
  manejar("pa:cerrar", (_e, h: Cerrable) =>
    mientrasIntegra(String(h?.proyecto), () => cerrar({ id: h?.id, proyecto: h?.proyecto, rama: h?.rama ?? null, origen: h?.origen ?? null })),
  );
  manejar("pa:hilo", (_e, x: { id: string; n?: number; antes?: number | null }) =>
    conversacion({ id: x?.id, n: x?.n, antes: x?.antes ?? null }),
  );
  manejar("pa:parar", (_e, id: string) => parar({ id }));
  // Los logos de las carpetas: sin Electron no se achican (van enteros los chicos); ipc.ts lo reemplaza por el que achica.
  manejar("proyectos:iconos", async () => iconosDe(await registro()));

  // Líderes de la app: lo del stream va tal cual; un cambio de estado relee la lista.
  lider.alEvento((sid, e) => {
    movio(sid);
    enviar("lider:evento", { sid, e });
    // Quedó libre (fin del turno, Parar, el proceso salió): sale lo que esperaba en la cola.
    if (e.tipo === "estado" && !e.ocupado) void leerCola().then(() => cola.libre(sid));
  });
  lider.alCambiar(() => {
    void avisarSl();
    cambioLider();
  });
  manejar("lider:nuevo", (_e, x: { modelo: string; effort: string; texto: string; imagenes?: unknown; modo?: string; rol?: string; carpeta?: unknown; cuenta?: unknown }) =>
    lider.nuevo({ modelo: x?.modelo, effort: x?.effort, texto: x?.texto, imagenes: x?.imagenes, modo: x?.modo, rol: x?.rol, carpeta: x?.carpeta, cuenta: x?.cuenta }),
  );
  manejar("lider:mandar", (_e, x: { sid: string; texto: string; imagenes?: unknown; modelo: string; effort: string }) => {
    verEspera(String(x?.sid));
    return lider.mandar({ sid: x?.sid, texto: x?.texto, imagenes: x?.imagenes, modelo: x?.modelo, effort: x?.effort });
  });
  // "Mandar ya" (lo que la cola hace por defecto, sin agrupar): a mitad de un turno (`lider.mandarDirecto`); sin turno en curso es un `mandar` normal.
  manejar("lider:mandarYa", (_e, x: { sid: string; texto: string; imagenes?: unknown; modelo: string; effort: string }) => {
    verEspera(String(x?.sid));
    return lider.mandarDirecto({ sid: x?.sid, texto: x?.texto, imagenes: x?.imagenes, modelo: x?.modelo, effort: x?.effort });
  });
  // Editar y Volver acá: seguir desde un mensaje anterior de la conversación (`lider.rebobinar`); Ramificar: un líder nuevo hasta ese mensaje.
  manejar("lider:rebobinar", (_e, x: { sid: string; uuid: string; texto: string; imagenes?: unknown; modelo: string; effort: string; previa?: boolean }) => {
    verEspera(String(x?.sid));
    return lider.rebobinar({ sid: x?.sid, uuid: x?.uuid, texto: x?.texto, imagenes: x?.imagenes, modelo: x?.modelo, effort: x?.effort, previa: x?.previa });
  });
  manejar("lider:ramificar", (_e, x: { sid: string; uuid: string; modelo: string; effort: string }) =>
    lider.ramificar({ sid: x?.sid, uuid: x?.uuid, modelo: x?.modelo, effort: x?.effort }),
  );
  // El usuario abrió la conversación de un líder que lo esperaba (o la tiene a la vista y volvió a la ventana).
  manejar("lider:visto", (_e, sid: string) => verEspera(String(sid)));
  // Un archivo que no es imagen: a `adjuntos/` del estado propio; el mensaje lleva su ruta.
  // Una imagen local que nombra un líder en su texto (imagen-local.ts): ruta absoluta de una imagen, sólo lectura; `null` si no está.
  manejar("imagen:leer", (_e, ruta: unknown) => leerImagenLocal(ruta));
  manejar("lider:archivo", (_e, x: unknown) => guardarArchivo(path.join(ESTADO, "adjuntos"), x));
  // Dictar: el WAV de la caja (16 kHz mono) → `handy --transcribe-file`; el texto vuelve al borrador, no se manda solo.
  // Con el modelo elegido en Ajustes (`--model`); sin elegir, Turbo si Handy lo tiene bajado (dictado-modelos.ts).
  manejar("dictado:transcribir", async (_e, x: unknown) =>
    transcribir(x, { dir: carpetaLocal(), modelo: (await leerPreferencias()).dictadoModelo, porDefecto: MODELO_TURBO }),
  );
  // Ajustes: qué modelos de Handy hay en esta máquina y cuál rige; elegir uno lo guarda en preferencias.json.
  const modelosDeDictado = async () => modelosDictado({ elegido: (await leerPreferencias()).dictadoModelo ?? MODELO_TURBO });
  manejar("dictado:modelos", () => modelosDeDictado());
  manejar("dictado:elegirModelo", async (_e, id: unknown) => {
    await guardarDictadoModelo(id);
    return modelosDeDictado();
  });
  // Los modelos locales: el contexto (`-c`) de cada uno, la cuenta de la VRAM y Probar (que SÍ usa la GPU: sólo con el clic).
  manejar("locales:leer", () => leerLocales());
  manejar("locales:guardar", (_e, x: unknown) => guardarLocal(x));
  manejar("locales:probar", (_e, x: unknown) => probarLocal(x));
  // Lo que hay instalado o andando en esta máquina (units, puertos, GGUF, arneses): sólo se lee, no arranca nada.
  manejar("locales:detectar", () => detectarLocales());
  // Prender o apagar el servicio (unit de systemd) de un modelo detectado: SÍ toca la GPU, sólo con el clic (la ventana pide confirmar antes).
  manejar("locales:prender", (_e, unit: unknown) => controlarServidorLocal("prender", unit));
  manejar("locales:apagar", (_e, unit: unknown) => controlarServidorLocal("apagar", unit));
  // Quién tiene la GPU y cómo liberarla (CLI `vram` (PATH o HILOS_VRAM)): la lista no toca nada; `vram:liberar` SÍ para un servicio, sólo con el clic.
  manejar("vram:leer", () => leerVram());
  manejar("vram:liberar", (_e, x: unknown) => liberarVram(x));
  manejar("lider:parar", (_e, sid: string) => lider.parar(String(sid)));
  // "Cerrar y parar todo" con la ventana como cliente: la ventana se lo pide al motor (no existe por red: SOLO_VENTANA).
  manejar("app:pararTodo", (_e, forzar: unknown) => pararTodo(forzar === true));
  manejar("lider:modo", (_e, x: { sid: string; modo: string }) => lider.cambiarModo(String(x?.sid), x?.modo));
  // La cuenta de Claude de ese líder (la elige la persona; nunca cambia sola): se aplica en el próximo mensaje (`lider.cambiarCuenta`).
  manejar("lider:cuenta", (_e, x: { sid: string; cuenta: unknown }) => lider.cambiarCuenta(String(x?.sid), x?.cuenta));
  manejar("lider:permiso", (_e, x: { sid: string; id: string; ok: boolean; mensaje?: string; respuestas?: unknown }) =>
    lider.responderPermiso(String(x?.sid), String(x?.id), {
      ok: x?.ok === true,
      mensaje: typeof x?.mensaje === "string" ? x.mensaje : undefined,
      respuestas: x?.respuestas,
    }),
  );
  manejar("lider:pendientes", (_e, sid: string) => lider.pendientes(String(sid)));
  manejar("lider:comandos", () => lider.comandosConocidos());
  manejar("lider:estilos", () => lider.estilosConocidos());
  manejar("lider:estilo", (_e, x: { sid: string; estilo: string }) => lider.ponerEstilo(String(x?.sid ?? ""), x?.estilo));
  // Un error del renderer (la ventana o el celular): al log, acotado (quien lo manda no es de fiar en tamaño).
  manejar("bitacora:escribir", (e, x: { donde?: unknown; detalle?: unknown }) => {
    const donde = String(x?.donde ?? "?").slice(0, 60);
    log.escribir("error", `renderer/${quien(e)} ${donde}`, String(x?.detalle ?? "").slice(0, 8192));
  });
  // El cartel "Hay una actualización disponible": también desde el celular (reinicia la trama de la PC, no corta nada).
  // "PC apagada · Prender" (en la otra máquina): sin PC configurada contesta null y la interfaz no muestra nada.
  manejar("pc:leer", () => (pc ? pc.leer() : null));
  manejar("pc:prender", () => (pc ? pc.prender() : null));
  manejar("reinicio:leer", () => reinicio?.estado() ?? SIN_REINICIO);
  manejar("reinicio:pedir", (_e, igual: unknown) => void reinicio?.pedir(igual === true));
  manejar("reinicio:cancelar", () => void reinicio?.cancelar());
  // Lo escrito sin mandar, en disco (borradores.ts): la ventana lo pide al abrir y manda la foto con cada cambio.
  manejar("borradores:leer", () => borradores.leer());
  manejar("borradores:guardar", (_e, foto: unknown) => borradores.guardar(foto).catch(silencio("borradores")));
  manejar("lider:cerrar", (_e, sid: string, motivo?: unknown) => {
    cola.vaciar(String(sid));
    return lider.cerrar(String(sid), motivo);
  });
  manejar("lider:retomar", (_e, x: { sid: string; modelo: string; effort: string; nombre?: string }) => lider.retomar(x));
  manejar("lider:conversacion", (_e, x: { sid: string; antes?: number | null }) =>
    lider.conversacionLider({ sid: x?.sid, n: 50, antes: x?.antes ?? null }),
  );
  manejar("lider:mirar", (e, sid: string | null) => mirarTranscript(quien(e), sid ? String(sid) : null));
  manejar("lider:traer", (_e, x: { sid: string; modelo: string; effort: string; nombre?: string; modo?: string; cortar?: boolean }) => {
    verEspera(String(x?.sid));
    return lider.traer({ sid: x?.sid, modelo: x?.modelo, effort: x?.effort, nombre: x?.nombre, modo: x?.modo, cortar: x?.cortar === true });
  });
  // La cola: encolar, sacar, lo que hay (una vista que recién abre) y "ahora" (reintentar, o cortar al de la terminal).
  manejar("lider:encolar", async (_e, x: { sid: string; texto: string; imagenes?: unknown; modelo: string; effort: string; modo?: string; nombre?: string }) => {
    const { sid, item } = lider.paraCola(x ?? {});
    verEspera(sid);
    await leerCola();
    cola.encolar(sid, item);
  });
  // Lo elegido en la caja (modelo y esfuerzo) mientras hay cola: el mensaje sale con lo vigente al desencolarse (cola.ts).
  manejar("lider:colaSeleccion", (_e, x: { sid: string; modelo: string; effort: string }) => {
    const { sid, seleccion } = lider.paraSeleccion(x ?? {});
    cola.elegir(sid, seleccion);
  });
  manejar("lider:colaQuitar", (_e, x: { sid: string; id: number }) => cola.quitar(String(x?.sid), Number(x?.id)));
  manejar("lider:colas", async () => {
    await leerCola();
    return cola.todas();
  });
  manejar("lider:colaYa", (_e, x: { sid: string; cortar?: boolean }) => void cola.ya(String(x?.sid), x?.cortar === true));

  // El aviso de Claude Code nuevo (pie): se chequea al pedirlo la primera vez y cada 6 h.
  alCambiarAviso((a) => enviar("claude:version", a));
  manejar("claude:version", () => leerAviso());
  manejar("claude:descartar", () => descartar());
  // Actualizar: `claude update`; con cuántos líderes de la app quedaron abiertos con la vieja.
  manejar("claude:actualizar", async () => ({ ...(await actualizar()), abiertos: lider.vivos() }));
  manejar("claude:reiniciar", () => lider.reiniciarOciosos());
  // Lo mismo para Antigravity CLI (Actualizar abre una terminal con paru); sin `agy` instalado el aviso es siempre null.
  alCambiarAvisoAgy((a) => enviar("agy:version", a));
  manejar("agy:version", () => leerAvisoAgy());
  manejar("agy:descartar", () => descartarAgy());
  manejar("agy:actualizar", () => actualizarAgy());
  // "Hay una Trama nueva" (release de GitHub): sin checkout anotado por el instalador el aviso es siempre null. Actualizar corre
  // git y el instalador: sólo la PC (`SOLO_PC_TAILNET`). Al celular ni se le avisa: no puede actualizar.
  alCambiarAvisoTrama((a) => enviar("trama:version", a));
  manejar("trama:version", (e) => (tailnet(e) ? null : leerAvisoTrama()));
  // "Check for updates" (Ajustes > General): consulta ya; el aviso de la barra llega por `trama:version` como siempre.
  manejar("trama:buscar", (e) => (tailnet(e) ? { ultima: null, nueva: false } : buscarTrama()));
  manejar("trama:descartar", () => descartarTrama());
  // Actualizar reinicia el motor: "ya" (la UI confirma antes qué se corta) o "esperar" (a que no haya nada ocupado). Contesta al
  // arrancar; el avance es `trama:actualizacion`, que sobrevive al reinicio del motor (actualizacion-trama.ts).
  armarActualizacionTrama(ocupacionDeTrama);
  alCambiarActualizacionTrama((e) => enviar("trama:actualizacion", e));
  void retomarTrama().catch(silencio("actualizacion-trama"));
  manejar("trama:actualizar", (_e, modo: unknown) => pedirTrama(modo));
  manejar("trama:cancelarEspera", () => cancelarEsperaTrama());
  manejar("trama:limpiar", () => limpiarTrama());
  manejar("trama:actualizacion", (e) => (tailnet(e) ? { fase: "nada" } : estadoActualizacionTrama()));
  manejar("trama:ocupacion", (e) => (tailnet(e) ? { lideres: 0, workers: 0, otras: 0, leyendo: false } : ocupacionTrama()));
  // "Falta algo del setup" (Handy, agy, Ollama, el login): se mira al pedirlo, no hay reloj. Descartar anota una falta aparte.
  manejar("setup:estado", () => setupDeEstaMaquina());
  manejar("setup:descartar", (_e, id: unknown) => descartarSetup(id));
  // Ajustes > Cuentas: ¿están conectados Claude y Gemini? Se les pregunta a los CLI al pedirlo (sin reloj ni caché).
  manejar("cuentas:estado", () => cuentasDeEstaMaquina());
  // Varias cuentas por proveedor (el CLI `cuentas`): lista, alta, renombre, baja y login. Después de un cambio el cupo se vuelve a pedir.
  // Con una cuenta recién conectada o agregada, su uso se pide ya (sin esperar a la vuelta de cada 5 minutos): si no, queda en «sin dato».
  cuentasVarias(manejar, cuentasDeEstaMaquinaVarias(enTerminal), (que) => {
    void refrescarCupos(true);
    if (que === "login" || que === "agregar") void lider.pedirUsoCuentas(true).then((nuevo) => { if (nuevo) void refrescarCupos(true); });
  });

  // El tablero de pendientes (tablero.ts): se mira su vista desde la primera vez que se pide.
  // Si su carpeta todavía no existe no hay qué mirar: se prueba de nuevo la próxima vez que se pida.
  let mirandoTb = false;
  const mirarVista = () => {
    if (!mirandoTb && existsSync(path.dirname(tablero.VISTA))) {
      mirandoTb = true;
      tablero.mirarTablero(() => enviar("tablero:cambio", null));
    }
  };
  manejar("tablero:leer", () => {
    mirarVista();
    return tablero.leerTablero();
  });
  // El número del botón del pie (cuántos esperan al usuario): sólo lee la vista, sin correr el CLI.
  manejar("tablero:esperan", () => {
    mirarVista();
    return tablero.contarEsperan();
  });
  manejar("tablero:responder", (_e, id: unknown, r: unknown) => tablero.responder(id, r));
  // Lo que el usuario tocó en el tablero nuevo y no mandó (pendientes.json): sobrevive a un reinicio.
  const pendientes = almacenPendientes(path.join(ESTADO, "pendientes.json"), escribirAtomico);
  manejar("pendientes:leer", () => pendientes.leer());
  manejar("pendientes:guardar", (_e, x: unknown) => pendientes.guardar(x));
  manejar("tablero:mover", (_e, id: unknown, columna: unknown) => tablero.mover(id, columna));
  manejar("tablero:cerrar", (_e, id: unknown) => tablero.cerrar(id));
  manejar("tablero:tirar", (_e, id: unknown) => tablero.tirar(id));
  manejar("tablero:posponer", (_e, id: unknown, hasta: unknown) => tablero.posponer(id, hasta));
  manejar("tablero:agregar", (_e, texto: unknown, proyecto: unknown) => tablero.agregar(texto, proyecto));
  // Quién está compactando (compactando.ts): las marcas que deja el hook, miradas desde que se piden.
  const compactando = crearCompactando(path.join(ESTADO, "compactando"), (c) => enviar("compactando:cambio", maquinas ? maquinas.compactando(c) : c));
  manejar("compactando:leer", () => {
    compactando.mirar();
    return compactando.leer();
  });

  // Los subagentes de cada sesión con proceso y el informe entero de uno terminado: de esta máquina sola.
  manejar("subagentes:leer", () => subagentes.leer());
  manejar("subagentes:informe", (_e, sid: unknown, id: unknown) => subagentes.informe(sid, id));

  if (maquinas) juntarMaquinas(maquinas);
}

/**
 * Con otras máquinas: lo que se lee de la barra trae también sus filas, y un pedido sobre una fila de allá (o a la
 * máquina que dijo el selector) va a su motor: lecturas y acciones con el mismo build, sólo lecturas con otro, y
 * con la máquina caída falla (maquinas.ts `enrutar`). Sin otras, no se llama.
 */
function juntarMaquinas(m: Maquinas) {
  const envolver = (canal: string, f: (fn: Manejador) => Manejador) => {
    const fn = manejadores.get(canal);
    if (fn) manejadores.set(canal, f(fn));
  };
  const despues = (unir: (d: unknown) => unknown) => (fn: Manejador) => async (e: Origen, ...a: unknown[]) => unir(await fn(e, ...a));
  envolver("statusline:leer", despues((d) => m.statusline(d)));
  envolver("statusline:sincronizar", despues((d) => m.statusline(d)));
  envolver("compactando:leer", despues((d) => m.compactando(d)));
  envolver("lider:colas", despues((d) => m.colas(d)));
  // El tablero: el de acá con el de cada otra máquina (tablero-junto.ts); sus acciones las enruta `enrutar` por el id del item.
  envolver("tablero:leer", despues((d) => m.tablero(d)));
  envolver("tablero:esperan", despues((d) => m.esperan(typeof d === "number" ? d : null)));
  envolver("hilos:guardados", despues((d) => m.guardados(d)));
  for (const [canal, ruta] of Object.entries(RUTAS))
    if (ruta === "maquina")
      envolver(canal, (fn) => (e, ...a) => {
        const remoto = m.enrutar(canal, a, quien(e), async (b) => fn(e, ...b));
        if (!remoto) return fn(e, ...a);
        // Mirar un líder de allá suelta el transcript de acá que miraba esta vista.
        if (canal === "lider:mirar") void mirarTranscript(quien(e), null);
        return remoto;
      });
}

