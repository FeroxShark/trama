// Modo debate entre modelos (etapa 2), el moderador: lleva el estado del debate y corre los turnos de a uno (nunca en paralelo: cada
// uno lee lo que dijeron los anteriores), de 1 a 3 rondas, con tope de 3 turnos por modelo; corta antes si coinciden del todo, saca a
// un modelo que falla, pausa cuando alguien le pregunta algo a Ferox y, al final, pide una conclusión conjunta a quien tenga más cupo y
// se la entrega al líder (el plan pendiente se niega y la conclusión llega por la cola, como la revisión de la etapa 1).
// Sin Electron ni procesos: lo que toca el sistema (correr el modelo, el transcript, el permiso, avisar a la ventana) entra por
// `DepsDebate`, igual que `DepsRevision` en revision-plan.ts: tests/debate.test.ts lo prueba con modelos simulados. Un turno es una
// llamada de `correrRevisor` (una sola vez, por suscripción, nunca una clave de API). Diseño: docs/modo-debate-diseno.md.
import { errorT } from "./errores.ts";
import {
  acuerdoTotal,
  mensajeDebateParaLider,
  parsearConclusion,
  parsearTurno,
  PARTICIPANTES_MAX,
  PARTICIPANTES_MIN,
  PREGUNTA_ESPERA_MS,
  promptConclusion,
  promptTurno,
  RONDAS_DEFECTO,
  RONDAS_MAX,
  RONDAS_MIN,
  textoDeTurno,
  TURNOS_MAX_POR_MODELO,
  type DebateVista,
  type DichoDebate,
  type EstadoDebate,
  type EventoDebate,
  type LineaDebate,
  type MotivoDebate,
  type Participante,
  type RespuestaDebate,
  type TurnoLeido,
} from "./debate-texto.ts";
import { entregarGuardada, PLAN_MAX, revisarPlan, type DepsRevision, type OpcionesCorrida } from "./revision-plan.ts";
import { sinComillas, type RevisionVista } from "./revision-plan-texto.ts";

export * from "./debate-texto.ts";

/** Lo que el moderador necesita del resto del sistema: lo mismo que `revisarPlan` más cómo avisar a la ventana y cómo ordenar por cupo. */
export type DepsDebate = Omit<DepsRevision, "guardar" | "alEntregar"> & {
  /** Avisa de cada línea nueva y de cada cambio de estado (el evento `debate:turno`). */
  avisar: (e: EventoDebate) => void;
  /** El cupo libre de un modelo (más = mejor; `null`: no se sabe). Ordena quién habla primero y quién concluye; sin esto, el orden en que se eligieron. */
  cupo?: (modelo: string) => number | null;
  /** Lo que el modelo va haciendo en su turno (pasos y texto vivo). */
  avance?: (modelo: string, a: Parameters<OpcionesCorrida["avance"]>[0]) => void;
  /** Guarda la conclusión (o la revisión simple) en disco hasta que se entregue (un fallo de entrega no la pierde). */
  guardar?: (mensaje: string, r: RevisionVista | DebateVista) => Promise<void>;
  /** Avisa que la conclusión salió y que empieza a entregarse. */
  alEntregar?: (r: RevisionVista | DebateVista) => void;
  /** Reloj (epoch ms), para los tests. */
  ahora?: () => number;
};

/** Cómo terminó: la conclusión entregada (`vista`) o, si quedó un solo modelo, la revisión simple (`revision`). */
export type ResultadoDebate = { motivo: MotivoDebate; vista: DebateVista | null; revision: RevisionVista | null; estado: EstadoDebate };

/** Lo que la ventana maneja de un debate en marcha. */
export type Debate = {
  id: string;
  /** Una copia del estado de ahora. */
  estado: () => EstadoDebate;
  /**
   * Ferox contesta la pregunta pendiente: una de sus opciones, o `null` para «Elegí vos» (que decidan ellos). `false` si no hay pregunta
   * pendiente o la opción no es una de las suyas.
   */
  responder: (respuesta: string | null) => boolean;
  /** «Cortar y concluir»: se corta el turno en curso (sin contarlo) y quien tenga más cupo concluye con lo dicho hasta ahí. */
  cortar: () => void;
  /** «Cancelar»: no se le manda nada al líder (el plan sigue pendiente) y `terminado` rechaza. */
  cancelar: () => void;
  /** Termina con el resultado, o rechaza si se canceló o falló algo (el estado queda con `fase` `cancelado` o `fallo`). */
  terminado: Promise<ResultadoDebate>;
};

export type OpcionesDebate = { id?: string; esperaPreguntaMs?: number };

let secuencia = 0;

/** Quién es el último en pie: lo mismo que `Participante` pero con su nombre, sus turnos y si sigue. */
type Estado = { modelo: string; effort: string; nombre: string; turnos: number; activo: boolean };

/**
 * Arranca un debate sobre un plan. Valida sin esperar (rechaza con el motivo si el plan está vacío o es larguísimo, o si no son 2 o 3
 * modelos distintos) y devuelve enseguida el manejo del debate; el trabajo sigue solo y avisa por `d.avisar`.
 */
export function iniciarDebate(x: { sid: string; plan: string; participantes: readonly Participante[]; rondas?: number }, d: DepsDebate, o: OpcionesDebate = {}): Debate {
  const plan = x.plan.trim();
  if (!plan) throw errorT("main.revisionSinPlan");
  if (plan.length > PLAN_MAX) throw errorT("main.revisionPlanLargo");
  const unicos = [...new Map(x.participantes.map((p) => [p.modelo, p])).values()];
  if (unicos.length < PARTICIPANTES_MIN || unicos.length > PARTICIPANTES_MAX) throw errorT("main.debateParticipantes", { min: PARTICIPANTES_MIN, max: PARTICIPANTES_MAX });
  const rondas = Math.min(RONDAS_MAX, Math.max(RONDAS_MIN, Math.trunc(x.rondas ?? RONDAS_DEFECTO) || RONDAS_DEFECTO));
  const ahora = () => d.ahora?.() ?? Date.now();
  const esperaMs = o.esperaPreguntaMs ?? PREGUNTA_ESPERA_MS;
  const id = o.id ?? `debate-${Date.now().toString(36)}-${++secuencia}`;

  // El orden en que hablan: el de más cupo primero (a igualdad, el orden en que Ferox los eligió).
  const orden: Estado[] = unicos
    .map((p, i) => ({ p, i, c: d.cupo?.(p.modelo) ?? -1 }))
    .sort((a, b) => b.c - a.c || a.i - b.i)
    .map(({ p }) => ({ modelo: p.modelo, effort: p.effort, nombre: d.nombre(p.modelo), turnos: 0, activo: true }));
  const nombres = orden.map((p) => p.nombre);

  const st: EstadoDebate = { id, sid: x.sid, rondas, ronda: 0, fase: "corriendo", participantes: [], lineas: [], pregunta: null, motivo: null, error: null, inicio: ahora(), fin: null };
  const copia = (): EstadoDebate => ({
    ...st,
    participantes: orden.map((p) => ({ modelo: p.modelo, nombre: p.nombre, effort: p.effort, turnos: p.turnos, activo: p.activo })),
    lineas: [...st.lineas],
    pregunta: st.pregunta ? { ...st.pregunta, opciones: [...st.pregunta.opciones] } : null,
  });
  const emitir = (linea: LineaDebate | null) => {
    try {
      d.avisar({ estado: copia(), linea });
    } catch {}
  };
  const sumar = (l: Partial<LineaDebate> & Pick<LineaDebate, "tipo" | "modelo" | "nombre" | "ronda">) => {
    const linea: LineaDebate = { n: st.lineas.length + 1, postura: null, argumento: "", plan: null, pregunta: null, error: null, ...l };
    st.lineas.push(linea);
    emitir(linea);
    return linea;
  };

  const cancelada = new AbortController();
  const cortada = new AbortController();
  let pendiente: { opciones: string[]; resolver: (r: RespuestaDebate | "cortado") => void } | null = null;

  const responder = (r: string | null): boolean => {
    if (!pendiente || (r !== null && !pendiente.opciones.includes(r))) return false;
    pendiente.resolver(r);
    return true;
  };
  const cortar = () => {
    if (st.fase === "hecho" || st.fase === "cancelado" || st.fase === "fallo" || cortada.signal.aborted) return;
    cortada.abort();
    pendiente?.resolver("cortado");
  };
  const cancelar = () => {
    if (st.fase === "hecho" || st.fase === "cancelado" || st.fase === "fallo") return;
    cancelada.abort();
  };
  const alCancelar = (): never => {
    throw errorT("main.debateCancelado");
  };

  /** Espera la respuesta de Ferox a una pregunta (o que pase el plazo, o que se corte el debate). */
  const esperar = (opciones: string[]) =>
    new Promise<RespuestaDebate | "cortado">((ok, no) => {
      const fin = () => {
        clearTimeout(t);
        cancelada.signal.removeEventListener("abort", abortar);
        pendiente = null;
      };
      const abortar = () => {
        fin();
        no(errorT("main.debateCancelado"));
      };
      const t = setTimeout(() => {
        fin();
        ok("sin-respuesta");
      }, esperaMs);
      pendiente = {
        opciones,
        resolver: (r) => {
          fin();
          ok(r);
        },
      };
      if (cancelada.signal.aborted) abortar();
      else cancelada.signal.addEventListener("abort", abortar, { once: true });
    });

  /** Una llamada a un modelo, cortable por «Cancelar» y (si `conCorte`) por «Cortar y concluir». Devuelve su texto, `null` si se cortó. */
  const llamar = async (p: Estado, prompt: string, conCorte: boolean): Promise<string | null> => {
    // La señal del turno: se dispara con «Cancelar» y, si `conCorte`, también con «Cortar y concluir» (un controlador propio, no
    // `AbortSignal.any`, que Node puede soltar con el turno en vuelo).
    const propio = new AbortController();
    const cortarTurno = () => propio.abort();
    cancelada.signal.addEventListener("abort", cortarTurno, { once: true });
    if (conCorte) cortada.signal.addEventListener("abort", cortarTurno, { once: true });
    if (cancelada.signal.aborted || (conCorte && cortada.signal.aborted)) propio.abort();
    const señal = propio.signal;
    try {
      const salida = (await d.correr(p.modelo, p.effort, prompt, { avance: (a) => d.avance?.(p.modelo, a), señal })).trim();
      if (cancelada.signal.aborted) alCancelar();
      if (conCorte && cortada.signal.aborted) return null;
      if (!salida) throw errorT("main.revisionVacia", { v: p.nombre });
      return salida;
    } catch (e) {
      if (cancelada.signal.aborted) alCancelar();
      if (conCorte && cortada.signal.aborted) return null;
      throw e;
    } finally {
      cancelada.signal.removeEventListener("abort", cortarTurno);
      cortada.signal.removeEventListener("abort", cortarTurno);
    }
  };

  const correrTodo = async (): Promise<ResultadoDebate> => {
    const pedido = await d.pedidoOriginal();
    const archivos = d.archivos ? await d.archivos(plan).catch(() => []) : [];
    const cwd = d.cwd();
    const dicho: DichoDebate[] = [];
    const vivos = () => orden.filter((p) => p.activo);
    let motivo: MotivoDebate = "tope";
    let solo: Estado | null = null;

    debate: for (let ronda = 1; ronda <= rondas; ronda++) {
      st.ronda = ronda;
      emitir(null);
      const deLaRonda: TurnoLeido[] = [];
      let preguntada = false;
      for (const p of [...orden]) {
        if (cortada.signal.aborted) break debate;
        if (!p.activo || p.turnos >= TURNOS_MAX_POR_MODELO) continue;
        const prompt = promptTurno({
          plan,
          pedido,
          cwd,
          archivos,
          dicho,
          nombre: p.nombre,
          otros: vivos().filter((q) => q !== p).map((q) => q.nombre),
          ronda,
          rondas,
          puedePreguntar: !preguntada,
        });
        let salida: string | null;
        try {
          salida = await llamar(p, prompt, true);
        } catch (e) {
          if (cancelada.signal.aborted) throw e;
          // Un modelo que falla (sin cupo, error, vacío) sale del debate con una línea visible; los demás siguen.
          p.activo = false;
          sumar({ tipo: "fallo", modelo: p.modelo, nombre: p.nombre, ronda, error: (e as Error).message });
          if (vivos().length === 0) throw errorT("main.debateSinModelos");
          if (vivos().length === 1) {
            solo = vivos()[0]!;
            break debate;
          }
          continue;
        }
        if (salida === null) break debate;
        p.turnos++;
        const leido = parsearTurno(salida);
        const pregunta = leido.pregunta && !preguntada ? leido.pregunta : null;
        // Una pregunta por ronda como mucho: la segunda se ignora (y el turno cuenta como un cambio, no como una pausa).
        const turno: TurnoLeido = { ...leido, pregunta, postura: leido.pregunta && !pregunta ? "cambio" : leido.postura };
        deLaRonda.push(turno);
        dicho.push({ quien: p.nombre, ronda, texto: textoDeTurno(turno) });
        sumar({ tipo: "turno", modelo: p.modelo, nombre: p.nombre, ronda, postura: turno.postura, argumento: turno.argumento || turno.libre || "", plan: turno.plan, pregunta });
        if (leido.pregunta && !pregunta) sumar({ tipo: "nota", modelo: "", nombre: "", ronda, clave: "debate.notaOtraPregunta", vars: { v: p.nombre } });
        if (!pregunta) continue;

        preguntada = true;
        st.fase = "esperando";
        st.pregunta = { modelo: p.modelo, nombre: p.nombre, ronda, texto: pregunta.texto, opciones: pregunta.opciones, hasta: ahora() + esperaMs };
        emitir(null);
        let r: RespuestaDebate | "cortado";
        try {
          r = await esperar(pregunta.opciones);
        } finally {
          st.pregunta = null;
          st.fase = "corriendo";
        }
        if (r === "cortado") break debate;
        if (r === "sin-respuesta") {
          dicho.push({ quien: "Ferox", ronda, texto: "No contestó a tiempo: se siguió sin su respuesta." });
          sumar({ tipo: "nota", modelo: "", nombre: "", ronda, clave: "debate.sinRespuesta", vars: { min: Math.round(esperaMs / 60_000) } });
        } else if (r === null) {
          dicho.push({ quien: "Ferox", ronda, texto: "Dejó que decidan ustedes." });
          sumar({ tipo: "nota", modelo: "", nombre: "Ferox", ronda, clave: "debate.feroxElegiVos" });
        } else {
          dicho.push({ quien: "Ferox", ronda, texto: r });
          sumar({ tipo: "ferox", modelo: "", nombre: "Ferox", ronda, argumento: r });
        }
      }
      const acuerdo = acuerdoTotal(deLaRonda);
      if (acuerdo) {
        motivo = "acuerdo";
        break;
      }
    }
    if (cortada.signal.aborted && !solo) motivo = "cortado";

    // Quedó un solo modelo: el debate pasa a ser una revisión simple (la de la etapa 1, con ese modelo).
    if (solo) {
      st.fase = "concluyendo";
      st.motivo = "simple";
      emitir(null);
      const revision = await revisarPlan({ modelo: solo.modelo, effort: solo.effort, plan }, { ...d, nombre: () => solo!.nombre }, { avance: (a) => d.avance?.(solo!.modelo, a), señal: cancelada.signal });
      return { motivo: "simple", vista: null, revision, estado: copia() };
    }

    // La conclusión la escribe quien tenga más cupo (el primero de los que siguen); si falla, el siguiente.
    st.fase = "concluyendo";
    st.motivo = motivo;
    emitir(null);
    const ordenados = vivos();
    let conclusion: ReturnType<typeof parsearConclusion> | null = null;
    for (const p of ordenados) {
      const prompt = promptConclusion({ plan, pedido, cwd, archivos, dicho, nombre: p.nombre, participantes: nombres });
      try {
        const salida = await llamar(p, prompt, false);
        if (salida) {
          conclusion = parsearConclusion(salida);
          break;
        }
      } catch (e) {
        sumar({ tipo: "fallo", modelo: p.modelo, nombre: p.nombre, ronda: st.ronda, error: (e as Error).message });
      }
    }
    if (!conclusion) throw errorT("main.debateSinConclusion");
    const vista: DebateVista = { ...conclusion, modelos: ordenados.map((p) => p.modelo), nombres: ordenados.map((p) => p.nombre), motivo: motivo as DebateVista["motivo"], rondas: st.ronda };
    sumar({ tipo: "conclusion", modelo: ordenados[0]?.modelo ?? "", nombre: ordenados[0]?.nombre ?? "", ronda: st.ronda, argumento: conclusion.libre ?? conclusion.acuerdos, plan: conclusion.plan || null });

    st.fase = "entregando";
    emitir(null);
    const mensaje = mensajeDebateParaLider(vista);
    await d.guardar?.(mensaje, vista);
    d.alEntregar?.(vista);
    // El plan se niega sólo si sigue pendiente (lo decide `negar`); el líder recibe la conclusión por su cola.
    d.negar(`La persona pidió que ${nombres.map(sinComillas).join(", ")} debatieran tu plan. La conclusión llega en el próximo mensaje: no ejecutes nada hasta integrarla y presentar el plan remasterizado con ExitPlanMode.`);
    await entregarGuardada(mensaje, d);
    return { motivo, vista, revision: null, estado: copia() };
  };

  const terminado = correrTodo().then(
    (r) => {
      st.fase = "hecho";
      st.motivo = r.motivo;
      st.fin = ahora();
      emitir(null);
      return { ...r, estado: copia() };
    },
    (e: unknown) => {
      st.fase = cancelada.signal.aborted ? "cancelado" : "fallo";
      st.error = cancelada.signal.aborted ? null : (e as Error).message;
      st.pregunta = null;
      st.fin = ahora();
      emitir(null);
      throw e;
    },
  );
  // Quien no espere `terminado` no se lleva un rechazo sin atender: el estado ya dice cómo terminó.
  terminado.catch(() => {});
  return { id, estado: copia, responder, cortar, cancelar, terminado };
}
