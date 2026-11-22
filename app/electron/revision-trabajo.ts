// Las revisiones de plan en curso («Revisar con otro modelo»): una por líder, con su estado vivo (fase, tiempo, pasos del revisor,
// texto que va saliendo), cancelable, y la revisión terminada guardada en disco hasta que entra en la cola del líder (un fallo
// de entrega no la pierde: se reintenta). Sin Electron; lo que toca el sistema entra por `DepsTrabajos` y lo prueba
// tests/revision-plan.test.ts con un revisor simulado. La orquestación de una revisión: revision-plan.ts (`revisarPlan`).
import { randomUUID } from "node:crypto";
import { errorT, MARCA } from "./errores.ts";
import { entregarGuardada, PASOS_MAX, revisarPlan, type Avance, type DepsRevision, type OpcionesCorrida, type RevisionEstado, type RevisionVista } from "./revision-plan.ts";

/** Una revisión que ya salió y todavía no entró en la cola del líder: vive en disco. */
export type Pendiente = { id: string; sid: string; planId: string; modelo: string; nombre: string; mensaje: string; inicio: number };

/** Cambia la lista de pendientes de a una modificación por vez (leer, cambiar, escribir): dos a la vez se pisarían y se perdería una guardada. */
export type Modificar = (cambio: (lista: Pendiente[]) => Pendiente[]) => Promise<void>;
export function crearModificador(leer: () => Promise<Pendiente[]>, escribir: (lista: Pendiente[]) => Promise<void>): Modificar {
  let cola: Promise<unknown> = Promise.resolve();
  return (cambio) => {
    const hecho = cola.then(async () => escribir(cambio(await leer().catch(() => []))));
    cola = hecho.catch(() => {});
    return hecho;
  };
}

export type DepsTrabajos = {
  ahora: () => number;
  /** Cada cambio de estado (la ventana lo ve como el evento `revision` del líder). */
  emitir: (e: RevisionEstado) => void;
  leer: () => Promise<Pendiente[]>;
  escribir: (lista: Pendiente[]) => Promise<void>;
  /** Cuánto se juntan los avances del revisor antes de emitirse (ms): un evento por cada token es mucho para el IPC. */
  juntarMs?: number;
  /** ¿Ese líder ya tiene otro trabajo de segunda opinión corriendo (un debate)? Si sí, no se arranca una revisión. */
  ocupado?: (sid: string) => boolean;
  /** El modificador compartido con quien más escribe ese archivo (el debate); sin él, uno propio sobre `leer` y `escribir`. */
  modificar?: Modificar;
};

/** El texto de un error ya traducible por la ventana (clave de i18n codificada); lo demás se dice general. */
export function textoDeError(e: unknown): string {
  const m = String((e as Error)?.message ?? e ?? "");
  return m.includes(MARCA) ? m : errorT("main.revisorFalloGeneral").message;
}

export function crearTrabajos(d: DepsTrabajos) {
  /** El último estado de cada líder (el vivo, o cómo terminó la última revisión hasta que se la descarta). */
  const estados = new Map<string, RevisionEstado>();
  const cortes = new Map<string, AbortController>();
  const juntar = d.juntarMs ?? 200;
  const modificar = d.modificar ?? crearModificador(d.leer, d.escribir);
  let pendiente: ReturnType<typeof setTimeout> | null = null;

  const poner = (e: RevisionEstado, ya = true) => {
    estados.set(e.sid, e);
    if (ya) {
      if (pendiente) clearTimeout(pendiente);
      pendiente = null;
      d.emitir(e);
    } else if (!pendiente) {
      pendiente = setTimeout(() => {
        pendiente = null;
        const u = estados.get(e.sid);
        if (u) d.emitir(u);
      }, juntar);
      pendiente.unref?.();
    }
  };
  const cambiar = (sid: string, cambio: Partial<RevisionEstado>) => {
    const e = estados.get(sid);
    if (e) poner({ ...e, ...cambio });
  };
  const pendientesDe = async (sid: string) => (await d.leer().catch(() => [])).filter((p) => p.sid === sid);

  const trabajos = {
    /** El estado actual de la revisión de ese líder (`null`: ninguna). Si no hay en memoria pero quedó una guardada, la devuelve como fallo de entrega. */
    async estado(sid: string): Promise<RevisionEstado | null> {
      const e = estados.get(sid);
      if (e) return e;
      const p = (await pendientesDe(sid)).at(-1);
      if (!p) return null;
      const r: RevisionEstado = { id: p.id, sid, planId: p.planId, modelo: p.modelo, nombre: p.nombre, fase: "fallo", inicio: p.inicio, fin: p.inicio, pasos: [], texto: "", error: errorT("main.revisionNoEntro").message, reintentable: true };
      estados.set(sid, r);
      return r;
    },
    /**
     * Arranca una revisión y devuelve su estado enseguida (el trabajo sigue solo y avisa por `emitir`). Una por líder.
     * `armar` arma lo que toca el sistema (qué se entrega, se niega y se guarda).
     */
    iniciar(x: { sid: string; planId: string; modelo: string; effort: string; plan: string; nombre: string }, armar: () => DepsRevision): RevisionEstado {
      const previo = estados.get(x.sid);
      if (previo && (previo.fase === "corriendo" || previo.fase === "entregando")) throw errorT("main.revisionYaCorre");
      if (d.ocupado?.(x.sid)) throw errorT("main.revisionYaCorre");
      // Una guardada sin entregar de un plan anterior no sobrevive a una revisión nueva (si no, «Reintentar» le entregaría al líder la vieja).
      void modificar((l) => l.filter((p) => p.sid !== x.sid)).catch(() => {});
      const id = randomUUID();
      const inicio = d.ahora();
      const base: RevisionEstado = { id, sid: x.sid, planId: x.planId, modelo: x.modelo, nombre: x.nombre, fase: "corriendo", inicio, fin: null, pasos: [], texto: "", error: null, reintentable: false };
      poner(base);
      const corte = new AbortController();
      cortes.set(x.sid, corte);
      const o: OpcionesCorrida = {
        señal: corte.signal,
        avance: (a: Avance) => {
          const e = estados.get(x.sid);
          if (!e || e.id !== id || e.fase !== "corriendo") return;
          const pasos = a.paso ? [...e.pasos, a.paso].slice(-PASOS_MAX) : e.pasos;
          poner({ ...e, pasos, texto: a.texto ?? e.texto }, !!a.paso);
        },
      };
      const deps = armar();
      const mio = () => estados.get(x.sid)?.id === id;
      void revisarPlan(
        { modelo: x.modelo, effort: x.effort, plan: x.plan },
        {
          ...deps,
          guardar: async (mensaje, r: RevisionVista) => {
            await deps.guardar?.(mensaje, r);
            await modificar((l) => [...l.filter((p) => p.id !== id), { id, sid: x.sid, planId: x.planId, modelo: x.modelo, nombre: x.nombre, mensaje, inicio }]);
          },
          alEntregar: (r) => {
            deps.alEntregar?.(r);
            if (mio()) cambiar(x.sid, { fase: "entregando", texto: "" });
          },
          quitar: async () => {
            await modificar((l) => l.filter((p) => p.id !== id));
          },
        },
        o,
      ).then(
        () => {
          cortes.delete(x.sid);
          if (mio()) cambiar(x.sid, { fase: "hecha", fin: d.ahora(), error: null, reintentable: false });
        },
        async (e: unknown) => {
          cortes.delete(x.sid);
          if (!mio()) return;
          const guardada = (await pendientesDe(x.sid)).some((p) => p.id === id);
          const cancelada = corte.signal.aborted && !guardada;
          cambiar(x.sid, { fase: cancelada ? "cancelada" : "fallo", fin: d.ahora(), error: cancelada ? null : textoDeError(e), reintentable: guardada });
        },
      );
      return base;
    },
    /** Corta al revisor (lo mata). `false`: no había ninguno corriendo. */
    cancelar(sid: string): boolean {
      const c = cortes.get(sid);
      const e = estados.get(sid);
      if (!c || !e || e.fase !== "corriendo") return false;
      c.abort();
      return true;
    },
    /** Reintenta entregar una revisión guardada que no entró en la cola. */
    async reintentar(sid: string, entregar: (texto: string) => Promise<unknown>): Promise<RevisionEstado> {
      const e = await trabajos.estado(sid);
      if (e && (e.fase === "corriendo" || e.fase === "entregando")) throw errorT("main.revisionYaCorre");
      const p = (await pendientesDe(sid)).at(-1);
      if (!e || !p) throw errorT("main.revisionNadaQueEntregar");
      poner({ ...e, fase: "entregando", error: null, reintentable: false, fin: null });
      try {
        await entregarGuardada(p.mensaje, {
          entregar,
          quitar: () => modificar((l) => l.filter((x) => x.id !== p.id)),
        });
        cambiar(sid, { fase: "hecha", fin: d.ahora() });
      } catch (err) {
        cambiar(sid, { fase: "fallo", fin: d.ahora(), error: textoDeError(err), reintentable: true });
      }
      return estados.get(sid)!;
    },
    /** Saca de la vista la última revisión (ya terminó, o falló y no se va a reintentar). Una guardada sin entregar no se descarta. */
    descartar(sid: string): void {
      const e = estados.get(sid);
      if (e && e.fase !== "corriendo" && e.fase !== "entregando" && !e.reintentable) estados.delete(sid);
    },
  };
  return trabajos;
}
export type Trabajos = ReturnType<typeof crearTrabajos>;
