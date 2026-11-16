// Los debates de plan en curso («Revisar con otro modelo» en modo debate), uno por líder: arrancar (el moderador de debate.ts corre
// solo y avisa de cada turno), contestar su pregunta, «Cortar y concluir», «Cancelar» y el estado que ve una ventana recién abierta.
// Sin Electron: lo que toca el sistema (validar el plan y los modelos, armar los corredores, entregar por la cola) entra por
// `DepsDebates.preparar`, y lo prueba tests/debate-trabajo.test.ts con modelos simulados. Lo arma lider.ts; el aviso es `debate:turno`.
import { errorT } from "./errores.ts";
import { iniciarDebate, type Debate, type DepsDebate, type EstadoDebate, type EventoDebate, type OpcionesDebate, type Participante } from "./debate.ts";

/** Lo que el sistema prepara para un debate: el plan que dijo el líder y sus dependencias (sin el aviso, que lo pone `crearDebates`). */
export type PreparacionDebate = { plan: string; deps: Omit<DepsDebate, "avisar"> };

export type DepsDebates = {
  /** Cada línea nueva y cada cambio de estado de cualquier debate (el evento `debate:turno`). */
  avisar: (e: EventoDebate) => void;
  /**
   * Valida el pedido y arma lo que toca el sistema. Rechaza con el motivo (ya traducible) si el plan no está pendiente, si un modelo no
   * sirve o su esfuerzo está apagado, o si ya hay una revisión corriendo en ese líder.
   */
  preparar: (x: { sid: string; id: string; participantes: readonly Participante[] }) => Promise<PreparacionDebate>;
};

const VIVAS = ["corriendo", "esperando", "concluyendo", "entregando"];

export function crearDebates(d: DepsDebates) {
  /** El último debate de cada líder: el que corre, o cómo terminó hasta que se lo descarta. */
  const debates = new Map<string, { debate: Debate; estado: EstadoDebate }>();
  const viva = (sid: string) => VIVAS.includes(debates.get(sid)?.estado.fase ?? "");

  return {
    /** Arranca un debate y devuelve su estado enseguida (el trabajo sigue solo y avisa por `avisar`). Uno por líder. */
    async iniciar(x: { sid: string; id: string; participantes: readonly Participante[]; rondas?: number }, o: OpcionesDebate = {}): Promise<EstadoDebate> {
      const sid = String(x.sid);
      if (viva(sid)) throw errorT("main.revisionYaCorre");
      const { plan, deps } = await d.preparar({ sid, id: String(x.id), participantes: x.participantes });
      // Otro pedido pudo ganar la carrera mientras se preparaba.
      if (viva(sid)) throw errorT("main.revisionYaCorre");
      const debate = iniciarDebate({ sid, plan, participantes: x.participantes, rondas: x.rondas }, {
        ...deps,
        avisar: (e) => {
          const actual = debates.get(sid);
          if (actual?.debate.id === e.estado.id) actual.estado = e.estado;
          d.avisar(e);
        },
      }, o);
      const estado = debate.estado();
      debates.set(sid, { debate, estado });
      return estado;
    },
    /** El estado del debate de un líder (el que corre, o cómo terminó el último), o `null`. */
    estado: (sid: string): EstadoDebate | null => debates.get(String(sid))?.estado ?? null,
    /** El dueño contesta la pregunta pendiente: una de sus opciones, o `null` para «Elegí vos». */
    responder: (sid: string, respuesta: unknown): boolean => debates.get(String(sid))?.debate.responder(typeof respuesta === "string" ? respuesta : null) ?? false,
    /** «Cortar y concluir». */
    cortar: (sid: string): void => debates.get(String(sid))?.debate.cortar(),
    /** «Cancelar»: no se manda nada al líder y el plan sigue pendiente. */
    cancelar: (sid: string): void => debates.get(String(sid))?.debate.cancelar(),
    /** Saca de la vista el último debate si ya terminó. */
    descartar: (sid: string): void => {
      if (!viva(String(sid))) debates.delete(String(sid));
    },
    viva,
  };
}
export type Debates = ReturnType<typeof crearDebates>;
