// El chat con un líder (B7): la sesión de Claude Code en `~` con la que habla
// El usuario. Los de la app (`claude -p` de trama) se escriben desde acá: la
// respuesta llega por el stream (src/hilo/vivo.ts) y al terminar se relee el
// transcript. Los abiertos en una terminal se leen (el transcript, al cambiar)
// y se les escribe igual: el primer mensaje lo trae a la app (`fuente.liderTraer`
// cierra ese `claude` de la terminal y sigue acá, con `--resume`); si estaba a
// mitad de algo, antes pregunta. Arriba de la caja, ir a su ventana, si se la
// pudo ubicar. `l === null`: un líder nuevo, que nace con el primer mensaje.
// B13: la caja manda con Enter (Shift+Enter, renglón nuevo), muestra el modo de
// permisos (chip; Shift+Tab lo rota), ofrece los comandos con "/" y pinta los
// pedidos de permiso: el plan de ExitPlanMode (Aprobar / Seguir planeando) y
// cualquier herramienta fuera de bypass (Permitir / Negar).
// A mitad de un turno, Enter encola (electron/cola.ts; también al de una terminal): lo pendiente se ve debajo
// de la conversación, se puede sacar y sale solo al terminar el turno.
// B26: un líder nuevo, vacío, tiene la caja al medio de la vista (con "Nuevo
// líder" encima); al mandar el primer mensaje baja a su lugar (Motion `layout`)
// y recién entonces la barra abre el líder creado (que remonta esta vista).
// B26: imágenes como en Claude Code: pegadas, soltadas sobre el chat o con el
// clip; miniaturas con × en la caja (src/hilo/adjuntos.ts) y en el globo.
import { es } from "../atajos";
import { Fragment, memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, Check, Clock, Cpu, FastForward, Folder, LoaderCircle, Minimize2, Paperclip, Pause, ScanSearch, TriangleAlert, Undo2 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { VERSION, type Lider, type Mensaje, type MotivoRetomar, type MotivoTraer, type PuntoControl, type Tokens, type Uso } from "../datos/contrato";
import { fuente, type EnvioLider, type ResultadoExtras } from "../datos/fuente";
import { fuentePaneles } from "../datos/paneles";
import { ChipSubagentes } from "../barra/Fila";
import { Reloj } from "../barra/piezas";
import { LogoCab } from "../barra/Logo";
import { estiloProyecto } from "../barra/Riel";
import { Leyendo } from "./Leyendo";
import { PanelMcp } from "./PanelMcp";
import { Programar } from "./Programar";
import { MODO } from "../modo";
import { esTactil } from "../angosto";
import { pintorCache } from "../tiempo";
import { cacheAplica } from "../../electron/cache";
import { BORRADOR_LIDER, cursorDe, escucharBorrador, guardarCursor, leerBorrador, ponerBorrador } from "./borradores";
import { effortPara } from "./elegir";
import { Esfuerzo } from "./Esfuerzo";
import { esClaudeOficial, soportaFast } from "../../electron/esfuerzo-extras";
import { esfuerzosDeRevisor, type PermitidosAjustes } from "./esfuerzo-revisor";
import { effortsLeidos, leerEfforts, recordarEffort } from "./efforts";
import { effortDe, effortsOpciones, MODELO_DEFAULT, MODELOS, modeloDe, modeloVigente, nombreModelo, useModelosVivos } from "./opciones";
import { effortsDe, esAgy, esDsh, esOpencode, esLocal, familiaDe, motorNombre, reajustarEffort, sinWorkers, TABLA } from "./modelos";
import { ContextoLocal } from "./ContextoLocal";
import { t as tr } from "../i18n";
import { useCorrector } from "../paneles/ajustes-corrector";
import { useIdioma } from "../i18n/react";
import { contextoGasto, GastoSubagentesCtx, useGastoSubagentes } from "./gasto-sub";
import { Selector, type Opcion } from "./Selector";
import { AUTO, carpetaDeEnvio, ofrecidos, OTRA, opcionDe, PERSONAL, proyectosDeLaMaquina, rutaPedida } from "./carpeta-nueva";
import { pedirCarpeta, usePedida } from "./carpeta-nueva-estado";
import { proyectosDe, useProyectos, type ProyectoNombre } from "../datos/proyectos";
import { CuentaLider, cuentasDeClaude, nombreCuentaClaude, useCuentasClaude } from "./CuentaLider";
import { filasDeCupos } from "../datos/cuentas";
import { OfertaCuenta } from "./OfertaCuenta";
import { TarjetaCierre } from "./TarjetaCierre";
import { useCierre } from "./cierre-vivo";
import { cuentasClaude, ofertaDeCambio } from "../barra/cupos-riel-logica";
import { elegidoAca, llegaServidor, opcionesEnTurno, pendienteDe, type Seguimiento, type Seleccion } from "./pendiente";
import { DialogoCambio, type DatosCambio } from "./DialogoCambio";
import { DialogoCache } from "./DialogoCache";
import { opcionCompactarCache } from "./cache-compactar";
import { alCambiarCacheEleccion, cacheEleccion, cambiarCacheEleccion } from "./cache-eleccion";
import type { EleccionCache, VeredictoCache } from "../../electron/cache-pregunta";
import { hayVarias, opcionesMaquina, useMaquinas } from "../maquinas";
import { Contexto } from "./Contexto";
import { decidirCacheConTranscript, tokensParaAviso } from "./contexto-logica";
import { contextoDe, suscribirContexto, transcriptLeido } from "./contextoVivo";
import { Avisos, HaceChat, textoAviso, useQuietoDesde } from "./Hace";
import { latir } from "../barra/latido";
import {
  debeEsperarInicio,
  ESPERA_COMPACTAR_S,
  evaluarProgreso,
  REPOSO,
  siguienteCambio,
  soportaCompactar,
  type EstadoCambioCompactado,
} from "./cambio-compactado";
import type { AvisoVisto } from "./avisos";
import { SeguirCon } from "./SeguirCon";
import { RevisionVista } from "./RevisionVista";
import { modalRevision, useRevision } from "./revision-vivo";
import { revisionViva } from "./revision-logica";
import { TarjetaRevision } from "./TarjetaRevision";
import { TarjetaConclusionDebate, TarjetaDebate } from "./TarjetaDebate";
import { debateVivo, resumenDebate } from "./debate-logica";
import { QueSeAcordo } from "./QueSeAcordo";
import { limpiarDebate, ponerDebate, useDebate } from "./debate-vivo";
import { leerMensajeRevision, REVISOR_DEFECTO } from "../../electron/revision-plan-texto";
import { leerMensajeDebate } from "../../electron/debate-texto";
import { CarpetaDelChat, Texto } from "./Texto";
import { Hora, pintorAviso, Turno } from "./Turno";
import { PuntoTurno } from "./Punto";
import { puntoDeTurno } from "./punto-logica";
import { Marca } from "./Marca";
import { Sistema, type IntegrarAviso } from "./Sistema";
import { EVENTO_CAMBIAR_MODELO, proveedorLibre } from "./agotados";
import { estadosCupoModelos, estadosCupoProveedores } from "./cupo-modelos.ts";
import { Compactando, Pasando, relevoEn, Sigue } from "./Posta";
import { juntar, turnos, type Item, type Punto } from "./turnos";
import { AccionesMensaje, cerrarSobreFuera, EditorMensaje, sobreMensaje, type Acciones } from "./AccionesMensaje";
import { DejadoTablero } from "./DejadoTablero";
import { dejadosDeAviso } from "./tablero-dejado.ts";
import { anotar, bajar, seguir } from "./seguir";
import { anotarScroll, faltaLlegar, guardarAncla, restaurarScroll, retomarScroll, soltarScroll } from "./scrollGuardado";
import { useCompactando } from "./compactando";
import { useSeguir } from "./useSeguir";
import { cola, comandosAgy, comandosClaude, confirmar, contestado, enCurso, enviado, escuchar, estilosClaude, fallo, mensajesVistos, parando, ponerEstilos, ponerModo, suscribir, suscribirComandos, suscribirEstilos, type FinTurno, type Pedido } from "./vivo";
import { ASPECTO, esModo, MODO_DEFAULT, siguienteModo, type Modo } from "./modos";
import { directo, ESTILOS_FABRICA, menuEn, moverSel, parsearComando, reemplazar, type Sugerencia, type Valores } from "./comandos";
import { esVentana, main, mensaje } from "../puente";
import { agregarAdjuntos, archivosDe, archivosDeDatos, type Adjunto, ErrorAdjunto, escucharAdjuntos, imagenesDe, imagenesSinGuardar, leerAdjuntos, pegadoSinTexto, prepararAdjunto, quitarAdjunto, textoConArchivos, vaciarAdjuntos } from "./adjuntos";
import { Bandeja } from "./Bandeja";
import { Fondo } from "./Fondo";
import { Adjuntos, Miniaturas } from "./Imagenes";
import { Dictar } from "./Dictar";
import { Logo } from "./Logos";
import { PedidoPreguntas } from "./Preguntas";
import { aparecioTanda, contarPendientes, tandasPendientes } from "./preguntas-logica";
import { ARCHIVO_MAX, BORRADOR_IMAGENES_BASE64, BORRADOR_IMAGENES_MAX, IMAGENES_MAX, type Imagen } from "../../electron/imagenes";
import { separarAdjuntos } from "../../electron/adjunto";
import { useAsentado, useEntradas } from "../movimiento";

/** Lo que tarda (como mucho) la caja de un líder nuevo en bajar antes de abrirlo. */
const BAJAR_MS = 260;
const BAJAR = { type: "spring", stiffness: 520, damping: 44, mass: 0.8 } as const;

/** Si el transcript no alcanza a la tanda del stream, a los tantos ms se suelta igual. */
const SOLTAR_MS = 2000;
const MARGEN_PAGINA = 400;

// Los eventos de un líder nuevo llegan antes que su sid: se escucha desde el arranque.
escuchar();

type Pagina = { mensajes: Mensaje[]; desde: number; total: number; usage: Tokens | null; transcript: string | null; compactada?: boolean };

type Props = {
  l: Lider | null;
  /** Nació un líder nuevo (la barra lo abre). */
  alCreado: (sid: string, e: EnvioLider) => void;
  /** /clear: abrir un líder nuevo, limpio. */
  alNuevo: () => void;
  /** Los líderes, para ir al que siguió después de un relevo (B19). */
  lideres?: ReadonlyMap<string, Lider>;
  alAbrirLider?: (id: string) => void;
  /** Abre el hilo de un worker: los ids de un aviso de Trama en la conversación. */
  alAbrirHilo?: (id: string) => void;
  integrar?: IntegrarAviso;
  /** Mirar su transcript (`fuente.liderMirar`): el analista de Ramas no, para no soltar el de la vista. */
  mirar?: boolean;
  /** El texto de su última respuesta entera, cada vez que cambia (el analista: sus veredictos). */
  alRespuesta?: (texto: string) => void;
  /** Qué se ve de cada mensaje (`null`: nada); estable, fuera del render. */
  mostrar?: (m: Mensaje) => Mensaje | null;
  /** Lo que se ofrece cuando uno sin proceso no se puede retomar: el botón de archivarlo (o de quitarlo). */
  archivar?: ReactNode;
};

/** Por qué no se pudo retomar, en criollo. */
const NO_RETOMA = { abierto: "lider.noAbierto", sinSesion: "lider.noSesion", sinCarpeta: "lider.noCarpeta" } as const;
/** Por qué no se lo pudo traer de la terminal (si está trabajando no es un error: se pregunta). */
const NO_TRAE: Record<Exclude<MotivoTraer, "trabajando">, "lider.noTraer" | "lider.noSesion" | "lider.noCarpeta"> = {
  abierto: "lider.noTraer",
  sinSesion: "lider.noSesion",
  sinCarpeta: "lider.noCarpeta",
};

/** El texto de la caja con que arranca una captura (`lider-comandos`: el menú de "/" abierto; `lider-valores`, el de /output-style). */
const textoCaptura = () =>
  MODO.captura === "lider-comandos" ? "/" : MODO.captura === "programar" ? "Seguí con el paso 2 y avisame cuando termine" : MODO.captura === "lider-valores" ? "/output-style " : MODO.captura === "lider-nuevo-proyecto" ? "Revisá el build de atlas" : null;

const nombreCorto = (id: string) => nombreModelo(id).split(" · ")[0]!;

function estadoInicialCambio(): EstadoCambioCompactado {
  if (MODO.captura !== "lider-aviso-cambio") return REPOSO;
  const destino = { modelo: "claude-sonnet-5-5", effort: "high" };
  if (MODO.variante === "compactando") return { fase: "compactando", destino, enviando: false, vioInicio: true };
  if (MODO.variante === "error") return { fase: "error", destino, motivo: "claude: could not resume the session" };
  if (MODO.variante === "vencido") return { fase: "vencido", destino };
  if (MODO.variante === "hecho") return { fase: "hecho", destino };
  return REPOSO;
}

export function ChatLider({ l, alCreado, alNuevo, lideres, alAbrirLider, alAbrirHilo, integrar, mirar = true, alRespuesta, mostrar, archivar }: Props) {
  const corrige = useCorrector();
  const sid = l?.id ?? "";
  const cierreCupo = useCierre(sid);
  const clave = l ? `lider:${l.id}` : BORRADOR_LIDER;
  const vivo = useSyncExternalStore(
    useCallback((fn: () => void) => suscribir(sid, fn), [sid]),
    () => enCurso(sid),
  );
  // Hace 2 min que no llega nada: el Parar de la caja lo marca, como la tarjeta.
  const sinNovedad = useQuietoDesde(sid);
  // Varias tandas de preguntas a la vez: de a una, la más vieja primero.
  const tandas = tandasPendientes(vivo.pide);
  // Recién traído de la terminal: es de la app aunque la lista todavía no lo diga.
  const [traido, setTraido] = useState(false);
  const deApp = !l || l.origen === "app";
  useEffect(() => {
    // La lista ya lo dice: si lo vuelven a abrir en una terminal, vuelve a ser ajeno.
    if (deApp) setTraido(false);
    // Un turno en curso desde acá (lo trajo la cola al terminar su turno allá): ya es de la app.
    else if (vivo.ocupado) setTraido(true);
  }, [deApp, vivo.ocupado]);
  const app = deApp || traido;
  // Abierto en una terminal: se le escribe igual (el primer mensaje lo trae a la app).
  const ajeno = !!l && !app && l.vivo && !l.caido;
  // Murió o cerró (también uno de la app al que mataron): no hay caja hasta retomarlo.
  // Volver acá en uno sin proceso (Murió, Cerrado): la caja aparece, y su primer mensaje lo retoma desde ese punto.
  const [volver, setVolver] = useState<Punto | null>(null);
  const puede = ((app || ajeno) && !l?.caido) || (!!l && !!volver);
  const ocupado = app ? (vivo.ocupado ?? l?.ocupado ?? false) : !!l?.ocupado;
  // Lo que gastó cada subagente que lanzó con la herramienta Agent: las burbujas de esas llamadas lo muestran. Se relee al terminar el turno.
  const gastoSub = useGastoSubagentes(sid || null, ocupado);
  const ctxGasto = useMemo(() => contextoGasto(sid || null, gastoSub), [sid, gastoSub]);
  const encolados = useSyncExternalStore(
    useCallback((fn: () => void) => cola.suscribir(sid, fn), [sid]),
    () => cola.lista(sid),
  );
  // Lo primero de la cola no pudo salir: por qué (no se reintenta solo).
  const errorCola = useSyncExternalStore(
    useCallback((fn: () => void) => cola.suscribir(sid, fn), [sid]),
    () => cola.error(sid),
  );

  // El de la terminal con algo en la cola: sale cuando termine su turno.
  const enEspera = ajeno && encolados.length > 0 && !errorCola;

  const [pag, setPag] = useState<Pagina | null>(null);
  const vivoCtx = useSyncExternalStore(
    useCallback((fn: () => void) => suscribirContexto(sid, fn), [sid]),
    () => contextoDe(sid),
  );
  const [error, setError] = useState<string | null>(null);
  const borrador = leerBorrador(clave);
  const [texto, setTexto] = useState(() => textoCaptura() ?? borrador.texto);
  // Dónde está el cursor en la caja: el menú de "/" mira el token que tiene al lado.
  const [caret, setCaret] = useState(() => texto.length);
  const [errorCaja, setErrorCaja] = useState<string | null>(borrador.error);
  const [enviando, setEnviando] = useState(false);
  // Su ventana: el botón de ir sólo si se la pudo ubicar.
  const [ventana, setVentana] = useState(false);
  const pidAjeno = ajeno ? l.pid : null;
  useEffect(() => {
    setVentana(false);
    if (!pidAjeno) return;
    let sigue = true;
    void fuente.liderUbicable(pidAjeno).then((v) => sigue && setVentana(v));
    return () => {
      sigue = false;
    };
  }, [pidAjeno]);
  // Sin proceso y de nadie (`caido`): Retomar lo pasa a la app; al llegar la lista nueva, esto es la caja de siempre.
  const [retomando, setRetomando] = useState(false);
  // Si vuelve a morir, el botón no queda trabado del retomar anterior.
  const murioDe = !!l?.caido;
  useEffect(() => {
    if (!murioDe) setRetomando(false);
  }, [murioDe]);
  const [noRetoma, setNoRetoma] = useState<MotivoRetomar | null>(MODO.captura === "lider-muerto" && MODO.variante === "no" ? "sinSesion" : null);
  // Un líder nuevo, vacío: la caja al medio hasta que sale el primer mensaje (B26).
  const [partio, setPartio] = useState(false);
  // A qué máquina va un líder nuevo (el selector de la caja): siempre esta al empezar, y no se recuerda.
  const maquinas = useMaquinas();
  const [maquinaNueva, setMaquinaNueva] = useState<string | null>(null);
  // La cuenta de Claude de un líder nuevo, si la persona eligió una (sin elegir, el main usa la que se usa primero).
  const [cuentaNueva, setCuentaNueva] = useState<string | null>(null);
  // La carpeta donde arranca un líder nuevo: siempre visible en la caja (el selector de proyecto). Arranca en "Auto" (`carpeta-nueva.ts`): al mandar
  // el primer mensaje el main elige el proyecto que nombra, o la carpeta personal si no nombra ninguno. Lo que se elige a mano (un proyecto, la
  // personal, otra ruta) manda y nada lo pisa. Se puede escribir otra ruta; en la ventana de la PC también se elige con el selector nativo.
  const proyectos = useProyectos();
  // Las cuentas de Claude (la liviana): el nombre de la cuenta de antes, si sigue conectada (aviso de otra cuenta).
  const listaCuentas = useCuentasClaude();
  const [carpeta, setCarpeta] = useState(MODO.captura === "lider-nuevo-carpeta" ? "/srv/proyectos/mi-app" : "");
  const [carpetaAMano, setCarpetaAMano] = useState(MODO.captura === "lider-nuevo-carpeta");
  const idCarpeta = useId();
  const elegirCarpeta = () => {
    void main?.carpeta?.elegir().then(
      (c) => {
        if (!c) return;
        setCarpeta(c);
        setCarpetaAMano(true);
      },
      (err) => setErrorCaja(mensaje(err)),
    );
  };
  const maquinaDe = l ? l.maquina : maquinaNueva && maquinaNueva !== maquinas.esta.id ? maquinaNueva : undefined;
  // Con el chat nuevo lanzándose en otra máquina, el selector de carpeta ofrece los proyectos de ESA máquina (los pide a su motor).
  // Si no contesta, queda sin lista: la carpeta se escribe a mano, como siempre.
  const [deOtra, setDeOtra] = useState<{ maquina: string; lista: ProyectoNombre[] } | null>(null);
  useEffect(() => {
    if (l || !maquinaDe) return setDeOtra(null);
    let vivo = true;
    void proyectosDe(maquinaDe).then((lista) => vivo && setDeOtra(lista ? { maquina: maquinaDe, lista } : null));
    return () => {
      vivo = false;
    };
  }, [l, maquinaDe]);
  const proyectosDeAhi = proyectosDeLaMaquina(maquinaDe, proyectos, deOtra);
  // "Nueva tarea aquí" en un proyecto de la barra (o una tarea del tablero) pide su carpeta una vez: es lo mismo que elegirla a mano.
  const pedida = usePedida();
  useEffect(() => {
    if (l || !pedida || !proyectos.length) return;
    const ruta = rutaPedida(pedida, proyectos);
    if (ruta) {
      setCarpeta(ruta);
      setCarpetaAMano(true);
      setOtraAbierta(false);
    }
    pedirCarpeta(null);
  }, [l, pedida, proyectos]);
  // Captura `lider-nuevo-carpeta` con `HILOS_VARIANTE=buscar` (filtrado con "trama") o `buscar-nada` (sin coincidencias): el selector abierto con la búsqueda.
  const capturaBuscar = MODO.captura === "lider-nuevo-carpeta" && (MODO.variante === "buscar" || MODO.variante === "buscar-nada");
  const opcionesCarpeta = useMemo<Opcion[]>(
    () => [
      { id: AUTO, nombre: tr("lider.carpetaAutoNombre"), desc: tr("lider.carpetaAutoDesc"), logo: <LogoCab generico icono={16} /> },
      ...ofrecidos(proyectosDeAhi).map((p) => ({
        id: p.ruta,
        nombre: p.titulo ?? p.nombre,
        desc: p.ruta,
        // El logo del proyecto, el mismo de la cabecera de su carpeta en la barra (ícono o iniciales sobre su tono). Los de otra
        // máquina no tienen logo acá (el ícono es de un archivo de allá): el genérico.
        logo: maquinaDe ? (
          <LogoCab generico icono={16} />
        ) : (
          <span style={estiloProyecto(p.slug)}>
            <LogoCab proyecto={p.slug} titulo={p.titulo ?? p.nombre} icono={16} />
          </span>
        ),
      })),
      { id: PERSONAL, nombre: tr("lider.carpetaPersonal"), desc: tr("lider.carpetaPersonalDesc"), logo: <LogoCab personal icono={16} /> },
      // Fija: la búsqueda del selector no la esconde (ver `Selector`, `buscar`).
      { id: OTRA, nombre: tr("lider.carpetaOtra"), desc: tr("lider.carpetaOtraDesc"), fija: true, logo: <LogoCab generico icono={16} /> },
    ],
    [proyectosDeAhi, maquinaDe],
  );
  const opcionCarpeta = opcionDe(carpeta, carpetaAMano, proyectosDeAhi);
  const [otraAbierta, setOtraAbierta] = useState(MODO.captura === "lider-nuevo-carpeta");
  const eligioCarpeta = (id: string) => {
    if (id === AUTO) {
      setCarpetaAMano(false);
      setOtraAbierta(false);
      setCarpeta("");
      return;
    }
    setCarpetaAMano(true);
    if (id === OTRA) {
      setOtraAbierta(true);
      if (opcionCarpeta !== OTRA) setCarpeta("");
    } else {
      setOtraAbierta(false);
      setCarpeta(id === PERSONAL ? "" : id);
    }
  };
  const quieto = useReducedMotion();
  const bajo = useRef<(() => void) | null>(null);
  const adjuntos = useSyncExternalStore(
    useCallback((fn: () => void) => escucharAdjuntos(clave, fn), [clave]),
    () => leerAdjuntos(clave),
  );
  const [arrastra, setArrastra] = useState(false);
  // El uso gratis de OpenCode es uno solo: acabado, todos sus modelos gratis llevan «sin cupo hasta…» en el selector, y el aviso de error
  // trae «Cambiar de modelo», que abre el selector en un proveedor que no sea OpenCode.
  const [uso, setUso] = useState<Uso | null>(null);
  useEffect(() => {
    let vivo = true;
    void fuente.uso().then((u) => vivo && setUso(u), () => {});
    const soltar = fuente.alCambiarUso((u) => vivo && setUso(u));
    return () => {
      vivo = false;
      soltar();
    };
  }, []);
  // El cupo de cada modelo y de cada proveedor: el mismo dato que la tarjeta de cupos (sin cupo, con su hora; poco cupo, el punto ámbar).
  // La tabla de modelos cambia sin reiniciar (catálogo nuevo, Ajustes): lo armado con ella se rehace.
  const tablaModelos = useModelosVivos();
  const modelos = useMemo(() => [...MODELOS], [tablaModelos]);
  const [configModelos, setConfigModelos] = useState<{ excluir: string[]; permitidos: PermitidosAjustes }>({
    excluir: [],
    permitidos: null,
  });
  useEffect(() => {
    let sigue = true;
    void fuentePaneles.modelos().then(
      (r) => sigue && setConfigModelos({ excluir: r.config.excluir ?? [], permitidos: r.config.efforts_permitidos ?? null }),
      () => {},
    );
    return () => {
      sigue = false;
    };
  }, [tablaModelos]);
  const cupos = useMemo(() => estadosCupoModelos(MODELOS.map((m) => m.id), uso, Date.now() / 1000), [uso, tablaModelos]);
  const cuposColumnas = useMemo(() => estadosCupoProveedores(uso, Date.now() / 1000), [uso]);
  const [senalModelo, setSenalModelo] = useState(0);
  // «Seguir con otro modelo» (#1791): el selector que abre el aviso de límite o de sin cupo. Captura `lider-avisos` con `HILOS_VARIANTE=seguir-con`: ya abierto.
  const [seguirCon, setSeguirCon] = useState(MODO.captura === "lider-avisos" && MODO.variante === "seguir-con");
  const abrirSeguir = useCallback(() => setSeguirCon(true), []);
  useEffect(() => {
    const abrir = () => setSenalModelo((n) => n + 1);
    window.addEventListener(EVENTO_CAMBIAR_MODELO, abrir);
    return () => window.removeEventListener(EVENTO_CAMBIAR_MODELO, abrir);
  }, []);
  const elegir = useRef<HTMLInputElement>(null);
  // Captura `aviso`: otro modelo elegido con el caché vivo.
  const [modelo, setModelo] = useState(() =>
    // Captura `modelo` con `HILOS_VARIANTE=sin-cupo`: Argon elegido, sin cupo, para ver la marca del chip.
    MODO.captura === "modelo" && MODO.variante === "sin-cupo"
      ? (MODELOS.find((m) => m.id === "gemini-4-argon")?.id ?? MODELO_DEFAULT)
      : // Captura `lider-trabajando` con `HILOS_VARIANTE=pendiente-modelo`: otro modelo del mismo motor elegido con el turno en curso.
    MODO.captura === "lider-trabajando" && MODO.variante === "pendiente-modelo" && l
      ? (MODELOS.find((m) => m.id !== modeloDe(l.modelo) && familiaDe(m.id) === familiaDe(l.modelo))?.id ?? MODELO_DEFAULT)
      : MODO.captura === "lider-aviso-cambio" && (!MODO.variante || MODO.variante === "sin-compactar") && l
      ? (MODELOS.find((m) => m.id !== modeloDe(l.modelo) && m.id === "claude-sonnet-5-5")?.id ?? MODELOS.find((m) => m.id !== modeloDe(l.modelo))?.id ?? MODELO_DEFAULT)
      : MODO.captura === "aviso" && l
      ? (MODELOS.find((m) => m.id !== modeloDe(l.modelo))?.id ?? MODELO_DEFAULT)
      : MODO.captura === "lider-comandos" && MODO.variante === "agy"
        ? (MODELOS.find((m) => esAgy(m.id))?.id ?? MODELO_DEFAULT)
        : MODO.captura === "local-esfuerzo" || MODO.captura === "local-ctx"
          ? (MODELOS.find((m) => esLocal(m.id))?.id ?? MODELO_DEFAULT)
          : (modeloDe(l?.modelo) ?? MODELO_DEFAULT),
  );
  const [effort, setEffort] = useState(() =>
    // Captura `lider-trabajando` con `HILOS_VARIANTE=pendiente`: otro esfuerzo elegido con el turno en curso.
    MODO.captura === "lider-trabajando" && MODO.variante === "pendiente" && l
      ? (effortsDe(modelo).find((e) => e !== effortDe(l.effort, modelo)) ?? "low")
      : (effortDe(l?.effort, modelo) ?? effortPara(modelo, effortsLeidos() ?? {})),
  );
  // Ultracode y Fast (sólo modelos oficiales de Anthropic): los que dice el líder y, en uno nuevo, los que se dejan prendidos antes del primer mensaje.
  const [ultracode, setUltracode] = useState(!!l?.ultracode || (MODO.captura === "esfuerzo" && MODO.variante !== undefined));
  const [fast, setFast] = useState(!!l?.fast || (MODO.captura === "esfuerzo" && MODO.variante !== undefined));
  const ultracodeServidor = !!l?.ultracode;
  const fastServidor = !!l?.fast;
  // (La captura `esfuerzo` con variante los deja prendidos para mostrarlos: no se pisan con lo del líder de muestra.)
  useEffect(() => void (!(MODO.captura === "esfuerzo" && MODO.variante) && setUltracode(ultracodeServidor)), [ultracodeServidor, l?.id]);
  useEffect(() => void (!(MODO.captura === "esfuerzo" && MODO.variante) && setFast(fastServidor)), [fastServidor, l?.id]);
  const tocado = useRef(!!l);
  // Un líder nuevo sigue a la tabla viva: sin tocar el modelo, pasa al default vigente (Fable 5.2 cuando la cuenta lo trae y la caja tenía el 5.1);
  // y si lo elegido ya no existe en la tabla, al vigente de su familia. Uno ya creado conserva el modelo que tiene.
  useEffect(() => {
    if (l || tablaModelos === 0) return;
    const hay = (id: string) => MODELOS.some((m) => m.id === id);
    const nuevo = !tocado.current ? (hay(MODELO_DEFAULT) ? MODELO_DEFAULT : modeloVigente(MODELO_DEFAULT)) : hay(modelo) ? modelo : modeloVigente(modelo);
    if (nuevo === modelo) return;
    setModelo(nuevo);
    setEffort((antes) => reajustarEffort(nuevo, antes, effortsLeidos() ?? {}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tablaModelos]);
  const [cambioCompacto, dispatchCambio] = useReducer(siguienteCambio, undefined, estadoInicialCambio);
  const [compactoCache, setCompactoCache] = useState<{
    crudo: string;
    modoNuevoYa?: Modo;
    compactarCon: string;
    destino: { modelo: string; effort: string };
    restaurado?: boolean;
  } | null>(null);
  const compactoCacheActivo = !!compactoCache && !compactoCache.restaurado;
  const cajaSoloLectura = enviando || compactoCacheActivo;
  const compactoBase = useRef<{ fines: number; compactos: number }>({ fines: 0, compactos: 0 });
  const sidActual = useRef(sid);
  sidActual.current = sid;
  // La caja sigue el cambio de modelo del líder en otra ventana si la persona todavía no eligió otra cosa acá.
  const modeloServidor = l ? modeloDe(l.modelo) : undefined;
  const effortServidor = useMemo(
    () => modeloServidor ? (effortDe(l?.effort, modeloServidor) ?? effortPara(modeloServidor, effortsLeidos() ?? {})) : undefined,
    [modeloServidor, l?.effort],
  );
  // Lo elegido acá que el servidor todavía no confirmó no lo mueve un eco tardío (pendiente.ts, `llegaServidor`); y lo que la caja tomó del
  // servidor no se le devuelve (`elegidaAca`): las dos cosas juntas hacían ir y volver el selector sin fin.
  const seguimiento = useRef<Seguimiento>({ visto: modeloServidor && effortServidor !== undefined ? { modelo: modeloServidor, effort: effortServidor } : null, propio: null });
  const elegidaAca = useRef(false);
  const marcarElegida = (sel: Seleccion) => {
    seguimiento.current = elegidoAca(seguimiento.current, sel);
    // Lo mismo que ya muestra no cambia la caja: no queda nada por mandar.
    if (sel.modelo !== modelo || sel.effort !== effort) elegidaAca.current = true;
  };
  useEffect(() => {
    if (!modeloServidor || effortServidor === undefined) return;
    const anterior = seguimiento.current.visto;
    const r = llegaServidor({ modelo, effort }, seguimiento.current, { modelo: modeloServidor, effort: effortServidor });
    seguimiento.current = r.s;
    if (anterior?.modelo === modeloServidor && anterior.effort === effortServidor) return;
    // Mientras compacta desde caché, esa operación restaura el modelo elegido aunque llegue tarde el eco del modelo que compactó.
    if (!compactoCacheActivo) {
      if (r.caja.modelo !== modelo) setModelo(r.caja.modelo);
      if (r.caja.effort !== effort) setEffort(r.caja.effort);
    }
    if (!compactoCache && cambioCompacto.fase === "hecho" && modeloServidor === cambioCompacto.destino.modelo) {
      dispatchCambio({ tipo: "reiniciar" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeloServidor, effortServidor, cambioCompacto, compactoCache, compactoCacheActivo]);
  // Con un turno en curso los selectores siguen abiertos: lo elegido del mismo motor lo toma el turno ya (desde su próximo pedido a la
  // API, `cambiarEnTurno`); lo que no se puede en vivo va con el próximo mensaje. Mientras difiere de lo que usa el turno, se marca en el selector.
  const turnoModelo = modeloDe(l?.modelo);
  const enTurno = app && ocupado;
  const pend = pendienteDe({ ocupado: enTurno, modelo, effort, turno: l ? { modelo: turnoModelo ?? undefined, effort: effortDe(l.effort, turnoModelo) } : null });
  const modelosEnTurno = useMemo(() => opcionesEnTurno(MODELOS, enTurno, l?.modelo, tr("lider.cruceEnTurno")), [enTurno, l?.modelo, tablaModelos]);
  // Con mensajes en la cola o un líder de la app, cada cambio de la caja se avisa al main: el que sale de la cola lleva lo vigente al
  // desencolarse, y el proceso vivo lo toma ya si se puede, también a mitad de un turno (si no, queda marcado «próx.» hasta el próximo mensaje).
  const selVista = useRef<string | null>(null);
  useEffect(() => {
    const k = `${sid}|${modelo}|${effort}`;
    const antes = selVista.current;
    selVista.current = k;
    // Sólo lo elegido acá: lo que la caja tomó del servidor no se le devuelve (un eco tardío la haría ir y volver sin fin).
    const aca = elegidaAca.current;
    elegidaAca.current = false;
    if (antes === null || antes === k || !aca || !l || (!encolados.length && !app)) return;
    cola.elegir(l.id, modelo, effort);
  }, [sid, modelo, effort, encolados.length, app]);
  // El modo de un líder nuevo se elige antes de que exista (y el de uno de la terminal, antes de
  // traerlo); el de uno de la app, lo dice el stream (o la lista).
  const [modoNuevo, setModoNuevo] = useState<Modo>(MODO_DEFAULT);
  const modoVisto = l && app ? (vivo.modo ?? l.modo ?? MODO_DEFAULT) : modoNuevo;
  const modo: Modo = esModo(modoVisto) ? modoVisto : MODO_DEFAULT;
  const agy = esAgy(modelo);
  // El motor del líder deja ver su razonamiento y sus comandos (Gemini; o cualquiera que ya mandó razonamiento): la tarjeta y el turno
  // los muestran en vez de la frase tierna. Claude y los que no lo traen siguen como siempre.
  const piensa = esAgy(modeloDe(l?.modelo) ?? modelo) || esDsh(modeloDe(l?.modelo) ?? modelo) || esOpencode(modeloDe(l?.modelo) ?? modelo) || vivo.razona;
  const comandos = useSyncExternalStore(suscribirComandos, agy ? comandosAgy : comandosClaude);
  // Los del otro proveedor: la búsqueda del menú también los muestra (marcados, sin poder usarse con este modelo).
  const deOtro = useSyncExternalStore(suscribirComandos, agy ? comandosClaude : comandosAgy);
  // El menú de "/": la fila elegida y si el usuario lo cerró con Esc (vuelve al cambiar el texto).
  const [sel, setSel] = useState(0);
  const [sinMenu, setSinMenu] = useState(false);
  const estilos = useSyncExternalStore(suscribirEstilos, estilosClaude);
  const listaEstilos = estilos.lista.length ? estilos.lista : ESTILOS_FABRICA;
  // El segundo nivel del menú: los valores de /model, /effort y (en Claude) /output-style, con el puesto marcado.
  const valores = useMemo<Valores>(
    () => ({
      model: {
        lista: modelos.map((m) => ({ valor: m.clave, desc: m.nombre })),
        actual: modelos.find((m) => m.id === modelo)?.clave ?? null,
      },
      effort: { lista: effortsOpciones(modelo).map((e) => ({ valor: e.id, desc: e.desc })), actual: effort },
      ...(agy || esDsh(modelo) || esOpencode(modelo) ? {} : { "output-style": { lista: listaEstilos.map((x) => ({ valor: x, desc: null })), actual: estilos.actual } }),
    }),
    [agy, modelo, effort, listaEstilos, estilos.actual, modelos],
  );
  const mn = useMemo(
    () => (puede && !sinMenu && !compactoCacheActivo ? menuEn(texto, caret, comandos, valores, modelo, deOtro) : null),
    [puede, sinMenu, compactoCacheActivo, texto, caret, comandos, valores, modelo, deOtro],
  );
  const menu = mn?.filas ?? [];
  const [nota, setNota] = useState<string | null>(null);
  /** El panel de `/mcp` (PanelMcp.tsx). */
  const [mcpAbierto, setMcpAbierto] = useState(MODO.captura === "lider-mcp");
  // Un modelo de otro motor para una conversación que ya empezó: el diálogo de confirmación (el chip no cambia hasta confirmar).
  /** Los datos del diálogo si elegir `m` sigue la conversación en otro motor; si no, `null`. */
  const datosCambio = (m: string): DatosCambio | null =>
    l && familiaDe(m) !== familiaDe(l.modelo) && familiaDe(m) !== familiaDe(modelo)
      ? { modelo: nombreModelo(m).split(" · ")[0]!, motor: motorNombre(m), actual: nombreModelo(modelo).split(" · ")[0]!, motorActual: motorNombre(modelo) }
      : null;
  const [cruce, setCruce] = useState<string | null>(null);
  const cruceDatos = cruce ? datosCambio(cruce) : null;
  const caja = useRef<HTMLTextAreaElement>(null);
  // La fila de abajo de la caja nunca baja a un segundo renglón: si no entra, se compacta de a un paso (0 todo; 1 el modo en ícono;
  // 2 modelo y esfuerzo en un solo chip; 3 los chips sin adorno y con puntos suspensivos). Se prueba cada paso hasta que no sobre ancho.
  const barra = useRef<HTMLDivElement>(null);
  const [nivel, setNivel] = useState(0);
  const ajustarBarra = useCallback(() => {
    const b = barra.current;
    if (!b) return;
    let n = 0;
    for (; n < 3; n++) {
      b.dataset.nivel = String(n);
      // En el celular los chips pueden achicarse (flex-shrink) sin desbordar la fila: un chip recortado también cuenta como que no entra.
      const recortado = [...b.querySelectorAll<HTMLElement>(".pbtn")].some((p) => p.offsetParent && p.scrollWidth > p.clientWidth + 1);
      if (b.scrollWidth <= b.clientWidth + 1 && !recortado) break;
    }
    b.dataset.nivel = String(n);
    setNivel(n);
  }, []);
  useLayoutEffect(ajustarBarra);
  useEffect(() => {
    const b = barra.current;
    if (!b || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(ajustarBarra);
    ro.observe(b);
    return () => ro.disconnect();
  }, [ajustarBarra, puede]);
  const menuCmd = useRef<HTMLDivElement>(null);
  // Tras elegir una fila, el cursor va al final de lo puesto: se aplica al pintar la caja con el texto nuevo.
  const pendiente = useRef<number | null>(null);
  useLayoutEffect(() => {
    const p = pendiente.current;
    if (p === null || !caja.current) return;
    pendiente.current = null;
    caja.current.setSelectionRange(p, p);
  });

  // El asistente de Ramas llena la caja de un líder nuevo que ya puede estar montado.
  useEffect(
    () =>
      escucharBorrador(clave, () => {
        const b = leerBorrador(clave);
        setTexto(b.texto);
        setCaret(b.texto.length);
        setErrorCaja(b.error);
        // Llenada desde afuera (Ramas, o el borrador que vuelve tras un reinicio): el cursor, al final.
        guardarCursor(clave, b.texto.length);
        requestAnimationFrame(() => caja.current?.setSelectionRange(b.texto.length, b.texto.length));
      }),
    [clave],
  );
  // La caja se arma de nuevo en cada cambio de conversación: el navegador deja el cursor al inicio del texto.
  // Vuelve a donde estaba (o al final); al irse se anota.
  useLayoutEffect(() => {
    const c = caja.current;
    if (!c) return;
    const p = cursorDe(clave, c.value.length);
    c.setSelectionRange(p, p);
    setCaret(p);
    return () => guardarCursor(clave, c.selectionEnd);
  }, [clave, puede]);
  const zona = useRef<HTMLDivElement>(null);
  const scroll = useRef<{ tipo: "fondo" } | { tipo: "mantener"; alFondo: number } | null>({ tipo: "fondo" });
  const pidiendo = useRef(false);
  // Pegado al fondo mientras llega contenido; si el usuario sube, se suelta (src/hilo/seguir.ts).
  const seg = useSeguir(zona);
  // Aparece una tanda de preguntas: el panel le saca alto a la lista, y lo último que dijo el líder queda pegado al fondo,
  // justo arriba del panel (sin scroll animado). Si el panel sólo se pliega o crece, lo sigue el observador de la zona.
  const tandaId = tandas[0]?.id ?? null;
  const tandaVista = useRef<string | null>(null);
  useLayoutEffect(() => {
    const z = zona.current;
    if (z && aparecioTanda(tandaVista.current, tandaId)) bajar(z, seg);
    tandaVista.current = tandaId;
  }, [tandaId, seg]);
  // Uno de terminal: que compacta lo dice la marca del hook (uno de la app lo dice en su stream, HaceChat); la caja mira el hook también para «Compactar y cambiar».
  const compactaHook = useCompactando(l && !l.caido ? l.id : null);
  const compacta = !app ? compactaHook : null;
  const compactandoAhora = compactaHook !== null || vivo.ind.hace?.que === "compactando";
  const id = useId();

  useEffect(() => {
    if (l) return;
    let sigue = true;
    void leerEfforts().then((e) => sigue && !tocado.current && setEffort(effortPara(modelo, e)));
    return () => {
      sigue = false;
    };
  }, []);

  // --- La conversación (transcript) ---

  // Cuál fue la última lectura pedida: si dos se pisan, la vieja que llega tarde no pisa a la nueva (ni baja `total`).
  const lectura = useRef(0);
  const lecturaActual = useRef<{ sid: string; promesa: ReturnType<typeof fuente.liderConversacion> } | null>(null);
  const leerTranscript = useCallback(async () => {
    const r = await fuente.liderConversacion(sid, null);
    if (r.version !== VERSION) throw new Error(tr("error.version", { que: "transcript", v: r.version, conozco: VERSION }));
    return r;
  }, [sid]);
  const recargar = useCallback(
    (forzar = false) => {
      if (!sid) return;
      const mia = ++lectura.current;
      const promesa = leerTranscript();
      lecturaActual.current = { sid, promesa };
      promesa.then(
        (r) => {
          if (mia !== lectura.current) return;
          setError(null);
          scroll.current = seg.pegado ? { tipo: "fondo" } : null;
          setPag((p) => {
            const empalma = p && r.desde <= p.total;
            return {
              mensajes: empalma ? juntar(p.mensajes, r.mensajes) : r.mensajes,
              desde: empalma ? Math.min(p.desde, r.desde) : r.desde,
              total: r.total,
              usage: r.usage,
              transcript: r.transcript,
              compactada: r.compactada,
            };
          });
          confirmar(sid, r.total, forzar);
          transcriptLeido(sid, r);
        },
        (e) => {
          if (mia !== lectura.current) return;
          lecturaActual.current = null;
          setError(mensaje(e));
        },
      );
    },
    [sid, seg, leerTranscript],
  );

  useEffect(() => {
    if (!sid) return;
    recargar();
    if (!mirar) return;
    fuente.liderMirar(sid);
    return () => fuente.liderMirar(null);
  }, [sid, recargar, mirar]);

  // Mientras un líder de la app responde, lo nuevo viene por el stream; el transcript, al terminar.
  const ocupadoApp = useRef(false);
  ocupadoApp.current = app && ocupado;
  useEffect(() => fuente.alTranscript((s) => s === sid && !ocupadoApp.current && recargar()), [sid, recargar]);
  // Puntos de control por turno (electron/puntos.ts): se piden al abrir la conversación, al quedar lista la foto de «después» de un
  // turno y tras volver atrás. Sin git en la carpeta del líder, vienen vacíos y no se ve nada.
  const [puntos, setPuntos] = useState<PuntoControl[]>([]);
  const [recargaPuntos, setRecargaPuntos] = useState(0);
  useEffect(() => {
    setPuntos([]);
    if (!sid || !deApp) return;
    let vigente = true;
    void fuente.liderPuntos(sid).then((p) => vigente && setPuntos(p));
    return () => {
      vigente = false;
    };
  }, [sid, deApp, vivo.puntos, recargaPuntos]);
  const alVolverPunto = useCallback(() => setRecargaPuntos((n) => n + 1), []);
  useEffect(() => {
    if (!vivo.fines) return;
    recargar();
    const t = setTimeout(() => recargar(true), SOLTAR_MS);
    return () => clearTimeout(t);
  }, [vivo.fines, recargar]);

  const anterior = useCallback(() => {
    const z = zona.current;
    if (!pag || pag.desde <= 0 || pidiendo.current || !z) return;
    pidiendo.current = true;
    fuente.liderConversacion(sid, pag.desde).then(
      (r) => {
        pidiendo.current = false;
        const z = zona.current;
        scroll.current = z ? { tipo: "mantener", alFondo: z.scrollHeight - z.scrollTop } : null;
        setPag((p) => p && { ...p, mensajes: juntar(r.mensajes, p.mensajes), desde: Math.min(p.desde, r.desde) });
      },
      (e) => {
        pidiendo.current = false;
        setError(mensaje(e));
      },
    );
  }, [pag, sid]);

  // Lo del transcript y, detrás, lo que llegó por el stream y todavía no está en él.
  const mensajes = useMemo(() => mensajesVistos(pag, vivo), [pag, vivo.ocupado, vivo.base, vivo.baseSabida, vivo.tanda, vivo.parcial, vivo.pensando]);
  // ¿El último pedido del chat es la revisión de un plan? Entonces el plan que llega es el corregido: «Plan revisado listo».
  const trasRevision = useMemo(() => {
    for (let i = mensajes.length - 1; i >= 0; i--) {
      const m = mensajes[i]!;
      if (m.rol === "user" && m.texto.trim()) return !!leerMensajeRevision(m.texto);
    }
    return false;
  }, [mensajes]);
  const transcript = pag?.transcript ?? null;
  const todos = useMemo(
    () => turnos(mostrar ? mensajes.flatMap((m) => mostrar(m) ?? []) : mensajes, transcript),
    [mensajes, mostrar, transcript],
  );
  // Volver acá: lo de después de ese mensaje sale de la vista hasta que se escriba (o se deshaga).
  const items = useMemo(() => {
    if (!volver) return todos;
    const k = todos.findIndex((x) => (x.tipo === "yo" || x.tipo === "turno") && x.punto?.uuid === volver.uuid);
    return k < 0 ? todos : todos.slice(0, k + 1);
  }, [todos, volver]);
  // Los mensajes que llegan con la conversación ya abierta entran con un deslizamiento (movimiento-estilos.css); el historial al abrir, no.
  const asentado = useAsentado(clave, items.length > 0 || !sid || pag?.total === 0);
  const conv = useRef<HTMLDivElement>(null);
  useEntradas(conv, asentado);
  const respuesta = useMemo(() => {
    for (let i = mensajes.length - 1; i >= 0; i--) if (mensajes[i].rol === "assistant" && mensajes[i].texto) return mensajes[i].texto;
    return "";
  }, [mensajes]);
  useEffect(() => {
    if (respuesta && !vivo.parcial) alRespuesta?.(respuesta);
  }, [respuesta, vivo.parcial, alRespuesta]);
  // Con el turno ya en el transcript, el límite, el error y la compactación se ven ahí como
  // líneas de sistema (B18): el aviso del stream no se repite abajo.
  const enTranscript = !vivo.ocupado && (pag?.total ?? 0) >= vivo.base + vivo.tanda.length;
  // El error del `result` (sin código) se repite sólo si es el texto de un sintético del transcript.
  const avisos = useMemo(() => {
    if (!enTranscript) return vivo.avisos;
    const dichos = new Set(mensajes.filter((m) => m.modelo === "<synthetic>").map((m) => m.texto.trim()));
    return vivo.avisos.filter(
      (a) =>
        !(
          a.clase === "compacto" ||
          (a.clase === "limite" && a.rechazado) ||
          (a.clase === "error" && (a.codigo !== null || dichos.has(a.texto.trim())))
        ),
    );
  }, [enTranscript, vivo.avisos, mensajes]);
  let ultimoTurno = items.length - 1;
  while (ultimoTurno >= 0 && items[ultimoTurno].tipo !== "turno") ultimoTurno--;
  // «Seguir con otro modelo» (#1791) en la línea del último límite de uso que ya quedó en la conversación (con el líder quieto).
  let ultimoLimite = items.length - 1;
  const esLimite = (x: Item) => x.tipo === "sistema" && x.s.tipo === "linea" && x.s.clase === "limite";
  while (ultimoLimite >= 0 && !esLimite(items[ultimoLimite])) ultimoLimite--;
  // El relevo (B19): mientras corre, el testimonio; al salir, "Sigue en …" con el líder nuevo
  // (hereda el nombre de la sesión: el más nuevo con el mismo nombre y otro id).
  const relevo = useMemo(() => relevoEn(items), [items]);
  const pasando = !!relevo && !relevo.hecho && ocupado && relevo.k === ultimoTurno;
  // Un turno que terminó mal: la tarjeta queda abierta y su error va adentro, con las mismas acciones que tenía el aviso (Seguir con otro modelo…).
  const errorEnTarjeta = app && !!sid && !pasando && !vivo.ind.hace && vivo.fin?.estado === "error";
  const sigue = useMemo(() => {
    if (!relevo?.hecho || !l || !lideres) return null;
    let n: Lider | null = null;
    for (const x of lideres.values()) if (x.id !== l.id && x.nombre === l.nombre && (!n || x.actividad > n.actividad)) n = x;
    return n;
  }, [relevo?.hecho, l, lideres]);

  // Volver a una conversación que ya estuvo abierta en esta sesión: donde el usuario la dejó (abajo del todo, si estaba abajo).
  useLayoutEffect(() => {
    const z = zona.current;
    if (!sid || !z) return;
    retomarScroll(clave);
    return () => guardarAncla(clave, z, seg.pegado);
  }, [clave, sid]);

  // Al fondo cuando llega algo, también cada pedazo del texto que va llegando; si el usuario scrolleó
  // para arriba se suelta y no se lo arrastra hasta que vuelva al fondo (`seg`: src/hilo/seguir.ts,
  // que además mira el scroll y lo que crece fuera de un render).
  useLayoutEffect(() => {
    const z = zona.current;
    if (!z) return;
    const s = scroll.current;
    scroll.current = null;
    // Al abrir tras un reinicio, la conversación vuelve a donde el usuario la dejó (src/hilo/scrollGuardado.ts).
    if (pag && sid && restaurarScroll(z, seg, clave, pag.desde > 0)) {
      // ya está
    } else if (s?.tipo === "mantener") {
      z.scrollTop = z.scrollHeight - s.alFondo;
      anotar(z, seg);
    } else if (s?.tipo === "fondo") bajar(z, seg);
    else seguir(z, seg);
    // Si el usuario había subido y lo de abajo creció, la distancia al final cambió sin que él scrollee.
    if (pag && sid && !seg.pegado) anotarScroll(clave, z);
    if (pag && pag.desde > 0 && (z.scrollHeight <= z.clientHeight + MARGEN_PAGINA || faltaLlegar(clave))) anterior();
  }, [pag, mensajes.length, vivo.parcial, vivo.pensando, anterior, seg]);

  // La solapa de la cola (o la caja) crece, se pliega o se va: la zona cambia de alto. Pegado al fondo, sigue pegado.
  useEffect(() => {
    const z = zona.current;
    if (!z || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (seg.pegado && z.clientHeight) bajar(z, seg);
    });
    ro.observe(z);
    return () => ro.disconnect();
  }, [seg]);

  // --- La caja ---

  const escribir = (v: string, c = v.length) => {
    setTexto(v);
    setCaret(c);
    setSinMenu(false);
    setSel(0);
    setNota(null);
    ponerBorrador(clave, { texto: v });
  };

  // Gemini, OpenCode y DeepSeek Harness no tienen modos de permisos: su puente contesta siempre el mismo (bypass o accept edits).
  const motorLider = l?.modelo ?? modelo;
  const modoFijo = esAgy(motorLider) ? "modo.fijoAgy" : esDsh(motorLider) || esOpencode(motorLider) ? "modo.fijoDsh" : null;
  const cambiarModo = (m: Modo) => {
    if (!puede) return;
    if (modoFijo) return setNota(tr(modoFijo));
    // El chip se achica a un símbolo en angosto (default y plan comparten ícono): el cambio se dice con palabras.
    setNota(tr("modo.cambio", { modo: tr(ASPECTO[m].clave) }));
    if (!l || !app) return setModoNuevo(m);
    const antes = modo;
    ponerModo(l.id, m);
    fuente.liderModo(l.id, m).catch((err) => {
      ponerModo(l.id, antes);
      setErrorCaja(mensaje(err));
    });
  };

  /** Lo que se escribió: un comando de la app se resuelve acá; lo demás va al líder. */
  const ejecutar = (crudo: string) => {
    if (compactoCacheActivo) return;
    if (!crudo.trim()) return enviar(crudo);
    const a = parsearComando(crudo, MODELOS, effortsDe(modelo), listaEstilos, modelo);
    if (a.tipo === "texto") return enviar(crudo);
    setErrorCaja(null);
    if (a.tipo === "error") return setErrorCaja(tr(a.clave, { v: a.v, niveles: effortsDe(modelo).join(", ") }));
    if (a.tipo === "modo") {
      cambiarModo(a.modo);
      // "/plan armá X": el modo primero, después el pedido (o a la cola, si está respondiendo).
      if (a.resto) return enviar(a.resto, a.modo);
      return escribir("");
    }
    escribir("");
    if (a.tipo === "limpiar") return l ? alNuevo() : undefined;
    if (a.tipo === "modelo") return pedirModelo(a.modelo);
    if (a.tipo === "estilo") return elegirEstilo(a.estilo);
    if (a.tipo === "mcp") return setMcpAbierto(true);
    if (a.tipo === "terminal") return setErrorCaja(tr("comando.soloTerminal", { v: a.nombre }));
    elegirEffort(a.effort);
  };

  /** /output-style: por el proceso vivo (al toque) o, si no hay ninguno, al próximo que arranque. */
  const elegirEstilo = (x: string) => {
    const antes = estilos.actual;
    ponerEstilos(x, null);
    fuente.liderEstilo(sid, x).then(
      (r) => setNota(tr(r === "vivo" ? "comando.estiloYa" : "comando.estiloDespues", { v: x })),
      (err) => {
        ponerEstilos(antes, null);
        setErrorCaja(mensaje(err));
      },
    );
  };

  // La fila de acciones abierta con el dedo se cierra al tocar fuera de la conversación.
  useEffect(() => cerrarSobreFuera(), []);
  // Volver acá no sobrevive a otro líder ni a un turno en curso.
  useEffect(() => setVolver(null), [sid]);
  useEffect(() => {
    if (ocupado) setVolver(null);
  }, [ocupado]);

  /**
   * Seguir la conversación desde el mensaje `uuid` (que deja `n` mensajes atrás) con `t`: lo de después queda fuera de esa línea.
   * `previa`: el mensaje es anterior a la última compactación; ahí el main sigue en un líder nuevo (una copia de la cadena),
   * así que este queda como estaba y se abre el nuevo.
   */
  const rebobinarA = (uuid: string, n: number, t: string, imagenes: Imagen[] | undefined, alFallar?: (msg: string) => void, previa = false) => {
    if (!l || enviando) return;
    // Volver/Editar no cambia de motor: con otro motor elegido en la caja sigue con el modelo del líder.
    const mismoMotor = !datosCambio(modelo);
    const mod = mismoMotor ? modelo : (modeloDe(l.modelo) ?? modelo);
    const ef = mismoMotor ? effort : (effortDe(l.effort, mod) ?? effort);
    const e: EnvioLider = { texto: t, modelo: mod, effort: ef, ...(imagenes ? { imagenes } : {}) };
    const antesPag = pag;
    const antesVolver = volver;
    setEnviando(true);
    setErrorCaja(null);
    setError(null);
    if (!previa) {
      enviado(l.id, t, n, imagenes);
      scroll.current = { tipo: "fondo" };
      setPag((p) => p && { ...p, mensajes: p.mensajes.filter((m) => m.i < n), total: n });
    }
    setVolver(null);
    fuente.liderRebobinar(l.id, uuid, e, previa).then(
      (nuevo) => {
        setEnviando(false);
        if (nuevo) {
          enviado(nuevo, t, n, imagenes);
          alCreado(nuevo, e);
          alAbrirLider?.(nuevo);
        }
      },
      (err) => {
        const msg = mensaje(err);
        if (!previa) {
          fallo(l.id);
          setPag(antesPag);
        }
        setVolver(antesVolver);
        setEnviando(false);
        setError(msg);
        alFallar?.(msg);
      },
    );
  };

  // Volver acá, Editar y Ramificar: Claude, Gemini, OpenCode y DeepSeek Harness (los tres últimos con un relevo, electron/lider.ts); no los locales.
  const rebobinable = !!l && !sinWorkers(l.modelo);
  // "Mandar ya": Claude lo recibe en su stdin y el puente de agy o el de dsh corta en la próxima pausa y retoma; los locales no tienen canal.
  const puedeDirecto = !!l && !sinWorkers(l.modelo);
  const sinRebobinar = ocupado || enviando ? tr("acciones.ocupado") : ajeno ? tr("acciones.abierto") : null;
  const acciones = useMemo<Acciones | null>(
    () =>
      l && rebobinable
        ? {
            rebobina: sinRebobinar === null,
            ramifica: true,
            motivo: sinRebobinar,
            volver: (p) => setVolver(p),
            ramificar: (p) => {
              setError(null);
              fuente.liderRamificar(l.id, p.uuid, { modelo, effort }).then(
                (nuevo) => {
                  alCreado(nuevo, { texto: "", modelo, effort, de: l.id });
                  alAbrirLider?.(nuevo);
                },
                (err) => setError(mensaje(err)),
              );
            },
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [l?.id, rebobinable, sinRebobinar, modelo, effort, alCreado, alAbrirLider],
  );
  /** Editar un pedido: sigue desde el mensaje de antes con el texto nuevo (las rutas de archivos que traía se conservan). */
  const rebobinarUlt = useRef(rebobinarA);
  rebobinarUlt.current = rebobinarA;
  const editar = useCallback((x: Extract<Item, { tipo: "yo" }>, nuevo: string, adjuntos: readonly Adjunto[]) => {
    if (!x.punto?.previo) return;
    const imgs = imagenesDe(adjuntos);
    const t = textoConArchivos(nuevo.trim(), archivosDe(adjuntos), (ruta) => tr("adjunto.linea", { ruta }));
    rebobinarUlt.current(x.punto.previo, x.punto.antes, t, imgs.length ? imgs : undefined, undefined, x.punto.previa);
  }, []);
  // Un archivo nuevo de un mensaje que se edita sale por la misma máquina que el líder (como los de la caja).
  const guardarArchivo = useCallback((nombre: string, datos: Uint8Array) => fuente.liderArchivo(nombre, datos, maquinaDe), [maquinaDe]);

  // La cuenta de Claude la elige la persona: en un líder nuevo queda para su primer mensaje; en uno que existe se la manda al main (vale desde el próximo mensaje).
  const elegirCuenta = (id: string) => {
    if (!l) return setCuentaNueva(id);
    if (id === (l.cuenta ?? "claude")) return;
    setErrorCaja(null);
    // Con mensajes, el aviso de razonamiento de otra cuenta sale ya (una línea, sin frenar el cambio): el próximo mensaje lo usa.
    const conMensajes = items.length > 0;
    if (conMensajes) setNota(tr("aviso.cuenta"));
    fuente.liderCuenta(l.id, id === "claude" ? "" : id).then(
      () => {
        if (!conMensajes) setNota(tr("cuenta.lider.nota"));
      },
      (err) => setErrorCaja(mensaje(err)),
    );
  };
  // Con la cuenta de este chat en el tope y otra con lugar, se ofrece pasar (sólo ofrece: el chat no cambia solo).
  const cuentaDelChat = l ? (l.cuenta ?? "claude") : null;
  const ofertaCuenta = useMemo(() => {
    if (!l || cuentaDelChat === null || !app || maquinaDe || familiaDe(modelo) !== "claude" || esLocal(modelo)) return null;
    if (!cuentasDeClaude(listaCuentas).length) return null;
    const datos = uso && !("error" in uso) ? uso : null;
    const cupos = filasDeCupos(datos?.suscripciones, datos?.claudeNombre, tr("cuentas.principal"));
    return ofertaDeCambio(cuentasClaude(datos, cupos.filas, cupos.claudeCorto ?? datos?.claudeNombre ?? tr("uso.claude"), listaCuentas), cuentaDelChat);
  }, [l, cuentaDelChat, app, maquinaDe, modelo, listaCuentas, uso]);
  const propsAvisos = { volverA: (id: string) => nombreCuentaClaude(listaCuentas, id), alVolver: elegirCuenta, alSeguir: l && !ocupado ? () => setSeguirCon(true) : undefined, deshabilitado: ocupado || !app };

  // Con la caché vencida y un contexto grande, el primer mensaje espera a que la persona elija (cache-pregunta.ts, DialogoCache.tsx).
  const eleccionCache = useSyncExternalStore(alCambiarCacheEleccion, cacheEleccion);
  const [preguntaCache, setPreguntaCache] = useState<{ veredicto: VeredictoCache; crudo: string; modoNuevoYa?: Modo } | null>(() =>
    MODO.captura === "lider-cache" || MODO.captura === "lider-cache-compactar"
      ? { veredicto: { accion: "preguntar", tokensSeguir: 128000, tokensResumen: 26000 }, crudo: "" }
      : null,
  );
  const veredictoCache = () =>
    decidirCacheConTranscript(
      {
        modelo: l?.modelo ?? modelo,
        local: esLocal(l?.modelo ?? modelo),
        cruza: !!datosCambio(modelo),
        vence: l?.cache_vence ?? null,
        ttl: l?.cache_ttl_s ?? null,
        actividad: l?.actividad ?? 0,
        pref: eleccionCache,
        ahoraMs: Date.now(),
      },
      pag,
      vivoCtx.usage,
      vivo.avisos.some((a) => a.clase === "compacto"),
      () => lecturaActual.current?.sid === sid ? lecturaActual.current.promesa : leerTranscript(),
    );
  /** La persona eligió: se manda el mensaje que esperaba; «recordar» lo deja guardado para la próxima. */
  const elegirCache = (e: EleccionCache, recordar: boolean) => {
    const q = preguntaCache;
    setPreguntaCache(null);
    if (!q) return;
    if (recordar) cambiarCacheEleccion(e);
    enviar(q.crudo, q.modoNuevoYa, e);
  };
  /** 3ª opción de caché vencida: compacta con un modelo barato (o mismo Gemini), restaura el elegido y recién ahí manda el mensaje. */
  const compactarDesdeCache = (compactarCon: string) => {
    const q = preguntaCache;
    setPreguntaCache(null);
    if (!q || !l || !app || !soportaCompactar(compactarCon) || cambioCompacto.fase === "compactando") return;
    const destino = { modelo, effort };
    const effortCompactar = effortPara(compactarCon, effortsLeidos() ?? {});
    compactoBase.current = {
      fines: vivo.fines,
      compactos: vivo.avisos.filter((a) => a.clase === "compacto").length,
    };
    setCompactoCache({ crudo: q.crudo, modoNuevoYa: q.modoNuevoYa, compactarCon, destino, restaurado: false });
    dispatchCambio({ tipo: "iniciar", destino });
    aplicarModelo(compactarCon, effortCompactar || undefined, false);
    const idDestino = l.id;
    fuente.liderMandar(idDestino, { texto: "/compact", modelo: compactarCon, effort: effortCompactar }).then(
      () => sidActual.current === idDestino && enviadoCompactar(idDestino),
      (e) => sidActual.current === idDestino && dispatchCambio({ tipo: "fallo", motivo: mensaje(e) }),
    );
  };

  const enviar = (crudo = texto, modoNuevoYa?: Modo, eleccion?: EleccionCache) => {
    const archivos = archivosDe(adjuntos);
    // Los archivos que no son imágenes van como rutas al final del texto: Claude los lee con Read.
    const t = textoConArchivos(crudo.trim(), archivos, (ruta) => tr("adjunto.linea", { ruta }));
    const imgs = imagenesDe(adjuntos);
    const imagenes = imgs.length ? imgs : undefined;
    if ((!t && !imagenes) || enviando || !puede) return;
    if (cambioCompacto.fase !== "compactando" && cambioCompacto.fase !== "reposo") dispatchCambio({ tipo: "reiniciar" });
    // Volver acá: lo que se escribe sigue desde ese mensaje.
    if (l && volver) {
      const antes = adjuntos;
      vaciarAdjuntos(clave);
      setTexto(""); setCaret(0);
      ponerBorrador(clave, { texto: "", error: null });
      return rebobinarA(volver.uuid, volver.n, t, imagenes, (msg) => {
        ponerBorrador(clave, { texto: crudo, error: msg });
        setTexto(crudo); setCaret(crudo.length);
        setErrorCaja(msg);
        agregarAdjuntos(clave, antes);
      }, volver.previa);
    }
    /**
     * A mitad de un turno: a la cola. Todo lo encolado sale junto, en un solo mensaje, en la próxima pausa (el próximo límite de
     * herramienta, sin interrumpir; sin ese canal, al terminar el turno). Al de la terminal, con lo que hace falta para traerlo.
     */
    const aLaCola = (id: string, nombre: string) => {
      const antes = adjuntos;
      // Lo elegido de otro modelo o esfuerzo no cambia el turno en curso: queda para el próximo, y se dice.
      if (app && ocupado && puedeDirecto && (pend.modelo || pend.effort)) setNota(tr("directo.pendiente"));
      cola.encolar(id, { texto: t, modelo, effort, ...(imagenes ? { imagenes } : {}), ...(app ? {} : { modo: modoNuevoYa ?? modo, nombre }) }).catch((err) => {
        // No entró (el main lo rechazó, o el celular sin red): vuelve a la caja.
        const msg = mensaje(err);
        ponerBorrador(clave, { texto: crudo, error: msg });
        setTexto(crudo); setCaret(crudo.length);
        setErrorCaja(msg);
        agregarAdjuntos(clave, antes);
      });
      scroll.current = { tipo: "fondo" };
      setTexto(""); setCaret(0);
      setErrorCaja(null);
      setEnviando(false);
      ponerBorrador(clave, { texto: "", error: null });
      vaciarAdjuntos(clave);
    };
    // El de la terminal: también si ya hay algo esperando (no se le adelanta a lo que está en la cola).
    if (l && (ocupado || (!app && encolados.length > 0))) return aLaCola(l.id, l.nombre);
    const e: EnvioLider = { texto: t, modelo, effort, ...(imagenes ? { imagenes } : {}), ...(l ? {} : { modo: modoNuevoYa ?? modoNuevo, ...(maquinaDe ? { maquina: maquinaDe } : {}), ...(cuentaNueva && familiaDe(modelo) === "claude" && !esLocal(modelo) ? { cuenta: cuentaNueva } : {}), ...(ultracode && esClaudeOficial(modelo) ? { ultracode: true } : {}), ...(fast && soportaFast(modelo) ? { fast: true } : {}), ...carpetaDeEnvio(carpeta, carpetaAMano) }) };
    setEnviando(true);
    setErrorCaja(null);
    ponerBorrador(clave, { texto: crudo, error: null });
    // Las imágenes salen de la caja con el mensaje; si no sale, vuelven.
    let salieron = false;
    const mal = (err: unknown) => {
      const msg = mensaje(err);
      ponerBorrador(clave, { error: msg });
      if (leerBorrador(clave).texto === crudo) {
        setTexto(crudo); setCaret(crudo.length);
      }
      setErrorCaja(msg);
      setEnviando(false);
      if (salieron && adjuntos.length) agregarAdjuntos(clave, [...(imagenes ?? []), ...archivos]);
    };
    if (!l) {
      // La caja baja ya; el líder creado se abre (remonta la vista) cuando terminó de bajar.
      setPartio(true);
      const bajada = new Promise<void>((ok) => {
        bajo.current = ok;
        setTimeout(ok, quieto ? 0 : BAJAR_MS);
      });
      fuente.liderNuevo(e).then(
        (nuevo) => {
          // El turno se anota ya (el stream puede terminar antes de que la caja baje); sólo la vista espera.
          enviado(nuevo, t, 0, imagenes);
          void bajada.then(() => {
            setMaquinaNueva(null);
            setCuentaNueva(null);
            setCarpetaAMano(false);
            setOtraAbierta(false);
            ponerBorrador(clave, { texto: "", error: null });
            vaciarAdjuntos(clave);
            alCreado(nuevo, e);
          });
        },
        (err) => {
          setPartio(false);
          mal(err);
        },
      );
      return;
    }
    // `empezar: "resumen"` (caché vencida, ver `veredictoCache`): Claude abre otra conversación, así que en ésta no se anota el mensaje.
    const salir = (total: number, empezar?: "resumen") => {
      salieron = true;
      vaciarAdjuntos(clave);
      const enOtra = empezar === "resumen" && familiaDe(l.modelo) === "claude";
      if (!enOtra) {
        enviado(l.id, t, total, imagenes);
        scroll.current = { tipo: "fondo" };
      }
      if (leerBorrador(clave).texto === crudo) {
        setTexto(""); setCaret(0);
      }
      fuente.liderMandar(l.id, empezar ? { ...e, empezar } : e).then(
        (nuevo) => {
          if (leerBorrador(clave).texto === crudo) ponerBorrador(clave, { texto: "", error: null });
          setEnviando(false);
          if (nuevo) {
            enviado(nuevo, t, 0, imagenes);
            // La conversación sigue en otro líder: queda en la misma carpeta de la barra que ésta.
            alCreado(nuevo, { ...e, de: l.id });
            alAbrirLider?.(nuevo);
          } else if (empezar) setNota(tr("cache.notaResumen"));
        },
        (err) => {
          if (!enOtra) fallo(l.id);
          mal(err);
        },
      );
    };
    if (app) {
      // La caché venció y el contexto es grande: lo recordado manda; si no, el mensaje espera en la caja hasta que se elija (DialogoCache).
      if (eleccion) return salir(pag?.total ?? 0, eleccion === "resumen" ? "resumen" : undefined);
      const aplicar = ({ veredicto, total }: { veredicto: VeredictoCache; total: number }) => {
        if (veredicto.accion === "preguntar") {
          setEnviando(false);
          return setPreguntaCache({ veredicto, crudo, modoNuevoYa });
        }
        return salir(total, veredicto.accion === "resumen" ? "resumen" : undefined);
      };
      const decision = veredictoCache();
      return decision instanceof Promise ? void decision.then(aplicar, mal) : aplicar(decision);
    }
    // Abierto en una terminal: primero se lo trae (cierra ese `claude`, por su pid) y recién
    // entonces sale el mensaje, con el `--resume` de siempre. Nunca dos procesos en el transcript.
    const modoAl = modoNuevoYa ?? modo;
    fuente.liderTraer(l.id, { modelo, effort, nombre: l.nombre, modo: modoAl }).then((r) => {
      if (!r.ok) {
        // A mitad de algo (la lista todavía no lo decía): no se tocó nada, y el mensaje espera en la cola.
        if (r.motivo === "trabajando") return aLaCola(l.id, l.nombre);
        setEnviando(false);
        setErrorCaja(tr(NO_TRAE[r.motivo]));
        return;
      }
      setTraido(true);
      ponerModo(l.id, modoAl);
      // Lo que alcanzó a escribir la terminal antes de cerrarse ya está en el transcript.
      return fuente.liderConversacion(l.id, null).then(
        (c) => salir(c.total),
        () => salir(pag?.total ?? 0),
      );
    }, mal);
  };

  /** Archivos pegados, soltados o elegidos: las imágenes se achican si hace falta; el resto lo guarda el main. Quedan en la caja. */
  const adjuntar = (fs: readonly File[]) => {
    if (!puede || !fs.length) return;
    setErrorCaja(null);
    void Promise.allSettled(fs.map((f) => prepararAdjunto(f, (n, d) => fuente.liderArchivo(n, d, maquinaDe)))).then((rs) => {
      const ok = rs.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      const mal = rs.find((r): r is PromiseRejectedResult => r.status === "rejected");
      const sobran = agregarAdjuntos(clave, ok);
      if (mal)
        setErrorCaja(
          mal.reason instanceof ErrorAdjunto
            ? mal.reason.grande
              ? tr("adjunto.grande", { v: mal.reason.grande, n: ARCHIVO_MAX / 1024 / 1024 })
              : tr("adjunto.leer")
            : mensaje(mal.reason),
        );
      else if (sobran) setErrorCaja(tr("adjunto.muchas", { n: IMAGENES_MAX }));
    });
    caja.current?.focus();
  };
  // El texto pegado sigue su camino; los archivos del portapapeles, a la caja.
  const pegar = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (compactoCacheActivo) return;
    const fs = archivosDeDatos(e.clipboardData);
    if (!fs.length) {
      // Sin nada que el navegador sepa pegar (otro tipo de texto, un offer viejo): el main lee el portapapeles.
      const leer = esVentana() ? main?.portapapeles : undefined;
      if (!puede || !leer || !pegadoSinTexto(e.clipboardData)) return;
      e.preventDefault();
      const c = e.currentTarget;
      const [ini, fin] = [c.selectionStart, c.selectionEnd];
      void leer.texto().then((t) => {
        if (!t || c.readOnly) return;
        const base = c.value;
        const p = ini + t.length;
        pendiente.current = p;
        escribir(base.slice(0, ini) + t + base.slice(fin), p);
      }, (err) => setErrorCaja(mensaje(err)));
      return;
    }
    if (!e.clipboardData.types.includes("text/plain")) e.preventDefault();
    adjuntar(fs);
  };
  const conArchivos = (e: DragEvent) => puede && e.dataTransfer.types.includes("Files");
  const soltable = {
    onDragOver: (e: DragEvent) => {
      if (!conArchivos(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (!arrastra) setArrastra(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setArrastra(false);
    },
    onDrop: (e: DragEvent) => {
      if (!conArchivos(e)) return;
      e.preventDefault();
      setArrastra(false);
      adjuntar(Array.from(e.dataTransfer.files));
    },
  };

  const parar = () => {
    if (!l || vivo.parando) return;
    parando(l.id);
    void fuente.liderParar(l.id);
  };

  const elegirComando = (s: Sugerencia, ya: boolean) => {
    if (!mn || s.ajeno) return; // de otra empresa: no corre con este modelo (la fila ya dice qué hacer)
    const { texto: nuevo, caret: p } = reemplazar(texto, mn, s);
    // Enter o clic sobre un comando de la app al inicio de la caja lo ejecuta, con lo que sigue ("/plan armá X").
    if (ya && directo(s) && mn.ini === 0) return ejecutar(nuevo);
    // El foco primero: enfocar dispara onFocus, que abre el menú.
    caja.current?.focus();
    pendiente.current = p;
    escribir(nuevo, p);
    if (directo(s)) setSinMenu(true);
  };

  const tecla = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift+Tab rota el modo, como en Claude Code (también mientras responde).
    if (es("modo", e)) {
      e.preventDefault();
      cambiarModo(siguienteModo(modo));
      return;
    }
    if (e.nativeEvent.isComposing) return;
    if (menu.length) {
      const n = moverSel(Math.min(sel, menu.length - 1), menu.length, e.key);
      if (n !== null) {
        e.preventDefault();
        setSel(n);
        // Sólo con el teclado (el mouse ya la tiene a la vista): que no quede fuera del scroll.
        menuCmd.current?.children[n]?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        elegirComando(menu[Math.min(sel, menu.length - 1)], e.key === "Enter");
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSinMenu(true);
        return;
      }
    }
    // Con el dedo no hay Shift+Enter: Enter es un renglón más y se manda con el botón.
    if (es("enviar", e) && !esTactil()) {
      e.preventDefault();
      ejecutar(texto);
    } else if (es("salirCaja", e)) e.currentTarget.blur();
  };

  /** Del selector (que ya confirmó lo que había que confirmar) o de un cambio dentro del mismo motor. */
  const elegirModelo = (m: string) => {
    dispatchCambio({ tipo: "reiniciar" });
    const d = datosCambio(m);
    aplicarModelo(m);
    // Un salto de motor ya confirmado: un aviso chico de que ya pasó.
    if (d) setNota(tr("lider.cruceHecho", { modelo: d.modelo, motor: d.motor }));
  };
  /** De /model: si cruza de motor, pide confirmar antes de aplicar. */
  const pedirModelo = (m: string) => {
    // Otro motor con un turno en curso: sigue como siempre (se confirma con el líder en reposo).
    if (enTurno && datosCambio(m)) return setErrorCaja(tr("lider.cruceEnTurno"));
    if (datosCambio(m)) {
      setErrorCaja(null);
      setCruce(m);
      return;
    }
    dispatchCambio({ tipo: "reiniciar" });
    aplicarModelo(m);
  };
  /** `mandar: false`: la selección va en el mismo mensaje (el `/compact` de compactar), no aparte por la cola. */
  const aplicarModelo = (m: string, ef?: string, mandar = true) => {
    tocado.current = true;
    // Cada modelo tiene sus niveles: si el esfuerzo de ahora no existe en el nuevo, pasa al que le toca a ese modelo.
    const e = ef && effortsDe(m).includes(ef) ? ef : reajustarEffort(m, effort, effortsLeidos() ?? {});
    marcarElegida({ modelo: m, effort: e });
    if (!mandar) elegidaAca.current = false;
    setModelo(m);
    setEffort(e);
  };
  const compactarYCambiar = () => {
    if (!l || !app || !soportaCompactar(l.modelo) || cambioCompacto.fase === "compactando") return;
    const vigente = modeloDe(l.modelo) ?? l.modelo ?? MODELO_DEFAULT;
    const effortVigente = effortDe(l.effort, vigente) ?? l.effort ?? "";
    const destino = { modelo, effort };
    compactoBase.current = {
      fines: vivo.fines,
      compactos: vivo.avisos.filter((a) => a.clase === "compacto").length,
    };
    dispatchCambio({ tipo: "iniciar", destino });
    // Vuelve la selección al modelo vigente para mandar `/compact` con lo que corre ahora.
    aplicarModelo(vigente, effortDe(l.effort, vigente) ?? undefined, false);
    const idDestino = l.id;
    fuente.liderMandar(idDestino, { texto: "/compact", modelo: vigente, effort: effortVigente }).then(
      () => sidActual.current === idDestino && enviadoCompactar(idDestino),
      (e) => sidActual.current === idDestino && dispatchCambio({ tipo: "fallo", motivo: mensaje(e) }),
    );
  };
  /**
   * El `/compact` ya entró. Lo que cerró mientras se mandaba no es la compactación: con otro modelo, el main relanza el proceso
   * (`desfasado`) y la salida del viejo suma un cierre (`salio`). La base pasa a contar desde acá (`enCurso` ya lo tiene: el evento
   * llega antes que la respuesta de `liderMandar`).
   */
  const enviadoCompactar = (id: string) => {
    compactoBase.current = { ...compactoBase.current, fines: enCurso(id).fines };
    dispatchCambio({ tipo: "enviado" });
  };
  useEffect(() => {
    if (!debeEsperarInicio(cambioCompacto)) return;
    const t = setTimeout(() => dispatchCambio({ tipo: "vencio" }), ESPERA_COMPACTAR_S * 1000);
    return () => clearTimeout(t);
  }, [cambioCompacto]);
  useEffect(() => {
    if (cambioCompacto.fase === "compactando") latir();
  }, [cambioCompacto.fase]);
  const compactosVivos = vivo.avisos.filter((a) => a.clase === "compacto").length;
  useEffect(() => {
    if (cambioCompacto.fase !== "compactando") return;
    const ultimoError = [...vivo.avisos].reverse().find((a) => a.clase === "error" || a.clase === "salio");
    const errorTexto = ultimoError ? textoAviso(ultimoError).texto : null;
    const ev = evaluarProgreso(cambioCompacto, {
      compactandoAhora,
      fines: vivo.fines,
      finesBase: compactoBase.current.fines,
      compactos: compactosVivos,
      compactosBase: compactoBase.current.compactos,
      finEstado: vivo.fin?.estado ?? null,
      errorTexto,
    });
    if (!ev) return;
    if (ev.tipo === "compacto") {
      aplicarModelo(cambioCompacto.destino.modelo, cambioCompacto.destino.effort);
      dispatchCambio(ev);
      return;
    }
    if (ev.tipo === "fallo" && !ev.motivo) {
      dispatchCambio({
        tipo: "fallo",
        motivo: tr(vivo.fin?.estado === "parado" ? "aviso.compactarDetenido" : "aviso.compactarVencido"),
      });
      return;
    }
    dispatchCambio(ev);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cambioCompacto, compactandoAhora, vivo.fines, compactosVivos, vivo.fin?.estado, vivo.avisos]);
  // Si compactó desde caché vencida: apenas vuelve el modelo destino y el líder queda libre, sale el mensaje esperando;
  // si falló o venció, restaura el modelo elegido y deja el mensaje en la caja sin perder nada.
  useEffect(() => {
    if (!compactoCache) return;
    if (cambioCompacto.fase === "reposo") {
      setCompactoCache(null);
      return;
    }
    if ((cambioCompacto.fase === "error" || cambioCompacto.fase === "vencido") && !compactoCache.restaurado) {
      aplicarModelo(compactoCache.destino.modelo, compactoCache.destino.effort);
      setCompactoCache((prev) => (prev ? { ...prev, restaurado: true } : null));
      return;
    }
    if (cambioCompacto.fase === "hecho" && !ocupado && modelo === compactoCache.destino.modelo) {
      const pend = compactoCache;
      setCompactoCache(null);
      dispatchCambio({ tipo: "reiniciar" });
      if (leerBorrador(clave).texto === pend.crudo) enviar(pend.crudo, pend.modoNuevoYa, "seguir");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compactoCache, cambioCompacto, ocupado, modelo]);
  /** Ultracode o Fast: en un líder de la app se aplican ya (el main lo comprueba con Claude Code y, si lo rechaza, devuelve el motivo); en uno nuevo quedan para su arranque. */
  const elegirExtra = async (cual: "ultracode" | "fast", v: boolean): Promise<ResultadoExtras> => {
    if (l && app) {
      const r = await fuente.liderExtras(l.id, { [cual]: v });
      if (!r.ok) return r;
    }
    (cual === "ultracode" ? setUltracode : setFast)(v);
    return { ok: true };
  };
  const elegirEffort = (x: string) => {
    tocado.current = true;
    marcarElegida({ modelo, effort: x });
    setEffort(x);
    recordarEffort(modelo, x);
  };

  const cache = useMemo(
    () => (l && l.cache_vence !== null && !l.subagentes && cacheAplica(l.modelo) ? pintorCache(`lider:${l.id}:${l.cache_vence}`, l.cache_vence, l.cache_ttl_s, false) : null),
    [l],
  );

  // «No conversation found»: la conversación está con otra cuenta de Claude. Se cambia la cuenta de este líder (no la preferida) y se retoma.
  const retomar = (conCuenta?: string) => {
    if (!l || retomando) return;
    setRetomando(true);
    setErrorCaja(null);
    const cambio = conCuenta ? fuente.liderCuenta(l.id, conCuenta === "claude" ? "" : conCuenta) : Promise.resolve();
    cambio.then(() => fuente.liderRetomar(l.id, { modelo, effort, nombre: l.nombre })).then(
      (r) => {
        setNoRetoma(r.ok ? null : r.motivo);
        // Si salió bien queda "retomando" hasta que la lista lo traiga como líder de la app.
        if (!r.ok) setRetomando(false);
      },
      (e) => {
        setRetomando(false);
        setErrorCaja(mensaje(e));
      },
    );
  };
  // Abierto en otro lado se puede reintentar (cerrándolo allá); sin conversación o sin carpeta, no.
  const sinVuelta = noRetoma !== null && noRetoma !== "abierto";
  const modeloAnterior = l ? modeloDe(l.modelo) : null;
  const cambia =
    !!l &&
    !!modeloAnterior &&
    puede &&
    !ocupado &&
    (l.cache_vence ?? 0) * 1000 > Date.now() &&
    modelo !== modeloAnterior &&
    cambioCompacto.fase === "reposo";
  const tokensAviso = useMemo(
    () =>
      tokensParaAviso({
        pagUsage: pag?.usage,
        vivoUsage: vivoCtx.usage,
        compactada: Boolean(pag?.compactada || compactosVivos > 0),
        mensajes: pag?.mensajes,
      }),
    [pag?.usage, pag?.compactada, pag?.mensajes, vivoCtx.usage, compactosVivos],
  );
  const aviso = useMemo(
    () => (cambia && l ? pintorAviso(l.cache_vence ?? 0, modelo, tokensAviso) : null),
    [cambia, l, modelo, tokensAviso],
  );
  const opcionCache = useMemo(
    () =>
      preguntaCache
        ? opcionCompactarCache({
            modeloLider: l?.modelo ?? modelo,
            modeloDestino: modelo,
            modelos: TABLA,
            excluir: configModelos.excluir,
            effortsPermitidos: configModelos.permitidos,
            tokens: preguntaCache.veredicto.tokensSeguir,
            claudeConectado: TABLA.some((m) => m.empresa === "anthropic" && !m.sinConectar),
            agyConectado: TABLA.some((m) => m.empresa === "google" && !m.sinConectar),
            ventanas: vivoCtx.ventanas,
          })
        : null,
    [preguntaCache, l?.modelo, modelo, tablaModelos, configModelos, vivoCtx.ventanas],
  );

  const alMedio = !l && !items.length && !partio;

  return (
    <>
      {/* El nombre, el modelo y el esfuerzo ya van en la cabecera; acá sólo lo que cambia (caché, subagentes, si duerme o cayó). Un líder nuevo no tiene nada. */}
      {l ? (
        <div className="lider-linea" data-desliza>
          {!ocupado && cache ? <Reloj pintor={cache} className="cache" /> : null}
          {l.subagentes ? <ChipSubagentes n={l.subagentes} clave={l.id} /> : null}
          {app && !l.vivo && !l.caido ? <span className="tenue">{tr("lider.dormido")}</span> : null}
          {l.caido ? <span className={l.caido === "murio" ? "c-fallo" : "tenue"} title={l.motivo}>{tr(l.caido === "murio" ? "estado.fallo" : "lider.cerrado")}</span> : null}
        </div>
      ) : null}
      <div
        className="conv-zona"
        ref={zona}
        data-vacia={!l && !items.length ? "" : undefined}
        onWheel={() => soltarScroll(clave)}
        onPointerDown={() => soltarScroll(clave)}
        onKeyDown={() => soltarScroll(clave)}
        onScroll={(e) => {
          if (sid && pag) anotarScroll(clave, e.currentTarget);
          if (e.currentTarget.scrollTop < MARGEN_PAGINA) anterior();
        }}
        {...soltable}
      >
        <div className="conv" ref={conv} data-desliza onPointerOver={sobreMensaje} onPointerLeave={sobreMensaje}>
          {pag && pag.desde > 0 ? <div className="conv-mas">{tr("vista.anteriores")}</div> : null}
          {sid && !pag && !error && !items.length ? <Leyendo /> : null}
          <GastoSubagentesCtx.Provider value={ctxGasto}>
            <CarpetaDelChat.Provider value={l?.cwd ?? null}>
              <Mensajes
                items={items}
                ultimoTurno={ultimoTurno}
                ultimoLimite={ultimoLimite}
                alSeguir={l && !ocupado ? abrirSeguir : undefined}
                app={app}
                ocupado={ocupado}
                pasando={pasando}
                pensando={app && ocupado && vivo.ind.hace?.que === "pensando"}
                fin={app && !ocupado ? vivo.fin : null}
                razon={app && piensa}
                relevo={relevo}
                sigue={sigue}
                nombre={l?.nombre}
                alAbrirLider={alAbrirLider}
                alAbrirHilo={alAbrirHilo}
                integrar={integrar}
                acciones={acciones}
                editar={editar}
                guardar={guardarArchivo}
                sid={sid}
                puntos={puntos}
                alVolverPunto={alVolverPunto}
              />
            </CarpetaDelChat.Provider>
          </GastoSubagentesCtx.Provider>
          {volver ? (
            <div className="am-volvio">
              <span>{tr("acciones.volvio")}</span>
              <button type="button" onClick={() => setVolver(null)}>
                {tr("acciones.deshacer")}
              </button>
            </div>
          ) : null}
          {!l && !items.length ? (
            <div className="conv-vacia" data-ido={partio ? "" : undefined}>
              {tr("lider.vacio")}
            </div>
          ) : null}
          <Avisos avisos={errorEnTarjeta ? avisos.filter((a) => !cuentaFallo(a)) : avisos} {...propsAvisos} />
          {pasando ? <Pasando /> : app && sid ? <HaceChat sid={sid} piensa={piensa} modelo={nombreModelo(modeloDe(l?.modelo) ?? modelo)} effort={effortsDe(l?.modelo ?? modelo).length ? (l?.effort ?? effort) : null} error={errorEnTarjeta ? <Avisos avisos={avisos.filter(cuentaFallo)} {...propsAvisos} /> : null} /> : compacta !== null ? <Compactando desde={compacta} /> : null}
          {error ? (
            <div className="lista-aviso" data-error="" role="alert">
              {error}
            </div>
          ) : null}
        </div>
      </div>

      <motion.div
        className="caja-zona"
        data-desliza
        layout={l ? false : "position"}
        transition={quieto ? { duration: 0 } : BAJAR}
        onLayoutAnimationComplete={() => bajo.current?.()}
        {...soltable}
      >
        {app && sid ? <RevisionVista sid={sid} zona={zona} pides={vivo.pide.map((p) => p.id)} /> : null}
        {app && sid ? <TarjetaDebate sid={sid} zona={zona} /> : null}
        {app && sid ? vivo.pide.filter((p) => !p.preguntas?.length).map((p) => <PedidoPermiso key={p.id} sid={sid} p={p} revisado={trasRevision} />) : null}
        {app && sid && tandas[0] ? <PedidoPreguntas key={tandas[0].id} sid={sid} p={tandas[0]} preguntas={tandas[0].preguntas} n={1} total={tandas.length} pendientes={contarPendientes(tandas)} /> : null}
        {ajeno ? (
          <div className="caja-ajeno" data-espera={enEspera ? "" : undefined}>
            <span>{tr(enEspera ? "lider.ajenoEspera" : ocupado ? "lider.ajenoOcupado" : "lider.ajenoNota")}</span>
            {enEspera && ocupado ? (
              // Lo de siempre es esperar; cortarlo es la salida de emergencia.
              <button type="button" className="btn2" data-cortar-lider onClick={() => cola.ya(l.id, true)}>
                {tr("lider.ajenoCortarYa")}
              </button>
            ) : ventana && l.pid ? (
              <button type="button" className="btn2" data-ir-lider onClick={() => void fuente.liderIr(l.pid!).then((ok) => ok || setVentana(false))}>
                {tr("lider.ir")}
              </button>
            ) : null}
          </div>
        ) : null}
        {l ? <Bandeja key={l.id} sid={l.id} ajeno={ajeno} directo={puedeDirecto} ocupado={ocupado} ind={vivo.ind} parando={vivo.parando} alParar={app ? parar : null} alAbrirHilo={alAbrirHilo} integrar={integrar} alError={setError} /> : null}
        {l && !l.caido ? <Fondo mensajes={mensajes} /> : null}
        {puede ? (
          <div className="caja" data-arrastra={arrastra ? "" : undefined}>
            {menu.length ? (
              <div className="menu-cmd" ref={menuCmd} role="listbox" aria-label={tr("comando.menu")}>
                {menu.map((s, k) => (
                  <button
                    key={s.valor ?? s.nombre}
                    type="button"
                    role="option"
                    aria-selected={k === sel}
                    aria-disabled={s.ajeno ? true : undefined}
                    aria-current={s.actual || undefined}
                    className="cmd"
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setSel(k)}
                    onClick={() => elegirComando(s, true)}
                  >
                    <span className="cmd-m" aria-hidden="true">
                      {s.ajeno ? <Logo empresa={s.ajeno} /> : null}
                    </span>
                    {s.valor !== undefined ? (
                      <span className="cmd-n">
                        <i>/{s.nombre} </i>
                        {s.valor}
                        {s.actual ? <Check className="cmd-ya" size={12} strokeWidth={2.4} aria-label={tr("comando.actual")} /> : null}
                      </span>
                    ) : (
                      <span className="cmd-n">
                        /{s.nombre}
                        {s.args ? <i> {s.args}</i> : null}
                      </span>
                    )}
                    <span className="cmd-d">
                      {s.ajeno ? tr("comando.cambiaModelo", { empresa: s.ajeno === "google" ? "Google" : "Anthropic" }) : s.clave ? tr(s.clave) : (s.descripcion ?? "")}
                    </span>
                    {s.ajeno ? <span className="cmd-s">{tr(s.ajeno === "google" ? "comando.soloGoogle" : "comando.soloAnthropic")}</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
            {adjuntos.length ? <Adjuntos lista={adjuntos} alQuitar={(k) => quitarAdjunto(clave, k)} /> : null}
            <label className="oculto" htmlFor={id}>
              {tr("lider.label")}
            </label>
            <textarea
              id={id}
              ref={caja}
              rows={1}
              spellCheck={corrige}
              value={texto}
              readOnly={cajaSoloLectura}
              // Con el dedo, enfocar abre el teclado y tapa lo que se vino a leer: se toca la caja.
              autoFocus={!MODO.captura && !esTactil()}
              placeholder={ocupado ? tr("lider.phOcupado") : l ? tr("vista.ph") : tr("lider.ph")}
              onChange={(e) => escribir(e.target.value, e.target.selectionStart)}
              // El cursor se mueve con las flechas o el mouse, sin tecla que cambie el texto: el menú sigue al token.
              onSelect={(e) => {
                const c = e.currentTarget.selectionStart;
                if (c !== caret) {
                  setCaret(c);
                  setSel(0);
                }
              }}
              // Esc (o salir de la caja) cierra el menú; volver a la caja lo abre de nuevo.
              onFocus={() => setSinMenu(false)}
              onBlur={() => setSinMenu(true)}
              onKeyDown={tecla}
              onPaste={pegar}
            />
            {!l ? (
              <div className="caja-carpeta" data-carpeta data-guia="carpeta-auto">
                <Folder size={13} strokeWidth={2} aria-hidden />
                <span className="caja-carpeta-t">{tr("lider.carpeta")}</span>
                <Selector
                  etiqueta={tr("lider.carpeta")}
                  opciones={opcionesCarpeta}
                  valor={otraAbierta ? OTRA : opcionCarpeta}
                  alElegir={eligioCarpeta}
                  disabled={enviando}
                  enteras
                  buscar={tr("lider.carpetaBuscar")}
                  abierto={capturaBuscar}
                  busquedaInicial={capturaBuscar ? (MODO.variante === "buscar-nada" ? "zzz" : "trama") : undefined}
                />
                {otraAbierta ? (
                  <>
                    <label className="oculto" htmlFor={idCarpeta}>
                      {tr("lider.carpetaRuta")}
                    </label>
                    <input
                      id={idCarpeta}
                      type="text"
                      value={carpeta}
                      readOnly={enviando}
                      spellCheck={false}
                      autoComplete="off"
                      placeholder={tr("lider.carpetaPh")}
                      onChange={(e) => setCarpeta(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.stopPropagation();
                          caja.current?.focus();
                        }
                      }}
                    />
                    {main?.carpeta && esVentana() ? (
                      <button type="button" className="btn2" disabled={enviando} onClick={elegirCarpeta}>
                        {tr("lider.carpetaElegir")}
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
            <input
              ref={elegir}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                adjuntar(Array.from(e.currentTarget.files ?? []));
                e.currentTarget.value = "";
              }}
            />
            <div ref={barra} className="barra-c" data-nivel={nivel}>
              <button
                type="button"
                className="clip"
                aria-label={tr("adjunto.adjuntar")}
                data-tip={tr("adjunto.adjuntar")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => elegir.current?.click()}
              >
                <Paperclip size={13} strokeWidth={2} />
              </button>
              <button
                type="button"
                className="modo"
                style={{ color: ASPECTO[modo].color }}
                // Con el dedo no hay Shift+Tab, y en angosto el chip es sólo el símbolo: el tooltip dice el modo.
                data-tip={modoFijo ? tr(modoFijo) : esTactil() ? tr(ASPECTO[modo].clave) : nivel >= 1 ? `${tr(ASPECTO[modo].clave)} · Shift+Tab` : "Shift+Tab"}
                aria-disabled={modoFijo ? true : undefined}
                data-fijo={modoFijo ? "" : undefined}
                aria-label={tr("modo.tip", { modo: tr(ASPECTO[modo].clave) })}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => cambiarModo(siguienteModo(modo))}
              >
                <span aria-hidden>{ASPECTO[modo].icono === "avance" ? <FastForward size={13} strokeWidth={2} /> : <Pause size={13} strokeWidth={2} />}</span>
                <span className="modo-t">{tr(ASPECTO[modo].clave)}</span>
              </button>
              <Selector
                etiqueta={tr("comun.modelo")}
                opciones={modelosEnTurno}
                senalAbrir={senalModelo}
                pestana={proveedorLibre(MODELOS, cupos)}
                cupos={cupos}
                cuposColumnas={cuposColumnas}
                valor={modelo}
                alElegir={elegirModelo}
                confirmar={datosCambio}
                confirmando={MODO.captura === "lider-cambio-motor" && MODO.variante === "confirmar" && l ? MODELOS.find((m) => familiaDe(m.id) !== familiaDe(l.modelo))?.id : undefined}
                chip={<span className="chip" />}
                columnas
                pendiente={pend.modelo ? tr("selector.pendienteTip", { actual: nombreModelo(turnoModelo ?? modelo) }) : undefined}
                abierto={MODO.captura === "modelo" || (MODO.captura === "lider-cambio-motor" && MODO.variante === "menu")}
              />
              {/* Un modelo sin niveles (Ollama) no tiene qué elegir acá. */}
              {effortsDe(modelo).length ? (
                // El chip con el nivel; abre un deslizador con Ultracode y Fast (sólo en los modelos de Anthropic que los traen). La rueda sobre el chip lo sube o lo baja.
                <Esfuerzo
                  modelo={nombreModelo(modelo).split(" · ")[0]!}
                  niveles={effortsOpciones(modelo)}
                  valor={effort}
                  alElegir={elegirEffort}
                  pendiente={pend.effort ? tr("selector.pendienteTip", { actual: effortDe(l?.effort, turnoModelo) ?? "" }) : undefined}
                  ultracode={ultracode}
                  alUltracode={esClaudeOficial(modelo) && !esLocal(modelo) ? (v) => elegirExtra("ultracode", v) : undefined}
                  fast={fast && soportaFast(modelo)}
                  alFast={soportaFast(modelo) ? (v) => elegirExtra("fast", v) : undefined}
                  abierto={MODO.captura === "esfuerzo" || MODO.captura === "local-esfuerzo"}
                  avisoInicial={MODO.captura === "esfuerzo" && MODO.variante === "rechazo" ? tr("esfuerzo.ultracodeNo") : undefined}
                />
              ) : esOpencode(modelo) || esDsh(modelo) ? (
                // Sin niveles que elegir: la píldora sigue, apagada y diciendo por qué (así no parece que falta algo).
                <div className="pick" data-tip={tr(esOpencode(modelo) ? "effort.sinNivelesOpencodeTip" : "effort.sinNivelesTip")}>
                  <button type="button" className="pbtn" data-sin-esfuerzo disabled aria-label={`${tr("comun.esfuerzo")}: ${tr("effort.sinNiveles")}`}>
                    {tr("effort.sinNiveles")}
                  </button>
                </div>
              ) : null}
              {!l && hayVarias(maquinas) ? (
                <Selector
                  etiqueta={tr("maquina.elegir")}
                  opciones={opcionesMaquina(maquinas)}
                  valor={maquinaNueva ?? maquinas.esta.id}
                  alElegir={setMaquinaNueva}
                  disabled={enviando}
                  abierto={MODO.captura?.startsWith("maquinas-selector")}
                />
              ) : null}
              {/* Sólo Claude de esta máquina y con más de una cuenta de Claude; con un turno en curso no se cambia (vale desde el próximo mensaje). */}
              {!maquinaDe && familiaDe(modelo) === "claude" && !esLocal(modelo) ? (
                <CuentaLider valor={l ? (l.cuenta ?? "claude") : cuentaNueva} alElegir={elegirCuenta} disabled={enviando || (!!l && (ocupado || !app))} abierto={MODO.captura === "cuenta-lider"} />
              ) : null}
              {esLocal(modelo) ? <ContextoLocal modelo={modelo} abierto={MODO.captura === "local-ctx"} /> : null}
              <span className="esp" />
              {/* Lo de la derecha va junto: si la fila no entra, se parte lo de la izquierda y esto queda a la derecha de la última línea. */}
              <div className="barra-der">
              <Contexto sid={sid} modelo={modelo} vence={l?.cache_vence ?? null} abierto={MODO.captura === "contexto-abierto"} />
              {app && ocupado ? (
                <button type="button" className="btn2 caja-parar" data-quieto={sinNovedad !== null ? "" : undefined} disabled={vivo.parando} onClick={parar}>
                  {vivo.parando ? tr("accion.parando") : tr("accion.parar")}
                </button>
              ) : null}
              {/* Programar un mensaje o posponer la conversación (electron/programados.ts): sólo con un líder de esta máquina. */}
              {l && !maquinaDe ? (
                <Programar
                  sid={l.id}
                  nombre={l.nombre}
                  texto={texto}
                  conAdjuntos={adjuntos.length > 0}
                  modelo={modelo}
                  effort={effort}
                  modo={modo}
                  alProgramado={() => escribir("")}
                  abierto={MODO.captura === "programar"}
                />
              ) : null}
              <Dictar
                clave={clave}
                alError={setErrorCaja}
                alNota={setNota}
                alListo={(c) => c === clave && !esTactil() && caja.current?.focus()}
              />
              <button
                type="button"
                className="prim"
                aria-label={tr("lider.mandar")}
                data-tip="Enter"
                disabled={(!texto.trim() && !adjuntos.length) || cajaSoloLectura}
                onClick={() => ejecutar(texto)}
              >
                <ArrowUp size={14} strokeWidth={2.4} />
              </button>
              </div>
            </div>
          </div>
        ) : l?.caido ? (
          <div className="caja lider-ajeno" data-caido={l.caido}>
            <span title={l.motivo}>{tr(noRetoma ? NO_RETOMA[noRetoma] : l.caido === "murio" ? (l.otraCuenta ? "lider.otraCuenta" : "lider.caidoMurio") : "lider.caidoCerro")}</span>
            <span className="esp" />
            {/* Sólo se retoma lo que murió: lo que cerró normalmente no se ofrece. */}
            {l.caido === "murio" &&
              (sinVuelta ? (
                archivar
              ) : (
                <button type="button" className="prim" data-texto data-retomar-lider disabled={retomando} onClick={() => retomar(l.otraCuenta)}>
                  {tr(l.otraCuenta ? "lider.retomarOtraCuenta" : "lider.retomar")}
                </button>
              ))}
          </div>
        ) : (
          <div className="caja lider-ajeno">
            <span>{tr("lider.ajeno")}</span>
            <span className="esp" />
            <Contexto sid={sid} modelo={l?.modelo ?? null} vence={l?.cache_vence ?? null} />
          </div>
        )}
        {errorCaja ? <div className="caja-error" role="alert">{errorCaja}</div> : null}
        {cierreCupo ? <TarjetaCierre c={cierreCupo} /> : null}
        {ofertaCuenta ? <OfertaCuenta oferta={ofertaCuenta} alPasar={() => elegirCuenta(ofertaCuenta.otra.id)} deshabilitado={ocupado} /> : null}
        {cruceDatos ? (
          <DialogoCambio
            datos={cruceDatos}
            alSi={() => {
              elegirModelo(cruce!);
              setCruce(null);
            }}
            alNo={() => {
              setCruce(null);
              caja.current?.focus();
            }}
          />
        ) : null}
        {preguntaCache ? (
          <DialogoCache
            datos={{
              veredicto: preguntaCache.veredicto,
              nueva: !!l && familiaDe(l.modelo) === "claude",
              modeloNombre: nombreModelo(modelo),
              compactar: opcionCache,
            }}
            alElegir={elegirCache}
            alCompactar={compactarDesdeCache}
            alCancelar={() => {
              setPreguntaCache(null);
              caja.current?.focus();
            }}
          />
        ) : null}
        {seguirCon && l ? (
          <SeguirCon
            de="lider"
            opciones={modelos}
            actual={modeloDe(l.modelo)}
            alElegir={async (elegido) => {
              // Un líder nuevo con el resumen de éste como primer mensaje (lo arma el main); éste queda como está.
              const e = { texto: "", modelo: elegido, effort: effortPara(elegido, effortsLeidos() ?? {}) };
              const nuevo = await fuente.liderSeguirCon(l.id, { modelo: e.modelo, effort: e.effort });
              setSeguirCon(false);
              alCreado(nuevo, e);
              alAbrirLider?.(nuevo);
            }}
            alCerrar={() => {
              setSeguirCon(false);
              caja.current?.focus();
            }}
          />
        ) : null}
        {mcpAbierto ? <PanelMcp modelo={modelo} alCerrar={() => setMcpAbierto(false)} /> : null}
        {nota && !errorCaja ? <div className="caja-nota" role="status">{nota}</div> : null}
        {/* Las imágenes pegadas vuelven tras un reinicio sólo hasta el tope del guardado: se avisa de las que no. */}
        {esVentana() && imagenesSinGuardar(adjuntos) > 0 && !errorCaja ? (
          <div className="caja-nota" role="status">
            {tr(imagenesSinGuardar(adjuntos) === 1 ? "adjunto.sinGuardar" : "adjunto.sinGuardarVarias", { n: imagenesSinGuardar(adjuntos), max: BORRADOR_IMAGENES_MAX, mb: BORRADOR_IMAGENES_BASE64 / 1024 / 1024 })}
          </div>
        ) : null}
        {cambioCompacto.fase === "compactando" ? (
          <div className="caja-aviso" data-estado="compactando" role="status">
            <LoaderCircle className="gira" size={12} strokeWidth={2.2} aria-hidden="true" />
            <span>
              {compactoCache
                ? tr(compactoCache.compactarCon !== cambioCompacto.destino.modelo ? "aviso.compactandoSeguir" : "aviso.compactandoSeguirMismo", {
                    compactar: nombreCorto(compactoCache.compactarCon),
                    modelo: nombreCorto(cambioCompacto.destino.modelo),
                  })
                : tr("aviso.compactandoCambio", { modelo: nombreCorto(cambioCompacto.destino.modelo) })}
            </span>
          </div>
        ) : cambioCompacto.fase === "hecho" ? (
          <div className="caja-aviso" data-estado="hecho" role="status">
            <Check size={12} strokeWidth={2.2} aria-hidden="true" />
            <span>{tr("aviso.compactadoCambio", { modelo: nombreCorto(cambioCompacto.destino.modelo) })}</span>
          </div>
        ) : cambioCompacto.fase === "error" ? (
          <div className="caja-aviso" data-estado="error" role="alert">
            <TriangleAlert size={12} strokeWidth={2.2} aria-hidden="true" />
            <span>
              {compactoCache
                ? tr("aviso.compactarSeguirFallo", { motivo: cambioCompacto.motivo, modelo: nombreCorto(cambioCompacto.destino.modelo) })
                : tr("ctxp.compactarError", { motivo: cambioCompacto.motivo })}
            </span>
          </div>
        ) : cambioCompacto.fase === "vencido" ? (
          <div className="caja-aviso" data-estado="vencido" role="alert">
            <Clock size={12} strokeWidth={2.2} aria-hidden="true" />
            <span>
              {compactoCache
                ? tr("aviso.compactarSeguirVencido", { modelo: nombreCorto(cambioCompacto.destino.modelo) })
                : tr("aviso.compactarVencido")}
            </span>
          </div>
        ) : aviso && modeloAnterior ? (
          <div className="caja-aviso" role="status">
            <Reloj pintor={aviso} className="caja-aviso-t" />
            <span className="caja-aviso-acc">
              <button
                type="button"
                className="btn2 caja-aviso-b"
                onClick={() => aplicarModelo(modeloAnterior)}
              >
                <Undo2 size={12} strokeWidth={2} aria-hidden="true" />
                {tr("aviso.volver", { modelo: nombreCorto(modeloAnterior) })}
              </button>
              {app && soportaCompactar(l?.modelo) ? (
                <button
                  type="button"
                  className="btn2 caja-aviso-b"
                  onClick={compactarYCambiar}
                >
                  <Minimize2 size={12} strokeWidth={2} aria-hidden="true" />
                  {tr("aviso.compactarYCambiar")}
                </button>
              ) : null}
            </span>
          </div>
        ) : null}
        {/* Un líder local corre en la GPU de esta máquina, sin pa ni subagentes: que se sepa antes de pedirle una tarea grande. */}
        {puede && sinWorkers(modelo) ? (
          <div className="caja-local" role="status">
            <Cpu size={12} strokeWidth={2} aria-hidden="true" />
            {tr(esLocal(modelo) ? "lider.localSinWorkers" : "lider.ollamaSinWorkers")}
          </div>
        ) : null}
      </motion.div>
      {/* Debajo de la caja al medio, lo mismo que la conversación arriba: queda centrada. */}
      {alMedio ? <div className="caja-bajo" /> : null}
    </>
  );
}

/**
 * Un pedido de permiso del líder: el plan de ExitPlanMode (Aprobar vuelve a
 * bypass y sigue; Seguir planeando le dice qué cambiar) o una herramienta que
 * el modo no deja sola (Permitir / Negar).
 */
/**
 * Lo de un mensaje del usuario: imágenes y archivos arriba, después el texto. Las
 * líneas con la ruta de cada archivo (lo que recibe Claude) se ven como chips.
 */
type PropsMensajes = {
  items: Item[];
  ultimoTurno: number;
  /** El índice de la línea del último límite de uso (-1: ninguna), y qué hace «Seguir con otro modelo» ahí (`undefined`: no se ofrece). */
  ultimoLimite: number;
  alSeguir: (() => void) | undefined;
  app: boolean;
  ocupado: boolean;
  pasando: boolean;
  /** Está razonando ahora: el bloque del último turno dice "Pensando…". */
  pensando: boolean;
  /** Un motor que deja ver su razonamiento y sus comandos (Gemini). */
  razon: boolean;
  /** Cómo cerró el último turno: si terminó bien, su línea de trabajo es la tarjeta plegada. */
  fin: FinTurno | null;
  relevo: ReturnType<typeof relevoEn>;
  sigue: Lider | null;
  nombre: string | undefined;
  alAbrirLider: ((id: string) => void) | undefined;
  alAbrirHilo: ((id: string) => void) | undefined;
  integrar: IntegrarAviso | undefined;
  /** Las acciones por mensaje (Copiar, Editar, Volver acá, Ramificar); `null`: sólo Copiar. */
  acciones: Acciones | null;
  editar: (x: Extract<Item, { tipo: "yo" }>, texto: string, adjuntos: readonly Adjunto[]) => void;
  /** Guarda un archivo nuevo de un mensaje que se edita (el de la caja, con la máquina del líder). */
  guardar: (nombre: string, datos: Uint8Array) => Promise<string>;
  /** Puntos de control por turno (src/hilo/Punto.tsx): los de la conversación `sid`, y qué hacer tras volver atrás. */
  sid: string;
  puntos: PuntoControl[];
  alVolverPunto: () => void;
};

/** Los avisos que cuentan por qué falló el turno: van adentro de la tarjeta, no sueltos arriba. */
const cuentaFallo = (a: AvisoVisto) => a.clase === "error" || a.clase === "salio";

/**
 * La conversación. Aparte de la caja para que cada tecla no la recorra entera: lo que se escribe es estado de `ChatLider`, y con
 * 3000 mensajes volver a armarlos en cada letra tardaba más de 50 ms. Sólo se repinta cuando cambian los mensajes o el turno.
 */
const Mensajes = memo(function Mensajes({ items, ultimoTurno, ultimoLimite, alSeguir, app, ocupado, pasando, pensando, razon, fin, relevo, sigue, nombre, alAbrirLider, alAbrirHilo, integrar, acciones, editar, guardar, sid, puntos, alVolverPunto }: PropsMensajes) {
  return (
    <>
      {items.map((x, i) =>
        x.tipo === "yo" ? (
          <YoEditable key={x.key} x={x} acciones={acciones} editar={editar} guardar={guardar} />
        ) : x.tipo === "sistema" ? (
          <Fragment key={x.key}>
            <Marca k={x.key} />
            <Sistema s={x.s} nombre={nombre} alAbrirHilo={alAbrirHilo} alSeguir={i === ultimoLimite ? alSeguir : undefined} integrar={integrar} />
            {/* Un worker suyo que terminó puede haber dejado una DECISION o un PROBAR en el tablero. */}
            {x.s.tipo === "linea" && x.s.clase === "aviso" ? <DejadoTablero refs={dejadosDeAviso(x.s.aviso)} /> : null}
          </Fragment>
        ) : (
          <Fragment key={x.key}>
            <Marca k={x.key} />
            {/* Uno de la app dice qué hace abajo (HaceChat); uno de terminal, "Trabajando X s" en su turno. */}
            <Turno t={x} vivo={!app && ocupado && i === ultimoTurno && !pasando} enCurso={ocupado && i === ultimoTurno} pensando={pensando && i === ultimoTurno} razon={razon} fin={i === ultimoTurno && fin && fin.estado !== "error" ? { estado: fin.estado, dura: fin.dura } : undefined} />
            {app && !(ocupado && i === ultimoTurno) ? <PuntoDelTurno sid={sid} puntos={puntos} desde={x.desde} ocupado={ocupado} alVolver={alVolverPunto} /> : null}
            {x.texto && !(ocupado && i === ultimoTurno) ? <AccionesMensaje texto={x.texto} punto={x.punto} propio={false} acciones={acciones} /> : null}
            {/* Lo que este turno dejó en el tablero para la persona (`tablero agregar` que devolvió su id). */}
            {x.dejados ? <DejadoTablero refs={x.dejados} /> : null}
            {relevo?.hecho && relevo.k === i ? (
              <Sigue nombre={sigue?.nombre ?? nombre ?? null} alAbrir={sigue && alAbrirLider ? () => alAbrirLider(sigue.id) : null} />
            ) : null}
          </Fragment>
        ),
      )}
    </>
  );
});

/** El punto de control del turno que empezó en `desde`, si lo hay y tocó algo (si no, no se ve nada). */
function PuntoDelTurno({ sid, puntos, desde, ocupado, alVolver }: { sid: string; puntos: PuntoControl[]; desde: number | null; ocupado: boolean; alVolver: () => void }) {
  const p = puntoDeTurno(puntos, desde);
  return p && p.terminado && p.archivos.length ? <PuntoTurno sid={sid} punto={p} puntos={puntos} ocupado={ocupado} alVolver={alVolver} /> : null;
}

/** La captura `lider-editar`: el pedido ya abierto para editar (ver `charlaEditar` en datos/fuente.ts). */
const EDITANDO_CAPTURA = MODO.captura === "lider-editar";
/** Un pedido del usuario; Editar lo cambia por un campo en su mismo lugar. */
const YoEditable = memo(function YoEditable({ x, acciones, editar, guardar }: { x: Extract<Item, { tipo: "yo" }>; acciones: Acciones | null; editar: PropsMensajes["editar"]; guardar: PropsMensajes["guardar"] }) {
  useIdioma();
  const [editando, setEditando] = useState(EDITANDO_CAPTURA);
  const { texto: sinArchivos, archivos } = separarAdjuntos(x.texto);
  // El mensaje con la revisión de un plan (lo mandó la app, no la persona): tarjeta del revisor, no globo propio.
  const revision = leerMensajeRevision(x.texto);
  if (revision)
    return (
      <Fragment>
        <Marca k={x.key} />
        <TarjetaRevision r={revision} />
      </Fragment>
    );
  // La conclusión de un debate entre modelos: también tarjeta, no globo de la persona.
  const debate = leerMensajeDebate(x.texto);
  if (debate)
    return (
      <Fragment>
        <Marca k={x.key} />
        <TarjetaConclusionDebate d={debate} />
      </Fragment>
    );
  return (
    <Fragment>
      <Marca k={x.key} />
      {/* En cola: mandado a mitad de un turno, el modelo todavía no lo recibió. Se ve apagado y dice "en cola" (no sólo el color). */}
      <div className={x.enCola ? "yo encolado" : "yo"} data-editando={editando ? "" : undefined} data-en-cola={x.enCola ? "" : undefined}>
        {editando ? (
          <EditorMensaje
            inicial={sinArchivos}
            previos={[...(x.imagenes ?? []), ...archivos]}
            guardar={guardar}
            alCancelar={() => setEditando(false)}
            alEnviar={(v, adjuntos) => {
              setEditando(false);
              editar(x, v, adjuntos);
            }}
          />
        ) : (
          <>
            {x.enCola ? (
              <div className="encolado-t" role="status">
                <Clock size={12} strokeWidth={2} aria-hidden="true" />
                <span>{tr("lider.enCola")}</span>
              </div>
            ) : null}
            <Yo texto={x.texto} imagenes={x.imagenes} />
          </>
        )}
      </div>
      {x.ts !== null && !editando ? <Hora ts={x.ts} der /> : null}
      {!editando ? <AccionesMensaje texto={sinArchivos} punto={x.punto} propio acciones={acciones} alEditar={() => setEditando(true)} /> : null}
    </Fragment>
  );
});

const Yo = memo(function Yo({ texto, imagenes }: { texto: string; imagenes?: readonly Imagen[] }) {
  const { texto: t, archivos } = separarAdjuntos(texto);
  return (
    <>
      {imagenes?.length || archivos.length ? <Miniaturas imagenes={imagenes ?? []} archivos={archivos} /> : null}
      {t.trim() ? <Texto texto={t} propio /> : null}
    </>
  );
});

function PedidoPermiso({ sid, p, revisado = false }: { sid: string; p: Pedido; revisado?: boolean }) {
  const corrige = useCorrector();
  const [planear, setPlanear] = useState(false);
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const plan = p.herramienta === "ExitPlanMode";
  const [mandando, setMandando] = useState(false);
  // «Revisar con otro modelo»: el selector de revisor (sólo Claude o Gemini no desactivados en Ajustes).
  const [revisando, setRevisando] = useState(plan && ((MODO.captura === "lider-plan" && MODO.variante === "revisar") || MODO.captura === "lider-revision-sin-sesion"));
  const [revisores, setRevisores] = useState<string[] | "fallo" | null>(null);
  const tablaModelos = useModelosVivos();
  const opciones = useMemo(() => Array.isArray(revisores) ? MODELOS.filter((m) => revisores.includes(m.id)) : [], [revisores, tablaModelos]);
  // Lo que Ajustes > Modelos dejó prendido por modelo: de ahí salen los esfuerzos que se ofrecen (los apagados no).
  const [permitidos, setPermitidos] = useState<PermitidosAjustes>(null);
  const esfuerzos = useCallback((m: string) => esfuerzosDeRevisor(m, permitidos), [permitidos, tablaModelos]);
  // Los dos hooks siempre, en el mismo orden: con `||` el segundo se salteaba al arrancar la revisión y React se rompía.
  const revision = useRevision(sid);
  const debate = useDebate(sid);
  const enRevision = revisionViva(revision.estado) || debateVivo(debate);
  // Si un debate acaba de terminar con conclusión, el plan nuevo llega con «Qué se acordó» y sus dos salidas (frena la aprobación hasta que se lea).
  const acuerdo = plan && debate ? resumenDebate(debate) : null;
  useEffect(() => {
    if (!revisando) return;
    let vivo = true;
    void fuente.liderRevisores(MODELOS.map((m) => m.id)).then(
      (ids) => vivo && setRevisores(ids),
      () => {
        if (!vivo) return;
        setRevisores("fallo");
        setRevisando(false);
      },
    );
    void fuentePaneles.modelos().then((r) => vivo && setPermitidos(r.config.efforts_permitidos ?? null), () => {});
    return () => {
      vivo = false;
    };
  }, [revisando]);
  // La tarjeta se va recién cuando el main contesta; si falla, se queda y dice por qué.
  const contestar = (ok: boolean, msj?: string) => {
    if (mandando) return;
    setMandando(true);
    fuente
      .liderPermiso(sid, p.id, ok, msj)
      .then(() => {
        if (ok && plan) ponerModo(sid, MODO_DEFAULT);
        if (acuerdo) limpiarDebate(sid);
        contestado(sid, p.id);
      })
      .catch((e) => {
        setMandando(false);
        setError(mensaje(e));
      });
  };
  const seguir = () => contestar(false, nota.trim() || undefined);
  const tecla = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      seguir();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setPlanear(false);
    }
  };
  return (
    <div className="pide" data-plan={plan ? "" : undefined} data-revisado={plan && revisado ? "" : undefined}>
      <div className="pide-t">
        {plan && revisado ? <ScanSearch size={14} strokeWidth={2.2} aria-hidden="true" /> : null}
        {plan ? tr(revisado ? "plan.tituloRevisado" : "plan.titulo") : tr("permiso.titulo", { herramienta: p.herramienta })}
      </div>
      {plan ? (
        <div className="pide-plan el">
          <Texto texto={p.plan ?? ""} />
        </div>
      ) : p.detalle ? (
        <pre className="pide-detalle">{p.detalle}</pre>
      ) : null}
      {acuerdo ? <QueSeAcordo r={acuerdo} ocupado={mandando || planear} alSeguir={() => setPlanear(true)} alAprobar={() => contestar(true)} /> : null}
      {planear ? (
        <div className="pide-nota">
          <textarea
            rows={1}
            autoFocus
            spellCheck={corrige}
            value={nota}
            placeholder={tr("plan.notaPh")}
            aria-label={tr("plan.seguir")}
            onChange={(e) => setNota(e.target.value)}
            onKeyDown={tecla}
          />
          <button type="button" className="prim" aria-label={tr("plan.mandarNota")} data-tip="Enter" disabled={mandando} onClick={seguir}>
            <ArrowUp size={14} strokeWidth={2.4} />
          </button>
        </div>
      ) : null}
      {planear ? (
        <div className="pide-b">
          <button type="button" className="btn2" disabled={mandando} onClick={() => setPlanear(false)}>
            {tr("plan.volver")}
          </button>
          <button type="button" className="prim" data-texto="" disabled={mandando} onClick={() => contestar(true)}>
            {tr("plan.aprobar")}
          </button>
        </div>
      ) : acuerdo ? null : (
        <div className="pide-b">
          <button type="button" className="prim" data-texto="" disabled={mandando} onClick={() => contestar(true)}>
            {plan ? tr("plan.aprobar") : tr("permiso.permitir")}
          </button>
          <button type="button" className="btn2" disabled={mandando} onClick={() => (plan ? setPlanear(true) : contestar(false))}>
            {plan ? tr("plan.seguir") : tr("permiso.negar")}
          </button>
          {plan ? (
            <button type="button" className="btn2" disabled={mandando || enRevision} data-tip={tr("plan.revisarTip")} onClick={() => {
              setRevisores(null);
              setRevisando(true);
            }}>
              <ScanSearch size={14} strokeWidth={2} aria-hidden="true" />
              {tr("plan.revisar")}
            </button>
          ) : null}
        </div>
      )}
      {error ? <div className="caja-error" role="alert">{error}</div> : null}
      {revisores === "fallo" ? <div className="caja-error" role="alert">{tr("plan.revisoresFallo")}</div> : null}
      {revisando && Array.isArray(revisores) ? (
        <SeguirCon
          de="revisar"
          opciones={opciones}
          actual={null}
          preferido={REVISOR_DEFECTO}
          busquedaInicial={MODO.captura === "lider-revision-sin-sesion" ? "ge" : undefined}
          esfuerzos={esfuerzos}
          alElegir={async (elegido, effort) => {
            // El main arranca al revisor y vuelve enseguida: el progreso se ve en el modal y, si se cierra, en el chat (RevisionVista).
            // Al terminar, el main le niega el plan al líder y le entrega la revisión por su cola; la tarjeta llega por el transcript.
            await fuente.liderRevisarPlan(sid, p.id, { modelo: elegido, effort: effort ?? esfuerzos(elegido).defecto, nombre: nombreModelo(elegido) });
            setRevisando(false);
            modalRevision(sid, true);
          }}
          alDebatir={async ({ participantes, rondas }) => {
            // Igual que la revisión simple: el main arranca el debate y vuelve enseguida; se sigue en la tarjeta del chat (TarjetaDebate).
            // Al terminar, el líder recibe el plan negado y la conclusión por su cola.
            const estado = await fuente.liderDebatirPlan(sid, p.id, { participantes: participantes.map((x) => ({ ...x, nombre: nombreModelo(x.modelo) })), rondas });
            ponerDebate(estado);
            setRevisando(false);
          }}
          alCerrar={() => setRevisando(false)}
        />
      ) : null}
    </div>
  );
}
